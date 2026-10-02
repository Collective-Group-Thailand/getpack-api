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
import { LABEL_CALCULATOR_VERSION, labelCalculator } from './label-calculator';
import {
  type LabelConfiguration,
  LabelSnapshotLoader,
  type LoadedLabelOption,
  type ResolvedLabel,
} from './label-snapshot.loader';

export type ResolvedLabelQuote = ResolvedLabel & ResolvedBase & { design: { graphic: boolean } };

/** The label calculator behind the quote engine (U-B6 label): loader + pure `CSCalculate` / `calculate` port. */
@Injectable()
export class LabelQuoteAdapter
  implements CalculatorAdapter<LabelConfiguration, ResolvedLabelQuote, LoadedLabelOption>, OnModuleInit
{
  readonly key = 'label' as const;
  readonly version = LABEL_CALCULATOR_VERSION;

  constructor(
    private readonly loader: LabelSnapshotLoader,
    private readonly registry: CalculatorRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async resolve(cfg: LabelConfiguration, db: Tx): Promise<ResolvedLabelQuote> {
    const resolved = await this.loader.resolve(cfg, db);
    return { ...resolved, quantities: cfg.quantities, design: { graphic: cfg.design?.graphic ?? false } };
  }

  options(
    factory: { id: bigint; publicId: string },
    priceListVersionId: bigint,
    resolved: ResolvedLabelQuote,
    at: Date,
    db: Tx,
  ): Promise<LoadedLabelOption[]> {
    return this.loader.options(factory, priceListVersionId, resolved, at, db);
  }

  calculate(
    resolved: ResolvedLabelQuote,
    loaded: readonly LoadedLabelOption[],
    opts: { withDesign: boolean },
  ): PricedOption[] {
    const result = labelCalculator.calculate(
      {
        quantities: resolved.quantities,
        size: resolved.size,
        printFront: resolved.printFront,
        printBack: resolved.printBack,
        finishFrontId: resolved.finishFrontId,
        finishBackId: resolved.finishBackId,
        diecutTypeId: resolved.diecutTypeId,
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
              // Labels have no minimum production run: the run is the quantity.
              productionRun: s.qty,
              buyPrice: s.buyPrice,
              marginPct: s.marginPct,
              leadTimeDays: s.leadTimeDays,
              unitPrice: s.forSale.perPcsWithDelivery,
              productAmount: s.forSale.sum,
              designFee: s.designFee,
              structureDesignFee: 0,
              toolingAmount: 0,
              vatAmount: s.forSale.vatPrice,
              total: s.total,
              parts: [
                {
                  partKey: 'main',
                  buyPrice: s.buyPrice,
                  totalCost: s.cost.total,
                  layoutAmount: s.layout.layoutAmount,
                  // Press sheets for a sheet job; for a roll, the metres of web run.
                  sheets: s.layout.waste ? s.layout.waste.total : Math.ceil(s.layout.areaL / 1000),
                  layoutStandard: s.layout.standard,
                  blankAreaSqm: (resolved.size.w * resolved.size.l) / 1000000,
                },
              ],
            }
          : null,
      ),
    }));
  }

  /**
   * The labels to ship. The packer needs to know a roll job, which only the priced option decides; the shipment is
   * packed as sheets of labels (legacy's sheet branch), the conservative (larger) carton count for a quote.
   */
  shipmentParts(resolved: ResolvedLabelQuote): ShipmentPart[] {
    return [
      { kind: 'label', w: resolved.size.w, l: resolved.size.l, gsm: resolved.materialGsm, roll: false },
    ];
  }

  envelopeFacts(resolved: ResolvedLabelQuote, cfg: LabelConfiguration): ConfigurationFacts {
    return {
      patternId: null,
      materialIds: [resolved.materialId],
      size: { w: cfg.w, l: cfg.l, d: null },
      catalogProductId: resolved.catalogProductId,
      stockProductId: null,
    };
  }

  logInput(cfg: LabelConfiguration): CalculationLogInput {
    return {
      quantities: [...cfg.quantities],
      lengthMm: cfg.l,
      widthMm: cfg.w,
      heightMm: null,
      input: JSON.parse(JSON.stringify(cfg)) as Prisma.InputJsonValue,
      inputSchemaVersion: 1,
    };
  }

  withQuantities(cfg: LabelConfiguration, quantities: readonly number[]): LabelConfiguration {
    return { ...cfg, quantities };
  }
}
