import { type Tx } from '@database/prisma.service';
import {
  type PriceComponentDescriptor,
  type PriceValues,
} from '@modules/partners/pricing/price-component.registry';

/**
 * Registry descriptors of the folding price components (B2.3, schema-design §3.4, A-24…A-27), generated
 * from the migrated `pl_*` columns: dimensions identify a line (its `line_key`), values are what a
 * proposal changes. No cost-driver series is attached yet: until Packio names one per component, the
 * own-history suggestion reports `driver_not_configured` (D-040, no invented value).
 */

const materialFamily = async (values: PriceValues, db: Tx): Promise<bigint | null> => {
  const rows = await db.$queryRawUnsafe<{ family_id: bigint | null }[]>(
    'SELECT family_id FROM materials WHERE public_id = $1::uuid',
    values['materialId'],
  );
  return rows[0]?.family_id ?? null;
};

export const PL_ASSEMBLY_PRICES: PriceComponentDescriptor = {
  component: 'assembly_prices',
  table: 'pl_assembly_prices',
  group: 'process_rates',
  dimensions: [
    { key: 'difficultyLevelId', type: 'ref', ref: 'difficulty_levels' },
    { key: 'assemblyId', type: 'ref', ref: 'assemblies' },
    { key: 'printTypeId', type: 'ref', ref: 'print_types', nullable: true },
    { key: 'rangeAmountMin', type: 'integer', nullable: true },
    { key: 'rangeAmountMax', type: 'integer', nullable: true },
    { key: 'minAreaSqcm', type: 'decimal', scale: 2, nullable: true },
    { key: 'maxAreaSqcm', type: 'decimal', scale: 2, nullable: true },
  ],
  values: [
    { key: 'assemblyType', type: 'integer' },
    { key: 'addsDiecutWindow', type: 'boolean' },
    { key: 'pricePerCm', type: 'decimal', scale: 6, nullable: true },
    { key: 'pricePerPcs', type: 'decimal', scale: 6, nullable: true },
    { key: 'minPrice', type: 'decimal', scale: 6, nullable: true },
    { key: 'minimumOperation', type: 'decimal', scale: 6, nullable: true },
    { key: 'blockPrice', type: 'decimal', scale: 6, nullable: true },
    { key: 'materialPricePerIn2', type: 'decimal', scale: 6, nullable: true },
    { key: 'digitalMethod', type: 'text' },
  ],
};

export const PL_ASSEMBLY_SHEETS: PriceComponentDescriptor = {
  component: 'assembly_sheets',
  table: 'pl_assembly_sheets',
  group: 'rules',
  dimensions: [
    { key: 'sheetWIn', type: 'decimal', scale: 4 },
    { key: 'sheetLIn', type: 'decimal', scale: 4 },
  ],
  values: [],
};

export const PL_ASSEMBLY_WASTES: PriceComponentDescriptor = {
  component: 'assembly_wastes',
  table: 'pl_assembly_wastes',
  group: 'waste',
  dimensions: [
    { key: 'difficultyLevelId', type: 'ref', ref: 'difficulty_levels' },
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
    { key: 'assemblyId', type: 'ref', ref: 'assemblies', nullable: true },
    { key: 'minPaperSheetAmount', type: 'decimal', scale: 2, nullable: true },
    { key: 'maxPaperSheetAmount', type: 'decimal', scale: 2, nullable: true },
  ],
  values: [
    { key: 'percentWaste', type: 'decimal', scale: 4 },
    { key: 'setupWaste', type: 'integer' },
  ],
};

export const PL_DIECUT_BLOCK_PRICES: PriceComponentDescriptor = {
  component: 'diecut_block_prices',
  table: 'pl_diecut_block_prices',
  group: 'process_rates',
  dimensions: [
    { key: 'difficultyLevelId', type: 'ref', ref: 'difficulty_levels' },
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
    { key: 'machineId', type: 'ref', ref: 'factory_machines' },
    { key: 'blockWMinIn', type: 'decimal', scale: 4 },
    { key: 'blockWMaxIn', type: 'decimal', scale: 4 },
    { key: 'blockLMinIn', type: 'decimal', scale: 4 },
    { key: 'blockLMaxIn', type: 'decimal', scale: 4 },
    { key: 'layMin', type: 'integer', nullable: true },
    { key: 'layMax', type: 'integer', nullable: true },
    { key: 'minPcs', type: 'integer', nullable: true },
    { key: 'maxPcs', type: 'integer', nullable: true },
  ],
  values: [
    { key: 'diecutPrice', type: 'decimal', scale: 6, nullable: true },
    { key: 'pricePerDrawing', type: 'decimal', scale: 6, nullable: true },
    { key: 'minDiecutPrice', type: 'decimal', scale: 6, nullable: true },
    { key: 'pricePerPcs', type: 'decimal', scale: 6, nullable: true },
  ],
};

export const PL_DIECUT_PRICES: PriceComponentDescriptor = {
  component: 'diecut_prices',
  table: 'pl_diecut_prices',
  group: 'process_rates',
  dimensions: [
    { key: 'difficultyLevelId', type: 'ref', ref: 'difficulty_levels' },
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
    { key: 'machineId', type: 'ref', ref: 'factory_machines' },
    { key: 'minPaperSheetAmount', type: 'decimal', scale: 2, nullable: true },
    { key: 'maxPaperSheetAmount', type: 'decimal', scale: 2, nullable: true },
  ],
  values: [
    { key: 'diecutPrice', type: 'decimal', scale: 6, nullable: true },
    { key: 'pricePerSheet', type: 'decimal', scale: 6, nullable: true },
    { key: 'operationCost', type: 'decimal', scale: 6, nullable: true },
    { key: 'minPrice', type: 'decimal', scale: 6, nullable: true },
    { key: 'pricePerPcs', type: 'decimal', scale: 6, nullable: true },
  ],
};

export const PL_DIECUT_WASTES: PriceComponentDescriptor = {
  component: 'diecut_wastes',
  table: 'pl_diecut_wastes',
  group: 'waste',
  dimensions: [
    { key: 'difficultyLevelId', type: 'ref', ref: 'difficulty_levels' },
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
    { key: 'diecutTypeId', type: 'ref', ref: 'diecut_types' },
    { key: 'minPaperSheetAmount', type: 'decimal', scale: 2, nullable: true },
    { key: 'maxPaperSheetAmount', type: 'decimal', scale: 2, nullable: true },
    { key: 'minBoxAmount', type: 'integer', nullable: true },
    { key: 'maxBoxAmount', type: 'integer', nullable: true },
  ],
  values: [
    { key: 'percentWaste', type: 'decimal', scale: 4 },
    { key: 'setupWaste', type: 'integer' },
  ],
};

export const PL_FINISH_PLATES: PriceComponentDescriptor = {
  component: 'finish_plates',
  table: 'pl_finish_plates',
  group: 'process_rates',
  dimensions: [
    { key: 'difficultyLevelId', type: 'ref', ref: 'difficulty_levels' },
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
    { key: 'finishId', type: 'ref', ref: 'finishes' },
    { key: 'machineId', type: 'ref', ref: 'factory_machines' },
    { key: 'plateWMinIn', type: 'decimal', scale: 4 },
    { key: 'plateWMaxIn', type: 'decimal', scale: 4 },
    { key: 'plateLMinIn', type: 'decimal', scale: 4 },
    { key: 'plateLMaxIn', type: 'decimal', scale: 4 },
  ],
  values: [
    { key: 'pricePerIn2', type: 'decimal', scale: 6 },
    { key: 'minPlatePrice', type: 'decimal', scale: 6, nullable: true },
  ],
};

export const PL_FINISH_PRICES: PriceComponentDescriptor = {
  component: 'finish_prices',
  table: 'pl_finish_prices',
  group: 'process_rates',
  dimensions: [
    { key: 'difficultyLevelId', type: 'ref', ref: 'difficulty_levels' },
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
    { key: 'finishId', type: 'ref', ref: 'finishes' },
    { key: 'machineId', type: 'ref', ref: 'factory_machines', nullable: true },
    { key: 'minPaperSheetAmount', type: 'decimal', scale: 2, nullable: true },
    { key: 'maxPaperSheetAmount', type: 'decimal', scale: 2, nullable: true },
  ],
  values: [
    { key: 'finishPrice', type: 'decimal', scale: 6, nullable: true },
    { key: 'pricePerSheet', type: 'decimal', scale: 6, nullable: true },
    { key: 'priceByAreaPerIn2', type: 'decimal', scale: 6, nullable: true },
    { key: 'minPrice', type: 'decimal', scale: 6, nullable: true },
    { key: 'toolingPrice', type: 'decimal', scale: 6, nullable: true },
    { key: 'blockPricePerIn2', type: 'decimal', scale: 6, nullable: true },
    { key: 'materialPricePerIn2', type: 'decimal', scale: 6, nullable: true },
    { key: 'operationCost', type: 'decimal', scale: 6, nullable: true },
    { key: 'addsDiecutWindow', type: 'boolean' },
  ],
};

export const PL_FINISH_WASTES: PriceComponentDescriptor = {
  component: 'finish_wastes',
  table: 'pl_finish_wastes',
  group: 'waste',
  dimensions: [
    { key: 'difficultyLevelId', type: 'ref', ref: 'difficulty_levels' },
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
    { key: 'finishId', type: 'ref', ref: 'finishes', nullable: true },
    { key: 'minPaperSheetAmount', type: 'decimal', scale: 2, nullable: true },
    { key: 'maxPaperSheetAmount', type: 'decimal', scale: 2, nullable: true },
  ],
  values: [
    { key: 'percentWaste', type: 'decimal', scale: 4 },
    { key: 'setupWaste', type: 'integer' },
  ],
};

export const PL_INK_COLOURS: PriceComponentDescriptor = {
  component: 'ink_colours',
  table: 'pl_ink_colours',
  group: 'rules',
  dimensions: [
    { key: 'inkColourId', type: 'ref', ref: 'ink_colours' },
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
  ],
  values: [{ key: 'isStandard', type: 'boolean' }],
};

export const PL_MATERIAL_PRICES: PriceComponentDescriptor = {
  component: 'material_prices',
  table: 'pl_material_prices',
  group: 'materials',
  dimensions: [
    { key: 'materialId', type: 'ref', ref: 'materials' },
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
    { key: 'minPaperAmount', type: 'integer', nullable: true },
    { key: 'maxPaperAmount', type: 'integer', nullable: true },
  ],
  values: [
    { key: 'costPerKg', type: 'decimal', scale: 6, nullable: true },
    { key: 'costPerPcs', type: 'decimal', scale: 6, nullable: true },
    { key: 'costPerM2', type: 'decimal', scale: 6, nullable: true },
  ],
  materialFamilyOf: materialFamily,
};

export const PL_PAPER_SHEETS: PriceComponentDescriptor = {
  component: 'paper_sheets',
  table: 'pl_paper_sheets',
  group: 'rules',
  dimensions: [
    { key: 'sizeWIn', type: 'decimal', scale: 4 },
    { key: 'sizeLIn', type: 'decimal', scale: 4 },
    { key: 'sheetCut', type: 'integer' },
    { key: 'sheetWIn', type: 'decimal', scale: 4 },
    { key: 'sheetLIn', type: 'decimal', scale: 4 },
  ],
  values: [{ key: 'isFixGrain', type: 'boolean' }],
};

export const PL_PAPER_SIZES: PriceComponentDescriptor = {
  component: 'paper_sizes',
  table: 'pl_paper_sizes',
  group: 'rules',
  dimensions: [
    { key: 'materialId', type: 'ref', ref: 'materials' },
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
    { key: 'sizeWIn', type: 'decimal', scale: 4 },
    { key: 'sizeLIn', type: 'decimal', scale: 4 },
  ],
  values: [],
};

export const PL_PAPER_TRIMS: PriceComponentDescriptor = {
  component: 'paper_trims',
  table: 'pl_paper_trims',
  group: 'waste',
  dimensions: [{ key: 'printTypeId', type: 'ref', ref: 'print_types' }],
  values: [
    { key: 'gapMm', type: 'decimal', scale: 2 },
    { key: 'trimWMm', type: 'decimal', scale: 2 },
    { key: 'trimLMm', type: 'decimal', scale: 2 },
    { key: 'edgeTrimMm', type: 'decimal', scale: 2 },
    { key: 'trimFoilMm', type: 'decimal', scale: 2 },
    { key: 'trimFinishPlateMm', type: 'decimal', scale: 2 },
    { key: 'endJobTrimMm', type: 'decimal', scale: 2, nullable: true },
  ],
};

export const PL_PATTERN_CONDITIONS: PriceComponentDescriptor = {
  component: 'pattern_conditions',
  table: 'pl_pattern_conditions',
  group: 'rules',
  dimensions: [
    { key: 'patternId', type: 'ref', ref: 'patterns' },
    { key: 'subPatternId', type: 'ref', ref: 'sub_patterns', nullable: true },
  ],
  values: [
    { key: 'plusDlMm', type: 'decimal', scale: 2, min: -1000 },
    { key: 'plusDwMm', type: 'decimal', scale: 2, min: -1000 },
  ],
};

export const PL_PRINT_PLATES: PriceComponentDescriptor = {
  component: 'print_plates',
  table: 'pl_print_plates',
  group: 'process_rates',
  dimensions: [
    { key: 'difficultyLevelId', type: 'ref', ref: 'difficulty_levels' },
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
    { key: 'machineId', type: 'ref', ref: 'factory_machines' },
    { key: 'plateWMinIn', type: 'decimal', scale: 4 },
    { key: 'plateWMaxIn', type: 'decimal', scale: 4 },
    { key: 'plateLMinIn', type: 'decimal', scale: 4 },
    { key: 'plateLMaxIn', type: 'decimal', scale: 4 },
  ],
  values: [{ key: 'platePrice', type: 'decimal', scale: 6 }],
};

export const PL_PRINT_PRICES: PriceComponentDescriptor = {
  component: 'print_prices',
  table: 'pl_print_prices',
  group: 'process_rates',
  dimensions: [
    { key: 'difficultyLevelId', type: 'ref', ref: 'difficulty_levels' },
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
    { key: 'machineId', type: 'ref', ref: 'factory_machines' },
    { key: 'inkColourId', type: 'ref', ref: 'ink_colours' },
    { key: 'percentColor', type: 'decimal', scale: 4, nullable: true },
    { key: 'minPaperSheetAmount', type: 'decimal', scale: 2, nullable: true },
    { key: 'maxPaperSheetAmount', type: 'decimal', scale: 2, nullable: true },
    { key: 'minBoxAmount', type: 'integer', nullable: true },
    { key: 'maxBoxAmount', type: 'integer', nullable: true },
    { key: 'materialId', type: 'ref', ref: 'materials', nullable: true },
  ],
  values: [
    { key: 'pricePerSheet', type: 'decimal', scale: 6, nullable: true },
    { key: 'pricePerPcs', type: 'decimal', scale: 6, nullable: true },
    { key: 'flatPriceFourColor', type: 'decimal', scale: 6, nullable: true },
    { key: 'flatPriceFourColorPerPcs', type: 'decimal', scale: 6, nullable: true },
    { key: 'priceColorCombineSpecialColor', type: 'decimal', scale: 6, nullable: true },
    { key: 'operationCost', type: 'decimal', scale: 6, nullable: true },
    { key: 'addTwoSidePerSqm', type: 'decimal', scale: 6, nullable: true },
    { key: 'priceInkPerM2', type: 'decimal', scale: 6, nullable: true },
  ],
};

export const PL_PRINT_TYPE_TERMS: PriceComponentDescriptor = {
  component: 'print_type_terms',
  table: 'pl_print_type_terms',
  group: 'commercial_terms',
  dimensions: [{ key: 'printTypeId', type: 'ref', ref: 'print_types' }],
  values: [
    { key: 'engineVariant', type: 'text' },
    { key: 'wasteMethod', type: 'integer' },
    { key: 'finish2StepDownWaste', type: 'boolean' },
    { key: 'canFlipPaperSize', type: 'boolean' },
    { key: 'disableOverlapLayout', type: 'boolean' },
    { key: 'factoryMarginPct', type: 'decimal', scale: 4 },
    { key: 'minOrderAmount', type: 'integer', nullable: true },
    { key: 'minOrderForProduction', type: 'integer', nullable: true },
    { key: 'leadTimeDays', type: 'decimal', scale: 2, nullable: true },
    { key: 'assemblyWasteByAssembly', type: 'boolean' },
    { key: 'diecutWasteByBoxAmount', type: 'boolean' },
    { key: 'fourColourPriceByMaxPercent', type: 'boolean' },
    { key: 'costMultiplier', type: 'decimal', scale: 4 },
    { key: 'digitalDiecutBlock', type: 'text' },
    { key: 'digitalFinishMethod', type: 'text' },
    { key: 'digitalPaperMethod', type: 'text' },
    { key: 'digitalPrintBand', type: 'text' },
    { key: 'digitalPrintByMaterial', type: 'boolean' },
    { key: 'digitalPrintMethod', type: 'text' },
    { key: 'minLotPrice', type: 'decimal', scale: 6, nullable: true },
    { key: 'trimDlMm', type: 'decimal', scale: 2 },
    { key: 'trimDwMm', type: 'decimal', scale: 2 },
    { key: 'usePaperAmountForCal', type: 'boolean' },
    { key: 'bulkLeadTimeDays', type: 'decimal', scale: 2, nullable: true },
    { key: 'bulkLeadTimeMinQty', type: 'integer', nullable: true },
  ],
};

export const PL_PRINT_WASTES: PriceComponentDescriptor = {
  component: 'print_wastes',
  table: 'pl_print_wastes',
  group: 'waste',
  dimensions: [
    { key: 'difficultyLevelId', type: 'ref', ref: 'difficulty_levels' },
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
    { key: 'minPercentPrint', type: 'decimal', scale: 4, nullable: true },
    { key: 'maxPercentPrint', type: 'decimal', scale: 4, nullable: true },
    { key: 'minPaperSheetAmount', type: 'decimal', scale: 2, nullable: true },
    { key: 'maxPaperSheetAmount', type: 'decimal', scale: 2, nullable: true },
  ],
  values: [
    { key: 'percentWaste', type: 'decimal', scale: 4 },
    { key: 'setupWaste', type: 'integer' },
  ],
};

export const PL_PROCESS_EXCLUSIONS: PriceComponentDescriptor = {
  component: 'process_exclusions',
  table: 'pl_process_exclusions',
  group: 'rules',
  dimensions: [
    { key: 'materialId', type: 'ref', ref: 'materials' },
    { key: 'process', type: 'text' },
    { key: 'finishId', type: 'ref', ref: 'finishes', nullable: true },
    { key: 'assemblyId', type: 'ref', ref: 'assemblies', nullable: true },
  ],
  values: [],
};

export const FOLDING_PRICE_COMPONENTS: readonly PriceComponentDescriptor[] = [
  PL_ASSEMBLY_PRICES,
  PL_ASSEMBLY_SHEETS,
  PL_ASSEMBLY_WASTES,
  PL_DIECUT_BLOCK_PRICES,
  PL_DIECUT_PRICES,
  PL_DIECUT_WASTES,
  PL_FINISH_PLATES,
  PL_FINISH_PRICES,
  PL_FINISH_WASTES,
  PL_INK_COLOURS,
  PL_MATERIAL_PRICES,
  PL_PAPER_SHEETS,
  PL_PAPER_SIZES,
  PL_PAPER_TRIMS,
  PL_PATTERN_CONDITIONS,
  PL_PRINT_PLATES,
  PL_PRINT_PRICES,
  PL_PRINT_TYPE_TERMS,
  PL_PRINT_WASTES,
  PL_PROCESS_EXCLUSIONS,
];
