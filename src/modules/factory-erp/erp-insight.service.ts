import { DomainException } from '@common/errors/domain.exception';
import { type MoneyValue } from '@common/money/money';
import { addCalendarDays, bangkokDayOfWeek, startOfBangkokDay, toBangkokIso } from '@common/time/bangkok';
import { type PrismaService, type Tx } from '@database/prisma.service';
import { type ErpFactorySettings, type Factory, Prisma } from '@generated/prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { dec, fmtCost, fmtMoney, fmtQty, money2 } from './erp.math';
import { ErpAlertsService } from './erp-alerts.service';
import {
  type ErpCostReportDto,
  type ErpDashboardDto,
  type ErpJobCostDto,
  type ErpMachineRateDto,
  type ErpOeeMachineDto,
  type ErpOeeReportDto,
  type ErpProfitReportDto,
  type ErpSaveMachineRateDto,
} from './erp-e5.dto';
import {
  jobCost,
  oeeOf,
  operationSegments,
  type OpEvent,
  overlapMinutes,
  pct1,
  shiftMinutes,
} from './erp-e5.math';
import { day, iso, today } from './erp-sales.shared';
import { ErpScheduleService } from './erp-schedule.service';
import { ErpTaxService } from './erp-tax.service';
import { itemRef } from './erp-views';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

const DAY_MS = 86_400_000;
const MONTH = (m: string) => {
  const [y, mo] = m.split('-').map(Number) as [number, number];
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  return {
    from: day(`${m}-01`),
    to: day(`${next}-01`),
    fromTs: startOfBangkokDay(`${m}-01`),
    toTs: startOfBangkokDay(`${next}-01`),
  };
};

type Db = Tx | PrismaService;

const MO_COST_INCLUDE = {
  item: true,
  operations: { include: { machine: true, events: true }, orderBy: { seq: 'asc' } },
} as const;
type MoCostRow = Prisma.ErpProductionOrderGetPayload<{ include: typeof MO_COST_INCLUDE }>;

/** Value of the materials an order consumed: production issues less returns (D-341). */
export async function materialValue(db: Db, publicId: string): Promise<MoneyValue> {
  const sum = await db.erpStockMovement.aggregate({
    where: { sourcePublicId: publicId, kind: { in: ['production_issue', 'production_return'] } },
    _sum: { value: true },
  });
  return dec(sum._sum.value ?? 0).negated();
}

/** Run minutes of an operation from its events (pauses excluded), whole minutes. */
const runMinutesOf = (events: { kind: string; occurredAt: Date; reason?: string | null }[], now: number) =>
  Math.round(
    operationSegments(
      events.map((e) => ({
        kind: e.kind as OpEvent['kind'],
        at: e.occurredAt.getTime(),
        reason: e.reason ?? null,
      })),
      now,
    ).run.reduce((a, [s, e]) => a + (e - s) / 60_000, 0),
  );

/**
 * D-376: the full cost of a production order — its materials, each operation's run minutes on its machine's
 * hourly rate and at the labour rate, and the overhead % — used when it completes and in the reports.
 */
export async function orderCost(db: Db, mo: MoCostRow, settings: ErpFactorySettings, now = Date.now()) {
  const rates = await db.erpMachineRate.findMany({ where: { factoryId: mo.factoryId } });
  const rateOf = (machineId: bigint | null) => {
    const r = machineId === null ? undefined : rates.find((x) => x.machineId === machineId);
    return r ? dec(r.hourlyRate) : null;
  };
  const ops = mo.operations.map((o) => {
    const run = runMinutesOf(o.events, now);
    const rate = rateOf(o.machineId);
    return {
      seq: o.seq,
      name: o.name,
      machine: o.machine ? { id: o.machine.publicId, name: o.machine.name } : null,
      plannedMinutes: o.plannedMinutes,
      runMinutes: run,
      machineRate: rate ? fmtMoney(rate) : null,
      machineCost: fmtMoney(rate ? money2(rate.times(run).div(60)) : dec(0)),
      rate,
    };
  });
  const cost = jobCost({
    material: await materialValue(db, mo.publicId),
    runs: ops.map((o) => ({ minutes: o.runMinutes, machineRate: o.rate })),
    labourRatePerHour: dec(settings.labourRatePerHour),
    overheadPct: dec(settings.overheadPct),
  });
  return { cost, ops };
}

/** Loads an order with what its cost needs. */
export async function moForCost(db: Db, id: bigint): Promise<MoCostRow> {
  return db.erpProductionOrder.findUniqueOrThrow({ where: { id }, include: MO_COST_INCLUDE });
}

/**
 * Insight (D-376 – D-379, D-383): machine rates and job costs, profitability of what was invoiced, OEE per
 * machine and day, the owner's dashboard, the 07:40 LINE summary and the 07:35 quality / OEE alerts.
 */
@Injectable()
export class ErpInsightService {
  private readonly logger = new Logger(ErpInsightService.name);

  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly tax: ErpTaxService,
    private readonly schedule: ErpScheduleService,
    private readonly alerts: ErpAlertsService,
  ) {}

  // -------------------------------------------------------------------------------- machine rates

  async machineRates(scope: ErpScope): Promise<ErpMachineRateDto[]> {
    const machines = await this.workspace.db.factoryMachine.findMany({
      where: { factoryId: scope.factory.id, status: 'active' },
      include: { erpMachineRateMachine: true },
      orderBy: { name: 'asc' },
    });
    return machines.map((m) => {
      const r = m.erpMachineRateMachine[0];
      return {
        machine: { id: m.publicId, name: m.name },
        hourlyRate: r ? fmtMoney(r.hourlyRate) : null,
        note: r?.note ?? null,
        updatedAt: r ? toBangkokIso(r.updatedAt) : null,
      };
    });
  }

  async saveMachineRate(scope: ErpScope, machinePublicId: string, body: ErpSaveMachineRateDto) {
    await this.workspace.tx(async (tx) => {
      const m = await tx.factoryMachine.findFirst({
        where: { publicId: machinePublicId, factoryId: scope.factory.id },
      });
      if (!m) throw new DomainException('http.not_found');
      await tx.erpMachineRate.upsert({
        where: { factoryId_machineId: { factoryId: scope.factory.id, machineId: m.id } },
        create: {
          factoryId: scope.factory.id,
          machineId: m.id,
          hourlyRate: body.hourlyRate,
          note: body.note ?? null,
          createdById: scope.actor.userId,
        },
        update: {
          hourlyRate: body.hourlyRate,
          note: body.note ?? null,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(tx, scope, 'erp_machine_rate.saved', 'factory_machine', m.publicId);
    });
    return this.machineRates(scope);
  }

  // ------------------------------------------------------------------------------------- costing

  async jobCost(scope: ErpScope, publicId: string): Promise<ErpJobCostDto> {
    const mo = await this.workspace.db.erpProductionOrder.findFirst({
      where: { publicId, factoryId: scope.factory.id },
      include: MO_COST_INCLUDE,
    });
    if (!mo) throw new DomainException('http.not_found');
    const settings = await this.workspace.settings(this.workspace.db, scope.factory.id);
    return this.costDto(mo, await orderCost(this.workspace.db, mo, settings), true);
  }

  /** D-376: orders completed in the month, at today's rates. */
  async costReport(scope: ErpScope, month: string): Promise<ErpCostReportDto> {
    const r = MONTH(month);
    const db = this.workspace.db;
    const settings = await this.workspace.settings(db, scope.factory.id);
    const mos = await db.erpProductionOrder.findMany({
      where: {
        factoryId: scope.factory.id,
        status: { in: ['completed', 'closed'] },
        completedAt: { gte: r.fromTs, lt: r.toTs },
      },
      include: MO_COST_INCLUDE,
      orderBy: { completedAt: 'asc' },
    });
    const orders: ErpJobCostDto[] = [];
    for (const mo of mos) orders.push(this.costDto(mo, await orderCost(db, mo, settings), false));
    const sum = (k: 'material' | 'machine' | 'labour' | 'overhead' | 'total') =>
      fmtMoney(orders.reduce((a, o) => a.plus(dec(o[k])), dec(0)));
    return {
      month,
      orders,
      totals: {
        orders: orders.length,
        material: sum('material'),
        machine: sum('machine'),
        labour: sum('labour'),
        overhead: sum('overhead'),
        total: sum('total'),
      },
    };
  }

  private costDto(mo: MoCostRow, c: Awaited<ReturnType<typeof orderCost>>, withOps: boolean): ErpJobCostDto {
    const good = dec(mo.goodQty);
    return {
      productionOrder: { id: mo.publicId, number: mo.moNo },
      title: mo.title,
      item: mo.item ? itemRef(mo.item) : null,
      status: mo.status,
      goodQty: fmtQty(mo.goodQty),
      scrapQty: fmtQty(mo.scrapQty),
      material: fmtMoney(c.cost.material),
      machine: fmtMoney(c.cost.machine),
      labour: fmtMoney(c.cost.labour),
      overhead: fmtMoney(c.cost.overhead),
      total: fmtMoney(c.cost.total),
      unitCost: good.gt(0) ? fmtCost(c.cost.total.div(good)) : null,
      plannedMinutes: c.ops.reduce((a, o) => a + o.plannedMinutes, 0),
      runMinutes: c.ops.reduce((a, o) => a + o.runMinutes, 0),
      completedAt: mo.completedAt ? toBangkokIso(mo.completedAt) : null,
      operations: withOps ? c.ops.map(({ rate: _rate, ...o }) => o) : [],
    };
  }

  /**
   * D-376: what the month's issued invoices earned over the cost of what they delivered, by sales order,
   * customer or item. Revenue is each line's share of its invoice's net; cost is the delivered stock cost.
   */
  async profit(
    scope: ErpScope,
    month: string,
    by: 'sales_order' | 'customer' | 'item' | 'getpack_job',
  ): Promise<ErpProfitReportDto> {
    const r = MONTH(month);
    if (by === 'getpack_job') return this.getpackProfit(scope, month);
    const key =
      by === 'customer'
        ? Prisma.sql`c.public_id::text AS id, c.code AS code, c.name AS name`
        : by === 'item'
          ? Prisma.sql`coalesce(it.public_id::text, '-') AS id, coalesce(it.sku, '-') AS code, coalesce(it.name, 'รายการอื่น ๆ') AS name`
          : Prisma.sql`coalesce(so.public_id::text, '-') AS id, coalesce(so.so_no, '-') AS code, coalesce(c.name, '') AS name`;
    const rows = await this.workspace.db.$queryRaw<
      { id: string; code: string; name: string; revenue: Prisma.Decimal; cost: Prisma.Decimal }[]
    >(Prisma.sql`
      WITH lines AS (
        SELECT l.*, i.customer_id, i.sales_order_id,
               CASE WHEN sum(l.amount) OVER (PARTITION BY l.invoice_id) = 0 THEN 0
                    ELSE l.amount * i.subtotal / sum(l.amount) OVER (PARTITION BY l.invoice_id) END AS net
          FROM erp_sales_invoice_lines l JOIN erp_sales_invoices i ON i.id = l.invoice_id
         WHERE i.factory_id = ${scope.factory.id} AND i.invoice_no IS NOT NULL AND i.status <> 'voided'
           AND i.issue_date >= ${r.from} AND i.issue_date < ${r.to})
      SELECT ${key}, round(sum(lines.net), 2) AS revenue,
             round(coalesce(sum(d.unit_cost * lines.quantity), 0), 2) AS cost
        FROM lines
        JOIN erp_trading_partners c ON c.id = lines.customer_id
        LEFT JOIN erp_sales_orders so ON so.id = lines.sales_order_id
        LEFT JOIN erp_items it ON it.id = lines.item_id
        LEFT JOIN erp_delivery_note_lines d ON d.id = lines.delivery_note_line_id
       GROUP BY 1, 2, 3
       ORDER BY revenue DESC`);
    const pct = (rev: MoneyValue, gp: MoneyValue) => (rev.gt(0) ? gp.times(100).div(rev).toFixed(1) : null);
    const out = rows.map((x) => {
      const revenue = dec(x.revenue);
      const cost = dec(x.cost);
      const gp = revenue.minus(cost);
      return {
        key: { id: x.id, code: x.code, name: x.name },
        revenue: fmtMoney(revenue),
        cost: fmtMoney(cost),
        grossProfit: fmtMoney(gp),
        grossProfitPct: pct(revenue, gp),
      };
    });
    const revenue = out.reduce((a, x) => a.plus(dec(x.revenue)), dec(0));
    const cost = out.reduce((a, x) => a.plus(dec(x.cost)), dec(0));
    return {
      month,
      by,
      rows: out,
      revenue: fmtMoney(revenue),
      cost: fmtMoney(cost),
      grossProfit: fmtMoney(revenue.minus(cost)),
      grossProfitPct: pct(revenue, revenue.minus(cost)),
    };
  }

  /**
   * D-402: getpack jobs finished in the month — what getpack's purchase order pays for the job (net of VAT, production
   * and shipping) over the production order's cost at today's rates (D-376).
   */
  private async getpackProfit(scope: ErpScope, month: string): Promise<ErpProfitReportDto> {
    const r = MONTH(month);
    const db = this.workspace.db;
    const settings = await this.workspace.settings(db, scope.factory.id);
    const mos = await db.erpProductionOrder.findMany({
      where: {
        factoryId: scope.factory.id,
        source: 'getpack_job',
        status: { in: ['completed', 'closed'] },
        completedAt: { gte: r.fromTs, lt: r.toTs },
      },
      include: {
        ...MO_COST_INCLUDE,
        productionJob: { select: { jobNo: true, purchaseOrder: { select: { netAmount: true } } } },
      },
      orderBy: { completedAt: 'asc' },
    });
    const pct = (rev: MoneyValue, gp: MoneyValue) => (rev.gt(0) ? gp.times(100).div(rev).toFixed(1) : null);
    const out: ErpProfitReportDto['rows'] = [];
    for (const mo of mos) {
      const revenue = dec(mo.productionJob?.purchaseOrder?.netAmount ?? 0);
      const cost = (await orderCost(db, mo, settings)).cost.total;
      const gp = revenue.minus(cost);
      out.push({
        key: { id: mo.publicId, code: mo.productionJob?.jobNo ?? mo.moNo, name: mo.title },
        revenue: fmtMoney(revenue),
        cost: fmtMoney(cost),
        grossProfit: fmtMoney(gp),
        grossProfitPct: pct(revenue, gp),
      });
    }
    out.sort((a, b) => dec(b.revenue).comparedTo(dec(a.revenue)));
    const revenue = out.reduce((a, x) => a.plus(dec(x.revenue)), dec(0));
    const cost = out.reduce((a, x) => a.plus(dec(x.cost)), dec(0));
    return {
      month,
      by: 'getpack_job',
      rows: out,
      revenue: fmtMoney(revenue),
      cost: fmtMoney(cost),
      grossProfit: fmtMoney(revenue.minus(cost)),
      grossProfitPct: pct(revenue, revenue.minus(cost)),
    };
  }

  // ----------------------------------------------------------------------------------------- OEE

  /** D-377: OEE per machine and day over `from`..`to` (Bangkok days, at most 31). */
  async oee(scope: Pick<ErpScope, 'factory'>, from: string, to: string): Promise<ErpOeeReportDto> {
    if (to < from || addCalendarDays(from, 31) < to)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'to', code: 'invalid', message: 'On or after from, at most 31 days' }],
      });
    const start = startOfBangkokDay(from);
    const end = startOfBangkokDay(addCalendarDays(to, 1));
    const db = this.workspace.db;
    const [machines, ops, shifts, clock] = await Promise.all([
      db.factoryMachine.findMany({
        where: { factoryId: scope.factory.id, status: 'active' },
        orderBy: { name: 'asc' },
      }),
      db.erpProductionOperation.findMany({
        where: {
          productionOrder: { factoryId: scope.factory.id },
          machineId: { not: null },
          startedAt: { lt: end },
          OR: [{ finishedAt: null }, { finishedAt: { gte: start } }],
        },
        include: { events: true, productionOrder: true },
      }),
      db.erpShift.findMany({ where: { factoryId: scope.factory.id, status: 'active' } }),
      this.schedule.clock(scope),
    ]);
    const now = Date.now();
    const days: string[] = [];
    for (let d = from; d <= to; d = addCalendarDays(d, 1)) days.push(d);
    const planned = (d: string): number => {
      const dow = bangkokDayOfWeek(startOfBangkokDay(d));
      const onShift = shifts.filter((s) => Array.isArray(s.days) && (s.days as number[]).includes(dow));
      if (onShift.length) return onShift.reduce((a, s) => a + shiftMinutes(s.startTime, s.endTime), 0);
      if (!clock.calendar.isWorkingDay(d)) return 0;
      const h = clock.calendar.hoursOn(d) ?? clock.window;
      return shiftMinutes(h.from, h.to);
    };
    const result: ErpOeeMachineDto[] = [];
    let allRun = 0;
    let allWeighted = 0;
    for (const m of machines) {
      const mine = ops.filter((o) => o.machineId === m.id);
      const perDay = days.map((d) => ({
        d,
        planned: planned(d),
        run: 0,
        ideal: 0,
        good: dec(0),
        scrap: dec(0),
      }));
      const losses = new Map<string, number>();
      for (const o of mine) {
        const seg = operationSegments(
          o.events.map((e) => ({
            kind: e.kind,
            at: e.occurredAt.getTime(),
            reason: e.reason,
            goodQty: e.goodQty === null ? null : dec(e.goodQty),
            scrapQty: e.scrapQty === null ? null : dec(e.scrapQty),
          })),
          now,
        );
        const totalRun = seg.run.reduce((a, [s, e]) => a + (e - s) / 60_000, 0);
        const finished = o.status === 'done';
        const made = dec(o.goodQty).plus(dec(o.scrapQty));
        const moQty = dec(o.productionOrder.quantity);
        const ideal = finished && moQty.gt(0) ? made.div(moQty).times(o.plannedMinutes).toNumber() : 0;
        for (const p of perDay) {
          const s0 = startOfBangkokDay(p.d).getTime();
          const run = seg.run.reduce((a, [s, e]) => a + overlapMinutes(s, e, s0, s0 + DAY_MS), 0);
          p.run += run;
          if (finished && totalRun > 0) {
            const share = run / totalRun;
            p.ideal += ideal * share;
            p.good = p.good.plus(dec(o.goodQty).times(share));
            p.scrap = p.scrap.plus(dec(o.scrapQty).times(share));
          }
        }
        for (const pz of seg.pauses) {
          const mins = overlapMinutes(pz.from, pz.to, start.getTime(), end.getTime());
          if (mins > 0) losses.set(pz.reason, (losses.get(pz.reason) ?? 0) + mins);
        }
      }
      const dayDtos = perDay.map((p) => {
        const o = oeeOf({
          plannedMinutes: p.planned,
          runMinutes: p.run,
          idealMinutes: p.ideal,
          good: p.good,
          scrap: p.scrap,
        });
        return {
          day: p.d,
          plannedMinutes: Math.round(p.planned),
          runMinutes: Math.round(p.run),
          availabilityPct: pct1(o.availability),
          performancePct: pct1(o.performance),
          qualityPct: pct1(o.quality),
          oeePct: pct1(o.oee),
        };
      });
      const tot = perDay.reduce(
        (a, p) => ({
          planned: a.planned + p.planned,
          run: a.run + p.run,
          ideal: a.ideal + p.ideal,
          good: a.good.plus(p.good),
          scrap: a.scrap.plus(p.scrap),
        }),
        { planned: 0, run: 0, ideal: 0, good: dec(0), scrap: dec(0) },
      );
      const o = oeeOf({
        plannedMinutes: tot.planned,
        runMinutes: tot.run,
        idealMinutes: tot.ideal,
        good: tot.good,
        scrap: tot.scrap,
      });
      // weighted by the time the machine was due to run, overtime included (D-403)
      allRun += Math.max(tot.planned, tot.run);
      allWeighted += o.oee * Math.max(tot.planned, tot.run);
      result.push({
        machine: { id: m.publicId, name: m.name },
        plannedMinutes: Math.round(tot.planned),
        runMinutes: Math.round(tot.run),
        good: fmtQty(tot.good),
        scrap: fmtQty(tot.scrap),
        availabilityPct: pct1(o.availability),
        performancePct: pct1(o.performance),
        qualityPct: pct1(o.quality),
        oeePct: pct1(o.oee),
        days: dayDtos,
        losses: [...losses.entries()]
          .map(([reason, minutes]) => ({ reason, minutes: Math.round(minutes) }))
          .filter((l) => l.minutes > 0)
          .sort((a, b) => b.minutes - a.minutes),
      });
    }
    return { from, to, oeePct: allRun > 0 ? pct1(allWeighted / allRun) : null, machines: result };
  }

  // ----------------------------------------------------------------------------------- dashboard

  /** D-378: the owner's page — sales, money in and out, stock, production, machines, quality, follow-ups. */
  async dashboard(scope: Pick<ErpScope, 'factory'>): Promise<ErpDashboardDto> {
    const f = scope.factory.id;
    const db = this.workspace.db;
    const t = today();
    const month = t.slice(0, 7);
    const r = MONTH(month);
    const yesterday = addCalendarDays(t, -1);
    const [sales, ar, ap, stock, low, prod, late, machines, quality, follow, oee] = await Promise.all([
      this.tax.salesReport(scope as ErpScope, month),
      db.$queryRaw<{ open: Prisma.Decimal; overdue: Prisma.Decimal; n: bigint }[]>(Prisma.sql`
        SELECT coalesce(sum(o), 0) AS open, coalesce(sum(o) FILTER (WHERE due_date < ${day(t)}), 0) AS overdue,
               count(*) FILTER (WHERE due_date < ${day(t)} AND o > 0) AS n
          FROM (SELECT due_date, total + debited_amount - credited_amount - received_amount AS o
                  FROM erp_sales_invoices WHERE factory_id = ${f} AND status IN ('issued', 'partially_paid')) x`),
      db.$queryRaw<{ week: Prisma.Decimal; n: bigint; overdue: Prisma.Decimal }[]>(Prisma.sql`
        SELECT coalesce(sum(payable_amount - paid_amount) FILTER (WHERE due_date >= ${day(t)} AND due_date <= ${day(addCalendarDays(t, 7))}), 0) AS week,
               count(*) FILTER (WHERE due_date >= ${day(t)} AND due_date <= ${day(addCalendarDays(t, 7))}) AS n,
               coalesce(sum(payable_amount - paid_amount) FILTER (WHERE due_date < ${day(t)}), 0) AS overdue
          FROM erp_supplier_invoices
         WHERE factory_id = ${f} AND status IN ('matched', 'variance', 'approved', 'partially_paid')`),
      db.erpStockBalance.aggregate({ where: { factoryId: f }, _sum: { value: true } }),
      db.$queryRaw<{ id: bigint; available: Prisma.Decimal; reorder_point: Prisma.Decimal }[]>(Prisma.sql`
        SELECT it.id, coalesce(sum(b.on_hand - b.reserved), 0) AS available, it.reorder_point
          FROM erp_items it LEFT JOIN erp_stock_balances b ON b.item_id = it.id
         WHERE it.factory_id = ${f} AND it.status = 'active' AND it.reorder_point IS NOT NULL
         GROUP BY it.id, it.reorder_point
        HAVING coalesce(sum(b.on_hand - b.reserved), 0) < it.reorder_point
         ORDER BY coalesce(sum(b.on_hand - b.reserved), 0) / nullif(it.reorder_point, 0) ASC`),
      db.erpProductionOrder.groupBy({
        by: ['status'],
        where: {
          factoryId: f,
          OR: [
            { status: { in: ['released', 'in_progress'] } },
            { status: 'completed', completedAt: { gte: r.fromTs } },
          ],
        },
        _count: { _all: true },
      }),
      db.erpProductionOrder.findMany({
        where: {
          factoryId: f,
          status: { in: ['planned', 'released', 'in_progress'] },
          dueOn: { lt: day(t) },
        },
        orderBy: { dueOn: 'asc' },
      }),
      Promise.all([
        db.factoryMachine.count({ where: { factoryId: f, status: 'active' } }),
        db.erpMaintenanceOrder.findMany({
          where: { factoryId: f, kind: 'breakdown', status: { in: ['open', 'scheduled', 'in_progress'] } },
          distinct: ['machineId'],
          select: { machineId: true },
        }),
      ]),
      Promise.all([
        db.erpNcr.count({ where: { factoryId: f, status: { in: ['open', 'in_progress', 'verified'] } } }),
        db.erpNcr.count({
          where: { factoryId: f, status: { in: ['open', 'in_progress'] }, actionDueOn: { lt: day(t) } },
        }),
        db.erpQualityCheck.groupBy({
          by: ['result'],
          where: { factoryId: f, inspectedAt: { gte: r.fromTs, lt: r.toTs } },
          _count: { _all: true },
        }),
      ]),
      Promise.all([
        db.erpActivity.count({
          where: {
            factoryId: f,
            doneAt: null,
            dueAt: { gte: startOfBangkokDay(t), lt: startOfBangkokDay(addCalendarDays(t, 1)) },
          },
        }),
        db.erpActivity.count({ where: { factoryId: f, doneAt: null, dueAt: { lt: new Date() } } }),
        db.erpAlert.count({ where: { factoryId: f, status: 'open' } }),
      ]),
      this.oee(scope, yesterday, yesterday).catch(() => null),
    ]);
    const lowItems = await db.erpItem.findMany({ where: { id: { in: low.slice(0, 5).map((x) => x.id) } } });
    // Work for getpack (D-402): its revenue is the statements confirmed this month (F14, D-397).
    const [confirmed, waiting, uninvoiced] = await Promise.all([
      db.billingStatement.aggregate({
        where: { factoryId: f, confirmedAt: { gte: r.fromTs, lt: r.toTs } },
        _sum: { netAmount: true },
        _count: { _all: true },
      }),
      db.billingStatement.aggregate({
        where: { factoryId: f, status: 'sent' },
        _sum: { grossAmount: true },
        _count: { _all: true },
      }),
      db.billingStatement.count({
        where: {
          factoryId: f,
          status: 'confirmed',
          vendorInvoices: { none: { status: { in: ['recorded', 'validated'] } } },
        },
      }),
    ]);
    const checks = quality[2];
    const decided = checks.filter((c) => c.result !== 'pending').reduce((a, c) => a + c._count._all, 0);
    const passed = checks
      .filter((c) => c.result === 'pass' || c.result === 'conditional')
      .reduce((a, c) => a + c._count._all, 0);
    const count = (s: string) => prod.find((p) => p.status === s)?._count._all ?? 0;
    return {
      asOf: t,
      month,
      sales: {
        invoicedNet: sales.invoicedNet,
        target: sales.targetNet,
        achievementPct: dec(sales.targetNet).gt(0)
          ? dec(sales.invoicedNet).times(100).div(dec(sales.targetNet)).toFixed(1)
          : null,
        invoices: sales.rows.reduce((a, x) => a + x.invoices, 0),
      },
      getpack: {
        confirmedNet: fmtMoney(confirmed._sum.netAmount ?? 0),
        confirmedStatements: confirmed._count._all,
        toConfirm: waiting._count._all,
        toConfirmGross: fmtMoney(waiting._sum.grossAmount ?? 0),
        toInvoice: uninvoiced,
      },
      receivables: {
        open: fmtMoney(ar[0]!.open),
        overdue: fmtMoney(ar[0]!.overdue),
        overdueInvoices: Number(ar[0]!.n),
      },
      payables: {
        dueThisWeek: fmtMoney(ap[0]!.week),
        dueThisWeekCount: Number(ap[0]!.n),
        overdueAmount: fmtMoney(ap[0]!.overdue),
      },
      stock: {
        value: fmtMoney(stock._sum.value ?? 0),
        lowItems: low.length,
        low: low.slice(0, 5).flatMap((x) => {
          const it = lowItems.find((i) => i.id === x.id);
          return it
            ? [{ item: itemRef(it), available: fmtQty(x.available), reorderPoint: fmtQty(x.reorder_point) }]
            : [];
        }),
      },
      production: {
        inProgress: count('in_progress') + count('released'),
        late: late.length,
        completedThisMonth: count('completed'),
        lateOrders: late.slice(0, 5).map((m) => ({
          order: { id: m.publicId, number: m.moNo },
          title: m.title,
          dueOn: iso(m.dueOn)!,
          status: m.status,
        })),
      },
      machines: { total: machines[0], down: machines[1].length, oeeYesterdayPct: oee?.oeePct ?? null },
      quality: {
        openNcrs: quality[0],
        overdueNcrs: quality[1],
        checksThisMonth: checks.reduce((a, c) => a + c._count._all, 0),
        passRatePct: decided > 0 ? ((passed * 100) / decided).toFixed(1) : null,
      },
      followUps: { dueToday: follow[0], overdue: follow[1], alerts: follow[2] },
    };
  }

  // ---------------------------------------------------------------------------------------- jobs

  /** D-374, D-383: NCRs past their action date (once a week each) and machines under the OEE threshold yesterday. */
  @ScheduledJob({ name: 'factory_erp.quality_alerts', cron: '35 7 * * *' })
  async qualityCheck(): Promise<number> {
    const t = today();
    const yesterday = addCalendarDays(t, -1);
    const factories = await this.workspace.db.erpFactorySettings.findMany({ include: { factory: true } });
    let raised = 0;
    for (const s of factories) {
      try {
        const ncrs = await this.workspace.db.erpNcr.findMany({
          where: {
            factoryId: s.factoryId,
            status: { in: ['open', 'in_progress'] },
            actionDueOn: { lt: day(t) },
            OR: [{ lastOverdueAlertOn: null }, { lastOverdueAlertOn: { lte: day(addCalendarDays(t, -7)) } }],
          },
          include: { owner: true },
        });
        const oee = await this.oee({ factory: s.factory }, yesterday, yesterday);
        await this.workspace.tx(async (tx) => {
          for (const n of ncrs) {
            raised += Number(
              await this.alerts.raise(tx, {
                factoryId: s.factoryId,
                factoryPublicId: s.factory.publicId,
                kind: 'ncr_overdue',
                dedupeKey: `ncr_overdue:${n.publicId}:${t}`,
                subjectType: 'erp_ncr',
                subjectPublicId: n.publicId,
                payload: {
                  ncrNo: n.ncrNo,
                  title: n.title,
                  owner: n.owner?.displayName ?? '-',
                  dueOn: iso(n.actionDueOn),
                },
                dueOn: iso(n.actionDueOn),
              }),
            );
            await tx.erpNcr.update({ where: { id: n.id }, data: { lastOverdueAlertOn: day(t) } });
          }
          const threshold = dec(s.oeeAlertPct);
          for (const m of oee.machines) {
            const run = m.days[0]?.runMinutes ?? 0;
            if (run === 0 || dec(m.oeePct).gte(threshold)) continue;
            raised += Number(
              await this.alerts.raise(tx, {
                factoryId: s.factoryId,
                factoryPublicId: s.factory.publicId,
                kind: 'oee_low',
                dedupeKey: `oee_low:${m.machine.id}:${yesterday}`,
                subjectType: 'machine',
                subjectPublicId: m.machine.id,
                payload: {
                  machine: m.machine.name,
                  day: yesterday,
                  oeePct: m.oeePct,
                  thresholdPct: threshold.toFixed(0),
                },
                dueOn: null,
              }),
            );
          }
        });
      } catch (e) {
        this.logger.warn(`quality alerts ${s.factory.publicId}: ${(e as Error).message}`);
      }
    }
    return raised;
  }

  /** D-379: the 07:40 summary to whoever reads insight at each factory that has it on. */
  @ScheduledJob({ name: 'factory_erp.daily_summary', cron: '40 7 * * *' })
  async dailySummary(): Promise<number> {
    const factories = await this.workspace.db.erpFactorySettings.findMany({
      where: { dailySummary: true },
      include: { factory: true },
    });
    let sent = 0;
    for (const s of factories) {
      try {
        if (s.factory.status === 'offboarded') continue;
        sent += Number(await this.sendSummary(s.factory));
      } catch (e) {
        this.logger.warn(`daily summary ${s.factory.publicId}: ${(e as Error).message}`);
      }
    }
    return sent;
  }

  /** One factory's summary event; the notification matrix sends it on LINE to the insight roles. */
  async sendSummary(factory: Factory): Promise<boolean> {
    const d = await this.dashboard({ factory });
    const roles = await this.workspace.db.role.findMany({
      where: { scopeType: 'factory', permissions: { some: { permission: { key: 'factory_insight.read' } } } },
      select: { key: true },
    });
    await this.workspace.tx((tx) =>
      this.workspace.recordSystem(tx, factory.publicId, 'erp_daily.summary', 'factory', factory.publicId, {
        day: d.asOf,
        recipientRoles: roles.map((r) => r.key),
        salesMonth: d.sales.invoicedNet,
        salesPct: d.sales.achievementPct ?? '-',
        arOverdue: d.receivables.overdue,
        lateOrders: d.production.late,
        machinesDown: d.machines.down,
        oeePct: d.machines.oeeYesterdayPct ?? '-',
        openNcrs: d.quality.openNcrs,
      }),
    );
    return true;
  }
}
