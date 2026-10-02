import {
  type AssemblyWasteRow,
  type DiecutBlockRow,
  type DiecutPriceRow,
  type DiecutWasteRow,
  type FinishPriceRow,
  type FinishWasteRow,
  type PrintPlateRow,
  type SizeRange,
} from '../tables';

/**
 * The factory's price-list rows engine B reads (U-B6 tail, D-233), narrowed by the loader to the factory × print type ×
 * difficulty level being priced and kept in line order. Engine B reads one row where legacy took `[0]` of an unordered
 * query: the first in price-list order (quirks QB5, Q10). Its own components are schema-design A-76; the rest are
 * engine A's lines of the B print type.
 */

/** `pl_b_print_wastes`: one row per side, keyed by the side's last distinct colour and its colour count. */
export interface BPrintWasteRow {
  inkColourId: string;
  colourCount: number;
  percentWaste: number;
  setupWaste: number;
}

/** `pl_b_print_prices`: ink per m² of the print area, by machine, colour and the count of that colour. */
export interface BPrintPriceRow {
  machineId: string;
  inkColourId: string;
  colourCount: number;
  priceInkPerM2: number;
  priceColorCombineSpecialColor: number;
}

/** `pl_foil_prices`: a finish 2 of kind `foil`. */
export interface FoilPriceRow extends SizeRange {
  finishId: string;
  /** Wage per in² of the print area (legacy `finish_price_by_area_thb_per_in2`). */
  priceByAreaPerIn2: number;
  bahtPerRoll: number;
  rollWidthIn: number;
  rollLengthIn: number;
  toolingPrice: number;
}

/** `pl_b_assembly_prices`: B's types 1 width × price per metre, 2 window area, 3 / 4 per piece. */
export interface BAssemblyPriceRow {
  assemblyId: string;
  rangeMin: number | null;
  rangeMax: number | null;
  assemblyType: 1 | 2 | 3 | 4;
  pricePerDepthM: number;
  minPricePerAreaIn2: number;
  pricePerPcs: number;
  minPrice: number;
  blockPrice: number;
  materialPricePerIn2: number;
}

/** `pl_code_margins`, ordered by `maxRangeContPct` ascending. */
export interface CodeMarginRow {
  maxRangeContPct: number;
  minContBahtPerLot: number;
  codeName: string | null;
}

export interface BTerms {
  /** Legacy `factory_match_print_type.margin`: compute type 2's percent contribution (D-042). */
  factoryMarginPct: number;
}

/** Everything engine B reads for one factory × print type × difficulty level. */
export interface BTables {
  terms: BTerms;
  printWastes: readonly BPrintWasteRow[];
  finishWastes: readonly FinishWasteRow[];
  diecutWastes: readonly DiecutWasteRow[];
  assemblyWastes: readonly AssemblyWasteRow[];
  printPlates: readonly PrintPlateRow[];
  printPrices: readonly BPrintPriceRow[];
  /** Finish 1 and non-foil finish 2. */
  finishPrices: readonly FinishPriceRow[];
  foilPrices: readonly FoilPriceRow[];
  diecutPrices: readonly DiecutPriceRow[];
  diecutBlocks: readonly DiecutBlockRow[];
  assemblyPrices: readonly BAssemblyPriceRow[];
  codeMargins: readonly CodeMarginRow[];
}
