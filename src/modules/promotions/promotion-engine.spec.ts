import { MoneyDecimal } from '@common/money/money';
import fc from 'fast-check';

import {
  type CartLine,
  type CartOrder,
  evaluatePromotions,
  type PromotionCandidate,
  type PromotionContext,
} from './promotion-engine';

const ctx: PromotionContext = {
  channel: 'web',
  segment: 'new',
  b2b: false,
  firstOrder: true,
  paymentMethod: null,
  zoneCodes: ['bkk'],
  marginFloorPct: '10',
};
const line = (order: number, lineNo: number, net: string, extra: Partial<CartLine> = {}): CartLine => ({
  order,
  line: lineNo,
  lineType: 'product',
  productTypeCode: 'folding_carton',
  categoryCode: 'folding_carton',
  catalogProductId: null,
  quantity: 1000,
  net,
  vatPct: '7',
  ...extra,
});
const promo = (id: string, extra: Partial<PromotionCandidate>): PromotionCandidate => ({
  id,
  kind: 'automatic',
  priority: 100,
  stacking: 'stackable',
  stackGroup: null,
  conditions: {},
  benefit: { type: 'percent', pct: '10' },
  budgetLeft: null,
  ...extra,
});
const orders: CartOrder[] = [{ order: 0, buyCostNet: '5000.00' }];
const sum = (r: ReturnType<typeof evaluatePromotions>) =>
  r.discounts.reduce((a, d) => a.add(d.amount), new MoneyDecimal(0)).toFixed(2);

describe('promotion engine (D-053)', () => {
  it('applies percent with a cap, and fixed amounts spread over matching lines', () => {
    const lines = [line(0, 0, '10000.00'), line(0, 1, '120.00', { lineType: 'shipping' })];
    expect(
      sum(
        evaluatePromotions(
          [promo('p', { benefit: { type: 'percent', pct: '10', maxAmount: '500.00' } })],
          lines,
          orders,
          ctx,
        ),
      ),
    ).toBe('500.00');
    expect(
      sum(
        evaluatePromotions(
          [promo('f', { benefit: { type: 'fixed', amount: '300.00' } })],
          lines,
          orders,
          ctx,
        ),
      ),
    ).toBe('300.00');
    const ship = evaluatePromotions([promo('s', { benefit: { type: 'free_shipping' } })], lines, orders, ctx);
    expect(ship.discounts).toEqual([expect.objectContaining({ line: 1, amount: '120.00' })]);
  });

  it('picks the tier the quantity reaches', () => {
    const tiered = promo('t', {
      benefit: {
        type: 'tiered',
        basis: 'quantity',
        tiers: [
          { min: '500', pct: '5' },
          { min: '1000', pct: '8' },
        ],
      },
    });
    expect(sum(evaluatePromotions([tiered], [line(0, 0, '10000.00')], orders, ctx))).toBe('800.00');
    expect(sum(evaluatePromotions([tiered], [line(0, 0, '10000.00', { quantity: 600 })], orders, ctx))).toBe(
      '500.00',
    );
  });

  it('checks conditions and says which one failed', () => {
    const r = evaluatePromotions(
      [
        promo('ch', { conditions: { channels: ['cs'] } }),
        promo('ret', { conditions: { segments: ['returning'] } }),
        promo('val', { conditions: { minOrderValue: '20000.00' } }),
        promo('ok', { conditions: { productTypeCodes: ['folding_carton'], zoneCodes: ['bkk'] } }),
      ],
      [line(0, 0, '10000.00')],
      orders,
      ctx,
    );
    expect(r.rejected).toEqual([
      { promotionId: 'ch', reason: 'channel' },
      { promotionId: 'ret', reason: 'segment' },
      { promotionId: 'val', reason: 'order_value' },
    ]);
    expect(r.applied).toEqual(['ok']);
  });

  it('lets the best exclusive win alone; otherwise best_of + stackables (best per stack group)', () => {
    const lines = [line(0, 0, '10000.00')];
    const excl = evaluatePromotions(
      [
        promo('e1', { stacking: 'exclusive', benefit: { type: 'fixed', amount: '100.00' } }),
        promo('e2', { stacking: 'exclusive', benefit: { type: 'fixed', amount: '200.00' } }),
        promo('s', { benefit: { type: 'fixed', amount: '300.00' } }),
      ],
      lines,
      orders,
      ctx,
    );
    expect(excl.applied).toEqual(['e2']);
    const mixed = evaluatePromotions(
      [
        promo('b1', { stacking: 'best_of', benefit: { type: 'fixed', amount: '100.00' } }),
        promo('b2', { stacking: 'best_of', benefit: { type: 'fixed', amount: '150.00' } }),
        promo('g1', { stackGroup: 'g', benefit: { type: 'fixed', amount: '50.00' } }),
        promo('g2', { stackGroup: 'g', benefit: { type: 'fixed', amount: '70.00' } }),
      ],
      lines,
      orders,
      ctx,
    );
    expect(mixed.applied.sort()).toEqual(['b2', 'g2']);
    expect(sum(mixed)).toBe('220.00');
  });

  it('caps discounts at the margin floor and reports the capped amount; unknown cost → nothing', () => {
    // net 10,000, buy 8,500, floor 10 % → allowed = 10,000 − 8,500 / 0.9 = 555.56
    const r = evaluatePromotions(
      [promo('big', { benefit: { type: 'fixed', amount: '2000.00' } })],
      [line(0, 0, '10000.00')],
      [{ order: 0, buyCostNet: '8500.00' }],
      ctx,
    );
    expect(r.discounts[0]).toMatchObject({
      amount: '555.56',
      cappedAmount: '1444.44',
      capReason: 'margin_floor',
    });
    const unknown = evaluatePromotions(
      [promo('x', { benefit: { type: 'fixed', amount: '10.00' } })],
      [line(0, 0, '100.00')],
      [{ order: 0, buyCostNet: null }],
      ctx,
    );
    expect(unknown.discounts[0]).toMatchObject({ amount: '0.00', capReason: 'margin_floor' });
  });

  it('caps a promotion at its campaign budget', () => {
    const r = evaluatePromotions(
      [promo('b', { benefit: { type: 'fixed', amount: '300.00' }, budgetLeft: '120.00' })],
      [line(0, 0, '10000.00')],
      orders,
      ctx,
    );
    expect(r.discounts[0]).toMatchObject({ amount: '120.00', cappedAmount: '180.00', capReason: 'budget' });
  });

  const cents = (min: number, max: number) => fc.integer({ min, max }).map((n) => (n / 100).toFixed(2));
  const candidate = fc.record({
    id: fc.string({ minLength: 1, maxLength: 4 }),
    priority: fc.integer({ min: 0, max: 5 }),
    stacking: fc.constantFrom('exclusive', 'stackable', 'best_of'),
    stackGroup: fc.constantFrom(null, 'a', 'b'),
    benefit: fc.oneof(
      fc.record({ type: fc.constant('percent' as const), pct: fc.integer({ min: 1, max: 100 }).map(String) }),
      fc.record({ type: fc.constant('fixed' as const), amount: cents(1, 5_000_000) }),
      fc.constant({ type: 'free_shipping' as const }),
    ),
  });

  it('property: never beyond a line, never below the margin floor, independent of input order', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(candidate, { minLength: 1, maxLength: 6, selector: (c) => c.id }),
        fc.array(cents(100, 10_000_000), { minLength: 1, maxLength: 3 }),
        fc.integer({ min: 0, max: 95 }),
        fc.integer({ min: 0, max: 30 }),
        (raw, nets, costPct, floor) => {
          const candidates = raw.map((c) => promo(c.id, c));
          const lines = nets.flatMap((net, order) => [
            line(order, 0, net),
            line(order, 1, '100.00', { lineType: 'shipping' }),
          ]);
          const os = nets.map((net, order) => ({
            order,
            buyCostNet: new MoneyDecimal(net).mul(costPct).div(100).toFixed(2),
          }));
          const context = { ...ctx, marginFloorPct: String(floor) };
          const r = evaluatePromotions(candidates, lines, os, context);
          const reversed = evaluatePromotions([...candidates].reverse(), lines, os, context);
          expect(reversed.discounts).toEqual(r.discounts);
          for (const l of lines) {
            const taken = r.discounts
              .filter((d) => d.order === l.order && d.line === l.line)
              .reduce((a, d) => a.add(d.amount), new MoneyDecimal(0));
            expect(taken.lte(l.net)).toBe(true);
          }
          for (const o of os) {
            const net = lines
              .filter((l) => l.order === o.order)
              .reduce((a, l) => a.add(l.net), new MoneyDecimal(0));
            const disc = r.discounts
              .filter((d) => d.order === o.order)
              .reduce((a, d) => a.add(d.amount), new MoneyDecimal(0));
            const payable = net.sub(disc);
            if (disc.gt(0)) {
              const margin = payable.sub(o.buyCostNet).div(payable).mul(100);
              expect(margin.gte(new MoneyDecimal(floor).sub('0.01'))).toBe(true);
            }
          }
        },
      ),
    );
  });

  it('property: best_of gives at least what any single best_of promotion gives alone', () => {
    fc.assert(
      fc.property(fc.array(cents(1, 100_000), { minLength: 1, maxLength: 5 }), (amounts) => {
        const candidates = amounts.map((a, i) =>
          promo(`b${i}`, { stacking: 'best_of', benefit: { type: 'fixed', amount: a } }),
        );
        const lines = [line(0, 0, '1000000.00')];
        const os = [{ order: 0, buyCostNet: '0.00' }];
        const together = new MoneyDecimal(sum(evaluatePromotions(candidates, lines, os, ctx)));
        for (const c of candidates)
          expect(together.gte(sum(evaluatePromotions([c], lines, os, ctx)))).toBe(true);
      }),
    );
  });
});
