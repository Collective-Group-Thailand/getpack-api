import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

import { PriceComponentRegistry } from './price-component.registry';
import { type PriceSuggestionsDto } from './pricing.dto';
import { SuggestionEngine } from './suggestion-engine';

/**
 * Stores and serves the staff-only suggestions of a proposal (D-040 note, D-044): computed when the
 * proposal is submitted and on demand; served only on `/v1/admin` to `price_suggestions.read`.
 */
@Injectable()
export class PriceSuggestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: SuggestionEngine,
    private readonly registry: PriceComponentRegistry,
    private readonly audit: AuditService,
  ) {}

  async get(actor: UserActor, proposalPublicId: string): Promise<PriceSuggestionsDto> {
    const proposal = await this.prisma.priceProposal.findUnique({
      where: { publicId: proposalPublicId },
      include: {
        priceList: { include: { factory: { select: { code: true } } } },
        lines: { include: { suggestion: true }, orderBy: [{ component: 'asc' }, { lineKey: 'asc' }] },
      },
    });
    if (!proposal) throw new DomainException('http.not_found');
    // The basis summarises other factories' prices: every read is audited (D-044).
    await this.audit.record(this.prisma, {
      category: 'data_access',
      action: 'price.suggestions_read',
      resourceType: 'price_proposal',
      resourcePublicId: proposal.publicId,
      data: { factory: proposal.priceList.factory.code, lines: proposal.lines.length },
      actor,
    });
    const computed = proposal.lines.map((l) => l.suggestion?.computedAt).filter((d): d is Date => !!d);
    return {
      proposalId: proposal.publicId,
      computedAt:
        computed.length > 0 ? toBangkokIso(new Date(Math.max(...computed.map((d) => d.getTime())))) : null,
      lines: proposal.lines
        .filter((l) => l.suggestion)
        .map((l) => ({
          lineId: l.publicId,
          component: l.component,
          lineKey: l.lineKey,
          group: this.registry.get(l.component)?.group ?? null,
          method: l.suggestion!.method,
          suggestedValues: l.suggestion!.suggestedValues as Record<string, unknown> | null,
          basis: l.suggestion!.basis as Record<string, unknown>,
          deviationPct: l.suggestion!.deviationPct?.toFixed(4) ?? null,
          flags: l.suggestion!.flags,
          computedAt: toBangkokIso(l.suggestion!.computedAt),
        })),
    };
  }

  async recompute(actor: UserActor, proposalPublicId: string): Promise<PriceSuggestionsDto> {
    const proposal = await this.prisma.priceProposal.findUnique({ where: { publicId: proposalPublicId } });
    if (!proposal) throw new DomainException('http.not_found');
    await this.prisma.withTx((tx) => this.compute(tx, proposal.id));
    return this.get(actor, proposalPublicId);
  }

  /** (Re)computes every line's suggestion; lines of components nobody registered get none. */
  async compute(tx: Tx, proposalId: bigint): Promise<number> {
    const proposal = await tx.priceProposal.findUniqueOrThrow({
      where: { id: proposalId },
      include: {
        priceList: true,
        baseVersion: { select: { effectiveFrom: true } },
        lines: true,
      },
    });
    const suggestions = await this.engine.suggestAll(
      tx,
      {
        factoryId: proposal.priceList.factoryId,
        productTypeId: proposal.priceList.productTypeId,
        baseEffectiveFrom: proposal.baseVersion?.effectiveFrom ?? null,
        now: new Date(),
      },
      proposal.lines,
    );
    const now = new Date();
    for (const [lineId, s] of suggestions) {
      const data = {
        method: s.method,
        suggestedValues: s.suggestedValues ?? Prisma.DbNull,
        basis: s.basis as Prisma.InputJsonObject,
        deviationPct: s.deviationPct ? new Prisma.Decimal(s.deviationPct.toString()) : null,
        flags: s.flags,
        computedAt: now,
      };
      await tx.priceLineSuggestion.upsert({
        where: { proposalLineId: lineId },
        create: { proposalLineId: lineId, ...data },
        update: data,
      });
    }
    return suggestions.size;
  }

  @OnDomainEvent(['price_proposal.submitted'], { consumer: 'partners.price-suggestions' })
  async onSubmitted(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const proposal = await tx.priceProposal.findUnique({ where: { publicId: event.aggregateId } });
    if (!proposal) return;
    await this.compute(tx, proposal.id);
  }
}
