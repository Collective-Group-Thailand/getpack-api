import { POUCH_FORMULA_NEEDS, type PouchFormula } from '@modules/pricing/calculators/pouch/geometry';

/**
 * Size rules of a pattern (legacy `pattern.min_*` / `max_*`, `l_must_more_than_w`, `l_must_more_than_h`,
 * `w_must_more_than_h`), read from the pattern's `constraints` JSON and checked on customer requests like legacy
 * `Calculator::validateInput:471-518` (customer path only; CS was never checked). Keys (mm / booleans):
 * `minW`, `maxW`, `minL`, `maxL`, `minH`, `maxH`, `lMustExceedW`, `lMustExceedH`, `wMustExceedH`. Pure.
 */

export interface SizeRules {
  minWMm: number | null;
  maxWMm: number | null;
  minLMm: number | null;
  maxLMm: number | null;
  minHMm: number | null;
  maxHMm: number | null;
  /** Length at least the width (`:496`). */
  lengthMustExceedWidth: boolean;
  /** Length at least the height (`:506`). */
  lengthMustExceedHeight: boolean;
  /** Corrugate: 0.95 × width at least the height (`:510`). */
  widthMustExceedHeight: boolean;
}

const number = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function sizeRulesOf(constraints: unknown): SizeRules {
  const c = (constraints && typeof constraints === 'object' ? constraints : {}) as Record<string, unknown>;
  return {
    minWMm: number(c['minW']),
    maxWMm: number(c['maxW']),
    minLMm: number(c['minL']),
    maxLMm: number(c['maxL']),
    minHMm: number(c['minH']),
    maxHMm: number(c['maxH']),
    lengthMustExceedWidth: c['lMustExceedW'] === true,
    lengthMustExceedHeight: c['lMustExceedH'] === true,
    widthMustExceedHeight: c['wMustExceedH'] === true,
  };
}

export interface SizeViolation {
  path: string;
  code: string;
  message: string;
}

/** Legacy's checks in its order (`:484-512`); the first failing check is reported, as legacy does. */
export function sizeViolation(
  rules: SizeRules,
  size: { w: number; l: number; d: number },
  opts: { corrugate: boolean; flat?: boolean },
): SizeViolation | null {
  const at = (path: string, message: string): SizeViolation => ({ path, code: 'size', message });
  if (rules.minWMm !== null && size.w < rules.minWMm)
    return at('configuration.w', `the width must be at least ${rules.minWMm} mm`);
  if (rules.maxWMm !== null && size.w > rules.maxWMm)
    return at('configuration.w', `the width must be at most ${rules.maxWMm} mm`);
  if (rules.minLMm !== null && size.l < rules.minLMm)
    return at('configuration.l', `the length must be at least ${rules.minLMm} mm`);
  if (rules.maxLMm !== null && size.l > rules.maxLMm)
    return at('configuration.l', `the length must be at most ${rules.maxLMm} mm`);
  // A flat blank (tag & sleeve) has no depth and no orientation rule (legacy `validateInput`, packaging 5).
  if (opts.flat) return null;
  if (rules.lengthMustExceedWidth && size.l < size.w)
    return at('configuration.l', 'the length must be at least the width');
  if (rules.minHMm !== null && size.d < rules.minHMm)
    return at('configuration.d', `the height must be at least ${rules.minHMm} mm`);
  if (rules.maxHMm !== null && size.d > rules.maxHMm)
    return at('configuration.d', `the height must be at most ${rules.maxHMm} mm`);
  if (rules.lengthMustExceedHeight && size.l < size.d)
    return at('configuration.l', 'the length must be at least the height');
  if (opts.corrugate && rules.widthMustExceedHeight && 0.95 * size.w < size.d) {
    return at('configuration.d', 'the height must be at most 0.95 × the width');
  }
  return null;
}

/**
 * Pouch gussets and centre seal (U-B6 pouch): the pattern's `minB` / `maxB`, `minS` / `maxS`, `minCs` / `maxCs`, mm
 * (legacy `pattern.min_b … max_cs`, checked by the CS form `pouch/cs.vue:47-65`; the customer path never validated a
 * pouch, port map P26). Only the parts given are checked; the shape decides which it needs.
 */
export function gussetViolation(
  constraints: unknown,
  size: { b?: unknown; s?: unknown; cs?: unknown },
): SizeViolation | null {
  const c = (constraints && typeof constraints === 'object' ? constraints : {}) as Record<string, unknown>;
  for (const [key, suffix, name] of [
    ['b', 'B', 'bottom gusset'],
    ['s', 'S', 'side gusset'],
    ['cs', 'Cs', 'centre seal'],
  ] as const) {
    const value = size[key];
    if (typeof value !== 'number') continue;
    const min = number(c[`min${suffix}`]);
    const max = number(c[`max${suffix}`]);
    const path = `configuration.${key}`;
    if (min !== null && value < min)
      return { path, code: 'size', message: `the ${name} must be at least ${min} mm` };
    if (max !== null && value > max)
      return { path, code: 'size', message: `the ${name} must be at most ${max} mm` };
  }
  return null;
}

/** A pouch pattern's shape for the configurators: the parts it needs and their limits (U-B6 pouch). */
export function pouchShapeOf(formula: PouchFormula | null, constraints: unknown) {
  if (formula === null) return null;
  const c = (constraints && typeof constraints === 'object' ? constraints : {}) as Record<string, unknown>;
  return {
    formula,
    needs: [...POUCH_FORMULA_NEEDS[formula]],
    minBMm: number(c['minB']),
    maxBMm: number(c['maxB']),
    minSMm: number(c['minS']),
    maxSMm: number(c['maxS']),
    minCsMm: number(c['minCs']),
    maxCsMm: number(c['maxCs']),
  };
}
