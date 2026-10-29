import { callbackDays, contactMatches, queueFor, teamStatus, ticketStage } from './support-contact.rules';

/** Weekends off, plus one listed holiday: the national calendar as the service feeds it. */
const working =
  (holidays: string[] = []) =>
  (day: string) => {
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    return dow !== 0 && dow !== 6 && !holidays.includes(day);
  };
// 2026-10-21 is a Wednesday. 03:30Z = 10:30 Bangkok.
const at = (iso: string) => new Date(iso);

describe('teamStatus (D-458)', () => {
  const daily = { days: 'daily' as const, open: '09:00', close: '18:00' };

  it('is open inside the window', () => {
    expect(teamStatus(at('2026-10-21T03:30:00Z'), daily, working())).toEqual({
      openNow: true,
      nextOpenAt: null,
    });
  });

  it('before opening, opens later the same day', () => {
    const s = teamStatus(at('2026-10-21T00:30:00Z'), daily, working()); // 07:30 Bangkok
    expect(s.openNow).toBe(false);
    expect(s.nextOpenAt?.toISOString()).toBe('2026-10-21T02:00:00.000Z');
  });

  it('after closing, opens the next answering day; closing time itself is closed', () => {
    const s = teamStatus(at('2026-10-21T11:00:00Z'), daily, working()); // 18:00 Bangkok
    expect(s.openNow).toBe(false);
    expect(s.nextOpenAt?.toISOString()).toBe('2026-10-22T02:00:00.000Z');
  });

  it('business days skip weekends and holidays', () => {
    // Friday 2026-10-23 19:00 Bangkok; Monday 26 is a holiday → Tuesday 27 09:00.
    const s = teamStatus(
      at('2026-10-23T12:00:00Z'),
      { days: 'business_days', open: '09:00', close: '18:00' },
      working(['2026-10-26']),
    );
    expect(s.nextOpenAt?.toISOString()).toBe('2026-10-27T02:00:00.000Z');
  });

  it('mon_sat answers on Saturday, not on Sunday', () => {
    const sat = teamStatus(
      at('2026-10-24T03:00:00Z'),
      { days: 'mon_sat', open: '09:00', close: '18:00' },
      working(),
    );
    expect(sat.openNow).toBe(true);
    const sun = teamStatus(
      at('2026-10-25T03:00:00Z'),
      { days: 'mon_sat', open: '09:00', close: '18:00' },
      working(),
    );
    expect(sun.openNow).toBe(false);
    expect(sun.nextOpenAt?.toISOString()).toBe('2026-10-26T02:00:00.000Z');
  });

  it('an empty window is never open', () => {
    expect(
      teamStatus(at('2026-10-21T03:30:00Z'), { days: 'daily', open: '18:00', close: '09:00' }, working()),
    ).toEqual({
      openNow: false,
      nextOpenAt: null,
    });
  });
});

describe('callbackDays (D-458)', () => {
  it('is the next 5 working days after today, Bangkok dates', () => {
    // Thursday 2026-10-22 23:30 Bangkok is still the 22nd.
    expect(callbackDays(at('2026-10-22T16:30:00Z'), working(['2026-10-26']))).toEqual([
      '2026-10-23',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
    ]);
  });
});

describe('queueFor (D-458)', () => {
  const routing = { default: 'cs', topics: { business: 'sales', partnership: 'partner' } };
  it('routes listed topics, the default otherwise, CS without a setting', () => {
    expect(queueFor('business', routing)).toBe('sales');
    expect(queueFor('order', routing)).toBe('cs');
    expect(queueFor('partnership', null)).toBe('cs');
  });
});

describe('ticketStage (D-458)', () => {
  it('received → in progress → answered', () => {
    expect(ticketStage({ firstRespondedAt: null }, { status: 'open', assignedUserId: null })).toBe(
      'received',
    );
    expect(ticketStage({ firstRespondedAt: null }, { status: 'open', assignedUserId: 1n })).toBe(
      'in_progress',
    );
    expect(ticketStage({ firstRespondedAt: null }, { status: 'pending', assignedUserId: null })).toBe(
      'in_progress',
    );
    expect(ticketStage({ firstRespondedAt: new Date() }, { status: 'open', assignedUserId: 1n })).toBe(
      'answered',
    );
    expect(ticketStage({ firstRespondedAt: null }, { status: 'closed', assignedUserId: null })).toBe(
      'answered',
    );
  });
});

describe('contactMatches (D-458)', () => {
  const ticket = { contactPhone: '0812345678', contactEmail: 'Someone@Example.test' };
  it('accepts the phone in any common writing, or the e-mail in any case', () => {
    expect(contactMatches(ticket, { phone: '081-234-5678' })).toBe(true);
    expect(contactMatches(ticket, { phone: '+66812345678' })).toBe(true);
    expect(contactMatches(ticket, { email: ' someone@example.TEST ' })).toBe(true);
  });
  it('refuses anything else, and no contact at all', () => {
    expect(contactMatches(ticket, { phone: '0812345679' })).toBe(false);
    expect(contactMatches(ticket, { email: 'other@example.test' })).toBe(false);
    expect(contactMatches(ticket, undefined)).toBe(false);
    expect(contactMatches({ contactPhone: null, contactEmail: null }, { phone: '0812345678' })).toBe(false);
  });
});
