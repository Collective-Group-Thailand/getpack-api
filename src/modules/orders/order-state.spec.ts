import { applyFact, groupStatusOf, type OrderFact, type OrderFacts, statusOf } from './order-state';

const none: OrderFacts = {
  paidForProductionAt: null,
  artworkApprovedAt: null,
  productionStartedAt: null,
  shippedAt: null,
  deliveredAt: null,
  completedAt: null,
  cancelledAt: null,
};
const at = new Date('2026-10-01T03:00:00Z');

function run(facts: OrderFact[]) {
  let state = none;
  for (const fact of facts) {
    const result = applyFact(state, fact, at);
    if (!result.ok) return { error: result.reason, status: statusOf(state) };
    if (result.changed) state = result.facts;
  }
  return { error: null, status: statusOf(state) };
}

describe('order state (facts → status, B3.1)', () => {
  it.each<[string, OrderFact[], string]>([
    ['nothing yet', [], 'waiting_payment'],
    ['deposit paid', [{ kind: 'paid_for_production' }], 'paid_for_production'],
    ['artwork before payment keeps waiting', [{ kind: 'artwork_approved' }], 'waiting_payment'],
    ['artwork then payment', [{ kind: 'artwork_approved' }, { kind: 'paid_for_production' }], 'artwork_approved'],
    [
      'the whole happy path',
      [
        { kind: 'paid_for_production' },
        { kind: 'artwork_approved' },
        { kind: 'production_started', mode: 'auto' },
        { kind: 'shipped' },
        { kind: 'delivered' },
        { kind: 'completed', mode: 'auto_after_days' },
      ],
      'completed',
    ],
    ['delivered stays shipping until completion (A-9)', [{ kind: 'paid_for_production' }, { kind: 'artwork_approved' }, { kind: 'production_started', mode: 'auto' }, { kind: 'shipped' }, { kind: 'delivered' }], 'shipping'],
    ['cancel before production', [{ kind: 'paid_for_production' }, { kind: 'cancelled' }], 'cancelled'],
    ['repeated facts are no-ops', [{ kind: 'paid_for_production' }, { kind: 'paid_for_production' }], 'paid_for_production'],
  ])('%s', (_name, facts, status) => {
    expect(run(facts)).toEqual({ error: null, status });
  });

  it.each<[string, OrderFact[], RegExp]>([
    ['production before payment (D-073)', [{ kind: 'artwork_approved' }, { kind: 'production_started', mode: 'auto' }], /unpaid/],
    ['automatic production before artwork', [{ kind: 'paid_for_production' }, { kind: 'production_started', mode: 'auto' }], /artwork/],
    ['shipping before production', [{ kind: 'paid_for_production' }, { kind: 'shipped' }], /production/],
    ['completion before delivery', [{ kind: 'completed', mode: 'customer_confirmed' }], /delivered/],
    ['anything after cancel', [{ kind: 'cancelled' }, { kind: 'paid_for_production' }], /cancelled/],
    [
      'cancel after production started',
      [{ kind: 'paid_for_production' }, { kind: 'artwork_approved' }, { kind: 'production_started', mode: 'auto' }, { kind: 'cancelled' }],
      /production already started/,
    ],
  ])('refuses %s', (_name, facts, reason) => {
    expect(run(facts).error).toMatch(reason);
  });

  it('lets CS start production as a documented exception before artwork, never before payment (D-073)', () => {
    expect(run([{ kind: 'paid_for_production' }, { kind: 'production_started', mode: 'manual_exception' }]).status).toBe(
      'in_production',
    );
    expect(run([{ kind: 'production_started', mode: 'manual_exception' }]).error).toMatch(/unpaid/);
  });

  it('derives the group status from its orders', () => {
    expect(groupStatusOf('waiting_payment', ['waiting_payment', 'waiting_payment'])).toBe('waiting_payment');
    expect(groupStatusOf('waiting_payment', ['paid_for_production', 'waiting_payment'])).toBe('in_progress');
    expect(groupStatusOf('in_progress', ['completed', 'cancelled'])).toBe('completed');
    expect(groupStatusOf('waiting_payment', ['cancelled', 'cancelled'])).toBe('cancelled');
    expect(groupStatusOf('waiting_payment', ['cancelled', 'waiting_payment'])).toBe('waiting_payment');
    expect(groupStatusOf('pending_company_approval', ['waiting_payment'])).toBe('pending_company_approval');
    expect(groupStatusOf('pending_company_approval', ['cancelled', 'cancelled'])).toBe('cancelled');
  });
});
