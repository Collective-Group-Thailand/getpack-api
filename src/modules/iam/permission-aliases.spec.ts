import { withAliases } from './permission-resolver.service';
import { PERMISSION_ALIASES, PERMISSIONS } from './permissions.catalog';

describe('deprecated permission keys (U-B3, D-042)', () => {
  it('grants the replacement to holders of the old key and the old key to holders of the replacement', () => {
    expect([...withAliases(['factory_cost.read'])].sort()).toEqual([
      'factory_buy_prices.read',
      'factory_cost.read',
    ]);
    expect([...withAliases(['factory_buy_prices.read', 'margin.read'])].sort()).toEqual([
      'factory_buy_prices.read',
      'factory_cost.read',
      'margin.read',
    ]);
    expect([...withAliases(['margin.read'])]).toEqual(['margin.read']);
  });

  it('aliases only keys of the catalogue', () => {
    const keys = new Set<string>(PERMISSIONS.map((p) => p.key));
    for (const [old, current] of Object.entries(PERMISSION_ALIASES)) {
      expect(keys.has(old)).toBe(true);
      expect(keys.has(current)).toBe(true);
    }
  });
});
