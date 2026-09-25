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
  financeManagerOnly('credit_note', 'customer_document', 'Credit notes (accounting-design.md §8)', ['D-033']),
  financeManagerOnly('refund', 'refund', 'Refunds (accounting-design.md §8)', ['D-033']),
  financeManagerOnly('write_off', 'receivable_item', 'Bad-debt write-offs (accounting-design.md §8)', [
    'D-033',
  ]),
  financeManagerOnly(
    'posting_rule_change',
    'posting_rule',
    'Changes to posting rules (accounting-design.md §8)',
    ['D-033'],
  ),
  financeManagerOnly('coa_change', 'account', 'Changes to the chart of accounts (accounting-design.md §8)', [
    'D-033',
  ]),
  financeManagerOnly('tax_setting_change', 'tax_rate', 'Changes to tax settings (accounting-design.md §8)', [
    'D-033',
  ]),
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
];
