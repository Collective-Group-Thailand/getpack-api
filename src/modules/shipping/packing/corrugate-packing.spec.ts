import vectors from '../../../../test/golden/corrugate/reference/packing.vectors.json';
import { type CorrugatePackInput, packCorrugate } from './corrugate-packing';

/**
 * Corrugate packing (U-B6 slice 6) against an independent transcription of
 * `ShippingUtils::calCostCorrugate_WithShipping:305-403` (`test/golden/corrugate/reference/packing_reference.py`).
 */
describe('corrugate packing (ShippingUtils.php:305-403)', () => {
  it.each(vectors.map((v) => [v.name, v]))('%s', (_name, v) => {
    const pack = packCorrugate(v.input as CorrugatePackInput, v.spec);
    const e = v.expect;
    expect(pack.weightAllKg).toBe(e.weightAllKg);
    expect(pack.weightPerBoxKg).toBeCloseTo(e.weightPerBoxKg, 12);
    expect([pack.flatWCm, pack.flatLCm, pack.thicknessMm]).toEqual([e.flatWCm, e.flatLCm, e.thicknessMm]);
    expect(pack.carton).toEqual(e.carton);
    if (e.carton)
      expect([pack.layW, pack.layL]).toEqual([(e as { layW: number }).layW, (e as { layL: number }).layL]);
  });
});
