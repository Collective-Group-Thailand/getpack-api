import {
  agingBucket,
  basePrice,
  changePct,
  dec,
  finishedUnitCost,
  matchLine,
  materialRequirement,
  operationMinutes,
  priceSpread,
  roundToPurchase,
  withholding,
} from './erp.math';

describe('getpack Factory ERP E1.1 supplier prices (D-334, D-335)', () => {
  it('compares suppliers per base unit', () => {
    expect(basePrice(dec('1425'), dec('500')).toFixed(6)).toBe('2.850000');
    expect(basePrice(dec('3'), dec('1')).toFixed(6)).toBe('3.000000');
  });

  it('measures the change from the previous purchase', () => {
    expect(changePct(dec('2.99'), dec('2.85'))!.toFixed(2)).toBe('4.91');
    expect(changePct(dec('2.85'), null)).toBeNull();
    expect(changePct(dec('2.85'), dec('0'))).toBeNull();
  });

  it('weights the average by quantity and finds the spread', () => {
    const s = priceSpread([
      { baseUnitPrice: dec('2.80'), quantity: dec('5000') },
      { baseUnitPrice: dec('3.00'), quantity: dec('15000') },
    ])!;
    expect([s.min.toFixed(2), s.max.toFixed(2), s.avg.toFixed(6)]).toEqual(['2.80', '3.00', '2.950000']);
    expect(priceSpread([])).toBeNull();
    expect(
      priceSpread([
        { baseUnitPrice: dec('2'), quantity: null },
        { baseUnitPrice: dec('4'), quantity: null },
      ])!.avg.toFixed(2),
    ).toBe('3.00');
  });

  it('rounds up to whole purchase units and the minimum order', () => {
    const a = roundToPurchase(dec('10001'), dec('500'), null);
    expect([a.purchaseQty.toFixed(3), a.baseQty.toFixed(3)]).toEqual(['21.000', '10500.000']);
    const b = roundToPurchase(dec('1000'), dec('500'), dec('10'));
    expect([b.purchaseQty.toFixed(3), b.baseQty.toFixed(3)]).toEqual(['10.000', '5000.000']);
  });
});

describe('getpack Factory ERP E2 supplier invoices (D-337)', () => {
  const base = {
    invoicedQty: dec('10'),
    previouslyInvoiced: dec('0'),
    receivedQty: dec('10'),
    unitPrice: dec('1425'),
    orderedPrice: dec('1425'),
    tolerancePct: dec('2'),
  };
  it('matches within the tolerance', () => {
    expect(matchLine(base)).toBeNull();
    expect(matchLine({ ...base, unitPrice: dec('1453.50') })).toBeNull();
  });
  it('flags price, quantity, both and unordered lines', () => {
    expect(matchLine({ ...base, unitPrice: dec('1454') })).toBe('price');
    expect(matchLine({ ...base, previouslyInvoiced: dec('1') })).toBe('quantity');
    expect(matchLine({ ...base, invoicedQty: dec('12'), unitPrice: dec('1500') })).toBe('price_quantity');
    expect(matchLine({ ...base, receivedQty: null, orderedPrice: null })).toBe('unordered');
  });
  it('withholds on the amount before VAT', () => {
    expect(withholding(dec('28500'), dec('3')).toFixed(2)).toBe('855.00');
    expect(withholding(dec('333.33'), dec('1')).toFixed(2)).toBe('3.33');
  });
  it('ages by days past due', () => {
    expect(agingBucket('2026-10-10', '2026-10-10')).toBe('current');
    expect(agingBucket('2026-10-10', '2026-10-11')).toBe('d1_30');
    expect(agingBucket('2026-09-10', '2026-10-11')).toBe('d31_60');
    expect(agingBucket('2026-08-01', '2026-10-11')).toBe('d61_90');
    expect(agingBucket('2026-07-01', '2026-10-11')).toBe('over90');
  });
});

describe('getpack Factory ERP E2 production (D-339, D-341)', () => {
  it('scales a recipe to the order and grosses up for scrap', () => {
    expect(materialRequirement(dec('1'), dec('1'), dec('1000'), dec('0')).toFixed(3)).toBe('1000.000');
    expect(materialRequirement(dec('0.125'), dec('1'), dec('1000'), dec('5')).toFixed(3)).toBe('131.579');
    expect(materialRequirement(dec('2'), dec('100'), dec('150'), dec('0')).toFixed(3)).toBe('3.000');
  });
  it('plans setup plus run time', () => {
    expect(operationMinutes(30, dec('1000'), dec('2500'))).toBe(180);
    expect(operationMinutes(15, null, dec('2500'))).toBe(15);
  });
  it('costs finished goods at the materials consumed', () => {
    expect(finishedUnitCost(dec('2850'), dec('950')).toFixed(6)).toBe('3.000000');
    expect(finishedUnitCost(dec('2850'), dec('0')).toFixed(6)).toBe('0.000000');
  });
});
