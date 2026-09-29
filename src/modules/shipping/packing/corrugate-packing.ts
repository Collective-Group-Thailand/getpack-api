import { type CorrugateFormula } from '@modules/pricing/calculators/corrugate/geometry';

import { type Carton, cartonsByWeight, type CartonSpec } from './folding-packing';
import { type PackedPart } from './shipment';

/**
 * Packing helper for corrugated boxes (U-B6, D-013): legacy `ShippingUtils::calCostCorrugate_WithShipping`
 * (`app/Libraries/Shipping/ShippingUtils.php:305-403`) up to the carton count, size and weight; the carrier
 * rate lookups after it are replaced by the B2.4 rate cards. Boxes ship flat: the RSC family folds in half
 * along its length and stacks at 2.5 × the flute height (`:333-339, :363`), the slide sleeve folds along its
 * width (`:340-344`). As folding's packer: the 60 cm footprint grid and 60 cm stack height are the setting
 * `shipping.carton_spec` (legacy 120 cm = two grid cells, `:351`), the carrier weight limit its `maxWeightKg`,
 * and without the setting only the weight is computed. The part's own flute is used (legacy mapped flute ids
 * 1–3 to text and read any other as B, quirk C16). Pure.
 */

export interface CorrugatePackInput {
  formula: CorrugateFormula;
  /** The blank without the factory's adjustment, rounded to 2 places (legacy formatted `dW`, `dL`), mm. */
  dw: number;
  dl: number;
  gsm: number;
  /** Flute take-ups `g`, `c`, `fh` (legacy `getFluteType:142`). */
  flute: { g: number; c: number; fh: number };
  qty: number;
}

export interface CorrugatePack extends PackedPart {
  /** Legacy `weightPerBox`, kg (`:321`). */
  weightPerBoxKg: number;
  /** Flat stack footprint of one box, cm (`:329-344`). */
  flatWCm: number;
  flatLCm: number;
  thicknessMm: number;
  layW: number | null;
  layL: number | null;
}

/** Legacy `isRSCPattern:292` (patterns 19, 26–29). */
const RSC_FAMILY: readonly CorrugateFormula[] = [
  'rsc',
  'open_top',
  'handle',
  'handle_rim',
  'tele_body',
  'tele_lid',
];

export function packCorrugate(input: CorrugatePackInput, spec: CartonSpec | null): CorrugatePack {
  const { dw, dl, qty, flute } = input;
  const weightPerBoxKg = (((dw * dl) / 1000000) * input.gsm) / 1000;
  const weightAllKg = Math.ceil(weightPerBoxKg * qty);
  let flatWCm = Math.ceil(dw / 10);
  let flatLCm = Math.ceil(dl / 10);
  const rscFamily = RSC_FAMILY.includes(input.formula);
  if (rscFamily) flatLCm = Math.ceil(((dl - flute.g + 3) / 2 + flute.c) / 10);
  else if (input.formula === 'slide_sleeve') flatWCm = Math.ceil(((dw - flute.g + 3) / 2 + flute.c) / 10);
  const thicknessMm = rscFamily ? flute.fh * 2.5 : flute.fh;
  const base = { weightAllKg, weightPerBoxKg, flatWCm, flatLCm, thicknessMm };
  if (!spec) return { ...base, carton: null, layW: null, layL: null };

  // Lay-out on the footprint grid when both sides together are under two cells (`:348-358`).
  let layW = 1;
  let layL = 1;
  if (flatWCm + flatLCm < 2 * spec.gridCm) {
    if (flatWCm < spec.gridCm) layW = Math.floor(spec.gridCm / flatWCm);
    if (flatLCm < spec.gridCm) layL = Math.floor(spec.gridCm / flatLCm);
  }
  const layH = qty / (layW * layL);
  const bySize = Math.ceil((layH * thicknessMm) / 10 / spec.maxStackHeightCm);
  const byWeight = cartonsByWeight(weightAllKg, spec.maxWeightKg);
  const count = Math.max(bySize, byWeight);
  const carton: Carton = {
    count,
    wCm: flatWCm * layW,
    lCm: flatLCm * layL,
    hCm: Math.ceil((layH * thicknessMm) / 10 / count),
    weightKg: Math.ceil(weightAllKg / count + 0.5),
  };
  return { ...base, carton, layW, layL };
}
