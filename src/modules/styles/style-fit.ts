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

/** C1e: the size classes the fit test distinguishes (`size-classes.ts`; bags fit like boxes). */
export type SizeShape = 'box' | 'bag' | 'cylinder' | 'not_applicable';

/** True when the style has all six bounds (it can take part in the size search). */
export function hasFitRange(r: FitRange): boolean {
  return [r.fitMinLMm, r.fitMaxLMm, r.fitMinWMm, r.fitMaxWMm, r.fitMinHMm, r.fitMaxHMm].every(
    (v) => typeof v === 'number',
  );
}

const within = (v: number, min: number, max: number) => v >= min && v <= max;

/**
 * The inside size this product needs in this style, or null when it does not fit (or the range is incomplete).
 * C1e (§13.2): a `cylinder` style's footprint is the diameter's bounding square — the product's L × W must fit inside
 * one square side (the larger of the two + clearance, within both the length and the width range), its height within
 * the height range; the result reads diameter × diameter × height. A `not_applicable` style never fits.
 */
export function fitOf(
  range: FitRange,
  product: ProductSizeMm,
  sizeClass: SizeShape = 'box',
): FitResult | null {
  if (sizeClass === 'not_applicable' || !hasFitRange(range)) return null;
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
  if (sizeClass === 'cylinder') {
    const d = Math.max(a, b);
    return within(d, minL, maxL) && within(d, minW, maxW)
      ? { insideLMm: d, insideWMm: d, insideHMm: h }
      : null;
  }
  // As measured first; turned 90° on the base second.
  if (within(a, minL, maxL) && within(b, minW, maxW)) return { insideLMm: a, insideWMm: b, insideHMm: h };
  if (within(b, minL, maxL) && within(a, minW, maxW)) return { insideLMm: b, insideWMm: a, insideHMm: h };
  return null;
}

/**
 * Where a style's fit range came from: a backfill source (C0b `recipe`; C1c `standard_sizes`, `production_envelope`,
 * or `combined` when its bounds came from several — DECISIONS-STAGE-A §11.1) or the business (curation, CSV).
 */
export type FitRangeSource = 'recipe' | 'standard_sizes' | 'production_envelope' | 'combined' | 'business';

const FIT_KEYS = ['fitMinLMm', 'fitMaxLMm', 'fitMinWMm', 'fitMaxWMm', 'fitMinHMm', 'fitMaxHMm'] as const;

/** True when no bound is entered. */
export function isFitRangeEmpty(r: FitRange): boolean {
  return FIT_KEYS.every((k) => r[k] === null || r[k] === undefined);
}

export function sameFitRange(a: FitRange, b: FitRange): boolean {
  return FIT_KEYS.every((k) => (a[k] ?? null) === (b[k] ?? null));
}

/** The admin field's upper bound (`StyleCommercialDto`, mm). */
const MAX_FIT_MM = 5000;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * C0b (owner decision 2026-10-28, DECISIONS-STAGE-A §9.1): the fit range an approved recipe's size range gives
 * (`style_recipes.size_ranges`, per material class, mm, internal basis — the same inside basis as the fit range).
 * The style's own material class when the recipe states a complete range for it; otherwise the range every complete
 * class allows (the intersection: what can be made whatever the class). Whole millimetres, never wider than the
 * recipe (minimums rounded up, maximums down). Null when no class is complete or the intersection is empty.
 */
export function fitRangeFromRecipe(materialClass: string, sizeRanges: unknown): FitRange | null {
  if (sizeRanges === null || typeof sizeRanges !== 'object' || Array.isArray(sizeRanges)) return null;
  type Box = [number, number, number, number, number, number];
  const boxOf = (raw: unknown): Box | null => {
    if (raw === null || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const v = [r['minL'], r['maxL'], r['minW'], r['maxW'], r['minH'], r['maxH']];
    return v.every(finite) ? (v as Box) : null;
  };
  const entries = sizeRanges as Record<string, unknown>;
  let box = boxOf(entries[materialClass]);
  if (!box) {
    const complete = Object.keys(entries)
      .sort()
      .map((k) => boxOf(entries[k]))
      .filter((b): b is Box => b !== null);
    if (complete.length === 0) return null;
    box = complete.reduce<Box>(
      (acc, b) => [
        Math.max(acc[0], b[0]),
        Math.min(acc[1], b[1]),
        Math.max(acc[2], b[2]),
        Math.min(acc[3], b[3]),
        Math.max(acc[4], b[4]),
        Math.min(acc[5], b[5]),
      ],
      complete[0]!,
    );
  }
  const range: FitRange = {
    fitMinLMm: Math.ceil(box[0] - 1e-9),
    fitMaxLMm: Math.min(MAX_FIT_MM, Math.floor(box[1] + 1e-9)),
    fitMinWMm: Math.ceil(box[2] - 1e-9),
    fitMaxWMm: Math.min(MAX_FIT_MM, Math.floor(box[3] + 1e-9)),
    fitMinHMm: Math.ceil(box[4] - 1e-9),
    fitMaxHMm: Math.min(MAX_FIT_MM, Math.floor(box[5] + 1e-9)),
  };
  const ok =
    range.fitMinLMm! >= 1 &&
    range.fitMinLMm! <= range.fitMaxLMm! &&
    range.fitMinWMm! >= 1 &&
    range.fitMinWMm! <= range.fitMaxWMm! &&
    range.fitMinHMm! >= 1 &&
    range.fitMinHMm! <= range.fitMaxHMm!;
  return ok ? range : null;
}
