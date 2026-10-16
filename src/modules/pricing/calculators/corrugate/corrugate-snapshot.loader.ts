import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';

import { type LoadedSell, loadSellSnapshot } from '../shared/sell-snapshot';
import { type AssemblyRequest } from './assemblies';
import {
  type CorrugateOption,
  type CorrugatePart,
  type CorrugatePrintColour,
  type FixedOption,
} from './corrugate-calculator';
import { CORRUGATE_CONDITION_DETERMINANTS } from './formulas';
import { type ConditionBands, type FluteFactors, type PrintArea } from './geometry';

/**
 * Loads what the corrugate calculator reads (U-B6): the configuration resolved against the platform
 * catalogue — pattern and parts with their corrugate formulas, the board and its flute, the condition bands,
 * the standard size (legacy `recheckStandardSize`, calculation size `calculate_cs:661-699`) — and per factory
 * price-list version one option per corrugate print type with its rows in line order (quirk C18) and getpack's
 * sell side (`priceMaxInclusive`, `CorrugateCalculator.php:883,894`). Every version id used is returned.
 */

export interface CorrugatePartConfiguration {
  subPatternId?: string;
  printFront?: readonly { inkColourId: string; area?: PrintArea; percent?: number }[];
  printBack?: readonly { inkColourId: string; area?: PrintArea; percent?: number }[];
  coatingFrontId?: string;
  coatingBackId?: string;
  assemblies?: readonly { assemblyId: string; amount?: number; w?: number; l?: number }[];
}

/** A corrugate configuration as the API receives it: catalogue public ids, millimetres. */
export interface CorrugateConfiguration {
  patternId: string;
  catalogProductId?: string;
  w: number;
  l: number;
  d: number;
  /** The board (a `corrugated_board` material; its flute is the box's flute). */
  materialId: string;
  difficultyLevelId: string;
  quantities: readonly number[];
  parts: readonly CorrugatePartConfiguration[];
  design?: { graphic: boolean; structure: boolean };
  /** Digital front coverage % (legacy CS `printing_calculate_type` 2). */
  digitalFrontCoveragePct?: number;
}

export interface ResolvedCorrugate {
  productTypeId: bigint;
  patternId: bigint;
  catalogProductId: bigint | null;
  materialId: bigint;
  materialGsm: number;
  materialCoatable: boolean;
  difficultyLevelId: bigint;
  fluteTypeId: bigint;
  flute: FluteFactors;
  /** The size priced (a standard size's calculation dimensions applied). */
  size: { w: number; l: number; d: number };
  standardSize: boolean;
  conditions: ConditionBands;
  parts: (CorrugatePart & { subPatternId: bigint | null })[];
  autoAssemblies: AssemblyRequest[];
  digitalFrontCoveragePct: number | null;
}

export interface LoadedCorrugateOption {
  option: CorrugateOption;
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

/** Coatings are finish-1 kinds (legacy corrugate `mapping_inputs` type 4). */
const COATING_KINDS = new Set(['coating', 'lamination']);
/** Legacy condition variables and the dimension each is read by (`CalculatorCorrugate.php:309-312`). */
const CONDITION_DETERMINANTS = CORRUGATE_CONDITION_DETERMINANTS;

@Injectable()
export class CorrugateSnapshotLoader {
  constructor(private readonly prisma: PrismaService) {}

  // --- configuration ---------------------------------------------------------------------------

  async resolve(cfg: CorrugateConfiguration, db: Tx = this.prisma): Promise<ResolvedCorrugate> {
    const invalid = (path: string, message: string) =>
      new DomainException('validation.failed', { errors: [{ path, code: 'invalid', message }] });
    const pattern = await db.pattern.findFirst({
      where: { publicId: cfg.patternId, status: 'active', productType: { calculatorKey: 'corrugate' } },
      include: {
        subPatterns: { orderBy: { seq: 'asc' } },
        fluteTypes: true,
        geometryConditions: {
          where: { subPatternId: null, slot: { in: ['i', 'j', 'k', 'm'] } },
          include: { condition: { include: { bandTable: { include: { bands: true } } } } },
          orderBy: [{ slot: 'asc' }, { seq: 'asc' }],
        },
      },
    });
    if (!pattern) throw invalid('patternId', 'no active corrugate pattern with this id');
    const material = await db.material.findFirst({
      where: { publicId: cfg.materialId, status: 'active', kind: 'corrugated_board' },
      include: { fluteType: true },
    });
    if (!material) throw invalid('materialId', 'no active corrugated board with this id');
    const flute = material.fluteType;
    if (!flute || flute.status !== 'active') throw invalid('materialId', 'the board has no active flute');
    if (pattern.fluteTypes.length > 0 && !pattern.fluteTypes.some((f) => f.fluteTypeId === flute.id)) {
      throw invalid('materialId', "the board's flute is not offered for this pattern");
    }
    if ([flute.colA, flute.colC, flute.colG, flute.colFh].some((v) => v === null)) {
      throw invalid('materialId', "the board's flute has no take-up factors yet");
    }
    const difficulty = await db.difficultyLevel.findFirst({
      where: { publicId: cfg.difficultyLevelId, status: 'active' },
    });
    if (!difficulty) throw invalid('difficultyLevelId', 'no active difficulty level with this id');
    const catalogProduct = cfg.catalogProductId
      ? await db.catalogProduct.findFirst({ where: { publicId: cfg.catalogProductId, status: 'active' } })
      : null;
    if (cfg.catalogProductId && !catalogProduct)
      throw invalid('catalogProductId', 'no active catalogue product');

    // Standard size of the product (legacy compares W / L / H in cm, `Converter::recheckStandardSize:418`);
    // its calculation size applies for the flute it was measured for (`calculate_cs:695-699`, quirk C12).
    const standard = catalogProduct
      ? await db.standardSize.findFirst({
          where: {
            catalogProductId: catalogProduct.id,
            status: 'active',
            lengthMm: cfg.l,
            widthMm: cfg.w,
            heightMm: cfg.d,
          },
          orderBy: { id: 'asc' },
        })
      : null;
    let size = { w: cfg.w, l: cfg.l, d: cfg.d };
    if (
      standard &&
      num0(standard.calcWidthMm) > 0 &&
      num0(standard.calcLengthMm) > 0 &&
      (standard.calcFluteTypeId === null || standard.calcFluteTypeId === flute.id)
    ) {
      size = {
        w: num0(standard.calcWidthMm),
        l: num0(standard.calcLengthMm),
        d: num(standard.calcHeightMm) ?? cfg.d,
      };
    }

    const conditions: ConditionBands = {};
    for (const g of pattern.geometryConditions) {
      const slot = g.slot as keyof typeof CONDITION_DETERMINANTS;
      if (conditions[slot]) continue;
      if (g.condition.determinant !== CONDITION_DETERMINANTS[slot]) {
        throw invalid('patternId', `condition ${slot} must be read by ${CONDITION_DETERMINANTS[slot]}`);
      }
      conditions[slot] = [...g.condition.bandTable.bands]
        .sort((a, b) => Number(a.id - b.id))
        .map((b) => ({ lower: num0(b.lower), upper: num0(b.upper), value: num0(b.value) }));
    }

    // One part per sub-pattern, or the pattern itself (legacy `sub_patterns[]` by `sub_id`).
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
    const seen = new Set<string>();
    const parts: ResolvedCorrugate['parts'] = [];
    for (const [index, partCfg] of cfg.parts.entries()) {
      const path = `parts[${index}]`;
      const sub = subs.length === 0 ? null : subs.find((s) => s.publicId === partCfg.subPatternId);
      if (subs.length > 0 && !sub) throw invalid(`${path}.subPatternId`, 'not a part of the pattern');
      if (sub && seen.has(sub.publicId)) throw invalid(`${path}.subPatternId`, 'configured twice');
      if (sub) seen.add(sub.publicId);
      const formula = sub?.corrugateFormula ?? pattern.corrugateFormula;
      if (!formula) throw invalid('patternId', 'the pattern has no corrugate blank formula yet');
      const colours = (
        list: CorrugatePartConfiguration['printFront'],
        field: string,
      ): CorrugatePrintColour[] =>
        (list ?? []).map((c, i) => {
          const row = ids.inks.get(c.inkColourId);
          if (!row) throw invalid(`${path}.${field}[${i}].inkColourId`, 'no active ink colour with this id');
          if (c.area === undefined && c.percent === undefined) {
            throw invalid(`${path}.${field}[${i}]`, 'give the print area or the % of the blank');
          }
          return { inkColourId: row.id.toString(), area: c.area ?? null, percent: c.percent ?? null };
        });
      const coating = (publicId: string | undefined, field: string): string | null => {
        if (!publicId) return null;
        const row = ids.finishes.get(publicId);
        if (!row || !COATING_KINDS.has(row.finishKind))
          throw invalid(`${path}.${field}`, 'must be an active coating');
        return row.id.toString();
      };
      const assemblies: AssemblyRequest[] = (partCfg.assemblies ?? []).map((a, i) => {
        const row = ids.assemblies.get(a.assemblyId);
        if (!row) throw invalid(`${path}.assemblies[${i}].assemblyId`, 'no active assembly with this id');
        if (row.autoAdd)
          throw invalid(`${path}.assemblies[${i}].assemblyId`, 'this assembly is added automatically');
        if (row.requiresAmount && (a.amount === undefined || a.w === undefined || a.l === undefined)) {
          throw invalid(
            `${path}.assemblies[${i}]`,
            'this assembly needs the amount, width and length of its pieces',
          );
        }
        return {
          assemblyId: row.id.toString(),
          requiresAmount: row.requiresAmount,
          autoAdd: false,
          ...(a.amount !== undefined ? { amount: a.amount } : {}),
          ...(a.w !== undefined ? { w: a.w } : {}),
          ...(a.l !== undefined ? { l: a.l } : {}),
        };
      });
      parts.push({
        key: sub ? sub.publicId : 'main',
        subPatternId: sub?.id ?? null,
        formula,
        printFront: colours(partCfg.printFront, 'printFront'),
        printBack: colours(partCfg.printBack, 'printBack'),
        coatingFrontId: coating(partCfg.coatingFrontId, 'coatingFrontId'),
        coatingBackId: coating(partCfg.coatingBackId, 'coatingBackId'),
        assemblies,
      });
    }
    const auto = await db.assembly.findMany({
      where: { status: 'active', autoAdd: true },
      orderBy: { id: 'asc' },
    });
    return {
      productTypeId: pattern.productTypeId,
      patternId: pattern.id,
      catalogProductId: catalogProduct?.id ?? null,
      materialId: material.id,
      materialGsm: num0(material.gsm),
      materialCoatable: material.coatable,
      difficultyLevelId: difficulty.id,
      fluteTypeId: flute.id,
      flute: {
        a: num0(flute.colA),
        c: num0(flute.colC),
        dd: num0(flute.colDd),
        g: num0(flute.colG),
        fh: num0(flute.colFh),
        ct: num0(flute.ct),
        z: num0(flute.z),
      },
      size,
      standardSize: standard !== null,
      conditions,
      parts,
      autoAssemblies: auto.map((a) => ({
        assemblyId: a.id.toString(),
        requiresAmount: false,
        autoAdd: true,
      })),
      digitalFrontCoveragePct: cfg.digitalFrontCoveragePct ?? null,
    };
  }

  private async catalogIds(db: Tx, cfg: CorrugateConfiguration) {
    const inks = new Set<string>();
    const finishes = new Set<string>();
    const assemblies = new Set<string>();
    for (const p of cfg.parts) {
      for (const c of [...(p.printFront ?? []), ...(p.printBack ?? [])]) inks.add(c.inkColourId);
      for (const f of [p.coatingFrontId, p.coatingBackId]) if (f) finishes.add(f);
      for (const a of p.assemblies ?? []) assemblies.add(a.assemblyId);
    }
    const [inkRows, finishRows, assemblyRows] = await Promise.all([
      db.inkColour.findMany({ where: { publicId: { in: [...inks] }, status: 'active' } }),
      db.finish.findMany({ where: { publicId: { in: [...finishes] }, status: 'active' } }),
      db.assembly.findMany({ where: { publicId: { in: [...assemblies] }, status: 'active' } }),
    ]);
    return {
      inks: new Map(inkRows.map((r) => [r.publicId, r])),
      finishes: new Map(finishRows.map((r) => [r.publicId, r])),
      assemblies: new Map(assemblyRows.map((r) => [r.publicId, r])),
    };
  }

  // --- factory options -------------------------------------------------------------------------

  /** One option per corrugate print type the factory's price-list version has terms for. */
  async options(
    factory: { id: bigint; publicId: string },
    priceListVersionId: bigint,
    resolved: ResolvedCorrugate,
    at: Date,
    db: Tx = this.prisma,
  ): Promise<LoadedCorrugateOption[]> {
    const v = priceListVersionId;
    const byId = { orderBy: { id: 'asc' as const } };
    const terms = await db.plCorrugatePrintTypeTerm.findMany({
      where: { priceListVersionId: v },
      include: {
        printType: { select: { publicId: true } },
        priceListVersion: { select: { publicId: true } },
      },
      ...byId,
    });
    const difficultyLevelId = resolved.difficultyLevelId;
    const [rolls, reduces, patternConditions, fixed] = await Promise.all([
      db.plPaperRollWidth.findMany({
        where: { priceListVersionId: v },
        orderBy: [{ widthIn: 'asc' }, { id: 'asc' }],
      }),
      db.plPercentReduce.findMany({ where: { priceListVersionId: v }, ...byId }),
      db.plCorrugatePatternCondition.findMany({
        where: { priceListVersionId: v, patternId: resolved.patternId, fluteTypeId: resolved.fluteTypeId },
        ...byId,
      }),
      db.plCorrugateFixedOption.findMany({
        where: { priceListVersionId: v, patternId: resolved.patternId },
        include: { assembly: true },
        ...byId,
      }),
    ]);
    const fixedOptions: FixedOption[] = fixed.flatMap((f) => {
      const part = resolved.parts.find((p) => p.subPatternId === f.subPatternId);
      if (!part) return [];
      return [
        {
          partKey: part.key,
          boxStyle: f.boxStyle as FixedOption['boxStyle'],
          // Legacy passes only the assembly id (`:683`): no pieces, no material.
          assembly: f.assembly
            ? { assemblyId: f.assembly.id.toString(), requiresAmount: false, autoAdd: f.assembly.autoAdd }
            : null,
          deliveryRounds: f.deliveryRounds,
        },
      ];
    });
    const conditionsByPart = Object.fromEntries(
      resolved.parts.map((p) => {
        const row = patternConditions.find((c) => c.subPatternId === p.subPatternId);
        return [p.key, row ? { dl: num0(row.plusDlMm), dw: num0(row.plusDwMm) } : null];
      }),
    );

    const loaded: LoadedCorrugateOption[] = [];
    for (const t of terms) {
      const pt = t.printTypeId;
      const scoped = { priceListVersionId: v, printTypeId: pt };
      const [
        process,
        boards,
        difficultyRow,
        margins,
        blocks,
        printPrices,
        finishPrices,
        diecutPrices,
        fixCostPcts,
        assemblyPrices,
        sheetSizes,
        inks,
        trim,
      ] = await Promise.all([
        db.plCorrugateProcessTerm.findFirst({
          where: { ...scoped, fluteTypeId: resolved.fluteTypeId },
          ...byId,
        }),
        db.plBoardPrice.findMany({
          where: { ...scoped, materialId: resolved.materialId },
          orderBy: [{ minSheet: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
        }),
        db.plDifficultyLevel.findFirst({ where: { ...scoped, difficultyLevelId }, ...byId }),
        db.plDifficultyMargin.findMany({ where: { ...scoped, difficultyLevelId }, ...byId }),
        db.plCorrugateDieBlock.findMany({
          where: { ...scoped, OR: [{ fluteTypeId: null }, { fluteTypeId: resolved.fluteTypeId }] },
          ...byId,
        }),
        db.plCorrugatePrintPrice.findMany({ where: scoped, ...byId }),
        db.plFinishPrice.findMany({ where: { ...scoped, difficultyLevelId }, ...byId }),
        db.plCorrugateDiecutPrice.findMany({ where: { ...scoped, difficultyLevelId }, ...byId }),
        db.plFixCostPct.findMany({ where: scoped, ...byId }),
        db.plCorrugateAssemblyPrice.findMany({ where: scoped, ...byId }),
        db.plPaperSize.findMany({ where: { ...scoped, materialId: resolved.materialId }, ...byId }),
        db.plInkColour.findMany({ where: scoped, ...byId }),
        db.plPaperTrim.findFirst({ where: scoped, ...byId }),
      ]);
      const sell: LoadedSell = await loadSellSnapshot(db, resolved.productTypeId, pt, at, {
        priceMaxInclusive: true,
      });
      const option: CorrugateOption = {
        optionKey: `${factory.publicId}:${t.printType.publicId}`,
        factoryId: factory.publicId,
        printTypeId: pt.toString(),
        engine: t.engineVariant as CorrugateOption['engine'],
        leadTimeDays: num(t.leadTimeDays),
        bulkLeadTime:
          t.bulkLeadTimeMinQty !== null && t.bulkLeadTimeDays !== null
            ? { minQty: t.bulkLeadTimeMinQty, days: num0(t.bulkLeadTimeDays) }
            : null,
        minOrderAmount: t.minOrderAmount,
        maxColours: t.maxColours,
        printArea: { method: t.patternAreaPercentMethod, topSideCombined: t.topSideCombined },
        packing: {
          rscFamilyPerPcs: num(t.packingPriceRscPerPcs),
          otherPerPcs: num(t.packingPriceOtherPerPcs),
          freeOnRsc: t.packingFreeOnRsc,
        },
        engineTerms: { factoryMarginPct: num0(t.factoryMarginPct), paperCut: t.paperCut },
        digitalTerms: {
          factoryMarginPct: num0(t.factoryMarginPct),
          trimDlMm: num0(t.trimDlMm),
          trimDwMm: num0(t.trimDwMm),
          printFixCostPerSqm: num(t.printFixCostPerSqm),
          nonPrintFixCostPerSqm: num(t.nonPrintFixCostPerSqm),
          paperPriceByOrderAmount: t.paperPriceByOrderAmount,
          digitalDieBlock: t.digitalDieBlock,
          minLotPrice: num(t.minLotPrice),
          backPrintPricePerM2: num(t.digitalBackPrintPricePerM2),
          twoSideAddon: t.digitalTwoSideAddon,
        },
        process: process
          ? {
              trimMm: num0(process.trimMm),
              minLengthM: num0(process.minLengthM),
              minSheet: process.minSheet,
              widthLayoutMax: process.widthLayoutMax,
              plRscMinIn: num0(process.plRscMinIn),
              plRscMaxIn: num0(process.plRscMaxIn),
              pwRscMinIn: num0(process.pwRscMinIn),
              pwRscMaxIn: num0(process.pwRscMaxIn),
              minRscFlapMm: num0(process.minRscFlapMm),
              minRscSlhMm: num0(process.minRscSlhMm),
              minSllMm: num0(process.minSllMm),
              minSlwMm: num0(process.minSlwMm),
              gapMm: num0(process.gapMm),
              tlMm: num0(process.tlMm),
              twMm: num0(process.twMm),
              minLengthLayoutSlot: num0(process.minLengthLayoutSlot),
            }
          : null,
        rollWidthsIn: rolls.map((r) => num0(r.widthIn)),
        boardPrices: boards.map((b) => ({
          minSheet: b.minSheet,
          maxSheet: b.maxSheet,
          pricePerSqft: num0(b.pricePerSqft),
        })),
        difficulty: difficultyRow
          ? {
              printPlatePricePerIn2: num0(difficultyRow.printPlatePricePerIn2),
              minPricePerPcs: num0(difficultyRow.minPricePerPcs),
              printWastePct: num0(difficultyRow.printWastePct),
              printSetupSheets: difficultyRow.printSetupSheets,
              diecutWastePct: num0(difficultyRow.diecutWastePct),
              diecutWasteSheets: difficultyRow.diecutWasteSheets,
              assemblyWastePct: num0(difficultyRow.assemblyWastePct),
              assemblySetupSheets: difficultyRow.assemblySetupSheets,
            }
          : null,
        margins: margins.map((m) => ({
          colourAmount: m.colourAmount,
          percentMargin: num0(m.percentMargin),
          minMarginPerPcs: num0(m.minMarginPerPcs),
          minMarginPerJob: num0(m.minMarginPerJob),
        })),
        percentReduces: reduces.map((r) => ({ minPrice: num0(r.minPrice), percent: num0(r.percent) })),
        flexoDieBlocks: blocks
          .filter((b) => b.kind === 'flexo')
          .map((b) => ({
            blockMaxWIn: num0(b.blockMaxWIn),
            blockMaxLIn: num0(b.blockMaxLIn),
            sideType: b.sideType,
            blockPrice: num0(b.blockPrice),
            min1layDiecutPrice: num(b.min1layDiecutPrice),
            stepDiecutPrice: num(b.stepDiecutPrice),
            pricePerPcs: num(b.pricePerPcs),
            minDiecutPrice: num(b.minDiecutPrice),
            deliveryCost: num(b.deliveryCost),
          })),
        digital: {
          sheetSizes: sheetSizes.map((s) => ({ wIn: num0(s.sizeWIn), lIn: num0(s.sizeLIn) })),
          printPrices: printPrices.map((p) => ({
            inkColourId: p.inkColourId.toString(),
            materialId: p.materialId?.toString() ?? null,
            minQty: p.minQty,
            maxQty: p.maxQty,
            pricePerM2: num0(p.pricePerM2),
            addTwoSidePerSqm: num(p.addTwoSidePerSqm),
          })),
          finishPrices: finishPrices
            .filter((f) => f.priceByAreaPerIn2 !== null)
            .map((f) => ({ finishId: f.finishId.toString(), priceByAreaPerIn2: num0(f.priceByAreaPerIn2) })),
          diecutPrices: diecutPrices.map((d) => ({
            minQty: d.minQty,
            maxQty: d.maxQty,
            pricePerJob: num(d.pricePerJob),
            pricePerPcs: num(d.pricePerPcs),
            pricePerM2: num(d.pricePerM2),
          })),
          dieBlocks: blocks
            .filter((b) => b.kind === 'digital')
            .map((b) => ({ minPcs: b.minPcs, maxPcs: b.maxPcs, pricePerSqm: num0(b.pricePerSqm) })),
          fixCostPcts: fixCostPcts.map((f) => ({
            basis: f.basis as 'box_area_sqm' | 'pcs',
            minValue: num(f.minValue),
            maxValue: num(f.maxValue),
            percent: num0(f.percent),
          })),
        },
        assemblyPrices: assemblyPrices.map((a) => ({
          assemblyId: a.assemblyId.toString(),
          rangeMin: a.rangeMin,
          rangeMax: a.rangeMax,
          minAreaSqcm: num(a.minAreaSqcm),
          maxAreaSqcm: num(a.maxAreaSqcm),
          minDlMm: num(a.minDlMm),
          maxDlMm: num(a.maxDlMm),
          method: a.method as 'per_piece' | 'per_area_piece',
          pricePerPcs: num0(a.pricePerPcs),
          minPrice: num(a.minPrice),
          materialPricePerIn2: num(a.materialPricePerIn2),
        })),
        trimFinishPlateMm: trim ? num0(trim.trimFinishPlateMm) : null,
        inkColours: new Set(inks.map((i) => i.inkColourId.toString())),
        patternConditions: conditionsByPart,
        fixedOptions,
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
