import { type CalculatorKey } from '@generated/prisma/client';

/**
 * Tier-B envelope (D-043, D-234, schema-design A-77): the structured allow-list of configurations a factory's tier-B
 * price path covers for one product type. A dimension left out is not restricted; a tier-B envelope restricts at least
 * one. Catalogue references are public ids (stable across environments, like price-line refs). A configuration is
 * covered when every restricted dimension matches; sizes match when they fall in one of the size ranges **or** equal
 * one of the standard sizes (one size dimension). Coverage also needs the factory's price lines to price it — the
 * envelope never makes a price on its own.
 */
export interface TierBEnvelope {
  /** Quantities the path covers, inclusive (null = open). */
  quantity?: { min: number | null; max: number | null };
  printTypeIds?: string[];
  /** Internal dimensions in mm (D-182); a null bound is open; no `d` bounds = any depth. */
  sizeRanges?: SizeRange[];
  standardSizeIds?: string[];
  patternIds?: string[];
  materialIds?: string[];
  stockProductIds?: string[];
  catalogProductIds?: string[];
}

export interface SizeRange {
  wMin: number | null;
  wMax: number | null;
  lMin: number | null;
  lMax: number | null;
  dMin: number | null;
  dMax: number | null;
}

export type EnvelopeKey = keyof TierBEnvelope;
type RefKey = Exclude<EnvelopeKey, 'quantity' | 'sizeRanges'>;

const COMMON: readonly EnvelopeKey[] = ['quantity', 'printTypeIds'];
const MADE_TO_ORDER: readonly EnvelopeKey[] = [
  ...COMMON,
  'sizeRanges',
  'standardSizeIds',
  'patternIds',
  'materialIds',
];

/** The dimensions each calculator's configurations carry, so an envelope may restrict only these. */
export const ENVELOPE_DIMENSIONS: Readonly<Record<CalculatorKey, readonly EnvelopeKey[]>> = {
  folding: MADE_TO_ORDER,
  corrugate: MADE_TO_ORDER,
  tag_sleeve: MADE_TO_ORDER,
  pouch: MADE_TO_ORDER,
  // Labels have no pattern (priced on their W × L bounding box).
  label: [...COMMON, 'sizeRanges', 'standardSizeIds', 'materialIds'],
  standard_product: [...COMMON, 'stockProductIds'],
  service: [...COMMON, 'catalogProductIds'],
};

export const REF_KEYS: readonly RefKey[] = [
  'printTypeIds',
  'standardSizeIds',
  'patternIds',
  'materialIds',
  'stockProductIds',
  'catalogProductIds',
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REFS = 200;
const MAX_RANGES = 50;
const MAX_MM = 10000;

export interface EnvelopeError {
  path: string;
  message: string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validates and normalises an envelope for a calculator (structure only; catalogue checks are the service's). */
export function parseEnvelope(
  calculator: CalculatorKey,
  raw: unknown,
): { envelope: TierBEnvelope; errors: EnvelopeError[] } {
  const errors: EnvelopeError[] = [];
  const envelope: TierBEnvelope = {};
  if (!isObject(raw)) return { envelope, errors: [{ path: 'envelope', message: 'must be an object' }] };
  const allowed = new Set<string>(ENVELOPE_DIMENSIONS[calculator]);
  // A validated DTO instance carries every declared key, unset ones as undefined.
  for (const key of Object.keys(raw).filter((k) => raw[k] !== undefined)) {
    if (!allowed.has(key)) {
      errors.push({ path: `envelope.${key}`, message: `${calculator} configurations do not carry ${key}` });
    }
  }
  const bound = (v: unknown, path: string, max: number): number | null => {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) {
      errors.push({ path, message: `must be a number from 0 to ${max} or null` });
      return null;
    }
    return v;
  };
  const band = (min: number | null, max: number | null, path: string) => {
    if (min !== null && max !== null && max < min) errors.push({ path, message: 'max must be at least min' });
  };
  if (raw['quantity'] !== undefined) {
    const q = raw['quantity'];
    if (!isObject(q)) {
      errors.push({ path: 'envelope.quantity', message: 'must be an object' });
    } else {
      const min = bound(q['min'], 'envelope.quantity.min', 10_000_000);
      const max = bound(q['max'], 'envelope.quantity.max', 10_000_000);
      if (min === null && max === null) {
        errors.push({ path: 'envelope.quantity', message: 'set min, max or both' });
      }
      band(min, max, 'envelope.quantity.max');
      envelope.quantity = { min, max };
    }
  }
  if (raw['sizeRanges'] !== undefined) {
    const list = raw['sizeRanges'];
    if (!Array.isArray(list) || list.length === 0 || list.length > MAX_RANGES) {
      errors.push({ path: 'envelope.sizeRanges', message: `must list 1 to ${MAX_RANGES} ranges` });
    } else {
      envelope.sizeRanges = list.map((r, i) => {
        const path = `envelope.sizeRanges[${i}]`;
        if (!isObject(r)) {
          errors.push({ path, message: 'must be an object' });
          return { wMin: null, wMax: null, lMin: null, lMax: null, dMin: null, dMax: null };
        }
        const range: SizeRange = {
          wMin: bound(r['wMin'], `${path}.wMin`, MAX_MM),
          wMax: bound(r['wMax'], `${path}.wMax`, MAX_MM),
          lMin: bound(r['lMin'], `${path}.lMin`, MAX_MM),
          lMax: bound(r['lMax'], `${path}.lMax`, MAX_MM),
          dMin: bound(r['dMin'], `${path}.dMin`, MAX_MM),
          dMax: bound(r['dMax'], `${path}.dMax`, MAX_MM),
        };
        band(range.wMin, range.wMax, `${path}.wMax`);
        band(range.lMin, range.lMax, `${path}.lMax`);
        band(range.dMin, range.dMax, `${path}.dMax`);
        if (Object.values(range).every((v) => v === null)) {
          errors.push({ path, message: 'a size range bounds at least one side' });
        }
        return range;
      });
    }
  }
  for (const key of REF_KEYS) {
    if (raw[key] === undefined) continue;
    const list = raw[key];
    const path = `envelope.${key}`;
    if (!Array.isArray(list) || list.length === 0 || list.length > MAX_REFS) {
      errors.push({ path, message: `must list 1 to ${MAX_REFS} ids` });
      continue;
    }
    if (list.some((v) => typeof v !== 'string' || !UUID.test(v))) {
      errors.push({ path, message: 'must list uuids' });
      continue;
    }
    const ids = [...new Set((list as string[]).map((v) => v.toLowerCase()))];
    if (ids.length !== list.length) errors.push({ path, message: 'lists an id twice' });
    envelope[key] = ids;
  }
  if (Object.keys(envelope).length === 0 && errors.length === 0) {
    errors.push({ path: 'envelope', message: 'a tier-B envelope restricts at least one dimension (D-234)' });
  }
  return { envelope, errors };
}

/**
 * What one configuration offers to a tier-B envelope check (D-043, D-234): internal ids, sizes in mm on the internal
 * basis (D-182). A fact the configuration does not carry is null / empty, so a restricted dimension fails closed.
 */
export interface ConfigurationFacts {
  patternId: bigint | null;
  materialIds: bigint[];
  size: { w: number; l: number; d: number | null } | null;
  catalogProductId: bigint | null;
  stockProductId: bigint | null;
}

/** What one configuration offers to an envelope check; internal ids already mapped to public ids. */
export interface EnvelopeFacts {
  patternId: string | null;
  materialIds: readonly string[];
  /** Internal dimensions, mm; `d` null for flat products. */
  size: { w: number; l: number; d: number | null } | null;
  /** Standard sizes the configuration equals (public ids), resolved by the caller. */
  standardSizeIds: readonly string[];
  stockProductId: string | null;
  catalogProductId: string | null;
}

const inBound = (min: number | null, max: number | null, v: number): boolean =>
  (min === null || v >= min) && (max === null || v <= max);

const inRange = (r: SizeRange, s: { w: number; l: number; d: number | null }): boolean =>
  inBound(r.wMin, r.wMax, s.w) &&
  inBound(r.lMin, r.lMax, s.l) &&
  (r.dMin === null && r.dMax === null ? true : s.d !== null && inBound(r.dMin, r.dMax, s.d));

/**
 * Whether an envelope covers a configuration at one quantity and print type (pure). A restricted dimension the
 * configuration cannot answer is not covered (fail closed).
 */
export function envelopeCovers(
  envelope: TierBEnvelope,
  facts: EnvelopeFacts,
  qty: number,
  printTypePublicId: string,
): boolean {
  if (envelope.quantity && !inBound(envelope.quantity.min, envelope.quantity.max, qty)) return false;
  if (envelope.printTypeIds && !envelope.printTypeIds.includes(printTypePublicId)) return false;
  if (envelope.sizeRanges || envelope.standardSizeIds) {
    const ranged = !!facts.size && (envelope.sizeRanges ?? []).some((r) => inRange(r, facts.size!));
    const standard = (envelope.standardSizeIds ?? []).some((id) => facts.standardSizeIds.includes(id));
    if (!ranged && !standard) return false;
  }
  if (envelope.patternIds && (!facts.patternId || !envelope.patternIds.includes(facts.patternId)))
    return false;
  if (envelope.materialIds) {
    if (
      facts.materialIds.length === 0 ||
      !facts.materialIds.every((m) => envelope.materialIds!.includes(m))
    ) {
      return false;
    }
  }
  if (
    envelope.stockProductIds &&
    (!facts.stockProductId || !envelope.stockProductIds.includes(facts.stockProductId))
  ) {
    return false;
  }
  if (
    envelope.catalogProductIds &&
    (!facts.catalogProductId || !envelope.catalogProductIds.includes(facts.catalogProductId))
  ) {
    return false;
  }
  return true;
}

/** Customer-safe summary of what tier-B paths cover (no factory identity, D-050 / D-044). */
export function mergeEnvelopes(envelopes: readonly TierBEnvelope[]): TierBEnvelope {
  const out: TierBEnvelope = {};
  const union = (key: RefKey) => {
    if (envelopes.length === 0 || envelopes.some((e) => !e[key])) return; // some path does not restrict it
    out[key] = [...new Set(envelopes.flatMap((e) => e[key]!))].sort();
  };
  for (const key of REF_KEYS) if (key !== 'standardSizeIds') union(key);
  // Size ranges and standard sizes are one dimension: summarised only when every path restricts the size.
  if (envelopes.length > 0 && envelopes.every((e) => e.sizeRanges || e.standardSizeIds)) {
    const ranges = envelopes.flatMap((e) => e.sizeRanges ?? []);
    const standards = [...new Set(envelopes.flatMap((e) => e.standardSizeIds ?? []))].sort();
    if (ranges.length > 0) out.sizeRanges = ranges;
    if (standards.length > 0) out.standardSizeIds = standards;
  }
  if (envelopes.length > 0 && envelopes.every((e) => e.quantity)) {
    const mins = envelopes.map((e) => e.quantity!.min);
    const maxs = envelopes.map((e) => e.quantity!.max);
    out.quantity = {
      min: mins.some((m) => m === null) ? null : Math.min(...(mins as number[])),
      max: maxs.some((m) => m === null) ? null : Math.max(...(maxs as number[])),
    };
  }
  return out;
}
