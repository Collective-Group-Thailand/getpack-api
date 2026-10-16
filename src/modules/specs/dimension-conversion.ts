import { type CalculatorKey, type CorrugateFormula, type GeometryFormula } from '@generated/prisma/client';

/**
 * Measurement bases (D-182, schema-design A-80): one pure conversion between the inside size (`internal`), the outside
 * size (`external`), the score-to-score size of the blank (`over_crease`) and, for flat products, the finished size
 * (`product`). The API and the web read the same numbers: the caliper factors are getpack-web's
 * `@getpack/dieline` rules (`packages/dieline/src/constants.ts:11-30` — a crease sits at mid-thickness, so a panel is
 * scored at inside + 1·t and a depth closed at both ends at inside + 2·t, an open tray's at + 1·t), applied per
 * construction family. **Prepress confirms these factors** before they are relied on for production (D-182, still
 * open); the version below is frozen with every quote that used it.
 */
export const CONVERSION_VERSION = '1.0.0';

export const MEASUREMENT_BASES = ['internal', 'external', 'over_crease', 'product'] as const;
export type MeasurementBasis = (typeof MEASUREMENT_BASES)[number];

/** How a style closes: both ends (box), one end open (tray), both open (sleeve), or no depth (flat). */
export type ConstructionFamily = 'box' | 'tray' | 'sleeve' | 'flat';

export interface Size {
  w: number;
  l: number;
  d: number;
}

/** Calipers added to the inside size per axis to reach a basis (multiples of t). */
const ALLOWANCE: Record<Exclude<ConstructionFamily, 'flat'>, Record<'external' | 'over_crease', Size>> = {
  box: { over_crease: { w: 1, l: 1, d: 2 }, external: { w: 2, l: 2, d: 2 } },
  tray: { over_crease: { w: 1, l: 1, d: 1 }, external: { w: 2, l: 2, d: 1 } },
  sleeve: { over_crease: { w: 1, l: 1, d: 0 }, external: { w: 2, l: 2, d: 0 } },
};

const FOLDING_FAMILY: Partial<Record<GeometryFormula, ConstructionFamily>> = {
  tray: 'tray',
  lid: 'tray',
  slide_tray: 'tray',
  cover_base: 'tray',
  wagashi_open_top: 'tray',
  sleeve: 'sleeve',
  slide_sleeve: 'sleeve',
  flat: 'flat',
  flat_overlap: 'flat',
  flat_overlap_combined: 'flat',
  flat_extended: 'flat',
  insert: 'flat',
};

const CORRUGATE_FAMILY: Partial<Record<CorrugateFormula, ConstructionFamily>> = {
  tray: 'tray',
  open_top: 'tray',
  slide_tray: 'tray',
  tele_body: 'tray',
  tele_lid: 'tray',
  slide_sleeve: 'sleeve',
  flat_sheet: 'flat',
};

/**
 * The construction family of a style: from the pattern's folding or corrugate formula (closed box when not listed);
 * a box with no depth is flat; labels, tags & sleeves and pouches are flat products.
 */
export function constructionFamily(
  calculator: CalculatorKey | null,
  pattern: { geometryFormula: GeometryFormula | null; corrugateFormula: CorrugateFormula | null } | null,
  depthMm: number | null,
): ConstructionFamily {
  if (calculator === 'label' || calculator === 'tag_sleeve' || calculator === 'pouch') return 'flat';
  if (calculator === 'standard_product' || calculator === 'service') return 'flat';
  if (depthMm !== null && depthMm <= 0) return 'flat';
  const family =
    (pattern?.corrugateFormula && CORRUGATE_FAMILY[pattern.corrugateFormula]) ||
    (pattern?.geometryFormula && FOLDING_FAMILY[pattern.geometryFormula]) ||
    'box';
  return family;
}

/** The bases a family is measured on: a flat product has one size; a box, tray or sleeve three. */
export const basesOf = (family: ConstructionFamily): readonly MeasurementBasis[] =>
  family === 'flat' ? ['product'] : ['internal', 'external', 'over_crease'];

const round2 = (v: number): number => Math.round(v * 100) / 100;

export interface ConvertedSizes {
  family: ConstructionFamily;
  caliperMm: number | null;
  conversionVersion: string;
  /** Each basis of the family; null when it needs a caliper the material does not have. */
  sizes: Partial<Record<MeasurementBasis, Size | null>>;
}

export class BasisError extends Error {
  constructor(readonly code: 'specs.basis_not_accepted' | 'specs.caliper_missing') {
    super(code);
  }
}

/**
 * Converts a size given on `basis` to every basis of its family (pure; millimetres rounded to 0.01). Throws
 * `specs.basis_not_accepted` when the family is not measured on that basis.
 */
export function convertSize(
  size: Size,
  basis: MeasurementBasis,
  family: ConstructionFamily,
  caliperMm: number | null,
): ConvertedSizes {
  const head = { family, caliperMm, conversionVersion: CONVERSION_VERSION };
  if (!basesOf(family).includes(basis)) throw new BasisError('specs.basis_not_accepted');
  if (family === 'flat') return { ...head, sizes: { product: { w: size.w, l: size.l, d: size.d } } };
  const allowance = ALLOWANCE[family];
  const shift = (s: Size, k: Size, sign: 1 | -1, t: number): Size => ({
    w: round2(s.w + sign * k.w * t),
    l: round2(s.l + sign * k.l * t),
    d: round2(s.d + sign * k.d * t),
  });
  if (caliperMm === null) {
    return { ...head, sizes: { internal: null, external: null, over_crease: null, [basis]: size } };
  }
  const internal =
    basis === 'internal' ? size : shift(size, allowance[basis as 'external' | 'over_crease'], -1, caliperMm);
  return {
    ...head,
    sizes: {
      internal: basis === 'internal' ? size : internal,
      external: basis === 'external' ? size : shift(internal, allowance.external, 1, caliperMm),
      over_crease: basis === 'over_crease' ? size : shift(internal, allowance.over_crease, 1, caliperMm),
    },
  };
}

/** The internal size a box calculator prices (D-182), or the error why it cannot be had. */
export function internalSize(converted: ConvertedSizes): Size {
  const internal = converted.sizes.internal;
  if (!internal) throw new BasisError('specs.caliper_missing');
  return internal;
}
