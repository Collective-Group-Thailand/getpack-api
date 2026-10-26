import { DomainException } from '@common/errors/domain.exception';

import { type CalculateQuoteBatchDto } from './quote-batch.dto';
import { BATCH_CONCURRENCY, QuoteBatchService } from './quote-batch.service';
import { type StorePricingService } from './store-pricing.service';

/** `store.quotes.calculateBatch`: order, per-variant problems, limits, bounded concurrency. Obviously fake data. */
const variant = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  configuration: { w: 60, quantities: [1000], ...extra },
});
const body = (variants: ReturnType<typeof variant>[], quantities?: number[]): CalculateQuoteBatchDto => ({
  productTypeCode: 'folding_carton',
  variants,
  ...(quantities && { quantities }),
});

const setup = (price: jest.Mock) => {
  const pricing = {
    calculatorKeyOf: jest.fn().mockResolvedValue('folding'),
    price,
  } as unknown as StorePricingService;
  const i18n = { translate: jest.fn((key: string) => `t:${key}`) };
  return { service: new QuoteBatchService(pricing, i18n as never), pricing, i18n };
};
const priced = (key: string) => ({ calculation: { calculatorVersion: key, steps: [] } });

describe('QuoteBatchService', () => {
  it('prices every variant through StorePricingService.price and keeps the request order', async () => {
    const price = jest.fn(async (_k: string, cfg: { w: number }) => {
      await new Promise((r) => setTimeout(r, 10 - cfg.w));
      return priced(`w${cfg.w}`);
    });
    const { service, pricing } = setup(price);
    const out = await service.calculate(
      undefined,
      body([variant('a', { w: 1 }), variant('b', { w: 9 }), variant('c', { w: 5 })]),
      'en',
    );
    expect(out.results.map((r) => r.key)).toEqual(['a', 'b', 'c']);
    expect(out.results.map((r) => r.calculation?.calculatorVersion)).toEqual(['w1', 'w9', 'w5']);
    expect(out.results.every((r) => r.problem === null)).toBe(true);
    expect(pricing.calculatorKeyOf).toHaveBeenCalledWith('folding_carton');
    expect(price).toHaveBeenCalledTimes(3);
  });

  it('turns a variant that throws into a problem entry without failing the batch', async () => {
    const price = jest.fn((_k: string, cfg: { w: number }) => {
      if (cfg.w === 2) throw new DomainException('pricing.print_combination_invalid');
      if (cfg.w === 3) throw new Error('boom');
      return priced('ok');
    });
    const { service } = setup(price);
    const out = await service.calculate(
      undefined,
      body([variant('a', { w: 1 }), variant('b', { w: 2 }), variant('c', { w: 3 })]),
      'th',
    );
    expect(out.results[0]).toMatchObject({ key: 'a', problem: null });
    expect(out.results[1]).toEqual({
      key: 'b',
      calculation: null,
      deltas: null,
      problem: {
        code: 'pricing.print_combination_invalid',
        message: 't:errors.pricing.print_combination_invalid.detail',
      },
    });
    expect(out.results[2]).toMatchObject({
      key: 'c',
      calculation: null,
      problem: { code: 'internal.unexpected' },
    });
  });

  it('replaces quantities of every variant when given, and leaves them otherwise', async () => {
    const price = jest.fn<Promise<unknown>, [string, unknown]>().mockResolvedValue(priced('ok'));
    const { service } = setup(price);
    await service.calculate(undefined, body([variant('a')], [500, 2000]), 'en');
    expect(price.mock.calls[0]![1]).toMatchObject({ quantities: [500, 2000] });
    await service.calculate(undefined, body([variant('a')]), 'en');
    expect(price.mock.calls[1]![1]).toMatchObject({ quantities: [1000] });
  });

  it('refuses more than 24 variants and duplicate keys with validation.failed, pricing nothing', async () => {
    const price = jest.fn();
    const { service } = setup(price);
    const many = Array.from({ length: 25 }, (_, i) => variant(`k${i}`));
    await expect(service.calculate(undefined, body(many), 'en')).rejects.toMatchObject({
      code: 'validation.failed',
    });
    await expect(
      service.calculate(undefined, body([variant('x'), variant('x')]), 'en'),
    ).rejects.toMatchObject({
      code: 'validation.failed',
      errors: [expect.objectContaining({ path: 'variants[1].key' })],
    });
    expect(price).not.toHaveBeenCalled();
  });

  it('fails the whole request when the product type has no instant price', async () => {
    const price = jest.fn();
    const { service, pricing } = setup(price);
    (pricing.calculatorKeyOf as jest.Mock).mockRejectedValue(new DomainException('pricing.not_instant'));
    await expect(service.calculate(undefined, body([variant('a')]), 'en')).rejects.toMatchObject({
      code: 'pricing.not_instant',
    });
  });

  it('prices at most four variants at a time', async () => {
    let running = 0;
    let peak = 0;
    const price = jest.fn(async () => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return priced('ok');
    });
    const { service } = setup(price);
    await service.calculate(undefined, body(Array.from({ length: 24 }, (_, i) => variant(`k${i}`))), 'en');
    expect(price).toHaveBeenCalledTimes(24);
    expect(peak).toBeLessThanOrEqual(BATCH_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
  });

  describe('baselineKey deltas', () => {
    const step = (quantity: number, unit: string | null, total: string | null, instant = true) => ({
      quantity,
      instant,
      unitPrice: unit,
      productAmount: total,
    });
    const prices: Record<number, ReturnType<typeof step>[]> = {
      1: [step(500, '2.00', '1000.00'), step(1000, '1.50', '1500.00')],
      2: [step(500, '2.86', '1430.00'), step(1000, '1.49', '1490.00', true)],
      3: [step(500, null, null, false)],
      4: [step(1000, '1.20', '1200.00')],
    };
    const run = (variants: ReturnType<typeof variant>[], baselineKey?: string) => {
      const price = jest.fn((_k: string, cfg: { w: number }) => ({
        calculation: { calculatorVersion: 'x', steps: prices[cfg.w] },
      }));
      return setup(price).service.calculate(undefined, { ...body(variants), baselineKey }, 'en');
    };

    it('is null without baselineKey, zero for the baseline, signed for the others', async () => {
      const plain = await run([variant('a', { w: 1 })]);
      expect(plain.results[0]!.deltas).toBeNull();
      const out = await run([variant('a', { w: 1 }), variant('b', { w: 2 })], 'a');
      expect(out.results[0]!.deltas).toEqual([
        { quantity: 500, unitPriceDelta: '0.00', totalDelta: '0.00' },
        { quantity: 1000, unitPriceDelta: '0.00', totalDelta: '0.00' },
      ]);
      expect(out.results[1]!.deltas).toEqual([
        { quantity: 500, unitPriceDelta: '0.86', totalDelta: '430.00' },
        { quantity: 1000, unitPriceDelta: '-0.01', totalDelta: '-10.00' },
      ]);
    });

    it('is null for non-instant sides, missing quantities and failed variants', async () => {
      const out = await run([variant('a', { w: 1 }), variant('c', { w: 3 }), variant('d', { w: 4 })], 'a');
      expect(out.results[1]!.deltas).toEqual([{ quantity: 500, unitPriceDelta: null, totalDelta: null }]);
      expect(out.results[2]!.deltas).toEqual([
        { quantity: 1000, unitPriceDelta: '-0.30', totalDelta: '-300.00' },
      ]);
      const failing = setup(jest.fn().mockRejectedValue(new DomainException('validation.failed')));
      const r = await failing.service.calculate(
        undefined,
        { ...body([variant('a')]), baselineKey: 'a' },
        'en',
      );
      expect(r.results[0]).toMatchObject({ calculation: null, deltas: null });
    });

    it('refuses a baselineKey that is not a variant key', async () => {
      await expect(run([variant('a', { w: 1 })], 'zzz')).rejects.toMatchObject({
        code: 'validation.failed',
        errors: [expect.objectContaining({ path: 'baselineKey' })],
      });
    });
  });
});
