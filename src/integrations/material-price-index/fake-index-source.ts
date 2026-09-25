import { type IndexObservation, type MaterialPriceIndexSource } from './material-price-index.port';

/** Local and test feed under adapter key `fake`: serves the values a test publishes. */
export class FakeIndexSource implements MaterialPriceIndexSource {
  private readonly values = new Map<string, string>();

  publish(seriesCode: string, period: string, value: string): void {
    this.values.set(`${seriesCode}|${period}`, value);
  }

  adapterKeys(): string[] {
    return ['fake'];
  }

  fetch(adapterKey: string, seriesCode: string, period: string): Promise<IndexObservation | null> {
    const value = adapterKey === 'fake' ? this.values.get(`${seriesCode}|${period}`) : undefined;
    return Promise.resolve(value ? { value, sourceRef: `fake:${seriesCode}:${period}` } : null);
  }
}
