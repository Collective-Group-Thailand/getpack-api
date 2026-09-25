/**
 * Material price index source (D-040 note, group 1): monthly index values per series. Launch source
 * is manual admin entry of mill / distributor price lists; paid feeds plug in later as adapters.
 */
export const MATERIAL_PRICE_INDEX = Symbol('MATERIAL_PRICE_INDEX');

export interface IndexObservation {
  /** Decimal string, > 0. */
  value: string;
  /** Where the figure came from (feed id, document reference). */
  sourceRef: string;
}

export interface MaterialPriceIndexSource {
  /** Adapter keys this source serves (`index_series.adapter_key`). */
  adapterKeys(): string[];
  /** The value for `period` (first day of a month, `YYYY-MM-01`), or null when not published yet. */
  fetch(adapterKey: string, seriesCode: string, period: string): Promise<IndexObservation | null>;
}
