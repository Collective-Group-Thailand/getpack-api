import { type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { type ShipmentPart } from '@modules/shipping/shipping-quote.service';
import { Injectable, type OnModuleInit } from '@nestjs/common';

import {
  type CalculationLogInput,
  type CalculatorAdapter,
  type PricedOption,
  type ResolvedBase,
} from '../adapter';
import { CalculatorRegistry } from '../calculator';
import { FOLDING_CALCULATOR_VERSION, foldingCalculator } from './folding-calculator';
import {
  type FoldingConfiguration,
  FoldingSnapshotLoader,
  type LoadedOption,
  type ResolvedFolding,
} from './folding-snapshot.loader';

export type ResolvedFoldingQuote = ResolvedFolding &
  ResolvedBase & { design: { graphic: boolean; structure: boolean } };
export type LoadedFoldingOption = LoadedOption & {
  optionKey: string;
  factoryId: string;
};

/** The folding calculator behind the quote engine (B2.3): loader + pure `calculate_cs` port. */
@Injectable()
export class FoldingQuoteAdapter
  implements CalculatorAdapter<FoldingConfiguration, ResolvedFoldingQuote, LoadedFoldingOption>, OnModuleInit
{
  readonly key = 'folding' as const;
  readonly version = FOLDING_CALCULATOR_VERSION;

  constructor(
    private readonly loader: FoldingSnapshotLoader,
    private readonly registry: CalculatorRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async resolve(cfg: FoldingConfiguration, db: Tx): Promise<ResolvedFoldingQuote> {
    const resolved = await this.loader.resolve(cfg, db);
    return {
      ...resolved,
      quantities: cfg.quantities,
      design: cfg.design ?? { graphic: false, structure: false },
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
    const result = foldingCalculator.calculate(
      {
        quantities: resolved.quantities,
        parts: resolved.parts,
        design: opts.withDesign ? resolved.design : { graphic: false, structure: false },
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
              productionRun: s.boxAmount,
              buyPrice: s.buyPrice,
              marginPct: s.marginPct,
              leadTimeDays: s.leadTimeDays,
              unitPrice: s.perPcsWithDelivery,
              productAmount: s.sum,
              designFee: s.designFee,
              structureDesignFee: s.structureDesignFee,
              vatAmount: s.vatPrice,
              total: s.total,
              parts: s.parts.map((p) => ({
                partKey: p.partKey,
                buyPrice: p.buyPrice,
                totalCost: p.layout.totalCost,
                layoutAmount: p.layout.layout.layoutAmount,
                sheets: p.layout.waste.totalSheets,
                layoutStandard: p.layout.layout.layoutStandard,
                blankAreaSqm: (p.layout.layout.dw * p.layout.layout.dl) / 1000000,
              })),
            }
          : null,
      ),
    }));
  }

  shipmentParts(resolved: ResolvedFoldingQuote): ShipmentPart[] {
    return resolved.parts.map((p) => {
      const blank = p.pattern.standardBlanks?.find(
        (b) => b.wMm === p.geometry.w && b.lMm === p.geometry.l && b.dMm === p.geometry.d,
      );
      return {
        kind: 'folding',
        formula: p.pattern.formula,
        w: p.geometry.w,
        l: p.geometry.l,
        d: p.geometry.d,
        gsm: resolved.materialGsm,
        standardBlank: blank ? { dw: blank.dwMm, dl: blank.dlMm } : null,
      };
    });
  }

  logInput(cfg: FoldingConfiguration): CalculationLogInput {
    return {
      quantities: [...cfg.quantities],
      lengthMm: cfg.l,
      widthMm: cfg.w,
      heightMm: cfg.d,
      input: JSON.parse(JSON.stringify(cfg)) as Prisma.InputJsonValue,
      inputSchemaVersion: 1,
    };
  }

  withQuantities(cfg: FoldingConfiguration, quantities: readonly number[]): FoldingConfiguration {
    return { ...cfg, quantities };
  }
}
