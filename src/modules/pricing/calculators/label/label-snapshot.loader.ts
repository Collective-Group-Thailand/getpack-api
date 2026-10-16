import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';

import { type LoadedSell, loadSellSnapshot } from '../shared/sell-snapshot';
import { type LabelOption } from './label-calculator';
import { type LabelSheet, type LabelTables } from './tables';

/**
 * Loads what the label calculator reads (U-B6 label): the configuration resolved against the platform catalogue
 * (label stock, difficulty, ink colours, coatings, die-cut type, the product type through the catalogue product) and
 * per factory price-list version one option per label print type with its rows in line order (quirk L16) and
 * getpack's sell side (half-open tier bound, `LabelCalculator.php:497,506`). Every version id used is returned.
 */

/** A label configuration as the API receives it: catalogue public ids, millimetres. */
export interface LabelConfiguration {
  catalogProductId?: string;
  w: number;
  l: number;
  materialId: string;
  difficultyLevelId: string;
  quantities: readonly number[];
  printFront?: { inkColourIds: readonly string[] };
  printBack?: { inkColourIds: readonly string[] };
  finishFrontId?: string;
  finishBackId?: string;
  diecutTypeId?: string;
  design?: { graphic: boolean; structure?: boolean };
}

export interface ResolvedLabel {
  productTypeId: bigint;
  catalogProductId: bigint | null;
  materialId: bigint;
  materialGsm: number;
  difficultyLevelId: bigint;
  size: { w: number; l: number };
  /** Internal catalogue ids as strings (the calculator's id space). */
  printFront: string[];
  printBack: string[];
  finishFrontId: string | null;
  finishBackId: string | null;
  diecutTypeId: string | null;
}

export interface LoadedLabelOption {
  option: LabelOption;
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
export class LabelSnapshotLoader {
  constructor(private readonly prisma: PrismaService) {}

  // --- configuration ---------------------------------------------------------------------------

  async resolve(cfg: LabelConfiguration, db: Tx = this.prisma): Promise<ResolvedLabel> {
    const invalid = (path: string, message: string) =>
      new DomainException('validation.failed', { errors: [{ path, code: 'invalid', message }] });

    let productTypeId: bigint;
    let catalogProductId: bigint | null = null;
    if (cfg.catalogProductId) {
      const product = await db.catalogProduct.findFirst({
        where: { publicId: cfg.catalogProductId, status: 'active', productType: { calculatorKey: 'label' } },
      });
      if (!product) throw invalid('catalogProductId', 'no active label catalogue product with this id');
      productTypeId = product.productTypeId;
      catalogProductId = product.id;
    } else {
      const types = await db.productType.findMany({
        where: { calculatorKey: 'label', status: 'active' },
        orderBy: { id: 'asc' },
        take: 2,
      });
      if (types.length !== 1) throw invalid('catalogProductId', 'name the catalogue product');
      productTypeId = types[0]!.id;
    }

    const material = await db.material.findFirst({
      where: { publicId: cfg.materialId, status: 'active', kind: 'label_stock' },
    });
    if (!material) throw invalid('materialId', 'no active label stock with this id');
    const difficulty = await db.difficultyLevel.findFirst({
      where: { publicId: cfg.difficultyLevelId, status: 'active' },
    });
    if (!difficulty) throw invalid('difficultyLevelId', 'no active difficulty level with this id');

    const inkIds = [...(cfg.printFront?.inkColourIds ?? []), ...(cfg.printBack?.inkColourIds ?? [])];
    const finishIds = [cfg.finishFrontId, cfg.finishBackId].filter((f): f is string => Boolean(f));
    const [inks, finishes, diecut] = await Promise.all([
      db.inkColour.findMany({ where: { publicId: { in: inkIds }, status: 'active' } }),
      db.finish.findMany({ where: { publicId: { in: finishIds }, status: 'active' } }),
      cfg.diecutTypeId
        ? db.diecutType.findFirst({ where: { publicId: cfg.diecutTypeId, status: 'active' } })
        : Promise.resolve(null),
    ]);
    const ink = (ids: readonly string[] | undefined, field: string) =>
      (ids ?? []).map((id, i) => {
        const row = inks.find((r) => r.publicId === id);
        if (!row) throw invalid(`${field}.inkColourIds[${i}]`, 'no active ink colour with this id');
        return row.id.toString();
      });
    const finish = (id: string | undefined, field: string) => {
      if (!id) return null;
      const row = finishes.find((r) => r.publicId === id);
      if (!row) throw invalid(field, 'no active finish with this id');
      return row.id.toString();
    };
    if (cfg.diecutTypeId && !diecut) throw invalid('diecutTypeId', 'no active die-cut type with this id');
    return {
      productTypeId,
      catalogProductId,
      materialId: material.id,
      materialGsm: num0(material.gsm),
      difficultyLevelId: difficulty.id,
      size: { w: cfg.w, l: cfg.l },
      printFront: ink(cfg.printFront?.inkColourIds, 'printFront'),
      printBack: ink(cfg.printBack?.inkColourIds, 'printBack'),
      finishFrontId: finish(cfg.finishFrontId, 'finishFrontId'),
      finishBackId: finish(cfg.finishBackId, 'finishBackId'),
      diecutTypeId: diecut ? diecut.id.toString() : null,
    };
  }

  // --- factory options -------------------------------------------------------------------------

  /** One option per label print type the factory's price-list version has terms for. */
  async options(
    factory: { id: bigint; publicId: string },
    priceListVersionId: bigint,
    resolved: ResolvedLabel,
    at: Date,
    db: Tx = this.prisma,
  ): Promise<LoadedLabelOption[]> {
    const v = priceListVersionId;
    const byId = { orderBy: { id: 'asc' as const } };
    const terms = await db.plLabelPrintTypeTerm.findMany({
      where: { priceListVersionId: v },
      include: {
        printType: { select: { publicId: true } },
        priceListVersion: { select: { publicId: true } },
      },
      ...byId,
    });
    const labelSheets = await db.plLabelPaperSheet.findMany({ where: { priceListVersionId: v }, ...byId });
    const difficultyLevelId = resolved.difficultyLevelId;
    const loaded: LoadedLabelOption[] = [];
    for (const t of terms) {
      const pt = t.printTypeId;
      const scoped = { priceListVersionId: v, printTypeId: pt, difficultyLevelId };
      const [
        trim,
        materialPrices,
        sizes,
        inks,
        printWastes,
        finishWastes,
        diecutWastes,
        printPrices,
        rollPrintPrices,
        finishPrices,
        diecutPrices,
        dieBlocks,
      ] = await Promise.all([
        db.plPaperTrim.findFirst({ where: { priceListVersionId: v, printTypeId: pt }, ...byId }),
        db.plMaterialPrice.findMany({
          where: { priceListVersionId: v, printTypeId: pt, materialId: resolved.materialId },
          ...byId,
        }),
        db.plPaperSize.findMany({
          where: { priceListVersionId: v, printTypeId: pt, materialId: resolved.materialId },
          ...byId,
        }),
        db.plInkColour.findMany({ where: { priceListVersionId: v, printTypeId: pt }, ...byId }),
        db.plPrintWaste.findMany({ where: scoped, ...byId }),
        db.plFinishWaste.findMany({ where: scoped, ...byId }),
        db.plDiecutWaste.findMany({ where: scoped, ...byId }),
        db.plPrintPrice.findMany({ where: scoped, ...byId }),
        db.plLabelRollPrintPrice.findMany({ where: scoped, ...byId }),
        db.plFinishPrice.findMany({ where: scoped, ...byId }),
        db.plLabelDiecutPrice.findMany({ where: scoped, ...byId }),
        db.plDiecutBlockPrice.findMany({ where: scoped, ...byId }),
      ]);
      const base = materialPrices.find((r) => r.minPaperAmount === null && r.maxPaperAmount === null);
      const unavailable: string[] = [];
      if (!trim) unavailable.push('paper_trims');
      if (!base) unavailable.push('material_prices');
      // The material's paper sizes × the factory's sheets and rolls of each size (`getPaperSheets:868-881`).
      const sheets: LabelSheet[] = [];
      for (const size of sizes) {
        for (const s of labelSheets.filter(
          (x) => x.sizeWIn.equals(size.sizeWIn) && x.sizeLIn.equals(size.sizeLIn),
        )) {
          sheets.push({
            sizeWIn: num0(s.sizeWIn),
            sizeLIn: num0(s.sizeLIn),
            sheetCut: s.sheetCut,
            sheetWIn: num0(s.sheetWIn),
            sheetLIn: num0(s.sheetLIn),
            sheetCutLengthIn: num0(s.sheetCutLengthIn),
          });
        }
      }
      const band = (r: {
        minPaperSheetAmount: Prisma.Decimal | null;
        maxPaperSheetAmount: Prisma.Decimal | null;
      }) => ({ minSheets: num(r.minPaperSheetAmount), maxSheets: num(r.maxPaperSheetAmount) });
      const waste = (r: { percentWaste: Prisma.Decimal; setupWaste: number }) => ({
        percentWaste: num0(r.percentWaste),
        setupWaste: r.setupWaste,
      });
      const tables: LabelTables = {
        terms: {
          engine: t.engineVariant as LabelTables['terms']['engine'],
          factoryMarginPct: num0(t.factoryMarginPct),
          minOrderAmount: t.minOrderAmount,
          minSheetPerJob: t.minSheetPerJob,
          leadTimeDays: num(t.leadTimeDays),
          bulkLeadTime:
            t.bulkLeadTimeMinQty !== null && t.bulkLeadTimeDays !== null
              ? { minQty: t.bulkLeadTimeMinQty, days: num0(t.bulkLeadTimeDays) }
              : null,
          wasteMethod: t.wasteMethod === 2 ? 2 : 1,
          diecutAvailable: t.diecutAvailable,
          minRollLengthM: num(t.minRollLengthM),
        },
        trim: {
          gapMm: num0(trim?.gapMm),
          trimWMm: num0(trim?.trimWMm),
          trimLMm: num0(trim?.trimLMm),
          edgeTrimMm: num0(trim?.edgeTrimMm),
          endJobTrimMm: num0(trim?.endJobTrimMm),
        },
        sheets,
        material: { costPerKg: num(base?.costPerKg), costPerM2: num(base?.costPerM2) },
        printWastes: printWastes.map((r) => ({
          ...band(r),
          ...waste(r),
          minPercent: num(r.minPercentPrint),
          maxPercent: num(r.maxPercentPrint),
        })),
        finishWastes: finishWastes.map((r) => ({
          ...band(r),
          ...waste(r),
          finishId: r.finishId?.toString() ?? null,
        })),
        diecutWastes: diecutWastes.map((r) => ({
          ...band(r),
          ...waste(r),
          diecutTypeId: r.diecutTypeId.toString(),
          minBox: r.minBoxAmount,
          maxBox: r.maxBoxAmount,
        })),
        printPrices: printPrices.map((r) => ({
          ...band(r),
          machineId: r.machineId.toString(),
          inkColourId: r.inkColourId.toString(),
          percentColor: num(r.percentColor),
          pricePerSheet: num0(r.pricePerSheet),
          pricePerPcs: num0(r.pricePerPcs),
          flatPriceFourColor: num0(r.flatPriceFourColor),
          flatPriceFourColorPerPcs: num0(r.flatPriceFourColorPerPcs),
          priceColorCombineSpecialColor: num0(r.priceColorCombineSpecialColor),
          operationCost: num0(r.operationCost),
          priceInkPerM2: num0(r.priceInkPerM2),
        })),
        rollPrintPrices: rollPrintPrices.map((r) => ({
          inkColourId: r.inkColourId.toString(),
          pricePerM2: num0(r.pricePerM2),
        })),
        finishPrices: finishPrices.map((r) => ({
          ...band(r),
          finishId: r.finishId.toString(),
          machineId: r.machineId?.toString() ?? null,
          finishPrice: num0(r.finishPrice),
          pricePerSheet: num0(r.pricePerSheet),
          priceByAreaPerIn2: num0(r.priceByAreaPerIn2),
          minPrice: num0(r.minPrice),
          toolingPrice: num0(r.toolingPrice),
          blockPricePerIn2: num0(r.blockPricePerIn2),
          materialPricePerIn2: num0(r.materialPricePerIn2),
          operationCost: num0(r.operationCost),
          addsDiecutWindow: r.addsDiecutWindow,
        })),
        diecutPrices: diecutPrices.map((r) => ({
          diecutTypeId: r.diecutTypeId?.toString() ?? null,
          minSheets: num(r.minPaperSheetAmount),
          maxSheets: num(r.maxPaperSheetAmount),
          minBox: r.minBoxAmount,
          maxBox: r.maxBoxAmount,
          diecutPrice: num(r.diecutPrice),
          pricePerM2: num(r.pricePerM2),
        })),
        dieBlocks: dieBlocks.map((r) => ({
          machineId: r.machineId.toString(),
          wMin: num0(r.blockWMinIn),
          wMax: num0(r.blockWMaxIn),
          lMin: num0(r.blockLMinIn),
          lMax: num0(r.blockLMaxIn),
          layMin: r.layMin,
          layMax: r.layMax,
          diecutPrice: num0(r.diecutPrice),
          pricePerDrawing: num0(r.pricePerDrawing),
        })),
      };
      const sell: LoadedSell = await loadSellSnapshot(db, resolved.productTypeId, pt, at);
      const option: LabelOption = {
        optionKey: `${factory.publicId}:${t.printType.publicId}`,
        factoryId: factory.publicId,
        printTypeId: pt.toString(),
        tables,
        inkColours: new Set(inks.map((i) => i.inkColourId.toString())),
        sell: sell.snapshot,
        ...(unavailable.length ? { unavailable } : {}),
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
