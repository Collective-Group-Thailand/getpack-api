/**
 * Typed view of the settings the code reads (ADR-0005). Keys absent here can still be read as
 * `unknown`; add a key when a module starts using it. Values are what `setting_versions.value`
 * holds: money and percentages are decimal strings.
 */
export interface RefreshLifetime {
  absoluteHours: number;
  idleHours: number;
}

export interface SettingValues {
  'auth.access_token_ttl_seconds': number;
  'auth.refresh_token_lifetimes': Record<'staff' | 'partner' | 'customer', RefreshLifetime>;
  'auth.otp_policy': {
    codeLength: number;
    expirySeconds: number;
    maxAttempts: number;
    resendCooldownSeconds: number;
    maxPerPhonePerHour: number;
    maxPerIpPerHour: number;
  };
  'auth.password_lockout': { maxFailedAttempts: number; lockMinutes: number };
  'auth.device_pin_policy': { length: number; maxAttempts: number; lockMinutes: number };
  'notifications.marketing_window': { from: string; to: string; timezone?: string };
  'pricing.margin_floor_pct': string;
  'quotes.validity_days': number;
  'fulfilment.tolerance_default_pct': string;
  'partners.peer_benchmark_min_factories': number;
  'partners.impact_simulation_window_days': number;
  /** Not seeded (D-172): reading it throws `SettingNotFoundError` until a superadmin sets it. */
  'partners.suggestion_deviation_band_pct': string;
  /** Not seeded (B2.5): RFQ first-response SLA per product type; no due date until set. */
  'rfq.sla_business_hours': number;
  /** Not seeded (B2.4): the packing helper counts no cartons until set. */
  'shipping.carton_spec': { gridCm: number; maxStackHeightCm: number; maxWeightKg: number };
  /** Not seeded (B2.4): no cartons-per-pallet figure until set. */
  'shipping.pallet_spec': { lengthCm: number; widthCm: number; maxHeightCm: number; maxWeightKg: number };
  /** Not seeded (B2.4): no D-040 group-5 suggestion until set. */
  'shipping.target_margin_pct': string;
  /** D-060 calendar days until an unpaid order group is cancelled (proposed, B3.1). */
  'orders.unpaid_expiry_days': number;
  /** accounting-design §2 nature of the sale per product type code (⚖ pending CPA). */
  'tax.nature_by_product_type': {
    default: 'sale_of_goods' | 'hire_of_work';
    overrides: Record<string, 'sale_of_goods' | 'hire_of_work'>;
  };
  'orders.auto_complete_days': number;
  'claims.window_days': number;
  'discounts.cs_limit_pct': string;
  'payments.schedule_split_threshold': string;
  'campaigns.budget_alert_pct': string;
  /** D-053 rate limits on coupon code attempts (proposed). */
  'promotions.code_attempt_limits': { perCustomerPerHour: number; perIpPerHour: number; perDevicePerHour: number };
  /** D-130…D-135 loyalty (all numbers are settings). */
  'loyalty.earn_rate': { bahtPerPoint: string; basis: string };
  'loyalty.point_value': string;
  'loyalty.expected_redemption_rate_pct': string;
  'loyalty.points_expiry': { monthsPerEarning: number; reminderDaysBefore: number };
  'loyalty.redemption_limits': { minimumBaht: string; maxPctOfOrder: string };
  'loyalty.tiers': { tier: 'member' | 'silver' | 'gold'; minSpend12m: string; multiplier: string }[];
  'loyalty.activity_rewards': { signupBaht: string; lineLinkingBaht: string; reviewBaht: string };
  /** D-120 */
  'b2b.kyc_certificate_max_age_months': number;
  'referral.rules': {
    refereeDiscountPct: string;
    refereeDiscountMaxBaht: string;
    referrerRewardBaht: string;
    maxRewardedReferralsPerMonth: number;
  };
  'payments.slip_review_sla_business_hours': number;
  /** D-175 business hours of working days (proposed). */
  'calendar.business_hours': { from: string; to: string; timezone?: string };
  'payments.qr_validity_minutes': number;
  /** Not seeded: fee 0 until Finance sets it. */
  'payments.method_fees': Record<string, { pct?: string; fixedAmount?: string }>;
  /** D-070 preflight: severity per check and the technical thresholds (ADR-0009, proposed). */
  'artwork.preflight_rules': {
    severities: Record<string, 'block' | 'warn' | 'info'>;
    bleedMm: string;
    sizeToleranceMm: string;
    minEffectivePpi: number;
    safeZoneMm: string;
    minLineWidthPt: string;
    maxInkCoveragePct: number;
  };
  /** Not seeded (B4.1): no prepress due time until set. */
  'artwork.prepress_sla_business_hours': number;
  /** D-071 hired design delivery target and maximum. */
  'design.hired_design_sla': { targetBusinessDays: number; maxBusinessDays: number };
  'design.free_revision_rounds': number;
  'design.extra_revision_fee': { minimumAmount: string; pctOfDesignFee: string };
  /** Not seeded: no slip passes automatically until set (D-061). */
  'payments.slip_receiver_accounts': { accountType: string; accountNumber: string; accountNameTH?: string }[];
}

export type SettingKey = keyof SettingValues;
