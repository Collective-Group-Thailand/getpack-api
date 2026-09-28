import { type Actor, actorColumns, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { bangkokDate } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type FiscalPeriod, type PeriodStatus } from '@generated/prisma/client';
import { Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { addMonths, dateOnly, dayOf, monthEnd } from './ledger-dates';

/** Allowed period transitions (accounting-design §1.4, §7 step 9). `closed` never reopens; `locked` is final. */
const TRANSITIONS: Record<PeriodStatus, PeriodStatus[]> = {
  open: ['soft_closed'],
  soft_closed: ['open', 'closed'],
  closed: ['locked'],
  locked: [],
};

/**
 * Closing or locking a period is gated by the close checklist (§7, B5.6), provided by the close module; the
 * ledger itself does not depend on it (unit / integration set-ups run without a gate).
 */
export const PERIOD_CLOSE_GATE = Symbol('PERIOD_CLOSE_GATE');
export interface PeriodCloseGate {
  assertMayTransition(tx: Tx, period: FiscalPeriod, to: PeriodStatus, actor: Actor): Promise<void>;
}

export interface PostingPeriod {
  period: FiscalPeriod;
  /** Posting date: the document date, or the first day of the next open period when it is not open (§1.4). */
  entryDate: string;
}

/**
 * Fiscal years and monthly periods per entity. Years are created on demand (12 open monthly periods from
 * the entity's fiscal-year start month) so that a posting never waits for set-up; closing is a Finance act.
 */
@Injectable()
export class PeriodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  private gateRef: PeriodCloseGate | null | undefined;

  /** Resolved lazily: the close module depends on this service (no constructor cycle). */
  private get gate(): PeriodCloseGate | null {
    if (this.gateRef === undefined) {
      try {
        this.gateRef = this.moduleRef?.get<PeriodCloseGate>(PERIOD_CLOSE_GATE, { strict: false }) ?? null;
      } catch {
        this.gateRef = null;
      }
    }
    return this.gateRef;
  }

  /** The fiscal year containing `day` exists afterwards (with its 12 periods). */
  async ensureYear(tx: Tx, entityId: bigint, day: string): Promise<void> {
    const existing = await tx.fiscalPeriod.findFirst({
      where: { entityId, startDate: { lte: dateOnly(day) }, endDate: { gte: dateOnly(day) } },
      select: { id: true },
    });
    if (existing) return;
    const entity = await tx.entity.findUniqueOrThrow({ where: { id: entityId } });
    const startMonth = entity.fiscalYearStartMonth;
    const [y, m] = day.split('-').map(Number) as [number, number];
    const startYear = m >= startMonth ? y : y - 1;
    const start = `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
    const end = monthEnd(addMonths(start, 11));
    const label = startMonth === 1 ? `FY${startYear}` : `FY${startYear}/${String(startYear + 1).slice(2)}`;
    // Concurrent postings may race to create the same year: the unique key decides, the loser re-reads.
    await tx.$executeRaw`SAVEPOINT ensure_year`;
    try {
      const year = await tx.fiscalYear.create({
        data: { entityId, label, startDate: dateOnly(start), endDate: dateOnly(end) },
      });
      for (let i = 0; i < 12; i++) {
        const from = addMonths(start, i);
        await tx.fiscalPeriod.create({
          data: {
            entityId,
            fiscalYearId: year.id,
            periodNo: i + 1,
            startDate: dateOnly(from),
            endDate: dateOnly(monthEnd(from)),
          },
        });
      }
      await tx.$executeRaw`RELEASE SAVEPOINT ensure_year`;
    } catch (error) {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT ensure_year`;
      const again = await tx.fiscalYear.findFirst({ where: { entityId, startDate: dateOnly(start) } });
      if (!again) throw error;
    }
  }

  /**
   * Where a posting dated `day` lands: its own period when open (or soft-closed with the permission),
   * otherwise the first open period after it, keeping the document date for tax (§1.4).
   */
  async postingPeriod(
    tx: Tx,
    entityId: bigint,
    day: string,
    allowSoftClosed = false,
  ): Promise<PostingPeriod> {
    await this.ensureYear(tx, entityId, day);
    const own = await tx.fiscalPeriod.findFirstOrThrow({
      where: { entityId, startDate: { lte: dateOnly(day) }, endDate: { gte: dateOnly(day) } },
    });
    if (own.status === 'open' || (own.status === 'soft_closed' && allowSoftClosed)) {
      return { period: own, entryDate: day };
    }
    for (let probe = addMonths(day, 1), i = 0; i < 36; probe = addMonths(probe, 1), i++) {
      await this.ensureYear(tx, entityId, probe);
      const next = await tx.fiscalPeriod.findFirstOrThrow({
        where: { entityId, startDate: { lte: dateOnly(probe) }, endDate: { gte: dateOnly(probe) } },
      });
      if (next.status === 'open') return { period: next, entryDate: dayOf(next.startDate) };
    }
    throw new DomainException('ledger.period_closed', { params: { date: day, status: own.status } });
  }

  async years(entityId: bigint) {
    return this.prisma.fiscalYear.findMany({
      where: { entityId },
      include: { periods: { orderBy: { periodNo: 'asc' } } },
      orderBy: { startDate: 'desc' },
    });
  }

  async period(publicId: string, db: Tx = this.prisma): Promise<FiscalPeriod> {
    const period = await db.fiscalPeriod.findUnique({ where: { publicId } });
    if (!period) throw new DomainException('http.not_found');
    return period;
  }

  /** The period containing `day` (created on demand). */
  async periodOf(entityId: bigint, day: string): Promise<FiscalPeriod> {
    return this.prisma.withTx(async (tx) => {
      await this.ensureYear(tx, entityId, day);
      return tx.fiscalPeriod.findFirstOrThrow({
        where: { entityId, startDate: { lte: dateOnly(day) }, endDate: { gte: dateOnly(day) } },
      });
    });
  }

  /** The current Bangkok month's period of the entity. */
  async currentPeriod(entityId: bigint, at = new Date()): Promise<FiscalPeriod> {
    return this.periodOf(entityId, bangkokDate(at));
  }

  /** Moves a period along `open ⇄ soft_closed → closed → locked` in the caller's transaction. */
  async transitionIn(
    tx: Tx,
    actor: Actor,
    period: FiscalPeriod,
    to: PeriodStatus,
    reason: string | null,
  ): Promise<FiscalPeriod> {
    const [row] = await tx.$queryRaw<{ status: PeriodStatus }[]>`
      SELECT status FROM fiscal_periods WHERE id = ${period.id} FOR UPDATE`;
    const from = row!.status;
    if (!TRANSITIONS[from].includes(to))
      throw new DomainException('ledger.period_transition', { params: { from, to } });
    if (this.gate && (to === 'closed' || to === 'locked'))
      await this.gate.assertMayTransition(tx, period, to, actor);
    if (to === 'open') {
      // A month cannot reopen once a later month is closed (periods close in sequence).
      const laterClosed = await tx.fiscalPeriod.count({
        where: {
          entityId: period.entityId,
          startDate: { gt: period.startDate },
          status: { in: ['closed', 'locked'] },
        },
      });
      if (laterClosed > 0) throw new DomainException('ledger.period_transition', { params: { from, to } });
    }
    if (to === 'closed' || to === 'locked') {
      const earlierOpen = await tx.fiscalPeriod.count({
        where: {
          entityId: period.entityId,
          startDate: { lt: period.startDate },
          status: { in: to === 'closed' ? ['open', 'soft_closed'] : ['open', 'soft_closed', 'closed'] },
        },
      });
      if (earlierOpen > 0) throw new DomainException('ledger.period_transition', { params: { from, to } });
    }
    const who = actorColumns(actor);
    const updated = await tx.fiscalPeriod.update({
      where: { id: period.id },
      data: { status: to, statusChangedAt: new Date(), statusChangedById: who.actorUserId },
    });
    if (to === 'locked') {
      const openLeft = await tx.fiscalPeriod.count({
        where: { fiscalYearId: period.fiscalYearId, status: { not: 'locked' } },
      });
      if (openLeft === 0)
        await tx.fiscalYear.update({ where: { id: period.fiscalYearId }, data: { status: 'locked' } });
    }
    await this.audit.record(tx, {
      category: 'finance',
      action: `fiscal_period.${to}`,
      actor,
      resourceType: 'fiscal_period',
      resourcePublicId: period.publicId,
      entityId: period.entityId,
      data: { from, to, reason, start: dayOf(period.startDate) },
    });
    await this.events.record(
      tx,
      {
        type: 'fiscal_period.status_changed',
        aggregateType: 'fiscal_period',
        aggregateId: period.publicId,
        entityId: period.entityId,
        payload: { periodId: period.publicId, from, to, startDate: dayOf(period.startDate), reason },
      },
      actor,
    );
    return updated;
  }

  async transition(actor: UserActor, publicId: string, to: PeriodStatus, reason: string | null) {
    return this.prisma.withTx(async (tx) =>
      this.transitionIn(tx, actor, await this.period(publicId, tx), to, reason),
    );
  }
}
