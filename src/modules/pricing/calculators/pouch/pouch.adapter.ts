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
import { POUCH_CALCULATOR_VERSION, pouchCalculator } from './pouch-calculator';
import {
  type LoadedPouchOption,
  type PouchConfiguration,
  PouchSnapshotLoader,
  type ResolvedPouch,
} from './pouch-snapshot.loader';

export type ResolvedPouchQuote = ResolvedPouch & ResolvedBase & { design: { graphic: boolean } };

/** The pouch calculator behind the quote engine (U-B6 pouch): loader + pure `fromCS` / `calculate` port. */
@Injectable()
export class PouchQuoteAdapter
  implements CalculatorAdapter<PouchConfiguration, ResolvedPouchQuote, LoadedPouchOption>, OnModuleInit
{
  readonly key = 'pouch' as const;
  readonly version = POUCH_CALCULATOR_VERSION;

  constructor(
    private readonly loader: PouchSnapshotLoader,
    private readonly registry: CalculatorRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async resolve(cfg: PouchConfiguration, db: Tx): Promise<ResolvedPouchQuote> {
    const resolved = await this.loader.resolve(cfg, db);
    return { ...resolved, quantities: cfg.quantities, design: { graphic: cfg.design?.graphic ?? false } };
  }

  options(
    factory: { id: bigint; publicId: string },
    priceListVersionId: bigint,
    resolved: ResolvedPouchQuote,
    at: Date,
    db: Tx,
  ): Promise<LoadedPouchOption[]> {
    return this.loader.options(factory, priceListVersionId, resolved, at, db);
  }

  calculate(
    resolved: ResolvedPouchQuote,
    loaded: readonly LoadedPouchOption[],
    opts: { withDesign: boolean },
  ): PricedOption[] {
    const result = pouchCalculator.calculate(
      {
        quantities: resolved.quantities,
        patternId: resolved.patternId.toString(),
        formula: resolved.formula,
        size: resolved.size,
        materialId: resolved.materialId.toString(),
        printColourId: resolved.printColourId,
        optionIds: resolved.optionIds,
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
              // A quantity below the factory's minimum is refused, never raised: the run is the quantity.
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
                  totalCost: s.costPerPcs * s.qty,
                  // One pouch across the web; the run in metres of film (capacity).
                  layoutAmount: 1,
                  sheets: Math.ceil((s.pow * s.qty) / 1000),
                  layoutStandard: true,
                  blankAreaSqm: (s.dimension.dl * s.dimension.dw) / 1000000,
                },
              ],
            }
          : null,
      ),
    }));
  }

  shipmentParts(): ShipmentPart[] {
    return [{ kind: 'pouch' }];
  }

  envelopeFacts(resolved: ResolvedPouchQuote, _cfg: PouchConfiguration): ConfigurationFacts {
    // A pouch is matched on its width and length; gussets are not an envelope dimension.
    return {
      patternId: resolved.patternId,
      materialIds: [resolved.materialId],
      size: { w: resolved.size.w, l: resolved.size.l, d: null },
      catalogProductId: resolved.catalogProductId,
      stockProductId: null,
    };
  }

  logInput(cfg: PouchConfiguration): CalculationLogInput {
    return {
      quantities: [...cfg.quantities],
      lengthMm: cfg.l,
      widthMm: cfg.w,
      heightMm: null,
      input: JSON.parse(JSON.stringify(cfg)) as Prisma.InputJsonValue,
      inputSchemaVersion: 1,
    };
  }

  withQuantities(cfg: PouchConfiguration, quantities: readonly number[]): PouchConfiguration {
    return { ...cfg, quantities };
  }
}
