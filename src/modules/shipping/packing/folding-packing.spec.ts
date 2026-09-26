import { cartonsByWeight, flatSize, layout, packFolding } from './folding-packing';
import { cartonsPerPallet, shipment } from './shipment';

/**
 * Vectors derived by hand from legacy `app/Libraries/Shipping/FoldingUtil.php` and
 * `ShippingUtils::calShippingCostFolding` (`ShippingUtils.php:463-600`). The carton spec uses legacy's
 * 60 cm grid and stack height and Ninjavan's 20 kg limit (`Ninjavan.php:41-49`) as a test fixture
 * only — Packio's values are the unset setting `shipping.carton_spec`.
 */
const LEGACY_LIKE = { gridCm: 60, maxStackHeightCm: 60, maxWeightKg: 20 };

describe('folding packing (legacy FoldingUtil)', () => {
  it('tuck top 50 × 100 × 150, 350 gsm, 1,000 pcs (pattern 1)', () => {
    const input = { formula: 'tuck_top' as const, w: 50, l: 100, d: 150, gsm: 350, qty: 1000 };
    // f1 = 15 (L ≤ 150, :97-109), g2 = 15 (W > 20, :135-143).
    // dW = f1+W+D+(W−0.5)+f1 = 279.5 (:249); dL = g2+2L+2W−0.5 = 314.5 (:321).
    // Flat: thickness 1.5, flatL = (dL−g2+0.5)/2+1 = 151 (:392-396); overlap W+f1 = 65 mm (:170-174).
    expect(flatSize(input)).toEqual({
      dw: 279.5,
      dl: 314.5,
      flatW: 279.5,
      flatL: 151,
      thickness: 1.5,
      overlapCm: 6.5,
    });
    // dWcm 28, dLcm 16; ansW ⌊60/28⌋ = 2, waste 60−(56−6.5) = 10.5 ≤ 28−6.5 → layW 2 (:447-463); layL ⌊60/16⌋ = 3.
    expect(layout('tuck_top', flatSize(input), 60)).toEqual({ layW: 2, layL: 3 });
    const pack = packFolding(input, LEGACY_LIKE);
    // weight = (dW·dL/10⁶)·gsm/1000 = 0.0307659625 kg (:440-444); ⌈× 1000⌉ = 31 kg (ShippingUtils :486).
    expect(pack.weightPerBoxKg).toBeCloseTo(0.0307659625, 12);
    expect(pack.weightAllKg).toBe(31);
    // By weight ⌈31/19.5⌉ = 2; by size ⌈(166.67·1.5/10)/60⌉ = 1 (:506); W = 28·2 − 1·6.5 (:516);
    // H = ⌈25/2⌉ (:538); carton weight ⌈31/2 + 0.5⌉ (:542).
    expect(pack.carton).toEqual({ count: 2, wCm: 49.5, lCm: 48, hCm: 13, weightKg: 16 });
  });

  it('flat 100 × 150, 300 gsm, 5,000 pcs (pattern 15)', () => {
    const pack = packFolding({ formula: 'flat', w: 100, l: 150, d: 0, gsm: 300, qty: 5000 }, LEGACY_LIKE);
    // dW = W, dL = L (:291-294, :363-366); thickness 0.5 (:397-401); no overlap.
    expect(pack.flat).toMatchObject({ dw: 100, dl: 150, thickness: 0.5, overlapCm: 0 });
    expect([pack.layW, pack.layL]).toEqual([6, 4]);
    // 0.0045 kg × 5,000 = 22.5 → 23 kg; 2 cartons by weight; H = ⌈(208.33·0.5/10)/2⌉ = 6.
    expect(pack.weightAllKg).toBe(23);
    expect(pack.carton).toEqual({ count: 2, wCm: 60, lCm: 60, hCm: 6, weightKg: 12 });
  });

  it('lock bottom 80 × 200 × 60, 300 gsm, 500 pcs (pattern 16)', () => {
    const input = { formula: 'lock_bottom_top' as const, w: 80, l: 200, d: 60, gsm: 300, qty: 500 };
    // f1 = 20 (150 < L < 301), b11 = 10.25 (31 ≤ W ≤ 81, :227-242); dW = f1+W+D+W/2−0.25+b11 = 210 (:297);
    // dL = 574.5 (:369); overlap = dW − (D+W/2−0.25+b11+L/4) = 50 mm (:175-181).
    expect(flatSize(input)).toMatchObject({ dw: 210, dl: 574.5, flatL: 281, thickness: 1.5, overlapCm: 5 });
    const pack = packFolding(input, LEGACY_LIKE);
    // ansW = ⌊60/(21·2−5)⌋ = 1 (:186-189), waste 23 > 21 → layW = 2·1+1 = 3 (:464-478); layL 2.
    expect([pack.layW, pack.layL]).toEqual([3, 2]);
    // Odd layW: 3·21 − ((3−1)/2)·5 = 58 (ShippingUtils :518-523).
    expect(pack.carton).toEqual({ count: 1, wCm: 58, lCm: 58, hCm: 13, weightKg: 20 });
  });

  it('popup hanger widens a narrow flat and uses thickness 2 (pattern 8)', () => {
    // f6 = 25 (W ≤ 35, :125-133); dW = 2·f6+2W+D+60 = 210 (:269); W+f6 = 55 < 60 → flatW = 210 + 5
    // (:418-425); flatL = W+L+|L−W|+1 = 201 (:426).
    const flat = flatSize({ formula: 'popup_hanger', w: 30, l: 100, d: 40, gsm: 300, qty: 1 });
    expect(flat).toMatchObject({ dw: 210, flatW: 215, flatL: 201, thickness: 2 });
  });

  it('uses the pattern standard blank for food boxes and refuses without it (patterns 45–48)', () => {
    expect(
      flatSize({
        formula: 'standard_blank',
        w: 100,
        l: 100,
        d: 50,
        gsm: 300,
        qty: 1,
        standardBlank: { dw: 250, dl: 300 },
      }),
    ).toMatchObject({ dw: 250, dl: 300, thickness: 0.5 });
    expect(() => flatSize({ formula: 'standard_blank', w: 1, l: 1, d: 1, gsm: 1, qty: 1 })).toThrow(
      RangeError,
    );
  });

  it('counts cartons by weight like the carrier helpers, 0 kg giving none', () => {
    expect(cartonsByWeight(0, 20)).toBe(0);
    expect(cartonsByWeight(19, 20)).toBe(1);
    expect(cartonsByWeight(39, 20)).toBe(2);
    expect(cartonsByWeight(40, 20)).toBe(3);
  });

  it('computes only the weight without a carton spec', () => {
    const pack = packFolding({ formula: 'flat', w: 100, l: 150, d: 0, gsm: 300, qty: 5000 }, null);
    expect(pack).toMatchObject({ weightAllKg: 23, layW: null, layL: null, carton: null });
  });
});

describe('shipment and pallets', () => {
  const carton = { count: 2, wCm: 49.5, lCm: 48, hCm: 13, weightKg: 16 };

  it('sums parts and counts pallets per part', () => {
    const pallet = { lengthCm: 120, widthCm: 100, maxHeightCm: 150, maxWeightKg: 1000 };
    // 2 × 2 per layer × ⌊150/13⌋ = 11 layers = 44; weight allows ⌊1000/16⌋ = 62.
    expect(cartonsPerPallet(carton, pallet)).toBe(44);
    expect(cartonsPerPallet(carton, { ...pallet, maxWeightKg: 100 })).toBe(6);
    expect(
      shipment(
        [
          { weightAllKg: 31, carton },
          { weightAllKg: 23, carton: { ...carton, count: 3 } },
        ],
        pallet,
      ),
    ).toEqual({
      weightG: 54_000,
      cartons: 5,
      volumeCm3: 5 * 49.5 * 48 * 13,
      pallets: 2,
    });
  });

  it('keeps the weight when a part has no cartons and refuses pallets that cannot hold a carton', () => {
    expect(shipment([{ weightAllKg: 31, carton: null }], null)).toEqual({
      weightG: 31_000,
      cartons: null,
      volumeCm3: null,
      pallets: null,
    });
    const tiny = { lengthCm: 40, widthCm: 40, maxHeightCm: 100, maxWeightKg: 500 };
    expect(shipment([{ weightAllKg: 31, carton }], tiny).pallets).toBeNull();
  });
});
