import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';

import { loadSellSnapshot } from '../shared/sell-snapshot';
import { POUCH_FORMULA_NEEDS, type PouchFormula, type PouchSize } from './geometry';
import { type PouchOption } from './pouch-calculator';
import { type PouchTables } from './tables';

/**
 * Loads what the pouch calculator reads (U-B6 pouch): the configuration resolved against the platform catalogue
 * (pouch pattern and its shape, film, print colour set, options) and per factory price-list version one option per
 * print type with its `pl_pouch_*` rows in line order and Packio's sell side. Every version id used is returned.
 */

/** A pouch configuration as the API receives it: catalogue public ids, millimetres. */
export interface PouchConfiguration {
  catalogProductId?: string;
  patternId: string;
  w: number;
  l: number;
  b?: number;
  s?: number;
  cs?: number;
  materialId: string;
  printColourId?: string;
  optionIds?: readonly string[];
  quantities: readonly number[];
  design?: { graphic: boolean; structure?: boolean };
}

export interface ResolvedPouch {
  productTypeId: bigint;
  catalogProductId: bigint | null;
  patternId: bigint;
  formula: PouchFormula;
  size: PouchSize;
  materialId: bigint;
  /** Internal catalogue ids as strings (the calculator's id space). */
  printColourId: string | null;
  optionIds: string[];
}

export interface LoadedPouchOption {
  option: PouchOption;
  optionKey: string;
  factoryId: string;
  printTypePublicId: string;
  priceListVersionId: bigint;
  priceListVersionPublicId: string;
  sellMarginVersionIds: bigint[];
  vatRateVersionId: bigint;
}

const num = (d: Prisma.Decimal | number | null | undefined): number | null =>
  d === null || d === undefined ? null : Number(d.toString());
const num0 = (d: Prisma.Decimal | number | null | undefined): number => num(d) ?? 0;

@Injectable()
export class PouchSnapshotLoader {
  constructor(private readonly prisma: PrismaService) {}

  // --- configuration ---------------------------------------------------------------------------

  async resolve(cfg: PouchConfiguration, db: Tx = this.prisma): Promise<ResolvedPouch> {
    const invalid = (path: string, message: string) =>
      new DomainException('validation.failed', { errors: [{ path, code: 'invalid', message }] });
    const pattern = await db.pattern.findFirst({
      where: {
        publicId: cfg.patternId,
        status: 'active',
        productType: { calculatorKey: 'pouch' },
        pouchFormula: { not: null },
      },
    });
    if (!pattern) throw invalid('patternId', 'no active pouch pattern with this id');
    const formula = pattern.pouchFormula as PouchFormula;
    // The shape reads its gussets / centre seal (legacy `pattern.required_b / s / cs`, port map §2.2).
    const size: PouchSize = { w: cfg.w, l: cfg.l };
    for (const key of POUCH_FORMULA_NEEDS[formula]) {
      const value = cfg[key];
      if (value === undefined) {
        throw new DomainException('validation.failed', {
          errors: [{ path: key, code: 'required', message: `this pouch shape needs ${key}` }],
        });
      }
      size[key] = value;
    }
    let catalogProductId: bigint | null = null;
    if (cfg.catalogProductId) {
      const product = await db.catalogProduct.findFirst({
        where: { publicId: cfg.catalogProductId, status: 'active', productTypeId: pattern.productTypeId },
      });
      if (!product) throw invalid('catalogProductId', 'no active pouch catalogue product with this id');
      catalogProductId = product.id;
    }
    const material = await db.material.findFirst({
      where: { publicId: cfg.materialId, status: 'active', kind: 'film' },
    });
    if (!material) throw invalid('materialId', 'no active film with this id');
    const colour = cfg.printColourId
      ? await db.inkColour.findFirst({ where: { publicId: cfg.printColourId, status: 'active' } })
      : null;
    if (cfg.printColourId && !colour) throw invalid('printColourId', 'no active print colour with this id');
    const optionIds = cfg.optionIds ?? [];
    const assemblies = await db.assembly.findMany({
      where: { publicId: { in: [...optionIds] }, status: 'active' },
    });
    const options = optionIds.map((id, i) => {
      const row = assemblies.find((a) => a.publicId === id);
      if (!row) throw invalid(`optionIds[${i}]`, 'no active option with this id');
      return row.id.toString();
    });
    return {
      productTypeId: pattern.productTypeId,
      catalogProductId,
      patternId: pattern.id,
      formula,
      size,
      materialId: material.id,
      printColourId: colour ? colour.id.toString() : null,
      optionIds: options,
    };
  }

  // --- factory options -------------------------------------------------------------------------

  /** One option per print type the factory's price-list version has pouch terms for. */
  async options(
    factory: { id: bigint; publicId: string },
    priceListVersionId: bigint,
    resolved: ResolvedPouch,
    at: Date,
    db: Tx = this.prisma,
  ): Promise<LoadedPouchOption[]> {
    const v = priceListVersionId;
    const byId = { orderBy: { id: 'asc' as const } };
    const terms = await db.plPouchPrintTypeTerm.findMany({
      where: { priceListVersionId: v },
      include: {
        printType: { select: { publicId: true } },
        priceListVersion: { select: { publicId: true } },
      },
      ...byId,
    });
    const assemblyIds = resolved.optionIds.map((id) => BigInt(id));
    const loaded: LoadedPouchOption[] = [];
    for (const t of terms) {
      const scoped = { priceListVersionId: v, printTypeId: t.printTypeId };
      const [materials, prints, optionPrices, processPrices, minQuantities, factoryMargins, rules] =
        await Promise.all([
          db.plPouchMaterialPrice.findMany({
            where: { ...scoped, materialId: resolved.materialId },
            ...byId,
          }),
          db.plPouchPrintPrice.findMany({ where: scoped, ...byId }),
          db.plPouchOptionPrice.findMany({ where: { ...scoped, assemblyId: { in: assemblyIds } }, ...byId }),
          db.plPouchProcessPrice.findMany({ where: scoped, ...byId }),
          db.plPouchMinQuantity.findMany({ where: scoped, ...byId }),
          db.plPouchFactoryMargin.findMany({ where: scoped, ...byId }),
          db.plPouchOptionRule.findMany({
            where: { ...scoped, patternId: resolved.patternId, materialId: resolved.materialId },
            ...byId,
          }),
        ]);
      const tables: PouchTables = {
        terms: {
          toleranceMm: num0(t.toleranceMm),
          minDlMm: num0(t.minDlMm),
          maxDlMm: num0(t.maxDlMm),
          minMaterialLengthM: num0(t.minMaterialLengthM),
          setupLengthM: num0(t.setupLengthM),
          webWidthMm: num0(t.webWidthMm),
          minMaterialCost: num0(t.minMaterialCost),
          bridgeMm: num0(t.bridgeMm),
          factoryMarginPct: num0(t.factoryMarginPct),
          leadTimeDays: num(t.leadTimeDays),
          laminationRatePerM2: num0(t.laminationRatePerM2),
          laminationWebWidthM: num0(t.laminationWebWidthM),
          makingQtyThreshold: t.makingQtyThreshold,
          makingPricePerPcs: num0(t.makingPricePerPcs),
        },
        materialPrices: materials.map((r) => ({
          materialId: r.materialId.toString(),
          pricePerCm2: num0(r.pricePerCm2),
        })),
        printPrices: prints.map((r) => ({
          inkColourId: r.inkColourId.toString(),
          pricePerCm2: num0(r.pricePerCm2),
        })),
        optionPrices: optionPrices.map((r) => ({
          assemblyId: r.assemblyId.toString(),
          minQty: r.minQty,
          maxQty: r.maxQty,
          priceMode: r.priceMode as PouchTables['optionPrices'][number]['priceMode'],
          pricePerPcs: num(r.pricePerPcs),
          pricePerCm: num(r.pricePerCm),
          pricePerCm2: num(r.pricePerCm2),
        })),
        processPrices: processPrices.map((r) => ({
          process: r.process as 'lamination' | 'making',
          minQty: r.minQty,
          maxQty: r.maxQty,
          minPrice: num0(r.minPrice),
        })),
        minQuantities: minQuantities.map((r) => ({
          minSqcm: num(r.minSqcm),
          maxSqcm: num(r.maxSqcm),
          minQty: r.minQty,
        })),
        factoryMargins: factoryMargins.map((r) => ({
          minQty: r.minQty,
          maxQty: r.maxQty,
          marginPct: num0(r.marginPct),
        })),
        optionRules: rules.map((r) => ({
          patternId: r.patternId.toString(),
          materialId: r.materialId.toString(),
          assemblyId: r.assemblyId.toString(),
        })),
      };
      const sell = await loadSellSnapshot(db, resolved.productTypeId, t.printTypeId, at);
      const option: PouchOption = {
        optionKey: `${factory.publicId}:${t.printType.publicId}`,
        factoryId: factory.publicId,
        printTypeId: t.printTypeId.toString(),
        tables,
        sell: sell.snapshot,
      };
      loaded.push({
        option,
        optionKey: option.optionKey,
        factoryId: factory.publicId,
        printTypePublicId: t.printType.publicId,
        priceListVersionId: v,
        priceListVersionPublicId: t.priceListVersion.publicId,
        sellMarginVersionIds: sell.versionIds,
        vatRateVersionId: sell.vatRateVersionId,
      });
    }
    return loaded;
  }
}
