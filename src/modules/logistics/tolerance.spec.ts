import { evaluateTolerance } from './tolerance';

const base = {
  ordered: 1000,
  shortagePct: '5',
  overagePct: '5',
  productNet: '10000.00',
  productVat: '700.00',
};

describe('evaluateTolerance (D-021, D-080, D-165)', () => {
  it('exact delivery: nothing to settle', () => {
    expect(evaluateTolerance({ ...base, delivered: 1000 })).toEqual({
      outcome: 'exact',
      payable: 1000,
      deviationPct: '0.0000',
      credit: null,
    });
  });

  it('shortage within tolerance: pro-rata credit of net and VAT, factory paid what arrived', () => {
    expect(evaluateTolerance({ ...base, delivered: 970 })).toEqual({
      outcome: 'shortage_within',
      payable: 970,
      deviationPct: '-3.0000',
      credit: { net: '300.00', vat: '21.00', gross: '321.00' },
    });
  });

  it('shortage exactly at the limit is within', () => {
    expect(evaluateTolerance({ ...base, delivered: 950 }).outcome).toBe('shortage_within');
  });

  it('shortage beyond the limit: automatic claim, no credit here', () => {
    expect(evaluateTolerance({ ...base, delivered: 949 })).toMatchObject({
      outcome: 'shortage_outside',
      payable: 949,
      credit: null,
    });
  });

  it('overage within tolerance: not charged, factory paid the ordered quantity only (D-165)', () => {
    expect(evaluateTolerance({ ...base, delivered: 1050 })).toEqual({
      outcome: 'overage_within',
      payable: 1000,
      deviationPct: '5.0000',
      credit: null,
    });
  });

  it('overage beyond the limit: automatic claim', () => {
    expect(evaluateTolerance({ ...base, delivered: 1051 }).outcome).toBe('overage_outside');
  });

  it('rounds the credit half-up to satang', () => {
    const r = evaluateTolerance({
      ...base,
      ordered: 3000,
      delivered: 2999,
      productNet: '1000.00',
      productVat: '70.00',
    });
    expect(r.credit).toEqual({ net: '0.33', vat: '0.02', gross: '0.35' });
  });

  it('no tolerance: any shortage is outside', () => {
    expect(evaluateTolerance({ ...base, shortagePct: '0', delivered: 999 }).outcome).toBe('shortage_outside');
  });

  it('refuses nonsense quantities', () => {
    expect(() => evaluateTolerance({ ...base, ordered: 0, delivered: 0 })).toThrow(RangeError);
    expect(() => evaluateTolerance({ ...base, delivered: -1 })).toThrow(RangeError);
  });
});
