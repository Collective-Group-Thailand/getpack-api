import { absorbable, allocate, breakPrice, dec, maintenanceDue, priceRise, supplierScore } from './erp.math';
import { type PlanOperation, planSchedule } from './erp-schedule.plan';

describe('Factory ERP E2.1 / E3 arithmetic', () => {
  it('takes the largest quantity break not above the quantity (D-346)', () => {
    const breaks = [
      { minQty: dec(10), unitPrice: dec(1425) },
      { minQty: dec(50), unitPrice: dec(1380) },
      { minQty: dec(100), unitPrice: dec(1350) },
    ];
    expect(breakPrice(breaks, dec(5))).toBeNull();
    expect(breakPrice(breaks, dec(10))!.toFixed(0)).toBe('1425');
    expect(breakPrice(breaks, dec(99.5))!.toFixed(0)).toBe('1380');
    expect(breakPrice(breaks, dec(250))!.toFixed(0)).toBe('1350');
  });

  it('flags a price more than the threshold above the last paid (D-347)', () => {
    expect(priceRise(dec('3.05'), dec('2.85'), dec(5))!.toFixed(2)).toBe('7.02');
    expect(priceRise(dec('2.99'), dec('2.85'), dec(5))).toBeNull();
    expect(priceRise(dec('3.05'), null, dec(5))).toBeNull();
  });

  it('allocates satang by largest remainder, all of it (D-350)', () => {
    const parts = allocate(dec('100.00'), [dec(1), dec(1), dec(1)]);
    expect(parts.map((p) => p.toFixed(2))).toEqual(['33.34', '33.33', '33.33']);
    expect(allocate(dec('1200'), [dec('14250'), dec('0'), dec('5750')]).map((p) => p.toFixed(2))).toEqual([
      '855.00',
      '0.00',
      '345.00',
    ]);
    expect(allocate(dec('10'), [dec(0), dec(0)]).map((p) => p.toFixed(2))).toEqual(['5.00', '5.00']);
  });

  it('absorbs a later charge only for what is still on hand (D-350)', () => {
    expect(absorbable(dec(1200), dec(5000), dec(5000)).toFixed(2)).toBe('1200.00');
    expect(absorbable(dec(1200), dec(2500), dec(5000)).toFixed(2)).toBe('600.00');
    expect(absorbable(dec(1200), dec(0), dec(5000)).toFixed(2)).toBe('0.00');
  });

  it('scores a supplier 60 % quality + 40 % on time, from 3 receipts (D-349)', () => {
    const s = supplierScore({
      receipts: 6,
      deliveredValue: dec('84200'),
      acceptedValue: dec('83350'),
      onTime: 5,
      timed: 6,
    });
    expect(s.qualityPct!.toFixed(2)).toBe('98.99');
    expect(s.onTimePct!.toFixed(2)).toBe('83.33');
    expect(s.score!.toFixed(2)).toBe('92.73');
    expect(s.grade).toBe('B');
    expect(
      supplierScore({ receipts: 2, deliveredValue: dec(1), acceptedValue: dec(1), onTime: 2, timed: 2 })
        .grade,
    ).toBeNull();
  });

  it('opens preventive maintenance at 3 days or 10 % of impressions left (D-355)', () => {
    expect(
      maintenanceDue({ everyDays: 30, everyImpressions: null, daysSince: 26, impressionsSince: 0 }).due,
    ).toBe(false);
    expect(
      maintenanceDue({ everyDays: 30, everyImpressions: null, daysSince: 27, impressionsSince: 0 }).due,
    ).toBe(true);
    const imp = maintenanceDue({
      everyDays: null,
      everyImpressions: 500_000,
      daysSince: 5,
      impressionsSince: 455_000,
    });
    expect(imp).toEqual({ daysLeft: null, impressionsLeft: 45_000, due: true });
  });
});

describe('Machine schedule planner (D-352)', () => {
  // A plain clock: 1 business minute = 1 ms, every moment open.
  const add = (start: number, minutes: number) => start + minutes;
  const op = (p: Partial<PlanOperation> & { id: bigint; orderId: bigint; seq: number }): PlanOperation => ({
    machineId: 1n,
    minutes: 10,
    priority: 0,
    dueOn: null,
    orderRank: p.orderId,
    fixed: null,
    finishedAt: null,
    ...p,
  });

  it('places operations in order, after their predecessor, around busy time and by priority', () => {
    const placed = planSchedule(
      [
        op({ id: 1n, orderId: 1n, seq: 10 }),
        op({ id: 2n, orderId: 1n, seq: 20, machineId: 2n }),
        op({ id: 3n, orderId: 2n, seq: 10, priority: 5 }),
        op({ id: 4n, orderId: 3n, seq: 10, fixed: { start: 0, end: 15 } }),
      ],
      [{ machineId: 2n, start: 30, end: 40 }],
      0,
      add,
    );
    const at = (id: bigint) => placed.find((p) => p.id === id)!;
    expect(placed.find((p) => p.id === 4n)).toBeUndefined();
    expect(at(3n)).toEqual({ id: 3n, start: 15, end: 25 });
    expect(at(1n)).toEqual({ id: 1n, start: 25, end: 35 });
    expect(at(2n)).toEqual({ id: 2n, start: 40, end: 50 });
  });

  it('starts after what is already done and ignores machine capacity without a machine', () => {
    const placed = planSchedule(
      [
        op({ id: 1n, orderId: 1n, seq: 10, finishedAt: 100 }),
        op({ id: 2n, orderId: 1n, seq: 20, machineId: null }),
        op({ id: 3n, orderId: 2n, seq: 10, machineId: null }),
      ],
      [],
      50,
      add,
    );
    expect(placed).toEqual([
      { id: 2n, start: 100, end: 110 },
      { id: 3n, start: 50, end: 60 },
    ]);
  });
});
