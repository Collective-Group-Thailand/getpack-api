import {
  applyMovement,
  type BalanceState,
  dec,
  documentTotals,
  lineAmount,
  purchaseUnitCost,
  receivableUpTo,
  reorderQuantity,
  toBase,
} from './erp.math';

const empty: BalanceState = { onHand: dec(0), avgCost: dec(0), value: dec(0) };
const s = (b: BalanceState) => ({
  onHand: b.onHand.toFixed(3),
  avgCost: b.avgCost.toFixed(6),
  value: b.value.toFixed(2),
});

describe('Packio Factory ERP arithmetic (D-321 moving average)', () => {
  it('takes the first receipt at its cost', () => {
    const r = applyMovement(empty, dec(1000), { unitCost: dec('28.5') });
    expect(s(r.after)).toEqual({ onHand: '1000.000', avgCost: '28.500000', value: '28500.00' });
    expect(r.value.toFixed(2)).toBe('28500.00');
  });

  it('averages a second receipt at another cost', () => {
    const first = applyMovement(empty, dec(1000), { unitCost: dec(28) }).after;
    const r = applyMovement(first, dec(500), { unitCost: dec(31) });
    // (28 000 + 15 500) / 1 500 = 29.0
    expect(s(r.after)).toEqual({ onHand: '1500.000', avgCost: '29.000000', value: '43500.00' });
  });

  it('issues at the average and keeps it', () => {
    const stock = applyMovement(empty, dec(3), { unitCost: dec(10) }).after;
    const more = applyMovement(stock, dec(4), { unitCost: dec(11) }).after; // 74 / 7 = 10.571429
    const out = applyMovement(more, dec(-2));
    expect(out.unitCost.toFixed(6)).toBe('10.571429');
    expect(out.value.toFixed(2)).toBe('-21.14');
    expect(s(out.after)).toEqual({ onHand: '5.000', avgCost: '10.571429', value: '52.86' });
  });

  it('takes the whole remaining value when a balance is emptied (no residue)', () => {
    const stock = applyMovement(empty, dec(3), { unitCost: dec(10) }).after;
    const more = applyMovement(stock, dec(4), { unitCost: dec(11) }).after;
    const out = applyMovement(more, dec(-7));
    expect(out.value.toFixed(2)).toBe('-74.00');
    expect(s(out.after)).toEqual({ onHand: '0.000', avgCost: '10.571429', value: '0.00' });
  });

  it('returns and positive counts enter at the current average, or the fallback cost on an empty balance', () => {
    const stock = applyMovement(empty, dec(10), { unitCost: dec(5) }).after;
    expect(applyMovement(stock, dec(2)).unitCost.toFixed(6)).toBe('5.000000');
    expect(applyMovement(empty, dec(2), { fallbackCost: dec(7) }).after.avgCost.toFixed(6)).toBe('7.000000');
    expect(applyMovement(empty, dec(2)).after.value.toFixed(2)).toBe('0.00');
  });

  it('re-values a negative balance at the incoming cost (D-322 relaxed)', () => {
    const stock = applyMovement(empty, dec(2), { unitCost: dec(10) }).after;
    const negative = applyMovement(stock, dec(-5)).after;
    expect(s(negative)).toEqual({ onHand: '-3.000', avgCost: '10.000000', value: '-30.00' });
    const refilled = applyMovement(negative, dec(10), { unitCost: dec(12) }).after;
    expect(s(refilled)).toEqual({ onHand: '7.000', avgCost: '12.000000', value: '84.00' });
  });

  it('refuses a zero movement', () => {
    expect(() => applyMovement(empty, dec(0))).toThrow(RangeError);
  });
});

describe('purchase documents (D-325)', () => {
  it('converts purchase units to base units', () => {
    expect(toBase(dec(3), dec(500)).toFixed(3)).toBe('1500.000');
    expect(toBase(dec('1.25'), dec(1000)).toFixed(3)).toBe('1250.000');
  });

  it('prices a line with a discount', () => {
    expect(lineAmount(dec(10), dec('1250.50'), dec(5)).toFixed(2)).toBe('11879.75');
  });

  it('totals exclusive, inclusive and no-VAT documents', () => {
    const amounts = [dec('1000.00'), dec('70.00')];
    const t = (m: 'exclusive' | 'inclusive' | 'none') => {
      const r = documentTotals(amounts, m, dec(7));
      return [r.subtotal.toFixed(2), r.vatAmount.toFixed(2), r.total.toFixed(2)];
    };
    expect(t('exclusive')).toEqual(['1070.00', '74.90', '1144.90']);
    expect(t('inclusive')).toEqual(['1000.00', '70.00', '1070.00']);
    expect(t('none')).toEqual(['1070.00', '0.00', '1070.00']);
  });

  it('costs a purchase unit without VAT for a VAT-registered factory and with VAT otherwise (D-321)', () => {
    const c = (mode: 'exclusive' | 'inclusive' | 'none', registered: boolean) =>
      purchaseUnitCost(dec(107), dec(0), mode, dec(7), registered).toDecimalPlaces(6).toFixed(6);
    expect(c('inclusive', true)).toBe('100.000000');
    expect(c('exclusive', true)).toBe('107.000000');
    expect(c('exclusive', false)).toBe('114.490000');
    expect(c('inclusive', false)).toBe('107.000000');
    expect(c('none', true)).toBe('107.000000');
    expect(purchaseUnitCost(dec(100), dec(10), 'none', dec(7), true).toFixed(2)).toBe('90.00');
  });

  it('limits receiving to the ordered quantity plus the tolerance', () => {
    expect(receivableUpTo(dec(100), dec(0), dec(10)).toFixed(3)).toBe('110.000');
    expect(receivableUpTo(dec(100), dec(60), dec(0)).toFixed(3)).toBe('40.000');
  });
});

describe('reorder suggestions (D-326)', () => {
  it('suggests nothing above the reorder point', () => {
    expect(reorderQuantity(dec(501), dec(500), dec(1000), dec(1)).toFixed(3)).toBe('0.000');
  });

  it('suggests the reorder quantity, rounded up to whole purchase units', () => {
    // 600 kg wanted, bought by the 250 kg roll → 3 rolls = 750 kg
    expect(reorderQuantity(dec(400), dec(500), dec(600), dec(250)).toFixed(3)).toBe('750.000');
  });

  it('covers the shortfall when it is larger than the reorder quantity', () => {
    expect(reorderQuantity(dec(-200), dec(500), dec(100), dec(1)).toFixed(3)).toBe('700.000');
  });

  it('orders at least one purchase unit at the reorder point', () => {
    expect(reorderQuantity(dec(500), dec(500), null, dec(500)).toFixed(3)).toBe('500.000');
  });
});
