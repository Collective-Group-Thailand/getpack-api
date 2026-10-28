/**
 * C1e (owner decision 2026-10-28 12:07, DECISIONS-STAGE-A §13.2): how a recipe's own parameter values become an inside
 * size (length × width × height, mm) when the recipe declares no `closedSize` of its own. A recipe's `closedSize`
 * always wins; these rules only read the parameters the recipe already has (its presets, its solver limits) — they
 * never add a number.
 *
 * - `parameters` (boxes and everything else): its `length`, `width` and `height` parameters, as before (C1c).
 * - `bag` (paper bags PK-PG-*, plastic bags PK-PB-*): length = the bag's `width`, width = its `gusset` (the depth),
 *   height = its `height`. A bag without a gusset or a height parameter gives no width / height.
 * - `cylinder` (cups, bowls, tubes — sized by a diameter): length = width = the diameter (the bounding square of the
 *   round footprint), height = `height`. A tapered body (`topDiameter` / `bottomDiameter`) uses the smaller of the
 *   two — the narrowest inside, so a product that fits there fits the whole body. `neckDiameter` is not a body size.
 *
 * Pure.
 */
export const INSIDE_RULES = ['parameters', 'bag', 'cylinder'] as const;
export type InsideRule = (typeof INSIDE_RULES)[number];

export type InsideValues = Record<'length' | 'width' | 'height', unknown>;

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** The body diameter of a round recipe: `diameter`, else the smaller of `topDiameter` / `bottomDiameter`. */
export function bodyDiameter(values: Record<string, unknown>): number | null {
  if (positive(values['diameter'])) return values['diameter'];
  const ends = [values['topDiameter'], values['bottomDiameter']].filter(positive);
  return ends.length > 0 ? Math.min(...ends) : null;
}

/** The inside size the rule reads from a recipe's parameter values (a missing value stays missing). */
export function insideFromParameters(rule: InsideRule, values: Record<string, unknown>): InsideValues {
  switch (rule) {
    case 'bag':
      return { length: values['width'], width: values['gusset'], height: values['height'] };
    case 'cylinder': {
      const d = bodyDiameter(values);
      return { length: d, width: d, height: values['height'] };
    }
    default:
      return { length: values['length'], width: values['width'], height: values['height'] };
  }
}
