import { type PriceComponentDescriptor } from '@modules/partners/pricing/price-component.registry';

/**
 * Registry descriptors of the pouch price components (U-B6 pouch, schema-design §3.4, A-73), generated from the
 * migrated `pl_pouch_*` columns: dimensions identify a line (its `line_key`), values are what a proposal changes.
 * Every number legacy `PouchCalculator` read from the database or hard-coded in a formula is a row or a term here
 * (port map `docs/legacy/05-pouch-port-map.md` §9). No cost-driver series yet (D-040: `driver_not_configured`).
 */

const printType = { key: 'printTypeId', type: 'ref', ref: 'print_types' } as const;
const qtyBand = [
  { key: 'minQty', type: 'integer', nullable: true },
  { key: 'maxQty', type: 'integer', nullable: true },
] as const;

export const PL_POUCH_PRINT_TYPE_TERMS: PriceComponentDescriptor = {
  component: 'pouch_print_type_terms',
  table: 'pl_pouch_print_type_terms',
  group: 'commercial_terms',
  dimensions: [printType],
  values: [
    { key: 'toleranceMm', type: 'decimal', scale: 2 },
    { key: 'minDlMm', type: 'decimal', scale: 2 },
    { key: 'maxDlMm', type: 'decimal', scale: 2 },
    { key: 'minMaterialLengthM', type: 'decimal', scale: 2 },
    { key: 'setupLengthM', type: 'decimal', scale: 2 },
    { key: 'webWidthMm', type: 'decimal', scale: 2 },
    { key: 'minMaterialCost', type: 'decimal', scale: 6 },
    { key: 'bridgeMm', type: 'decimal', scale: 2 },
    { key: 'factoryMarginPct', type: 'decimal', scale: 4 },
    { key: 'leadTimeDays', type: 'decimal', scale: 2, nullable: true },
    { key: 'laminationRatePerM2', type: 'decimal', scale: 6 },
    { key: 'laminationWebWidthM', type: 'decimal', scale: 4 },
    { key: 'makingQtyThreshold', type: 'integer' },
    { key: 'makingPricePerPcs', type: 'decimal', scale: 6 },
  ],
};

export const PL_POUCH_MATERIAL_PRICES: PriceComponentDescriptor = {
  component: 'pouch_material_prices',
  table: 'pl_pouch_material_prices',
  group: 'materials',
  dimensions: [printType, { key: 'materialId', type: 'ref', ref: 'materials' }],
  values: [{ key: 'pricePerCm2', type: 'decimal', scale: 8 }],
};

export const PL_POUCH_PRINT_PRICES: PriceComponentDescriptor = {
  component: 'pouch_print_prices',
  table: 'pl_pouch_print_prices',
  group: 'process_rates',
  dimensions: [printType, { key: 'inkColourId', type: 'ref', ref: 'ink_colours' }],
  values: [{ key: 'pricePerCm2', type: 'decimal', scale: 8 }],
};

export const PL_POUCH_OPTION_PRICES: PriceComponentDescriptor = {
  component: 'pouch_option_prices',
  table: 'pl_pouch_option_prices',
  group: 'process_rates',
  dimensions: [printType, { key: 'assemblyId', type: 'ref', ref: 'assemblies' }, ...qtyBand],
  values: [
    { key: 'priceMode', type: 'text' },
    { key: 'pricePerPcs', type: 'decimal', scale: 6, nullable: true },
    { key: 'pricePerCm', type: 'decimal', scale: 6, nullable: true },
    { key: 'pricePerCm2', type: 'decimal', scale: 8, nullable: true },
  ],
};

export const PL_POUCH_PROCESS_PRICES: PriceComponentDescriptor = {
  component: 'pouch_process_prices',
  table: 'pl_pouch_process_prices',
  group: 'process_rates',
  dimensions: [printType, { key: 'process', type: 'text' }, ...qtyBand],
  values: [{ key: 'minPrice', type: 'decimal', scale: 6 }],
};

export const PL_POUCH_MIN_QUANTITIES: PriceComponentDescriptor = {
  component: 'pouch_min_quantities',
  table: 'pl_pouch_min_quantities',
  group: 'rules',
  dimensions: [
    printType,
    { key: 'minSqcm', type: 'decimal', scale: 2, nullable: true },
    { key: 'maxSqcm', type: 'decimal', scale: 2, nullable: true },
  ],
  values: [{ key: 'minQty', type: 'integer' }],
};

export const PL_POUCH_FACTORY_MARGINS: PriceComponentDescriptor = {
  component: 'pouch_factory_margins',
  table: 'pl_pouch_factory_margins',
  group: 'commercial_terms',
  dimensions: [printType, ...qtyBand],
  values: [{ key: 'marginPct', type: 'decimal', scale: 4 }],
};

export const PL_POUCH_OPTION_RULES: PriceComponentDescriptor = {
  component: 'pouch_option_rules',
  table: 'pl_pouch_option_rules',
  group: 'rules',
  dimensions: [
    printType,
    { key: 'patternId', type: 'ref', ref: 'patterns' },
    { key: 'materialId', type: 'ref', ref: 'materials' },
    { key: 'assemblyId', type: 'ref', ref: 'assemblies' },
  ],
  values: [],
};

export const POUCH_PRICE_COMPONENTS: readonly PriceComponentDescriptor[] = [
  PL_POUCH_PRINT_TYPE_TERMS,
  PL_POUCH_MATERIAL_PRICES,
  PL_POUCH_PRINT_PRICES,
  PL_POUCH_OPTION_PRICES,
  PL_POUCH_PROCESS_PRICES,
  PL_POUCH_MIN_QUANTITIES,
  PL_POUCH_FACTORY_MARGINS,
  PL_POUCH_OPTION_RULES,
];
