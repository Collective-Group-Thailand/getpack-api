import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type PriceImpactSimulation, type Prisma } from '@generated/prisma/client';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';
import { SettingsService } from '@platform/settings/settings.service';

import { type PriceSimulationDto } from './pricing.dto';
import { QUOTE_REPRICER, type QuoteRepricer, type RepriceResult } from './quote-repricer.port';

const BATCH = 5;
/** A claimed simulation is retried by another worker after this long (crash safety). */
const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;
const DAY_MS = 86_400_000;

const dto = (s: PriceImpactSimulation & { proposal: { publicId: string } }): PriceSimulationDto => ({
  id: s.publicId,
  proposalId: s.proposal.publicId,
  status: s.status,
  windowFrom: toBangkokIso(s.windowFrom),
  windowTo: toBangkokIso(s.windowTo),
  result: s.result as unknown as RepriceResult | null,
  error: s.error,
  createdAt: toBangkokIso(s.createdAt),
  completedAt: s.completedAt && toBangkokIso(s.completedAt),
});

/**
 * Impact simulation (D-040 note): re-prices the factory's quotes of the last
 * `partners.impact_simulation_window_days` with the proposal's values — price, margin and selection-
 * share deltas. Requested over HTTP (202), run by the worker, polled by the admin screen. Staff only.
 */
@Injectable()
export class PriceSimulationsService {
  private readonly logger = new Logger(PriceSimulationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    @Inject(QUOTE_REPRICER) private readonly repricer: QuoteRepricer,
  ) {}

  async request(actor: UserActor, proposalPublicId: string): Promise<PriceSimulationDto> {
    const proposal = await this.prisma.priceProposal.findUnique({ where: { publicId: proposalPublicId } });
    if (!proposal) throw new DomainException('http.not_found');
    const now = new Date();
    const days = await this.settings.value('partners.impact_simulation_window_days', now);
    return this.prisma.withTx(async (tx) => {
      const simulation = await tx.priceImpactSimulation.create({
        data: {
          proposalId: proposal.id,
          requestedById: actor.userId,
          windowFrom: new Date(now.getTime() - days * DAY_MS),
          windowTo: now,
        },
        include: { proposal: { select: { publicId: true } } },
      });
      await this.audit.record(tx, {
        category: 'data_access',
        action: 'price_simulation.requested',
        resourceType: 'price_proposal',
        resourcePublicId: proposal.publicId,
        data: { simulationId: simulation.publicId, windowDays: days },
      });
      await this.events.record(tx, {
        type: 'price_simulation.requested',
        aggregateType: 'price_proposal',
        aggregateId: proposal.publicId,
        payload: { proposalId: proposal.publicId, simulationId: simulation.publicId },
      });
      return dto(simulation);
    });
  }

  async get(proposalPublicId: string, simulationPublicId: string): Promise<PriceSimulationDto> {
    const simulation = await this.prisma.priceImpactSimulation.findFirst({
      where: { publicId: simulationPublicId, proposal: { publicId: proposalPublicId } },
      include: { proposal: { select: { publicId: true } } },
    });
    if (!simulation) throw new DomainException('http.not_found');
    return dto(simulation);
  }

  /** Claims due simulations (queued, or running past their lease) and runs them. */
  @ScheduledJob({ name: 'partners.price-simulations', every: 10_000 })
  async processDue(now: Date = new Date()): Promise<number> {
    const claimed = await this.prisma.$queryRaw<{ id: bigint }[]>`
      UPDATE price_impact_simulations
         SET status = 'running', locked_until = ${new Date(now.getTime() + LEASE_MS)},
             attempts = attempts + 1, started_at = COALESCE(started_at, ${now})
       WHERE id IN (
         SELECT id FROM price_impact_simulations
          WHERE status = 'queued' OR (status = 'running' AND locked_until < ${now})
          ORDER BY id LIMIT ${BATCH}
          FOR UPDATE SKIP LOCKED)
      RETURNING id`;
    for (const { id } of claimed) await this.runOne(id);
    return claimed.length;
  }

  private async runOne(id: bigint): Promise<void> {
    const simulation = await this.prisma.priceImpactSimulation.findUniqueOrThrow({
      where: { id },
      include: { proposal: { include: { priceList: true } } },
    });
    try {
      const result = await this.repricer.reprice({
        factoryId: simulation.proposal.priceList.factoryId,
        productTypeId: simulation.proposal.priceList.productTypeId,
        proposalId: simulation.proposalId,
        windowFrom: simulation.windowFrom,
        windowTo: simulation.windowTo,
      });
      await this.finish(id, {
        status: 'succeeded',
        result: { ...result },
        error: null,
        completedAt: new Date(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : 'error';
      this.logger.warn(`price simulation ${simulation.publicId} failed: ${message}`);
      await this.finish(
        id,
        simulation.attempts >= MAX_ATTEMPTS
          ? { status: 'failed', error: message, completedAt: new Date() }
          : { status: 'queued', error: message, lockedUntil: null },
      );
    }
  }

  private async finish(id: bigint, data: Prisma.PriceImpactSimulationUpdateInput): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      const updated = await tx.priceImpactSimulation.update({
        where: { id },
        data,
        include: { proposal: { select: { publicId: true } } },
      });
      if (updated.status === 'succeeded' || updated.status === 'failed') {
        await this.events.record(tx, {
          type: `price_simulation.${updated.status}`,
          aggregateType: 'price_proposal',
          aggregateId: updated.proposal.publicId,
          payload: { proposalId: updated.proposal.publicId, simulationId: updated.publicId },
        });
      }
    });
  }
}
