/** SoD rules, teams, consent purposes and calendars seeded by `pnpm db:seed`. */

export interface SodRuleSeed {
  key: string;
  description: string;
  decisions: string[];
  kind: 'role_pair' | 'action_pair';
  roles?: [string, string];
  actions?: [string, string];
  subjectMatch?: 'same_subject' | 'same_vendor' | 'same_customer';
}

/** accounting-design.md §8. Action keys are the permissions the finance modules add in B5. */
export const SOD_RULES: readonly SodRuleSeed[] = [
  {
    key: 'payout_run_maker_checker',
    description: 'The creator of a payout run cannot approve it (D-022, §8)',
    decisions: ['D-022', 'D-033'],
    kind: 'action_pair',
    actions: ['payout_run.create', 'payout_run.approve'],
    subjectMatch: 'same_subject',
  },
  {
    key: 'vendor_bill_vs_bank_account',
    description: "Whoever records a vendor bill cannot change that vendor's bank account (§8)",
    decisions: ['D-033'],
    kind: 'action_pair',
    actions: ['vendor_invoice.record', 'vendor_bank_account.change'],
    subjectMatch: 'same_vendor',
  },
  {
    key: 'manual_journal_maker_checker',
    description: 'The maker of a manual journal cannot approve it (§8)',
    decisions: ['D-033'],
    kind: 'action_pair',
    actions: ['journal.create', 'journal.approve'],
    subjectMatch: 'same_subject',
  },
  {
    key: 'credit_note_maker_checker',
    description: 'Whoever requests a credit note cannot issue it (§8)',
    decisions: ['D-033'],
    kind: 'action_pair',
    actions: ['credit_note.request', 'credit_note.issue'],
    subjectMatch: 'same_subject',
  },
  {
    key: 'refund_maker_checker',
    description: 'Whoever requests a refund cannot approve it (§8)',
    decisions: ['D-033'],
    kind: 'action_pair',
    actions: ['refund.request', 'refund.approve'],
    subjectMatch: 'same_subject',
  },
  {
    key: 'write_off_maker_checker',
    description: 'Whoever proposes a write-off cannot approve it (§8)',
    decisions: ['D-033'],
    kind: 'action_pair',
    actions: ['write_off.request', 'write_off.approve'],
    subjectMatch: 'same_subject',
  },
  {
    key: 'bank_account_change_maker_checker',
    description: 'Whoever changes a bank account cannot approve the change (§8)',
    decisions: ['D-033'],
    kind: 'action_pair',
    actions: ['vendor_bank_account.change', 'vendor_bank_account.approve'],
    subjectMatch: 'same_subject',
  },
  {
    key: 'auditor_independent_of_finance',
    description:
      'D-168 the time-boxed Auditor role is never combined with Finance (auditor independence, §8)',
    decisions: ['D-168', 'D-140'],
    kind: 'role_pair',
    roles: ['auditor', 'finance'],
  },
  {
    key: 'auditor_independent_of_finance_manager',
    description:
      'D-168 the time-boxed Auditor role is never combined with Finance Manager (auditor independence, §8)',
    decisions: ['D-168', 'D-140'],
    kind: 'role_pair',
    roles: ['auditor', 'finance_manager'],
  },
];

/** Staff teams for notification routing (D-143); LINE group ids are set by admins. */
export const TEAMS = [
  { code: 'cs', nameTh: 'ฝ่ายบริการลูกค้า', nameEn: 'Customer service' },
  { code: 'prepress', nameTh: 'ฝ่ายเตรียมพิมพ์', nameEn: 'Prepress' },
  { code: 'finance', nameTh: 'ฝ่ายการเงิน', nameEn: 'Finance' },
  { code: 'logistics', nameTh: 'ฝ่ายขนส่ง', nameEn: 'Logistics' },
  { code: 'partner', nameTh: 'ฝ่ายพันธมิตร', nameEn: 'Partner team' },
  { code: 'marketing', nameTh: 'ฝ่ายการตลาด', nameEn: 'Marketing' },
  { code: 'management', nameTh: 'ฝ่ายบริหาร', nameEn: 'Management' },
] as const;

/**
 * Consent purposes (D-005 own consent management, D-144). Only the identities are seeded: the texts are
 * legal content that admins / legal counsel enter as versions — never invented in code.
 */
export const CONSENT_PURPOSES = [
  { key: 'terms_of_service', required: true },
  { key: 'privacy_notice', required: true },
  { key: 'marketing_email', required: false },
  { key: 'marketing_line', required: false },
  { key: 'marketing_sms', required: false },
  { key: 'analytics_cookies', required: false },
  { key: 'personalisation', required: false },
] as const;

/** The one national calendar every factory shares; admins key in the holidays each year (D-161). */
export const NATIONAL_CALENDAR = {
  code: 'th_public',
  name: 'Thai public holidays',
  weekendDays: [0, 6],
} as const;

export interface TaxRateSeed {
  code: string;
  nameTh: string;
  nameEn: string;
  description: string;
  decisions: string[];
  /** Percent, decimal string. */
  ratePct: string;
}

/**
 * Statutory rates the calculators need before B5 (schema-design §7 A-22). Withholding rates are
 * seeded with the finance context (B5).
 */
export const TAX_RATES: readonly TaxRateSeed[] = [
  {
    code: 'vat_standard',
    nameTh: 'ภาษีมูลค่าเพิ่ม อัตราทั่วไป',
    nameEn: 'VAT, standard rate',
    description:
      'Output VAT on sales; rate changes are dated, never edited in place (accounting-design.md §2)',
    decisions: ['D-033'],
    ratePct: '7',
  },
];
