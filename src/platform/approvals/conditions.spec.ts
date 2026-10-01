import { APPROVAL_POLICIES } from '../../../prisma/seed/data/approval-policies';
import { conditionProblems, evaluateCondition } from './conditions';

const discountSteps = APPROVAL_POLICIES.find((p) => p.key === 'discount_memo')!.steps;
const routeDiscount = (pct: string, flags: string[] = []) =>
  discountSteps.filter((s) => evaluateCondition(s.condition, { pct, flags })).map((s) => s.role);

describe('approval step conditions (ADR-0006)', () => {
  it('routes discount memos to exactly the matching tier (D-052, D-162)', () => {
    expect(routeDiscount('5')).toEqual([]); // CS decides alone up to 5 %
    expect(routeDiscount('5.01')).toEqual(['director']);
    expect(routeDiscount('10')).toEqual(['director']);
    expect(routeDiscount('10.5')).toEqual(['vp']);
    expect(routeDiscount('15')).toEqual(['vp']);
    expect(routeDiscount('15.01')).toEqual(['c_level']);
    expect(routeDiscount('3', ['below_margin_floor'])).toEqual(['c_level']);
    expect(routeDiscount('8', ['below_margin_floor'])).toEqual(['c_level']);
  });

  it('property: every discount above 5 % routes to exactly one tier', () => {
    for (let i = 0; i < 2000; i++) {
      const pct = (5 + Math.random() * 90).toFixed(2);
      if (pct === '5.00') continue;
      const floor = Math.random() < 0.3 ? ['below_margin_floor'] : [];
      expect(routeDiscount(pct, floor)).toHaveLength(1);
    }
  });

  it('routes credit limits by amount with exact decimal comparison (D-121)', () => {
    const steps = APPROVAL_POLICIES.find((p) => p.key === 'credit_limit')!.steps;
    const route = (amount: string) =>
      steps.filter((s) => evaluateCondition(s.condition, { amount })).map((s) => s.role);
    expect(route('100000.00')).toEqual(['finance']);
    expect(route('100000.01')).toEqual(['c_level']);
    expect(route('0.00')).toEqual(['finance']);
  });

  it('resolves references supplied by the requesting module (D-123)', () => {
    const condition = { field: 'amount', op: 'gt', ref: 'company.order_approval_threshold' };
    expect(
      evaluateCondition(condition, {
        amount: '50000.00',
        refs: { 'company.order_approval_threshold': '20000.00' },
      }),
    ).toBe(true);
    expect(
      evaluateCondition(condition, {
        amount: '10000.00',
        refs: { 'company.order_approval_threshold': '20000.00' },
      }),
    ).toBe(false);
    expect(evaluateCondition(condition, { amount: '50000.00' })).toBe(false); // missing ref → fail closed
  });

  it('fails closed on missing fields, unknown operators and malformed conditions', () => {
    expect(evaluateCondition({ field: 'amount', op: 'gt', value: '1' }, {})).toBe(false);
    expect(evaluateCondition({ field: 'amount', op: 'approx', value: '1' }, { amount: '2' })).toBe(false);
    expect(evaluateCondition({ field: 'nonsense', op: 'eq', value: 'x' }, {})).toBe(false);
    expect(evaluateCondition({ all: [] }, {})).toBe(false);
    expect(evaluateCondition('yes', {})).toBe(false);
    expect(evaluateCondition(null, {})).toBe(true); // no condition = always
  });

  it('reads payload paths and compares strings for equality', () => {
    const ctx = { payload: { factory: { tier: 'A' }, count: 3 } };
    expect(evaluateCondition({ field: 'payload.factory.tier', op: 'eq', value: 'A' }, ctx)).toBe(true);
    expect(evaluateCondition({ field: 'payload.count', op: 'gte', value: 3 }, ctx)).toBe(true);
    expect(evaluateCondition({ field: 'payload.missing.deep', op: 'eq', value: 'A' }, ctx)).toBe(false);
  });
});

describe('proposed step conditions (U-B0.3)', () => {
  it('accepts the shapes the seeds use', () => {
    for (const policy of APPROVAL_POLICIES)
      for (const step of policy.steps) expect(conditionProblems(step.condition ?? null)).toEqual([]);
    expect(conditionProblems(null)).toEqual([]);
    expect(conditionProblems({ field: 'amount', op: 'lte', value: '100000.00' })).toEqual([]);
    expect(
      conditionProblems({
        any: [
          { field: 'pct', op: 'gt', value: '15' },
          { field: 'flags', op: 'includes', value: 'below_margin_floor' },
        ],
      }),
    ).toEqual([]);
    expect(conditionProblems({ field: 'amount', op: 'gt', ref: 'company.order_approval_threshold' })).toEqual(
      [],
    );
  });

  it('names what is wrong', () => {
    expect(conditionProblems({ field: 'price', op: 'gt', value: 1 })).toEqual([
      'condition.field: amount, pct, flags, entity or payload.<path>',
    ]);
    expect(conditionProblems({ all: [] })).toEqual(['condition.all: a non-empty list']);
    expect(conditionProblems({ field: 'amount', op: 'between', value: 1, ref: 'x' })).toHaveLength(2);
    expect(conditionProblems([1])).toEqual(['condition: an object or null']);
  });
});
