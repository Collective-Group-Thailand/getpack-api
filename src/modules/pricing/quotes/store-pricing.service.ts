import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import { type CalculatorKey } from '@generated/prisma/client';
import { specLinesFor } from '@modules/quotes/line-summary';
import { type SpecLineDto } from '@modules/quotes/line-summary.dto';
import { type SpecLabel, specLabel } from '@modules/quotes/spec-label';
import { SpecsService } from '@modules/specs/specs.service';
import { Injectable } from '@nestjs/common';

import { assertStoreRules, validateConfiguration } from './configurations';
import { type QuoteCalculationDto } from './quote.dto';
import { type QuoteContext, QuoteEngineService, type QuoteView } from './quote-engine.service';
import { targetGap, targetString } from './target-price';

/** What a store calculation priced and how it reads (D-441). */
export interface DescribedSpec {
  specs: SpecLineDto[];
  label: SpecLabel;
}

export interface StorePriced {
  /** The configuration as validated (defaults applied) — what the engine priced. */
  configuration: Record<string, unknown>;
  view: QuoteView;
  calculation: QuoteCalculationDto;
}

/** The store's answer of a priced configuration: no factory, buy price or margin (D-044, D-050). */
export const storeView = (
  view: QuoteView,
  described: DescribedSpec,
  target?: string,
): QuoteCalculationDto => ({
  calculatorVersion: view.calculatorVersion,
  calculationId: view.calculateLog?.publicId ?? null,
  steps: view.steps.map(({ internal: _internal, ...step }) => step),
  dimensions: view.dimensions,
  // D-247: the gap of each instant quantity against the customer's target (nothing is stored).
  target: target
    ? {
        targetPricePerUnit: targetString(target)!,
        steps: view.steps
          .filter((s) => s.instant && s.unitPrice !== null)
          .map((s) => ({ quantity: s.quantity, ...targetGap(s.unitPrice, target)! })),
      }
    : null,
  specs: described.specs,
  specLabel: described.label,
});

/** The engine context of a store calculation: a print combination not offered routes every quantity to RFQ (B-API-6). */
export const storeQuoteContext = (
  ctx: Omit<QuoteContext, 'channel'>,
  printErrorCount: number,
): QuoteContext => ({
  ...ctx,
  channel: 'web',
  ...(printErrorCount > 0 && { instantBlock: 'rfq_required' as const }),
});

/**
 * The one store pricing path (D-441, GLOBAL-RULES §5): validate the configuration as a store request (DTO and store
 * rules), price it with the quote engine on the web channel and describe it with the one spec-line helper. The
 * configurator (`store.quotes.calculate`), the homepage hero, the Studio dock and the "starting from" prices of
 * cards, category pages, the product page and its JSON-LD all go through here — so the same spec has the same
 * price and the same words everywhere.
 */
@Injectable()
export class StorePricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: QuoteEngineService,
    private readonly specs: SpecsService,
  ) {}

  /** The calculator of an active, instant product type — or `pricing.not_instant` (shared by every store price request). */
  async calculatorKeyOf(productTypeCode: string): Promise<CalculatorKey> {
    const type = await this.prisma.productType.findFirst({
      where: { code: productTypeCode, status: 'active' },
    });
    if (
      !type?.calculatorKey ||
      type.quoteMode !== 'instant' ||
      !this.engine.hasCalculator(type.calculatorKey)
    )
      throw new DomainException('pricing.not_instant');
    return type.calculatorKey;
  }

  async price(
    calculatorKey: CalculatorKey,
    configuration: unknown,
    ctx: Omit<QuoteContext, 'channel'>,
    target?: string,
  ): Promise<StorePriced> {
    const validated = await validateConfiguration(calculatorKey, configuration, { staff: false });
    // B-API-6: a print combination the engine cannot price (or the product does not offer) is not an error here —
    // every quantity answers `instant: false` with `reason: rfq_required`, the quote path.
    const { printErrors } = await assertStoreRules(this.prisma, calculatorKey, validated, {
      printCombination: 'collect',
    });
    const view = await this.engine.price(
      calculatorKey,
      validated,
      storeQuoteContext(ctx, printErrors.length),
    );
    const described = await this.lines(calculatorKey, validated, view.dimensions);
    return { configuration: validated, view, calculation: storeView(view, described, target) };
  }

  /** The spec lines and one-string label of a configuration, without pricing it (same words as `price`). */
  async describe(
    calculatorKey: CalculatorKey,
    configuration: Record<string, unknown>,
  ): Promise<DescribedSpec> {
    const { dimensions } = await this.specs.measureConfiguration(this.prisma, calculatorKey, configuration);
    return this.lines(calculatorKey, configuration, dimensions);
  }

  private async lines(
    calculatorKey: CalculatorKey,
    configuration: Record<string, unknown>,
    dimensions: QuoteView['dimensions'],
  ): Promise<DescribedSpec> {
    const specs = (await specLinesFor(this.prisma, calculatorKey, configuration, dimensions)) ?? [];
    return { specs, label: specLabel(specs, calculatorKey) };
  }
}
