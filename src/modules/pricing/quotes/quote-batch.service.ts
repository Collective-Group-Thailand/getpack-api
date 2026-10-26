import { type Actor } from '@common/context/actor';
import { RequestContext } from '@common/context/request-context';
import { DomainException } from '@common/errors/domain.exception';
import { type ErrorCode } from '@common/errors/error-codes';
import { formatMoney, MoneyDecimal } from '@common/money/money';
import { Injectable, Logger } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { type QuoteCalculationDto } from './quote.dto';
import {
  type CalculateQuoteBatchDto,
  MAX_BATCH_VARIANTS,
  type QuoteBatchDeltaDto,
  type QuoteBatchProblemDto,
  type QuoteBatchResultDto,
} from './quote-batch.dto';
import { StorePricingService } from './store-pricing.service';

/** Variants priced at once: small, to protect the database (every priced variant writes one calculate log). */
export const BATCH_CONCURRENCY = 4;

const delta = (a: string | null, b: string | null): string | null =>
  a === null || b === null ? null : formatMoney(new MoneyDecimal(a).sub(new MoneyDecimal(b)));

/** Per quantity of `calc`: its instant unit price / pieces amount minus the baseline's (decimal maths, no floats). */
const deltasAgainst = (calc: QuoteCalculationDto, base: QuoteCalculationDto | null): QuoteBatchDeltaDto[] =>
  calc.steps.map((step) => {
    const other = base?.steps.find((s) => s.quantity === step.quantity);
    if (!step.instant || !other?.instant)
      return { quantity: step.quantity, unitPriceDelta: null, totalDelta: null };
    return {
      quantity: step.quantity,
      unitPriceDelta: delta(step.unitPrice, other.unitPrice),
      totalDelta: delta(step.productAmount, other.productAmount),
    };
  });

/**
 * `store.quotes.calculateBatch`: prices many option variants of one product type in one request. Each variant goes
 * through the one store path (`StorePricingService.price`, D-441, GLOBAL-RULES §5) exactly as `store.quotes.calculate`
 * does; a variant that fails becomes a `problem` entry, never a failed batch.
 */
@Injectable()
export class QuoteBatchService {
  private readonly logger = new Logger(QuoteBatchService.name);

  constructor(
    private readonly storePricing: StorePricingService,
    private readonly i18n: I18nService,
  ) {}

  async calculate(
    actor: Actor | undefined,
    body: CalculateQuoteBatchDto,
    lang: string,
  ): Promise<{ results: QuoteBatchResultDto[] }> {
    this.assertShape(body);
    // Same gate as `calculate`: an inactive / non-instant product type fails the whole request (not a variant).
    const calculatorKey = await this.storePricing.calculatorKeyOf(body.productTypeCode);
    const ctx = {
      actorUserId: actor?.type === 'user' ? actor.userId : undefined,
      ip: RequestContext.current()?.ip,
    };
    const results = new Array<QuoteBatchResultDto>(body.variants.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < body.variants.length) {
        const index = next++;
        const variant = body.variants[index]!;
        const configuration = body.quantities
          ? { ...variant.configuration, quantities: body.quantities }
          : variant.configuration;
        try {
          const priced = await this.storePricing.price(calculatorKey, configuration, ctx);
          results[index] = { key: variant.key, calculation: priced.calculation, deltas: null, problem: null };
        } catch (error) {
          results[index] = {
            key: variant.key,
            calculation: null,
            deltas: null,
            problem: this.problem(error, lang),
          };
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(BATCH_CONCURRENCY, body.variants.length) }, () => worker()),
    );
    if (body.baselineKey !== undefined) {
      const base = results.find((r) => r.key === body.baselineKey)?.calculation ?? null;
      for (const r of results) r.deltas = r.calculation ? deltasAgainst(r.calculation, base) : null;
    }
    return { results };
  }

  private assertShape(body: CalculateQuoteBatchDto): void {
    const fail = (path: string, code: string, message: string): never => {
      throw new DomainException('validation.failed', { errors: [{ path, code, message }] });
    };
    if (body.variants.length < 1 || body.variants.length > MAX_BATCH_VARIANTS)
      fail('variants', 'arraySize', `variants must hold 1 to ${MAX_BATCH_VARIANTS} entries`);
    if (body.baselineKey !== undefined && !body.variants.some((v) => v.key === body.baselineKey))
      fail('baselineKey', 'baseline_unknown', 'baselineKey must equal one of the variant keys');
    const seen = new Set<string>();
    body.variants.forEach((v, i) => {
      if (seen.has(v.key)) fail(`variants[${i}].key`, 'unique', 'variant keys must be unique');
      seen.add(v.key);
    });
  }

  private problem(error: unknown, lang: string): QuoteBatchProblemDto {
    const code: ErrorCode = error instanceof DomainException ? error.code : 'internal.unexpected';
    if (!(error instanceof DomainException)) this.logger.warn({ err: error }, 'batch variant failed');
    const params = error instanceof DomainException ? error.params : {};
    const message = String(this.i18n.translate(`errors.${code}.detail`, { lang, args: params }));
    return { code, message };
  }
}
