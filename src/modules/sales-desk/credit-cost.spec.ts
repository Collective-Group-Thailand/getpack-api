import { creditCost, waterfall } from './discount-approval-rules';

/**
 * D-470 item 9 — GOLDEN: the credit cost estimate of PLAN §7 (owner agreed 2026-11-01). Management figure, never
 * posted. Rounding: each factory leg rounded half-up to the whole baht, then summed (the PLAN's own arithmetic).
 */
describe('credit cost estimate (PLAN §7, golden)', () => {
  it('gives exactly ฿11,399 = 1.06 % for the PLAN example', () => {
    // Net ฿1,080,000; factory cost ฿936,000 paid 50 % at job acceptance (day 0) and 50 % at day 21; the customer
    // pays on day 74 (60-day credit from delivery on day 14); cost of capital 7 %/yr.
    const r = creditCost({
      cashOut: [
        { amount: '468000.00', day: 0 },
        { amount: '468000.00', day: 21 },
      ],
      receipts: [{ amount: '1080000.00', day: 74 }],
      annualPct: '7.00',
    });
    expect(r.legs.map((l) => l.cost)).toEqual(['6642.00', '4757.00']);
    expect(r.legs.map((l) => l.days)).toEqual(['74.00', '53.00']);
    expect(r.amount).toBe('11399.00');
    // As a % of net revenue on the waterfall: 11,399 ÷ 1,080,000 = 1.0555… → 1.06.
    const w = waterfall({
      listRevenue: '1080000.00',
      discountPct: '0',
      factoryCost: '936000.00',
      shippingCharged: null,
      shippingPaid: null,
      vatPct: '7',
      paymentFee: { method: null, pct: null, fixedAmount: null, status: 'not_set' },
      freeServices: '0',
      commissionRatePct: '0',
      minBase: '0',
      creditCost: r.amount,
      badDebt: { pct: null, status: 'not_applicable' },
      floorPct: '10',
    });
    expect([w.creditCost, w.creditCostPct]).toEqual(['11399.00', '1.06']);
  });

  it('is ฿0 with a 50 % deposit and the balance on delivery', () => {
    const r = creditCost({
      cashOut: [
        { amount: '468000.00', day: 0 },
        { amount: '468000.00', day: 21 },
      ],
      receipts: [
        { amount: '540000.00', day: 0 },
        { amount: '540000.00', day: 14 },
      ],
      annualPct: '7.00',
    });
    expect(r.amount).toBe('0.00');
  });

  it('funds legs first-in first-out and stops at the last receipt', () => {
    // A 30 % deposit covers part of the first leg at once; the rest waits for day 74.
    const r = creditCost({
      cashOut: [{ amount: '100000.00', day: 0 }],
      receipts: [
        { amount: '30000.00', day: 0 },
        { amount: '70000.00', day: 365 },
      ],
      annualPct: '10.00',
    });
    // 70,000 × 365 days × 10 % ÷ 365 = 7,000.
    expect(r.amount).toBe('7000.00');
    expect(creditCost({ cashOut: [], receipts: [], annualPct: '7' }).amount).toBe('0.00');
  });
});
