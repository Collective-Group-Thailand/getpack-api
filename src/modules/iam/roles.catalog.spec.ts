import { PERMISSIONS } from './permissions.catalog';
import { ROLES } from './roles.catalog';

describe('IAM catalogues (D-140, D-141)', () => {
  const byKey = new Map(ROLES.map((role) => [role.key, role]));
  const permission = new Map<string, (typeof PERMISSIONS)[number]>(PERMISSIONS.map((p) => [p.key, p]));

  it('has exactly the roles of D-140', () => {
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
        'factory_owner',
        'factory_planner',
        'factory_operator',
        'factory_qc',
        'factory_shipping',
        'factory_accountant',
        'company_admin',
        'company_buyer',
        'company_approver',
        'company_accountant',
      ].sort(),
    );
  });

  it('scopes staff to the platform, factory roles to a factory and company roles to a company', () => {
    for (const role of ROLES) {
      const expected = { staff: 'platform', partner: 'factory', customer: 'company' }[role.audience];
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
    const withCost = ROLES.filter((r) => r.permissions.includes('factory_cost.read')).map((r) => r.key);
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
        .permissions.filter((p) => permission.get(p)?.key.startsWith('margin') || p === 'factory_cost.read');
      expect(sensitive).toEqual([]);
    }
  });

  it('keeps the Auditor read-only', () => {
    const writes = byKey.get('auditor')!.permissions.filter((p) => !/\.(read|export)$/.test(p));
    expect(writes).toEqual([]);
  });

  it('uses unique resource.action keys', () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
  });
});
