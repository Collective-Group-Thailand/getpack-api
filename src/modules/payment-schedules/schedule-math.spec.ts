import { MoneyDecimal } from '@common/money/money';
import fc from 'fast-check';

import {
  addSets,
  allocateByGross,
  type AmountSet,
  applyFifo,
  selectTemplate,
  splitByPct,
  ZERO,
} from './schedule-math';

const set = (gross: string, vat: string, wht = '0.00'): AmountSet => {
  const g = new MoneyDecimal(gross);
  return {
    net: g.sub(vat).toFixed(2),
    vat,
    gross,
    wht,
    cash: g.sub(wht).toFixed(2),
  };
};

describe('payment schedule maths (ADR-0008)', () => {
  it('splits 50/50 with the remainder on the last instalment', () => {
    const [a, b] = splitByPct(set('1070.01', '70.01', '30.01'), ['50', '50']);
    expect(a).toEqual({ net: '500.00', vat: '35.01', gross: '535.01', wht: '15.01', cash: '520.00' });
    expect(b).toEqual({ net: '500.00', vat: '35.00', gross: '535.00', wht: '15.00', cash: '520.00' });
    const [c] = splitByPct(set('100.01', '6.55'), ['50', '50']);
    expect(new MoneyDecimal(c!.net).add(c!.vat).toFixed(2)).toBe(c!.gross);
  });

  it('refuses percentages that do not add up to 100 unless renormalised', () => {
    expect(() => splitByPct(set('100.00', '0.00'), ['50', '40'])).toThrow(/100/);
    expect(splitByPct(set('100.00', '0.00'), ['50', '50'], true).map((s) => s.gross)).toEqual([
      '50.00',
      '50.00',
    ]);
  });

  it('allocates to orders by gross with the remainder on the largest', () => {
    const map = allocateByGross(set('100.00', '0.00'), [
      { key: 'a', gross: '1.00' },
      { key: 'b', gross: '2.00' },
    ]);
    expect(map.get('a')!.gross).toBe('33.33');
    expect(map.get('b')!.gross).toBe('66.67');
  });

  it('applies cash FIFO and reports the leftover', () => {
    const result = applyFifo(
      [
        { key: 1, cash: '520.00', gross: '535.01', paid: '0.00' },
        { key: 2, cash: '520.00', gross: '535.00', paid: '0.00' },
      ],
      '600.00',
    );
    expect(result.applications).toEqual([
      { key: 1, cash: '520.00', gross: '535.01', fullyPaid: true },
      { key: 2, cash: '80.00', gross: '82.31', fullyPaid: false },
    ]);
    expect(result.leftover).toBe('0.00');
    expect(applyFifo([{ key: 1, cash: '10.00', gross: '10.00', paid: '0.00' }], '15.00').leftover).toBe(
      '5.00',
    );
  });

  it('selects the first matching template by priority; credit before value (D-020)', () => {
    const candidates = [
      { key: 'full_upfront', priority: 100, rule: { orderValue: { lt: { setting: 't' } } } },
      { key: 'deposit', priority: 100, rule: { orderValue: { gte: { setting: 't' } } } },
      { key: 'credit_term', priority: 10, rule: { creditApproved: true } },
    ];
    const ctx = {
      customerType: 'individual',
      productTypeCodes: [],
      creditApproved: false,
      settings: { t: '20000.00' },
    };
    expect(selectTemplate(candidates, { ...ctx, grossAmount: '19999.99' })!.key).toBe('full_upfront');
    expect(selectTemplate(candidates, { ...ctx, grossAmount: '20000.00' })!.key).toBe('deposit');
    expect(selectTemplate(candidates, { ...ctx, grossAmount: '500.00', creditApproved: true })!.key).toBe(
      'credit_term',
    );
  });

  const cents = (min: number, max: number) => fc.integer({ min, max }).map((n) => (n / 100).toFixed(2));
  const amountSet = fc
    .tuple(cents(1, 100_000_000), fc.integer({ min: 0, max: 7 }), fc.integer({ min: 0, max: 3 }))
    .map(([gross, vatPct, whtPct]) =>
      set(
        gross,
        new MoneyDecimal(gross).mul(vatPct).div(107).toFixed(2),
        new MoneyDecimal(gross).mul(whtPct).div(100).toFixed(2),
      ),
    );

  it('property: instalments and allocations always add up exactly', () => {
    fc.assert(
      fc.property(
        amountSet,
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 5 }),
        fc.array(cents(1, 10_000_000), { minLength: 1, maxLength: 6 }),
        (total, weights, orderGross) => {
          const sum = weights.reduce((a, w) => a + w, 0);
          const pcts = weights.map((w) => new MoneyDecimal(w).mul(100).div(sum).toFixed(4));
          const parts = splitByPct(total, pcts, true);
          expect(parts.reduce(addSets, ZERO)).toEqual(total);
          for (const p of parts) {
            const allocations = allocateByGross(
              p,
              orderGross.map((gross, key) => ({ key, gross })),
            );
            expect([...allocations.values()].reduce(addSets, ZERO)).toEqual(p);
            for (const a of allocations.values())
              expect(new MoneyDecimal(a.net).add(a.vat).toFixed(2)).toBe(a.gross);
          }
          for (const p of parts) expect(new MoneyDecimal(p.net).add(p.vat).toFixed(2)).toBe(p.gross);
        },
      ),
    );
  });

  it('property: FIFO never over-applies and conserves cash', () => {
    fc.assert(
      fc.property(
        fc.array(cents(1, 1_000_000), { minLength: 1, maxLength: 4 }),
        cents(0, 5_000_000),
        (cash, pay) => {
          const instalments = cash.map((c, key) => ({ key, cash: c, gross: c, paid: '0.00' }));
          const { applications, leftover } = applyFifo(instalments, pay);
          const applied = applications.reduce((a, x) => a.add(x.cash), new MoneyDecimal(0));
          expect(applied.add(leftover).toFixed(2)).toBe(new MoneyDecimal(pay).toFixed(2));
          for (const a of applications) expect(new MoneyDecimal(a.cash).lte(cash[a.key]!)).toBe(true);
        },
      ),
    );
  });
});
