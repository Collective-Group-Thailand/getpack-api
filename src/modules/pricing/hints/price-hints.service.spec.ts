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
