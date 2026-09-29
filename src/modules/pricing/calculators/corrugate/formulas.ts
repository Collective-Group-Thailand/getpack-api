import { type CorrugateFormula, type GeometryDeterminant } from '@generated/prisma/client';

/**
 * Corrugate blank formulas (U-B6, port map §6.1): legacy `CalculatorCorrugate::calculate:314-463` by pattern
 * id (and sub-pattern for Tele 29 and slide 30), named for Packio.
 */
export const CORRUGATE_FORMULAS = [
  'rsc',
  'single_tuck',
  'double_tuck',
  'double_tuck_top_wall',
  'double_tuck_side_wall',
  'flat_sheet',
  'seafood',
  'open_top',
  'handle',
  'handle_rim',
  'tele_body',
  'tele_lid',
  'slide_tray',
  'slide_sleeve',
  'tray',
  'full_overlap',
] as const satisfies readonly CorrugateFormula[];

/** Every Prisma value is listed (compile-time check the other way round). */
const _exhaustive: readonly (typeof CORRUGATE_FORMULAS)[number][] = [] as CorrugateFormula[];
void _exhaustive;

/**
 * The corrugate condition slots and the dimension each is read by (legacy `conditions` variables: `i`, `k`, `m`
 * by W, `j` by W ÷ L; port map §6.1). They belong to the pattern, not to a part.
 */
export const CORRUGATE_CONDITION_DETERMINANTS = {
  i: 'w',
  j: 'w_over_l',
  k: 'w',
  m: 'w',
} as const satisfies Record<string, GeometryDeterminant>;
