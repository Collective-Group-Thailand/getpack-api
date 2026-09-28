import { WorkingDayCalendar } from './working-days';

/** Business-hour SLAs (D-175 09:00–18:00 on working days, D-061 slip review in 4 business hours). */
describe('WorkingDayCalendar.addBusinessMinutes', () => {
  const calendar = new WorkingDayCalendar({
    weekendDays: [0, 6],
    nonWorking: new Set(['2026-10-13']),
    extraWorking: new Set(),
  });
  const window = { from: '09:00', to: '18:00' };
  const at = (iso: string) => new Date(iso);

  it.each([
    ['inside the window', '2026-10-01T10:00:00+07:00', '2026-10-01T14:00:00+07:00'],
    ['crossing the evening', '2026-10-01T16:00:00+07:00', '2026-10-02T11:00:00+07:00'],
    ['before opening', '2026-10-01T07:30:00+07:00', '2026-10-01T13:00:00+07:00'],
    ['after closing on Friday → Monday', '2026-10-02T19:00:00+07:00', '2026-10-05T13:00:00+07:00'],
    ['over a holiday', '2026-10-12T17:00:00+07:00', '2026-10-14T12:00:00+07:00'],
  ])('4 business hours %s', (_name, start, expected) => {
    expect(calendar.addBusinessMinutes(at(start), 240, window).toISOString()).toBe(
      at(expected).toISOString(),
    );
  });

  it('refuses an empty window', () => {
    expect(() => calendar.addBusinessMinutes(new Date(), 60, { from: '18:00', to: '09:00' })).toThrow(
      RangeError,
    );
  });
});
