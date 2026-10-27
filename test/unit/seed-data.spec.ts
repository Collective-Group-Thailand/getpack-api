import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROLES } from '@modules/iam/roles.catalog';

import { APPROVAL_POLICIES } from '../../prisma/seed/data/approval-policies';
import { PRODUCT_TYPES } from '../../prisma/seed/data/catalog';
import { SOD_RULES } from '../../prisma/seed/data/reference';
import { SETTINGS } from '../../prisma/seed/data/settings';
import { assertSettingValue } from '../../prisma/seed/reference-seed';

/** Decision ids that exist in docs/decisions.md. */
const DECISIONS = new Set(
  [
    ...readFileSync(join(__dirname, '..', '..', 'docs', 'decisions.md'), 'utf8').matchAll(/\| (D-\d{3}) \|/g),
  ].map((m) => m[1]),
);
const ROLE_KEYS = new Set(ROLES.map((r) => r.key));

describe('seed data (B1.2 step 3)', () => {
  it('gives every setting a valid value, a unique key and existing decision ids cited in its description', () => {
    const keys = SETTINGS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const setting of SETTINGS) {
      if (!setting.unset) expect(() => assertSettingValue(setting)).not.toThrow();
      expect(setting.decisions.length).toBeGreaterThan(0);
      for (const id of setting.decisions)
        expect([setting.key, id, DECISIONS.has(id)]).toEqual([setting.key, id, true]);
      expect(setting.decisions.some((id) => setting.description.includes(id))).toBe(true);
    }
  });

  it('flags the ⚖ values still pending the CPA and the proposed auth limits instead of seeding them as confirmed', () => {
    const flagged = Object.fromEntries(
      SETTINGS.filter((s) => s.confirmation).map((s) => [s.key, s.confirmation]),
    );
    expect(flagged).toEqual({
      'loyalty.expected_redemption_rate_pct': 'pending_cpa',
      // D-430: the registered e-Tax sender is the business's; the subject date and retries are proposed.
      'e_tax.email_from': 'pending_business',
      // B-API-6: what the engine can price per print side, until the business answers.
      'catalog.print_limits': 'pending_business',
      'e_tax.subject_date_format': 'proposed',
      'e_tax.email_retry': 'proposed',
      // ADR-0004 values chosen on 2026-09-23, pending the security review (B1.3).
      'auth.access_token_ttl_seconds': 'proposed',
      'auth.refresh_token_lifetimes': 'proposed',
      'auth.otp_policy': 'proposed',
      'auth.password_lockout': 'proposed',
      'auth.device_pin_policy': 'proposed',
      // D-172: defined without a value until the business sets it.
      'partners.suggestion_deviation_band_pct': 'pending_business',
      // B2.4: no decision gives the carton, the pallet or the target shipping margin.
      'shipping.carton_spec': 'pending_business',
      'shipping.pallet_spec': 'pending_business',
      'shipping.target_margin_pct': 'pending_business',
      'shipping.transit_days': 'pending_business',
      // B2.5: no decision gives the RFQ SLA.
      'rfq.sla_business_hours': 'pending_business',
      // B3.1: D-060's legacy value is a secret not in the repository — its 7-day fallback, proposed.
      'orders.unpaid_expiry_days': 'proposed',
      // B3.1: nature of the sale per product type (accounting-design §2 ⚖).
      'tax.nature_by_product_type': 'pending_cpa',
      // B3.2: D-175 business hours are proposed; fees and receiver accounts open (the QR lifetime: D-312, accepted).
      'calendar.business_hours': 'proposed',
      'payments.method_fees': 'pending_business',
      'payments.slip_receiver_accounts': 'pending_business',
      'promotions.code_attempt_limits': 'proposed',
      // U2.3: the price-gap bands and the quantity-lever multipliers are proposed (D-248, D-252).
      'analytics.price_gap_bands_pct': 'proposed',
      // D-417 / D-420 sales agent programme figures for the business to confirm.
      'agents.rules': 'proposed',
      'quotes.lever_quantity_multipliers': 'proposed',
      // B4.1: D-070 fixes four severities only; the rest and every threshold are proposed (ADR-0009).
      'artwork.approval_checklist': 'pending_business',
      'artwork.preflight_rules': 'proposed',
      // U4.B3: the studio rule catalogue reuses the spec and ADR-0009 values; severities not stated are proposed (D-278).
      'studio.print_rules': 'proposed',
      // D-404 standard intake terms v1, Legal may publish a revision.
      'styles.intake_terms': 'pending_business',
      'artwork.prepress_sla_business_hours': 'pending_business',
      // D-305 vendor list prices of the ADR-0012 options (proposed until the ADR is accepted).
      'assistant.model_prices': 'proposed',
      // B5: accounting-design ⚖ positions and proposed operating values of Finance.
      'tax.rounding_mode': 'pending_cpa',
      'receivables.forfeited_deposit_policy': 'pending_business',
      'receivables.allowance_rates': 'pending_cpa',
      'banking.auto_match': 'proposed',
      'tax.calendar': 'proposed',
      'close.unmatched_items_threshold': 'proposed',
      'tax.gl_accounts': 'proposed',
      'fixed_assets.depreciation_start': 'pending_cpa',
      'audit.business_hours': 'proposed',
      // B6.3: operational alert thresholds (launch monitoring), no decision gives them.
      'ops.alert_thresholds': 'proposed',
      // UX r2 Phase 4 (D-309): storefront figures CS / Prepress have not given yet.
      'artwork.first_proof_business_days': 'pending_business',
      'storefront.support_hours': 'pending_business',
      'support.reply_minutes': 'pending_business',
    });
  });

  it('does not seed values a decision leaves open', () => {
    const keys = SETTINGS.map((s) => s.key);
    expect(keys.filter((k) => /expir(y|ed)_at|code_format/.test(k))).toEqual([]);
  });

  it('seeds the D-060 unpaid expiry as the legacy 7-day fallback, flagged proposed (B3.1)', () => {
    const expiry = SETTINGS.find((s) => s.key === 'orders.unpaid_expiry_days');
    expect(expiry).toMatchObject({ value: 7, decisions: ['D-060'], confirmation: 'proposed' });
  });

  it('rejects values that do not match their type', () => {
    expect(() => assertSettingValue({ key: 'x.y', valueType: 'money', value: 20000 })).toThrow();
    expect(() => assertSettingValue({ key: 'x.y', valueType: 'integer', value: '15' })).toThrow();
    expect(() =>
      assertSettingValue({ key: 'x.y', valueType: 'enum', value: 'later', valueSchema: { enum: ['now'] } }),
    ).toThrow();
  });

  it('routes approval steps to seeded roles and cites existing decisions', () => {
    for (const policy of APPROVAL_POLICIES) {
      expect(policy.steps.length).toBeGreaterThan(0);
      for (const step of policy.steps)
        expect([policy.key, step.role, ROLE_KEYS.has(step.role)]).toEqual([policy.key, step.role, true]);
      for (const id of policy.decisions)
        expect([policy.key, id, DECISIONS.has(id)]).toEqual([policy.key, id, true]);
    }
  });

  it('routes discount memos to the matching tier only (D-162)', () => {
    const memo = APPROVAL_POLICIES.find((p) => p.key === 'discount_memo')!;
    expect(memo.steps.map((s) => s.role)).toEqual(['director', 'vp', 'c_level']);
    expect(memo.steps.every((s) => s.condition !== undefined)).toBe(true);
    expect(memo.expiryRule).toEqual({ withSubject: 'quote.valid_until' });
  });

  it('references seeded roles in SoD role pairs', () => {
    for (const rule of SOD_RULES.filter((r) => r.kind === 'role_pair')) {
      for (const role of rule.roles!) expect(ROLE_KEYS.has(role)).toBe(true);
    }
  });

  it('seeds the D-100 product types: 7 calculators once each, the rest RFQ-only (B2.1)', () => {
    const codes = PRODUCT_TYPES.map((t) => t.code);
    expect(new Set(codes).size).toBe(14);
    for (const code of codes) expect(code).toMatch(/^[a-z][a-z0-9_]*$/);
    const calculators = PRODUCT_TYPES.flatMap((t) => (t.calculatorKey ? [t.calculatorKey] : []));
    expect(calculators.sort()).toEqual(
      ['corrugate', 'folding', 'label', 'pouch', 'service', 'standard_product', 'tag_sleeve'].sort(),
    );
    expect(codes).toEqual(
      expect.arrayContaining([
        'rigid_box',
        'paper_bag',
        'food_packaging',
        'tube',
        'custom_tape',
        'pop_display',
        'other',
      ]),
    );
  });
});
