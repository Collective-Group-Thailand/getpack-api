import { type CalculatorKey, type PriceComponent } from '@generated/prisma/client';

const FOLDING: readonly PriceComponent[] = [
  'material_prices',
  'paper_sheets',
  'paper_sizes',
  'paper_trims',
  'print_prices',
  'print_plates',
  'print_type_terms',
  'b_print_prices',
  'ink_colours',
  'finish_prices',
  'finish_plates',
  'foil_prices',
  'diecut_prices',
  'diecut_block_prices',
  'assembly_prices',
  'b_assembly_prices',
  'assembly_sheets',
  'print_wastes',
  'b_print_wastes',
  'finish_wastes',
  'diecut_wastes',
  'assembly_wastes',
  'code_margins',
  'pattern_conditions',
  'process_exclusions',
];

/**
 * The price components each calculator's snapshot loader reads (partner UX, 2026-10-09), in the order
 * a factory works through them. A product type's price list offers only these (`productTypeCodes` on
 * `PriceComponentDto`), so a folding-carton factory is not asked about pouch film or corrugated board.
 * `component-reads.spec.ts` checks every list against the `pl*` models the loaders actually query.
 */
export const CALCULATOR_READS: Record<CalculatorKey, readonly PriceComponent[]> = {
  folding: FOLDING,
  // The tag & sleeve calculator prices through the folding loader (engine A).
  tag_sleeve: FOLDING,
  corrugate: [
    'board_prices',
    'paper_roll_widths',
    'paper_sizes',
    'paper_trims',
    'corrugate_print_prices',
    'corrugate_print_type_terms',
    'ink_colours',
    'finish_prices',
    'corrugate_die_blocks',
    'corrugate_diecut_prices',
    'corrugate_assembly_prices',
    'corrugate_process_terms',
    'difficulty_levels',
    'difficulty_margins',
    'percent_reduces',
    'fix_cost_pcts',
    'fixed_options',
    'corrugate_pattern_conditions',
  ],
  label: [
    'material_prices',
    'label_paper_sheets',
    'paper_sizes',
    'paper_trims',
    'print_prices',
    'label_roll_print_prices',
    'label_print_type_terms',
    'ink_colours',
    'finish_prices',
    'label_diecut_prices',
    'diecut_block_prices',
    'print_wastes',
    'finish_wastes',
    'diecut_wastes',
  ],
  pouch: [
    'pouch_material_prices',
    'pouch_print_prices',
    'pouch_print_type_terms',
    'pouch_process_prices',
    'pouch_option_prices',
    'pouch_option_rules',
    'pouch_min_quantities',
    'pouch_factory_margins',
  ],
  standard_product: ['stock_product_prices'],
  service: ['service_prices'],
};
