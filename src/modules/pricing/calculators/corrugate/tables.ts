/**
 * The corrugate price-list rows the engines read (U-B6, schema-design A-49), in engine units: numbers
 * (IEEE doubles, as the PHP), `null` bounds open (port map quirk C19). Rows keep the price-list line order,
 * the tie-break legacy left to the database (C18). The loader (slice 6) builds these from the `pl_*` tables.
 */

/** Legacy `find_pattern_type` for the print type × flute (`CalculatorCorrugate.php:202`). */
export interface ProcessTerms {
  trimMm: number;
  minLengthM: number;
  minSheet: number;
  widthLayoutMax: number;
  plRscMinIn: number;
  plRscMaxIn: number;
  pwRscMinIn: number;
  pwRscMaxIn: number;
  minRscFlapMm: number;
  minRscSlhMm: number;
  minSllMm: number;
  minSlwMm: number;
  gapMm: number;
  tlMm: number;
  twMm: number;
  minLengthLayoutSlot: number;
}

/** A board price band (legacy `paper_grade_match_flute`, THB per sq ft), ordered by `minSheet`. */
export interface BoardPrice {
  minSheet: number | null;
  maxSheet: number | null;
  pricePerSqft: number;
}

/** The factory's terms at the difficulty level (legacy corrugate `difficult_level`). */
export interface DifficultyTerms {
  printPlatePricePerIn2: number;
  minPricePerPcs: number;
  printWastePct: number;
  printSetupSheets: number;
  diecutWastePct: number;
  diecutWasteSheets: number;
  assemblyWastePct: number;
  assemblySetupSheets: number;
}

/** Print margin and profit floors by colour count (legacy `difficult_match_margin`). */
export interface DifficultyMargin {
  colourAmount: number;
  percentMargin: number;
  /** Legacy `min_margin_thb`: the least profit per piece. */
  minMarginPerPcs: number;
  minMarginPerJob: number;
}

/** Legacy `percent_reduces`: from `minPrice` of the print price, the price is reduced by `percent`. */
export interface PercentReduce {
  minPrice: number;
  percent: number;
}

/** A flexo die block (legacy `diecut_block_price`, flexo columns). */
export interface FlexoDieBlock {
  blockMaxWIn: number;
  blockMaxLIn: number;
  sideType: string | null;
  blockPrice: number;
  min1layDiecutPrice: number | null;
  stepDiecutPrice: number | null;
  pricePerPcs: number | null;
  minDiecutPrice: number | null;
  deliveryCost: number | null;
}

/** The corrugate terms of the print type the engines read (legacy `factory_match_print_type`, `factory`). */
export interface EngineTerms {
  factoryMarginPct: number;
  /** Legacy `factory.paper_cut` (LOC-426). */
  paperCut: boolean;
}

/** A corrugate assembly price (legacy `assembly_prices` read by `calculateAssembly:1961`). */
export interface AssemblyPrice {
  assemblyId: string;
  rangeMin: number | null;
  rangeMax: number | null;
  minAreaSqcm: number | null;
  maxAreaSqcm: number | null;
  minDlMm: number | null;
  maxDlMm: number | null;
  method: 'per_piece' | 'per_area_piece';
  pricePerPcs: number;
  minPrice: number | null;
  materialPricePerIn2: number | null;
}

/** Inclusive band with open `null` bounds (quirk C19). */
export const within = (v: number, min: number | null, max: number | null): boolean =>
  (min === null || min <= v) && (max === null || max >= v);
