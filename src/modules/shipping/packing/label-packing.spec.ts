import { packLabel } from './label-packing';

const SPEC = { gridCm: 60, maxStackHeightCm: 60, maxWeightKg: 20 };

describe('packLabel (legacy calCostLabel_WithShipping:158-290)', () => {
  it('weighs the label face × gsm and stacks sheets of labels on the grid', () => {
    // 50 × 70 mm, 80 gsm, 10 000 labels: 0.00028 kg each → ⌈2.8⌉ = 3 kg; 5 cm × 7 cm on a 60 cm grid → 12 × 8.
    const pack = packLabel({ w: 50, l: 70, gsm: 80, roll: false, qty: 10000 }, SPEC);
    expect(pack.weightAllKg).toBe(3);
    expect([pack.layW, pack.layL]).toEqual([12, 8]);
    // 10 000 / 96 = 104.17 labels high × 0.5 mm = 5.2 cm → one carton, ⌈5.208⌉ = 6 cm high.
    expect(pack.carton).toEqual({ count: 1, wCm: 60, lCm: 56, hCm: 6, weightKg: 3 });
  });

  it('ships a roll in the fixed 56 × 13 × 11 cm carton, more cartons only by weight', () => {
    const pack = packLabel({ w: 100, l: 100, gsm: 150, roll: true, qty: 30000 }, SPEC);
    // 0.0015 kg × 30 000 = 45 kg → 3 cartons of ≤ 20 kg.
    expect(pack.weightAllKg).toBe(45);
    expect(pack.carton).toEqual({ count: 3, wCm: 56, lCm: 13, hCm: 11, weightKg: 15 });
  });

  it('computes only the weight without a carton spec', () => {
    expect(packLabel({ w: 50, l: 50, gsm: 100, roll: false, qty: 1000 }, null)).toEqual({
      weightAllKg: 1,
      weightPerPieceKg: 0.00025,
      carton: null,
      layW: null,
      layL: null,
    });
  });
});
