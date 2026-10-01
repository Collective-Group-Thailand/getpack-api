import { ADMIN_MENU, menuFor } from './menu.catalog';
import { PERMISSIONS } from './permissions.catalog';

describe('admin menu (B1.3, U-B0.3)', () => {
  const keys = (permissions: string[]) => menuFor(new Set(permissions)).map((e) => e.key);

  it('shows an entry to holders of its permission only', () => {
    expect(keys([])).toEqual(['dashboard', 'reports']);
    expect(keys(['orders.read', 'claims.read'])).toEqual(['dashboard', 'orders', 'claims', 'reports']);
  });

  it('shows finance to holders of any one finance permission', () => {
    expect(keys(['banking.read'])).toContain('finance');
    expect(keys(['tax.read'])).toContain('finance');
    expect(keys(['orders.read'])).not.toContain('finance');
  });

  it('gates every entry on a permission of the catalogue, with unique keys and paths', () => {
    const known = new Set(PERMISSIONS.map((p) => p.key));
    for (const entry of ADMIN_MENU) {
      const gates = entry.permission === undefined ? [] : [entry.permission].flat();
      for (const gate of gates) expect(known.has(gate)).toBe(true);
    }
    expect(new Set(ADMIN_MENU.map((e) => e.key)).size).toBe(ADMIN_MENU.length);
    expect(new Set(ADMIN_MENU.map((e) => e.path)).size).toBe(ADMIN_MENU.length);
  });
});
