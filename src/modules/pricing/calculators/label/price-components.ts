import { type PriceComponentDescriptor } from '@modules/partners/pricing/price-component.registry';

/**
 * Registry descriptors of the label price components (U-B6 label, schema-design §3.4, A-71), generated from the
 * migrated `pl_label_*` columns: dimensions identify a line (its `line_key`), values are what a proposal changes.
 * The folding components that label also reads (material prices, paper sizes, paper trims, print plates, print
 * prices, finish prices, die blocks, the waste tables, ink colours) are registered once by the folding port.
 * No cost-driver series yet (D-040: `driver_not_configured`).
 */

export const PL_LABEL_PRINT_TYPE_TERMS: PriceComponentDescriptor = {
  component: 'label_print_type_terms',
  table: 'pl_label_print_type_terms',
  group: 'commercial_terms',
  dimensions: [{ key: 'printTypeId', type: 'ref', ref: 'print_types' }],
  values: [
    { key: 'engineVariant', type: 'text' },
    { key: 'factoryMarginPct', type: 'decimal', scale: 4 },
    { key: 'minOrderAmount', type: 'integer', nullable: true },
    { key: 'minSheetPerJob', type: 'integer' },
    { key: 'leadTimeDays', type: 'decimal', scale: 2, nullable: true },
    { key: 'bulkLeadTimeMinQty', type: 'integer', nullable: true },
    { key: 'bulkLeadTimeDays', type: 'decimal', scale: 2, nullable: true },
    { key: 'wasteMethod', type: 'integer' },
    { key: 'diecutAvailable', type: 'boolean' },
    { key: 'minRollLengthM', type: 'decimal', scale: 2, nullable: true },
  ],
};

export const PL_LABEL_PAPER_SHEETS: PriceComponentDescriptor = {
  component: 'label_paper_sheets',
  table: 'pl_label_paper_sheets',
  group: 'materials',
  dimensions: [
    { key: 'sizeWIn', type: 'decimal', scale: 4 },
    { key: 'sizeLIn', type: 'decimal', scale: 4 },
    { key: 'sheetCut', type: 'integer' },
    { key: 'sheetWIn', type: 'decimal', scale: 4 },
    { key: 'sheetLIn', type: 'decimal', scale: 4 },
  ],
  values: [{ key: 'sheetCutLengthIn', type: 'decimal', scale: 4 }],
};

export const PL_LABEL_ROLL_PRINT_PRICES: PriceComponentDescriptor = {
  component: 'label_roll_print_prices',
  table: 'pl_label_roll_print_prices',
  group: 'process_rates',
  dimensions: [
    { key: 'difficultyLevelId', type: 'ref', ref: 'difficulty_levels' },
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
    { key: 'inkColourId', type: 'ref', ref: 'ink_colours' },
  ],
  values: [{ key: 'pricePerM2', type: 'decimal', scale: 6 }],
};

export const PL_LABEL_DIECUT_PRICES: PriceComponentDescriptor = {
  component: 'label_diecut_prices',
  table: 'pl_label_diecut_prices',
  group: 'process_rates',
  dimensions: [
    { key: 'difficultyLevelId', type: 'ref', ref: 'difficulty_levels' },
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
    { key: 'diecutTypeId', type: 'ref', ref: 'diecut_types', nullable: true },
    { key: 'minPaperSheetAmount', type: 'decimal', scale: 2, nullable: true },
    { key: 'maxPaperSheetAmount', type: 'decimal', scale: 2, nullable: true },
    { key: 'minBoxAmount', type: 'integer', nullable: true },
    { key: 'maxBoxAmount', type: 'integer', nullable: true },
  ],
  values: [
    { key: 'diecutPrice', type: 'decimal', scale: 6, nullable: true },
    { key: 'pricePerM2', type: 'decimal', scale: 6, nullable: true },
  ],
};

export const LABEL_PRICE_COMPONENTS: readonly PriceComponentDescriptor[] = [
  PL_LABEL_PRINT_TYPE_TERMS,
  PL_LABEL_PAPER_SHEETS,
  PL_LABEL_ROLL_PRINT_PRICES,
  PL_LABEL_DIECUT_PRICES,
];
