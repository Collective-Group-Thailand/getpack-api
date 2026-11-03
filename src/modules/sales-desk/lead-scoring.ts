import Decimal from 'decimal.js';

/**
 * D-471 item 2: the lead score 0–100 from the effective-dated rules `sales.scoring_rules`. Pure: the services pass in
 * what they know of the item or lead; a rule whose input is unknown adds nothing. Repeat visits to pricing pages are
 * deliberately absent: page views are collected for aggregate analytics (`analytics_cookies`), not to score a person
 * (PDPA purpose limitation).
 */

export const SCORE_REASONS = [
  'source',
  'company_email_domain',
  'free_email_domain',
  'tax_id_present',
  'quantity_band',
  'value_band',
  'recency',
  'repeat_signals',
] as const;
export type ScoreReason = (typeof SCORE_REASONS)[number];

export interface ScoringRules {
  base: number;
  /** Points by inbound source (contact_form, rfq, studio_idle, dieline_download, line_chat, manual). */
  inboundSource: Record<string, number>;
  /** Points by agent lead source (manual, card_scan, csv_import, link, staff). */
  leadSource: Record<string, number>;
  companyEmailDomain: number;
  freeEmailDomain: number;
  /** Lower-case domains counted as free webmail. */
  freeEmailDomains: string[];
  taxIdPresent: number;
  /** Highest band whose `min` the quantity reaches. */
  quantityBands: { min: number; points: number }[];
  /** Highest band whose `min` (THB, decimal string) the estimated value reaches. */
  valueBands: { min: string; points: number }[];
  /** The first band (smallest `maxDays`) the days since the last signal fall within. */
  recencyBands: { maxDays: number; points: number }[];
  /** Points when the item carries at least `min` signals (repeat downloads, designs). */
  repeatSignals: { min: number; points: number };
}

export interface ScoringInput {
  /** `inbound` uses `inboundSource`, `lead` uses `leadSource`. */
  kind: 'inbound' | 'lead';
  source: string;
  email: string | null;
  taxIdPresent: boolean;
  quantity: number | null;
  /** THB decimal string. */
  estimatedValue: string | null;
  lastSignalAt: Date;
  signalCount: number;
  now: Date;
}

export interface ScoreReasonPoints {
  reason: ScoreReason;
  points: number;
}

export interface LeadScore {
  score: number;
  /** The top 3 reasons by absolute points (zero dropped), ties in `SCORE_REASONS` order. */
  reasons: ScoreReasonPoints[];
}

const DAY = 86_400_000;

export function emailDomain(email: string | null): string | null {
  const at = email?.lastIndexOf('@') ?? -1;
  if (!email || at < 1 || at === email.length - 1) return null;
  return email
    .slice(at + 1)
    .trim()
    .toLowerCase();
}

export function scoreLead(rules: ScoringRules, input: ScoringInput): LeadScore {
  const found: ScoreReasonPoints[] = [];
  const add = (reason: ScoreReason, points: number | undefined) => {
    if (points !== undefined && points !== 0) found.push({ reason, points });
  };

  add('source', (input.kind === 'inbound' ? rules.inboundSource : rules.leadSource)[input.source]);

  const domain = emailDomain(input.email);
  if (domain)
    if (rules.freeEmailDomains.map((d) => d.toLowerCase()).includes(domain))
      add('free_email_domain', rules.freeEmailDomain);
    else add('company_email_domain', rules.companyEmailDomain);

  if (input.taxIdPresent) add('tax_id_present', rules.taxIdPresent);

  if (input.quantity !== null && input.quantity > 0) {
    const band = [...rules.quantityBands].sort((a, b) => b.min - a.min).find((b) => input.quantity! >= b.min);
    add('quantity_band', band?.points);
  }

  if (input.estimatedValue !== null) {
    const value = new Decimal(input.estimatedValue);
    if (value.gt(0)) {
      const band = [...rules.valueBands]
        .sort((a, b) => new Decimal(b.min).cmp(a.min))
        .find((b) => value.gte(b.min));
      add('value_band', band?.points);
    }
  }

  const days = Math.max(0, (input.now.getTime() - input.lastSignalAt.getTime()) / DAY);
  add(
    'recency',
    [...rules.recencyBands].sort((a, b) => a.maxDays - b.maxDays).find((b) => days <= b.maxDays)?.points,
  );

  if (input.signalCount >= rules.repeatSignals.min) add('repeat_signals', rules.repeatSignals.points);

  const total = rules.base + found.reduce((sum, r) => sum + r.points, 0);
  const score = Math.min(100, Math.max(0, Math.round(total)));
  const reasons = found
    .map((r, i) => ({ ...r, i }))
    .sort(
      (a, b) =>
        Math.abs(b.points) - Math.abs(a.points) ||
        SCORE_REASONS.indexOf(a.reason) - SCORE_REASONS.indexOf(b.reason) ||
        a.i - b.i,
    )
    .slice(0, 3)
    .map(({ reason, points }) => ({ reason, points }));
  return { score, reasons };
}
