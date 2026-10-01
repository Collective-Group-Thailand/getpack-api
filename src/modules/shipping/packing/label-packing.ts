import { type Carton, cartonsByWeight, type CartonSpec } from './folding-packing';
import { type PackedPart } from './shipment';

/**
 * Packing helper for labels (U-B6 label, D-013): legacy `ShippingUtils::calCostLabel_WithShipping`
 * (`app/Libraries/Shipping/ShippingUtils.php:158-290`) up to the carton count, size and weight; the carrier rate
 * lookups after it are replaced by the B2.4 rate cards. The weight is the label face × the material gsm (legacy
 * counts no liner or core, quirk L22). Sheets of labels stack 0.5 mm each on the footprint grid; a roll (and a
 * roll cut to sheets) ships in legacy's fixed 56 × 13 × 11 cm carton. As the other packers: the grid, stack height
 * and weight limit are the setting `shipping.carton_spec`; without it only the weight is computed. Pure.
 */

export interface LabelPackInput {
  /** The label, mm. */
  w: number;
  l: number;
  gsm: number;
  /** A roll or roll-to-sheet job (legacy `label_type` "roll"). */
  roll: boolean;
  qty: number;
}

export interface LabelPack extends PackedPart {
  /** Legacy `weightPerBox`, kg (`:200`). */
  weightPerPieceKg: number;
  layW: number | null;
  layL: number | null;
}

/** Legacy stack thickness of one label, mm (`:174, :211`). */
const LABEL_THICKNESS_MM = 0.5;
/** Legacy roll carton, cm (`:172-174`). */
const ROLL_CARTON = { w: 56, l: 13, h: 11 } as const;

export function packLabel(input: LabelPackInput, spec: CartonSpec | null): LabelPack {
  const { w: pW, l: pL, qty, roll } = input;
  const weightPerPieceKg = (((pW * pL) / 1000000) * input.gsm) / 1000;
  const weightAllKg = Math.ceil(weightPerPieceKg * qty);
  if (!spec) return { weightAllKg, weightPerPieceKg, carton: null, layW: null, layL: null };

  const dW = Math.ceil(pW / 10);
  const dL = Math.ceil(pL / 10);
  // Lay-out on the footprint grid (`:179-188`); the negative-waste branch cannot happen.
  const layW = roll ? 1 : dW > spec.gridCm ? 1 : Math.floor(spec.gridCm / dW);
  const layL = roll ? 1 : dL > spec.gridCm ? 1 : Math.floor(spec.gridCm / dL);
  const layH = roll ? 1 : qty / (layW * layL);
  const bySize = Math.ceil((layH * LABEL_THICKNESS_MM) / 10 / spec.maxStackHeightCm);
  const byWeight = cartonsByWeight(weightAllKg, spec.maxWeightKg);
  const count = Math.max(bySize, byWeight);
  const carton: Carton = {
    count,
    wCm: (roll ? ROLL_CARTON.w : dW) * layW,
    lCm: (roll ? ROLL_CARTON.l : dL) * layL,
    hCm: roll ? ROLL_CARTON.h : Math.ceil((layH * LABEL_THICKNESS_MM) / 10 / count),
    weightKg: Math.ceil(weightAllKg / count),
  };
  return { weightAllKg, weightPerPieceKg, carton, layW, layL };
}
