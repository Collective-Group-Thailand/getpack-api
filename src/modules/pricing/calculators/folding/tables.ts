/**
 * The factory's folding price-list rows the engines read (B2.3), already narrowed by the loader to the
 * factory × print type × difficulty level being priced and ordered by the line order (quirk Q10: legacy
 * took `first()` in database order). Bounds of `null` are open. Money and rates are doubles, as legacy.
 */

export interface SheetBand {
  minSheets: number | null;
  maxSheets: number | null;
}

export interface WasteRow extends SheetBand {
  percentWaste: number;
  setupWaste: number;
}

export interface PrintWasteRow extends WasteRow {
  minPercent: number | null;
  maxPercent: number | null;
}

export interface FinishWasteRow extends WasteRow {
  /** null = every finish (legacy `finish_id` 0). */
  finishId: string | null;
}

export interface DiecutWasteRow extends WasteRow {
  diecutTypeId: string;
  minBox: number | null;
  maxBox: number | null;
}

export interface AssemblyWasteRow extends WasteRow {
  assemblyId: string | null;
}

export interface SizeRange {
  wMin: number;
  wMax: number;
  lMin: number;
  lMax: number;
}

export interface PrintPlateRow extends SizeRange {
  machineId: string;
  platePrice: number;
}

export interface PrintPriceRow extends SheetBand {
  machineId: string;
  inkColourId: string;
  percentColor: number | null;
  pricePerSheet: number;
  pricePerPcs: number;
  flatPriceFourColor: number;
  flatPriceFourColorPerPcs: number;
  priceColorCombineSpecialColor: number;
  operationCost: number;
}

export interface FinishPriceRow extends SheetBand {
  finishId: string;
  machineId: string | null;
  finishPrice: number;
  pricePerSheet: number;
  priceByAreaPerIn2: number;
  minPrice: number;
  toolingPrice: number;
  blockPricePerIn2: number;
  materialPricePerIn2: number;
  operationCost: number;
  /** Legacy `finish.diecut_window_price`: finish 1 also carries the die-cut cost. */
  addsDiecutWindow: boolean;
}

export interface FinishPlateRow extends SizeRange {
  finishId: string;
  machineId: string;
  pricePerIn2: number;
  minPlatePrice: number;
}

export interface DiecutPriceRow extends SheetBand {
  machineId: string;
  diecutPrice: number;
  pricePerSheet: number;
  operationCost: number;
}

export interface DiecutBlockRow extends SizeRange {
  machineId: string;
  layMin: number | null;
  layMax: number | null;
  diecutPrice: number;
  pricePerDrawing: number;
}

export interface AssemblyPriceRow {
  assemblyId: string;
  rangeMin: number | null;
  rangeMax: number | null;
  /** 1 by box height, 2 by window perimeter, 3 per piece, 4 by box width (legacy `assembly_type`). */
  assemblyType: 1 | 2 | 3 | 4;
  addsDiecutWindow: boolean;
  pricePerCm: number;
  pricePerPcs: number;
  minPrice: number;
  minimumOperation: number;
  blockPrice: number;
  materialPricePerIn2: number;
}

export interface AssemblySheetRow {
  wIn: number;
  lIn: number;
}

export interface OffsetTerms {
  /** Legacy `factory.calculate_waste_type`: 1 every setup waste, 2 only the first process's. */
  wasteMethod: number;
  finish2StepDownWaste: boolean;
  fourColourPriceByMaxPercent: boolean;
  assemblyWasteByAssembly: boolean;
  diecutWasteByBoxAmount: boolean;
  /** Legacy `factory_match_print_type.margin`, part of the buy price (D-042). */
  factoryMarginPct: number;
}

/** Everything engine A offset reads for one factory × print type × difficulty level. */
export interface OffsetTables {
  terms: OffsetTerms;
  /** Ink colours the factory prints, and whether each is a standard process colour. */
  standardInkColours: ReadonlySet<string>;
  printWastes: readonly PrintWasteRow[];
  finishWastes: readonly FinishWasteRow[];
  diecutWastes: readonly DiecutWasteRow[];
  assemblyWastes: readonly AssemblyWasteRow[];
  printPlates: readonly PrintPlateRow[];
  printPrices: readonly PrintPriceRow[];
  finishPrices: readonly FinishPriceRow[];
  /** Ordered by `wMax` ascending, as legacy (`A/CalculateCost.php:1853`). */
  finishPlates: readonly FinishPlateRow[];
  diecutPrices: readonly DiecutPriceRow[];
  diecutBlocks: readonly DiecutBlockRow[];
  assemblyPrices: readonly AssemblyPriceRow[];
  assemblySheets: readonly AssemblySheetRow[];
  /** Legacy `pattern.pattern_type` (Packio `patterns.pattern_kind`); 1 prices assemblies by width. */
  patternKind: number | null;
}

/** Inclusive band match; `null` bounds are open. */
export const inBand = (min: number | null, max: number | null, value: number): boolean =>
  (min === null || min <= value) && (max === null || max >= value);

export const inSheetBand = (row: SheetBand, sheets: number): boolean =>
  inBand(row.minSheets, row.maxSheets, sheets);
