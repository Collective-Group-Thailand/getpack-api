import { FACTORY_ROLES } from '@modules/auth/me.dto';

import { PERMISSIONS } from './permissions.catalog';
import { ROLES } from './roles.catalog';

describe('IAM catalogues (D-140, D-141)', () => {
  const byKey = new Map(ROLES.map((role) => [role.key, role]));
  const permission = new Map<string, (typeof PERMISSIONS)[number]>(PERMISSIONS.map((p) => [p.key, p]));

  it('has exactly the roles of D-140 (+ the Data Protection Officer of D-222, the ERP roles of D-319, the auditor of D-396)', () => {
    expect(ROLES.map((r) => r.key).sort()).toEqual(
      [
        'superadmin',
        'c_level',
        'vp',
        'director',
        'admin',
        'cs',
        'cs_lead',
        'prepress',
        'finance',
        'finance_manager',
        'logistics',
        'marketing',
        'partner_manager',
        'auditor',
        'dpo',
        'factory_owner',
        'factory_planner',
        'factory_operator',
        'factory_qc',
        'factory_shipping',
        'factory_accountant',
        'factory_storekeeper',
        'factory_purchaser',
        'factory_maintenance',
        'factory_sales',
        'factory_auditor',
        'company_admin',
        'company_buyer',
        'company_approver',
        'company_accountant',
        // D-423 / D-416: the sales agent programme.
        'sales_manager',
        'sales_agent',
      ].sort(),
    );
  });

  it('scopes staff to the platform, factory roles to a factory and company roles to a company', () => {
    for (const role of ROLES) {
      // D-416: an agent is a customer account working on its own rows, not a company's.
      const expected =
        role.key === 'sales_agent'
          ? 'platform'
          : { staff: 'platform', partner: 'factory', customer: 'company' }[role.audience];
      expect([role.key, role.scopeType]).toEqual([role.key, expected]);
    }
  });

  it('only grants permissions of the role audience, without duplicates', () => {
    for (const role of ROLES) {
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
      for (const key of role.permissions)
        expect([role.key, key, permission.get(key)?.audience]).toEqual([role.key, key, role.audience]);
    }
  });

  it('shows full factory cost only to the roles D-141 names', () => {
    const withCost = ROLES.filter((r) => r.permissions.includes('factory_buy_prices.read')).map((r) => r.key);
    expect(withCost.sort()).toEqual([
      'c_level',
      'finance',
      'finance_manager',
      'partner_manager',
      'superadmin',
      'vp',
    ]);
  });

  it('shows CS the margin % only when discounting, and Prepress and Logistics neither cost nor margin', () => {
    for (const key of ['cs', 'cs_lead']) {
      expect(byKey.get(key)!.permissions).toContain('margin.read_pct_when_discounting');
      expect(byKey.get(key)!.permissions).not.toContain('margin.read');
    }
    for (const key of ['prepress', 'logistics']) {
      const sensitive = byKey
        .get(key)!
        .permissions.filter(
          (p) => permission.get(p)?.key.startsWith('margin') || p === 'factory_buy_prices.read',
        );
      expect(sensitive).toEqual([]);
    }
  });

  it('keeps the Auditor read-only', () => {
    // The only writes are the auditor's own working records (B5.6, §8): the close sign-off and samples.
    const writes = byKey.get('auditor')!.permissions.filter((p) => !/\.(read|export)$/.test(p));
    expect(writes.sort()).toEqual(['audit_support.sample', 'close.audit_sign_off']);
  });

  it('uses unique resource.action keys', () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
  });

  it('publishes the factory-scoped roles as the FactoryRole enum (U-B0.3)', () => {
    expect([...FACTORY_ROLES].sort()).toEqual(
      ROLES.filter((r) => r.scopeType === 'factory')
        .map((r) => r.key)
        .sort(),
    );
  });
});

describe('setting owners (D-063, ADR-0005)', () => {
  const permission = new Map<string, (typeof PERMISSIONS)[number]>(PERMISSIONS.map((p) => [p.key, p]));
  it('every role that owns a setting may read and change it — the owner check alone decides which ones', async () => {
    const { SETTINGS } = (await import('../../../prisma/seed/data/settings')) as {
      SETTINGS: readonly { ownerRole?: string }[];
    };
    const byKey = new Map(ROLES.map((role) => [role.key, role]));
    const owners = [...new Set(SETTINGS.map((setting) => setting.ownerRole ?? 'superadmin'))];
    for (const owner of owners) {
      const role = byKey.get(owner);
      expect(role).toBeDefined();
      expect([owner, role!.permissions.includes('settings.change')]).toEqual([owner, true]);
      expect([owner, role!.permissions.includes('settings.read')]).toEqual([owner, true]);
      expect([owner, permission.get('settings.change')?.audience]).toEqual([owner, role!.audience]);
    }
  });
});
