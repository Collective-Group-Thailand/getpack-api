/**
 * Geometry of the folding calculator (B2.3, legacy `app/Libraries/Folding/PatternArea.php` and
 * `calLayoutAmount` in `app/Helpers/helpers.php`). All lengths are millimetres unless the name says
 * `In` (inches, as legacy paper sheets are stored). Numbers are IEEE doubles, like the PHP.
 */

/**
 * The legacy `switch ($this->patternId)` cases of `PatternArea::calPatternArea` (`:185-723`), named.
 * Packio keeps no legacy ids (D-005): a pattern (or, for multi-part patterns, a sub-pattern) carries
 * the formula it uses. Legacy case numbers are listed in `docs/legacy/05-folding-port-map.md`.
 */
export const GEOMETRY_FORMULAS = [
  'tuck_top', // 1
  'tray', // 2
  'sleeve', // 3
  'lid', // 4
  'insert', // 5
  'hanger_tuck_top', // 6
  'popup_tuck_top', // 7
  'popup_hanger', // 8
  'house', // 9
  'fold_flap', // 10
  'wagashi', // 11
  'wagashi_side_tuck', // 12
  'wagashi_open_top', // 13
  'flat_overlap', // 14
  'flat', // 15, 33, 34, 35, 36
  'lock_bottom_top', // 16
  'flat_overlap_combined', // 17
  'slide_tray', // 31 sub 5, 32 sub 7
  'slide_sleeve', // 31 sub 6
  'cover_base', // 32 sub 8
  'flat_extended', // 37
  'standard_blank', // 45, 46, 47, 48
] as const;
export type GeometryFormula = (typeof GEOMETRY_FORMULAS)[number];

/** Which box dimension a condition is looked up by (legacy `calculate_conditions.determinant`). */
export type GeometryDeterminant = 'w' | 'l' | 'd' | 'x' | 'c';

/**
 * Condition slots of a pattern (legacy `pattern.condition_dw … condition_nw`), plus the band tables
 * legacy hard-codes by id: `aux_f` (condition group 1 by length, cases 9, 13, 16) and `aux_f10`
 * (group 10 by length, case 13).
 */
export type GeometrySlot = 'dw' | 'dl' | 'nd' | 'nl' | 'nw' | 'aux_f' | 'aux_f10';

/** One band of a condition table (legacy `conditions`): inclusive on both ends. */
export interface GeometryBand {
  lower: number;
  upper: number;
  value: number;
}

/** A condition bound to a slot (legacy `calculate_conditions` row + its `conditions` bands). */
export interface GeometryCondition {
  /** Legacy `calculate_conditions.variable`; only case 16 reads it (the `b` allowance). */
  variable: string;
  determinant: GeometryDeterminant;
  bands: readonly GeometryBand[];
}

export interface PatternGeometry {
  formula: GeometryFormula;
  /** Slot → conditions in declared order (only `dw` of case 16 holds several). */
  conditions: Partial<Record<GeometrySlot, readonly GeometryCondition[]>>;
  /** `standard_blank`: the die-cut blank of each standard size (legacy `pattern_rel_standard_sizes`). */
  standardBlanks?: readonly { wMm: number; lMm: number; dMm: number; dwMm: number; dlMm: number }[];
}

/** Factory paper trims for the print type (legacy `paper_trim`), all mm. */
export interface PaperTrim {
  gap: number;
  trimW: number;
  trimL: number;
  edgeTrim: number;
  trimFoil: number;
  trimFinishPlate: number;
}

/** Factory adjustment of a pattern's blank (legacy `factory_rel_pattern_conditions.plus_dl/dw`). */
export interface PatternDelta {
  plusDl: number;
  plusDw: number;
}

/**
 * A paper sheet the factory can print the material on (legacy `paper` ⋈ `paper_sizes` ⋈
 * `paper_sheets`, `PatternArea::getPaperSheet:771`).
 */
export interface PaperSheet {
  /** Stable id of the sheet line (the price-list `line_key`). */
  sheetKey: string;
  sizeWIn: number;
  sizeLIn: number;
  sheetCut: number;
  sheetWIn: number;
  sheetLIn: number;
  isFixGrain: boolean;
  costPerKg: number;
  gsm: number;
  /** Set on the swapped copy of a sheet when the factory can flip paper sizes (`swipePaperSheetSize`). */
  isGrain?: boolean;
}

export interface GeometryInput {
  w: number;
  l: number;
  d: number;
  /** Legacy default 3 (`PatternArea.php:22`); used by the insert formula. */
  x?: number;
  /** Overlap for the flat overlap formulas (legacy input `c`, default 0). */
  c?: number;
  /** Fixed grain: only fix-grain sheets, in the orientation of `grainParallel`. */
  isGrain?: boolean;
  grainParallel?: 'dw' | 'dl';
  /** Quantities laid out (legacy `arrayBoxAmount`, already raised to the minimum for production). */
  boxAmounts: readonly number[];
  /** Quantities the customer asked for (legacy `qty`), one per box amount. */
  quantities: readonly number[];
}

export interface GeometryFactoryTerms {
  /** Legacy type-A factories subtract the long trim from the long sheet side (`useMaxMinPaperTrim`). */
  useMaxMinPaperTrim: boolean;
  /** Legacy `factory.can_flip_paper_size`. */
  canFlipPaperSize: boolean;
  /** Legacy hard-codes factories 9 and 23 to lay out without overlap (`PatternArea.php:911-914`). */
  disableOverlapLayout: boolean;
}

export interface GeometrySnapshot {
  pattern: PatternGeometry;
  paperTrim: PaperTrim;
  patternDelta: PatternDelta | null;
  sheets: readonly PaperSheet[];
  terms: GeometryFactoryTerms;
}

/** Legacy `calPatternArea` result (`PatternArea.php:740-762`). */
export interface PatternArea {
  dw: number;
  dl: number;
  dwPlus: number;
  dlPlus: number;
  dwWithGap: number;
  dlWithGap: number;
  paperTrimGap: number;
  nd: number;
  nl: number;
  nw: number;
  c: number;
  paperTrimW: number;
  paperTrimL: number;
  edgeTrim: number;
  trimFoilMm: number;
  /** Half of the factory's finish-plate trim, as legacy stores it (`:757`). */
  trimFinishPlateMm: number;
  w: number;
  l: number;
  d: number;
  combineLayout: boolean;
}

/** Legacy `calLayoutAmount` result (`helpers.php:597-891`), sheet-fed branches. */
export interface LayoutAmount {
  layout: number;
  slotW: number;
  slotL: number;
  areaW: number;
  areaL: number;
}

/** One way to lay a box out on a sheet (legacy `$layoutData`, `PatternArea.php:949-995, 1030-1078`). */
export interface LayoutCandidate {
  layoutStandard: boolean;
  layoutAmount: number;
  slotW: number;
  slotL: number;
  areaW: number;
  areaL: number;
  paperAmount: number;
  boxAmount: number;
  qty: number;
  sheet: PaperSheet;
  /** Legacy `pw` / `pl`: the sheet in inches. */
  pw: number;
  pl: number;
  pwWithoutTrim: number;
  plWithoutTrim: number;
  dw: number;
  dl: number;
  dwPlus: number;
  dlPlus: number;
  nd: number;
  nl: number;
  nw: number;
  dwWithGap: number;
  dlWithGap: number;
  c: number;
  gap: number;
  isGrain: boolean;
  sortGrain: 0 | 1;
  lIsGrainStandard: boolean;
  paperSheetWWithoutEdge: number;
  paperSheetLWithoutEdge: number;
  trimFoilMm: number;
  patternArea: PatternArea;
}

export interface GeometryResult {
  patternArea: PatternArea;
  /** One list per box amount, in legacy order (sheets × standard then rotated). */
  layouts: LayoutCandidate[][];
}

/** Why a configuration has no geometry — legacy computes with 0 instead (quirk Q14). */
export class GeometryError extends Error {
  constructor(
    readonly code:
      | 'geometry_condition_missing'
      | 'geometry_band_missing'
      | 'geometry_standard_blank_missing'
      | 'geometry_no_layout',
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = 'GeometryError';
  }
}
