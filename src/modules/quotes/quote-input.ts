import { type QuoteDimensions } from '@modules/specs/specs.service';

/** A saved quote's `input` (input schema 2 adds the frozen `dimensions`, D-182). */
export interface QuoteInput {
  productTypeCode: string;
  configuration: Record<string, unknown> | null;
  deliveryPostcode?: string | null;
  dimensions?: QuoteDimensions | null;
}

/**
 * The configuration as it was priced (D-182): the frozen priced size instead of the size entered on another basis, so
 * a later caliper change never changes what an existing quote, order or job means. Inputs written before measurement
 * bases (no `dimensions`) were priced as given (internal).
 */
export function pricedConfiguration(input: unknown): Record<string, unknown> | null {
  const q = (input ?? {}) as QuoteInput;
  const cfg = q.configuration ?? null;
  if (!cfg || !q.dimensions) return cfg;
  const { basis: _basis, ...rest } = cfg;
  void _basis;
  const p = q.dimensions.priced;
  return { ...rest, w: p.w, l: p.l, ...(typeof cfg['d'] === 'number' ? { d: p.d } : {}) };
}
