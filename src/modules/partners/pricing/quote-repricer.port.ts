/**
 * Re-prices a factory's quotes of a window with a proposal's values (D-040 note, impact simulation).
 * Implemented by quoting once quotes (B2.5) and calculators (B2.3) exist; until then no quote exists.
 */
export const QUOTE_REPRICER = Symbol('QUOTE_REPRICER');

export interface RepriceRequest {
  factoryId: bigint;
  productTypeId: bigint;
  proposalId: bigint;
  windowFrom: Date;
  windowTo: Date;
}

export interface RepriceResult {
  quotesInWindow: number;
  /** Change of the average quoted price, percent; null without quotes. */
  priceChangePct: string | null;
  /** Change of Packio's average margin, percentage points; null without quotes. */
  marginChangePct: string | null;
  /** Change in how often this factory would have been selected, percentage points. */
  selectionShareChangePct: string | null;
}

export interface QuoteRepricer {
  reprice(request: RepriceRequest): Promise<RepriceResult>;
}

/** Stand-in until quoting ships (B2.5): the window holds no quotes. */
export class NoQuotesRepricer implements QuoteRepricer {
  reprice(): Promise<RepriceResult> {
    return Promise.resolve({
      quotesInWindow: 0,
      priceChangePct: null,
      marginChangePct: null,
      selectionShareChangePct: null,
    });
  }
}
