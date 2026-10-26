import { assertStoreRules } from './configurations';
import { storeQuoteContext } from './store-pricing.service';

/**
 * B-API-6: a print combination the product does not offer (or the engine cannot price, `catalog.print_limits`) is
 * answered by `store.quotes.calculate` with the quote path (`instant: false`, `reason: rfq_required`), not an error;
 * every other store path still refuses it. Obviously fake ids.
 */
const BLACK = 'ink-black';
const CMYK = 'ink-cmyk';

const db = () =>
  ({
    catalogProduct: { findUnique: jest.fn().mockResolvedValue({ defaultDifficultyLevel: null }) },
    catalogProductPrintModel: { findFirst: jest.fn().mockResolvedValue(null) },
    setting: {
      findFirst: jest.fn().mockResolvedValue({
        id: 1n,
        versions: [
          {
            id: 2n,
            versionNo: 1,
            effectiveFrom: new Date('2026-01-01T00:00:00Z'),
            value: { maxSpotColoursPerSide: 1, cmykSpotAddOnEnabled: false },
          },
        ],
      }),
    },
    inkColour: {
      findMany: jest.fn().mockResolvedValue([
        { publicId: BLACK, colourKind: 'spot' },
        { publicId: CMYK, colourKind: 'process' },
      ]),
    },
  }) as never;

const blackAndCmyk = {
  catalogProductId: 'product-1',
  parts: [
    {
      printFront: [
        { inkColourId: BLACK, area: 'top' },
        { inkColourId: CMYK, area: 'top' },
      ],
    },
  ],
};

describe('store calculation of a print combination not offered (B-API-6)', () => {
  it('is collected for the store calculation instead of refused', async () => {
    const { printErrors } = await assertStoreRules(db(), 'corrugate', blackAndCmyk, {
      printCombination: 'collect',
    });
    expect(printErrors).toEqual([
      expect.objectContaining({ path: 'configuration.parts[0].printFront', code: 'cmyk_with_spot' }),
    ]);
  });

  it('is still refused (422 pricing.print_combination_invalid) on the other store paths', async () => {
    await expect(assertStoreRules(db(), 'corrugate', blackAndCmyk)).rejects.toMatchObject({
      code: 'pricing.print_combination_invalid',
    });
  });

  it('routes every quantity to RFQ (rfq_required) when a combination is not offered, and only then', () => {
    expect(storeQuoteContext({ ip: '203.0.113.1' }, 1)).toEqual({
      ip: '203.0.113.1',
      channel: 'web',
      instantBlock: 'rfq_required',
    });
    expect(storeQuoteContext({}, 0)).toEqual({ channel: 'web' });
  });

  it('a valid combination passes with no errors', async () => {
    const { printErrors } = await assertStoreRules(
      db(),
      'corrugate',
      { catalogProductId: 'product-1', parts: [{ printFront: [{ inkColourId: CMYK, area: 'top' }] }] },
      { printCombination: 'collect' },
    );
    expect(printErrors).toEqual([]);
  });
});
