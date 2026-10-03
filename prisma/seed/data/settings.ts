/**
 * Settings defaults from docs/decisions.md (B1.2 step 3, ADR-0005). Every value cites its decision;
 * Proposed / ⚖ values are flagged with `confirmation`. Values a decision leaves open are NOT seeded:
 * human code formats (schema-design Q-2).
 * Money and percentages are decimal strings (CLAUDE.md); percentages are in percent (10 = 10 %).
 */
import { ADVISORY_RULE_SET_SCHEMA } from '../../../src/modules/advisory/rule-set';
import { STUDIO_PRINT_RULES } from './studio';

export type Confirmation = 'confirmed' | 'proposed' | 'pending_cpa' | 'pending_business';

export interface SettingSeed {
  key: string;
  valueType:
    | 'string'
    | 'integer'
    | 'decimal'
    | 'money'
    | 'percent'
    | 'boolean'
    | 'enum'
    | 'json'
    | 'time_of_day_window';
  value: unknown;
  /** JSON schema fragment stored in `settings.value_schema` (allowed enum values, bounds). */
  valueSchema?: Record<string, unknown>;
  description: string;
  decisions: string[];
  confirmation?: Confirmation;
  ownerRole?: string;
  /**
   * Definition only: the setting exists (so its owner can create the first version) but no value is
   * seeded because no decision gives one; readers treat it as "not set".
   */
  unset?: true;
}

export const SETTINGS: readonly SettingSeed[] = [
  // --- Pricing & selling
  {
    key: 'pricing.margin_floor_pct',
    valueType: 'percent',
    value: '10',
    description: 'D-012 margin floor: reassignment, discounts and promotions never go below it',
    decisions: ['D-012', 'D-063'],
  },
  {
    key: 'quotes.validity_days',
    valueType: 'integer',
    value: 15,
    description: 'D-051 quotation validity with price lock (days)',
    decisions: ['D-051'],
  },
  {
    key: 'discounts.cs_limit_pct',
    valueType: 'percent',
    value: '5',
    description: 'D-052 discount CS may give without a discount memo',
    decisions: ['D-052'],
  },
  {
    key: 'campaigns.budget_alert_pct',
    valueType: 'percent',
    value: '80',
    description: 'D-154 Marketing is alerted when a campaign has used this share of its budget',
    decisions: ['D-154'],
  },
  {
    key: 'promotions.code_attempt_limits',
    valueType: 'json',
    value: { perCustomerPerHour: 10, perIpPerHour: 30, perDevicePerHour: 10 },
    description: 'D-053 abuse control: coupon code attempts allowed per customer, IP and device each hour',
    decisions: ['D-053'],
    confirmation: 'proposed',
  },

  // --- Payments & payouts
  {
    key: 'payments.schedule_split_threshold',
    valueType: 'money',
    value: '20000.00',
    description:
      'D-020 order value (THB) from which the 50 % deposit + 50 % before shipping schedule applies',
    decisions: ['D-020'],
  },
  {
    key: 'payments.slip_review_sla_business_hours',
    valueType: 'integer',
    value: 4,
    description: 'D-061 Finance SLA for slips that fail automatic verification (business hours)',
    decisions: ['D-061'],
  },
  {
    key: 'payouts.advance_pct',
    valueType: 'percent',
    value: '30',
    description: 'D-022 default factory advance paid on job acceptance',
    decisions: ['D-022'],
  },
  {
    key: 'payouts.balance_trigger',
    valueType: 'enum',
    value: 'after_pod_and_claim_window',
    valueSchema: { enum: ['after_pod_and_claim_window', 'after_pod', 'immediate'] },
    description: 'D-022 default trigger of the factory balance payout',
    decisions: ['D-022'],
  },
  {
    key: 'payouts.retention_pct',
    valueType: 'percent',
    value: '5',
    description: 'D-022 default retention held from the factory balance payout',
    decisions: ['D-022'],
  },
  {
    key: 'payouts.retention_release_days',
    valueType: 'integer',
    value: 30,
    description: 'D-164 days after the claim window closes until the retention is released',
    decisions: ['D-164', 'D-022'],
  },

  // --- Production, delivery, claims
  {
    key: 'production.factory_acceptance_sla_business_days',
    valueType: 'integer',
    value: 1,
    description: 'D-074 time a factory has to accept a released job (business days)',
    decisions: ['D-074'],
  },
  {
    key: 'fulfilment.tolerance_default_pct',
    valueType: 'percent',
    value: '5',
    description: 'D-163 default quantity tolerance ± % (shortage and overage) until a factory sets its own',
    decisions: ['D-163', 'D-021'],
  },
  {
    key: 'orders.auto_complete_days',
    valueType: 'integer',
    value: 7,
    description: 'D-081 days after delivery until an order completes automatically',
    decisions: ['D-081'],
  },
  {
    key: 'claims.window_days',
    valueType: 'integer',
    value: 7,
    description: 'D-082 claim window after receipt (days)',
    decisions: ['D-082'],
  },
  {
    key: 'qc.inspection_sampling',
    valueType: 'json',
    value: {
      fullInspectionFromValue: '300000.00',
      sampledBandFromValue: '100000.00',
      sampledBandRatePct: '20',
      trialFactoryJobs: 3,
      trialFactoryRatePct: '100',
      highDefectRateThresholdPct: '3',
      highDefectWindowDays: 90,
      highDefectRatePct: '50',
      specialFinishOrFoodUpliftPp: '20',
      isoInspectionLevel: 'II',
      aql: { critical: '0', major: '2.5', minor: '4.0' },
    },
    description: 'D-076 Packio risk-based inspection sampling (ISO 2859-1)',
    decisions: ['D-076'],
  },

  // --- Artwork & prepress (D-070, B4.1)
  {
    key: 'artwork.preflight_rules',
    valueType: 'json',
    value: {
      severities: {
        size_mismatch: 'block',
        missing_bleed: 'block',
        low_resolution: 'warn',
        rgb_colour: 'warn',
        fonts_not_embedded: 'info',
        safe_zone: 'info',
        thin_lines: 'info',
        overprint: 'info',
        ink_coverage: 'info',
      },
      bleedMm: '3',
      sizeToleranceMm: '1',
      minEffectivePpi: 300,
      safeZoneMm: '3',
      minLineWidthPt: '0.25',
      maxInkCoveragePct: 300,
    },
    description:
      'D-070 preflight: block on size mismatch or missing bleed, warn on low resolution or RGB; other checks report only; technical thresholds proposed (ADR-0009)',
    decisions: ['D-070'],
    confirmation: 'proposed',
  },
  {
    key: 'artwork.prepress_sla_business_hours',
    valueType: 'integer',
    value: null,
    unset: true,
    description:
      'D-070 prepress queue: business hours to answer a submission; no decision gives it, no due time until set',
    decisions: ['D-070'],
    confirmation: 'pending_business',
  },

  // --- Design services (D-071)
  {
    key: 'design.hired_design_sla',
    valueType: 'json',
    value: { targetBusinessDays: 5, maxBusinessDays: 10 },
    description: 'D-071 hired design delivery target and maximum',
    decisions: ['D-071'],
  },
  {
    key: 'design.free_revision_rounds',
    valueType: 'integer',
    value: 3,
    description: 'D-071 free revision rounds per hired design',
    decisions: ['D-071'],
  },
  {
    key: 'design.extra_revision_fee',
    valueType: 'json',
    value: { minimumAmount: '500.00', pctOfDesignFee: '20' },
    description: 'D-071 fee per revision round from round 4: max(minimum, % of the design fee)',
    decisions: ['D-071'],
  },

  // --- Loyalty & referral (D-130…D-136)
  {
    key: 'loyalty.earn_rate',
    valueType: 'json',
    value: { bahtPerPoint: '500.00', basis: 'paid_before_vat_excluding_shipping' },
    description: 'D-130 one point per THB 500 paid (before VAT, excluding shipping)',
    decisions: ['D-130'],
  },
  {
    key: 'loyalty.point_value',
    valueType: 'money',
    value: '2.50',
    description: 'D-131 value of one point (THB); posting rule P10',
    decisions: ['D-131'],
  },
  {
    key: 'loyalty.expected_redemption_rate_pct',
    valueType: 'percent',
    value: '100',
    description:
      'D-131 / P10 expected redemption rate for the points liability (accounting-design.md §5, ⚖ points liability method)',
    decisions: ['D-131', 'D-033'],
    confirmation: 'pending_cpa',
  },
  {
    key: 'loyalty.points_expiry',
    valueType: 'json',
    value: { monthsPerEarning: 12, reminderDaysBefore: 30 },
    description: 'D-132 points expire 12 months per earning, reminder 30 days before',
    decisions: ['D-132'],
  },
  {
    key: 'loyalty.redemption_limits',
    valueType: 'json',
    value: { minimumBaht: '10.00', maxPctOfOrder: '20' },
    description: 'D-133 minimum redemption (THB equivalent) and maximum share of the order value',
    decisions: ['D-133'],
  },
  {
    key: 'loyalty.tiers',
    valueType: 'json',
    value: [
      { tier: 'member', minSpend12m: '0.00', multiplier: '1' },
      { tier: 'silver', minSpend12m: '50000.00', multiplier: '1.25' },
      { tier: 'gold', minSpend12m: '200000.00', multiplier: '1.5' },
    ],
    description: 'D-134 tiers by 12-month spend with earn multipliers',
    decisions: ['D-134'],
  },
  {
    key: 'loyalty.activity_rewards',
    valueType: 'json',
    value: { signupBaht: '50.00', lineLinkingBaht: '20.00', reviewBaht: '10.00' },
    description: 'D-135 activity rewards in baht, converted to points at the point value (rounded down)',
    decisions: ['D-135', 'D-131'],
  },
  {
    key: 'referral.rules',
    valueType: 'json',
    value: {
      refereeDiscountPct: '5',
      refereeDiscountMaxBaht: '500.00',
      referrerRewardBaht: '500.00',
      maxRewardedReferralsPerMonth: 10,
    },
    description: 'D-136 referral rewards and monthly cap',
    decisions: ['D-136'],
  },

  // --- B2B (D-121, D-122)
  {
    key: 'b2b.kyc_certificate_max_age_months',
    valueType: 'integer',
    value: 6,
    description: 'D-120 a company certificate is accepted only when issued within this many months',
    decisions: ['D-120'],
  },
  {
    key: 'b2b.credit_terms',
    valueType: 'json',
    value: { allowedDays: [15, 30, 45, 60], defaultDays: 30 },
    description: 'D-121 credit terms a company may be given',
    decisions: ['D-121'],
  },
  {
    key: 'b2b.credit_eligibility_paid_orders',
    valueType: 'integer',
    value: 3,
    description: 'D-121 paid orders after which a prepaid company becomes eligible for credit',
    decisions: ['D-121'],
  },
  {
    key: 'b2b.overdue_rules',
    valueType: 'json',
    value: { reminderDaysBeforeDue: 7, blockCreditOrdersAfterDaysOverdue: 7 },
    description: 'D-122 overdue reminders and credit-order blocking',
    decisions: ['D-122'],
  },

  // --- Finance (B5, accounting-design.md; ⚖ items are pending the CPA)
  {
    key: 'tax.rounding_mode',
    valueType: 'enum',
    value: 'line',
    valueSchema: { enum: ['line', 'document'] },
    description:
      'D-033 / accounting-design §1.5 VAT and WHT rounding per line or per document (⚖); a document-level difference is an explicit rounding amount',
    decisions: ['D-033'],
    confirmation: 'pending_cpa',
    ownerRole: 'finance_manager',
  },
  {
    key: 'receivables.forfeited_deposit_policy',
    valueType: 'json',
    value: { forfeitPct: '0' },
    valueSchema: {
      type: 'object',
      required: ['forfeitPct'],
      properties: { forfeitPct: { type: 'string', pattern: '^\\d{1,3}(\\.\\d{1,4})?$' } },
    },
    description:
      'D-033 / accounting-design §10 forfeited deposit policy (⚖): % of the paid deposit kept when an order is cancelled before production; 0 until the business decides (P23)',
    decisions: ['D-033', 'D-020'],
    confirmation: 'pending_business',
    ownerRole: 'finance_manager',
  },
  {
    key: 'receivables.allowance_rates',
    valueType: 'json',
    value: null,
    unset: true,
    description:
      'D-033 / accounting-design §10 allowance method (⚖): % of open receivables per days-overdue band for P30; not seeded — until set, Finance enters the allowance amount',
    decisions: ['D-033'],
    confirmation: 'pending_cpa',
    ownerRole: 'finance_manager',
  },
  {
    key: 'documents.retention_years',
    valueType: 'integer',
    value: 10,
    valueSchema: { minimum: 5, maximum: 50 },
    description:
      'D-033 / accounting-design §2 record retention of documents and ledgers (≥ 10 years, above the 5-year statutory minimum)',
    decisions: ['D-033'],
    ownerRole: 'finance_manager',
  },
  {
    key: 'banking.auto_match',
    valueType: 'json',
    value: { dateWindowDays: 3, amountTolerance: '0.00' },
    valueSchema: {
      type: 'object',
      required: ['dateWindowDays', 'amountTolerance'],
      properties: {
        dateWindowDays: { type: 'integer', minimum: 0, maximum: 31 },
        amountTolerance: { type: 'string' },
      },
    },
    description:
      'D-093 / accounting-design §6 bank auto-matching: exact amount (± tolerance) + reference + date window (proposed)',
    decisions: ['D-093', 'D-061'],
    confirmation: 'proposed',
    ownerRole: 'finance_manager',
  },
  {
    key: 'tax.calendar',
    valueType: 'json',
    value: {
      pp30: { dayOfNextMonth: 15 },
      pnd3: { dayOfNextMonth: 7 },
      pnd53: { dayOfNextMonth: 7 },
      reminderDaysBefore: 3,
    },
    description:
      'D-033 / accounting-design §6 tax calendar: filing due day of the following month per form (paper-filing days; e-filing extensions are a Finance choice) and the reminder lead time (proposed)',
    decisions: ['D-033'],
    confirmation: 'proposed',
    ownerRole: 'finance_manager',
  },
  {
    key: 'audit.business_hours',
    valueType: 'json',
    value: { start: '08:00', end: '18:00', weekdays: [1, 2, 3, 4, 5] },
    description:
      'D-033 / accounting-design §8 exception report: manual journals posted outside these hours (Asia/Bangkok, ISO weekdays) are listed for the auditor (proposed)',
    decisions: ['D-033'],
    confirmation: 'proposed',
    ownerRole: 'finance_manager',
  },
  {
    key: 'fixed_assets.depreciation_start',
    valueType: 'enum',
    value: 'acquisition_month',
    valueSchema: { enum: ['acquisition_month', 'next_month'] },
    description:
      'D-150 first month of straight-line depreciation: the month the asset is acquired (full month) or the month after (⚖ pro-rata by days is not used)',
    decisions: ['D-150'],
    confirmation: 'pending_cpa',
    ownerRole: 'finance_manager',
  },
  {
    key: 'tax.gl_accounts',
    valueType: 'json',
    value: {
      output_vat: ['2210'],
      input_vat: ['1241'],
      wht_pnd3: ['2232'],
      wht_pnd53: ['2231'],
      wht_receivable: ['1230'],
    },
    description:
      'D-033 / accounting-design §7 step 7: GL control accounts each tax report and working paper reconciles to (difference must be 0); follows the chart of accounts (proposed)',
    decisions: ['D-033'],
    confirmation: 'proposed',
    ownerRole: 'finance_manager',
  },
  {
    key: 'close.unmatched_items_threshold',
    valueType: 'integer',
    value: 0,
    valueSchema: { minimum: 0 },
    description:
      'D-033 / accounting-design §7 step 1: unmatched bank / gateway items allowed at close before each must be explained (proposed: none)',
    decisions: ['D-033'],
    confirmation: 'proposed',
    ownerRole: 'finance_manager',
  },

  // --- Orders & tax (B3.1)
  {
    key: 'orders.unpaid_expiry_days',
    valueType: 'integer',
    value: 7,
    valueSchema: { minimum: 1, maximum: 90 },
    description:
      'D-060 calendar days after placement until an unpaid order group is cancelled; legacy reads the value from a secret not in the repository, so its 7-day fallback is seeded (B3.1, 2026-09-27)',
    decisions: ['D-060'],
    confirmation: 'proposed',
  },
  {
    key: 'tax.nature_by_product_type',
    valueType: 'json',
    value: { default: 'hire_of_work', overrides: { standard_product: 'sale_of_goods' } },
    valueSchema: {
      type: 'object',
      required: ['default', 'overrides'],
      properties: {
        default: { enum: ['sale_of_goods', 'hire_of_work'] },
        overrides: { type: 'object', additionalProperties: { enum: ['sale_of_goods', 'hire_of_work'] } },
      },
    },
    description:
      'D-033 / accounting-design §2 nature of the sale per product type code (⚖): hire of work for made-to-order packaging, sale of goods for standard products; snapshotted on every order',
    decisions: ['D-033'],
    confirmation: 'pending_cpa',
    ownerRole: 'finance_manager',
  },

  // --- Payments (B3.2)
  {
    key: 'calendar.business_hours',
    valueType: 'time_of_day_window',
    value: { from: '09:00', to: '18:00', timezone: 'Asia/Bangkok' },
    description:
      'D-175 business hours of working days (national calendar) for business-hour SLAs such as the D-061 slip review',
    decisions: ['D-175', 'D-061'],
    confirmation: 'proposed',
  },
  {
    key: 'payments.qr_validity_minutes',
    valueType: 'integer',
    value: 1440,
    valueSchema: { minimum: 5, maximum: 10080 },
    description:
      'D-060 / D-176 lifetime of one SCB QR payment attempt (minutes); legacy used SCB_DAYS_UNTIL_EXPIRATION (sample 1 day); never shortens the order expiry',
    decisions: ['D-060', 'D-176'],
    confirmation: 'proposed',
  },
  {
    key: 'payments.method_fees',
    valueType: 'json',
    value: null,
    unset: true,
    valueSchema: { type: 'object', additionalProperties: { type: 'object' } },
    description:
      'D-176 fee Packio expects per payment method ({method: {pct, fixedAmount}}), recorded on each payment for P04; not seeded — fee 0 until Finance sets it',
    decisions: ['D-176'],
    confirmation: 'pending_business',
    ownerRole: 'finance_manager',
  },
  {
    key: 'payments.slip_receiver_accounts',
    valueType: 'json',
    value: null,
    unset: true,
    valueSchema: { type: 'array' },
    description:
      'D-061 collection accounts a slip must pay into ([{accountType, accountNumber}] in the Slip2Go form); not seeded — until set, no slip passes automatically (all go to Finance)',
    decisions: ['D-061'],
    confirmation: 'pending_business',
    ownerRole: 'finance_manager',
  },

  // --- Notifications (D-144)
  {
    key: 'notifications.marketing_window',
    valueType: 'time_of_day_window',
    value: { from: '09:00', to: '20:00', timezone: 'Asia/Bangkok' },
    description: 'D-144 marketing messages are sent only inside this window (transactional anytime)',
    decisions: ['D-144'],
  },

  // --- Authentication (ADR-0004). No D-### sets these values; the platform-threshold rule D-063
  // makes them superadmin settings. Chosen by the user on 2026-09-23 (conservative option),
  // seeded as `proposed` until the security review confirms them.
  {
    key: 'auth.access_token_ttl_seconds',
    valueType: 'integer',
    value: 600,
    valueSchema: { minimum: 600, maximum: 900 },
    description: 'D-063 / ADR-0004 access-token lifetime in seconds (contract §4: 10–15 minutes)',
    decisions: ['D-063'],
    confirmation: 'proposed',
  },
  {
    key: 'auth.refresh_token_lifetimes',
    valueType: 'json',
    value: {
      staff: { absoluteHours: 12, idleHours: 2 },
      partner: { absoluteHours: 168, idleHours: 24 },
      customer: { absoluteHours: 720, idleHours: 168 },
    },
    description: 'D-063 / ADR-0004 refresh-token absolute and idle lifetimes per audience (hours)',
    decisions: ['D-063'],
    confirmation: 'proposed',
  },
  {
    key: 'auth.otp_policy',
    valueType: 'json',
    value: {
      codeLength: 6,
      expirySeconds: 300,
      maxAttempts: 5,
      resendCooldownSeconds: 60,
      maxPerPhonePerHour: 5,
      maxPerIpPerHour: 20,
    },
    description: 'D-063 / ADR-0004 customer phone OTP: expiry, attempts and rate limits',
    decisions: ['D-063'],
    confirmation: 'proposed',
  },
  {
    key: 'auth.password_lockout',
    valueType: 'json',
    value: { maxFailedAttempts: 5, lockMinutes: 15 },
    description: 'D-063 / ADR-0004 staff and partner password lockout after failed logins',
    decisions: ['D-063'],
    confirmation: 'proposed',
  },
  {
    key: 'auth.device_pin_policy',
    valueType: 'json',
    value: { length: 6, maxAttempts: 5, lockMinutes: 15 },
    description: 'D-063 / ADR-0004 optional partner device PIN: length and attempt limit',
    decisions: ['D-063'],
    confirmation: 'proposed',
  },

  // --- Multi-factory activation & analytics (D-101, D-044, D-160)
  {
    key: 'partners.auto_selection_min_factories',
    valueType: 'integer',
    value: 2,
    description:
      'D-101 active factories per product type before auto-selection and auto-reassignment switch on',
    decisions: ['D-101', 'D-012'],
  },
  {
    key: 'partners.peer_benchmark_min_factories',
    valueType: 'integer',
    value: 3,
    description: 'D-101 / D-044 active factories per product type before peer benchmarks are computed',
    decisions: ['D-101', 'D-044'],
  },
  {
    key: 'partners.impact_simulation_window_days',
    valueType: 'integer',
    value: 90,
    description: 'D-040 note: the impact simulation re-prices the factory quotes of the last 90 days',
    decisions: ['D-040'],
  },
  {
    key: 'partners.suggestion_deviation_band_pct',
    valueType: 'percent',
    value: null,
    unset: true,
    valueSchema: { minimum: 0, maximum: 100 },
    description:
      'D-040 / D-172 band above which a proposed buy price is flagged against its suggestion; not seeded (D-172) — no above_band flag until a superadmin sets it',
    decisions: ['D-172', 'D-040'],
    confirmation: 'pending_business',
  },
  // --- RFQ (B2.5, D-100). No decision gives the SLA: definition only (B2.5 plan, 2026-09-26).
  {
    key: 'rfq.sla_business_hours',
    valueType: 'integer',
    value: null,
    unset: true,
    valueSchema: { minimum: 1, maximum: 720 },
    description:
      'D-100 first-response SLA of a request for quote, in business hours; scoped per product type (RFQ category) with a platform fallback; not seeded — no SLA due date until set',
    decisions: ['D-100'],
    confirmation: 'pending_business',
  },

  // --- Shipping (B2.4, D-013). No decision gives these values: definitions only (B2.4 plan, 2026-09-26).
  {
    key: 'shipping.carton_spec',
    valueType: 'json',
    value: null,
    unset: true,
    valueSchema: {
      type: 'object',
      required: ['gridCm', 'maxStackHeightCm', 'maxWeightKg'],
      properties: {
        gridCm: { type: 'number', exclusiveMinimum: 0 },
        maxStackHeightCm: { type: 'number', exclusiveMinimum: 0 },
        maxWeightKg: { type: 'number', exclusiveMinimum: 0 },
      },
    },
    description:
      'D-013 shipping carton used by the packing helper (legacy parcel logic: square footprint grid, stack height, weight limit); not seeded — no carton count until set',
    decisions: ['D-013'],
    confirmation: 'pending_business',
  },
  {
    key: 'shipping.pallet_spec',
    valueType: 'json',
    value: null,
    unset: true,
    valueSchema: {
      type: 'object',
      required: ['lengthCm', 'widthCm', 'maxHeightCm', 'maxWeightKg'],
      properties: {
        lengthCm: { type: 'number', exclusiveMinimum: 0 },
        widthCm: { type: 'number', exclusiveMinimum: 0 },
        maxHeightCm: { type: 'number', exclusiveMinimum: 0 },
        maxWeightKg: { type: 'number', exclusiveMinimum: 0 },
      },
    },
    description:
      'D-013 pallet used to count cartons per pallet (no legacy rule exists); not seeded — no pallet count until set',
    decisions: ['D-013'],
    confirmation: 'pending_business',
  },
  {
    key: 'shipping.target_margin_pct',
    valueType: 'percent',
    value: null,
    unset: true,
    valueSchema: { minimum: 0, maximum: 100 },
    description:
      'D-040 group 5 target shipping margin: suggested factory payout = customer rate × (1 − margin); not seeded — no group-5 suggestion until set',
    decisions: ['D-040', 'D-013'],
    confirmation: 'pending_business',
  },
  // --- Launch monitoring (B6.3, D-113). Operational thresholds, not business values: proposed, superadmin.
  {
    key: 'ops.alert_thresholds',
    valueType: 'json',
    value: {
      outbox_dead_letters: 1,
      outbox_backlog_minutes: 15,
      queue_depth: 1000,
      webhook_failures_24h: 5,
      payout_item_failures_7d: 1,
      ledger_posting_failures: 1,
      acceptance_overdue: 1,
      production_at_risk: 5,
      rfq_first_response_overdue: 1,
      approvals_overdue: 5,
      slip_verification_wait_hours: 4,
      // D-263: one overdue claim is worth an alert.
      claim_response_overdue: 1,
      claim_decision_overdue: 1,
    },
    valueSchema: { type: 'object', additionalProperties: { type: 'integer', minimum: 1 } },
    description:
      'D-113 launch monitoring: value at which each operational signal raises an alert to superadmins and admins (slip wait mirrors the D-061 4-hour SLA in wall-clock hours; the rest proposed)',
    decisions: ['D-113', 'D-061', 'D-074'],
    confirmation: 'proposed',
    ownerRole: 'superadmin',
  },
  {
    key: 'analytics.prospectus_min_group_size',
    valueType: 'integer',
    value: 3,
    description: 'D-160 minimum factories per breakdown in anonymised exports and the partner prospectus',
    decisions: ['D-160', 'D-044'],
  },
  {
    key: 'analytics.target_price_min_group_size',
    valueType: 'integer',
    value: 5,
    valueSchema: { minimum: 1, maximum: 100 },
    description:
      'D-190 / D-252 minimum distinct customers per cell for any figure built from customers’ target prices (prospectus and staff views)',
    decisions: ['D-190', 'D-252'],
    ownerRole: 'superadmin',
  },
  {
    key: 'analytics.price_gap_bands_pct',
    valueType: 'json',
    value: [10, 25, 50],
    valueSchema: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
    },
    description:
      'D-252 upper bounds (% of the target) of the price-gap bands of unmet demand, ascending: [10, 25, 50] → 0-10, 10-25, 25-50, 50+',
    decisions: ['D-252'],
    confirmation: 'proposed',
    ownerRole: 'superadmin',
  },
  // --- Trust data (U2.5, D-201 / D-264): public network statistics.
  {
    key: 'trust.network_min_factories',
    valueType: 'integer',
    value: 3,
    valueSchema: { minimum: 1, maximum: 100 },
    description:
      'D-201 / D-264 active factories needed before partner counts and rates are published (also the style library partners count)',
    decisions: ['D-201', 'D-264', 'D-044'],
    ownerRole: 'superadmin',
  },
  {
    key: 'trust.network_min_jobs',
    valueType: 'integer',
    value: 30,
    valueSchema: { minimum: 1, maximum: 100_000 },
    description: 'D-201 / D-264 production jobs completed in the window needed before rates are published',
    decisions: ['D-201', 'D-264'],
    ownerRole: 'superadmin',
  },
  {
    key: 'trust.network_window_days',
    valueType: 'integer',
    value: 90,
    valueSchema: { minimum: 7, maximum: 730 },
    description: 'D-201 / D-264 rolling window (days) of the published on-time and first-pass rates',
    decisions: ['D-201', 'D-264'],
    ownerRole: 'superadmin',
  },
  {
    key: 'trust.audit_criteria',
    valueType: 'json',
    value: null,
    unset: true,
    valueSchema: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        required: ['key', 'labelTh', 'labelEn'],
        properties: {
          key: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,39}$' },
          labelTh: { type: 'string', minLength: 1, maxLength: 300 },
          labelEn: { type: 'string', minLength: 1, maxLength: 300 },
        },
      },
    },
    description:
      'D-201 / D-264 the factory audit criteria published on the network page (th / en); not seeded — written by the Partner Manager',
    decisions: ['D-201', 'D-264', 'D-041'],
    confirmation: 'pending_business',
    ownerRole: 'partner_manager',
  },
  {
    key: 'samples.credit_pct',
    valueType: 'percent',
    value: '100',
    valueSchema: { minimum: 0, maximum: 100 },
    description:
      'D-197 / D-257 share of an approved standalone sample’s product price (freight excluded) credited on its bulk order',
    decisions: ['D-197', 'D-257'],
    ownerRole: 'superadmin',
  },
  {
    key: 'samples.credit_window_days',
    valueType: 'integer',
    value: 30,
    valueSchema: { minimum: 0, maximum: 365 },
    description: 'D-197 / D-257 days after a sample’s approval within which its bulk order gets the credit',
    decisions: ['D-197', 'D-257'],
    ownerRole: 'superadmin',
  },
  {
    key: 'quotes.lever_quantity_multipliers',
    valueType: 'json',
    value: [2, 5],
    valueSchema: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: { type: 'number', exclusiveMinimum: 1, maximum: 100 },
    },
    description:
      'D-248 quantity levers when the catalogue product has no preset quantity above the quoted: the largest quoted quantity × each multiplier',
    decisions: ['D-248'],
    confirmation: 'proposed',
    ownerRole: 'superadmin',
  },

  // --- Artwork (U-B0.1): the proof approval checklist. No decision gives the items: definition only.
  {
    key: 'artwork.approval_checklist',
    valueType: 'json',
    value: null,
    unset: true,
    valueSchema: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        required: ['key', 'labelTh', 'labelEn'],
        properties: {
          key: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,39}$' },
          labelTh: { type: 'string', minLength: 1, maxLength: 200 },
          labelEn: { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
    },
    description:
      'D-073 items the customer confirms when approving a proof (spelling, colours, size…), kept as approval evidence; not seeded — no checklist until set',
    decisions: ['D-073'],
    confirmation: 'pending_business',
  },

  // --- PDPA requests (U-B0.1, D-222): Superadmin (D-063).
  {
    key: 'privacy.response_days',
    valueType: 'integer',
    value: 30,
    valueSchema: { minimum: 1, maximum: 90 },
    description:
      'D-222 calendar days to answer a PDPA data-subject request (export or deletion); ⚖ legal counsel may adjust',
    decisions: ['D-222'],
    ownerRole: 'superadmin',
  },
  {
    key: 'privacy.export_link_days',
    valueType: 'integer',
    value: 7,
    valueSchema: { minimum: 1, maximum: 30 },
    description:
      'D-222 days a PDPA data export stays downloadable after the Data Protection Officer completes it',
    decisions: ['D-222'],
    ownerRole: 'superadmin',
  },

  // --- Share links (D-185; design share links U-B0.1, D-226): Superadmin (D-063).
  {
    key: 'configurations.share_link_days',
    valueType: 'integer',
    value: 15,
    valueSchema: { minimum: 1, maximum: 365 },
    description:
      'D-185 days a share link stays valid (as the D-051 quotation validity); design share links use it (D-226)',
    decisions: ['D-185', 'D-226'],
    ownerRole: 'superadmin',
  },
  {
    key: 'configurations.draft_retention_days',
    valueType: 'integer',
    value: 90,
    valueSchema: { minimum: 1, maximum: 730 },
    description: 'D-185 days a draft configuration is kept after its last change, then deleted',
    decisions: ['D-185'],
    ownerRole: 'superadmin',
  },

  // --- Specification tolerances (U2.1, D-186): platform defaults until a factory override is approved (D-173).
  {
    key: 'fulfilment.dimensional_tolerance_mm',
    valueType: 'json',
    value: { folding: '1', tag_sleeve: '1', corrugate: '3' },
    valueSchema: {
      type: 'object',
      additionalProperties: { type: 'string', pattern: '^\\d{1,4}(\\.\\d{1,2})?$' },
    },
    description:
      'D-186 published dimensional tolerance ± mm per calculator (folding cartons incl. tags & sleeves ± 1, corrugated ± 3); a calculator not listed publishes none',
    decisions: ['D-186'],
    ownerRole: 'superadmin',
  },
  {
    key: 'fulfilment.colour_tolerance_delta_e',
    valueType: 'json',
    value: { standard: '3', flexo: '5' },
    valueSchema: {
      type: 'object',
      required: ['standard', 'flexo'],
      properties: {
        standard: { type: 'string', pattern: '^\\d{1,4}(\\.\\d{1,2})?$' },
        flexo: { type: 'string', pattern: '^\\d{1,4}(\\.\\d{1,2})?$' },
      },
    },
    description:
      'D-186 published colour tolerance, ΔE2000 against the approved proof, for printed products (≤ 3; ≤ 5 for flexo)',
    decisions: ['D-186'],
    ownerRole: 'superadmin',
  },

  // --- Style library (U3, D-212, D-243)
  {
    key: 'styles.published_wave',
    valueType: 'integer',
    value: 1,
    valueSchema: { minimum: 1, maximum: 9 },
    description:
      'D-212 / D-243 highest style-library wave whose variants may be published (wave 1 at launch: only variants the launch factory can make)',
    decisions: ['D-212', 'D-243'],
    ownerRole: 'superadmin',
  },

  // --- Partner dieline intake (U3.B6, D-272): definition only — no intake until Legal / the Partner Manager sets it.
  {
    key: 'styles.intake_terms',
    valueType: 'json',
    value: null,
    unset: true,
    valueSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['textTh', 'textEn'],
      properties: {
        textTh: { type: 'string', minLength: 1, maxLength: 20000 },
        textEn: { type: 'string', minLength: 1, maxLength: 20000 },
      },
    },
    description:
      'D-272 terms a factory accepts when it offers a dieline to the style library (permission to use, adapt and publish the structure); not seeded — factories cannot submit until it is set',
    decisions: ['D-272'],
    ownerRole: 'partner_manager',
  },

  // --- Studio print checks (U4.B3, D-278 / D-279): owned by Prepress.
  {
    key: 'studio.print_rules',
    valueType: 'json',
    value: STUDIO_PRINT_RULES,
    valueSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['rules'],
      properties: {
        rules: {
          type: 'array',
          maxItems: 100,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'severity', 'evaluatedOn', 'printMethods', 'materialClasses', 'thresholds'],
            properties: {
              id: { type: 'string', pattern: '^[a-z][a-z0-9_]{1,63}$' },
              severity: { enum: ['block', 'warn', 'info'] },
              evaluatedOn: { type: 'array', items: { enum: ['document', 'web', 'pdf'] }, minItems: 1 },
              printMethods: {
                type: ['array', 'null'],
                items: { enum: ['digital', 'offset', 'flexo', 'none'] },
              },
              materialClasses: { type: ['array', 'null'], items: { type: 'string', maxLength: 40 } },
              thresholds: {
                type: ['object', 'null'],
                additionalProperties: { type: ['number', 'string'] },
              },
            },
          },
        },
      },
    },
    description:
      'D-278 studio print-check rule catalogue served to the web and evaluated on the document and the print PDF: ' +
      'rule id, severity, where it runs, print methods / material classes, thresholds (null = off until set); ' +
      'seeded with the spec 300 / 150 ppi and the ADR-0009 bleed, safe zone and hairline values only',
    decisions: ['D-278', 'D-070'],
    confirmation: 'proposed',
    ownerRole: 'prepress',
  },
  {
    key: 'studio.soft_proof_profiles',
    valueType: 'json',
    value: null,
    unset: true,
    valueSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['profiles'],
      properties: {
        profiles: {
          type: 'array',
          maxItems: 50,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['materialClass', 'transform'],
            properties: {
              materialClass: { type: 'string', maxLength: 40 },
              label: { type: 'string', maxLength: 200 },
              transform: { type: 'object', additionalProperties: { type: ['number', 'string'] } },
            },
          },
        },
      },
    },
    description:
      'D-215 / D-279 simplified soft-proof transforms per material class (preview, never a contract proof); not seeded — no soft proof until Prepress or the factory supplies them',
    decisions: ['D-215', 'D-279'],
    ownerRole: 'prepress',
  },

  // --- Studio funnel targets (U4.B6, D-286): the studio spec §1 launch targets, owned by Marketing.
  {
    key: 'studio.funnel_targets',
    valueType: 'json',
    value: { medianMinutesToCart: 10, artworkToCartPct: '25', preflightPassPct: '90', priceParityPct: '100' },
    valueSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['medianMinutesToCart', 'artworkToCartPct', 'preflightPassPct', 'priceParityPct'],
      properties: {
        medianMinutesToCart: { type: 'number', minimum: 0, maximum: 1440 },
        artworkToCartPct: { type: 'string', pattern: '^\\d{1,3}(\\.\\d{1,2})?$' },
        preflightPassPct: { type: 'string', pattern: '^\\d{1,3}(\\.\\d{1,2})?$' },
        priceParityPct: { type: 'string', pattern: '^\\d{1,3}(\\.\\d{1,2})?$' },
      },
    },
    description:
      'D-286 studio launch targets of the spec §1: median minutes from studio start to first add-to-cart, % of sessions adding artwork that add to cart, % of studio print files passing preflight, % of studio orders whose checkout equals the studio price',
    decisions: ['D-286'],
    ownerRole: 'marketing',
  },

  // --- B2B API (U2.7, D-207 / D-291).
  {
    key: 'api.max_keys_per_company',
    valueType: 'integer',
    value: 5,
    valueSchema: { minimum: 1, maximum: 50 },
    description: 'D-207 / D-291 active API clients a company may hold (issued by its Company Admin)',
    decisions: ['D-207', 'D-291'],
    ownerRole: 'superadmin',
  },
  // --- Call-off agreements (U2.7, D-206 / D-290).
  {
    key: 'calloff.max_months',
    valueType: 'integer',
    value: 6,
    valueSchema: { minimum: 1, maximum: 60 },
    description:
      'D-206 / D-290 longest a call-off agreement may hold a quotation’s unit price (months, from the factory’s acceptance)',
    decisions: ['D-206', 'D-290'],
    ownerRole: 'superadmin',
  },
  // --- Reorder suggestions (U2.7, D-204 / D-288): per SKU, recomputed nightly.
  {
    key: 'reorder.min_orders',
    valueType: 'integer',
    value: 3,
    valueSchema: { minimum: 2, maximum: 50 },
    description:
      'D-204 / D-288 earlier orders of a SKU (specification × approved artwork) needed before it is suggested',
    decisions: ['D-204', 'D-288'],
    ownerRole: 'superadmin',
  },
  {
    key: 'reorder.average_orders',
    valueType: 'integer',
    value: 3,
    valueSchema: { minimum: 1, maximum: 50 },
    description:
      'D-288 order intervals (the most recent) whose simple moving average gives the next need; their orders’ quantities give the suggested quantity',
    decisions: ['D-288'],
    ownerRole: 'superadmin',
  },
  {
    key: 'reorder.safety_stock_days',
    valueType: 'integer',
    value: 7,
    valueSchema: { minimum: 0, maximum: 365 },
    description:
      'D-204 / D-288 days of safety stock: the suggestion comes this many days before need − lead time',
    decisions: ['D-204', 'D-288'],
    ownerRole: 'superadmin',
  },
  // --- Tooling register (U2.7, D-205 / D-289): plates and die blocks kept at the factory that made them.
  {
    key: 'tooling.reuse_months',
    valueType: 'integer',
    value: 12,
    valueSchema: { minimum: 1, maximum: 60 },
    description:
      'D-205 / D-289 months after its last use that a registered plate set or die block is reused (the reorder waives it)',
    decisions: ['D-205', 'D-289'],
    ownerRole: 'superadmin',
  },
  // --- Free dieline download (U3.B5, D-203 / D-271): per signed-in customer; staff are not limited.
  {
    key: 'dielines.downloads_per_day',
    valueType: 'integer',
    value: 20,
    valueSchema: { minimum: 1, maximum: 1000 },
    description:
      'D-203 / D-271 dieline downloads a signed-in customer may take per Bangkok calendar day (staff are not limited)',
    decisions: ['D-203', 'D-271'],
    ownerRole: 'superadmin',
  },
  {
    key: 'dielines.downloads_per_minute',
    valueType: 'integer',
    value: 5,
    valueSchema: { minimum: 1, maximum: 100 },
    description: 'D-203 / D-271 dieline downloads a signed-in customer may take in any 60 seconds',
    decisions: ['D-203', 'D-271'],
    ownerRole: 'superadmin',
  },

  // --- Structure Advisor (U2.2, D-237): definition only — not seeded in production; the advisor answers
  // `advisory.not_configured` until a Superadmin sets it (the proposal is in docs/advisory-validation.md).
  {
    key: 'advisory.rule_set',
    valueType: 'json',
    value: null,
    unset: true,
    valueSchema: ADVISORY_RULE_SET_SCHEMA,
    description:
      'D-237 Structure Advisor rule set: McKee constant, ± uncertainty band %, eligible corrugate formulas, thin-margin threshold % and one factor (0 < f ≤ 1) per band of humidity, storage time, pallet pattern, pallet overhang, transport mode and fragility; not seeded — no advice until a Superadmin sets it after the D-189 sign-off',
    decisions: ['D-188', 'D-237', 'D-239'],
    ownerRole: 'superadmin',
  },

  // --- Support (U-B0.1, D-221): owned by the CS Lead.
  {
    key: 'storefront.support_channels',
    valueType: 'json',
    value: null,
    unset: true,
    valueSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        lineOaId: { type: ['string', 'null'], maxLength: 100 },
        phone: { type: ['string', 'null'], maxLength: 40 },
        email: { type: ['string', 'null'], maxLength: 254 },
        hours: { type: ['string', 'null'], maxLength: 200 },
      },
    },
    description:
      'D-221 Packio support contacts on the storefront (LINE OA id, phone, e-mail, opening hours); Packio’s own accounts (D-005) — not seeded, every field null until the CS Lead sets it',
    decisions: ['D-221', 'D-005'],
    ownerRole: 'cs_lead',
  },
  {
    key: 'support.first_response_business_days',
    valueType: 'integer',
    value: 1,
    valueSchema: { minimum: 1, maximum: 30 },
    description:
      'D-221 first-response target of a contact-form or guided-help conversation, in business days (business hours D-175, calendar D-161)',
    decisions: ['D-221', 'D-175'],
    ownerRole: 'cs_lead',
  },
];

/** Entity-scoped legal data (D-092) — values come from SEED_ENTITY_* env vars, never from code. */
export const ENTITY_SETTING_KEYS = {
  legalNameTh: {
    key: 'entity.legal_name_th',
    description: 'D-092 registered legal name (Thai) of the issuing entity',
  },
  legalNameEn: {
    key: 'entity.legal_name_en',
    description: 'D-092 registered legal name (English) of the issuing entity',
  },
  taxId: { key: 'entity.tax_id', description: 'D-092 tax id (13 digits) of the issuing entity' },
  branchCode: {
    key: 'entity.branch_code',
    description: 'D-092 branch code of the issuing entity (00000 = head office)',
  },
  addressTh: {
    key: 'entity.address_th',
    description: 'D-092 registered address (Thai) printed on documents of the issuing entity',
  },
  phone: {
    key: 'entity.phone',
    description: 'D-092 contact phone printed on documents of the issuing entity',
  },
} as const;
