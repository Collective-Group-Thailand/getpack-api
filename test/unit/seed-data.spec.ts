import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROLES } from '@modules/iam/roles.catalog';

import { APPROVAL_POLICIES } from '../../prisma/seed/data/approval-policies';
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
      expect(() => assertSettingValue(setting)).not.toThrow();
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
      // ADR-0004 values chosen on 2026-09-23, pending the security review (B1.3).
      'auth.access_token_ttl_seconds': 'proposed',
      'auth.refresh_token_lifetimes': 'proposed',
      'auth.otp_policy': 'proposed',
      'auth.password_lockout': 'proposed',
      'auth.device_pin_policy': 'proposed',
    });
  });

  it('does not seed values a decision leaves open', () => {
    const keys = SETTINGS.map((s) => s.key);
    expect(keys.filter((k) => /unpaid|expir(y|ed)_at|code_format/.test(k))).toEqual([]);
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
});
