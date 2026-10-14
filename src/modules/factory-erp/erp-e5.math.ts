import { type MoneyValue } from '@common/money/money';

import { dec, money2 } from './erp.math';

/**
 * E5 arithmetic (D-372 – D-377): a check's result from its checkpoints, a production order's full cost, and a
 * machine's OEE for a day from the shop floor's events — pure, so the services and the tests agree.
 */

// ------------------------------------------------------------------------------------- quality

export type CheckpointType = 'pass_fail' | 'measurement' | 'note';
export type CheckpointOutcome = 'pass' | 'fail' | 'na';
export type CheckResult = 'pending' | 'pass' | 'fail' | 'conditional';

/** D-372: a measurement passes inside its limits (either may be open); no reading → no outcome yet. */
export function measurementOutcome(
  measured: MoneyValue | null,
  min: MoneyValue | null,
  max: MoneyValue | null,
): CheckpointOutcome | null {
  if (measured === null) return null;
  if (min !== null && measured.lt(min)) return 'fail';
  if (max !== null && measured.gt(max)) return 'fail';
  return 'pass';
}

/**
 * D-372: the result a check's checkpoints add up to — any failure fails it; every pass / fail / measurement
 * point answered (n/a counts) passes it; otherwise it is still pending. Notes never decide. A check with no
 * points passes only when nothing was rejected.
 */
export function checkResult(
  points: { type: CheckpointType; outcome: CheckpointOutcome | null }[],
  rejectedQty: MoneyValue = dec(0),
): CheckResult {
  const decisive = points.filter((p) => p.type !== 'note');
  if (decisive.some((p) => p.outcome === 'fail')) return 'fail';
  if (decisive.some((p) => p.outcome === null)) return 'pending';
  return rejectedQty.gt(0) ? 'conditional' : 'pass';
}

// ------------------------------------------------------------------------------------- costing

export interface JobCost {
  material: MoneyValue;
  machine: MoneyValue;
  labour: MoneyValue;
  overhead: MoneyValue;
  total: MoneyValue;
}

/**
 * D-376: materials + run minutes × each machine's hourly rate + run minutes × the labour rate, with the
 * overhead % on top of those three. Minutes without a machine (manual work) carry labour only.
 */
export function jobCost(input: {
  material: MoneyValue;
  runs: { minutes: number; machineRate: MoneyValue | null }[];
  labourRatePerHour: MoneyValue;
  overheadPct: MoneyValue;
}): JobCost {
  let machine = dec(0);
  let minutes = 0;
  for (const r of input.runs) {
    minutes += r.minutes;
    if (r.machineRate) machine = machine.plus(r.machineRate.times(r.minutes).div(60));
  }
  const material = money2(input.material);
  machine = money2(machine);
  const labour = money2(input.labourRatePerHour.times(minutes).div(60));
  const overhead = money2(material.plus(machine).plus(labour).times(input.overheadPct).div(100));
  return { material, machine, labour, overhead, total: material.plus(machine).plus(labour).plus(overhead) };
}

// ------------------------------------------------------------------------------------------ OEE

export interface OpEvent {
  kind: 'start' | 'pause' | 'resume' | 'finish' | 'skip';
  at: number;
  reason?: string | null;
  goodQty?: MoneyValue | null;
  scrapQty?: MoneyValue | null;
}

export interface Segments {
  run: [number, number][];
  pauses: { from: number; to: number; reason: string }[];
}

/**
 * D-353, D-377: an operation's running and paused spans from its events in order — start or resume opens a
 * run, pause closes it and opens a pause, finish or skip closes whatever is open; one still open runs to `now`.
 */
export function operationSegments(events: OpEvent[], now: number): Segments {
  const out: Segments = { run: [], pauses: [] };
  let runFrom: number | null = null;
  let pause: { from: number; reason: string } | null = null;
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    if (e.kind === 'start' || e.kind === 'resume') {
      if (pause) out.pauses.push({ from: pause.from, to: e.at, reason: pause.reason });
      pause = null;
      runFrom ??= e.at;
    } else if (e.kind === 'pause') {
      if (runFrom !== null) out.run.push([runFrom, e.at]);
      runFrom = null;
      pause ??= { from: e.at, reason: e.reason ?? 'other' };
    } else {
      if (runFrom !== null) out.run.push([runFrom, e.at]);
      if (pause) out.pauses.push({ from: pause.from, to: e.at, reason: pause.reason });
      runFrom = null;
      pause = null;
    }
  }
  if (runFrom !== null && now > runFrom) out.run.push([runFrom, now]);
  if (pause && now > pause.from) out.pauses.push({ from: pause.from, to: now, reason: pause.reason });
  return out;
}

/** Minutes of `[a, b]` inside `[from, to]`. */
export function overlapMinutes(a: number, b: number, from: number, to: number): number {
  return Math.max(0, Math.min(b, to) - Math.max(a, from)) / 60_000;
}

export interface Oee {
  availability: number;
  performance: number;
  quality: number;
  oee: number;
}

/**
 * D-377: availability = run ÷ planned time; performance = ideal minutes for what was made ÷ run, capped at
 * 100%; quality = good ÷ (good + scrap). Nothing run → zeros (quality 1 with nothing made). Running beyond the
 * planned time (overtime, a day with no shift) extends the planned time to the run (D-403), so such a day is not 0%.
 */
export function oeeOf(input: {
  plannedMinutes: number;
  runMinutes: number;
  idealMinutes: number;
  good: MoneyValue;
  scrap: MoneyValue;
}): Oee {
  const plannedTime = Math.max(input.plannedMinutes, input.runMinutes);
  const availability = plannedTime > 0 ? input.runMinutes / plannedTime : 0;
  const performance = input.runMinutes > 0 ? Math.min(1, input.idealMinutes / input.runMinutes) : 0;
  const made = input.good.plus(input.scrap);
  const quality = made.gt(0) ? input.good.div(made).toNumber() : 1;
  return { availability, performance, quality, oee: availability * performance * quality };
}

/** A fraction as a percentage string with one decimal ("72.5"). */
export const pct1 = (f: number): string => (Math.round(f * 1000) / 10).toFixed(1);

/** `HH:MM` → minutes after midnight. */
export const clockMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

/** A shift's length; one ending at or before it starts runs past midnight. */
export function shiftMinutes(start: string, end: string): number {
  const s = clockMinutes(start);
  const e = clockMinutes(end);
  return e > s ? e - s : 24 * 60 - s + e;
}
