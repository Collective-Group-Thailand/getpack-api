import {
  type DiecutBlockRow,
  type DiecutWasteRow,
  type FinishPriceRow,
  type FinishWasteRow,
  type PrintPriceRow,
  type PrintWasteRow,
} from '../folding/tables';

/**
 * The factory's label price-list rows the engine reads (U-B6 label), narrowed by the loader to the factory ×
 * print type × difficulty level being priced and ordered by the line order (legacy took `first()` in database
 * order, quirk L16). Bounds of `null` are open. Money and rates are doubles, as legacy.
 */

export type { DiecutBlockRow, DiecutWasteRow, FinishPriceRow, FinishWasteRow, PrintPriceRow, PrintWasteRow };

/** `paper_trim` of the factory and print type (`patternArea:826-830`), mm. */
export interface LabelTrim {
  gapMm: number;
  trimWMm: number;
  trimLMm: number;
  edgeTrimMm: number;
  endJobTrimMm: number;
}

/** A sheet of one of the material's paper sizes (legacy `paper ⨝ paper_sizes ⨝ paper_sheets`, `:868-881`), inches. */
export interface LabelSheet {
  sizeWIn: number;
  sizeLIn: number;
  sheetCut: number;
  sheetWIn: number;
  /** 0 = a roll. */
  sheetLIn: number;
  /** Roll-to-sheet: the roll is cut to sheets of this length; 0 = none. */
  sheetCutLengthIn: number;
}

/** The material's buy price for the print type (legacy `paper.paper_cost_per_kg`, `paper_cost_per_m2`). */
export interface LabelMaterialPrice {
  costPerKg: number | null;
  costPerM2: number | null;
}

/** Digital ink on a roll (legacy `print_prices.price_roll_thb_per_m2`). */
export interface RollPrintPriceRow {
  inkColourId: string;
  pricePerM2: number;
}

/** Digital die-cut (legacy `diecut_price`): sheets by die-cut type and sheets band, rolls by quantity band. */
export interface LabelDiecutPriceRow {
  diecutTypeId: string | null;
  minSheets: number | null;
  maxSheets: number | null;
  minBox: number | null;
  maxBox: number | null;
  diecutPrice: number | null;
  pricePerM2: number | null;
}

/** Terms of the factory's print type (legacy `factory_match_print_type`, `factory.calculate_waste_type`). */
export interface LabelTerms {
  engine: 'offset' | 'digital';
  factoryMarginPct: number;
  minOrderAmount: number | null;
  minSheetPerJob: number;
  leadTimeDays: number | null;
  bulkLeadTime: { minQty: number; days: number } | null;
  /** 1: setup waste on every process; 2: only on the first (`checkSetupWaste:986-993`). */
  wasteMethod: 1 | 2;
  /** Legacy factories 13 / 14: no die-cut process (`CStoFactory:277-287`). */
  diecutAvailable: boolean;
  /** Rolls shorter than this are not run (legacy 300 m, `calculate:456-458`); null = no minimum. */
  minRollLengthM: number | null;
}

export interface LabelTables {
  terms: LabelTerms;
  trim: LabelTrim;
  sheets: readonly LabelSheet[];
  material: LabelMaterialPrice;
  printWastes: readonly PrintWasteRow[];
  finishWastes: readonly FinishWasteRow[];
  diecutWastes: readonly DiecutWasteRow[];
  printPrices: readonly PrintPriceRow[];
  rollPrintPrices: readonly RollPrintPriceRow[];
  finishPrices: readonly FinishPriceRow[];
  diecutPrices: readonly LabelDiecutPriceRow[];
  dieBlocks: readonly DiecutBlockRow[];
}
