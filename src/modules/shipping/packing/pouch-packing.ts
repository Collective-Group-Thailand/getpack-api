import { type Carton, type CartonSpec } from './folding-packing';
import { type PackedPart } from './shipment';

/**
 * Packing helper for pouches (U-B6 pouch, D-013): legacy `ShippingUtils::calShippingCostPouch`
 * (`app/Libraries/Shipping/ShippingUtils.php:710-788`) up to the cartons; the carrier rate lookups after it are
 * replaced by the B2.4 rate cards. Legacy weighs every pouch 10 g whatever its size or film, and fills three carton
 * sizes by count: 3 000 pouches (33 × 52 × 23 cm) when the carrier takes more than 30 kg, up to 2 000 (26.7 × 44.5 ×
 * 16.5 cm), or 100 (16 × 29 × 5 cm). Port map §9.9: the carrier's weight limit is the setting `shipping.carton_spec`
 * (`maxWeightKg`); the counts legacy left uncharged (fewer than 100, 401–499, or more than 2 000 on a light carrier)
 * go into the smallest carton that takes them, and the box count is not over-counted. Without the carton spec only
 * the weight is computed. Pure.
 */

export interface PouchPackInput {
  qty: number;
}

/** Legacy `$weightPerPcs = 0.01000` kg (`:713`). */
const WEIGHT_PER_POUCH_KG = 0.01;
/** Legacy carton sizes, cm (`:731-746`). */
const LARGE = { w: 33, l: 52, h: 23, pieces: 3000 } as const;
const MEDIUM = { w: 26.7, l: 44.5, h: 16.5, pieces: 2000 } as const;
const SMALL = { w: 16, l: 29, h: 5, pieces: 100 } as const;

type Size = typeof LARGE | typeof MEDIUM | typeof SMALL;

export interface PouchPack extends PackedPart {
  weightPerPieceKg: number;
}

export function packPouch(input: PouchPackInput, spec: CartonSpec | null): PouchPack {
  const { qty } = input;
  const weightAllKg = Math.ceil(WEIGHT_PER_POUCH_KG * qty);
  if (!spec) return { weightAllKg, weightPerPieceKg: WEIGHT_PER_POUCH_KG, carton: null };

  const boxes: { size: Size; pieces: number }[] = [];
  let remain = qty;
  while (remain > 0) {
    let size: Size;
    let pieces: number;
    if (remain >= 2100 && spec.maxWeightKg > LARGE.pieces * WEIGHT_PER_POUCH_KG) {
      // Legacy weighs this carton at 3 000 even when fewer remain (`:735`).
      size = LARGE;
      pieces = LARGE.pieces;
    } else if (
      (remain >= 500 && remain <= MEDIUM.pieces) ||
      (remain >= MEDIUM.pieces && spec.maxWeightKg > MEDIUM.pieces * WEIGHT_PER_POUCH_KG)
    ) {
      size = MEDIUM;
      pieces = Math.min(remain, MEDIUM.pieces);
    } else if (remain >= 100 && remain <= 400) {
      size = SMALL;
      pieces = SMALL.pieces;
    } else if (remain < 100) {
      // Legacy left these uncharged (quirk P32): the small carton takes them.
      size = SMALL;
      pieces = remain;
    } else {
      // 401–499, or more than 2 000 on a carrier that takes 20 kg or less (uncharged in legacy).
      size = MEDIUM;
      pieces = Math.min(remain, MEDIUM.pieces);
    }
    boxes.push({ size, pieces: size === LARGE ? LARGE.pieces : pieces });
    remain -= size === LARGE ? LARGE.pieces : pieces;
  }
  // Legacy `ceil(($weightPerPcs * $amt) + 0.5)` per carton (`:750`); one group per carton size.
  const cartons: Carton[] = [];
  for (const size of [LARGE, MEDIUM, SMALL]) {
    const group = boxes.filter((b) => b.size === size);
    if (group.length === 0) continue;
    cartons.push({
      count: group.length,
      wCm: size.w,
      lCm: size.l,
      hCm: size.h,
      weightKg: Math.max(...group.map((b) => Math.ceil(WEIGHT_PER_POUCH_KG * b.pieces + 0.5))),
    });
  }
  return { weightAllKg, weightPerPieceKg: WEIGHT_PER_POUCH_KG, carton: cartons[0] ?? null, cartons };
}
