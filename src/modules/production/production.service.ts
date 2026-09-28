import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { addCalendarDays, bangkokDate, startOfBangkokDay } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type AssignmentReason,
  type JobKind,
  Prisma,
  type ProductionStartMode,
} from '@generated/prisma/client';
import { OrdersService } from '@modules/orders/orders.service';
import { CapacityService } from '@modules/partners/capacity/capacity.service';
import { QuoteEngineService } from '@modules/pricing/quotes/quote-engine.service';
import { Injectable, Logger } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { BusinessCalendarService } from '@platform/calendar/business-calendar.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';
import { DocumentNumberingService } from '@platform/numbering/document-numbering.service';
import { SettingsService } from '@platform/settings/settings.service';

const D = (v: string | Prisma.Decimal | number) => new MoneyDecimal(v.toString());
/** Factories that may produce: trial jobs are how a new factory proves itself (D-041, D-076). */
const PRODUCING: readonly string[] = ['trial', 'active'];
const LIVE_JOB: Prisma.ProductionJobWhereInput = { status: { notIn: ['rejected', 'cancelled'] } };

export type BlockReason =
  | 'not_paid'
  | 'artwork_not_approved'
  | 'no_factory'
  | 'factory_not_active'
  | 'capacity_not_configured'
  | 'capacity_full'
  | 'price_snapshot_invalid'
  | 'no_route';

interface RouteStepSnapshot {
  seq: number;
  key: string;
  nameTh: string;
  nameEn: string;
  customerVisible: boolean;
  customerLabelTh: string | null;
  customerLabelEn: string | null;
  evidence: 'none' | 'photo' | 'qc_form' | 'photo_and_qc_form';
  tracksQuantity: boolean;
  plannedSharePct: string | null;
}

export interface RouteSnapshot {
  routeId: string;
  variant: string;
  versionNo: number;
  steps: RouteStepSnapshot[];
}

type OrderForRelease = Prisma.OrderGetPayload<{
  include: {
    quote: true;
    quoteOption: true;
    productType: true;
    selectedFactory: { include: { calendar: true } };
    proofs: { where: { status: 'approved' }; include: { approvedFile: true; dielineFile: true } };
  };
}>;

/**
 * Production release and assignment (D-073, D-074, D-012, D-101). The gate is re-evaluated on every relevant
 * event and by a sweep: artwork approved **and** the instalments required before production paid **and** the
 * selected factory producing with free capacity **and** the order's price snapshot still valid → a job is
 * released to the factory (job no, spec / route / buy-price snapshots, milestones with due dates, the order
 * fact `production_started`, events for the factory, the customer and B5's AP commitment). CS may start
 * production as a documented exception (permission, reason, audit). The factory accepts within 1 business
 * day (setting); a rejection or a missed deadline moves the job only when enough factories serve the type
 * (D-101) and the new one keeps the margin floor — the customer price never changes — otherwise it escalates
 * to the Partner team and CS.
 */
@Injectable()
export class ProductionService {
  private readonly logger = new Logger(ProductionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly capacity: CapacityService,
    private readonly calendars: BusinessCalendarService,
    private readonly settings: SettingsService,
    private readonly numbering: DocumentNumberingService,
    private readonly quotes: QuoteEngineService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
    private readonly audit: AuditService,
  ) {}

  // --- gate (D-073) -----------------------------------------------------------------------------------

  @OnDomainEvent('order.fact_recorded', { consumer: 'production.gate' })
  async onFact(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const fact = event.payload['fact'];
    if (fact !== 'paid_for_production' && fact !== 'artwork_approved') return;
    const order = await tx.order.findUnique({ where: { publicId: event.aggregateId } });
    if (order) await this.evaluate(tx, order.id, systemActor('production.gate'));
  }

  /** Orders waiting for production are re-evaluated (factory activation, capacity freed, missed events). */
  @ScheduledJob({ name: 'production.gate_sweep', every: 15 * 60_000 })
  async sweep(): Promise<number> {
    const waiting = await this.prisma.order.findMany({
      where: { status: 'artwork_approved', productionStartedAt: null, cancelledAt: null },
      select: { id: true },
      take: 500,
    });
    let released = 0;
    for (const { id } of waiting) {
      try {
        if (await this.prisma.withTx((tx) => this.evaluate(tx, id, systemActor('production.gate_sweep'))))
          released++;
      } catch (error) {
        this.logger.warn(`gate of order ${id}: ${(error as Error).message}`);
      }
    }
    return released;
  }

  /** Releases the production job when the gate is open; returns whether it did. */
  async evaluate(tx: Tx, orderId: bigint, actor: Actor): Promise<boolean> {
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
    const order = await this.loadOrder(tx, orderId);
    if (order.productionStartedAt || order.cancelledAt) return false;
    if ((await tx.productionJob.count({ where: { orderId, jobKind: 'production', ...LIVE_JOB } })) > 0)
      return false;
    const blocked = await this.blockReason(tx, order);
    if (blocked) {
      await this.recordBlocked(tx, order.publicId, blocked, actor);
      return false;
    }
    await this.release(tx, order, 'production', 'auto', null, actor);
    return true;
  }

  private async blockReason(tx: Tx, order: OrderForRelease): Promise<BlockReason | null> {
    if (!order.paidForProductionAt) return 'not_paid';
    if (!order.artworkApprovedAt) return 'artwork_not_approved';
    return this.factoryBlock(tx, order, true);
  }

  private async factoryBlock(
    tx: Tx,
    order: OrderForRelease,
    checkCapacity: boolean,
  ): Promise<BlockReason | null> {
    const factory = order.selectedFactory;
    if (!factory) return 'no_factory';
    if (!PRODUCING.includes(factory.status)) return 'factory_not_active';
    if (order.quoteOption.priceListVersionId) {
      const version = await tx.priceListVersion.findUnique({
        where: { id: order.quoteOption.priceListVersionId },
      });
      if (version?.status !== 'approved') return 'price_snapshot_invalid';
    }
    if (checkCapacity) {
      const load = await this.loadOf(tx, order, factory.id);
      const availability = await this.capacity.nextAvailable(
        factory.id,
        order.productTypeId,
        load,
        new Date(),
        tx,
      );
      if (!availability.available)
        return availability.reason === 'capacity_not_configured'
          ? 'capacity_not_configured'
          : 'capacity_full';
    }
    return null;
  }

  /** CS starts production as a documented exception (D-073): paid, factory producing; reason audited. */
  async releaseManually(actor: UserActor, orderPublicId: string, reason: string) {
    return this.prisma.withTx(async (tx) => {
      const found = await tx.order.findUnique({ where: { publicId: orderPublicId } });
      if (!found) throw new DomainException('http.not_found');
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${found.id} FOR UPDATE`;
      const order = await this.loadOrder(tx, found.id);
      if (
        order.productionStartedAt ||
        (await tx.productionJob.count({ where: { orderId: order.id, jobKind: 'production', ...LIVE_JOB } })) >
          0
      )
        throw new DomainException('production.already_released');
      if (!order.paidForProductionAt)
        throw new DomainException('production.gate_closed', { params: { reason: 'not_paid' } });
      const block = await this.factoryBlock(tx, order, false);
      if (block) throw new DomainException('production.gate_closed', { params: { reason: block } });
      const job = await this.release(tx, order, 'production', 'manual_exception', reason, actor);
      await this.audit.record(tx, {
        category: 'finance',
        action: 'production.manual_start',
        resourceType: 'production_job',
        resourcePublicId: job.publicId,
        data: { orderId: order.publicId, reason, artworkApproved: order.artworkApprovedAt !== null },
      });
      return job;
    });
  }

  /** A paid mockup (D-072) goes to the order's factory as its own job. */
  @OnDomainEvent('instalment.paid', { consumer: 'production.mockups' })
  async onInstalmentPaid(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const instalmentId = event.payload['instalmentId'];
    if (typeof instalmentId !== 'string' || event.payload['fixedAmount'] !== true) return;
    const instalment = await tx.instalment.findUnique({
      where: { publicId: instalmentId },
      include: { orderLine: true },
    });
    const line = instalment?.orderLine;
    if (!line || line.lineType !== 'mockup') return;
    if (
      (await tx.productionJob.count({ where: { orderId: line.orderId, jobKind: 'mockup', ...LIVE_JOB } })) > 0
    )
      return;
    const order = await this.loadOrder(tx, line.orderId);
    const actor = systemActor('production.mockups');
    const block = await this.factoryBlock(tx, order, false);
    if (block) {
      await this.recordBlocked(tx, order.publicId, block, actor, 'mockup');
      return;
    }
    await this.release(tx, order, 'mockup', 'auto', null, actor, { orderLineId: line.id });
  }

  // --- release --------------------------------------------------------------------------------------

  async release(
    tx: Tx,
    order: OrderForRelease,
    kind: JobKind,
    mode: ProductionStartMode,
    reason: string | null,
    actor: Actor,
    extra: {
      orderLineId?: bigint;
      reproductionOfJobId?: bigint;
      claimId?: bigint;
      factoryId?: bigint;
      quantity?: number;
      buyPrice?: Record<string, unknown>;
    } = {},
  ) {
    const factoryId = extra.factoryId ?? order.selectedFactoryId!;
    const factory = await tx.factory.findUniqueOrThrow({
      where: { id: factoryId },
      include: { calendar: true },
    });
    const calendar = await this.calendars.calendar(factory.calendar?.code);
    const at = new Date();
    const slaDays = (await this.settings.at('production.factory_acceptance_sla_business_days', {
      at,
      tx,
    })) as { value: number; versionId: bigint };
    const route = await this.resolveRoute(tx, order, kind === 'mockup' ? 'mockup' : 'standard');
    if (!route) throw new DomainException('production.gate_closed', { params: { reason: 'no_route' } });
    const quantity = extra.quantity ?? (kind === 'mockup' ? 1 : order.quantityOrdered);
    const plannedStart = calendar.isWorkingDay(bangkokDate(at))
      ? bangkokDate(at)
      : calendar.nextWorkingDay(bangkokDate(at));
    const promised = order.promisedShipDate ? order.promisedShipDate.toISOString().slice(0, 10) : null;
    const plannedFinish =
      promised && promised >= plannedStart
        ? promised
        : bangkokDate(
            calendar.addWorkingDays(startOfBangkokDay(plannedStart), Math.max(order.leadTimeDays ?? 1, 1)),
          );
    const proof = order.proofs[0] ?? null;
    const internal = (order.quoteOption.internalBreakdown ?? {}) as Record<string, unknown>;
    const job = await tx.productionJob.create({
      data: {
        jobNo: await this.numbering.next(tx, 'job', at, order.entityId),
        entityId: order.entityId,
        orderId: order.id,
        factoryId,
        jobKind: kind,
        reproductionOfJobId: extra.reproductionOfJobId ?? null,
        claimId: extra.claimId ?? null,
        orderLineId: extra.orderLineId ?? null,
        releasedAt: at,
        releaseMode: mode,
        releaseReason: reason,
        releasedById: actor.type === 'user' ? actor.userId : null,
        acceptDueAt: calendar.addWorkingDays(at, slaDays.value),
        plannedStartOn: new Date(plannedStart),
        plannedFinishOn: new Date(plannedFinish),
        promisedShipDate: order.promisedShipDate,
        quantityOrdered: quantity,
        specSnapshot: {
          schemaVersion: 1,
          productTypeCode: order.productType.code,
          productTypeNameTh: order.productType.nameTh,
          configuration: ((order.quote.input ?? {}) as { configuration?: unknown }).configuration ?? null,
          quantity,
          unit: kind === 'mockup' ? 'set' : order.unit,
          designOption: order.designOption,
          mockupOption: kind === 'mockup' ? order.mockupOption : null,
          approvedProofId: proof?.publicId ?? null,
          approvedFileId: proof?.approvedFile?.publicId ?? null,
          dielineFileId: proof?.dielineFile?.publicId ?? null,
        },
        routeVersionId: route.versionId,
        routeSnapshot: route.snapshot as unknown as Prisma.InputJsonValue,
        priceListVersionId: extra.factoryId ? null : order.quoteOption.priceListVersionId,
        buyPriceSnapshot: (extra.buyPrice ??
          (kind === 'mockup'
            ? {
                priced: false,
                note: 'mockup priced by CS (D-072); factory price arranged by the Partner team',
              }
            : {
                priced: order.buyCostNet !== null,
                buyCostNet: order.buyCostNet?.toFixed(2) ?? null,
                factoryId: internal['factoryId'] ?? null,
                printTypeId: internal['printTypeId'] ?? null,
                parts: internal['parts'] ?? [],
                shipping: internal['shipping'] ?? null,
                settingVersionIds: {
                  'production.factory_acceptance_sla_business_days': String(slaDays.versionId),
                },
              })) as Prisma.InputJsonValue,
        toleranceShortagePct: order.toleranceShortagePct,
        toleranceOveragePct: order.toleranceOveragePct,
      },
    });
    await this.createMilestones(
      tx,
      job.id,
      factoryId,
      route.snapshot,
      startOfBangkokDay(plannedStart),
      startOfBangkokDay(addCalendarDays(plannedFinish, 1)),
    );
    await tx.jobAssignment.create({
      data: {
        jobId: job.id,
        toFactoryId: factoryId,
        reason: 'initial',
        mode: mode === 'auto' ? 'auto' : 'manual',
        decidedById: actor.type === 'user' ? actor.userId : null,
        decidedAt: at,
      },
    });
    if (kind === 'production')
      await this.orders.applyFact(tx, order.id, { kind: 'production_started', mode }, actor, at);
    const customer = await tx.user.findUniqueOrThrow({
      where: { id: order.customerUserId },
      select: { publicId: true },
    });
    await this.record(
      tx,
      job.id,
      'production_job.released',
      { kind, mode, reason, buyCostNet: order.buyCostNet?.toFixed(2) ?? null },
      actor,
    );
    // The customer hears that the order is queued (no factory identity, D-050).
    const event = await this.events.record(
      tx,
      {
        type: 'production.queued',
        aggregateType: 'order',
        aggregateId: order.publicId,
        payload: { orderId: order.publicId, customerId: customer.publicId, kind },
      },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'order',
      aggregatePublicId: order.publicId,
      action: 'production.queued',
      messageKey: 'activity.production.queued',
      messageParams: { kind },
      visibility: ['internal', 'customer'],
      domainEventId: event.id,
      actor,
    });
    return tx.productionJob.findUniqueOrThrow({ where: { id: job.id } });
  }

  private async createMilestones(
    tx: Tx,
    jobId: bigint,
    factoryId: bigint,
    route: RouteSnapshot,
    start: Date,
    end: Date,
  ) {
    const span = Math.max(end.getTime() - start.getTime(), 0);
    const shares = route.steps.map((s) =>
      s.plannedSharePct ? Number(s.plannedSharePct) : 100 / route.steps.length,
    );
    const total = shares.reduce((a, b) => a + b, 0) || 1;
    let cumulative = 0;
    for (const [i, s] of route.steps.entries()) {
      cumulative += shares[i]!;
      await tx.jobMilestone.create({
        data: {
          jobId,
          factoryId,
          seq: s.seq,
          stepKey: s.key,
          evidence: s.evidence,
          tracksQuantity: s.tracksQuantity,
          customerVisible: s.customerVisible,
          dueAt: new Date(start.getTime() + Math.round((span * cumulative) / total)),
        },
      });
    }
  }

  /** The route in force: (type, print type, variant), else (type, variant), else the type's standard route. */
  async resolveRoute(
    tx: Tx,
    order: OrderForRelease,
    variant: string,
  ): Promise<{ versionId: bigint; snapshot: RouteSnapshot } | null> {
    const internal = (order.quoteOption.internalBreakdown ?? {}) as { printTypeId?: string };
    const printType = internal.printTypeId
      ? await tx.printType.findUnique({ where: { publicId: internal.printTypeId } })
      : null;
    const candidates: Prisma.MilestoneRouteWhereInput[] = [
      ...(printType ? [{ productTypeId: order.productTypeId, printTypeId: printType.id, variant }] : []),
      { productTypeId: order.productTypeId, printTypeId: null, variant },
      { productTypeId: order.productTypeId, printTypeId: null, variant: 'standard' },
    ];
    const now = new Date();
    for (const where of candidates) {
      const route = await tx.milestoneRoute.findFirst({
        where,
        include: {
          versions: {
            where: { status: 'approved', effectiveFrom: { lte: now } },
            orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
            take: 1,
            include: { steps: { orderBy: { seq: 'asc' } } },
          },
        },
      });
      const version = route?.versions[0];
      if (!route || !version || version.steps.length === 0) continue;
      return {
        versionId: version.id,
        snapshot: {
          routeId: route.publicId,
          variant: route.variant,
          versionNo: version.versionNo,
          steps: version.steps.map((s) => ({
            seq: s.seq,
            key: s.key,
            nameTh: s.nameTh,
            nameEn: s.nameEn,
            customerVisible: s.customerVisible,
            customerLabelTh: s.customerLabelTh,
            customerLabelEn: s.customerLabelEn,
            evidence: s.evidence,
            tracksQuantity: s.tracksQuantity,
            plannedSharePct: s.plannedSharePct?.toFixed(4) ?? null,
          })),
        },
      };
    }
    return null;
  }

  // --- acceptance (D-074) -------------------------------------------------------------------------------

  async accept(actor: Actor, jobId: bigint) {
    return this.prisma.withTx(async (tx) => {
      const job = await this.lockJob(tx, jobId);
      if (job.status !== 'released')
        throw new DomainException('production.invalid_status', { params: { status: job.status } });
      const at = new Date();
      await tx.productionJob.update({
        where: { id: job.id },
        data: {
          status: 'accepted',
          statusChangedAt: at,
          acceptedAt: at,
          acceptedById: actor.type === 'user' ? actor.userId : null,
          updatedById: actor.type === 'user' ? actor.userId : null,
          rowVersion: { increment: 1 },
        },
      });
      // The accepted load is booked in the planned start week (D-101 capacity, read by lead-time promises).
      const order = await this.loadOrder(tx, job.orderId);
      const load =
        job.jobKind === 'mockup' ? new Prisma.Decimal(0) : await this.loadOf(tx, order, job.factoryId);
      if (load.gt(0) && !(await tx.capacityBooking.findUnique({ where: { productionJobId: job.id } }))) {
        const day = (job.plannedStartOn ?? at).toISOString().slice(0, 10);
        const weekStart = mondayOfDay(day);
        await tx.capacityBooking.create({
          data: {
            factoryId: job.factoryId,
            productTypeId: order.productTypeId,
            weekStart: new Date(weekStart),
            productionJobId: job.id,
            load,
          },
        });
      }
      await this.record(tx, job.id, 'production_job.accepted', { onTime: at <= job.acceptDueAt }, actor);
      return tx.productionJob.findUniqueOrThrow({ where: { id: job.id } });
    });
  }

  async reject(actor: Actor, jobId: bigint, reasonCode: string, note: string | null) {
    return this.prisma.withTx(async (tx) => {
      const job = await this.lockJob(tx, jobId);
      if (job.status !== 'released')
        throw new DomainException('production.invalid_status', { params: { status: job.status } });
      const at = new Date();
      await tx.productionJob.update({
        where: { id: job.id },
        data: {
          status: 'rejected',
          statusChangedAt: at,
          rejectedAt: at,
          rejectedById: actor.type === 'user' ? actor.userId : null,
          rejectReasonCode: reasonCode,
          rejectNote: note,
          updatedById: actor.type === 'user' ? actor.userId : null,
          rowVersion: { increment: 1 },
        },
      });
      await tx.jobMilestone.updateMany({
        where: { jobId: job.id, status: 'pending' },
        data: { status: 'skipped' },
      });
      await this.record(tx, job.id, 'production_job.rejected', { reasonCode, note }, actor);
      await this.moveOrEscalate(tx, job.id, 'rejected', systemActor('production.reassign'));
      return tx.productionJob.findUniqueOrThrow({ where: { id: job.id } });
    });
  }

  /** Released jobs past their acceptance deadline: alert and move or escalate, once (D-074). */
  @ScheduledJob({ name: 'production.acceptance_overdue', every: 10 * 60_000 })
  async acceptanceOverdue(now = new Date()): Promise<number> {
    const overdue = await this.prisma.productionJob.findMany({
      where: { status: 'released', acceptDueAt: { lt: now }, escalatedAt: null },
      select: { id: true },
      take: 200,
    });
    for (const { id } of overdue) {
      await this.prisma.withTx(async (tx) => {
        const job = await this.lockJob(tx, id);
        if (job.status !== 'released' || job.escalatedAt) return;
        await tx.productionJob.update({
          where: { id },
          data: { escalatedAt: now, rowVersion: { increment: 1 } },
        });
        await this.record(
          tx,
          id,
          'production_job.acceptance_overdue',
          { acceptDueAt: job.acceptDueAt.toISOString() },
          systemActor('production.acceptance_overdue'),
        );
        await this.moveOrEscalate(tx, id, 'acceptance_overdue', systemActor('production.acceptance_overdue'));
      });
    }
    return overdue.length;
  }

  /**
   * D-012 with D-101: move the job only when enough active factories serve the product type and one of the
   * others keeps the margin floor on the order's unchanged customer price; otherwise escalate.
   */
  private async moveOrEscalate(tx: Tx, jobId: bigint, reason: AssignmentReason, actor: Actor): Promise<void> {
    const job = await tx.productionJob.findUniqueOrThrow({ where: { id: jobId } });
    const order = await this.loadOrder(tx, job.orderId);
    const minFactories = (await this.settings.at('partners.auto_selection_min_factories', { tx })).value;
    const serving = await this.servingFactories(tx, order.productTypeId);
    const tried = (await tx.jobAssignment.findMany({ where: { job: { orderId: order.id } } })).flatMap(
      (a) => [a.fromFactoryId, a.toFactoryId],
    );
    let best: { factoryId: bigint; marginPct: MoneyValue; buyCostNet: MoneyValue } | null = null;
    if (serving.length >= minFactories && job.jobKind !== 'mockup') {
      const floor = D((await this.settings.at('pricing.margin_floor_pct', { tx })).value);
      for (const candidate of serving.filter((f) => !tried.includes(f.id))) {
        const priced = await this.marginAt(tx, order, candidate).catch(() => null);
        if (priced && priced.marginPct.gte(floor) && (!best || priced.marginPct.gt(best.marginPct)))
          best = { factoryId: candidate.id, ...priced };
      }
    }
    if (best && reason === 'rejected') {
      const moved = await this.release(tx, order, job.jobKind, 'auto', null, actor, {
        factoryId: best.factoryId,
        orderLineId: job.orderLineId ?? undefined,
        buyPrice: { priced: true, buyCostNet: formatMoney(best.buyCostNet), reassignedFrom: job.publicId },
      });
      await tx.jobAssignment.create({
        data: {
          jobId: moved.id,
          fromFactoryId: job.factoryId,
          toFactoryId: best.factoryId,
          reason,
          marginAfterPct: best.marginPct.toFixed(4),
          mode: 'auto',
        },
      });
      await this.record(
        tx,
        moved.id,
        'production_job.reassigned',
        { fromJobId: job.publicId, reason, marginAfterPct: best.marginPct.toFixed(4) },
        actor,
      );
      return;
    }
    if (best && reason === 'acceptance_overdue') {
      // The overdue job is withdrawn from the silent factory before the order moves.
      await tx.productionJob.update({
        where: { id: job.id },
        data: {
          status: 'cancelled',
          statusChangedAt: new Date(),
          cancelReason: 'reassigned: acceptance overdue (D-074)',
          rowVersion: { increment: 1 },
        },
      });
      await tx.jobMilestone.updateMany({
        where: { jobId: job.id, status: 'pending' },
        data: { status: 'skipped' },
      });
      const moved = await this.release(tx, order, job.jobKind, 'auto', null, actor, {
        factoryId: best.factoryId,
        orderLineId: job.orderLineId ?? undefined,
        buyPrice: { priced: true, buyCostNet: formatMoney(best.buyCostNet), reassignedFrom: job.publicId },
      });
      await tx.jobAssignment.create({
        data: {
          jobId: moved.id,
          fromFactoryId: job.factoryId,
          toFactoryId: best.factoryId,
          reason,
          marginAfterPct: best.marginPct.toFixed(4),
          mode: 'auto',
        },
      });
      await this.record(
        tx,
        moved.id,
        'production_job.reassigned',
        { fromJobId: job.publicId, reason, marginAfterPct: best.marginPct.toFixed(4) },
        actor,
      );
      return;
    }
    await tx.jobAssignment.create({
      data: {
        jobId: job.id,
        fromFactoryId: job.factoryId,
        toFactoryId: null,
        reason,
        mode: 'escalated',
        note:
          serving.length < minFactories
            ? `only ${serving.length} active factory serves the type (D-101)`
            : 'no factory keeps the margin floor (D-012)',
      },
    });
    if (!job.escalatedAt)
      await tx.productionJob.update({
        where: { id: job.id },
        data: { escalatedAt: new Date(), rowVersion: { increment: 1 } },
      });
    await this.record(
      tx,
      job.id,
      'production_job.escalated',
      { reason, servingFactories: serving.length },
      actor,
    );
  }

  /** Staff move a job to another factory (D-012): at that factory's own price, never below the floor. */
  async reassign(actor: UserActor, jobPublicId: string, factoryPublicId: string, note: string) {
    return this.prisma.withTx(async (tx) => {
      const found = await tx.productionJob.findUnique({ where: { publicId: jobPublicId } });
      if (!found) throw new DomainException('http.not_found');
      const job = await this.lockJob(tx, found.id);
      if (!['released', 'rejected'].includes(job.status))
        throw new DomainException('production.invalid_status', { params: { status: job.status } });
      const target = await tx.factory.findUnique({ where: { publicId: factoryPublicId } });
      if (!target || target.id === job.factoryId || !PRODUCING.includes(target.status))
        throw new DomainException('production.factory_unavailable');
      const order = await this.loadOrder(tx, job.orderId);
      const priced = await this.marginAt(tx, order, target);
      if (!priced) throw new DomainException('production.no_price_path');
      const floor = D((await this.settings.at('pricing.margin_floor_pct', { tx })).value);
      if (priced.marginPct.lt(floor))
        throw new DomainException('production.below_margin_floor', { params: { floor: floor.toFixed(2) } });
      if (job.status === 'released') {
        await tx.productionJob.update({
          where: { id: job.id },
          data: {
            status: 'cancelled',
            statusChangedAt: new Date(),
            cancelReason: `reassigned by staff: ${note}`,
            rowVersion: { increment: 1 },
          },
        });
        await tx.jobMilestone.updateMany({
          where: { jobId: job.id, status: 'pending' },
          data: { status: 'skipped' },
        });
      }
      const moved = await this.release(tx, order, job.jobKind, 'auto', null, actor, {
        factoryId: target.id,
        orderLineId: job.orderLineId ?? undefined,
        buyPrice: { priced: true, buyCostNet: formatMoney(priced.buyCostNet), reassignedFrom: job.publicId },
      });
      await tx.jobAssignment.create({
        data: {
          jobId: moved.id,
          fromFactoryId: job.factoryId,
          toFactoryId: target.id,
          reason: 'manual',
          marginAfterPct: priced.marginPct.toFixed(4),
          mode: 'manual',
          note,
          decidedById: actor.userId,
        },
      });
      await this.record(
        tx,
        moved.id,
        'production_job.reassigned',
        { fromJobId: job.publicId, reason: 'manual', marginAfterPct: priced.marginPct.toFixed(4) },
        actor,
      );
      await this.audit.record(tx, {
        category: 'finance',
        action: 'production.reassigned',
        resourceType: 'production_job',
        resourcePublicId: moved.publicId,
        data: { from: job.publicId, note },
      });
      return moved;
    });
  }

  // --- helpers ------------------------------------------------------------------------------------------

  /** Active factories with an approved participation for the product type (D-101, schema-design §2.4). */
  async servingFactories(tx: Tx, productTypeId: bigint) {
    const now = new Date();
    return tx.factory.findMany({
      where: {
        status: 'active',
        participations: {
          some: { productTypeId, versions: { some: { status: 'approved', effectiveFrom: { lte: now } } } },
        },
      },
      select: { id: true, publicId: true },
    });
  }

  /** The order's margin at another factory's buy price (folding calculator), customer price unchanged. */
  private async marginAt(tx: Tx, order: OrderForRelease, factory: { id: bigint; publicId: string }) {
    const cfg = ((order.quote.input ?? {}) as { configuration?: Record<string, unknown> }).configuration;
    if (!cfg || order.productType.code !== 'folding_carton') return null;
    const view = await this.quotes.priceFoldingForFactory(
      { ...cfg, quantities: [order.quantityOrdered] } as never,
      factory,
    );
    const prices = view.options.flatMap((o) => o.steps.flatMap((s) => (s?.buyPrice ? [D(s.buyPrice)] : [])));
    if (prices.length === 0) return null;
    const internal = (order.quoteOption.internalBreakdown ?? {}) as {
      shipping?: { costAmount?: string } | null;
    };
    const buyCostNet = MoneyDecimal.min(...prices).add(internal.shipping?.costAmount ?? '0');
    const payable = D(order.netAmount).sub(order.discountAmount);
    if (payable.lte(0)) return null;
    return { buyCostNet, marginPct: payable.sub(buyCostNet).div(payable).mul(100) };
  }

  /** Capacity load of the order in the factory's unit (pieces, sheets, jobs); sqm is not derivable yet. */
  private async loadOf(tx: Tx, order: OrderForRelease, factoryId: bigint): Promise<Prisma.Decimal> {
    const version = await tx.factoryCapacityVersion.findFirst({
      where: { capacity: { factoryId, productTypeId: order.productTypeId }, status: 'approved' },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
    });
    const internal = (order.quoteOption.internalBreakdown ?? {}) as { parts?: { sheets?: number }[] };
    switch (version?.capacityUnit) {
      case 'sheets':
        return new Prisma.Decimal((internal.parts ?? []).reduce((a, p) => a + (p.sheets ?? 0), 0) || 1);
      case 'jobs':
        return new Prisma.Decimal(1);
      case 'pieces':
        return new Prisma.Decimal(order.quantityOrdered);
      default:
        return new Prisma.Decimal(1);
    }
  }

  /**
   * Re-production for an approved claim (P24, B4.5): a new job on the same order, by the liable factory at
   * zero buy price when it is liable, otherwise at the original job's price. Staff decision → manual release
   * with the claim as the reason.
   */
  async releaseReproduction(
    tx: Tx,
    input: { originalJobId: bigint; claimId: bigint; claimNo: string; quantity: number; factoryLiable: boolean },
    actor: UserActor,
  ) {
    const original = await tx.productionJob.findUniqueOrThrow({ where: { id: input.originalJobId } });
    const order = await this.loadOrder(tx, original.orderId);
    const buyPrice = input.factoryLiable
      ? { priced: true, buyCostNet: '0.00', basis: 'P24 re-production by the liable factory', claimNo: input.claimNo }
      : (original.buyPriceSnapshot as Record<string, unknown>);
    return this.release(tx, order, 'reproduction', 'manual_exception', `claim ${input.claimNo}`, actor, {
      reproductionOfJobId: original.id,
      claimId: input.claimId,
      factoryId: original.factoryId,
      quantity: input.quantity,
      buyPrice,
    });
  }

  private async loadOrder(tx: Tx, orderId: bigint): Promise<OrderForRelease> {
    return tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        quote: true,
        quoteOption: true,
        productType: true,
        selectedFactory: { include: { calendar: true } },
        proofs: { where: { status: 'approved' }, include: { approvedFile: true, dielineFile: true } },
      },
    });
  }

  async lockJob(tx: Tx, jobId: bigint) {
    await tx.$queryRaw`SELECT id FROM production_jobs WHERE id = ${jobId} FOR UPDATE`;
    return tx.productionJob.findUniqueOrThrow({ where: { id: jobId } });
  }

  /** One `production.release_blocked` per order and reason in a row (the latest reason is what staff see). */
  private async recordBlocked(
    tx: Tx,
    orderPublicId: string,
    reason: BlockReason,
    actor: Actor,
    kind: JobKind = 'production',
  ) {
    const last = await tx.activityLog.findFirst({
      where: {
        aggregateType: 'order',
        aggregatePublicId: orderPublicId,
        action: 'production.release_blocked',
      },
      orderBy: { occurredAt: 'desc' },
    });
    if (
      (last?.data as { reason?: string; kind?: string } | undefined)?.reason === reason &&
      (last?.data as { kind?: string }).kind === kind
    )
      return;
    const event = await this.events.record(
      tx,
      {
        type: 'production.release_blocked',
        aggregateType: 'order',
        aggregateId: orderPublicId,
        payload: { orderId: orderPublicId, reason, kind },
      },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'order',
      aggregatePublicId: orderPublicId,
      action: 'production.release_blocked',
      messageKey: 'activity.production.release_blocked',
      messageParams: { reason },
      visibility: ['internal'],
      domainEventId: event.id,
      data: { reason, kind },
      actor,
    });
  }

  /**
   * Event + activity on the job (visible to the factory and staff). The factory's public id is in the payload
   * so the notification matrix reaches its users (D-143).
   */
  async record(
    tx: Tx,
    jobId: bigint,
    type: string,
    data: Record<string, unknown>,
    actor: Actor,
    visibility: ('internal' | 'partner')[] = ['internal', 'partner'],
  ) {
    const job = await tx.productionJob.findUniqueOrThrow({
      where: { id: jobId },
      include: { factory: true, order: true },
    });
    const event = await this.events.record(
      tx,
      {
        type,
        aggregateType: 'production_job',
        aggregateId: job.publicId,
        entityId: job.entityId,
        payload: {
          jobId: job.publicId,
          jobNo: job.jobNo,
          orderId: job.order.publicId,
          factoryId: job.factory.publicId,
          ...data,
        },
      },
      actor,
    );
    const { buyCostNet: _cost, ...visible } = data;
    await this.activity.record(tx, {
      aggregateType: 'production_job',
      aggregatePublicId: job.publicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: visible,
      visibility,
      entityId: job.entityId,
      domainEventId: event.id,
      actor,
    });
  }
}

/** Monday (ISO week start) of a Bangkok date. */
function mondayOfDay(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addCalendarDays(day, dow === 0 ? -6 : 1 - dow);
}
