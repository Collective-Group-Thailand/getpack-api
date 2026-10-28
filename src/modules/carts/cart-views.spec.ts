import { shipDateAhead } from './cart-views';

describe('shipDateAhead (D-452)', () => {
  const now = new Date('2026-10-28T20:00:00+07:00');

  it('keeps a ship date from today on (Bangkok day)', () => {
    expect(shipDateAhead(new Date('2026-10-28T00:00:00Z'), now)).toBe('2026-10-28');
    expect(shipDateAhead(new Date('2026-11-09T00:00:00Z'), now)).toBe('2026-11-09');
  });

  it('drops a passed or missing one', () => {
    expect(shipDateAhead(new Date('2026-10-27T00:00:00Z'), now)).toBeNull();
    expect(shipDateAhead(null, now)).toBeNull();
  });
});
