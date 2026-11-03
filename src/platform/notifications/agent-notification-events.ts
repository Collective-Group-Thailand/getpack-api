import { type NotificationChannel, type SalesAgentNotificationEvent } from '@generated/prisma/client';

/**
 * D-467: the agent events a sales agent chooses channels for, and the domain events behind them. `statement_ready`
 * is the approval (the amounts and the withholding the agent sees are final then).
 */
export const AGENT_NOTIFICATION_EVENTS = {
  lead_converted: 'sales_agent_lead.converted',
  lead_protection_expiring: 'sales_agent_lead.protection_expiring',
  commission_earned: 'sales_agent_commission.earned',
  statement_ready: 'sales_agent_statement.approved',
  payout_paid: 'sales_agent_statement.paid',
  payout_profile_needed: 'sales_agent_statement.payout_profile_needed',
  /** D-468: a follow-up time the agent set has come (outside the quiet hours). */
  follow_up_due: 'sales_agent_lead.follow_up_due',
  /** D-468: a customer opened a quote the agent sent. */
  quote_opened: 'sales_agent_quote.opened',
} as const satisfies Record<SalesAgentNotificationEvent, string>;

export const AGENT_NOTIFICATION_EVENT_KEYS = Object.keys(
  AGENT_NOTIFICATION_EVENTS,
) as SalesAgentNotificationEvent[];

/** The channels an agent chooses (push = web_push of the agent zone, LINE OA = line, e-mail). In-app always stays. */
export const AGENT_NOTIFICATION_CHANNELS = [
  'web_push',
  'line',
  'email',
] as const satisfies readonly NotificationChannel[];
export type AgentNotificationChannel = (typeof AGENT_NOTIFICATION_CHANNELS)[number];

/** D-144: payment and tax records reach the agent by e-mail whatever they choose. */
const LOCKED: ReadonlySet<string> = new Set([
  'statement_ready:email',
  'payout_paid:email',
  'payout_profile_needed:email',
]);

export const isLockedAgentChannel = (
  event: SalesAgentNotificationEvent,
  channel: NotificationChannel,
): boolean => LOCKED.has(`${event}:${channel}`);

const BY_EVENT_TYPE = new Map<string, SalesAgentNotificationEvent>(
  AGENT_NOTIFICATION_EVENT_KEYS.map((key) => [AGENT_NOTIFICATION_EVENTS[key], key]),
);

/** The agent event of a domain event type, if it is one. */
export const agentEventOf = (eventType: string): SalesAgentNotificationEvent | undefined =>
  BY_EVENT_TYPE.get(eventType);

/**
 * Whether a route of an agent event may be muted by the agent's preference: only their own channels (`web_push`,
 * `line`, `email`), never in-app and never a locked e-mail.
 */
export function agentRouteMutable(event: SalesAgentNotificationEvent, channel: NotificationChannel): boolean {
  return (
    (AGENT_NOTIFICATION_CHANNELS as readonly string[]).includes(channel) &&
    !isLockedAgentChannel(event, channel)
  );
}
