import { type InsideRule } from '@integrations/dieline/inside-rules';

/**
 * C1e (owner decision 2026-10-28 12:07, DECISIONS-STAGE-A §13.2): how the /styles size search reads each style.
 *
 * - `box` — everything else: inside length × width × height as the recipe states it (C0b / C1c, unchanged).
 * - `bag` — paper bags `PK-PG-*` and plastic bags `PK-PB-*`: inside size = width × gusset (as the depth) × height,
 *   from the recipe / preset values where present (`inside-rules.ts`). Plastic bags have no engine reference
 *   material yet (`flexible`), so they stay empty until Prepress adds closed-size definitions
 *   (`docs/design/styles-redesign/PREPRESS-SIZE-TASKS.md`).
 * - `cylinder` — cups, bowls, tubes: a style whose approved recipe is sized by a body diameter (`diameter`,
 *   `topDiameter`, `bottomDiameter`): inside footprint = diameter × diameter (the bounding square), height = height;
 *   the product's L × W is fitted against that square (`fitOf` in `style-fit.ts`).
 * - `not_applicable` — labels, shrink sleeves, tags, sleeves, inserts, flat folders (`PK-LA-*`, `PK-TG-*`,
 *   PK-SL-03, PK-IN-02, PK-CI-02, PK-DS-04, PK-SP-13, PK-SP-12): "size search not applicable" — no fit range, out
 *   of the size search, and not counted as missing.
 * - Exception (C1f, owner 2026-10-28 13:58, DECISIONS-STAGE-A §14.1): PK-TG-03 (cup carrier) is a `box` although it
 *   matches `PK-TG-*` — it holds products, so it keeps its recipe range ({@link BOX_EXCEPTION_CODES}).
 *
 * The lists are the owner's decision (a documented rule, not a business value): change them here and in DECISIONS.
 * Pure.
 */
export const SIZE_CLASSES = ['box', 'bag', 'cylinder', 'not_applicable'] as const;
export type SizeClass = (typeof SIZE_CLASSES)[number];

/** §13.2: code prefixes and codes whose size search is not applicable. */
export const NOT_APPLICABLE_PREFIXES = ['PK-LA-', 'PK-TG-'] as const;
export const NOT_APPLICABLE_CODES = [
  'PK-SL-03',
  'PK-IN-02',
  'PK-CI-02',
  'PK-DS-04',
  'PK-SP-13',
  'PK-SP-12',
] as const;
/** §14.1: codes read as a `box` although a not-applicable prefix matches them (they hold products). */
export const BOX_EXCEPTION_CODES = ['PK-TG-03'] as const;
/** §13.2: code prefixes of bags (width × gusset × height). */
export const BAG_PREFIXES = ['PK-PG-', 'PK-PB-'] as const;
/** §13.2: recipe parameters that size a round body (`neckDiameter` sizes a neck hole, not the body). */
export const BODY_DIAMETER_PARAMS = ['diameter', 'topDiameter', 'bottomDiameter'] as const;

/** The parameter names of a stored recipe's engine recipes (`{ engine: [{ params: [name | { ref }] }] }`). */
export function recipeParameterNames(recipe: unknown): string[] {
  if (!recipe || typeof recipe !== 'object') return [];
  const engine = (recipe as { engine?: unknown }).engine;
  if (!Array.isArray(engine)) return [];
  const names = new Set<string>();
  for (const r of engine) {
    const params = r && typeof r === 'object' ? (r as { params?: unknown }).params : null;
    if (!Array.isArray(params)) continue;
    for (const p of params) {
      if (typeof p === 'string') names.add(p);
      else if (p && typeof p === 'object' && typeof (p as { ref?: unknown }).ref === 'string')
        names.add((p as { ref: string }).ref);
    }
  }
  return [...names];
}

/** The style's size class, from its code and (for cylinders) its approved recipe's parameters. */
export function sizeClassOf(code: string, recipe: unknown): SizeClass {
  if ((BOX_EXCEPTION_CODES as readonly string[]).includes(code)) return 'box';
  if (
    NOT_APPLICABLE_PREFIXES.some((p) => code.startsWith(p)) ||
    (NOT_APPLICABLE_CODES as readonly string[]).includes(code)
  )
    return 'not_applicable';
  if (BAG_PREFIXES.some((p) => code.startsWith(p))) return 'bag';
  const params = recipeParameterNames(recipe);
  if (params.some((p) => (BODY_DIAMETER_PARAMS as readonly string[]).includes(p))) return 'cylinder';
  return 'box';
}

/** The engine's inside rule for a size class (`not_applicable` is never measured). */
export function insideRuleOf(sizeClass: SizeClass): InsideRule {
  return sizeClass === 'bag' ? 'bag' : sizeClass === 'cylinder' ? 'cylinder' : 'parameters';
}

export const isSizeClass = (v: unknown): v is SizeClass =>
  typeof v === 'string' && (SIZE_CLASSES as readonly string[]).includes(v);
