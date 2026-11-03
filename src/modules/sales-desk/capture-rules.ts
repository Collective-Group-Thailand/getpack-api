/**
 * D-471 (agent portal Phase 5): the pure rules of automatic lead capture — attribution precedence, the studio idle
 * window and the marketing-consent check. No database, no clock: the services pass the facts in.
 */

/** The agent programme's kinds (D-416): a freelance agent, or a company rep (employee agent). */
export type AgentKind = 'freelance' | 'employee';

/** What the contact is already attached to, as the services found it. */
export interface AttributionFacts {
  /** An active agent link of the customer or of their company (D-417 (a)), with the agent's kind and rep user. */
  link: { kind: AgentKind; staffUserId: bigint | null } | null;
  /** A protected (registered, in protection) or converted agent lead with the same phone, e-mail or tax id (D-417 (b)). */
  lead: { kind: AgentKind; staffUserId: bigint | null } | null;
  /** An open inbound item of the same contact assigned to a rep. */
  repInbound: { assigneeUserId: bigint } | null;
}

export type CaptureRoute =
  | { route: 'agent' }
  | { route: 'rep'; repUserId: bigint; via: 'agent_link' | 'agent_lead' | 'inbound' }
  | { route: 'pool' };

/**
 * Attribution precedence (D-471, D-417): an active agent link or lead > a rep assignment > the unassigned pool.
 * The link wins over a lead (one owner per customer). A freelance agent's contact never enters the company pool
 * (`agent`); an employee agent is a company rep, so their contact goes to that rep; then an open enquiry already
 * assigned to a rep; else the pool.
 */
export function routeCapture(facts: AttributionFacts): CaptureRoute {
  for (const [owner, via] of [
    [facts.link, 'agent_link'],
    [facts.lead, 'agent_lead'],
  ] as const) {
    if (!owner) continue;
    if (owner.kind === 'freelance' || owner.staffUserId === null) return { route: 'agent' };
    return { route: 'rep', repUserId: owner.staffUserId, via };
  }
  if (facts.repInbound) return { route: 'rep', repUserId: facts.repInbound.assigneeUserId, via: 'inbound' };
  return { route: 'pool' };
}

/** The marketing purposes whose consent allows a sales follow-up of a captured signal (D-144). */
export const MARKETING_PURPOSES = ['marketing_email', 'marketing_line', 'marketing_sms'] as const;

/**
 * The consent record a captured signal relies on: the latest record of each marketing purpose decides that purpose;
 * a granted one (the most recent among them) is relied on, none granted → no capture.
 */
export function marketingConsent<T extends { id: bigint; granted: boolean; recordedAt: Date }>(
  latestPerPurpose: T[],
): T | null {
  const granted = latestPerPurpose.filter((r) => r.granted);
  if (granted.length === 0) return null;
  return granted.sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime() || Number(b.id - a.id))[0]!;
}

/** Days a worker outage may be caught up: a design idle longer than idle days + this is not captured late. */
export const STUDIO_CATCH_UP_DAYS = 7;

/**
 * The window of last-change times a saved design must fall in to be captured now: idle at least `idleDays`, not
 * older than the catch-up window, and never before the capture flag's effective date (no back-capture).
 */
export function studioIdleWindow(
  now: Date,
  idleDays: number,
  enabledFrom: Date,
): { from: Date; to: Date } | null {
  const day = 86_400_000;
  const to = new Date(now.getTime() - idleDays * day);
  const catchUp = new Date(to.getTime() - STUDIO_CATCH_UP_DAYS * day);
  const from = enabledFrom > catchUp ? enabledFrom : catchUp;
  return from <= to ? { from, to } : null;
}

/** Why a candidate was not captured (logged as counts, never per person). */
export type CaptureSkip =
  | 'flag_off'
  | 'not_customer_account'
  | 'agent'
  | 'attributed'
  | 'customer'
  | 'no_consent'
  | 'already_captured'
  | 'open_item';
