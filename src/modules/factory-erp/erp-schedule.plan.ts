/**
 * The machine schedule's planner (D-352) — pure, so it is unit tested without a database or a calendar. Time
 * is in milliseconds; `add(start, minutes)` walks forward in business time (D-292) and `add(t, 0)` moves a
 * moment out of hours to the next opening.
 */

export interface PlanOperation {
  id: bigint;
  orderId: bigint;
  seq: number;
  machineId: bigint | null;
  minutes: number;
  /** Order ranking: higher priority, earlier due, older order first. */
  priority: number;
  dueOn: string | null;
  orderRank: bigint;
  /** Already placed and kept: in progress, paused or locked. */
  fixed: { start: number; end: number } | null;
  /** Done or skipped: only orders the next operations of its order. */
  finishedAt: number | null;
}

export interface Busy {
  machineId: bigint;
  start: number;
  end: number;
}

export interface Placement {
  id: bigint;
  start: number;
  end: number;
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && b.start < a.end;

/**
 * Places every operation that is not fixed or finished, forward from `now`: orders by priority / due / age,
 * each operation after its order's previous one and on its machine in the first gap that fits around what is
 * busy there (fixed operations, maintenance windows and what was placed before it). Operations without a
 * machine only follow their order.
 */
export function planSchedule(
  operations: PlanOperation[],
  busy: Busy[],
  now: number,
  add: (start: number, minutes: number) => number,
): Placement[] {
  const byMachine = new Map<bigint, { start: number; end: number }[]>();
  const occupy = (machineId: bigint, slot: { start: number; end: number }) =>
    byMachine.set(machineId, [...(byMachine.get(machineId) ?? []), slot]);
  for (const b of busy) occupy(b.machineId, b);
  for (const o of operations) if (o.fixed && o.machineId !== null) occupy(o.machineId, o.fixed);

  const orders = new Map<bigint, PlanOperation[]>();
  for (const o of operations) orders.set(o.orderId, [...(orders.get(o.orderId) ?? []), o]);
  const ranked = [...orders.values()]
    .map((ops) => ops.sort((a, b) => a.seq - b.seq))
    .sort((a, b) => {
      const x = a[0]!;
      const y = b[0]!;
      return (
        y.priority - x.priority ||
        (x.dueOn ?? '9999-12-31').localeCompare(y.dueOn ?? '9999-12-31') ||
        (x.orderRank < y.orderRank ? -1 : x.orderRank > y.orderRank ? 1 : 0)
      );
    });

  const out: Placement[] = [];
  for (const ops of ranked) {
    let ready = now;
    for (const o of ops) {
      if (o.finishedAt !== null) {
        ready = Math.max(ready, o.finishedAt);
        continue;
      }
      if (o.fixed) {
        ready = Math.max(ready, o.fixed.end);
        continue;
      }
      let start = add(ready, 0);
      let end = add(start, o.minutes);
      if (o.machineId !== null) {
        const slots = (byMachine.get(o.machineId) ?? []).sort((a, b) => a.start - b.start);
        for (let guard = 0; guard < 10_000; guard++) {
          const clash = slots.find((s) => overlaps(s, { start, end: Math.max(end, start + 1) }));
          if (!clash) break;
          start = add(clash.end, 0);
          end = add(start, o.minutes);
        }
        occupy(o.machineId, { start, end: Math.max(end, start) });
      }
      out.push({ id: o.id, start, end });
      ready = end;
    }
  }
  return out;
}
