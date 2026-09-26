/**
 * Settings defaults from docs/decisions.md (B1.2 step 3, ADR-0005). Every value cites its decision;
 * Proposed / ⚖ values are flagged with `confirmation`. Values a decision leaves open are NOT seeded:
 * unpaid-order expiry (D-060, extracted in B3.1) and human code formats (schema-design Q-2).
 * Money and percentages are decimal strings (CLAUDE.md); percentages are in percent (10 = 10 %).
 */
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
  {
    key: 'analytics.prospectus_min_group_size',
    valueType: 'integer',
    value: 3,
    description: 'D-160 minimum factories per breakdown in anonymised exports and the partner prospectus',
    decisions: ['D-160', 'D-044'],
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
} as const;
