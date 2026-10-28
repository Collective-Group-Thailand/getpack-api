import { type InsideSpan } from '@integrations/dieline/dieline-engine.port';

import { type SizeClass } from './size-classes';
import { type FitRange, fitRangeFromRecipe } from './style-fit';

/**
 * C1c (owner decision 2026-10-28, DECISIONS-STAGE-A §11.1): the fit-range backfill's documented fallback order. Each
 * of a style's six inside bounds is taken from the first source, in this order, that actually provides it:
 *
 *   (a) `recipe` — the approved recipe's solver size range (C0b, §9.1: complete for the style's class or for every
 *       class; otherwise the bounds the recipe does state);
 *   (b) `standard_sizes` — the min/max of the style's own standard sizes: its catalogue products' standard sizes
 *       (`standard_sizes` of the active products of its pattern) and the approved recipe's presets (inside closed
 *       size through the recipe's own `closedSize`);
 *   (c) `production_envelope` — the real production limits already in the system, intersected: the calculator's size
 *       rules of its pattern (`patterns.constraints`, checked on every customer request) and the dieline engine's
 *       limits (the solver's parameter limits through `closedSize`).
 *
 * C1e (§13.2): bags and cylinders are read by their owner-approved mapping rule (`size-classes.ts`,
 * `inside-rules.ts`): a bag's width × gusset × height, a cylinder's diameter square × height — in every source that
 * states those values. Nothing else is mapped; a bound no source gives stays empty, and a style whose six bounds are not
 * all given stays out of the size search.
 *
 * C1f (owner 2026-10-28 13:58, DECISIONS-STAGE-A §14.2): a cylinder's diameter (its L and W bounds) comes from the
 * production envelope — the dieline engine's limits for the style's class (e.g. ⌀ 30–89), with the calculator's size
 * rules where they state one — instead of its preset / standard sizes, which only list a few cups
 * ({@link withSizeClassSources}). Its height keeps the fallback order. A business range still wins. Pure.
 */

export const FIT_BOUNDS = [
  'fitMinLMm',
  'fitMaxLMm',
  'fitMinWMm',
  'fitMaxWMm',
  'fitMinHMm',
  'fitMaxHMm',
] as const;
export type FitBound = (typeof FIT_BOUNDS)[number];

/** Backfill sources in the fallback order. */
export const FIT_BACKFILL_SOURCES = ['recipe', 'standard_sizes', 'production_envelope'] as const;
export type FitBackfillSource = (typeof FIT_BACKFILL_SOURCES)[number];

/** The data each source read (for the per-bound record and the report). */
export type FitBasis =
  | 'recipe_size_range'
  | 'catalogue_standard_sizes'
  | 'recipe_presets'
  | 'calculator_size_rules'
  | 'engine_limits';

export interface BoundValue {
  value: number;
  basis: FitBasis[];
}

/** What one source gives: some (or all, or none) of the six bounds, unrounded mm. */
export type SourceBounds = Partial<Record<FitBound, BoundValue>>;

/** Per bound: which source and basis the stored value came from (`style_bases.fit_range_bounds`). */
export type FitBoundSources = Record<FitBound, { source: FitBackfillSource; basis: FitBasis[] }>;

const DIMS = [
  ['length', 'fitMinLMm', 'fitMaxLMm'],
  ['width', 'fitMinWMm', 'fitMaxWMm'],
  ['height', 'fitMinHMm', 'fitMaxHMm'],
] as const;

/** The admin field's upper bound (`StyleCommercialDto`, mm). */
const MAX_FIT_MM = 5000;

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * (a) The approved recipe's size range: the complete range C0b used when there is one (unchanged for those styles),
 * else the bounds the recipe states for the style's own class, else for a bound every class states, the narrowest.
 * C1e: read by the size class — {@link remapRecipeBounds}.
 */
export function recipeBounds(
  materialClass: string,
  sizeRanges: unknown,
  sizeClass: SizeClass = 'box',
): SourceBounds {
  return remapRecipeBounds(sizeClass, statedRecipeBounds(materialClass, sizeRanges));
}

/**
 * C1e (§13.2): a recipe's size range is stated in its `length` / `width` / `height` parameters. A bag's `width`
 * parameter is its inside length (the gusset — its depth — is not in the range: it comes from the presets or the
 * limits), its `height` the height; a cylinder's range states only its height (the diameter comes from the presets or
 * the limits). Boxes are read as stated; a style whose size search does not apply gets nothing.
 */
export function remapRecipeBounds(sizeClass: SizeClass, stated: SourceBounds): SourceBounds {
  switch (sizeClass) {
    case 'box':
      return stated;
    case 'bag': {
      const out: SourceBounds = {};
      if (stated.fitMinWMm) out.fitMinLMm = stated.fitMinWMm;
      if (stated.fitMaxWMm) out.fitMaxLMm = stated.fitMaxWMm;
      if (stated.fitMinHMm) out.fitMinHMm = stated.fitMinHMm;
      if (stated.fitMaxHMm) out.fitMaxHMm = stated.fitMaxHMm;
      return out;
    }
    case 'cylinder': {
      const out: SourceBounds = {};
      if (stated.fitMinHMm) out.fitMinHMm = stated.fitMinHMm;
      if (stated.fitMaxHMm) out.fitMaxHMm = stated.fitMaxHMm;
      return out;
    }
    default:
      return {};
  }
}

function statedRecipeBounds(materialClass: string, sizeRanges: unknown): SourceBounds {
  const basis: FitBasis[] = ['recipe_size_range'];
  const complete = fitRangeFromRecipe(materialClass, sizeRanges);
  if (complete) {
    return Object.fromEntries(FIT_BOUNDS.map((k) => [k, { value: complete[k]!, basis }]));
  }
  if (sizeRanges === null || typeof sizeRanges !== 'object' || Array.isArray(sizeRanges)) return {};
  const entries = sizeRanges as Record<string, Record<string, unknown> | null>;
  const KEYS: Record<FitBound, string> = {
    fitMinLMm: 'minL',
    fitMaxLMm: 'maxL',
    fitMinWMm: 'minW',
    fitMaxWMm: 'maxW',
    fitMinHMm: 'minH',
    fitMaxHMm: 'maxH',
  };
  const own = entries[materialClass];
  const out: SourceBounds = {};
  for (const k of FIT_BOUNDS) {
    let value: number | null = null;
    if (own && typeof own === 'object') {
      const v = own[KEYS[k]];
      value = positive(v) ? v : null;
    } else {
      const all = Object.values(entries).map((c) => (c && typeof c === 'object' ? c[KEYS[k]] : null));
      if (all.length > 0 && all.every(positive))
        value = k.startsWith('fitMin') ? Math.max(...all) : Math.min(...all);
    }
    if (value !== null) out[k] = { value, basis };
  }
  return out;
}

/** An inside span per material class → the style's own class, else (per dimension) what every class allows. */
export function classSpan(
  materialClass: string,
  spans: Record<string, InsideSpan> | null | undefined,
): InsideSpan {
  const none: InsideSpan = { length: null, width: null, height: null };
  if (!spans || Object.keys(spans).length === 0) return none;
  if (spans[materialClass]) return spans[materialClass];
  const list = Object.keys(spans)
    .sort()
    .map((k) => spans[k]!);
  const of = (d: 'length' | 'width' | 'height') => {
    if (!list.every((s) => s[d] !== null)) return null;
    const min = Math.max(...list.map((s) => s[d]!.min));
    const max = Math.min(...list.map((s) => s[d]!.max));
    return min <= max ? { min, max } : null;
  };
  return { length: of('length'), width: of('width'), height: of('height') };
}

export interface StandardSizeMm {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
}

/** (b) The min/max of the style's own standard sizes: catalogue standard sizes and the recipe's presets together. */
export function standardSizeBounds(catalogue: StandardSizeMm[], presets: InsideSpan | null): SourceBounds {
  const out: SourceBounds = {};
  for (const [dim, minKey, maxKey] of DIMS) {
    const field = dim === 'length' ? 'lengthMm' : dim === 'width' ? 'widthMm' : 'heightMm';
    const fromCatalogue = catalogue.map((s) => s[field]).filter(positive);
    const values = [...fromCatalogue];
    const basis: FitBasis[] = [];
    if (fromCatalogue.length) basis.push('catalogue_standard_sizes');
    const preset = presets?.[dim] ?? null;
    if (preset && positive(preset.min) && positive(preset.max)) {
      values.push(preset.min, preset.max);
      basis.push('recipe_presets');
    }
    if (values.length === 0) continue;
    out[minKey] = { value: Math.min(...values), basis };
    out[maxKey] = { value: Math.max(...values), basis };
  }
  return out;
}

/** A calculator size rule set (`sizeRulesOf(pattern.constraints)`), inside mm. */
export interface CalculatorSizeRules {
  minLMm: number | null;
  maxLMm: number | null;
  minWMm: number | null;
  maxWMm: number | null;
  minHMm: number | null;
  maxHMm: number | null;
}

/**
 * (c) The production envelope: per bound, the narrowest of the calculator's size rules and the engine's limits that
 * state it (a size must pass both to be made). A bound neither states stays empty.
 */
export function productionEnvelopeBounds(
  rules: CalculatorSizeRules | null,
  engine: InsideSpan | null,
): SourceBounds {
  const out: SourceBounds = {};
  const fromRules: Record<FitBound, number | null> = {
    fitMinLMm: rules?.minLMm ?? null,
    fitMaxLMm: rules?.maxLMm ?? null,
    fitMinWMm: rules?.minWMm ?? null,
    fitMaxWMm: rules?.maxWMm ?? null,
    fitMinHMm: rules?.minHMm ?? null,
    fitMaxHMm: rules?.maxHMm ?? null,
  };
  for (const [dim, minKey, maxKey] of DIMS) {
    for (const [key, side] of [
      [minKey, 'min'],
      [maxKey, 'max'],
    ] as const) {
      const candidates: { value: number; basis: FitBasis }[] = [];
      const r = fromRules[key];
      if (positive(r)) candidates.push({ value: r, basis: 'calculator_size_rules' });
      const e = engine?.[dim]?.[side];
      if (positive(e)) candidates.push({ value: e, basis: 'engine_limits' });
      if (candidates.length === 0) continue;
      const value =
        side === 'min'
          ? Math.max(...candidates.map((c) => c.value))
          : Math.min(...candidates.map((c) => c.value));
      out[key] = { value, basis: candidates.map((c) => c.basis) };
    }
  }
  return out;
}

/**
 * §14.2: the sources as the size class reads them. A cylinder's standard sizes give no diameter bound, so the
 * diameter falls through to the production envelope (source `production_envelope`, basis `engine_limits`); every other
 * class, and a cylinder's height, are unchanged.
 */
export function withSizeClassSources(
  sizeClass: SizeClass,
  sources: Record<FitBackfillSource, SourceBounds>,
): Record<FitBackfillSource, SourceBounds> {
  if (sizeClass !== 'cylinder') return sources;
  const {
    fitMinLMm: _minL,
    fitMaxLMm: _maxL,
    fitMinWMm: _minW,
    fitMaxWMm: _maxW,
    ...height
  } = sources.standard_sizes;
  return { ...sources, standard_sizes: height };
}

export interface MergedFitRange {
  /** All six bounds, whole mm, min ≤ max — or null (stays out of the size search). */
  range: FitRange | null;
  /** Each stored bound's source and basis (only with a range). */
  bounds: FitBoundSources | null;
  /** Bounds no source gives. */
  missing: FitBound[];
  /** Dimensions whose bounds, as given, leave no size (min > max after rounding). */
  conflicting: ('length' | 'width' | 'height')[];
}

/**
 * Takes each bound from the first source in the fallback order that gives it; whole millimetres, never wider than
 * the source (minimums rounded up, maximums down; at most 5,000 mm). A range is returned only when all six bounds are
 * given and every dimension leaves a size.
 */
export function mergeFitRange(sources: Record<FitBackfillSource, SourceBounds>): MergedFitRange {
  const values: Partial<Record<FitBound, number>> = {};
  const bounds: Partial<FitBoundSources> = {};
  const missing: FitBound[] = [];
  for (const k of FIT_BOUNDS) {
    const source = FIT_BACKFILL_SOURCES.find((s) => sources[s][k] !== undefined);
    if (!source) {
      missing.push(k);
      continue;
    }
    const { value, basis } = sources[source][k]!;
    values[k] = k.startsWith('fitMin')
      ? Math.ceil(value - 1e-9)
      : Math.min(MAX_FIT_MM, Math.floor(value + 1e-9));
    bounds[k] = { source, basis: [...basis] };
  }
  const conflicting = DIMS.filter(
    ([, minKey, maxKey]) =>
      values[minKey] !== undefined &&
      values[maxKey] !== undefined &&
      (values[minKey] < 1 || values[minKey] > values[maxKey]),
  ).map(([dim]) => dim);
  if (missing.length > 0 || conflicting.length > 0)
    return { range: null, bounds: null, missing, conflicting };
  return {
    range: Object.fromEntries(FIT_BOUNDS.map((k) => [k, values[k]!])) as unknown as FitRange,
    bounds: bounds as FitBoundSources,
    missing,
    conflicting,
  };
}

/** The style's summary source: the one source all bounds came from, else `combined`. */
export function summarySource(bounds: FitBoundSources): FitBackfillSource | 'combined' {
  const used = new Set(FIT_BOUNDS.map((k) => bounds[k].source));
  return used.size === 1 ? [...used][0]! : 'combined';
}

export function sameBoundSources(a: unknown, b: FitBoundSources | null): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
