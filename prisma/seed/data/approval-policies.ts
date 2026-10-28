/**
 * Approval policies (ADR-0006) seeded as version 1. Step conditions use the engine's condition shape
 * (implemented in B1.3): `{ all: [...] } | { any: [...] } | { field, op, value } | { field, op, ref }`.
 * Where no other decision names the approver, the approver is Finance Manager (D-169).
 */
export interface StepSeed {
  name: string;
  role: string;
  scope?: 'platform' | 'subject_factory' | 'subject_company' | 'subject_entity';
  condition?: unknown;
}

export interface PolicySeed {
  key: string;
  subjectType: string;
  description: string;
  decisions: string[];
  reason: string;
  expiryRule?: unknown;
  steps: StepSeed[];
  /**
   * D-449 B (owner decision 2026-10-28): requests at or below this amount (THB) are approved at creation. Only on
   * policies whose steps already have an amount condition. Version 1 of a new database gets the latest owner value;
   * an existing database is brought to it as one new version (`ensureApprovalPolicyAmendments`, never editing a
   * version), see {@link thresholdAmendmentOf}; afterwards only a Superadmin changes it in the policy editor.
   */
  autoApproveMaxAmount?: string;
  /** The owner's threshold decisions for this policy, oldest first; the last one is `autoApproveMaxAmount`. */
  autoApproveHistory?: readonly ThresholdDecision[];
}

/** One owner decision about a policy's auto-approve amount: the amount and the reason its seed version carries. */
export interface ThresholdDecision {
  amount: string;
  reason: string;
}

/** Owner decision 2026-10-28 (C1d B): the approval threshold, ฿500,000.00 (superseded for `credit_limit` by C1f). */
export const OWNER_APPROVAL_THRESHOLD_C1D: ThresholdDecision = {
  amount: '500000.00',
  reason:
    'Owner decision 2026-10-28 (D-449 B, DECISIONS-STAGE-A §12): requests of ≤ THB 500,000.00 skip the second approval',
};
/** Owner decision 2026-10-28 13:58 (C1f, D-451, DECISIONS-STAGE-A §14.5): `credit_limit` threshold ฿100,000.00. */
export const OWNER_CREDIT_LIMIT_THRESHOLD_C1F: ThresholdDecision = {
  amount: '100000.00',
  reason:
    'Owner decision 2026-10-28 13:58 (D-451, DECISIONS-STAGE-A §14.5): credit-limit requests of ≤ THB 100,000.00 skip the second approval',
};
/** @deprecated kept for readers of C1d; the seed uses {@link OWNER_CREDIT_LIMIT_THRESHOLD_C1F}. */
export const OWNER_APPROVAL_THRESHOLD = OWNER_APPROVAL_THRESHOLD_C1D.amount;
export const OWNER_APPROVAL_THRESHOLD_REASON = OWNER_APPROVAL_THRESHOLD_C1D.reason;

/** A version as the amendment check reads it. */
export interface VersionFacts {
  reason: string;
  autoApproveMaxAmount: string | null;
  /** Null for a version the seed wrote; a person's id for one made in the policy editor. */
  createdById: bigint | null;
}

/**
 * Whether an existing database's policy gets the latest owner threshold as a new version, and which. Only when the
 * value in force is still what the seed put there — a version the seed wrote (no author) that carries no amount (a
 * database from before D-449, whose versions never had one) or an earlier owner amount. A value a Superadmin set,
 * changed or removed in the editor always wins, and the seed never writes the same decision twice. Pure.
 */
export function thresholdAmendmentOf(
  history: readonly ThresholdDecision[] | undefined,
  inForce: VersionFacts | null,
  versions: readonly VersionFacts[],
): ThresholdDecision | null {
  const latest = history?.at(-1);
  if (!latest || !inForce) return null;
  if (versions.some((v) => v.reason === latest.reason)) return null;
  if (inForce.createdById !== null) return null;
  const amount = inForce.autoApproveMaxAmount === null ? null : Number(inForce.autoApproveMaxAmount);
  if (amount === Number(latest.amount)) return null;
  if (amount === null)
    return versions.some(
      (v) => v.autoApproveMaxAmount !== null || history!.some((h) => h.reason === v.reason),
    )
      ? null
      : latest;
  return history!.slice(0, -1).some((h) => Number(h.amount) === amount) ? latest : null;
}

const pct = (op: string, value: string) => ({ field: 'pct', op, value });
const notBelowFloor = { field: 'flags', op: 'excludes', value: 'below_margin_floor' };
const financeManagerDefault = 'Seed from D-169 — Finance Manager approves';

const financeManagerOnly = (
  key: string,
  subjectType: string,
  description: string,
  decisions: string[],
): PolicySeed => ({
  key,
  subjectType,
  description,
  decisions: [...decisions, 'D-169'],
  reason: financeManagerDefault,
  steps: [{ name: 'Finance Manager approval', role: 'finance_manager' }],
});

export const APPROVAL_POLICIES: readonly PolicySeed[] = [
  {
    key: 'discount_memo',
    subjectType: 'discount_memo',
    description: 'Discounts above the CS limit; only the matching tier approves (D-052, D-162, D-124)',
    decisions: ['D-052', 'D-162', 'D-124'],
    reason: 'Seed from D-052 / D-162 — tier boundaries are Proposed in D-052',
    expiryRule: { withSubject: 'quote.valid_until' },
    steps: [
      {
        name: 'Director (> 5–10 %)',
        role: 'director',
        condition: { all: [pct('gt', '5'), pct('lte', '10'), notBelowFloor] },
      },
      {
        name: 'VP (> 10–15 %)',
        role: 'vp',
        condition: { all: [pct('gt', '10'), pct('lte', '15'), notBelowFloor] },
      },
      {
        name: 'C-Level (> 15 % or below the margin floor)',
        role: 'c_level',
        condition: {
          any: [pct('gt', '15'), { field: 'flags', op: 'includes', value: 'below_margin_floor' }],
        },
      },
    ],
  },
  {
    key: 'credit_limit',
    subjectType: 'company_credit_limit',
    description: 'B2B credit limits: up to THB 100,000 by Finance, above by C-Level (D-121)',
    decisions: ['D-121'],
    reason: 'Seed from D-121',
    // D-449 B, then C1f (owner: "I am the executive and the approver"): ฿100,000.00.
    autoApproveMaxAmount: OWNER_CREDIT_LIMIT_THRESHOLD_C1F.amount,
    autoApproveHistory: [OWNER_APPROVAL_THRESHOLD_C1D, OWNER_CREDIT_LIMIT_THRESHOLD_C1F],
    steps: [
      {
        name: 'Finance (≤ THB 100,000)',
        role: 'finance',
        condition: { field: 'amount', op: 'lte', value: '100000.00' },
      },
      {
        name: 'C-Level (> THB 100,000)',
        role: 'c_level',
        condition: { field: 'amount', op: 'gt', value: '100000.00' },
      },
    ],
  },
  {
    key: 'payout_run',
    subjectType: 'payout_run',
    description: 'Factory payout runs: Finance proposes (requester), executive approves (D-022)',
    decisions: ['D-022', 'D-166'],
    reason: 'Seed from D-022 / D-166 — the executive approver is C-Level',
    steps: [{ name: 'Executive approval', role: 'c_level' }],
  },
  {
    key: 'price_proposal',
    subjectType: 'price_proposal',
    description: 'Factory price-list proposals and platform rate-card versions (D-040, D-042)',
    decisions: ['D-040', 'D-042'],
    reason: 'Seed from D-040 — reviewed by the Partner team',
    steps: [{ name: 'Partner Manager review', role: 'partner_manager' }],
  },
  {
    key: 'partner_activation',
    subjectType: 'factory',
    description:
      'Partner approval by the Partner team; a site visit is required before trial → active (D-041)',
    decisions: ['D-041', 'D-011'],
    reason: 'Seed from D-041',
    steps: [{ name: 'Partner Manager approval', role: 'partner_manager' }],
  },
  {
    key: 'partner_pricing_mode_change',
    subjectType: 'factory',
    description: 'Change of a factory pricing-ownership mode (D-042)',
    decisions: ['D-042', 'D-167'],
    reason: 'Seed from D-042 / D-167 — Partner Manager approves',
    steps: [{ name: 'Partner Manager approval', role: 'partner_manager' }],
  },
  {
    key: 'approval_policy_change',
    subjectType: 'approval_policy_version',
    description:
      'A new version of an approval policy (the approval matrix): a Superadmin proposes it, another Superadmin approves it; it applies from its date and the running version is never edited (D-063, ADR-0006)',
    decisions: ['D-063'],
    reason: 'Seed from D-063 — Superadmin approves (B6.3 launch gap)',
    steps: [{ name: 'Superadmin approval', role: 'superadmin' }],
  },
  {
    key: 'factory_tolerance_change',
    subjectType: 'factory_tolerance_policy_version',
    description:
      'Factory-specific quantity-tolerance override (D-021 / D-163): Partner Manager requests, Superadmin approves (D-173)',
    decisions: ['D-173', 'D-021', 'D-063'],
    reason: 'Seed from D-173 — Superadmin approves (proposed default)',
    steps: [{ name: 'Superadmin approval', role: 'superadmin' }],
  },
  {
    key: 'factory_payout_policy_change',
    subjectType: 'factory_payout_policy_version',
    description:
      'Factory-specific payout-policy override (D-022 / D-164): Partner Manager or Finance requests, Superadmin approves (D-173)',
    decisions: ['D-173', 'D-022', 'D-063'],
    reason: 'Seed from D-173 — Superadmin approves (proposed default)',
    steps: [{ name: 'Superadmin approval', role: 'superadmin' }],
  },
  {
    key: 'guarantee_policy_change',
    subjectType: 'guarantee_policy_version',
    description:
      'New guarantee policy versions (D-200, D-260): the remedy matrix and claim SLAs the public page and the claim engine read; CS Lead requests, C-Level approves',
    decisions: ['D-200', 'D-260', 'D-063'],
    reason: 'D-200 (accepted 2026-09-30): requested by the CS Lead, approved by C-Level',
    steps: [{ name: 'C-Level approval', role: 'c_level' }],
  },
  {
    key: 'customer_shipping_rate_change',
    subjectType: 'customer_shipping_rate_card_version',
    description:
      'New customer shipping rate-card versions (D-013): Logistics / Admin draft, C-Level approves (changes customer prices)',
    decisions: ['D-013', 'D-063'],
    reason:
      'Chosen at B2.4 planning (2026-09-26) — no decision names the approver; C-Level (proposed default)',
    steps: [{ name: 'C-Level approval', role: 'c_level' }],
  },
  {
    key: 'vendor_bank_account_change',
    subjectType: 'vendor_bank_account',
    description:
      'Factory / vendor bank-account changes: dual approval + logged verification call (accounting-design.md §8)',
    decisions: ['D-033', 'D-169'],
    reason: `${financeManagerDefault}; dual approval by two different people`,
    steps: [
      { name: 'Finance verification', role: 'finance' },
      { name: 'Finance Manager approval', role: 'finance_manager' },
    ],
  },
  {
    key: 'company_bank_account_change',
    subjectType: 'company_bank_account',
    description: 'Changes to company (entity) bank accounts: maker-checker (accounting-design.md §8, D-093)',
    decisions: ['D-093', 'D-033', 'D-169'],
    reason: `${financeManagerDefault}; dual approval by two different people`,
    steps: [
      { name: 'Finance verification', role: 'finance' },
      { name: 'Finance Manager approval', role: 'finance_manager' },
    ],
  },
  financeManagerOnly('manual_journal', 'journal_entry', 'Manual journals (accounting-design.md §8)', [
    'D-033',
  ]),
  financeManagerOnly(
    'recurring_journal',
    'recurring_journal',
    'Recurring journal definitions, approved once like a manual journal (accounting-design.md §8, B5.1)',
    ['D-033'],
  ),
  financeManagerOnly('credit_note', 'customer_document', 'Credit notes (accounting-design.md §8)', ['D-033']),
  financeManagerOnly('refund', 'refund', 'Refunds (accounting-design.md §8)', ['D-033']),
  financeManagerOnly('write_off', 'receivable_item', 'Bad-debt write-offs (accounting-design.md §8)', [
    'D-033',
  ]),
  financeManagerOnly(
    'posting_rule_change',
    'posting_rule_version',
    'Changes to posting rules (accounting-design.md §8)',
    ['D-033'],
  ),
  financeManagerOnly(
    'coa_change',
    'account_change',
    'Changes to the chart of accounts (accounting-design.md §8)',
    ['D-033'],
  ),
  financeManagerOnly(
    'tax_setting_change',
    'tax_rate_version',
    'Changes to tax settings (accounting-design.md §8)',
    ['D-033'],
  ),
  financeManagerOnly(
    'document_series_change',
    'document_series',
    'Changes to document series (accounting-design.md §8)',
    ['D-033'],
  ),
  {
    key: 'company_order_approval',
    subjectType: 'order_group',
    description: "Company-side approval of orders above the company's own threshold (D-123)",
    decisions: ['D-123'],
    reason: 'Seed from D-123',
    steps: [
      {
        name: 'Company approver',
        role: 'company_approver',
        scope: 'subject_company',
        condition: { field: 'amount', op: 'gt', ref: 'company.order_approval_threshold' },
      },
    ],
  },
  {
    key: 'referral_review',
    subjectType: 'referral_attribution',
    description: 'Suspicious referrals reviewed by Marketing (D-136)',
    decisions: ['D-136'],
    reason: 'Seed from D-136',
    steps: [{ name: 'Marketing review', role: 'marketing' }],
  },
  {
    key: 'style_library_change',
    subjectType: 'style_import_run',
    description:
      'Changes an import makes to published style-library bases or variants (copy, axes, recipe, retirement): Prepress, then Marketing (D-242, D-212)',
    decisions: ['D-242', 'D-212'],
    reason: 'Seed from D-242 — Prepress then Marketing approve',
    steps: [
      { name: 'Prepress approval', role: 'prepress' },
      { name: 'Marketing approval', role: 'marketing' },
    ],
  },
];
