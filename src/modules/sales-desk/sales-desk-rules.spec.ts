import { pickRep, slaBreached, slaPct, workingHoursDue } from './sales-desk-rules';
import { quantityBand } from './sales-negotiations';

const W = { from: '09:00', to: '18:00' };
const at = (s: string) => new Date(s);

describe('sales desk rules (D-469)', () => {
  it('counts working hours every day inside 09:00–18:00 Bangkok (P-05)', () => {
    // 10:00 + 4 h = 14:00 the same day.
    expect(workingHoursDue(at('2026-11-02T10:00:00+07:00'), 4, W).toISOString()).toBe(
      at('2026-11-02T14:00:00+07:00').toISOString(),
    );
    // After 18:00 → due 13:00 the next day (P-05's example), Saturday counts.
    expect(workingHoursDue(at('2026-11-06T19:30:00+07:00'), 4, W).toISOString()).toBe(
      at('2026-11-07T13:00:00+07:00').toISOString(),
    );
    // 16:00 + 4 h = 2 h today + 2 h tomorrow → 11:00.
    expect(workingHoursDue(at('2026-11-02T16:00:00+07:00'), 4, W).toISOString()).toBe(
      at('2026-11-03T11:00:00+07:00').toISOString(),
    );
  });

  it('picks the rep with the fewest open enquiries, then the least recently assigned', () => {
    const reps = [
      { userId: 1n, open: 3, lastAssignedAt: at('2026-11-01T10:00:00Z') },
      { userId: 2n, open: 1, lastAssignedAt: at('2026-11-02T10:00:00Z') },
      { userId: 3n, open: 1, lastAssignedAt: at('2026-11-01T10:00:00Z') },
      { userId: 4n, open: 1, lastAssignedAt: null },
    ];
    expect(pickRep(reps, null)).toBe(4n);
    expect(pickRep(reps.slice(0, 3), null)).toBe(3n);
    expect(pickRep(reps, 1)).toBeNull();
    expect(pickRep(reps.slice(0, 1), 4)).toBe(1n);
    expect(pickRep([], null)).toBeNull();
  });

  it('flags a breach once, only while unanswered', () => {
    const now = at('2026-11-02T12:00:00Z');
    const due = at('2026-11-02T11:00:00Z');
    expect(slaBreached({ firstResponseDueAt: due, firstRespondedAt: null, slaBreachedAt: null }, now)).toBe(
      true,
    );
    expect(slaBreached({ firstResponseDueAt: due, firstRespondedAt: now, slaBreachedAt: null }, now)).toBe(
      false,
    );
    expect(slaBreached({ firstResponseDueAt: due, firstRespondedAt: null, slaBreachedAt: now }, now)).toBe(
      false,
    );
    expect(slaBreached({ firstResponseDueAt: now, firstRespondedAt: null, slaBreachedAt: null }, due)).toBe(
      false,
    );
  });

  it('computes the first-response SLA % over what is due', () => {
    const now = at('2026-11-02T12:00:00Z');
    expect(
      slaPct(
        [
          { due: at('2026-11-02T10:00:00Z'), respondedAt: at('2026-11-02T09:00:00Z') },
          { due: at('2026-11-02T10:00:00Z'), respondedAt: at('2026-11-02T11:00:00Z') },
          { due: at('2026-11-02T10:00:00Z'), respondedAt: null },
          { due: at('2026-11-02T13:00:00Z'), respondedAt: null },
        ],
        now,
      ),
    ).toBe('33.3');
    expect(slaPct([], now)).toBeNull();
  });
});

describe('quantity bands (D-470 lost-to-price)', () => {
  it('uses decade bands', () => {
    expect([999, 1000, 9999, 10_000, 100_000].map(quantityBand)).toEqual([
      'lt_1k',
      '1k_10k',
      '1k_10k',
      '10k_100k',
      'gte_100k',
    ]);
  });
});
