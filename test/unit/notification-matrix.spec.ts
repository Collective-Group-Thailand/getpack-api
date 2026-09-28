import { renderTemplate } from '@platform/notifications/template-renderer';

import { NOTIFICATION_ROUTES, NOTIFICATION_TEMPLATES } from '../../prisma/seed/data/notifications';
import { TEAMS } from '../../prisma/seed/data/reference';

/** The seeded D-143 matrix is consistent: templates compile, routes point at them, channel rules hold. */
describe('notification routing matrix (D-143, D-144)', () => {
  const template = (key: string, channel: string) =>
    NOTIFICATION_TEMPLATES.find((t) => t.key === key && t.channel === channel);

  it('has one template per key and channel, and every route has its template and team', () => {
    const keys = NOTIFICATION_TEMPLATES.map((t) => `${t.key}|${t.channel}`);
    expect(new Set(keys).size).toBe(keys.length);
    const teams = new Set<string>(TEAMS.map((t) => t.code));
    for (const r of NOTIFICATION_ROUTES) {
      expect(template(r.templateKey, r.channel)).toBeDefined();
      if (r.audience === 'staff_team') expect(teams.has(r.staffTeamCode ?? '')).toBe(true);
      else expect(r.staffTeamCode).toBeUndefined();
    }
    const routes = NOTIFICATION_ROUTES.map(
      (r) => `${r.eventType}|${r.audience}|${r.staffTeamCode ?? ''}|${r.channel}`,
    );
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('sends SMS only for critical events and e-mails customers whatever else they get', () => {
    for (const r of NOTIFICATION_ROUTES.filter((x) => x.channel === 'sms')) expect(r.isCritical).toBe(true);
    const customerEvents = new Set(
      NOTIFICATION_ROUTES.filter((r) => r.audience === 'customer').map((r) => r.eventType),
    );
    const inAppOnly = ['production.queued', 'production.milestone_reached'];
    for (const event of customerEvents) {
      if (inAppOnly.includes(event)) continue;
      expect(
        NOTIFICATION_ROUTES.some(
          (r) => r.eventType === event && r.audience === 'customer' && r.channel === 'email',
        ),
      ).toBe(true);
    }
    // Factories: partner-zone push, LINE and e-mail only.
    for (const r of NOTIFICATION_ROUTES.filter((x) => x.audience === 'factory'))
      expect(['in_app', 'line', 'email']).toContain(r.channel);
  });

  it('renders every template in both languages', async () => {
    const context = {
      event: { type: 'x', occurredAt: '2026-10-01T09:00:00+07:00' },
      payload: {
        groupCode: 'G-1',
        seq: 1,
        cashAmount: '100.00',
        claimNo: 'CL-1',
        jobNo: 'J-1',
        shipmentNo: 'S-1',
      },
      recipient: { displayName: 'ทดสอบ' },
    };
    for (const t of NOTIFICATION_TEMPLATES) {
      for (const locale of ['th', 'en'] as const) {
        const v = t.versions[locale];
        const rendered = await renderTemplate(
          t.channel,
          { subject: v.subject ?? null, body: v.body },
          context,
        );
        expect(rendered.text.length).toBeGreaterThan(0);
      }
    }
  });
});
