import { type PrismaService } from '@database/prisma.service';

import { type EnvelopeFacts, type TierBEnvelope } from '../configuration/tier-b-envelope';
import { QuotePathService } from './quote-path.service';

type Candidate = {
  factoryPublicId: string;
  factoryStatus: string;
  capabilityStatus: 'active' | 'inactive';
  tier: 'A' | 'B' | 'C' | null;
  envelope: TierBEnvelope | null;
  version: { id: bigint; versionNo: number } | null;
};

const ART = '019a0000-0000-7000-8000-0000000000b1';
const KRAFT = '019a0000-0000-7000-8000-0000000000b2';

const factory = (over: Partial<Candidate> = {}): Candidate => ({
  factoryPublicId: 'f1',
  factoryStatus: 'active',
  capabilityStatus: 'active',
  tier: 'A',
  envelope: null,
  version: { id: 1n, versionNo: 1 },
  ...over,
});

const tierB = (envelope: TierBEnvelope | null) => factory({ tier: 'B', envelope });

function service(candidates: Candidate[], type: { quoteMode: string } = { quoteMode: 'instant' }) {
  const prisma = {
    productType: {
      findFirst: jest.fn().mockResolvedValue({ id: 1n, publicId: 't1', code: 'folding_carton', ...type }),
    },
  };
  const svc = new QuotePathService(prisma as unknown as PrismaService);
  jest
    .spyOn(svc as unknown as { candidates: () => Promise<Candidate[]> }, 'candidates')
    .mockResolvedValue(candidates);
  return svc;
}

const facts = (over: Partial<EnvelopeFacts> = {}): EnvelopeFacts => ({
  patternId: null,
  materialIds: [ART],
  size: { w: 200, l: 300, d: 50 },
  standardSizeIds: [],
  stockProductId: null,
  catalogProductId: null,
  ...over,
});

const instant = { id: 1n, quoteMode: 'instant' };

describe('quote-path resolution (D-043, D-100, D-234)', () => {
  it('routes RFQ-only types to RFQ whatever the factories', async () => {
    expect(await service([factory()]).resolve({ id: 1n, quoteMode: 'rfq' }, null, null)).toBe(
      'type_rfq_only',
    );
  });

  it('needs an active factory with an active capability', async () => {
    expect(await service([]).resolve(instant, null, null)).toBe('no_active_factory');
    expect(await service([factory({ factoryStatus: 'trial' })]).resolve(instant, null, null)).toBe(
      'no_active_factory',
    );
    expect(await service([factory({ capabilityStatus: 'inactive' })]).resolve(instant, null, null)).toBe(
      'no_active_factory',
    );
  });

  it('needs tier A, or tier B with an envelope, and a price list in force', async () => {
    expect(await service([factory({ tier: 'C' })]).resolve(instant, null, null)).toBe('no_price_list');
    expect(await service([factory({ version: null })]).resolve(instant, null, null)).toBe('no_price_list');
    expect(await service([factory({ tier: null })]).resolve(instant, null, null)).toBe('no_price_list');
    // A tier-B version written before envelopes existed covers nothing (fail closed).
    expect(await service([tierB(null)]).resolve(instant, facts(), [1000])).toBe('no_price_list');
  });

  it('is instant with tier A, and with tier B only inside its envelope', async () => {
    expect(await service([factory()]).resolve(instant, null, null)).toBe('instant_available');
    const b = tierB({ materialIds: [ART], quantity: { min: 500, max: null }, printTypeIds: ['pt-offset'] });
    expect(await service([b]).resolve(instant, null, null)).toBe('envelope_not_covered');
    expect(await service([b]).resolve(instant, facts(), [1000])).toBe('instant_available');
    expect(await service([b]).resolve(instant, facts(), [100])).toBe('envelope_not_covered');
    expect(await service([b]).resolve(instant, facts({ materialIds: [KRAFT] }), [1000])).toBe(
      'envelope_not_covered',
    );
    // Quantities not given: the quantity band is not checked here; the price decides.
    expect(await service([b]).resolve(instant, facts(), null)).toBe('instant_available');
  });

  it('tells the store instant, partial or rfq with no factory identity', async () => {
    expect(await service([factory()]).availability('t1')).toEqual({
      productTypeId: 't1',
      productTypeCode: 'folding_carton',
      availability: 'instant',
      envelope: null,
    });
    const partial = await service([
      tierB({ materialIds: [ART] }),
      tierB({ materialIds: [KRAFT] }),
    ]).availability('t1');
    expect(partial).toEqual(
      expect.objectContaining({ availability: 'partial', envelope: { materialIds: [ART, KRAFT].sort() } }),
    );
    expect(JSON.stringify(partial)).not.toMatch(/f1|factory/i);
    expect((await service([factory()], { quoteMode: 'rfq' }).availability('t1')).availability).toBe('rfq');
    expect((await service([factory({ tier: 'C' })]).availability('t1')).availability).toBe('rfq');
  });
});
