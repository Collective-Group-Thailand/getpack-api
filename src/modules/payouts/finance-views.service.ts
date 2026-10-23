import { dateOnly } from '@common/ledger-core/dates';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import {
  addCalendarDays,
  bangkokDate,
  bangkokDayOfWeek,
  startOfBangkokDay,
  toBangkokIso,
} from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { FACTORY_ACCOUNTS } from '@modules/payables/payables-query.service';
import { Injectable } from '@nestjs/common';
import { BusinessCalendarService } from '@platform/calendar/business-calendar.service';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import { type FinanceSummaryDto, type PayoutCalendarDto } from './finance-views.dto';

const D = (v: { toString(): string } | string | number | null | undefined) =>
  new MoneyDecimal(v === null || v === undefined ? '0' : v.toString());
const m = (v: MoneyValue) => formatMoney(v);
const day = (d: Date) => d.toISOString().slice(0, 10);
/** Runs a partner sees: proposed onwards (a draft may still change), not the ones dropped. */
const VISIBLE_RUNS = ['proposed', 'approved', 'file_generated', 'confirmed', 'partially_failed'] as const;
const MAX_POS = 200;

/**
 * D-293 the partner's money views. The payout calendar: every unpaid payable with its expected pay-on date — the run
 * it is in, else the first payout-run day (`payouts.run_calendar`, a working day of the national calendar) on or after
 * its eligibility — and the runs with their lines. The finance summary: per period, from the vendor sub-ledger (the
 * statement of account's entries), what was earned, paid, retained (held, released) and deducted — reconciling to the
 * opening and closing balance — and per purchase order from its documents.
 */
@Injectable()
export class FinanceViewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly calendars: BusinessCalendarService,
  ) {}

  async payoutCalendar(vendorId: bigint, now = new Date()): Promise<PayoutCalendarDto> {
    const runDays = await this.runDays(now);
    const calendar = await this.calendars.calendar();
    const today = bangkokDate(now);
    const nextRunDay = (from: string): string | null => {
      if (!runDays) return null;
      let d = from;
      for (let i = 0; i < 400; i++) {
        if (runDays.includes(bangkokDayOfWeek(startOfBangkokDay(d))) && calendar.isWorkingDay(d)) return d;
        d = calendar.isWorkingDay(d) ? addCalendarDays(d, 1) : calendar.nextWorkingDay(d);
      }
      return null;
    };
    const payables = await this.prisma.payableItem.findMany({
      where: { vendorId, status: { in: ['open', 'eligible', 'in_run'] } },
      include: {
        purchaseOrder: { select: { publicId: true, poNumber: true } },
        allocations: {
          where: { payoutItem: { status: 'included' } },
          include: {
            payoutItem: { include: { run: { select: { publicId: true, payOn: true, status: true } } } },
          },
        },
      },
      orderBy: [{ eligibleAt: 'asc' }, { id: 'asc' }],
      take: 500,
    });
    const runs = await this.prisma.payoutRun.findMany({
      where: {
        status: { in: [...VISIBLE_RUNS] },
        items: { some: { vendorId } },
        payOn: { gte: dateOnly(addCalendarDays(today, -90)) },
      },
      include: { items: { where: { vendorId }, orderBy: { id: 'asc' } } },
      orderBy: [{ payOn: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    return {
      runCalendar: runDays ? { weekdays: runDays } : null,
      payables: payables.map((p) => {
        const run = p.allocations.find((a) => VISIBLE_RUNS.includes(a.payoutItem.run.status as never))
          ?.payoutItem.run;
        const eligibleOn = p.eligibleAt ? bangkokDate(p.eligibleAt) : null;
        const expected = run
          ? { on: day(run.payOn), basis: 'scheduled_run' as const }
          : !eligibleOn
            ? { on: null, basis: 'eligibility_pending' as const }
            : runDays
              ? { on: nextRunDay(eligibleOn > today ? eligibleOn : today), basis: 'run_calendar' as const }
              : { on: null, basis: 'run_calendar_unset' as const };
        return {
          id: p.publicId,
          source: p.source,
          status: p.status,
          purchaseOrderId: p.purchaseOrder?.publicId ?? null,
          poNumber: p.purchaseOrder?.poNumber ?? null,
          netAmount: m(D(p.netAmount)),
          vatAmount: m(D(p.vatAmount)),
          openNetAmount: m(D(p.openNetAmount)),
          openVatAmount: m(D(p.openVatAmount)),
          eligibleAt: p.eligibleAt ? toBangkokIso(p.eligibleAt) : null,
          expectedPayOn: expected.on,
          expectedBasis: expected.basis,
          runId: run?.publicId ?? null,
        };
      }),
      runs: runs.map((r) => ({
        id: r.publicId,
        runNo: r.runNo,
        payOn: day(r.payOn),
        status: r.status,
        lines: r.items.map((i) => ({
          payoutId: i.publicId,
          pvNumber: i.pvNumber,
          kind: i.kind,
          status: i.status,
          apNetAmount: m(D(i.apNetAmount)),
          vatAmount: m(D(i.vatAmount)),
          whtAmount: m(D(i.whtAmount)),
          retentionAmount: m(D(i.retentionAmount)),
          cashAmount: m(D(i.cashAmount)),
          paidOn: i.paidOn ? day(i.paidOn) : null,
        })),
      })),
      currency: 'THB',
    };
  }

  async financeSummary(vendorId: bigint, from: string, to: string): Promise<FinanceSummaryDto> {
    const base = {
      vendorId,
      account: { code: { in: [...FACTORY_ACCOUNTS] } },
      journalEntry: { status: 'posted' as const },
    };
    const [before, lines] = await Promise.all([
      this.prisma.journalLine.aggregate({
        where: { ...base, entryDate: { lt: dateOnly(from) } },
        _sum: { debit: true, credit: true },
      }),
      this.prisma.journalLine.findMany({
        where: { ...base, entryDate: { gte: dateOnly(from), lte: dateOnly(to) } },
        select: {
          debit: true,
          credit: true,
          account: { select: { code: true } },
          journalEntry: { select: { sourceDocumentType: true, reversesEntryId: true } },
        },
      }),
    ]);
    const opening = D(before._sum.credit).sub(D(before._sum.debit));
    let earned = D(0);
    let paid = D(0);
    let held = D(0);
    let released = D(0);
    let deducted = D(0);
    let adjustments = D(0);
    for (const l of lines) {
      const net = D(l.credit).sub(D(l.debit));
      const type = l.journalEntry.reversesEntryId === null ? l.journalEntry.sourceDocumentType : null;
      if (type === 'goods_receipt') earned = earned.add(net);
      else if (type === 'payout_item') {
        paid = paid.sub(net);
        if (l.account.code === '2130') {
          held = held.add(D(l.credit));
          released = released.add(D(l.debit));
        }
      } else if (type === 'vendor_deduction') deducted = deducted.sub(net);
      else adjustments = adjustments.add(net);
    }
    const closing = opening.add(earned).sub(paid).sub(deducted).add(adjustments);
    return {
      period: {
        from,
        to,
        opening: m(opening),
        earned: m(earned),
        paid: m(paid),
        retainedHeld: m(held),
        retainedReleased: m(released),
        deducted: m(deducted),
        adjustments: m(adjustments),
        closing: m(closing),
      },
      purchaseOrders: await this.perPurchaseOrder(vendorId),
      currency: 'THB',
    };
  }

  /** Lifetime money of the vendor's latest purchase orders, from their documents. */
  private async perPurchaseOrder(vendorId: bigint): Promise<FinanceSummaryDto['purchaseOrders']> {
    const pos = await this.prisma.purchaseOrder.findMany({
      where: { vendorId, status: { not: 'cancelled' } },
      select: {
        id: true,
        publicId: true,
        poNumber: true,
        status: true,
        goodsReceipts: { select: { netAmount: true } },
        payableItems: {
          select: {
            id: true,
            source: true,
            netAmount: true,
            allocations: {
              where: { payoutItem: { status: 'paid' } },
              select: { netAmount: true },
            },
          },
        },
      },
      orderBy: { id: 'desc' },
      take: MAX_POS,
    });
    const payableIds = pos.flatMap((p) => p.payableItems.map((i) => i.id));
    const deductions = payableIds.length
      ? await this.prisma.vendorDeduction.findMany({
          where: { appliedPayableItemId: { in: payableIds }, status: 'applied' },
          select: { amount: true, appliedPayableItemId: true },
        })
      : [];
    return pos.map((po) => {
      const ids = new Set(po.payableItems.map((i) => i.id));
      const sum = <T>(rows: T[], f: (r: T) => MoneyValue) => rows.reduce((a, r) => a.add(f(r)), D(0));
      const earned = sum(po.goodsReceipts, (g) => D(g.netAmount));
      const regular = po.payableItems.filter((i) => i.source !== 'retention');
      const retention = po.payableItems.filter((i) => i.source === 'retention');
      const allocated = sum(regular, (i) => sum(i.allocations, (a) => D(a.netAmount)));
      const held = sum(retention, (i) => D(i.netAmount));
      const released = sum(retention, (i) => sum(i.allocations, (a) => D(a.netAmount)));
      const deducted = sum(
        deductions.filter((d) => d.appliedPayableItemId !== null && ids.has(d.appliedPayableItemId)),
        (d) => D(d.amount),
      );
      // What reached the factory: payments net of VAT, less the retention held back, plus what was released.
      const paid = allocated.sub(held).add(released);
      return {
        purchaseOrderId: po.publicId,
        poNumber: po.poNumber,
        status: po.status,
        earned: m(earned),
        paid: m(paid),
        retainedHeld: m(held),
        retainedReleased: m(released),
        deducted: m(deducted),
        owed: m(earned.sub(paid).sub(deducted)),
      };
    });
  }

  private async runDays(at: Date): Promise<number[] | null> {
    try {
      const value = (await this.settings.at('payouts.run_calendar', { at })).value as { weekdays?: number[] };
      return value.weekdays?.length ? [...value.weekdays].sort() : null;
    } catch (error) {
      if (error instanceof SettingNotFoundError) return null;
      throw error;
    }
  }
}
