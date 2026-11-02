import {
  AGENT_NOTIFICATION_EVENTS,
  agentEventOf,
  agentRouteMutable,
  isLockedAgentChannel,
} from '@platform/notifications/agent-notification-events';

import { NOTIFICATION_ROUTES, NOTIFICATION_TEMPLATES } from '../../../prisma/seed/data/notifications';
import { protectionReminderDue } from './agent-attribution.service';
import { preferenceMatrix } from './agent-notification-preferences.service';
import { AGENT_NOTIFICATION_PREFERENCES_EXAMPLE } from './agents.dto';

const DAY = 86_400_000;
const NOW = new Date('2027-01-10T03:00:00Z');
const lead = (msLeft: number, r7: Date | null = null, r1: Date | null = null) => ({
  protectedUntil: new Date(NOW.getTime() + msLeft),
  protectionReminded7dAt: r7,
  protectionReminded1dAt: r1,
});

describe('agent notification choices (D-467)', () => {
  it('maps the six agent events to their domain events', () => {
    expect(AGENT_NOTIFICATION_EVENTS).toEqual({
      lead_converted: 'sales_agent_lead.converted',
      lead_protection_expiring: 'sales_agent_lead.protection_expiring',
      commission_earned: 'sales_agent_commission.earned',
      statement_ready: 'sales_agent_statement.approved',
      payout_paid: 'sales_agent_statement.paid',
      payout_profile_needed: 'sales_agent_statement.payout_profile_needed',
      follow_up_due: 'sales_agent_lead.follow_up_due',
    });
    expect(agentEventOf('sales_agent_statement.paid')).toBe('payout_paid');
    expect(agentEventOf('order.placed')).toBeUndefined();
  });

  it('defaults every event × channel to on and keeps payment and tax e-mails locked (D-144)', () => {
    const items = preferenceMatrix([
      { event: 'commission_earned', channel: 'line', enabled: false },
      { event: 'payout_paid', channel: 'email', enabled: false },
    ]);
    expect(items).toHaveLength(21);
    expect(items.find((i) => i.event === 'commission_earned' && i.channel === 'line')).toMatchObject({
      enabled: false,
      locked: false,
    });
    expect(items.find((i) => i.event === 'payout_paid' && i.channel === 'email')).toMatchObject({
      enabled: true,
      locked: true,
    });
    expect(items.filter((i) => i.locked).map((i) => `${i.event}:${i.channel}`)).toEqual([
      'statement_ready:email',
      'payout_paid:email',
      'payout_profile_needed:email',
    ]);
    expect(AGENT_NOTIFICATION_PREFERENCES_EXAMPLE.items.filter((i) => i.locked)).toHaveLength(3);
  });

  it('lets the router mute only the agent’s own channels, never in-app or a locked e-mail', () => {
    expect(agentRouteMutable('lead_converted', 'email')).toBe(true);
    expect(agentRouteMutable('lead_converted', 'web_push')).toBe(true);
    expect(agentRouteMutable('lead_converted', 'in_app')).toBe(false);
    expect(agentRouteMutable('statement_ready', 'email')).toBe(false);
    expect(isLockedAgentChannel('statement_ready', 'line')).toBe(false);
  });

  it('seeds in-app, e-mail, push and LINE for every agent event, to the agent', () => {
    for (const eventType of Object.values(AGENT_NOTIFICATION_EVENTS))
      for (const channel of ['in_app', 'email', 'web_push', 'line'] as const) {
        const route = NOTIFICATION_ROUTES.find(
          (r) => r.eventType === eventType && r.channel === channel && r.audience === 'customer',
        );
        expect({ eventType, channel, route: Boolean(route) }).toEqual({ eventType, channel, route: true });
        expect(
          NOTIFICATION_TEMPLATES.some((t) => t.key === route!.templateKey && t.channel === channel),
        ).toBe(true);
      }
  });
});

describe('lead protection reminder (D-467)', () => {
  it('reminds 7 days before, then within the last day, once each', () => {
    expect(protectionReminderDue(lead(8 * DAY), NOW)).toBeNull();
    expect(protectionReminderDue(lead(7 * DAY), NOW)).toBe(7);
    expect(protectionReminderDue(lead(3 * DAY), NOW)).toBe(7);
    expect(protectionReminderDue(lead(3 * DAY, NOW), NOW)).toBeNull();
    expect(protectionReminderDue(lead(DAY, NOW), NOW)).toBe(1);
    expect(protectionReminderDue(lead(DAY / 2, NOW, NOW), NOW)).toBeNull();
    // A lead first seen inside its last day gets the 1-day reminder only.
    expect(protectionReminderDue(lead(DAY / 2), NOW)).toBe(1);
    expect(protectionReminderDue(lead(0), NOW)).toBeNull();
  });
});
