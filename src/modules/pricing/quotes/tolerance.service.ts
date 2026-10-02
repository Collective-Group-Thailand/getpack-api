import { type Tx } from '@database/prisma.service';
import { type CalculatorKey } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { SettingsService } from '@platform/settings/settings.service';

/** The tolerances published for one option and frozen with it (D-021, D-163, D-186, D-187). */
export interface Tolerance {
  shortage: string;
  overage: string;
  /** ± mm; null = none published for the product (D-186). */
  dimensionalMm: string | null;
  /** ΔE2000 against the approved proof; null = not a printed product (D-186). */
  colourDeltaE: string | null;
}

/** Calculators whose products are printed and so carry a colour tolerance (D-186). */
const PRINTED: ReadonlySet<CalculatorKey> = new Set(['folding', 'corrugate', 'label', 'tag_sleeve', 'pouch']);

export interface ToleranceInput {
  /** Null = no factory named (an RFQ line without one): the platform defaults (D-187). */
  factoryId: bigint | null;
  productTypeId: bigint;
  calculatorKey: CalculatorKey | null;
  /** The option's print type and price list version, to tell flexo apart (corrugate). */
  printTypePublicId?: string | null;
  priceListVersionId?: bigint | null;
}

/**
 * The factory's approved tolerance for the product type, else its default, else the platform default — per
 * value: quantity (D-021, D-163), dimensional and colour (D-186). Frozen on the quote option, the order and the job.
 */
@Injectable()
export class ToleranceService {
  constructor(private readonly settings: SettingsService) {}

  async resolve(input: ToleranceInput, at: Date, db: Tx): Promise<Tolerance> {
    const inForce = { status: 'approved' as const, effectiveFrom: { lte: at } };
    const latest = [{ effectiveFrom: 'desc' as const }, { versionNo: 'desc' as const }];
    const versions = [];
    for (const scope of input.factoryId === null ? [] : [input.productTypeId, null]) {
      const version = await db.factoryTolerancePolicyVersion.findFirst({
        where: { ...inForce, policy: { factoryId: input.factoryId!, productTypeId: scope } },
        orderBy: latest,
      });
      if (version) versions.push(version);
    }
    const quantity = versions[0];
    const dimensional = versions.find((v) => v.dimensionalMm !== null)?.dimensionalMm;
    const colour = versions.find((v) => v.colourDeltaE !== null)?.colourDeltaE;
    const pct = quantity
      ? null
      : Number((await this.settings.at('fulfilment.tolerance_default_pct', { at })).value).toFixed(4);
    return {
      shortage: quantity ? quantity.shortagePct.toFixed(4) : pct!,
      overage: quantity ? quantity.overagePct.toFixed(4) : pct!,
      dimensionalMm: dimensional
        ? dimensional.toFixed(2)
        : await this.platformDimensional(input.calculatorKey, at),
      colourDeltaE:
        input.calculatorKey && PRINTED.has(input.calculatorKey)
          ? colour
            ? colour.toFixed(2)
            : await this.platformColour((await this.flexo(input, db)) ? 'flexo' : 'standard', at)
          : null,
    };
  }

  /** The platform defaults per calculator (D-186), for the storefront before a factory is chosen. */
  async platform(
    calculatorKey: CalculatorKey | null,
    at: Date,
  ): Promise<Omit<Tolerance, 'colourDeltaE'> & { colourDeltaE: { standard: string; flexo: string } | null }> {
    const pct = Number((await this.settings.at('fulfilment.tolerance_default_pct', { at })).value).toFixed(4);
    const printed = calculatorKey !== null && PRINTED.has(calculatorKey);
    return {
      shortage: pct,
      overage: pct,
      dimensionalMm: await this.platformDimensional(calculatorKey, at),
      colourDeltaE: printed
        ? {
            standard: (await this.platformColour('standard', at))!,
            flexo: (await this.platformColour(calculatorKey === 'corrugate' ? 'flexo' : 'standard', at))!,
          }
        : null,
    };
  }

  private async platformDimensional(key: CalculatorKey | null, at: Date): Promise<string | null> {
    if (!key) return null;
    const value = (await this.settings.at('fulfilment.dimensional_tolerance_mm', { at })).value[key];
    return value === undefined ? null : Number(value).toFixed(2);
  }

  private async platformColour(kind: 'standard' | 'flexo', at: Date): Promise<string | null> {
    const value = (await this.settings.at('fulfilment.colour_tolerance_delta_e', { at })).value[kind];
    return value === undefined ? null : Number(value).toFixed(2);
  }

  /** Flexo prints only on corrugate (`pl_corrugate_print_type_terms.engine_variant`). */
  private async flexo(input: ToleranceInput, db: Tx): Promise<boolean> {
    if (input.calculatorKey !== 'corrugate' || !input.printTypePublicId || !input.priceListVersionId)
      return false;
    const terms = await db.plCorrugatePrintTypeTerm.findFirst({
      where: {
        priceListVersionId: input.priceListVersionId,
        printType: { publicId: input.printTypePublicId },
      },
      select: { engineVariant: true },
    });
    return terms?.engineVariant === 'flexo';
  }
}
