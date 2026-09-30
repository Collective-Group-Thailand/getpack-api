import { estimatedDeliveryDate } from './order-views';

const day = (d: string) => new Date(`${d}T00:00:00Z`);

describe('estimatedDeliveryDate (U-B0.1)', () => {
  const option = { earliestShipDate: day('2026-10-10'), result: { earliestDeliveryDate: '2026-10-13' } };

  it('is the quotation’s delivery estimate when the ship promise is the quotation’s', () => {
    expect(estimatedDeliveryDate(day('2026-10-10'), option)).toBe('2026-10-13');
  });

  it('moves with the promised ship date when checkout re-planned it', () => {
    expect(estimatedDeliveryDate(day('2026-10-15'), option)).toBe('2026-10-18');
  });

  it('is null without a promise or without a delivery estimate', () => {
    expect(estimatedDeliveryDate(null, option)).toBeNull();
    expect(estimatedDeliveryDate(day('2026-10-10'), { ...option, result: { earliestDeliveryDate: null } })).toBeNull();
    expect(estimatedDeliveryDate(day('2026-10-10'), null)).toBeNull();
  });
});
