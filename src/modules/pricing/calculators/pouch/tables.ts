/**
 * What one pouch option (factory × print type) prices with (U-B6 pouch): the factory's `pl_pouch_*` rows at the
 * pricing instant (schema-design A-73). Numbers as IEEE doubles, like the PHP they come from. Bands are inclusive on
 * both ends; a null bound is open.
 */

export interface PouchTerms {
  /** Legacy `factory_match_print_type.tolerances` (`t`), mm. */
  toleranceMm: number;
  minDlMm: number;
  maxDlMm: number;
  minMaterialLengthM: number;
  setupLengthM: number;
  /** Legacy `width_roll`, mm. */
  webWidthMm: number;
  minMaterialCost: number;
  bridgeMm: number;
  /** Legacy `factory_match_print_type.margin`: used when no factory-margin band matches. */
  factoryMarginPct: number;
  leadTimeDays: number | null;
  /** Legacy hard-coded `4` THB per m² and `0.8` m (group 36 "drye", `PouchCalculator.php:651`). */
  laminationRatePerM2: number;
  laminationWebWidthM: number;
  /** Legacy `$amount * 0.5 > 5000` (i.e. more than 10 000 pieces) → `0.2` per piece (group 37, `:653`). */
  makingQtyThreshold: number;
  makingPricePerPcs: number;
}

export interface QtyBand {
  minQty: number | null;
  maxQty: number | null;
}

export interface PouchOptionPriceRow extends QtyBand {
  assemblyId: string;
  priceMode: 'per_piece' | 'per_cm2' | 'zipper';
  pricePerPcs: number | null;
  pricePerCm: number | null;
  pricePerCm2: number | null;
}

export interface PouchProcessPriceRow extends QtyBand {
  process: 'lamination' | 'making';
  minPrice: number;
}

export interface PouchTables {
  terms: PouchTerms;
  materialPrices: readonly { materialId: string; pricePerCm2: number }[];
  printPrices: readonly { inkColourId: string; pricePerCm2: number }[];
  optionPrices: readonly PouchOptionPriceRow[];
  processPrices: readonly PouchProcessPriceRow[];
  minQuantities: readonly { minSqcm: number | null; maxSqcm: number | null; minQty: number }[];
  factoryMargins: readonly (QtyBand & { marginPct: number })[];
  optionRules: readonly { patternId: string; materialId: string; assemblyId: string }[];
}

export const inQtyBand = (band: QtyBand, qty: number): boolean =>
  (band.minQty === null || band.minQty <= qty) && (band.maxQty === null || band.maxQty >= qty);
