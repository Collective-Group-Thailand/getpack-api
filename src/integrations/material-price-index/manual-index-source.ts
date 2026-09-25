import { type IndexObservation, type MaterialPriceIndexSource } from './material-price-index.port';

/**
 * Launch source (D-040 note): values are entered by admins from mill and distributor price lists,
 * so no series is fed automatically. Paid feeds are added as further adapters when contracted.
 */
export class ManualIndexSource implements MaterialPriceIndexSource {
  adapterKeys(): string[] {
    return [];
  }

  fetch(): Promise<IndexObservation | null> {
    return Promise.resolve(null);
  }
}
