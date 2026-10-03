import { Ajv, type ValidateFunction } from 'ajv';

/**
 * RFQ spec fields per category (D-100): `product_types.rfq_spec_schema` is a JSON Schema maintained by
 * admins (B2.1). A category without a schema accepts any JSON object. Validators are cached by the
 * schema text, so an edited schema takes effect at once.
 */
const ajv = new Ajv({ allErrors: true, strict: false });
const cache = new Map<string, ValidateFunction>();

export interface SpecError {
  path: string;
  code: string;
  message: string;
}

export function specErrors(schema: unknown, spec: unknown): SpecError[] {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    return [{ path: 'spec', code: 'type', message: 'spec must be a JSON object' }];
  }
  if (schema === null || schema === undefined) return [];
  const key = JSON.stringify(schema);
  let validate = cache.get(key);
  if (!validate) {
    try {
      validate = ajv.compile(schema);
    } catch {
      // An invalid schema is an admin error: refuse rather than accept anything.
      return [{ path: 'spec', code: 'schema', message: 'the category has an invalid spec schema' }];
    }
    if (cache.size > 200) cache.clear();
    cache.set(key, validate);
  }
  if (validate(spec)) return [];
  return (validate.errors ?? []).slice(0, 50).map((e) => ({
    path: `spec${e.instancePath.replace(/\//g, '.')}${e.keyword === 'required' ? `.${String((e.params as { missingProperty?: string }).missingProperty)}` : ''}`,
    code: e.keyword,
    message: e.message ?? 'invalid',
  }));
}

/** Quantity band for analytics (D-102): banded, never the exact figure. */
export function quantityBand(quantity: number): string {
  const edges = [100, 500, 1000, 5000, 10_000, 50_000];
  const upper = edges.find((e) => quantity < e);
  const lower = [0, ...edges].filter((e) => e <= quantity).at(-1)!;
  return upper ? `${lower}-${upper - 1}` : `${lower}+`;
}

/** Dimensions rounded down to 50 mm bands (D-102 "spec band", no exact customer spec). */
export function dimensionBand(mm: number | null | undefined): number | null {
  return mm === null || mm === undefined ? null : Math.floor(mm / 50) * 50;
}

/**
 * D-252 price-gap band of a gap in % of the target from ascending upper bounds (`analytics.price_gap_bands_pct`):
 * [10, 25, 50] → `0-10`, `10-25`, `25-50`, `50+`. A gap at or below 0 is not a band (null).
 */
export function priceGapBand(gapPct: number, bounds: readonly number[]): string | null {
  if (!(gapPct > 0)) return null;
  const sorted = [...new Set(bounds)].filter((b) => b > 0).sort((a, b) => a - b);
  let lower = 0;
  for (const upper of sorted) {
    if (gapPct < upper) return `${lower}-${upper}`;
    lower = upper;
  }
  return `${lower}+`;
}
