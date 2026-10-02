import { type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { type ShipmentPart } from '@modules/shipping/shipping-quote.service';
import { Injectable, type OnModuleInit } from '@nestjs/common';

import {
  type CalculationLogInput,
  type CalculatorAdapter,
  type ConfigurationFacts,
  type PricedOption,
  type ResolvedBase,
} from '../adapter';
import { CalculatorRegistry } from '../calculator';
import {
  STANDARD_PRODUCT_CALCULATOR_VERSION,
  standardProductCalculator,
} from './standard-product-calculator';
import {
  type LoadedStandardProductOption,
  type ResolvedStandardProduct,
  type StandardProductConfiguration,
  StandardProductSnapshotLoader,
} from './standard-product-snapshot.loader';

export type ResolvedStandardProductQuote = ResolvedStandardProduct &
  ResolvedBase & { design: { graphic: boolean } };

/** The standard-product calculator behind the quote engine (U-B6 standard product): stock product price tiers. */
@Injectable()
export class StandardProductQuoteAdapter
  implements
    CalculatorAdapter<
      StandardProductConfiguration,
      ResolvedStandardProductQuote,
      LoadedStandardProductOption
    >,
    OnModuleInit
{
  readonly key = 'standard_product' as const;
  readonly version = STANDARD_PRODUCT_CALCULATOR_VERSION;

  constructor(
    private readonly loader: StandardProductSnapshotLoader,
    private readonly registry: CalculatorRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async resolve(cfg: StandardProductConfiguration, db: Tx): Promise<ResolvedStandardProductQuote> {
    const resolved = await this.loader.resolve(cfg, db);
    return { ...resolved, quantities: cfg.quantities, design: { graphic: cfg.design?.graphic ?? false } };
  }

  options(
    factory: { id: bigint; publicId: string },
    priceListVersionId: bigint,
    resolved: ResolvedStandardProductQuote,
    at: Date,
    db: Tx,
  ): Promise<LoadedStandardProductOption[]> {
    return this.loader.options(factory, priceListVersionId, resolved, at, db);
  }

  calculate(
    resolved: ResolvedStandardProductQuote,
    loaded: readonly LoadedStandardProductOption[],
    opts: { withDesign: boolean },
  ): PricedOption[] {
    const result = standardProductCalculator.calculate(
      {
        quantities: resolved.quantities,
        minOrderQty: resolved.minOrderQty,
        design: { graphic: opts.withDesign && resolved.design.graphic },
      },
      { options: loaded.map((l) => l.option) },
    );
    return result.options.map((o) => ({
      optionKey: o.optionKey,
      factoryId: o.factoryId,
      printTypeId: o.printTypeId,
      error: o.error,
      steps: o.steps.map((s) =>
        s
          ? {
              qty: s.qty,
              productionRun: s.qty,
              buyPrice: s.buyPrice,
              marginPct: s.marginPct,
              leadTimeDays: s.leadTimeDays,
              unitPrice: s.perPcs,
              productAmount: s.sum,
              designFee: s.designFee,
              structureDesignFee: 0,
              toolingAmount: 0,
              vatAmount: s.vatPrice,
              total: s.total,
              parts: [
                {
                  partKey: 'main',
                  buyPrice: s.buyPrice,
                  totalCost: s.buyPrice,
                  layoutAmount: 1,
                  // Ready-made goods: capacity in pieces.
                  sheets: s.qty,
                  layoutStandard: true,
                  blankAreaSqm: 0,
                },
              ],
            }
          : null,
      ),
    }));
  }

  shipmentParts(resolved: ResolvedStandardProductQuote): ShipmentPart[] {
    return [{ kind: 'stock', unit: resolved.unit, weightG: resolved.weightG ?? 0 }];
  }

  envelopeFacts(
    resolved: ResolvedStandardProductQuote,
    _cfg: StandardProductConfiguration,
  ): ConfigurationFacts {
    return {
      patternId: null,
      materialIds: [],
      size: null,
      catalogProductId: null,
      stockProductId: resolved.stockProductId,
    };
  }

  logInput(cfg: StandardProductConfiguration): CalculationLogInput {
    return {
      quantities: [...cfg.quantities],
      lengthMm: null,
      widthMm: null,
      heightMm: null,
      input: JSON.parse(JSON.stringify(cfg)) as Prisma.InputJsonValue,
      inputSchemaVersion: 1,
    };
  }

  withQuantities(
    cfg: StandardProductConfiguration,
    quantities: readonly number[],
  ): StandardProductConfiguration {
    return { ...cfg, quantities };
  }
}
