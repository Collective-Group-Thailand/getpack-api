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
}

export type SettingKey = keyof SettingValues;
