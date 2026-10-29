import { StudioQuotesService } from './studio-quotes.service';

/** D-459 (C11): "เปลี่ยนเป็น CMYK" priced before it is applied — same path, nothing saved, explained vs the shown price. */
describe('store.studio.quote with alternativeSpec (D-459)', () => {
  const box = {
    styleVariantCode: null,
    lengthMm: 200,
    widthMm: 140,
    heightMm: 60,
    measurementBasis: 'internal',
    materialId: 'mat-1',
    printMethod: 'flexo',
    printSides: 'outside',
    finishes: [],
  };
  const savedSpec = { materialId: 'mat-1', parts: [{ printFront: [{ inkColourId: 'black' }] }] };
  const cmykSpec = { materialId: 'mat-1', parts: [{ printFront: [{ inkColourId: 'cmyk' }] }] };
  const calc = (unitPrice: string) => ({ steps: [{ quantity: 1000, instant: true, unitPrice }], specs: [] });

  function setup() {
    const prisma = {
      designDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: 1n,
          catalogProduct: {
            productType: {
              id: 2n,
              code: 'corrugated',
              status: 'active',
              quoteMode: 'instant',
              calculatorKey: 'corrugate',
            },
          },
          pattern: { publicId: 'pat-1' },
          currentVersion: { id: 3n, versionNo: 4, spec: savedSpec, box },
        }),
      },
      designDocumentVersion: { findUnique: jest.fn() },
      productType: { findFirstOrThrow: jest.fn().mockResolvedValue({ calculatorKey: 'corrugate' }) },
      studioQuoteSnapshot: {
        findUnique: jest.fn().mockResolvedValue({
          input: {
            productTypeCode: 'corrugated',
            configuration: {
              ...savedSpec,
              patternId: 'pat-1',
              l: 200,
              w: 140,
              d: 60,
              basis: 'internal',
              quantities: [1000],
            },
            deliveryPostcode: null,
          },
          result: calc('12.50'),
        }),
        upsert: jest.fn(),
      },
    };
    const storePricing = { price: jest.fn().mockResolvedValue({ calculation: calc('14.10') }) };
    const engine = { hasCalculator: jest.fn().mockReturnValue(true) };
    const redis = { incr: jest.fn().mockResolvedValue(1), expire: jest.fn() };
    const service = new StudioQuotesService(
      prisma as never,
      engine as never,
      {} as never,
      {} as never,
      storePricing as never,
      redis as never,
    );
    return { service, prisma, storePricing };
  }

  it('prices the alternative spec through the store pricing path and saves nothing', async () => {
    const { service, prisma, storePricing } = setup();
    const result = await service.quote({ userId: 9n } as never, 'design-1', {
      quantities: [1000],
      previousSpecHash: 'a'.repeat(64),
      alternativeSpec: cmykSpec,
    });
    expect(storePricing.price).toHaveBeenCalledWith(
      'corrugate',
      expect.objectContaining({ parts: cmykSpec.parts, patternId: 'pat-1', l: 200, quantities: [1000] }),
      expect.anything(),
      undefined,
    );
    expect(prisma.studioQuoteSnapshot.upsert).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      mode: 'instant',
      cached: false,
      versionNo: 4,
      reasons: ['print_changed'],
      changes: [{ quantity: 1000, previousUnitPrice: '12.50', unitPrice: '14.10' }],
    });
  });

  it('refuses an alternative that is not the box on screen (studio.spec_mismatch)', async () => {
    const { service } = setup();
    await expect(
      service.quote({ userId: 9n } as never, 'design-1', {
        quantities: [1000],
        alternativeSpec: { ...cmykSpec, materialId: 'other' },
      }),
    ).rejects.toMatchObject({ code: 'studio.spec_mismatch' });
  });
});
