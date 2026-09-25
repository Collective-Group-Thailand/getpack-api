import { type PrismaService } from '@database/prisma.service';

import { type PriceComponentDescriptor, PriceComponentRegistry } from '../pricing/price-component.registry';
import { QuotePathService } from './quote-path.service';

type Candidate = {
  factoryStatus: string;
  capabilityStatus: 'active' | 'inactive';
  tier: 'A' | 'B' | 'C' | null;
  version: { id: bigint; versionNo: number } | null;
};

const factory = (over: Partial<Candidate> = {}): Candidate => ({
  factoryStatus: 'active',
  capabilityStatus: 'active',
  tier: 'A',
  version: { id: 1n, versionNo: 1 },
  ...over,
});

function service(candidates: Candidate[], matcher?: PriceComponentDescriptor['coversConfiguration']) {
  const registry = new PriceComponentRegistry();
  if (matcher) {
    registry.register({
      component: 'standard_size_prices',
      table: 'pl_standard_size_prices',
      group: 'commercial_terms',
      dimensions: [],
      values: [],
      coversConfiguration: matcher,
    });
  }
  const svc = new QuotePathService({} as PrismaService, registry);
  jest
    .spyOn(svc as unknown as { candidates: () => Promise<Candidate[]> }, 'candidates')
    .mockResolvedValue(candidates);
  return svc;
}

const instant = { id: 1n, quoteMode: 'instant' };

describe('quote-path resolution (D-043, D-100)', () => {
  it('routes RFQ-only types to RFQ whatever the factories', async () => {
    expect(await service([factory()]).resolve({ id: 1n, quoteMode: 'rfq' }, {})).toBe('type_rfq_only');
  });

  it('needs an active factory with an active capability', async () => {
    expect(await service([]).resolve(instant, {})).toBe('no_active_factory');
    expect(await service([factory({ factoryStatus: 'trial' })]).resolve(instant, {})).toBe(
      'no_active_factory',
    );
    expect(await service([factory({ capabilityStatus: 'inactive' })]).resolve(instant, {})).toBe(
      'no_active_factory',
    );
  });

  it('needs tier A or B with a price list in force', async () => {
    expect(await service([factory({ tier: 'C' })]).resolve(instant, {})).toBe('no_price_list');
    expect(await service([factory({ version: null })]).resolve(instant, {})).toBe('no_price_list');
    expect(await service([factory({ tier: null })]).resolve(instant, {})).toBe('no_price_list');
  });

  it('is instant with tier A, and with tier B only inside a registered envelope', async () => {
    expect(await service([factory()]).resolve(instant, {})).toBe('instant_available');
    expect(await service([factory({ tier: 'B' })]).resolve(instant, {})).toBe('envelope_not_covered');
    const covers = jest.fn((_v: bigint, config: Record<string, unknown>) =>
      Promise.resolve(config['size'] === 'A4'),
    );
    expect(await service([factory({ tier: 'B' })], covers).resolve(instant, { size: 'A4' })).toBe(
      'instant_available',
    );
    expect(await service([factory({ tier: 'B' })], covers).resolve(instant, { size: 'A3' })).toBe(
      'envelope_not_covered',
    );
  });
});
