import { randomInt } from 'node:crypto';

import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { addCalendarDays, bangkokDate, startOfBangkokDay, startOfBangkokMonth } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';
import { SettingsService } from '@platform/settings/settings.service';

import { ProductionService } from './production.service';
import { inspectionRate, plan } from './sampling';

/** Finishes that raise the inspection rate (D-076: foil, emboss, window). */
const SPECIAL_FINISHES: readonly string[] = ['foil', 'emboss', 'deboss', 'window'];
const pct = (num: number, den: number) => (den === 0 ? null : ((num * 100) / den).toFixed(4));

/**
 * Oversight of production (D-076, D-155, B4.2): the Packio inspection plan decided at release from the
 * risk-based sampling setting and ISO 2859-1 (tasks for Packio staff, results pass / fail on the acceptance
 * numbers); the SLA engine (predicted finish vs the promised date, at-risk alerts, a daily digest per
 * factory); the monthly factory scorecard (on-time acceptance, on-time shipping, QC first pass, claim rate,
 * on-time updates), visible to the factory.
 */
@Injectable()
export class ProductionOversightService {
  private readonly logger = new Logger(ProductionOversightService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly production: ProductionService,
    private readonly events: DomainEvents,
  ) {}

  // --- inspection plan (D-076) ------------------------------------------------------------------------

  @OnDomainEvent('production_job.released', { consumer: 'production.inspection_plan' })
  async onReleased(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const job = await tx.productionJob.findUnique({
      where: { publicId: event.aggregateId },
      include: { order: { include: { productType: true, quote: true } }, inspections: true },
    });
    if (!job || job.jobKind === 'mockup' || job.inspections.length > 0) return;
    const rules = await this.settings.at('qc.inspection_sampling', { at: job.releasedAt, tx });
    const priorJobs = await tx.productionJob.count({
      where: {
        factoryId: job.factoryId,
        id: { lt: job.id },
        status: { notIn: ['rejected', 'cancelled'] },
        jobKind: { not: 'mockup' },
      },
    });
    const facts = {
      orderValue: Number(job.order.grossAmount),
      priorFactoryJobs: priorJobs,
      factoryDefectRatePct: await this.defectRate(
        tx,
        job.factoryId,
        rules.value.highDefectWindowDays,
        job.releasedAt,
      ),
      specialFinishOrFood:
        job.order.productType.isFoodContactDefault ||
        (await this.hasSpecialFinish(tx, job.order.quote.input)),
    };
    const { ratePct, reasons } = inspectionRate(facts, rules.value);
    if (reasons.length === 0 || ratePct <= 0) return;
    const selected = ratePct >= 100 || randomInt(0, 10_000) < ratePct * 100;
    const lot = job.quantityOrdered;
    const critical = plan(lot, rules.value.aql.critical);
    const major = plan(lot, rules.value.aql.major);
    const minor = plan(lot, rules.value.aql.minor);
    const inspection = await tx.inspection.create({
      data: {
        jobId: job.id,
        reasons: reasons,
        samplingRefs: {
          settingVersionIds: { 'qc.inspection_sampling': String(rules.versionId) },
          standard: 'ISO 2859-1:1999 normal, single, level II',
          facts,
          plans: { critical, major, minor },
        } as unknown as Prisma.InputJsonValue,
        ratePct: ratePct.toFixed(4),
        selected,
        lotSize: lot,
        sampleSize: Math.max(critical.sampleSize, major.sampleSize, minor.sampleSize),
        aqlCritical: rules.value.aql.critical,
        aqlMajor: rules.value.aql.major,
        aqlMinor: rules.value.aql.minor,
        acceptCritical: critical.accept,
        acceptMajor: major.accept,
        acceptMinor: minor.accept,
        status: selected ? 'planned' : 'waived',
        notes: selected ? null : `not drawn at ${ratePct} % (D-076)`,
      },
    });
    if (selected)
      await tx.productionJob.update({
        where: { id: job.id },
        data: { inspectionRequired: true, inspectionReasons: reasons, rowVersion: { increment: 1 } },
      });
    await this.production.record(
      tx,
      job.id,
      'production_job.inspection_planned',
      { inspectionId: inspection.publicId, selected, ratePct, reasons },
      systemActor('production.inspection_plan'),
      ['internal'],
    );
  }

  /** Jobs of the factory completed in the window whose first QC failed, over all completed (claims: B4.5). */
  async defectRate(tx: Tx, factoryId: bigint, windowDays: number, at: Date): Promise<number> {
    const since = new Date(at.getTime() - windowDays * 86_400_000);
    const done = await tx.productionJob.findMany({
      where: { factoryId, status: 'completed', actualFinishAt: { gte: since, lte: at } },
      select: { id: true, qcChecks: { orderBy: { performedAt: 'asc' }, take: 1, select: { result: true } } },
    });
    if (done.length === 0) return 0;
    const defective =
      done.filter((j) => j.qcChecks[0]?.result === 'fail').length +
      (await this.factoryClaims(
        tx,
        done.map((j) => j.id),
      ));
    return (defective * 100) / done.length;
  }

  /** Jobs with an approved (or since resolved / closed) claim the factory is liable for (D-083, D-155). */
  async factoryClaims(tx: Tx, jobIds: bigint[]): Promise<number> {
    if (jobIds.length === 0) return 0;
    const claimed = await tx.claim.findMany({
      where: {
        productionJobId: { in: jobIds },
        liability: 'factory',
        // Approved, or resolved since (a rejected claim is closed without being resolved).
        OR: [{ status: 'approved' }, { resolvedAt: { not: null } }],
      },
      distinct: ['productionJobId'],
      select: { productionJobId: true },
    });
    return claimed.length;
  }

  private async hasSpecialFinish(tx: Tx, input: unknown): Promise<boolean> {
    const parts =
      (input as { configuration?: { parts?: Record<string, unknown>[] } } | null)?.configuration?.parts ?? [];
    const ids = parts.flatMap((p) =>
      Object.entries(p)
        .filter(([k, v]) => /^finish/i.test(k) && typeof v === 'string')
        .map(([, v]) => v as string),
    );
    if (ids.length === 0) return false;
    const finishes = await tx.finish.findMany({
      where: { publicId: { in: ids } },
      select: { finishKind: true },
    });
    return finishes.some((f) => SPECIAL_FINISHES.includes(f.finishKind));
  }

  // --- inspections (Packio staff) ----------------------------------------------------------------------

  async listInspections(where: Prisma.InspectionWhereInput, page: number, perPage: number) {
    const include = {
      job: {
        select: {
          publicId: true,
          jobNo: true,
          factory: { select: { code: true } },
          order: { select: { publicId: true, orderCode: true, productType: { select: { code: true } } } },
        },
      },
      inspector: { select: { publicId: true, displayName: true } },
    } as const;
    return Promise.all([
      this.prisma.inspection.findMany({
        where,
        include,
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.inspection.count({ where }),
    ]);
  }

  async schedule(actor: UserActor, publicId: string, input: { inspectorUserId?: string; scheduledAt: Date }) {
    return this.prisma.withTx(async (tx) => {
      const inspection = await tx.inspection.findUnique({ where: { publicId } });
      if (!inspection) throw new DomainException('http.not_found');
      if (!['planned', 'in_progress'].includes(inspection.status))
        throw new DomainException('production.invalid_status', { params: { status: inspection.status } });
      const inspector = input.inspectorUserId
        ? await tx.user.findFirst({
            where: { publicId: input.inspectorUserId, kind: 'staff', status: 'active' },
          })
        : null;
      if (input.inspectorUserId && !inspector) throw new DomainException('http.not_found');
      await tx.inspection.update({
        where: { id: inspection.id },
        data: {
          inspectorUserId: inspector?.id ?? actor.userId,
          scheduledAt: input.scheduledAt,
          rowVersion: { increment: 1 },
        },
      });
      await this.production.record(
        tx,
        inspection.jobId,
        'production_job.inspection_scheduled',
        { inspectionId: inspection.publicId, scheduledAt: input.scheduledAt.toISOString() },
        actor,
      );
      return tx.inspection.findUniqueOrThrow({ where: { id: inspection.id } });
    });
  }

  /** Records what the sample found: passed when every class is within its acceptance number (ISO 2859-1). */
  async recordResult(
    actor: UserActor,
    publicId: string,
    input: {
      foundCritical: number;
      foundMajor: number;
      foundMinor: number;
      notes?: string;
      photoFileIds?: string[];
    },
  ) {
    return this.prisma.withTx(async (tx) => {
      const inspection = await tx.inspection.findUnique({ where: { publicId } });
      if (!inspection) throw new DomainException('http.not_found');
      if (!['planned', 'in_progress'].includes(inspection.status))
        throw new DomainException('production.invalid_status', { params: { status: inspection.status } });
      const passed =
        input.foundCritical <= inspection.acceptCritical &&
        input.foundMajor <= inspection.acceptMajor &&
        input.foundMinor <= inspection.acceptMinor;
      const files = input.photoFileIds?.length
        ? await tx.fileObject.findMany({
            where: { publicId: { in: input.photoFileIds }, createdById: actor.userId },
          })
        : [];
      if (files.length !== (input.photoFileIds?.length ?? 0))
        throw new DomainException('artwork.file_not_usable', {
          params: { fileId: (input.photoFileIds ?? []).join(', ') },
        });
      for (const [sort, f] of files.entries())
        await tx.attachment.create({
          data: {
            fileObjectId: f.id,
            subjectType: 'inspection',
            subjectId: inspection.id,
            role: 'inspection.photo',
            sort,
          },
        });
      await tx.inspection.update({
        where: { id: inspection.id },
        data: {
          status: passed ? 'passed' : 'failed',
          foundCritical: input.foundCritical,
          foundMajor: input.foundMajor,
          foundMinor: input.foundMinor,
          notes: input.notes ?? inspection.notes,
          inspectorUserId: inspection.inspectorUserId ?? actor.userId,
          resultAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
      await this.production.record(
        tx,
        inspection.jobId,
        passed ? 'production_job.inspection_passed' : 'production_job.inspection_failed',
        { inspectionId: inspection.publicId, ...input, photoFileIds: undefined },
        actor,
      );
      if (!passed) {
        // A failed inspection stops the job until staff decide (rework, claim with the factory…).
        const job = await tx.productionJob.findUniqueOrThrow({ where: { id: inspection.jobId } });
        if (['accepted', 'in_progress', 'completed'].includes(job.status))
          await tx.productionJob.update({
            where: { id: job.id },
            data: {
              status: 'on_hold',
              statusChangedAt: new Date(),
              holdReason: 'Packio inspection failed (D-076)',
              rowVersion: { increment: 1 },
            },
          });
      }
      return tx.inspection.findUniqueOrThrow({ where: { id: inspection.id } });
    });
  }

  // --- SLA engine -----------------------------------------------------------------------------------

  /**
   * Predicted finish = planned finish + the delay of the step now due (how far past its due time the first
   * unfinished step is). Later than the promised ship date → at risk (event once, cleared when back on track).
   */
  @ScheduledJob({ name: 'production.sla', every: 30 * 60_000 })
  async evaluateSla(now = new Date()): Promise<number> {
    const jobs = await this.prisma.productionJob.findMany({
      where: { status: { in: ['accepted', 'in_progress', 'on_hold'] } },
      include: { milestones: { orderBy: { seq: 'asc' } } },
      take: 2000,
    });
    let changed = 0;
    for (const job of jobs) {
      const next = job.milestones.find((m) => m.status !== 'completed' && m.status !== 'skipped');
      const delayDays =
        next?.dueAt && next.dueAt < now ? Math.ceil((now.getTime() - next.dueAt.getTime()) / 86_400_000) : 0;
      const plannedFinish = job.plannedFinishOn ? job.plannedFinishOn.toISOString().slice(0, 10) : null;
      if (!plannedFinish) continue;
      const predicted = addCalendarDays(plannedFinish, delayDays);
      const promised = job.promisedShipDate?.toISOString().slice(0, 10) ?? plannedFinish;
      const atRisk = predicted > promised;
      const predictedChanged = job.predictedFinishOn?.toISOString().slice(0, 10) !== predicted;
      if (!predictedChanged && atRisk === (job.atRiskSince !== null)) continue;
      await this.prisma.withTx(async (tx) => {
        await tx.productionJob.update({
          where: { id: job.id },
          data: {
            predictedFinishOn: new Date(predicted),
            atRiskSince: atRisk ? (job.atRiskSince ?? now) : null,
            rowVersion: { increment: 1 },
          },
        });
        if (atRisk && !job.atRiskSince)
          await this.production.record(
            tx,
            job.id,
            'production_job.at_risk',
            { predictedFinishOn: predicted, promisedShipDate: promised, stepKey: next?.stepKey ?? null },
            systemActor('production.sla'),
          );
        if (!atRisk && job.atRiskSince)
          await this.production.record(
            tx,
            job.id,
            'production_job.back_on_track',
            { predictedFinishOn: predicted },
            systemActor('production.sla'),
          );
      });
      changed++;
    }
    return changed;
  }

  /** One morning digest per factory with work to report (partner push, LINE, e-mail via the matrix, D-143). */
  @ScheduledJob({ name: 'production.daily_digest', cron: '0 8 * * *' })
  async dailyDigest(now = new Date()): Promise<number> {
    const today = bangkokDate(now);
    const end = startOfBangkokDay(addCalendarDays(today, 1));
    const factories = await this.prisma.factory.findMany({
      where: { status: { in: ['trial', 'active'] } },
      select: { id: true, publicId: true },
    });
    let sent = 0;
    for (const f of factories) {
      const [awaitingAcceptance, dueToday, overdueSteps, atRisk] = await Promise.all([
        this.prisma.productionJob.count({ where: { factoryId: f.id, status: 'released' } }),
        this.prisma.jobMilestone.count({
          where: {
            factoryId: f.id,
            status: { in: ['pending', 'in_progress'] },
            dueAt: { gte: now, lt: end },
            job: { status: { in: ['accepted', 'in_progress'] } },
          },
        }),
        this.prisma.jobMilestone.count({
          where: {
            factoryId: f.id,
            status: { in: ['pending', 'in_progress'] },
            dueAt: { lt: now },
            job: { status: { in: ['accepted', 'in_progress'] } },
          },
        }),
        this.prisma.productionJob.count({
          where: {
            factoryId: f.id,
            atRiskSince: { not: null },
            status: { in: ['accepted', 'in_progress', 'on_hold'] },
          },
        }),
      ]);
      if (awaitingAcceptance + dueToday + overdueSteps + atRisk === 0) continue;
      await this.prisma.withTx((tx) =>
        this.events.record(
          tx,
          {
            type: 'factory.daily_digest',
            aggregateType: 'factory',
            aggregateId: f.publicId,
            payload: {
              factoryId: f.publicId,
              day: today,
              awaitingAcceptance,
              dueToday,
              overdueSteps,
              atRisk,
            },
          },
          systemActor('production.daily_digest'),
        ),
      );
      sent++;
    }
    return sent;
  }

  // --- scorecard (D-155) --------------------------------------------------------------------------------

  /** Last month's scorecards, early on the 1st (Bangkok). */
  @ScheduledJob({ name: 'production.scorecards', cron: '0 2 1 * *' })
  async monthlyScorecards(now = new Date()): Promise<number> {
    const month = startOfBangkokMonth(new Date(startOfBangkokMonth(now).getTime() - 86_400_000));
    const factories = await this.prisma.factory.findMany({
      where: { status: { notIn: ['applied', 'under_review'] } },
      select: { id: true },
    });
    for (const f of factories) await this.computeScorecard(f.id, month);
    return factories.length;
  }

  /** Computes (or recomputes) one factory's scorecard for the Bangkok month starting at `month`. */
  async computeScorecard(factoryId: bigint, month: Date) {
    const firstDay = bangkokDate(month);
    const from = startOfBangkokDay(firstDay);
    const to = startOfBangkokDay(nextMonth(firstDay));
    const inMonth = { gte: from, lt: to };
    const [released, completed, firstQcs, milestones, shipped] = await Promise.all([
      this.prisma.productionJob.findMany({
        where: { factoryId, releasedAt: inMonth, jobKind: { not: 'mockup' } },
        select: { acceptedAt: true, acceptDueAt: true, rejectedAt: true },
      }),
      this.prisma.productionJob.findMany({
        where: { factoryId, status: 'completed', actualFinishAt: inMonth },
        select: { id: true },
      }),
      this.prisma.$queryRaw<{ result: string }[]>`
        SELECT DISTINCT ON (q.job_id) q.result::text AS result FROM qc_checks q
         WHERE q.factory_id = ${factoryId}
           AND q.job_id IN (SELECT job_id FROM qc_checks GROUP BY job_id HAVING min(performed_at) >= ${from} AND min(performed_at) < ${to})
         ORDER BY q.job_id, q.performed_at`,
      this.prisma.jobMilestone.findMany({
        where: { factoryId, completedAt: inMonth, dueAt: { not: null } },
        select: { onTime: true },
      }),
      // On-time shipping (B4.3): the job's first pickup against its promised ship date.
      this.prisma.$queryRaw<{ first_pickup: Date; promised_ship_date: Date | null }[]>`
        SELECT min(s.picked_up_at) AS first_pickup, j.promised_ship_date
          FROM shipment_items i
          JOIN shipments s ON s.id = i.shipment_id
          JOIN production_jobs j ON j.id = i.production_job_id
         WHERE j.factory_id = ${factoryId} AND s.picked_up_at IS NOT NULL AND j.job_kind <> 'mockup'
         GROUP BY j.id, j.promised_ship_date
        HAVING min(s.picked_up_at) >= ${from} AND min(s.picked_up_at) < ${to}`,
    ]);
    const responded = released.filter((j) => j.acceptedAt || j.rejectedAt);
    const onTimeAcceptance = released.filter((j) => j.acceptedAt && j.acceptedAt <= j.acceptDueAt).length;
    const shippedOnTime = shipped.filter(
      (j) =>
        j.promised_ship_date &&
        bangkokDate(j.first_pickup) <= j.promised_ship_date.toISOString().slice(0, 10),
    ).length;
    const firstPass = firstQcs.filter((q) => q.result === 'pass').length;
    const claims = await this.factoryClaims(
      this.prisma,
      completed.map((j) => j.id),
    );
    const inputs = {
      released: released.length,
      responded: responded.length,
      acceptedOnTime: onTimeAcceptance,
      completed: completed.length,
      shipped: shipped.length,
      shippedByPromise: shippedOnTime,
      firstQcChecks: firstQcs.length,
      firstPass,
      factoryClaims: claims,
      milestonesWithDue: milestones.length,
      milestonesOnTime: milestones.filter((m) => m.onTime).length,
    };
    const values = {
      onTimeAcceptancePct: pct(onTimeAcceptance, released.length),
      onTimeShippingPct: pct(shippedOnTime, shipped.length),
      qcFirstPassPct: pct(firstPass, firstQcs.length),
      claimRatePct: pct(claims, completed.length),
      onTimeUpdatesPct: pct(inputs.milestonesOnTime, milestones.length),
      jobsCount: released.length,
      inputs,
      computedAt: new Date(),
    };
    return this.prisma.factoryScorecard.upsert({
      where: { factoryId_month: { factoryId, month: new Date(firstDay) } },
      create: { factoryId, month: new Date(firstDay), ...values },
      update: values,
    });
  }

  scorecards(factoryId: bigint, limit = 12) {
    return this.prisma.factoryScorecard.findMany({
      where: { factoryId },
      orderBy: { month: 'desc' },
      take: limit,
    });
  }

  /** Staff trigger for the current or a past month (e.g. after corrections). */
  async recompute(actor: Actor, factoryId: bigint, month: string) {
    this.logger.log(`scorecard of factory ${factoryId} for ${month} recomputed by ${actor.type}`);
    return this.computeScorecard(factoryId, startOfBangkokDay(month));
  }

  /** Every factory's scorecard of one month (D-155), for allocation and the partner team. */
  monthScorecards(month: string) {
    return this.prisma.factoryScorecard.findMany({
      where: { month: new Date(`${month}-01T00:00:00Z`) },
      include: { factory: { select: { publicId: true, code: true, legalName: true, tradeName: true } } },
      orderBy: { factory: { code: 'asc' } },
    });
  }
}

function nextMonth(firstDay: string): string {
  const [y, m] = firstDay.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}
