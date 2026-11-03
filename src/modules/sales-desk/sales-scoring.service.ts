import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { SettingsService } from '@platform/settings/settings.service';
import Decimal from 'decimal.js';

import { type LeadScore, scoreLead, type ScoringInput, type ScoringRules } from './lead-scoring';
import { CLOSED_INBOUND } from './sales-desk-rules';

const BATCH = 500;
/** A score older than this is recomputed (recency moves with time). Technical refresh interval, not a business value. */
const STALE_MS = 6 * 3_600_000;

/**
 * D-471 item 2: computes and stores the lead score of inbound items and agent leads from `sales.scoring_rules` in force
 * (the setting version is kept with the score). A derived value: written without an event; read by staff with its
 * reasons and by agents as the score of their own leads only.
 */
@Injectable()
export class SalesScoringService {
  private readonly logger = new Logger(SalesScoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private async rules(now: Date, tx?: Tx): Promise<{ rules: ScoringRules; versionId: bigint }> {
    const r = await this.settings.at('sales.scoring_rules', { at: now, ...(tx && { tx }) });
    return { rules: r.value, versionId: r.versionId };
  }

  /** Scores one inbound item now (at intake, on refresh). */
  async scoreInbound(tx: Tx, id: bigint, now = new Date()): Promise<LeadScore> {
    const { rules, versionId } = await this.rules(now, tx);
    const input = await this.inboundInput(tx, id, now);
    const result = scoreLead(rules, input);
    const { updatedAt } = await tx.salesInboundLead.findUniqueOrThrow({
      where: { id },
      select: { updatedAt: true },
    });
    await tx.salesInboundLead.update({
      where: { id },
      data: {
        // A derived value: the item's own "updated" time does not move.
        updatedAt,
        score: result.score,
        scoreReasons: result.reasons as unknown as Prisma.InputJsonValue,
        scoredAt: now,
        scoreSettingVersionId: versionId,
      },
    });
    return result;
  }

  async scoreAgentLead(tx: Tx, id: bigint, now = new Date()): Promise<LeadScore> {
    const { rules, versionId } = await this.rules(now, tx);
    const lead = await tx.salesAgentLead.findUniqueOrThrow({
      where: { id },
      select: {
        source: true,
        email: true,
        taxId: true,
        expectedValue: true,
        createdAt: true,
        stageChangedAt: true,
        updatedAt: true,
        convertedCompany: { select: { taxId: true } },
      },
    });
    const last =
      lead.stageChangedAt && lead.stageChangedAt > lead.createdAt ? lead.stageChangedAt : lead.createdAt;
    const result = scoreLead(rules, {
      kind: 'lead',
      source: lead.source,
      email: lead.email,
      taxIdPresent: Boolean(lead.taxId ?? lead.convertedCompany?.taxId),
      quantity: null,
      estimatedValue: lead.expectedValue?.toFixed(2) ?? null,
      lastSignalAt: last,
      signalCount: 1,
      now,
    });
    await tx.salesAgentLead.update({
      where: { id },
      data: {
        updatedAt: lead.updatedAt,
        score: result.score,
        scoreReasons: result.reasons as unknown as Prisma.InputJsonValue,
        scoredAt: now,
        scoreSettingVersionId: versionId,
      },
    });
    return result;
  }

  /** A lead is scored when it is registered and whenever the agent or rep changes it. */
  @OnDomainEvent('sales_agent_lead.registered', { consumer: 'sales.lead_score_on_register' })
  onRegistered(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    return this.scoreByPublicId(tx, event.aggregateId);
  }

  @OnDomainEvent('sales_agent_lead.updated', { consumer: 'sales.lead_score_on_update' })
  onUpdated(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    return this.scoreByPublicId(tx, event.aggregateId);
  }

  @OnDomainEvent('sales_agent_lead.stage_changed', { consumer: 'sales.lead_score_on_stage' })
  onStageChanged(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    return this.scoreByPublicId(tx, event.aggregateId);
  }

  private async scoreByPublicId(tx: Tx, publicId: string): Promise<void> {
    const lead = await tx.salesAgentLead.findUnique({
      where: { publicId },
      select: { id: true, kind: true },
    });
    if (lead?.kind === 'customer') await this.scoreAgentLead(tx, lead.id);
  }

  /** What the rules read of an inbound item: its contact, the source's quantity and value, the last signal. */
  async inboundInput(tx: Tx, id: bigint, now: Date): Promise<ScoringInput> {
    const row = await tx.salesInboundLead.findUniqueOrThrow({
      where: { id },
      select: {
        source: true,
        contactEmail: true,
        captureUserId: true,
        designDocumentId: true,
        signalCount: true,
        lastSignalAt: true,
        createdAt: true,
        rfq: {
          select: {
            customerUserId: true,
            targetPricePerUnit: true,
            tiers: { select: { quantity: true } },
          },
        },
        supportTicket: { select: { customerUserId: true, context: true } },
        agentLead: { select: { taxId: true, expectedValue: true } },
      },
    });
    const userId = row.captureUserId ?? row.rfq?.customerUserId ?? row.supportTicket?.customerUserId ?? null;
    const company = userId
      ? await tx.companyMember.findFirst({
          where: { userId, status: 'active', company: { status: 'active' } },
          select: { company: { select: { taxId: true } } },
        })
      : null;

    let quantity: number | null = null;
    let value: Decimal | null = null;
    if (row.rfq) {
      const max = Math.max(0, ...row.rfq.tiers.map((t) => t.quantity));
      quantity = max > 0 ? max : null;
      if (quantity && row.rfq.targetPricePerUnit) value = row.rfq.targetPricePerUnit.mul(quantity);
    }
    if (row.supportTicket) {
      const details = ((row.supportTicket.context ?? {}) as Record<string, unknown>)['details'] as
        Record<string, unknown> | undefined;
      const q = Number(details?.['quantity']);
      if (Number.isInteger(q) && q > 0) quantity = q;
    }
    if (row.designDocumentId) {
      const item = await tx.cartItem.findFirst({
        where: { designDocumentId: row.designDocumentId },
        orderBy: { id: 'desc' },
        select: { quantity: true, unitPrice: true },
      });
      if (item) {
        quantity = item.quantity;
        value = new Decimal(item.unitPrice.toString()).mul(item.quantity);
      }
    }
    if (row.agentLead?.expectedValue) value = new Decimal(row.agentLead.expectedValue.toString());

    return {
      kind: 'inbound',
      source: row.source,
      email: row.contactEmail,
      taxIdPresent: Boolean(company?.company.taxId ?? row.agentLead?.taxId),
      quantity,
      estimatedValue: value ? value.toDecimalPlaces(2).toFixed(2) : null,
      lastSignalAt: row.lastSignalAt ?? row.createdAt,
      signalCount: row.signalCount,
      now,
    };
  }

  /** Job `sales.lead_scoring`: open items and leads never scored, scored long ago or by older rules. */
  async rescoreDue(now = new Date()): Promise<number> {
    const { versionId } = await this.rules(now);
    const stale = new Date(now.getTime() - STALE_MS);
    const due = {
      OR: [{ scoredAt: null }, { scoredAt: { lt: stale } }, { scoreSettingVersionId: { not: versionId } }],
    };
    const items = await this.prisma.salesInboundLead.findMany({
      where: { status: { notIn: [...CLOSED_INBOUND] }, ...due },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: BATCH,
    });
    const leads = await this.prisma.salesAgentLead.findMany({
      where: {
        kind: 'customer',
        status: { in: ['registered', 'converted'] },
        stage: { notIn: ['won', 'lost'] },
        ...due,
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: BATCH,
    });
    for (const { id } of items) await this.prisma.withTx((tx) => this.scoreInbound(tx, id, now));
    for (const { id } of leads) await this.prisma.withTx((tx) => this.scoreAgentLead(tx, id, now));
    const n = items.length + leads.length;
    if (n > 0) this.logger.log(`sales.lead_scoring: ${n} scored`);
    return n;
  }
}
