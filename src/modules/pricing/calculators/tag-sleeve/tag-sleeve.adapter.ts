import { type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { type ShipmentPart } from '@modules/shipping/shipping-quote.service';
import { Injectable, type OnModuleInit } from '@nestjs/common';

import { type CalculationLogInput, type CalculatorAdapter, type PricedOption } from '../adapter';
import { CalculatorRegistry } from '../calculator';
import {
  foldingShipmentParts,
  type LoadedFoldingOption,
  pricedOptions,
  type ResolvedFoldingQuote,
} from '../folding/folding.adapter';
import {
  type FoldingConfiguration,
  type FoldingPartConfiguration,
  FoldingSnapshotLoader,
} from '../folding/folding-snapshot.loader';
import { TAG_SLEEVE_CALCULATOR_VERSION, tagSleeveCalculator } from './tag-sleeve-calculator';

/** A tag & sleeve configuration as the API receives it: one flat blank, catalogue public ids, millimetres. */
export type TagSleeveConfiguration = Omit<FoldingPartConfiguration, 'subPatternId' | 'diecutTypeId'> & {
  patternId: string;
  catalogProductId?: string;
  w: number;
  l: number;
  materialId: string;
  difficultyLevelId: string;
  quantities: readonly number[];
  /** Legacy always die-cuts a tag (`diecut: 1`, `cs-v2.vue:1605-1666`). */
  diecutTypeId: string;
  design?: { graphic: boolean };
};

/** The folding configuration legacy builds for a tag (`CStoFactoryFolding:689-719`): d = 0, one part. */
export function toFoldingConfiguration(cfg: TagSleeveConfiguration): FoldingConfiguration {
  return {
    patternId: cfg.patternId,
    catalogProductId: cfg.catalogProductId,
    w: cfg.w,
    l: cfg.l,
    d: 0,
    materialId: cfg.materialId,
    difficultyLevelId: cfg.difficultyLevelId,
    quantities: cfg.quantities,
    parts: [
      {
        printFront: cfg.printFront,
        printBack: cfg.printBack,
        finish1FrontId: cfg.finish1FrontId,
        finish1BackId: cfg.finish1BackId,
        finish2: cfg.finish2,
        diecutTypeId: cfg.diecutTypeId,
        assemblies: cfg.assemblies,
      },
    ],
    design: { graphic: cfg.design?.graphic ?? false, structure: false },
  };
}

/** The tag & sleeve calculator behind the quote engine (U-B6 tag & sleeve): the folding loader and engine A. */
@Injectable()
export class TagSleeveQuoteAdapter
  implements
    CalculatorAdapter<TagSleeveConfiguration, ResolvedFoldingQuote, LoadedFoldingOption>,
    OnModuleInit
{
  readonly key = 'tag_sleeve' as const;
  readonly version = TAG_SLEEVE_CALCULATOR_VERSION;

  constructor(
    private readonly loader: FoldingSnapshotLoader,
    private readonly registry: CalculatorRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async resolve(cfg: TagSleeveConfiguration, db: Tx): Promise<ResolvedFoldingQuote> {
    const resolved = await this.loader.resolve(toFoldingConfiguration(cfg), db, 'tag_sleeve');
    return {
      ...resolved,
      quantities: cfg.quantities,
      design: { graphic: cfg.design?.graphic ?? false, structure: false },
    };
  }

  async options(
    factory: { id: bigint; publicId: string },
    priceListVersionId: bigint,
    resolved: ResolvedFoldingQuote,
    at: Date,
    db: Tx,
  ): Promise<LoadedFoldingOption[]> {
    const loaded = await this.loader.options(factory, priceListVersionId, resolved, at, db);
    return loaded.map((l) => ({ ...l, optionKey: l.option.optionKey, factoryId: l.option.factoryId }));
  }

  calculate(
    resolved: ResolvedFoldingQuote,
    loaded: readonly LoadedFoldingOption[],
    opts: { withDesign: boolean },
  ): PricedOption[] {
    const result = tagSleeveCalculator.calculate(
      {
        quantities: resolved.quantities,
        parts: resolved.parts,
        design: opts.withDesign ? resolved.design : { graphic: false, structure: false },
      },
      { options: loaded.map((l) => l.option) },
    );
    return pricedOptions(result);
  }

  shipmentParts(resolved: ResolvedFoldingQuote): ShipmentPart[] {
    return foldingShipmentParts(resolved);
  }

  logInput(cfg: TagSleeveConfiguration): CalculationLogInput {
    return {
      quantities: [...cfg.quantities],
      lengthMm: cfg.l,
      widthMm: cfg.w,
      heightMm: null,
      input: JSON.parse(JSON.stringify(cfg)) as Prisma.InputJsonValue,
      inputSchemaVersion: 1,
    };
  }

  withQuantities(cfg: TagSleeveConfiguration, quantities: readonly number[]): TagSleeveConfiguration {
    return { ...cfg, quantities };
  }
}
