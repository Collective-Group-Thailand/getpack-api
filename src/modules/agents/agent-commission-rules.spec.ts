import { commissionFor, remainingAfterRefund } from './agent-commission-rules';

const PLAN = { firstOrderPct: '5', repeatOrderPct: '3' };

describe('agent commission without a cap (D-464)', () => {
  it('a large order pays the full rate — no per-order cap, no margin cap', () => {
    const r = commissionFor({
      base: '1080000.00',
      isFirstOrder: true,
      plan: PLAN,
      grossMargin: '144000.00',
      alertPct: '30.00',
    });
    expect(r.amount).toBe('54000.00');
    expect(r.ratePct).toBe('5.0000');
    expect(r.rateSource).toBe('plan');
  });

  it('the margin alert fires but the amount is unchanged', () => {
    const r = commissionFor({
      base: '200000.00',
      isFirstOrder: true,
      plan: PLAN,
      grossMargin: '20000.00',
      alertPct: '30.00',
    });
    expect(r.amount).toBe('10000.00');
    expect(r.marginRatioPct).toBe('50.0000');
    expect(r.marginAlert).toBe(true);
  });

  it('no alert under the threshold; repeat orders use the repeat rate', () => {
    const r = commissionFor({
      base: '50000.00',
      isFirstOrder: false,
      plan: PLAN,
      grossMargin: '15000.00',
      alertPct: '30.00',
    });
    expect(r.amount).toBe('1500.00');
    expect(r.marginRatioPct).toBe('10.0000');
    expect(r.marginAlert).toBe(false);
  });

  it('a negative or zero margin with commission to pay alerts; unknown margin does not', () => {
    expect(
      commissionFor({ base: '1000.00', isFirstOrder: true, plan: PLAN, grossMargin: '-5.00', alertPct: '30' })
        .marginAlert,
    ).toBe(true);
    expect(
      commissionFor({ base: '1000.00', isFirstOrder: true, plan: PLAN, grossMargin: null, alertPct: '30' })
        .marginAlert,
    ).toBe(false);
  });

  it('a rate locked on the quote wins over a later plan version', () => {
    const later = { firstOrderPct: '4', repeatOrderPct: '2' };
    const r = commissionFor({
      base: '600000.00',
      isFirstOrder: true,
      plan: later,
      lock: { firstOrderPct: '5', repeatOrderPct: '3', source: 'deal_registration' },
      grossMargin: '90000.00',
      alertPct: '30.00',
    });
    expect(r.amount).toBe('30000.00');
    expect(r.rateSource).toBe('deal_registration');
  });

  it('refund reversal is proportional to the refunded share of the order', () => {
    expect(remainingAfterRefund('600.00', '0.00', '12840.00')).toBe('600.00');
    expect(remainingAfterRefund('600.00', '3210.00', '12840.00')).toBe('450.00');
    expect(remainingAfterRefund('600.00', '12840.00', '12840.00')).toBe('0.00');
    expect(remainingAfterRefund('600.00', '20000.00', '12840.00')).toBe('0.00');
  });
});
