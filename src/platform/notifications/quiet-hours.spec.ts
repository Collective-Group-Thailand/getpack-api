import { nextMarketingSlot } from './quiet-hours';

const window = { from: '09:00', to: '20:00' }; // D-144
const bkk = (iso: string) => new Date(`${iso}+07:00`);

describe('nextMarketingSlot (D-144)', () => {
  it('allows sending inside 09:00–20:00 Bangkok', () => {
    expect(nextMarketingSlot(bkk('2026-09-23T09:00:00'), window)).toBeNull();
    expect(nextMarketingSlot(bkk('2026-09-23T19:59:59'), window)).toBeNull();
  });

  it('defers to 09:00 the same day before the window, and the next day after it', () => {
    expect(nextMarketingSlot(bkk('2026-09-23T07:30:00'), window)?.toISOString()).toBe(
      '2026-09-23T02:00:00.000Z',
    );
    expect(nextMarketingSlot(bkk('2026-09-23T20:00:00'), window)?.toISOString()).toBe(
      '2026-09-24T02:00:00.000Z',
    );
    expect(nextMarketingSlot(bkk('2026-12-31T23:30:00'), window)?.toISOString()).toBe(
      '2027-01-01T02:00:00.000Z',
    );
  });

  it('supports windows that cross midnight', () => {
    const overnight = { from: '22:00', to: '06:00' };
    expect(nextMarketingSlot(bkk('2026-09-23T23:00:00'), overnight)).toBeNull();
    expect(nextMarketingSlot(bkk('2026-09-23T12:00:00'), overnight)?.toISOString()).toBe(
      '2026-09-23T15:00:00.000Z',
    );
  });
});
