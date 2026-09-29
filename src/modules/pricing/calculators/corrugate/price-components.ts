import { type PriceComponentDescriptor } from '@modules/partners/pricing/price-component.registry';

import { materialFamily } from '../shared/material-family';

/**
 * Registry descriptors of the corrugate price components (U-B6, schema-design §3.4, A-49), generated from the
 * migrated `pl_*` columns: dimensions identify a line (its `line_key`), values are what a proposal changes.
 * The folding components that corrugate also reads (finish prices, paper trims, paper sizes, ink colours) are
 * registered once by the folding port. No cost-driver series yet (D-040: `driver_not_configured`).
 */

export const PL_CORRUGATE_PRINT_TYPE_TERMS: PriceComponentDescriptor = {
  component: 'corrugate_print_type_terms',
  table: 'pl_corrugate_print_type_terms',
  group: 'commercial_terms',
  dimensions: [{ key: 'printTypeId', type: 'ref', ref: 'print_types' }],
  values: [
    { key: 'engineVariant', type: 'text' },
    { key: 'factoryMarginPct', type: 'decimal', scale: 4 },
    { key: 'minOrderAmount', type: 'integer', nullable: true },
    { key: 'leadTimeDays', type: 'decimal', scale: 2, nullable: true },
    { key: 'bulkLeadTimeMinQty', type: 'integer', nullable: true },
    { key: 'bulkLeadTimeDays', type: 'decimal', scale: 2, nullable: true },
    { key: 'maxColours', type: 'integer', nullable: true },
    { key: 'paperCut', type: 'boolean' },
    { key: 'patternAreaPercentMethod', type: 'integer' },
    { key: 'topSideCombined', type: 'boolean' },
    { key: 'trimDlMm', type: 'decimal', scale: 2 },
    { key: 'trimDwMm', type: 'decimal', scale: 2 },
    { key: 'printFixCostPerSqm', type: 'decimal', scale: 6, nullable: true },
    { key: 'nonPrintFixCostPerSqm', type: 'decimal', scale: 6, nullable: true },
    { key: 'paperPriceByOrderAmount', type: 'boolean' },
    { key: 'digitalDieBlock', type: 'boolean' },
    { key: 'minLotPrice', type: 'decimal', scale: 6, nullable: true },
    { key: 'digitalBackPrintPricePerM2', type: 'decimal', scale: 6, nullable: true },
    { key: 'digitalTwoSideAddon', type: 'boolean' },
    { key: 'packingPriceRscPerPcs', type: 'decimal', scale: 6, nullable: true },
    { key: 'packingPriceOtherPerPcs', type: 'decimal', scale: 6, nullable: true },
    { key: 'packingFreeOnRsc', type: 'boolean' },
  ],
};

export const PL_CORRUGATE_PROCESS_TERMS: PriceComponentDescriptor = {
  component: 'corrugate_process_terms',
  table: 'pl_corrugate_process_terms',
  group: 'waste',
  dimensions: [
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
    { key: 'fluteTypeId', type: 'ref', ref: 'flute_types' },
  ],
  values: [
    { key: 'trimMm', type: 'decimal', scale: 2 },
    { key: 'minLengthM', type: 'decimal', scale: 2 },
    { key: 'minSheet', type: 'integer' },
    { key: 'widthLayoutMax', type: 'integer' },
    { key: 'plRscMinIn', type: 'decimal', scale: 4 },
    { key: 'plRscMaxIn', type: 'decimal', scale: 4 },
    { key: 'pwRscMinIn', type: 'decimal', scale: 4 },
    { key: 'pwRscMaxIn', type: 'decimal', scale: 4 },
    { key: 'minRscFlapMm', type: 'decimal', scale: 2 },
    { key: 'minRscSlhMm', type: 'decimal', scale: 2 },
    { key: 'minSllMm', type: 'decimal', scale: 2 },
    { key: 'minSlwMm', type: 'decimal', scale: 2 },
    { key: 'gapMm', type: 'decimal', scale: 2 },
    { key: 'tlMm', type: 'decimal', scale: 2 },
    { key: 'twMm', type: 'decimal', scale: 2 },
    { key: 'minLengthLayoutSlot', type: 'decimal', scale: 4 },
  ],
};

export const PL_PAPER_ROLL_WIDTHS: PriceComponentDescriptor = {
  component: 'paper_roll_widths',
  table: 'pl_paper_roll_widths',
  group: 'rules',
  dimensions: [{ key: 'widthIn', type: 'decimal', scale: 4 }],
  values: [],
};

export const PL_BOARD_PRICES: PriceComponentDescriptor = {
  component: 'board_prices',
  table: 'pl_board_prices',
  group: 'materials',
  dimensions: [
    { key: 'materialId', type: 'ref', ref: 'materials' },
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
    { key: 'minSheet', type: 'integer', nullable: true },
    { key: 'maxSheet', type: 'integer', nullable: true },
  ],
  values: [{ key: 'pricePerSqft', type: 'decimal', scale: 6 }],
  materialFamilyOf: materialFamily,
};

export const PL_DIFFICULTY_LEVELS: PriceComponentDescriptor = {
  component: 'difficulty_levels',
  table: 'pl_difficulty_levels',
  group: 'process_rates',
  dimensions: [
    { key: 'difficultyLevelId', type: 'ref', ref: 'difficulty_levels' },
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
  ],
  values: [
    { key: 'printPlatePricePerIn2', type: 'decimal', scale: 6 },
    { key: 'minPricePerPcs', type: 'decimal', scale: 6 },
    { key: 'printWastePct', type: 'decimal', scale: 4 },
    { key: 'printSetupSheets', type: 'integer' },
    { key: 'diecutWastePct', type: 'decimal', scale: 4 },
    { key: 'diecutWasteSheets', type: 'integer' },
    { key: 'assemblyWastePct', type: 'decimal', scale: 4 },
    { key: 'assemblySetupSheets', type: 'integer' },
  ],
};

export const PL_DIFFICULTY_MARGINS: PriceComponentDescriptor = {
  component: 'difficulty_margins',
  table: 'pl_difficulty_margins',
  group: 'commercial_terms',
  dimensions: [
    { key: 'difficultyLevelId', type: 'ref', ref: 'difficulty_levels' },
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
    { key: 'colourAmount', type: 'integer' },
  ],
  values: [
    { key: 'percentMargin', type: 'decimal', scale: 4 },
    { key: 'minMarginPerPcs', type: 'decimal', scale: 6 },
    { key: 'minMarginPerJob', type: 'decimal', scale: 6 },
  ],
};

export const PL_PERCENT_REDUCES: PriceComponentDescriptor = {
  component: 'percent_reduces',
  table: 'pl_percent_reduces',
  group: 'commercial_terms',
  dimensions: [{ key: 'minPrice', type: 'decimal', scale: 6 }],
  values: [{ key: 'percent', type: 'decimal', scale: 4 }],
};

export const PL_FIX_COST_PCTS: PriceComponentDescriptor = {
  component: 'fix_cost_pcts',
  table: 'pl_fix_cost_pcts',
  group: 'commercial_terms',
  dimensions: [
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
    { key: 'basis', type: 'text' },
    { key: 'minValue', type: 'decimal', scale: 6, nullable: true },
    { key: 'maxValue', type: 'decimal', scale: 6, nullable: true },
  ],
  values: [{ key: 'percent', type: 'decimal', scale: 4 }],
};

export const PL_CORRUGATE_FIXED_OPTIONS: PriceComponentDescriptor = {
  component: 'fixed_options',
  table: 'pl_corrugate_fixed_options',
  group: 'rules',
  dimensions: [
    { key: 'patternId', type: 'ref', ref: 'patterns' },
    { key: 'subPatternId', type: 'ref', ref: 'sub_patterns', nullable: true },
    { key: 'boxStyle', type: 'text' },
    { key: 'kind', type: 'text' },
    { key: 'assemblyId', type: 'ref', ref: 'assemblies', nullable: true },
  ],
  values: [{ key: 'deliveryRounds', type: 'integer', nullable: true }],
};

export const PL_CORRUGATE_PATTERN_CONDITIONS: PriceComponentDescriptor = {
  component: 'corrugate_pattern_conditions',
  table: 'pl_corrugate_pattern_conditions',
  group: 'rules',
  dimensions: [
    { key: 'fluteTypeId', type: 'ref', ref: 'flute_types' },
    { key: 'patternId', type: 'ref', ref: 'patterns' },
    { key: 'subPatternId', type: 'ref', ref: 'sub_patterns', nullable: true },
  ],
  values: [
    { key: 'plusDlMm', type: 'decimal', scale: 2, min: -1000 },
    { key: 'plusDwMm', type: 'decimal', scale: 2, min: -1000 },
  ],
};

export const PL_CORRUGATE_DIE_BLOCKS: PriceComponentDescriptor = {
  component: 'corrugate_die_blocks',
  table: 'pl_corrugate_die_blocks',
  group: 'process_rates',
  dimensions: [
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
    { key: 'kind', type: 'text' },
    { key: 'fluteTypeId', type: 'ref', ref: 'flute_types', nullable: true },
    { key: 'blockMaxWIn', type: 'decimal', scale: 4, nullable: true },
    { key: 'blockMaxLIn', type: 'decimal', scale: 4, nullable: true },
    { key: 'sideType', type: 'text', nullable: true },
    { key: 'minPcs', type: 'integer', nullable: true },
    { key: 'maxPcs', type: 'integer', nullable: true },
  ],
  values: [
    { key: 'blockPrice', type: 'decimal', scale: 6, nullable: true },
    { key: 'min1layDiecutPrice', type: 'decimal', scale: 6, nullable: true },
    { key: 'stepDiecutPrice', type: 'decimal', scale: 6, nullable: true },
    { key: 'pricePerPcs', type: 'decimal', scale: 6, nullable: true },
    { key: 'minDiecutPrice', type: 'decimal', scale: 6, nullable: true },
    { key: 'deliveryCost', type: 'decimal', scale: 6, nullable: true },
    { key: 'pricePerSqm', type: 'decimal', scale: 6, nullable: true },
  ],
};

export const PL_CORRUGATE_PRINT_PRICES: PriceComponentDescriptor = {
  component: 'corrugate_print_prices',
  table: 'pl_corrugate_print_prices',
  group: 'process_rates',
  dimensions: [
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
    { key: 'inkColourId', type: 'ref', ref: 'ink_colours' },
    { key: 'materialId', type: 'ref', ref: 'materials', nullable: true },
    { key: 'minQty', type: 'integer', nullable: true },
    { key: 'maxQty', type: 'integer', nullable: true },
  ],
  values: [
    { key: 'pricePerM2', type: 'decimal', scale: 6 },
    { key: 'addTwoSidePerSqm', type: 'decimal', scale: 6, nullable: true },
  ],
};

export const PL_CORRUGATE_DIECUT_PRICES: PriceComponentDescriptor = {
  component: 'corrugate_diecut_prices',
  table: 'pl_corrugate_diecut_prices',
  group: 'process_rates',
  dimensions: [
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
    { key: 'difficultyLevelId', type: 'ref', ref: 'difficulty_levels' },
    { key: 'minQty', type: 'integer', nullable: true },
    { key: 'maxQty', type: 'integer', nullable: true },
  ],
  values: [
    { key: 'pricePerJob', type: 'decimal', scale: 6, nullable: true },
    { key: 'pricePerPcs', type: 'decimal', scale: 6, nullable: true },
    { key: 'pricePerM2', type: 'decimal', scale: 6, nullable: true },
  ],
};

export const PL_CORRUGATE_ASSEMBLY_PRICES: PriceComponentDescriptor = {
  component: 'corrugate_assembly_prices',
  table: 'pl_corrugate_assembly_prices',
  group: 'process_rates',
  dimensions: [
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
    { key: 'assemblyId', type: 'ref', ref: 'assemblies' },
    { key: 'rangeMin', type: 'integer', nullable: true },
    { key: 'rangeMax', type: 'integer', nullable: true },
    { key: 'minAreaSqcm', type: 'decimal', scale: 2, nullable: true },
    { key: 'maxAreaSqcm', type: 'decimal', scale: 2, nullable: true },
    { key: 'minDlMm', type: 'decimal', scale: 2, nullable: true },
    { key: 'maxDlMm', type: 'decimal', scale: 2, nullable: true },
  ],
  values: [
    { key: 'method', type: 'text' },
    { key: 'pricePerPcs', type: 'decimal', scale: 6 },
    { key: 'minPrice', type: 'decimal', scale: 6, nullable: true },
    { key: 'materialPricePerIn2', type: 'decimal', scale: 6, nullable: true },
  ],
};

export const CORRUGATE_PRICE_COMPONENTS: readonly PriceComponentDescriptor[] = [
  PL_BOARD_PRICES,
  PL_CORRUGATE_ASSEMBLY_PRICES,
  PL_CORRUGATE_DIECUT_PRICES,
  PL_CORRUGATE_DIE_BLOCKS,
  PL_CORRUGATE_FIXED_OPTIONS,
  PL_CORRUGATE_PATTERN_CONDITIONS,
  PL_CORRUGATE_PRINT_PRICES,
  PL_CORRUGATE_PRINT_TYPE_TERMS,
  PL_CORRUGATE_PROCESS_TERMS,
  PL_DIFFICULTY_LEVELS,
  PL_DIFFICULTY_MARGINS,
  PL_FIX_COST_PCTS,
  PL_PAPER_ROLL_WIDTHS,
  PL_PERCENT_REDUCES,
];
