import { packPouch } from './pouch-packing';
import { cartonsOf, shipment } from './shipment';

const LIGHT = { gridCm: 60, maxStackHeightCm: 60, maxWeightKg: 20 };
const HEAVY = { gridCm: 60, maxStackHeightCm: 60, maxWeightKg: 31 };
const MEDIUM = { wCm: 26.7, lCm: 44.5, hCm: 16.5 };

describe('packPouch (legacy calShippingCostPouch:710-788)', () => {
  it('weighs 10 g per pouch and fills the 2 000-pouch carton from 500', () => {
    const pack = packPouch({ qty: 1000 }, LIGHT);
    expect(pack.weightAllKg).toBe(10);
    // ⌈0.01 × 1 000 + 0.5⌉ = 11 kg.
    expect(pack.cartons).toEqual([{ count: 1, ...MEDIUM, weightKg: 11 }]);
  });

  it('uses the 3 000-pouch carton only when the carrier takes more than 30 kg', () => {
    expect(packPouch({ qty: 2450 }, HEAVY).cartons).toEqual([
      { count: 1, wCm: 33, lCm: 52, hCm: 23, weightKg: 31 },
    ]);
    // On a light carrier legacy left 2 001+ uncharged; Packio packs 2 000 + 450 (quirk P32).
    expect(packPouch({ qty: 2450 }, LIGHT).cartons).toEqual([{ count: 2, ...MEDIUM, weightKg: 21 }]);
  });

  it('packs 100 a carton up to 400, and the remainders legacy left uncharged', () => {
    expect(packPouch({ qty: 300 }, LIGHT).cartons).toEqual([
      { count: 3, wCm: 16, lCm: 29, hCm: 5, weightKg: 2 },
    ]);
    expect(packPouch({ qty: 50 }, LIGHT).cartons).toEqual([
      { count: 1, wCm: 16, lCm: 29, hCm: 5, weightKg: 1 },
    ]);
    // 2 050 = 2 000 + 50: two carton sizes for one part.
    const mixed = packPouch({ qty: 2050 }, LIGHT);
    expect(mixed.cartons).toEqual([
      { count: 1, ...MEDIUM, weightKg: 21 },
      { count: 1, wCm: 16, lCm: 29, hCm: 5, weightKg: 1 },
    ]);
    expect(cartonsOf(mixed)).toHaveLength(2);
    expect(shipment([mixed], null).cartons).toBe(2);
  });

  it('computes only the weight without a carton spec', () => {
    expect(packPouch({ qty: 1234 }, null)).toEqual({ weightAllKg: 13, weightPerPieceKg: 0.01, carton: null });
  });
});
