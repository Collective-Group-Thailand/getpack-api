import { marketingConsent, routeCapture, STUDIO_CATCH_UP_DAYS, studioIdleWindow } from './capture-rules';

const day = 86_400_000;

/** D-471: attribution precedence (agent link / lead > rep > pool), consent, the studio idle window. */
describe('lead capture rules (D-471)', () => {
  const freelance = { kind: 'freelance' as const, staffUserId: null };
  const rep = (id: bigint) => ({ kind: 'employee' as const, staffUserId: id });

  describe('routeCapture — precedence', () => {
    it('keeps a freelance agent’s contact out of the company pool (link or lead)', () => {
      expect(routeCapture({ link: freelance, lead: null, repInbound: null })).toEqual({ route: 'agent' });
      expect(routeCapture({ link: null, lead: freelance, repInbound: null })).toEqual({ route: 'agent' });
      // Even with an open enquiry at a rep: the agent wins (D-417 first).
      expect(routeCapture({ link: null, lead: freelance, repInbound: { assigneeUserId: 5n } })).toEqual({
        route: 'agent',
      });
    });

    it('sends an employee agent’s (rep’s) contact to that rep', () => {
      expect(routeCapture({ link: rep(9n), lead: null, repInbound: null })).toEqual({
        route: 'rep',
        repUserId: 9n,
        via: 'agent_link',
      });
      expect(routeCapture({ link: null, lead: rep(8n), repInbound: { assigneeUserId: 5n } })).toEqual({
        route: 'rep',
        repUserId: 8n,
        via: 'agent_lead',
      });
    });

    it('lets the link win over a lead (one owner per customer)', () => {
      expect(routeCapture({ link: rep(9n), lead: freelance, repInbound: null })).toMatchObject({
        route: 'rep',
        repUserId: 9n,
      });
      expect(routeCapture({ link: freelance, lead: rep(8n), repInbound: null })).toEqual({ route: 'agent' });
    });

    it('treats an employee agent without a staff account as an agent (never the pool)', () => {
      expect(
        routeCapture({ link: { kind: 'employee', staffUserId: null }, lead: null, repInbound: null }),
      ).toEqual({ route: 'agent' });
    });

    it('then a rep already holding an open enquiry of the contact, else the pool', () => {
      expect(routeCapture({ link: null, lead: null, repInbound: { assigneeUserId: 5n } })).toEqual({
        route: 'rep',
        repUserId: 5n,
        via: 'inbound',
      });
      expect(routeCapture({ link: null, lead: null, repInbound: null })).toEqual({ route: 'pool' });
    });
  });

  describe('marketingConsent', () => {
    const at = (h: number) => new Date(Date.UTC(2026, 10, 3, h));
    it('needs at least one marketing purpose whose latest choice is granted', () => {
      expect(marketingConsent([])).toBeNull();
      expect(
        marketingConsent([
          { id: 1n, granted: false, recordedAt: at(1) },
          { id: 2n, granted: false, recordedAt: at(2) },
        ]),
      ).toBeNull();
    });

    it('relies on the most recent granted record', () => {
      expect(
        marketingConsent([
          { id: 1n, granted: true, recordedAt: at(1) },
          { id: 3n, granted: false, recordedAt: at(3) },
          { id: 2n, granted: true, recordedAt: at(2) },
        ])?.id,
      ).toBe(2n);
    });
  });

  describe('studioIdleWindow', () => {
    const now = new Date('2026-11-10T03:00:00Z');
    const longAgo = new Date('2026-01-01T00:00:00Z');

    it('captures designs idle at least the idle days, within the catch-up window', () => {
      const w = studioIdleWindow(now, 3, longAgo)!;
      expect(w.to).toEqual(new Date(now.getTime() - 3 * day));
      expect(w.from).toEqual(new Date(now.getTime() - (3 + STUDIO_CATCH_UP_DAYS) * day));
    });

    it('never back-captures designs changed before the flag was switched on', () => {
      const on = new Date('2026-11-05T00:00:00Z');
      expect(studioIdleWindow(now, 3, on)!.from).toEqual(on);
      // Switched on yesterday: nothing is idle long enough yet.
      expect(studioIdleWindow(now, 3, new Date('2026-11-09T00:00:00Z'))).toBeNull();
    });
  });
});
