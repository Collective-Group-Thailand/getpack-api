import { DomainException } from '@common/errors/domain.exception';

import { type CalculateQuoteBatchDto } from './quote-batch.dto';
import { BATCH_CONCURRENCY, QuoteBatchService } from './quote-batch.service';
import { type StorePricingService } from './store-pricing.service';

/** `store.quotes.calculateBatch`: order, per-variant problems, limits, bounded concurrency. Obviously fake data. */
const variant = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  configuration: { w: 60, quantities: [1000], ...extra },
});
const body = (variants: ReturnType<typeof variant>[], quantities?: number[]): CalculateQuoteBatchDto =>
  ({ productTypeCode: 'folding_carton', variants, ...(quantities && { quantities }) });

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
});
