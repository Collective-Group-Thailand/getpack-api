import { systemActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type SalesInboundLead } from '@generated/prisma/client';
import { recordAgentEvent } from '@modules/agents/agent-shared';
import { Injectable, Logger } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { SettingsService } from '@platform/settings/settings.service';

import { CaptureAttributionService } from './capture-attribution.service';
import { type CaptureRoute, type CaptureSkip, studioIdleWindow } from './capture-rules';
import { CLOSED_INBOUND } from './sales-desk-rules';
import { INBOUND_AGGREGATE, SalesInboundService } from './sales-inbound.service';
import { SalesScoringService } from './sales-scoring.service';

const BATCH = 500;
const ACTOR = systemActor('sales.capture');

interface Contact {
  name: string;
  phone: string | null;
  email: string | null;
  organisationName: string | null;
  taxId: string | null;
}

/**
 * D-471 (agent portal Phase 5): automatic lead capture into the inbound pool (D-469) — saved studio designs not
 * ordered within `capture.studio_idle_days` and free dieline downloads by signed-in non-customers — each behind its
 * own effective-dated flag, only with granted marketing consent (the record relied on is kept on the item, PDPA /
 * D-144), and never for a contact attributed to an agent (precedence agent > rep > pool, `routeCapture`). Contact data
 * is read from the account, never from events.
 */
@Injectable()
export class SalesCaptureService {
  private readonly logger = new Logger(SalesCaptureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly inbound: SalesInboundService,
    private readonly attribution: CaptureAttributionService,
    private readonly scoring: SalesScoringService,
    readonly events: DomainEvents,
    readonly activity: ActivityLogService,
  ) {}

  // --- studio idle (item 1a) --------------------------------------------------------------------------------------

  /** Job `sales.capture_studio_idle`: idempotent (one item per design, one open studio item per person). */
  async captureStudioIdle(now = new Date()): Promise<{ captured: number; skipped: Record<string, number> }> {
    const skipped: Record<string, number> = {};
    const skip = (why: CaptureSkip) => (skipped[why] = (skipped[why] ?? 0) + 1);
    const flag = await this.settings.at('capture.studio_idle_enabled', { at: now });
    if (!flag.value) return { captured: 0, skipped: { flag_off: 1 } };
    const days = await this.settings.value('capture.studio_idle_days', now);
    const window = studioIdleWindow(now, days, flag.effectiveFrom);
    if (!window) return { captured: 0, skipped };
    const designs = await this.prisma.designDocument.findMany({
      where: {
        deletedAt: null,
        currentVersionId: { not: null },
        lockedByOrderId: null,
        updatedAt: { gte: window.from, lte: window.to },
        orders: { none: {} },
        salesInbound: { is: null },
        owner: { kind: 'customer', status: 'active' },
      },
      select: {
        id: true,
        publicId: true,
        title: true,
        ownerUserId: true,
        styleVariant: { select: { code: true } },
      },
      orderBy: { id: 'asc' },
      take: BATCH,
    });
    let captured = 0;
    for (const design of designs) {
      const outcome = await this.prisma.withTx(async (tx) => {
        await this.lockPerson(tx, design.ownerUserId);
        if (await tx.salesInboundLead.findUnique({ where: { designDocumentId: design.id } }))
          return 'already_captured';
        const why = await this.eligible(tx, design.ownerUserId, now);
        if (typeof why === 'string') return why;
        if (why.route.route !== 'pool') return 'attributed';
        const open = await tx.salesInboundLead.count({
          where: {
            captureUserId: design.ownerUserId,
            source: 'studio_idle',
            status: { notIn: [...CLOSED_INBOUND] },
          },
        });
        if (open > 0) return 'open_item';
        const row = await this.inbound.intake(
          tx,
          'studio_idle',
          null,
          {
            contactName: why.contact.name,
            contactPhone: why.contact.phone,
            contactEmail: why.contact.email,
            organisationName: why.contact.organisationName,
            need: [`“${design.title}”`, design.styleVariant?.code].filter(Boolean).join(' · '),
          },
          {
            actor: ACTOR,
            captureUserId: design.ownerUserId,
            designDocumentId: design.id,
            consentBasis: 'marketing_consent',
            consentRecordId: why.consentRecordId,
          },
        );
        await this.inbound.autoAssign(tx, row, ACTOR);
        return 'captured';
      });
      if (outcome === 'captured') captured += 1;
      else skip(outcome);
    }
    if (captured > 0) this.logger.log(`sales.capture_studio_idle: ${captured} captured`);
    return { captured, skipped };
  }

  // --- dieline download (item 1b) --------------------------------------------------------------------------------

  /** A signed-in non-customer's free dieline download creates (or refreshes) one open item. */
  @OnDomainEvent('dielines.downloaded', { consumer: 'sales.inbound_from_dieline' })
  async onDielineDownloaded(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['staff'] === true || event.payload['anonymous'] === true) return;
    const now = new Date();
    if (!(await this.settings.value('capture.dieline_download_enabled', now))) return;
    const download = await tx.dielineDownload.findUnique({
      where: { publicId: String(event.payload['downloadId']) },
      select: { userId: true, staff: true },
    });
    if (!download?.userId || download.staff) return;
    await this.captureDieline(
      tx,
      download.userId,
      typeof event.payload['variantCode'] === 'string' ? event.payload['variantCode'] : '',
      now,
    );
  }

  async captureDieline(
    tx: Tx,
    userId: bigint,
    variantCode: string,
    now = new Date(),
  ): Promise<CaptureSkip | 'captured' | 'refreshed'> {
    await this.lockPerson(tx, userId);
    const why = await this.eligible(tx, userId, now);
    if (typeof why === 'string') return why;
    if ((await tx.orderGroup.count({ where: { customerUserId: userId } })) > 0) return 'customer';
    // An agent's contact never enters (or stays fed in) the company pool.
    if (why.route.route === 'agent') return 'attributed';
    const open = await tx.salesInboundLead.findFirst({
      where: { captureUserId: userId, source: 'dieline_download', status: { notIn: [...CLOSED_INBOUND] } },
    });
    if (open) {
      await tx.salesInboundLead.update({
        where: { id: open.id },
        data: {
          signalCount: { increment: 1 },
          lastSignalAt: now,
          consentRecordId: why.consentRecordId,
          need: this.dielineNeed(open.need, variantCode),
          rowVersion: { increment: 1 },
        },
      });
      await this.scoring.scoreInbound(tx, open.id, now);
      await recordAgentEvent(this, tx, {
        type: 'sales_inbound_lead.refreshed',
        aggregateType: INBOUND_AGGREGATE,
        aggregateId: open.publicId,
        payload: { inboundId: open.publicId, source: 'dieline_download', signalCount: open.signalCount + 1 },
        actor: ACTOR,
      });
      return 'refreshed';
    }
    const row = await this.inbound.intake(
      tx,
      'dieline_download',
      variantCode || null,
      {
        contactName: why.contact.name,
        contactPhone: why.contact.phone,
        contactEmail: why.contact.email,
        organisationName: why.contact.organisationName,
        need: this.dielineNeed(null, variantCode),
      },
      {
        actor: ACTOR,
        captureUserId: userId,
        consentBasis: 'marketing_consent',
        consentRecordId: why.consentRecordId,
      },
    );
    await this.place(tx, row, why.route);
    return 'captured';
  }

  // --- shared -------------------------------------------------------------------------------------------------------

  /** A rep-attributed item goes to that rep (`attribution`); the pool follows `sales.assignment_mode`. */
  async place(tx: Tx, row: SalesInboundLead, route: CaptureRoute, actor = ACTOR): Promise<void> {
    if (route.route === 'rep')
      try {
        await this.inbound.assignInTx(tx, row, route.repUserId, 'attribution', null, actor);
        return;
      } catch (error) {
        // The rep has no active employee agent any more: the pool takes it.
        if (!(error instanceof DomainException) || error.code !== 'sales.rep_unavailable') throw error;
      }
    await this.inbound.autoAssign(tx, row, actor);
  }

  /** The checks every captured signal shares: a customer account, not an agent, marketing consent granted. */
  private async eligible(
    tx: Tx,
    userId: bigint,
    now: Date,
  ): Promise<CaptureSkip | { contact: Contact; consentRecordId: bigint; route: CaptureRoute }> {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { kind: true, status: true, displayName: true, phone: true, email: true },
    });
    if (!user || user.kind !== 'customer' || user.status !== 'active') return 'not_customer_account';
    if (await tx.salesAgent.findUnique({ where: { userId }, select: { id: true } })) return 'agent';
    const consent = await this.attribution.marketingConsent(tx, userId);
    if (!consent) return 'no_consent';
    const member = await tx.companyMember.findFirst({
      where: { userId, status: 'active', company: { status: 'active' } },
      orderBy: { id: 'asc' },
      select: { company: { select: { legalName: true, tradeName: true, taxId: true } } },
    });
    const contact: Contact = {
      name: user.displayName,
      phone: user.phone,
      email: user.email?.toLowerCase() ?? null,
      organisationName: member ? (member.company.tradeName ?? member.company.legalName) : null,
      taxId: member?.company.taxId ?? null,
    };
    const route = await this.attribution.route(
      tx,
      { userId, phone: contact.phone, email: contact.email, taxId: contact.taxId },
      now,
    );
    return { contact, consentRecordId: consent.id, route };
  }

  private dielineNeed(previous: string | null, variantCode: string): string {
    const codes = new Set((previous ?? '').split(' · ').filter((c) => c && c !== 'dieline'));
    if (variantCode) codes.add(variantCode);
    return ['dieline', ...[...codes].slice(-5)].join(' · ');
  }

  /** One person's captures are made one at a time (no duplicate item from parallel signals). */
  private async lockPerson(tx: Tx, userId: bigint): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('sales_capture'), (${userId} % 2147483647)::int)`;
  }
}
