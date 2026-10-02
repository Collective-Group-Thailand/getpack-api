import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';

import { type LoadedSell, loadSellSnapshot } from '../shared/sell-snapshot';
import { type BTables } from './b/tables';
import { type FoldingEngine, type FoldingOption, type FoldingPart } from './folding-calculator';
import {
  FOLDING_DETERMINANTS,
  FOLDING_SLOTS,
  type GeometryCondition,
  type GeometryDeterminant,
  type GeometrySlot,
  type GeometrySnapshot,
  type PaperSheet,
  type PatternGeometry,
} from './geometry/types';
import {
  type AssemblyRequest,
  type Finish2Request,
  type PartRequest,
  type PrintColour,
  type ProcessExclusion,
} from './request';
import { type DigitalTables, type OffsetTables } from './tables';

/**
 * Loads what the folding calculator reads (B2.3): the configuration resolved against the platform
 * catalogue, and per factory price-list version one option per print type with its price rows, paper
 * sheets, geometry and Packio's sell side at the pricing instant. Rows keep the line order (`id`), the
 * tie-break legacy left to the database (quirk Q10). Every version id used is returned for the snapshot.
 */

export interface FoldingPartConfiguration {
  subPatternId?: string;
  printFront?: readonly { inkColourId: string; percent: number }[];
  printBack?: readonly { inkColourId: string; percent: number }[];
  finish1FrontId?: string;
  finish1BackId?: string;
  finish2?: readonly { finishId: string; amount?: number; w?: readonly number[]; l?: readonly number[] }[];
  diecutTypeId?: string;
  assemblies?: readonly {
    assemblyId: string;
    amount?: number;
    w?: readonly number[];
    l?: readonly number[];
  }[];
}

/** A folding configuration as the API receives it: catalogue public ids, millimetres. */
export interface FoldingConfiguration {
  patternId: string;
  catalogProductId?: string;
  w: number;
  l: number;
  d: number;
  x?: number;
  c?: number;
  /** Fixed grain, laid along the given blank side (legacy `isGrain` + `grainPararell`, quirk Q15). */
  grainParallel?: 'dw' | 'dl';
  materialId: string;
  difficultyLevelId: string;
  quantities: readonly number[];
  parts: readonly FoldingPartConfiguration[];
  design?: { graphic: boolean; structure: boolean };
  customCost?: boolean;
}

export interface ResolvedFolding {
  productTypeId: bigint;
  patternId: bigint;
  catalogProductId: bigint | null;
  materialId: bigint;
  materialGsm: number;
  parts: (FoldingPart & { subPatternId: bigint | null; pattern: PatternGeometry })[];
  patternKind: number | null;
}

export interface LoadedOption {
  option: FoldingOption;
  printTypePublicId: string;
  priceListVersionId: bigint;
  priceListVersionPublicId: string;
  sellMarginVersionIds: bigint[];
  vatRateVersionId: bigint;
}

const num = (d: Prisma.Decimal | number | null | undefined): number | null =>
  d === null || d === undefined ? null : Number(d.toString());
const num0 = (d: Prisma.Decimal | number | null | undefined): number => num(d) ?? 0;
const id = (v: bigint | null | undefined): string | null =>
  v === null || v === undefined ? null : v.toString();

/** F1 is a coating or lamination; F2 the special finishes legacy processes, in legacy order (`:702`). */
const isFoldingSlot = (slot: string): slot is GeometrySlot =>
  (FOLDING_SLOTS as readonly string[]).includes(slot);
const isFoldingDeterminant = (d: string): d is GeometryDeterminant =>
  (FOLDING_DETERMINANTS as readonly string[]).includes(d);

const FINISH1_KINDS = new Set(['coating', 'lamination']);
const FINISH2_ORDER = ['foil', 'spot_uv', 'emboss', 'deboss'];

@Injectable()
export class FoldingSnapshotLoader {
  constructor(private readonly prisma: PrismaService) {}

  // --- configuration ---------------------------------------------------------------------------

  /**
   * `calculator` is the product type's calculator: folding, or tag & sleeve — flat folding blanks priced on the
   * folding engine (U-B6 tag & sleeve, port map T2): a tag pattern has geometry `flat`, no parts and depth 0.
   */
  async resolve(
    cfg: FoldingConfiguration,
    db: Tx = this.prisma,
    calculator: 'folding' | 'tag_sleeve' = 'folding',
  ): Promise<ResolvedFolding> {
    const invalid = (path: string, message: string) =>
      new DomainException('validation.failed', { errors: [{ path, code: 'invalid', message }] });
    const pattern = await db.pattern.findFirst({
      where: { publicId: cfg.patternId, status: 'active', productType: { calculatorKey: calculator } },
      include: {
        subPatterns: { orderBy: { seq: 'asc' } },
        geometryConditions: {
          include: { condition: { include: { bandTable: { include: { bands: true } } } } },
          orderBy: [{ slot: 'asc' }, { seq: 'asc' }],
        },
        standardBlanks: { include: { standardSize: true } },
      },
    });
    if (!pattern) {
      throw invalid(
        'patternId',
        `no active ${calculator === 'folding' ? 'folding' : 'tag & sleeve'} pattern with this id`,
      );
    }
    if (
      calculator === 'tag_sleeve' &&
      (pattern.geometryFormula !== 'flat' || pattern.subPatterns.length > 0 || cfg.d !== 0)
    ) {
      throw invalid(
        'patternId',
        'a tag & sleeve pattern is one flat blank (geometry flat, no parts, depth 0)',
      );
    }
    const material = await db.material.findFirst({ where: { publicId: cfg.materialId, status: 'active' } });
    if (!material) throw invalid('materialId', 'no active material with this id');
    const difficulty = await db.difficultyLevel.findFirst({
      where: { publicId: cfg.difficultyLevelId, status: 'active' },
    });
    if (!difficulty) throw invalid('difficultyLevelId', 'no active difficulty level with this id');
    const catalogProduct = cfg.catalogProductId
      ? await db.catalogProduct.findFirst({ where: { publicId: cfg.catalogProductId, status: 'active' } })
      : null;
    if (cfg.catalogProductId && !catalogProduct)
      throw invalid('catalogProductId', 'no active catalogue product');

    const conditionsOf = (subPatternId: bigint | null): PatternGeometry['conditions'] => {
      const bySlot: Partial<Record<GeometrySlot, GeometryCondition[]>> = {};
      for (const g of pattern.geometryConditions.filter((c) => c.subPatternId === subPatternId)) {
        // Slots and determinants of the other calculators (corrugate `i j k m`, `w/l`) are not folding's.
        if (!isFoldingSlot(g.slot) || !isFoldingDeterminant(g.condition.determinant)) continue;
        const condition: GeometryCondition = {
          variable: g.condition.variable,
          determinant: g.condition.determinant,
          bands: [...g.condition.bandTable.bands]
            .sort((a, b) => Number(a.id - b.id))
            .map((b) => ({ lower: num0(b.lower), upper: num0(b.upper), value: num0(b.value) })),
        };
        (bySlot[g.slot] ??= []).push(condition);
      }
      return bySlot;
    };
    const standardBlanks = pattern.standardBlanks.map((b) => ({
      wMm: num0(b.standardSize.widthMm),
      lMm: num0(b.standardSize.lengthMm),
      dMm: num0(b.standardSize.heightMm),
      dwMm: num0(b.dwMm),
      dlMm: num0(b.dlMm),
    }));

    // One part per sub-pattern, or the pattern itself (legacy `input[]` by `sub_id`).
    const subs = pattern.subPatterns;
    if (
      subs.length === 0
        ? cfg.parts.length !== 1 || cfg.parts[0]!.subPatternId
        : cfg.parts.length !== subs.length
    ) {
      throw invalid(
        'parts',
        subs.length === 0
          ? 'this pattern has one part, without a subPatternId'
          : `configure each of the ${subs.length} parts`,
      );
    }
    const ids = await this.catalogIds(db, cfg);
    const parts: ResolvedFolding['parts'] = [];
    for (const [index, partCfg] of cfg.parts.entries()) {
      const sub = subs.length === 0 ? null : subs.find((s) => s.publicId === partCfg.subPatternId);
      if (subs.length > 0 && !sub) throw invalid(`parts[${index}].subPatternId`, 'not a part of the pattern');
      const formula = sub?.geometryFormula ?? pattern.geometryFormula;
      if (!formula) throw invalid('patternId', 'the pattern has no blank formula yet');
      // Sub-pattern size and orientation (`CSCombinetoFactory:621-637`).
      let { w, l, d } = cfg;
      if (sub) {
        const nl = num0(sub.nl);
        const nw = num0(sub.nw);
        const nh = num0(sub.nh);
        if (sub.swapDimensions) [l, w, d] = [cfg.w + nl, cfg.d + nw, cfg.l + nh];
        else [l, w, d] = [cfg.l + nl, cfg.w + nw, cfg.d + nh];
      }
      parts.push({
        key: sub ? sub.publicId : 'main',
        subPatternId: sub?.id ?? null,
        pattern: {
          formula,
          conditions: conditionsOf(sub?.geometryFormula ? sub.id : null),
          standardBlanks,
        },
        geometry: {
          w,
          l,
          d,
          x: cfg.x,
          c: cfg.c,
          isGrain: cfg.grainParallel !== undefined,
          grainParallel: cfg.grainParallel,
        },
        request: this.partRequest(partCfg, index, ids, material.id, difficulty.id, cfg.customCost === true),
      });
    }
    return {
      productTypeId: pattern.productTypeId,
      patternId: pattern.id,
      catalogProductId: catalogProduct?.id ?? null,
      materialId: material.id,
      materialGsm: num0(material.gsm),
      parts,
      patternKind: pattern.patternKind,
    };
  }

  private async catalogIds(db: Tx, cfg: FoldingConfiguration) {
    const inks = new Set<string>();
    const finishes = new Set<string>();
    const diecuts = new Set<string>();
    const assemblies = new Set<string>();
    for (const p of cfg.parts) {
      for (const c of [...(p.printFront ?? []), ...(p.printBack ?? [])]) inks.add(c.inkColourId);
      for (const f of [p.finish1FrontId, p.finish1BackId, ...(p.finish2 ?? []).map((x) => x.finishId)])
        if (f) finishes.add(f);
      if (p.diecutTypeId) diecuts.add(p.diecutTypeId);
      for (const a of p.assemblies ?? []) assemblies.add(a.assemblyId);
    }
    const [inkRows, finishRows, diecutRows, assemblyRows] = await Promise.all([
      db.inkColour.findMany({ where: { publicId: { in: [...inks] }, status: 'active' } }),
      db.finish.findMany({ where: { publicId: { in: [...finishes] }, status: 'active' } }),
      db.diecutType.findMany({ where: { publicId: { in: [...diecuts] }, status: 'active' } }),
      db.assembly.findMany({ where: { publicId: { in: [...assemblies] }, status: 'active' } }),
    ]);
    return {
      inks: new Map(inkRows.map((r) => [r.publicId, r])),
      finishes: new Map(finishRows.map((r) => [r.publicId, r])),
      diecuts: new Map(diecutRows.map((r) => [r.publicId, r])),
      assemblies: new Map(assemblyRows.map((r) => [r.publicId, r])),
    };
  }

  private partRequest(
    p: FoldingPartConfiguration,
    index: number,
    ids: Awaited<ReturnType<FoldingSnapshotLoader['catalogIds']>>,
    materialId: bigint,
    difficultyLevelId: bigint,
    customCost: boolean,
  ): PartRequest {
    const path = `parts[${index}]`;
    const fail = (field: string, message: string) =>
      new DomainException('validation.failed', {
        errors: [{ path: `${path}.${field}`, code: 'invalid', message }],
      });
    const colours = (
      list: FoldingPartConfiguration['printFront'],
      field: string,
    ): PrintColour[] | undefined =>
      list?.length
        ? list.map((c, i) => {
            const row = ids.inks.get(c.inkColourId);
            if (!row) throw fail(`${field}[${i}].inkColourId`, 'no active ink colour with this id');
            return { inkColourId: row.id.toString(), percent: c.percent };
          })
        : undefined;
    const finish1 = (publicId: string | undefined, field: string): string | undefined => {
      if (!publicId) return undefined;
      const row = ids.finishes.get(publicId);
      if (!row || !FINISH1_KINDS.has(row.finishKind))
        throw fail(field, 'finish 1 must be an active coating or lamination');
      return row.id.toString();
    };
    const finish2Ordered = (p.finish2 ?? []).map((f, i): [number, Finish2Request] => {
      const row = ids.finishes.get(f.finishId);
      if (!row || !FINISH2_ORDER.includes(row.finishKind)) {
        throw fail(`finish2[${i}].finishId`, 'finish 2 must be an active foil, spot UV, emboss or deboss');
      }
      if (row.requiresWidth && row.requiresLength && (!f.w?.length || f.w.length !== f.l?.length)) {
        throw fail(`finish2[${i}]`, 'this finish needs the width and length of each location');
      }
      return [
        FINISH2_ORDER.indexOf(row.finishKind),
        {
          finishId: row.id.toString(),
          requiresAmount: row.requiresAmount,
          requiresWidth: row.requiresWidth,
          requiresLength: row.requiresLength,
          ...(row.finishKind === 'foil' ? { isFoil: true } : {}),
          // Legacy carries the locations only for finishes that need an amount (`CSCombinetoFactory:709-716`).
          ...(row.requiresAmount ? { amount: f.amount, w: f.w, l: f.l } : {}),
        },
      ];
    });
    // Legacy processes finish 2 in a fixed order: foil, spot UV, emboss, deboss (`:702`).
    const finish2 = finish2Ordered.sort((a, b) => a[0] - b[0]).map(([, f]) => f);
    const assemblies: AssemblyRequest[] = (p.assemblies ?? []).map((a, i) => {
      const row = ids.assemblies.get(a.assemblyId);
      if (!row) throw fail(`assemblies[${i}].assemblyId`, 'no active assembly with this id');
      if (row.requiresWidth && row.requiresLength && (!a.w?.length || a.w.length !== a.l?.length)) {
        throw fail(`assemblies[${i}]`, 'this assembly needs the width and length of each part');
      }
      return {
        assemblyId: row.id.toString(),
        requiresAmount: row.requiresAmount,
        requiresWidth: row.requiresWidth,
        requiresLength: row.requiresLength,
        skipWaste: row.skipWaste,
        ...(row.requiresAmount ? { amount: a.amount, w: a.w, l: a.l } : {}),
      };
    });
    const diecut = p.diecutTypeId ? ids.diecuts.get(p.diecutTypeId) : undefined;
    if (p.diecutTypeId && !diecut) throw fail('diecutTypeId', 'no active die-cut type with this id');
    return {
      materialId: materialId.toString(),
      difficultyLevelId: difficultyLevelId.toString(),
      printFront: colours(p.printFront, 'printFront'),
      printBack: colours(p.printBack, 'printBack'),
      finish1FrontId: finish1(p.finish1FrontId, 'finish1FrontId'),
      finish1BackId: finish1(p.finish1BackId, 'finish1BackId'),
      finish2,
      diecutTypeId: diecut?.id.toString(),
      assemblies,
      customCost,
    };
  }

  // --- factory options -------------------------------------------------------------------------

  /** One option per print type the factory's price-list version has terms for. */
  async options(
    factory: { id: bigint; publicId: string },
    priceListVersionId: bigint,
    resolved: ResolvedFolding,
    at: Date,
    db: Tx = this.prisma,
  ): Promise<LoadedOption[]> {
    const v = priceListVersionId;
    const terms = await db.plPrintTypeTerm.findMany({
      where: { priceListVersionId: v },
      include: {
        printType: { select: { publicId: true } },
        priceListVersion: { select: { publicId: true } },
      },
      orderBy: { id: 'asc' },
    });
    const loaded: LoadedOption[] = [];
    const difficultyLevelId = BigInt(resolved.parts[0]!.request.difficultyLevelId);
    for (const t of terms) {
      const pt = t.printTypeId;
      const scoped = { priceListVersionId: v, printTypeId: pt, difficultyLevelId };
      const byId = { orderBy: { id: 'asc' as const } };
      const [
        trims,
        materialPrices,
        sizes,
        sheets,
        inks,
        exclusions,
        printWastes,
        finishWastes,
        diecutWastes,
        assemblyWastes,
        printPlates,
        printPrices,
        finishPrices,
        finishPlates,
        diecutPrices,
        diecutBlocks,
        assemblyPrices,
        assemblySheets,
        deltas,
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
        db.plPaperSheet.findMany({ where: { priceListVersionId: v }, ...byId }),
        db.plInkColour.findMany({ where: { priceListVersionId: v, printTypeId: pt }, ...byId }),
        db.plProcessExclusion.findMany({
          where: { priceListVersionId: v, materialId: resolved.materialId },
          ...byId,
        }),
        db.plPrintWaste.findMany({ where: scoped, ...byId }),
        db.plFinishWaste.findMany({ where: scoped, ...byId }),
        db.plDiecutWaste.findMany({ where: scoped, ...byId }),
        db.plAssemblyWaste.findMany({ where: scoped, ...byId }),
        db.plPrintPlate.findMany({ where: scoped, ...byId }),
        db.plPrintPrice.findMany({ where: scoped, ...byId }),
        db.plFinishPrice.findMany({ where: scoped, ...byId }),
        db.plFinishPlate.findMany({ where: scoped, orderBy: [{ plateWMaxIn: 'asc' }, { id: 'asc' }] }),
        db.plDiecutPrice.findMany({ where: scoped, ...byId }),
        db.plDiecutBlockPrice.findMany({ where: scoped, ...byId }),
        db.plAssemblyPrice.findMany({ where: { priceListVersionId: v, difficultyLevelId }, ...byId }),
        db.plAssemblySheet.findMany({ where: { priceListVersionId: v }, ...byId }),
        db.plPatternCondition.findMany({
          where: { priceListVersionId: v, patternId: resolved.patternId },
          ...byId,
        }),
      ]);
      const engine = t.engineVariant as FoldingEngine;
      const inkIds = new Set(inks.map((i) => i.inkColourId.toString()));
      const base = materialPrices.find((r) => r.minPaperAmount === null && r.maxPaperAmount === null);
      const problems: string[] = [];
      if (!trims) problems.push('paper_trims');
      if (!base) problems.push('material_prices');
      for (const part of resolved.parts) {
        for (const c of [...(part.request.printFront ?? []), ...(part.request.printBack ?? [])]) {
          if (!inkIds.has(c.inkColourId)) problems.push(`ink_colours ${c.inkColourId}`);
        }
      }
      const paperSheets: PaperSheet[] = [];
      for (const size of sizes) {
        for (const sheet of sheets.filter(
          (s) => s.sizeWIn.equals(size.sizeWIn) && s.sizeLIn.equals(size.sizeLIn),
        )) {
          paperSheets.push({
            sheetKey: sheet.lineKey,
            sizeWIn: num0(size.sizeWIn),
            sizeLIn: num0(size.sizeLIn),
            sheetCut: sheet.sheetCut,
            sheetWIn: num0(sheet.sheetWIn),
            sheetLIn: num0(sheet.sheetLIn),
            isFixGrain: sheet.isFixGrain,
            costPerKg: num0(base?.costPerKg),
            gsm: resolved.materialGsm,
          });
        }
      }
      const geometryTerms = {
        useMaxMinPaperTrim: engine !== 'b',
        canFlipPaperSize: t.canFlipPaperSize,
        disableOverlapLayout: t.disableOverlapLayout,
      };
      const parts: FoldingOption['parts'] = Object.fromEntries(
        resolved.parts.map((part) => {
          const delta = deltas.find((d) => d.subPatternId === part.subPatternId);
          const geometry: GeometrySnapshot = {
            pattern: part.pattern,
            paperTrim: {
              gap: num0(trims?.gapMm),
              trimW: num0(trims?.trimWMm),
              trimL: num0(trims?.trimLMm),
              edgeTrim: num0(trims?.edgeTrimMm),
              trimFoil: num0(trims?.trimFoilMm),
              trimFinishPlate: num0(trims?.trimFinishPlateMm),
            },
            patternDelta: delta ? { plusDl: num0(delta.plusDlMm), plusDw: num0(delta.plusDwMm) } : null,
            sheets: paperSheets,
            terms: geometryTerms,
          };
          const excl: ProcessExclusion[] = exclusions.map((e) =>
            e.process === 'finish'
              ? { process: 'finish', finishId: id(e.finishId)! }
              : e.process === 'assembly'
                ? { process: 'assembly', assemblyId: id(e.assemblyId)! }
                : { process: e.process as 'print_front' | 'print_back' },
          );
          return [part.key, { geometry, exclusions: excl }];
        }),
      );
      const band = (r: {
        minPaperSheetAmount: Prisma.Decimal | null;
        maxPaperSheetAmount: Prisma.Decimal | null;
      }) => ({
        minSheets: num(r.minPaperSheetAmount),
        maxSheets: num(r.maxPaperSheetAmount),
      });
      const waste = (r: { percentWaste: Prisma.Decimal; setupWaste: number }) => ({
        percentWaste: num0(r.percentWaste),
        setupWaste: r.setupWaste,
      });
      const offsetTerms = {
        wasteMethod: t.wasteMethod,
        finish2StepDownWaste: t.finish2StepDownWaste,
        fourColourPriceByMaxPercent: t.fourColourPriceByMaxPercent,
        assemblyWasteByAssembly: t.assemblyWasteByAssembly,
        diecutWasteByBoxAmount: t.diecutWasteByBoxAmount,
        factoryMarginPct: num0(t.factoryMarginPct),
      };
      const common = {
        printWastes: printWastes.map((r) => ({
          ...band(r),
          ...waste(r),
          minPercent: num(r.minPercentPrint),
          maxPercent: num(r.maxPercentPrint),
        })),
        finishWastes: finishWastes.map((r) => ({ ...band(r), ...waste(r), finishId: id(r.finishId) })),
        diecutWastes: diecutWastes.map((r) => ({
          ...band(r),
          ...waste(r),
          diecutTypeId: r.diecutTypeId.toString(),
          minBox: r.minBoxAmount,
          maxBox: r.maxBoxAmount,
        })),
        assemblyWastes: assemblyWastes.map((r) => ({
          ...band(r),
          ...waste(r),
          assemblyId: id(r.assemblyId),
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
          minBox: r.minBoxAmount,
          maxBox: r.maxBoxAmount,
          materialId: id(r.materialId),
          priceInkPerM2: num0(r.priceInkPerM2),
          addTwoSidePerSqm: num0(r.addTwoSidePerSqm),
        })),
        finishPrices: finishPrices.map((r) => ({
          ...band(r),
          finishId: r.finishId.toString(),
          machineId: id(r.machineId),
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
          ...band(r),
          machineId: r.machineId.toString(),
          diecutPrice: num0(r.diecutPrice),
          pricePerSheet: num0(r.pricePerSheet),
          operationCost: num0(r.operationCost),
          pricePerPcs: num0(r.pricePerPcs),
          minPrice: num0(r.minPrice),
        })),
        diecutBlocks: diecutBlocks.map((r) => ({
          machineId: r.machineId.toString(),
          wMin: num0(r.blockWMinIn),
          wMax: num0(r.blockWMaxIn),
          lMin: num0(r.blockLMinIn),
          lMax: num0(r.blockLMaxIn),
          layMin: r.layMin,
          layMax: r.layMax,
          diecutPrice: num0(r.diecutPrice),
          pricePerDrawing: num0(r.pricePerDrawing),
          minPcs: r.minPcs,
          maxPcs: r.maxPcs,
          pricePerPcs: num0(r.pricePerPcs),
          minDiecutPrice: num0(r.minDiecutPrice),
        })),
        assemblyPrices: assemblyPrices.map((r) => ({
          assemblyId: r.assemblyId.toString(),
          rangeMin: r.rangeAmountMin,
          rangeMax: r.rangeAmountMax,
          assemblyType: r.assemblyType as 1 | 2 | 3 | 4,
          addsDiecutWindow: r.addsDiecutWindow,
          pricePerCm: num0(r.pricePerCm),
          pricePerPcs: num0(r.pricePerPcs),
          minPrice: num0(r.minPrice),
          minimumOperation: num0(r.minimumOperation),
          blockPrice: num0(r.blockPrice),
          materialPricePerIn2: num0(r.materialPricePerIn2),
          printTypeId: id(r.printTypeId),
          minAreaSqcm: num(r.minAreaSqcm),
          maxAreaSqcm: num(r.maxAreaSqcm),
          digitalMethod: r.digitalMethod as 'per_piece' | 'per_piece_area_band' | 'per_carton',
        })),
      };
      const printPlateRows = printPlates.map((r) => ({
        machineId: r.machineId.toString(),
        wMin: num0(r.plateWMinIn),
        wMax: num0(r.plateWMaxIn),
        lMin: num0(r.plateLMinIn),
        lMax: num0(r.plateLMaxIn),
        platePrice: num0(r.platePrice),
      }));
      const tables: OffsetTables | DigitalTables | BTables =
        engine === 'b'
          ? await this.bTables(v, pt, difficultyLevelId, num0(t.factoryMarginPct), common, printPlateRows, db)
          : engine === 'a_digital'
            ? {
                ...common,
                terms: {
                  ...offsetTerms,
                  paperMethod: t.digitalPaperMethod as DigitalTables['terms']['paperMethod'],
                  trimDlMm: num0(t.trimDlMm),
                  trimDwMm: num0(t.trimDwMm),
                  usePaperAmountForCal: t.usePaperAmountForCal,
                  printMethod: t.digitalPrintMethod as DigitalTables['terms']['printMethod'],
                  printBand: t.digitalPrintBand as DigitalTables['terms']['printBand'],
                  printByMaterial: t.digitalPrintByMaterial,
                  finishMethod: t.digitalFinishMethod as DigitalTables['terms']['finishMethod'],
                  diecutBlock: t.digitalDiecutBlock as DigitalTables['terms']['diecutBlock'],
                  costMultiplier: num0(t.costMultiplier),
                  minLotPrice: num(t.minLotPrice),
                },
                printTypeId: pt.toString(),
                materialPrices: materialPrices.map((r) => ({
                  minPaperAmount: r.minPaperAmount,
                  maxPaperAmount: r.maxPaperAmount,
                  costPerKg: num(r.costPerKg),
                  costPerPcs: num(r.costPerPcs),
                  costPerM2: num(r.costPerM2),
                })),
              }
            : {
                ...common,
                terms: offsetTerms,
                standardInkColours: new Set(
                  inks.filter((i) => i.isStandard).map((i) => i.inkColourId.toString()),
                ),
                printPlates: printPlateRows,
                finishPlates: finishPlates.map((r) => ({
                  finishId: r.finishId.toString(),
                  machineId: r.machineId.toString(),
                  wMin: num0(r.plateWMinIn),
                  wMax: num0(r.plateWMaxIn),
                  lMin: num0(r.plateLMinIn),
                  lMax: num0(r.plateLMaxIn),
                  pricePerIn2: num0(r.pricePerIn2),
                  minPlatePrice: num0(r.minPlatePrice),
                })),
                assemblySheets: assemblySheets.map((r) => ({ wIn: num0(r.sheetWIn), lIn: num0(r.sheetLIn) })),
                patternKind: resolved.patternKind,
              };
      const sell = await this.sell(resolved.productTypeId, pt, at, db);
      loaded.push({
        priceListVersionId: v,
        priceListVersionPublicId: t.priceListVersion.publicId,
        printTypePublicId: t.printType.publicId,
        sellMarginVersionIds: sell.versionIds,
        vatRateVersionId: sell.vatRateVersionId,
        option: {
          optionKey: `${factory.publicId}:${t.printType.publicId}`,
          factoryId: factory.publicId,
          printTypeId: pt.toString(),
          engine,
          leadTimeDays: num(t.leadTimeDays),
          bulkLeadTime:
            t.bulkLeadTimeMinQty !== null && t.bulkLeadTimeDays !== null
              ? { minQty: t.bulkLeadTimeMinQty, days: num0(t.bulkLeadTimeDays) }
              : null,
          minOrderForProduction: t.minOrderForProduction,
          tables,
          parts,
          sell: sell.snapshot,
          unavailable: problems,
        },
      });
    }
    return loaded;
  }

  /**
   * Engine B's tables for one print type (U-B6 tail, D-233): its own components (schema-design A-76) and engine A's
   * waste, finish, die-cut and plate lines of the same print type. Code margins come ordered by their range.
   */
  private async bTables(
    v: bigint,
    pt: bigint,
    difficultyLevelId: bigint,
    factoryMarginPct: number,
    common: Pick<
      BTables,
      'finishWastes' | 'diecutWastes' | 'assemblyWastes' | 'finishPrices' | 'diecutPrices' | 'diecutBlocks'
    >,
    printPlates: BTables['printPlates'],
    db: Tx,
  ): Promise<BTables> {
    const scoped = { priceListVersionId: v, printTypeId: pt, difficultyLevelId };
    const byId = { orderBy: { id: 'asc' as const } };
    const [printWastes, printPrices, foilPrices, assemblyPrices, codeMargins] = await Promise.all([
      db.plBPrintWaste.findMany({ where: scoped, ...byId }),
      db.plBPrintPrice.findMany({ where: scoped, ...byId }),
      db.plFoilPrice.findMany({ where: scoped, ...byId }),
      db.plBAssemblyPrice.findMany({ where: scoped, ...byId }),
      db.plCodeMargin.findMany({
        where: { priceListVersionId: v, printTypeId: pt },
        orderBy: [{ maxRangeContPct: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return {
      terms: { factoryMarginPct },
      printWastes: printWastes.map((r) => ({
        inkColourId: r.inkColourId.toString(),
        colourCount: r.colourCount,
        percentWaste: num0(r.percentWaste),
        setupWaste: r.setupWaste,
      })),
      finishWastes: common.finishWastes,
      diecutWastes: common.diecutWastes,
      assemblyWastes: common.assemblyWastes,
      printPlates,
      printPrices: printPrices.map((r) => ({
        machineId: r.machineId.toString(),
        inkColourId: r.inkColourId.toString(),
        colourCount: r.colourCount,
        priceInkPerM2: num0(r.priceInkPerM2),
        priceColorCombineSpecialColor: num0(r.priceColorCombineSpecialColor),
      })),
      finishPrices: common.finishPrices,
      foilPrices: foilPrices.map((r) => ({
        finishId: r.finishId.toString(),
        priceByAreaPerIn2: num0(r.priceByAreaPerIn2),
        bahtPerRoll: num0(r.bahtPerRoll),
        rollWidthIn: num0(r.rollWidthIn),
        rollLengthIn: num0(r.rollLengthIn),
        wMin: num0(r.blockWMinIn),
        wMax: num0(r.blockWMaxIn),
        lMin: num0(r.blockLMinIn),
        lMax: num0(r.blockLMaxIn),
        toolingPrice: num0(r.toolingPrice),
      })),
      diecutPrices: common.diecutPrices,
      diecutBlocks: common.diecutBlocks,
      assemblyPrices: assemblyPrices.map((r) => ({
        assemblyId: r.assemblyId.toString(),
        rangeMin: r.rangeAmountMin,
        rangeMax: r.rangeAmountMax,
        assemblyType: r.assemblyType as 1 | 2 | 3 | 4,
        pricePerDepthM: num0(r.pricePerDepthM),
        minPricePerAreaIn2: num0(r.minPricePerAreaIn2),
        pricePerPcs: num0(r.pricePerPcs),
        minPrice: num0(r.minPrice),
        blockPrice: num0(r.blockPrice),
        materialPricePerIn2: num0(r.materialPricePerIn2),
      })),
      codeMargins: codeMargins.map((r) => ({
        maxRangeContPct: num0(r.maxRangeContPct),
        minContBahtPerLot: num0(r.minContBahtPerLot),
        codeName: r.codeName,
      })),
    };
  }

  // --- sell side -------------------------------------------------------------------------------

  /** Packio's sell side at `at` (shared with every calculator, `shared/sell-snapshot.ts`). */
  sell(productTypeId: bigint, printTypeId: bigint, at: Date, db: Tx = this.prisma): Promise<LoadedSell> {
    return loadSellSnapshot(db, productTypeId, printTypeId, at);
  }
}
