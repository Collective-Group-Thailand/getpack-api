import { createHash } from 'node:crypto';

import { canonical } from '@modules/catalog/imports/import-engine';

/**
 * D-277 — the studio's pricing input: the version's calculator spec (D-275) checked against its box and completed from
 * it, the quantities and the delivery postcode; its `specHash`; and the reasons a price changed between two inputs.
 * Pure: nothing here reads the database.
 */

export interface StudioBox {
  styleVariantCode: string | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  measurementBasis: string | null;
  materialId: string | null;
  printMethod: string | null;
  printSides: string | null;
  finishes: string[];
}

export interface StudioInput {
  productTypeCode: string;
  configuration: Record<string, unknown>;
  deliveryPostcode: string | null;
}

export interface SpecProblem {
  path: string;
  message: string;
}

type Part = { printFront?: unknown[]; printBack?: unknown[] };

const SIZE_KEYS = [
  ['l', 'lengthMm'],
  ['w', 'widthMm'],
  ['d', 'heightMm'],
] as const;

/**
 * The configuration priced: the spec, with the box's style variant, sizes and basis filled in where the spec has none.
 * Where both say something they must agree (the studio never prices a spec that is not the box on screen).
 */
export function studioConfiguration(
  box: StudioBox,
  spec: Record<string, unknown>,
  designPatternId: string | null,
  quantities: number[],
): { configuration: Record<string, unknown>; problems: SpecProblem[] } {
  const problems: SpecProblem[] = [];
  const c: Record<string, unknown> = { ...spec };
  const differs = (path: string, a: unknown, b: unknown, what: string) => {
    if (a !== undefined && a !== null && b !== undefined && b !== null && a !== b)
      problems.push({ path, message: `${what}: spec ${JSON.stringify(a)}, box ${JSON.stringify(b)}` });
  };
  differs('spec.patternId', c['patternId'], designPatternId, 'box style');
  if (c['patternId'] === undefined && designPatternId) c['patternId'] = designPatternId;
  differs('spec.materialId', c['materialId'], box.materialId, 'material');
  if (c['materialId'] === undefined && box.materialId) c['materialId'] = box.materialId;
  for (const [key, boxKey] of SIZE_KEYS) {
    differs(`spec.${key}`, c[key], box[boxKey], 'size');
    if (c[key] === undefined && box[boxKey] !== null) c[key] = box[boxKey];
  }
  differs('spec.basis', c['basis'], box.measurementBasis, 'measurement basis');
  if (c['basis'] === undefined && box.measurementBasis) c['basis'] = box.measurementBasis;
  differs('spec.styleVariantCode', c['styleVariantCode'], box.styleVariantCode, 'style variant');
  if (c['styleVariantCode'] === undefined && box.styleVariantCode)
    c['styleVariantCode'] = box.styleVariantCode;
  // Print sides of a box calculator (parts with front / back colours) must be the box's.
  const parts = Array.isArray(c['parts']) ? (c['parts'] as Part[]) : null;
  if (parts && box.printSides) {
    const front = parts.some((p) => (p.printFront?.length ?? 0) > 0);
    const back = parts.some((p) => (p.printBack?.length ?? 0) > 0);
    const sides = front && back ? 'both' : front ? 'outside' : back ? 'inside' : 'none';
    if (sides !== box.printSides)
      problems.push({ path: 'spec.parts', message: `print sides: spec ${sides}, box ${box.printSides}` });
  }
  c['quantities'] = [...quantities].sort((a, b) => a - b);
  return { configuration: c, problems };
}

/** sha256 (hex) of the canonical input: equal inputs, equal hash, whatever the key order. */
export function specHash(input: StudioInput): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(input)))
    .digest('hex');
}

export const PRICE_CHANGE_REASONS = [
  'style_changed',
  'size_changed',
  'material_changed',
  'print_changed',
  'finishes_changed',
  'quantity_changed',
  'delivery_changed',
  'options_changed',
  'prices_changed',
] as const;
export type PriceChangeReason = (typeof PRICE_CHANGE_REASONS)[number];

const FINISH_KEYS = ['finish1FrontId', 'finish1BackId', 'finish2'];
const PRINT_KEYS = ['printFront', 'printBack'];

const same = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null));

/** Why the next price differs from the previous one, in a stable order; `prices_changed` is added by the caller. */
export function changeReasons(previous: StudioInput, next: StudioInput): PriceChangeReason[] {
  const reasons = new Set<PriceChangeReason>();
  const a = previous.configuration;
  const b = next.configuration;
  const seen = new Set<string>();
  const mark = (keys: string[], reason: PriceChangeReason) => {
    keys.forEach((k) => seen.add(k));
    if (keys.some((k) => !same(a[k], b[k]))) reasons.add(reason);
  };
  if (previous.productTypeCode !== next.productTypeCode) reasons.add('style_changed');
  mark(['patternId', 'styleVariantCode', 'catalogProductId'], 'style_changed');
  mark(['l', 'w', 'd', 'basis'], 'size_changed');
  mark(['materialId', 'grainParallel'], 'material_changed');
  mark(['quantities'], 'quantity_changed');
  // Parts: colours and finishes are told apart; anything else in a part is an option.
  seen.add('parts');
  const pa = (Array.isArray(a['parts']) ? a['parts'] : []) as Record<string, unknown>[];
  const pb = (Array.isArray(b['parts']) ? b['parts'] : []) as Record<string, unknown>[];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? {};
    const y = pb[i] ?? {};
    if (PRINT_KEYS.some((k) => !same(x[k], y[k]))) reasons.add('print_changed');
    if (FINISH_KEYS.some((k) => !same(x[k], y[k]))) reasons.add('finishes_changed');
    const rest = new Set(
      [...Object.keys(x), ...Object.keys(y)].filter((k) => ![...PRINT_KEYS, ...FINISH_KEYS].includes(k)),
    );
    if ([...rest].some((k) => !same(x[k], y[k]))) reasons.add('options_changed');
  }
  const others = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => !seen.has(k)));
  if ([...others].some((k) => !same(a[k], b[k]))) reasons.add('options_changed');
  if (previous.deliveryPostcode !== next.deliveryPostcode) reasons.add('delivery_changed');
  return PRICE_CHANGE_REASONS.filter((r) => reasons.has(r));
}
