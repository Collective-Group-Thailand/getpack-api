import { type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { type ShipmentPart } from '@modules/shipping/shipping-quote.service';
import { Injectable, type OnModuleInit } from '@nestjs/common';

import { phpRound } from '../../engine/php';
import {
  type CalculationLogInput,
  type CalculatorAdapter,
  type PricedOption,
  type ResolvedBase,
} from '../adapter';
import { CalculatorRegistry } from '../calculator';
import { CORRUGATE_CALCULATOR_VERSION, corrugateCalculator } from './corrugate-calculator';
import {
  type CorrugateConfiguration,
  CorrugateSnapshotLoader,
  type LoadedCorrugateOption,
  type ResolvedCorrugate,
} from './corrugate-snapshot.loader';
import { blank } from './geometry';

export type ResolvedCorrugateQuote = ResolvedCorrugate &
  ResolvedBase & { design: { graphic: boolean; structure: boolean } };

/** The corrugate calculator behind the quote engine (U-B6): loader + pure `calculate_cs` port. */
@Injectable()
export class CorrugateQuoteAdapter
  implements
    CalculatorAdapter<CorrugateConfiguration, ResolvedCorrugateQuote, LoadedCorrugateOption>,
    OnModuleInit
{
  readonly key = 'corrugate' as const;
  readonly version = CORRUGATE_CALCULATOR_VERSION;

  constructor(
    private readonly loader: CorrugateSnapshotLoader,
    private readonly registry: CalculatorRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async resolve(cfg: CorrugateConfiguration, db: Tx): Promise<ResolvedCorrugateQuote> {
    const resolved = await this.loader.resolve(cfg, db);
    return {
      ...resolved,
      quantities: cfg.quantities,
      design: cfg.design ?? { graphic: false, structure: false },
    };
  }

  options(
    factory: { id: bigint; publicId: string },
    priceListVersionId: bigint,
    resolved: ResolvedCorrugateQuote,
    at: Date,
    db: Tx,
  ): Promise<LoadedCorrugateOption[]> {
    return this.loader.options(factory, priceListVersionId, resolved, at, db);
  }

  calculate(
    resolved: ResolvedCorrugateQuote,
    loaded: readonly LoadedCorrugateOption[],
    opts: { withDesign: boolean },
  ): PricedOption[] {
    const result = corrugateCalculator.calculate(
      {
        quantities: resolved.quantities,
        parts: resolved.parts,
        design: opts.withDesign ? resolved.design : { graphic: false, structure: false },
        size: resolved.size,
        flute: resolved.flute,
        materialId: resolved.materialId.toString(),
        materialCoatable: resolved.materialCoatable,
        conditions: resolved.conditions,
        standardSize: resolved.standardSize,
        autoAssemblies: resolved.autoAssemblies,
        digitalFrontCoveragePct: resolved.digitalFrontCoveragePct,
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
              // Corrugate has no minimum production run: the run is the quantity (`calculate_cs:410`).
              productionRun: s.qty,
              buyPrice: s.buyPrice,
              marginPct: s.marginPct,
              leadTimeDays: s.leadTimeDays,
              unitPrice: s.perPcsWithDelivery,
              productAmount: s.sum,
              designFee: s.designFee,
              structureDesignFee: s.structureDesignFee,
              toolingAmount: s.tooling,
              vatAmount: s.vatPrice,
              total: s.total,
              parts: s.parts.map((p) => {
                const layout = p.layout;
                const ups = layout.dieLayout ? layout.dieLayout.w * layout.dieLayout.l : 1;
                return {
                  partKey: p.partKey,
                  buyPrice: p.buyPrice + p.plates + p.dieBlock,
                  totalCost: 'totalCost' in layout ? layout.totalCost : layout.costBeforeUplift,
                  layoutAmount: ('widthLayout' in layout ? layout.widthLayout : 1) * ups,
                  sheets: layout.sheets,
                  layoutStandard: false,
                  blankAreaSqm: (p.blank.dw * p.blank.dl) / 1000000,
                };
              }),
            }
          : null,
      ),
    }));
  }

  /** The flat blanks to ship: without the factory's adjustment, rounded as legacy formats them (`:845-846`). */
  shipmentParts(resolved: ResolvedCorrugateQuote): ShipmentPart[] {
    return resolved.parts.map((p) => {
      const b = blank({
        formula: p.formula,
        ...resolved.size,
        flute: resolved.flute,
        conditions: resolved.conditions,
        plus: null,
      });
      return {
        kind: 'corrugate',
        formula: p.formula,
        dw: phpRound(b.dw, 2),
        dl: phpRound(b.dl, 2),
        gsm: resolved.materialGsm,
        flute: { g: resolved.flute.g, c: resolved.flute.c, fh: resolved.flute.fh },
      };
    });
  }

  logInput(cfg: CorrugateConfiguration): CalculationLogInput {
    return {
      quantities: [...cfg.quantities],
      lengthMm: cfg.l,
      widthMm: cfg.w,
      heightMm: cfg.d,
      input: JSON.parse(JSON.stringify(cfg)) as Prisma.InputJsonValue,
      inputSchemaVersion: 1,
    };
  }

  withQuantities(cfg: CorrugateConfiguration, quantities: readonly number[]): CorrugateConfiguration {
    return { ...cfg, quantities };
  }
}
