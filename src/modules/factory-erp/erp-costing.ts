import { type MoneyValue } from '@common/money/money';
import { type ErpPrismaService, type ErpTx } from '@database/erp-prisma.service';
import { type ErpFactorySettings, type Prisma } from '@generated/prisma-erp/client';

import { dec, fmtMoney, money2 } from './erp.math';
import { jobCost, operationSegments, type OpEvent } from './erp-e5.math';

// D-376 job costing, apart from ErpInsightService so production and ledger posting can use it without importing
// the insight service's dependencies (which import production back).

type Db = ErpTx | ErpPrismaService;

export const MO_COST_INCLUDE = {
  item: true,
  operations: { include: { machine: true, events: true }, orderBy: { seq: 'asc' } },
} as const;
export type MoCostRow = Prisma.ErpProductionOrderGetPayload<{ include: typeof MO_COST_INCLUDE }>;

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
