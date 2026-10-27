/**
 * The /styles size search (styles redesign C0, DECISIONS-STAGE-A §4 "same fit rule as styles"): the customer measures
 * the outside of their product; the box needs that plus {@link FIT_CLEARANCE_MM} on every dimension inside. A style
 * fits when each of those inside dimensions lies within the style's entered range — length and width may swap (the
 * product can be turned on the base), height may not. A style with any bound missing never fits (unknown ≠ fits).
 */

/** 0.5 cm per dimension (DECISIONS-STAGE-A §4; GLOBAL-RULES-level decision, not a per-style setting). */
export const FIT_CLEARANCE_MM = 5;

export interface ProductSizeMm {
  l: number;
  w: number;
  h: number;
}

export interface FitRange {
  fitMinLMm: number | null;
  fitMaxLMm: number | null;
  fitMinWMm: number | null;
  fitMaxWMm: number | null;
  fitMinHMm: number | null;
  fitMaxHMm: number | null;
}

/** Inside size the product needs (mm), in the order the style is measured (ยาว × กว้าง × สูง). */
export interface FitResult {
  insideLMm: number;
  insideWMm: number;
  insideHMm: number;
}

/** `200x150x80` (L × W × H of the product, mm; decimals allowed) → numbers, or null when malformed. */
export function parseProductSize(value: string): ProductSizeMm | null {
  const m = /^(\d{1,4}(?:\.\d)?)x(\d{1,4}(?:\.\d)?)x(\d{1,4}(?:\.\d)?)$/.exec(value.trim().toLowerCase());
  if (!m) return null;
  const [l, w, h] = [m[1], m[2], m[3]].map(Number) as [number, number, number];
  if (l <= 0 || w <= 0 || h <= 0) return null;
  return { l, w, h };
}

/** True when the style has all six bounds (it can take part in the size search). */
export function hasFitRange(r: FitRange): boolean {
  return [r.fitMinLMm, r.fitMaxLMm, r.fitMinWMm, r.fitMaxWMm, r.fitMinHMm, r.fitMaxHMm].every(
    (v) => typeof v === 'number',
  );
}

const within = (v: number, min: number, max: number) => v >= min && v <= max;

/** The inside size this product needs in this style, or null when it does not fit (or the range is incomplete). */
export function fitOf(range: FitRange, product: ProductSizeMm): FitResult | null {
  if (!hasFitRange(range)) return null;
  const minL = range.fitMinLMm!;
  const maxL = range.fitMaxLMm!;
  const minW = range.fitMinWMm!;
  const maxW = range.fitMaxWMm!;
  const minH = range.fitMinHMm!;
  const maxH = range.fitMaxHMm!;
  const a = product.l + FIT_CLEARANCE_MM;
  const b = product.w + FIT_CLEARANCE_MM;
  const h = product.h + FIT_CLEARANCE_MM;
  if (!within(h, minH, maxH)) return null;
  // As measured first; turned 90° on the base second.
  if (within(a, minL, maxL) && within(b, minW, maxW)) return { insideLMm: a, insideWMm: b, insideHMm: h };
  if (within(b, minL, maxL) && within(a, minW, maxW)) return { insideLMm: b, insideWMm: a, insideHMm: h };
  return null;
}
