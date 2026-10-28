import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';

import { PRICE_SETTING_KEYS, PriceHintsService, tierQuantities } from './price-hints.service';

/** C0: the "starting from" price follows price and print-config changes (D-220, D-441). */
describe('PriceHintsService refresh triggers', () => {
  const service = () => {
    const s = new PriceHintsService({} as never, {} as never, {} as never);
    const refresh = jest.spyOn(s, 'refresh').mockResolvedValue({ priced: 0, cleared: 0 });
    return { s, refresh };
  };
  const event = (key: unknown) => ({ payload: { key } }) as unknown as DomainEventEnvelope;

  it('refreshes every hint when the print limits change', async () => {
    const { s, refresh } = service();
    await s.onSettingChanged(event('catalog.print_limits'));
    expect(refresh).toHaveBeenCalledWith();
  });

  it('ignores settings that do not move a store price', async () => {
    const { s, refresh } = service();
    await s.onSettingChanged(event('quotes.validity_days'));
    await s.onSettingChanged(event(undefined));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes on product-type and catalogue-import changes', async () => {
    const { s, refresh } = service();
    await s.onConfigChanged();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('lists the price-moving settings', () => {
    expect([...PRICE_SETTING_KEYS].sort()).toEqual([
      'catalog.print_limits',
      'pricing.margin_floor_pct',
      'tax.rounding_mode',
    ]);
  });
});

/** C1-API-2: the quick calculator's tier table (products R2). */
describe('PriceHintsService tiers', () => {
  const product = (over: Record<string, unknown> = {}) => ({
    publicId: '0192f3a0-0000-7000-8000-000000000001',
    status: 'active',
    referenceConfiguration: { quantities: [300], l: 140, w: 97.5, d: 60 },
    quantityPresets: [1000, 100, 300, 300, 500],
    productType: {
      code: 'corrugated_box',
      status: 'active',
      quoteMode: 'instant',
      calculatorKey: 'corrugate',
    },
    ...over,
  });
  const steps = [100, 300, 500, 1000].map((quantity) => ({ quantity, instant: true, unitPrice: '1.00' }));
  const setup = (row: unknown) => {
    const prisma = { catalogProduct: { findFirst: jest.fn().mockResolvedValue(row) } };
    const engine = { hasCalculator: jest.fn().mockReturnValue(true) };
    const price = jest.fn().mockResolvedValue({
      calculation: { steps, specs: [], specLabel: { th: 'สเปก', en: 'Spec' } },
    });
    const s = new PriceHintsService(prisma as never, engine as never, { price } as never);
    return { s, price, prisma };
  };

  it('quantities: presets ascending and distinct, capped at 10; the reference alone without presets', () => {
    expect(tierQuantities([1000, 100, 300, 300], 300)).toEqual([100, 300, 1000]);
    expect(tierQuantities([], 300)).toEqual([300]);
    expect(tierQuantities(null, null)).toEqual([]);
    expect(
      tierQuantities(
        [...Array(12).keys()].map((i) => (i + 1) * 100),
        300,
      ),
    ).toHaveLength(10);
  });

  it('prices the default spec at the presets through the store path, without a calculate log', async () => {
    const { s, price } = setup(product());
    const out = await s.tiers('postal-box');
    expect(price).toHaveBeenCalledTimes(1);
    const [key, configuration, ctx] = price.mock.calls[0]!;
    expect(key).toBe('corrugate');
    expect(configuration).toMatchObject({
      quantities: [100, 300, 500, 1000],
      catalogProductId: '0192f3a0-0000-7000-8000-000000000001',
      l: 140,
    });
    expect(ctx).toMatchObject({ log: false });
    expect(out.tiers).toBe(steps);
    expect(out.basis).toMatchObject({ quantity: 300, includesVat: true, includesDelivery: false });
  });

  it('reuses the table within the TTL', async () => {
    const { s, price } = setup(product());
    await s.tiers('postal-box');
    await s.tiers('postal-box');
    expect(price).toHaveBeenCalledTimes(1);
  });

  it('has no tiers for an RFQ product or one without a default spec — never an estimate', async () => {
    for (const row of [
      product({ referenceConfiguration: null }),
      product({ productType: { code: 'x', status: 'active', quoteMode: 'rfq', calculatorKey: 'corrugate' } }),
    ]) {
      const { s, price } = setup(row);
      const out = await s.tiers('x');
      expect(out.tiers).toEqual([]);
      expect(out.basis).toBeNull();
      expect(price).not.toHaveBeenCalled();
    }
  });

  it('answers not found for an unknown or inactive product', async () => {
    const { s } = setup(null);
    await expect(s.tiers('nope')).rejects.toMatchObject({ code: 'http.not_found' });
  });
});

/** C1b (DECISIONS-STAGE-A §10.5, D-447): a stock product's "starting from" = its unit price at its minimum order. */
describe('PriceHintsService stock hints', () => {
  const stock = (over: Record<string, unknown> = {}) => ({
    id: 5n,
    publicId: '0192f3a0-0000-7000-8000-000000000005',
    status: 'active',
    minOrderQty: 500,
    productType: { status: 'active', quoteMode: 'instant', calculatorKey: 'standard_product' },
    ...over,
  });
  const setup = (rows: unknown[], step: Record<string, unknown> | null) => {
    const prisma = {
      stockProduct: { findMany: jest.fn().mockResolvedValue(rows) },
      stockPriceHint: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const engine = { hasCalculator: jest.fn().mockReturnValue(true) };
    const price = jest.fn().mockResolvedValue({
      view: { calculatorVersion: '1.0.0', steps: step ? [step] : [] },
    });
    const s = new PriceHintsService(prisma as never, engine as never, { price } as never);
    return { s, prisma, price };
  };

  it('prices the minimum order quantity through the store path, without a calculate log', async () => {
    const { s, prisma, price } = setup([stock()], {
      quantity: 500,
      instant: true,
      unitPrice: '2.354',
      leadTimeDays: 2,
    });
    await expect(s.refreshStock()).resolves.toEqual({ priced: 1, cleared: 0 });
    expect(price).toHaveBeenCalledWith(
      'standard_product',
      { stockProductId: stock().publicId, quantities: [500] },
      expect.objectContaining({ log: false }),
    );
    expect(prisma.stockPriceHint.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stockProductId: 5n },
        update: expect.objectContaining({ quantity: 500, unitPrice: '2.354', leadTimeDays: 2 }),
      }),
    );
  });

  it('clears the hint of an RFQ-only, inactive or unpriceable stock product — never an estimate', async () => {
    for (const row of [
      stock({ productType: { status: 'active', quoteMode: 'rfq', calculatorKey: 'standard_product' } }),
      stock({ status: 'inactive' }),
    ]) {
      const { s, prisma, price } = setup([row], null);
      await expect(s.refreshStock()).resolves.toEqual({ priced: 0, cleared: 1 });
      expect(price).not.toHaveBeenCalled();
      expect(prisma.stockPriceHint.upsert).not.toHaveBeenCalled();
    }
    const { s } = setup([stock()], { quantity: 500, instant: false, unitPrice: null, leadTimeDays: null });
    await expect(s.refreshStock()).resolves.toEqual({ priced: 0, cleared: 1 });
  });

  it('lists a stock hint with its quantity basis and the ex-VAT figure', async () => {
    const prisma = {
      catalogProduct: { findMany: jest.fn().mockResolvedValue([]) },
      stockProduct: {
        findMany: jest.fn().mockResolvedValue([
          {
            sku: 'PKO-BTL-0250',
            productType: { code: 'standard_product' },
            priceHint: {
              quantity: 500,
              unitPrice: '2.354',
              leadTimeDays: null,
              computedAt: new Date('2026-10-28T02:00:00Z'),
            },
          },
          { sku: 'PKO-CUP-0001', productType: { code: 'standard_product' }, priceHint: null },
        ]),
      },
      taxRateVersion: { findFirst: jest.fn().mockResolvedValue({ ratePct: '7' }) },
    };
    const s = new PriceHintsService(prisma as never, {} as never, {} as never);
    const [priced, none] = await s.list({ skus: ['PKO-BTL-0250', 'PKO-CUP-0001'] });
    expect(priced).toMatchObject({
      key: 'PKO-BTL-0250',
      kind: 'stock_product',
      startingFromPerPiece: '2.36',
      startingFromPerPieceExVat: '2.21',
      basis: { quantity: 500, includesVat: true, includesDelivery: false },
    });
    expect(none).toMatchObject({ startingFromPerPiece: null, startingFromPerPieceExVat: null, basis: null });
  });
});
