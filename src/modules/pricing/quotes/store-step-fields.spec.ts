import { type QuoteStepView } from './quote-engine.service';
import { netAmountOf, savingPercents, storeStepFields, vatRateOf } from './store-step-fields';

const step = (
  quantity: number,
  unitPrice: string | null,
  extra: Partial<QuoteStepView> = {},
): QuoteStepView =>
  ({
    quantity,
    instant: unitPrice !== null,
    reason: unitPrice === null ? 'not_instant' : null,
    unitPrice,
    vatAmount: unitPrice === null ? null : '1.00',
    grossAmount: unitPrice === null ? null : '15.00',
    shippingAmount: null,
    earliestDeliveryDate: null,
    internal: null,
    ...extra,
  }) as QuoteStepView;

describe('C4-API-2 store step fields', () => {
  it('savingPercent: vs the smallest priced tier, half-up to a whole number', () => {
    // (1 − 12.00/13.38) × 100 = 10.31 → 10; (1 − 11.00/13.38) × 100 = 17.79 → 18
    expect(savingPercents([step(500, '13.38'), step(1000, '12.00'), step(3000, '11.00')])).toEqual([
      null,
      10,
      18,
    ]);
    // exactly .5 rounds up: (1 − 9.25/10) × 100 = 7.5 → 8
    expect(savingPercents([step(100, '10.00'), step(200, '9.25')])).toEqual([null, 8]);
  });

  it('savingPercent: null for unpriced tiers, ≤ 0 results and when the smallest tier is not priced', () => {
    expect(
      savingPercents([step(100, null), step(300, '10.00'), step(500, '10.00'), step(800, '10.20')]),
    ).toEqual([null, null, null, null]);
    expect(savingPercents([step(300, null)])).toEqual([null]);
    // the smallest *priced* tier is the base, wherever it is in the list
    expect(savingPercents([step(1000, '8.00'), step(500, '10.00')])).toEqual([20, null]);
  });

  it('vatRate: the rate in force as a fraction decimal string', () => {
    expect(vatRateOf('7.00')).toBe('0.07');
    expect(vatRateOf('7')).toBe('0.07');
    expect(vatRateOf(null)).toBeNull();
    expect(vatRateOf(undefined)).toBeNull();
  });

  it('vatRate beside each vatAmount; zone name and arrival only where shipping is priced', () => {
    const zone = { th: 'โซนทดสอบ', en: 'Test zone' };
    const fields = storeStepFields({
      vatRatePct: '7.00',
      shippingZone: zone,
      steps: [
        step(500, '10.00', { shippingAmount: '128.40', earliestDeliveryDate: '2026-11-02' }),
        step(1000, '9.00'),
        step(5000, null),
      ],
    });
    expect(fields).toEqual([
      {
        savingPercent: null,
        vatRate: '0.07',
        zoneName: zone,
        arrival: { from: '2026-11-02', to: '2026-11-02' },
        netAmount: '14.00',
      },
      { savingPercent: 10, vatRate: '0.07', zoneName: null, arrival: null, netAmount: '14.00' },
      { savingPercent: null, vatRate: null, zoneName: null, arrival: null, netAmount: null },
    ]);
  });

  it('C4-API-3: arrival is the engine window when set, else the single C4-API-2 date', () => {
    const fields = storeStepFields({
      vatRatePct: '7',
      shippingZone: null,
      arrivals: [{ from: '2026-11-03', to: '2026-11-05' }, null],
      steps: [
        step(500, '10.00', { earliestDeliveryDate: '2026-11-02' }),
        step(1000, '9.00', { earliestDeliveryDate: '2026-11-02' }),
      ],
    });
    expect(fields.map((f) => f.arrival)).toEqual([
      { from: '2026-11-03', to: '2026-11-05' },
      { from: '2026-11-02', to: '2026-11-02' },
    ]);
  });

  it('never carries a factory or origin field', () => {
    const [f] = storeStepFields({ vatRatePct: '7', shippingZone: null, steps: [step(1, '1.00')] });
    expect(Object.keys(f!).sort()).toEqual(['arrival', 'netAmount', 'savingPercent', 'vatRate', 'zoneName']);
  });

  it('C1-API-1: netAmount = grossAmount − vatAmount in decimals, null when either is missing', () => {
    expect(netAmountOf({ grossAmount: '13508.40', vatAmount: '883.73' })).toBe('12624.67');
    expect(netAmountOf({ grossAmount: '0.30', vatAmount: '0.10' })).toBe('0.20');
    expect(netAmountOf({ grossAmount: null, vatAmount: '1.00' })).toBeNull();
    expect(netAmountOf({ grossAmount: '1.00', vatAmount: null })).toBeNull();
  });
});
