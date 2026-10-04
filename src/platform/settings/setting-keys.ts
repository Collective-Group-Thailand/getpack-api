import { type RuleCatalogue } from '@modules/studio/print-rules';
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
  /** B5 finance (accounting-design §1.5, §2, §6, §7; ⚖ items pending the CPA). */
  'tax.rounding_mode': 'line' | 'document';
  'receivables.forfeited_deposit_policy': { forfeitPct: string };
  /** Not seeded: % of the open balance per days-overdue band (`fromDays` inclusive) for P30. */
  'receivables.allowance_rates': { fromDays: number; pct: string }[];
  'documents.retention_years': number;
  'banking.auto_match': { dateWindowDays: number; amountTolerance: string };
  'tax.calendar': {
    pp30: { dayOfNextMonth: number };
    pnd3: { dayOfNextMonth: number };
    pnd53: { dayOfNextMonth: number };
    reminderDaysBefore: number;
  };
  'close.unmatched_items_threshold': number;
  /** B5.4 GL control accounts each tax report reconciles to (§7 step 7). */
  /** B5.6 business hours for the §8 exception report (Asia/Bangkok, ISO weekdays 1 = Monday). */
  'audit.business_hours': { start: string; end: string; weekdays: number[] };
  /** B5.5 first month an asset is depreciated (D-150 ⚖). */
  'fixed_assets.depreciation_start': 'acquisition_month' | 'next_month';
  'tax.gl_accounts': {
    output_vat: string[];
    input_vat: string[];
    wht_pnd3: string[];
    wht_pnd53: string[];
    wht_receivable: string[];
  };
  'orders.auto_complete_days': number;
  /** B6.3 alert threshold per operational signal (proposed). */
  'ops.alert_thresholds': Partial<Record<string, number>>;
  /** D-160 minimum contributors per prospectus figure. */
  'analytics.prospectus_min_group_size': number;
  /** D-190 / D-252 minimum distinct customers per cell built from target prices. */
  'analytics.target_price_min_group_size': number;
  /** D-252 ascending upper bounds (%) of the price-gap bands. */
  'analytics.price_gap_bands_pct': number[];
  /** D-201 / D-264 minimum active factories for published network figures. */
  'trust.network_min_factories': number;
  /** D-201 / D-264 minimum completed jobs in the window for published rates. */
  'trust.network_min_jobs': number;
  /** D-201 / D-264 rolling window (days) of the published rates. */
  'trust.network_window_days': number;
  /** D-201 / D-264 published factory audit criteria; not seeded. */
  'trust.audit_criteria': { key: string; labelTh: string; labelEn: string }[];
  /** D-197 / D-257 % of an approved standalone sample's product price credited on its bulk order. */
  'samples.credit_pct': string;
  /** D-197 / D-257 days after approval within which the credit applies. */
  'samples.credit_window_days': number;
  /** D-248 quantity-lever multipliers of the largest quoted quantity (no catalogue preset above it). */
  'quotes.lever_quantity_multipliers': number[];
  'claims.window_days': number;
  'discounts.cs_limit_pct': string;
  'payments.schedule_split_threshold': string;
  'campaigns.budget_alert_pct': string;
  /** D-053 rate limits on coupon code attempts (proposed). */
  'promotions.code_attempt_limits': {
    perCustomerPerHour: number;
    perIpPerHour: number;
    perDevicePerHour: number;
  };
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
  /** D-074 business days a factory has to accept a released job. */
  'production.factory_acceptance_sla_business_days': number;
  /** D-101 active factories a product type needs before auto-selection / auto-reassignment. */
  'partners.auto_selection_min_factories': number;
  /** D-076 Packio risk-based inspection sampling. */
  'qc.inspection_sampling': {
    fullInspectionFromValue: string;
    sampledBandFromValue: string;
    sampledBandRatePct: string;
    trialFactoryJobs: number;
    trialFactoryRatePct: string;
    highDefectRateThresholdPct: string;
    highDefectWindowDays: number;
    highDefectRatePct: string;
    specialFinishOrFoodUpliftPp: string;
    isoInspectionLevel: string;
    aql: { critical: string; major: string; minor: string };
  };
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
  /** D-221 Packio's support contacts on the storefront; not seeded (Packio's own accounts, D-005). */
  'storefront.support_channels': {
    lineOaId?: string | null;
    phone?: string | null;
    email?: string | null;
    hours?: string | null;
  };
  /** D-221 first-response target of a contact-form / hand-off conversation, in business days. */
  'support.first_response_business_days': number;
  /** D-306 the assistant provider chosen by ADR-0012; unset until accepted. */
  'assistant.provider': string;
  /** D-306 the provider model id the assistant uses; unset until ADR-0012. */
  'assistant.model': string;
  /** D-305 assistant messages a customer may send per minute. */
  'assistant.messages_per_minute': number;
  /** D-305 assistant messages a customer may send per Bangkok day. */
  'assistant.messages_per_day': number;
  /** D-305 turns in one assistant session. */
  'assistant.turns_per_session': number;
  /** D-305 model cost ceiling of one assistant session (USD decimal string); unset = not configured. */
  'assistant.session_cost_ceiling_usd': string;
  /** D-305 vendor list prices per million tokens by model id (USD), for the cost ceiling. */
  'assistant.model_prices': Record<string, { inputPerMTokUsd: string; outputPerMTokUsd: string }>;
  /** D-305 days assistant sessions and turns are kept after their last turn. */
  'assistant.log_retention_days': number;
  /** D-306 evaluation pass rate (%) that clears the assistant outside local; unset = never cleared. */
  'assistant.eval_min_pass_rate_pct': number;
  /** D-303 relative week-over-week fall of a journey's conversion that alerts ops, %. */
  'analytics.journey_drop_alert_pct': number;
  /** D-303 sessions a journey needs in both weeks before its drop alerts. */
  'analytics.journey_alert_min_sessions': number;
  /** D-300 resolution target of a CS conversation in business days; unset = no target. */
  'conversations.resolution_business_days': number;
  /** D-299 hours a notification deep link stays valid. */
  'notifications.deep_link_ttl_hours': number;
  /** U-B0.1 items a customer confirms when approving a proof (approval evidence, B4.1); none until set. */
  'artwork.approval_checklist': { key: string; labelTh: string; labelEn: string }[];
  /** D-222 calendar days to answer a PDPA request. */
  'privacy.response_days': number;
  /** D-222 days a PDPA data export stays downloadable. */
  'privacy.export_link_days': number;
  /** D-185 / D-226 days a share link (design, later configuration) stays valid. */
  'configurations.share_link_days': number;
  /** D-185 days a draft configuration is kept after its last change. */
  'configurations.draft_retention_days': number;
  /** D-186 dimensional tolerance ± mm per calculator key (decimal strings); a key not listed publishes none. */
  'fulfilment.dimensional_tolerance_mm': Partial<Record<string, string>>;
  /** D-186 colour tolerance ΔE2000 for printed products (decimal strings). */
  'fulfilment.colour_tolerance_delta_e': { standard: string; flexo: string };
  /** Not seeded (D-237): the Structure Advisor rule set; `advisory.not_configured` until a Superadmin sets it. */
  'advisory.rule_set': AdvisoryRuleSet;
  /** D-212 / D-243 highest style-library wave that may be published. */
  'styles.published_wave': number;
  /** D-293 payout-run days of week (0 = Sunday); unset until Finance sets them. */
  'payouts.run_calendar': { weekdays: number[] };
  /** D-291 active API clients per company. */
  'api.max_keys_per_company': number;
  /** D-290 longest a call-off agreement holds a unit price (months). */
  'calloff.max_months': number;
  /** D-288 reorder suggestions: orders needed, intervals averaged, safety-stock days. */
  'reorder.min_orders': number;
  'reorder.average_orders': number;
  'reorder.safety_stock_days': number;
  /** D-289 months a registered tool stays reusable after its last use. */
  'tooling.reuse_months': number;
  'dielines.downloads_per_day': number;
  'dielines.downloads_per_minute': number;
  /** D-278 the studio print-check rule catalogue (Prepress). */
  'studio.print_rules': RuleCatalogue;
  /** D-286 studio launch targets (spec §1, Marketing). */
  'studio.funnel_targets': {
    medianMinutesToCart: number;
    artworkToCartPct: string;
    preflightPassPct: string;
    priceParityPct: string;
  };
  /** Not seeded (D-279): simplified soft-proof transforms per material class. */
  'studio.soft_proof_profiles': {
    profiles: { materialClass: string; label?: string; transform: Record<string, number | string> }[];
  };
  /** Not seeded (D-272): no partner dieline intake until set. */
  'styles.intake_terms': { textTh: string; textEn: string };
}

/** D-237 Structure Advisor rule set (decimal strings; factors 0 < f ≤ 1, applied as retained strength). */
export interface AdvisoryRuleSet {
  /** k in BCT [N] = k × ECT [kN/m] × √(caliper [mm] × perimeter [mm]) (simplified McKee). */
  mckeeConstant: string;
  /** ± % around the McKee estimate: the range shown, the low end decides. */
  uncertaintyPct: string;
  /** Corrugate formulas the relation is applied to (D-235). */
  formulas: string[];
  /** Below this margin % of the low end over the requirement, the option warns `thin_margin`. */
  thinMarginPct: string;
  factors: {
    humidity: Record<'dry' | 'normal' | 'humid' | 'very_humid', string>;
    storage: Record<'up_to_10_days' | 'up_to_30_days' | 'up_to_90_days' | 'over_90_days', string>;
    palletPattern: Record<'none' | 'column' | 'interlocked', string>;
    palletOverhang: Record<'none' | 'overhang', string>;
    transport: Record<'pickup' | 'parcel_domestic' | 'pallet_domestic' | 'sea_export', string>;
    fragility: Record<'low' | 'medium' | 'high', string>;
  };
}

export type SettingKey = keyof SettingValues;
