import { phpRound } from '../../engine/php';
import { type Calculator } from '../calculator';
import { PricingError } from '../shared/pricing-error';
import { type ForSale, saleMargin, type SellSnapshot } from '../shared/sell';
import { type ToolingAmounts, type ToolingWaive } from '../shared/tooling';
import { assemblyCost, type AssemblyLine, type AssemblyRequest, type PackingTerms } from './assemblies';
import { type DigitalLayout, type DigitalTables, priceDigitalPart } from './digital';
import { type FlexoLayout, type FlexoTables, priceFlexoPart } from './flexo';
import {
  type Blank,
  blank,
  type ConditionBands,
  type CorrugateFormula,
  type FluteFactors,
  isRsc,
  type PrintArea,
  printAreaPercent,
  type PrintAreaTerms,
} from './geometry';
import {
  type AssemblyPrice,
  type BoardPrice,
  type DifficultyMargin,
  type DifficultyTerms,
  type EngineTerms,
  type FlexoDieBlock,
  type PercentReduce,
  type ProcessTerms,
} from './tables';

/**
 * The corrugate calculator (U-B6): legacy `CorrugateCalculator::calculate_cs:310-1097` as a pure function over
 * options (factory × print type). Every part of a combination product (Tele body + lid, slide tray + sleeve)
 * is priced by its engine, the first layout kept (`:768`), getpack's sell side applied per part with the plates
 * and die block added at the factory's price × VAT (`:835-837, :937`), the design fees once per quote (quirk
 * C14). An option is complete for a quantity only when every part is (C17). Pure: no database or clock.
 */

export const CORRUGATE_CALCULATOR_VERSION = '1.0.0';

export interface CorrugatePrintColour {
  inkColourId: string;
  /** Where it prints (legacy pattern areas 36–39); the % of the blank follows from the geometry. */
  area: PrintArea | null;
  /** Or the % of the blank it covers (legacy colour `percent`). */
  percent: number | null;
}

export interface CorrugatePart {
  /** Sub-pattern public id, or `main`. */
  key: string;
  formula: CorrugateFormula;
  printFront: readonly CorrugatePrintColour[];
  printBack: readonly CorrugatePrintColour[];
  coatingFrontId: string | null;
  coatingBackId: string | null;
  /** Requested assemblies (the automatic ones and the factory's fixed options are added per option). */
  assemblies: readonly AssemblyRequest[];
}

export interface CorrugateInput {
  quantities: readonly number[];
  parts: readonly CorrugatePart[];
  design: { graphic: boolean; structure: boolean };
  /** Box size in mm (a standard size's calculation dimensions already applied). */
  size: { w: number; l: number; d: number };
  flute: FluteFactors;
  materialId: string;
  /** Legacy `paper_grade.can_finish` (`calculate_cs:569`). */
  materialCoatable: boolean;
  conditions: ConditionBands;
  /** The size is one of the product's standard sizes: no die block (`recheck_standard_size`). */
  standardSize: boolean;
  /** Catalogue assemblies added to every part (legacy packing group 22, quirk C8). */
  autoAssemblies: readonly AssemblyRequest[];
  /** Digital front coverage % (legacy CS `printing_calculate_type` 2); null = type 1. */
  digitalFrontCoveragePct: number | null;
  /**
   * D-289: tooling a reorder reuses, per factory public id — those plates / die blocks are neither charged nor
   * bought at that factory. Set only by the reorder path.
   */
  waiveTooling?: Readonly<Record<string, ToolingWaive>>;
}

export type CorrugateEngine = 'flexo' | 'digital';

/** A fixed option of the factory for a part (legacy `fixed_options`, `:672-689`). */
export interface FixedOption {
  partKey: string;
  boxStyle: 'rsc' | 'die_cut';
  assembly: AssemblyRequest | null;
  deliveryRounds: number | null;
}

export interface CorrugateOption {
  optionKey: string;
  factoryId: string;
  printTypeId: string;
  engine: CorrugateEngine;
  leadTimeDays: number | null;
  bulkLeadTime: { minQty: number; days: number } | null;
  minOrderAmount: number | null;
  /** Legacy `factory.max_amount_color`; null = no limit. */
  maxColours: number | null;
  printArea: PrintAreaTerms;
  packing: PackingTerms;
  engineTerms: EngineTerms;
  digitalTerms: DigitalTables['terms'];
  process: ProcessTerms | null;
  rollWidthsIn: readonly number[];
  boardPrices: readonly BoardPrice[];
  difficulty: DifficultyTerms | null;
  margins: readonly DifficultyMargin[];
  percentReduces: readonly PercentReduce[];
  flexoDieBlocks: readonly FlexoDieBlock[];
  digital: Pick<
    DigitalTables,
    'sheetSizes' | 'printPrices' | 'finishPrices' | 'diecutPrices' | 'dieBlocks' | 'fixCostPcts'
  >;
  assemblyPrices: readonly AssemblyPrice[];
  trimFinishPlateMm: number | null;
  /** Ink colours the factory prints on the print type (legacy per-factory `color`). */
  inkColours: ReadonlySet<string>;
  /** The factory's blank adjustment per part for the board's flute (legacy `factory_rel_pattern_conditions`). */
  patternConditions: Readonly<Record<string, { dl: number; dw: number } | null>>;
  fixedOptions: readonly FixedOption[];
  sell: SellSnapshot;
  /** Price lines the loader found missing for this configuration; non-empty = no price. */
  unavailable?: readonly string[];
}

export interface CorrugateSnapshot {
  options: readonly CorrugateOption[];
}

export interface CorrugatePartStep {
  partKey: string;
  blank: Blank;
  rsc: boolean;
  layout: FlexoLayout | DigitalLayout;
  assemblies: AssemblyLine[];
  /** The factory's price for the part's lot, plates and die block excluded (legacy `sort_total_price`). */
  buyPrice: number;
  /** Plates and die block at the factory's price after its reduction, satang (flexo; 0 for digital). */
  plates: number;
  dieBlock: number;
  /** Charged to the customer: `ceil(price × VAT)` (`:835-836`). */
  platesSale: number;
  dieBlockSale: number;
  forSale: ForSale;
}

export interface CorrugateStep {
  qty: number;
  parts: CorrugatePartStep[];
  /** What Collective Group pays the factory: lots + plates + die blocks (D-042). */
  buyPrice: number;
  perPcs: number;
  perPcsWithDelivery: number;
  sum: number;
  /** Plates + die blocks charged to the customer, VAT included. */
  tooling: number;
  /** Plates and die blocks charged, and what a reorder waiver took out (D-289); zeros when none. */
  toolingCharged: ToolingAmounts;
  toolingWaived: ToolingAmounts;
  vatPrice: number;
  designFee: number;
  structureDesignFee: number;
  /** Customer price, VAT included (legacy `summary.total`). */
  total: number;
  leadTimeDays: number;
  marginPct: number;
}

export interface CorrugateOptionResult {
  optionKey: string;
  factoryId: string;
  printTypeId: string;
  steps: (CorrugateStep | null)[];
  /** Why a quantity has no price (null where priced). */
  stepErrors: ({ code: PricingError['code']; detail: string } | null)[];
  error: { code: PricingError['code']; detail: string } | null;
}

export interface CorrugateResult {
  options: CorrugateOptionResult[];
}

/** What a part needs from an option before any quantity (`calculate_cs:429-653`). */
interface PreparedPart {
  part: CorrugatePart;
  blank: Blank;
  rsc: boolean;
  frontPercents: number[];
  backPercents: number[];
  frontColours: string[];
  backColours: string[];
  assemblies: AssemblyRequest[];
  deliveryRounds: number;
}

function leadTime(option: CorrugateOption, qty: number): number {
  const base = Math.ceil(option.leadTimeDays ?? 0);
  return option.bulkLeadTime && qty >= option.bulkLeadTime.minQty ? option.bulkLeadTime.days : base;
}

/** Digital prints each factory colour once (`calculate_cs:514-520`). */
const unique = (ids: readonly string[]) => [...new Set(ids)];

function preparePart(input: CorrugateInput, option: CorrugateOption, part: CorrugatePart): PreparedPart {
  const fail = (code: PricingError['code'], detail: string) =>
    new PricingError(code, `${part.key}: ${detail}`);
  const front = part.printFront.map((c) => c.inkColourId);
  const back = part.printBack.map((c) => c.inkColourId);
  // Most colours on flexo: the highest colour count of the difficulty margins (`:429-437`).
  if (option.engine === 'flexo' && option.margins.length > 0) {
    const most = Math.max(...option.margins.map((m) => m.colourAmount));
    if (front.length > most || back.length > most)
      throw fail('process_not_possible', `prints at most ${most} colours`);
  }
  // The factory's colour limit (`:448-455`).
  if (option.maxColours !== null && (front.length > option.maxColours || back.length > option.maxColours)) {
    throw fail('process_not_possible', `prints at most ${option.maxColours} colours`);
  }
  if (!option.difficulty) throw fail('price_line_missing', 'difficulty_levels'); // `:458-468`
  if (option.boardPrices.length === 0) throw fail('price_line_missing', 'board_prices'); // `:477-504`
  for (const colour of [...front, ...back]) {
    if (!option.inkColours.has(colour)) throw fail('price_line_missing', `ink_colours ${colour}`); // `:506-562`
  }
  const coated = part.coatingFrontId !== null || part.coatingBackId !== null;
  if (coated && !input.materialCoatable) throw fail('process_not_possible', 'the board takes no coating'); // `:569`
  // Legacy accepts a coating on flexo and never prices it (quirk C5): refused.
  if (coated && option.engine === 'flexo') throw fail('process_not_possible', 'flexo prints no coating');
  if (!option.process) throw fail('price_line_missing', 'corrugate_process_terms');

  const b = blank({
    formula: part.formula,
    ...input.size,
    flute: input.flute,
    conditions: input.conditions,
    plus: option.patternConditions[part.key] ?? null,
  });
  const rsc = isRsc(part.formula, b, input.flute, option.process);
  const style = rsc ? 'rsc' : 'die_cut';
  const fixed = option.fixedOptions.filter((f) => f.partKey === part.key && f.boxStyle === style);
  const deliveryRounds = fixed.reduce((last, f) => f.deliveryRounds ?? last, 0);
  const percentOf = (c: CorrugatePrintColour) =>
    c.area ? printAreaPercent(part.formula, b, input.flute, c.area, option.printArea) : (c.percent ?? 0);
  return {
    part,
    blank: b,
    rsc,
    frontPercents: part.printFront.map(percentOf),
    backPercents: part.printBack.map(percentOf),
    frontColours: option.engine === 'digital' ? unique(front) : front,
    backColours: option.engine === 'digital' ? unique(back) : back,
    // Requested assemblies, the automatic ones (legacy appends group 22), then the fixed options (`:662-689`).
    assemblies: [
      ...part.assemblies,
      ...input.autoAssemblies,
      ...fixed.flatMap((f) => (f.assembly ? [f.assembly] : [])),
    ],
    deliveryRounds,
  };
}

function pricePart(
  input: CorrugateInput,
  option: CorrugateOption,
  prepared: PreparedPart,
  qty: number,
): CorrugatePartStep {
  const assemblies = assemblyCost(prepared.assemblies, option.assemblyPrices, {
    qty,
    formula: prepared.part.formula,
    rsc: prepared.rsc,
    blankDl: prepared.blank.dl,
    digital: option.engine === 'digital',
    trimFinishPlateMm: option.trimFinishPlateMm,
    packing: option.packing,
  });
  let layout: FlexoLayout | DigitalLayout;
  let plates = 0;
  let dieBlock = 0;
  if (option.engine === 'flexo') {
    const tables: FlexoTables = {
      terms: option.engineTerms,
      process: option.process!,
      rollWidthsIn: option.rollWidthsIn,
      boardPrices: option.boardPrices,
      difficulty: option.difficulty!,
      margins: option.margins,
      percentReduces: option.percentReduces,
      dieBlocks: option.flexoDieBlocks,
    };
    const flexo = priceFlexoPart(
      {
        blank: prepared.blank,
        rsc: prepared.rsc,
        qty,
        print: { frontPercents: prepared.frontPercents, backPercents: prepared.backPercents },
        assemblyTotal: assemblies.total,
        dieDeliveryRounds: prepared.deliveryRounds,
        standardSize: input.standardSize,
      },
      tables,
    )[0]!;
    layout = flexo;
    // Legacy reads the formatted `print_paper_cost` / `diecut_price` strings: rounded to the satang (`:835-836`).
    plates = phpRound(flexo.plates, 2);
    dieBlock = phpRound(flexo.dieBlock, 2);
  } else {
    layout = priceDigitalPart(
      {
        blank: prepared.blank,
        qty,
        materialId: input.materialId,
        frontColours: prepared.frontColours,
        backColours: prepared.backColours,
        frontCoveragePct: input.digitalFrontCoveragePct,
        finishFrontId: prepared.part.coatingFrontId,
        finishBackId: prepared.part.coatingBackId,
        assemblyTotal: assemblies.total,
        hasAssemblies: assemblies.lines.length > 0,
        standardSize: input.standardSize,
      },
      {
        terms: option.digitalTerms,
        process: option.process!,
        boardPrices: option.boardPrices,
        difficulty: option.difficulty!,
        ...option.digital,
      },
    )[0]!;
  }
  const vatInclude = (100 + option.sell.vatPct) / 100;
  const forSale = saleMargin(option.sell, layout.buyPrice, qty, qty, 0);
  return {
    partKey: prepared.part.key,
    blank: prepared.blank,
    rsc: prepared.rsc,
    layout,
    assemblies: assemblies.lines,
    buyPrice: layout.buyPrice,
    plates,
    dieBlock,
    // Print type 5 (digital) charges neither (`:835-836`).
    platesSale: option.engine === 'flexo' ? Math.ceil(plates * vatInclude) : 0,
    dieBlockSale: option.engine === 'flexo' ? Math.ceil(dieBlock * vatInclude) : 0,
    forSale,
  };
}

function optionResult(input: CorrugateInput, option: CorrugateOption): CorrugateOptionResult {
  const head = { optionKey: option.optionKey, factoryId: option.factoryId, printTypeId: option.printTypeId };
  const failAll = (error: PricingError): CorrugateOptionResult => ({
    ...head,
    steps: input.quantities.map(() => null),
    stepErrors: input.quantities.map(() => ({ code: error.code, detail: error.detail })),
    error: { code: error.code, detail: error.detail },
  });
  let prepared: PreparedPart[];
  try {
    if (option.unavailable?.length)
      throw new PricingError('price_line_missing', option.unavailable.join(', '));
    prepared = input.parts.map((p) => preparePart(input, option, p));
  } catch (error) {
    if (error instanceof PricingError) return failAll(error);
    throw error;
  }
  const vatInclude = (100 + option.sell.vatPct) / 100;
  const stepErrors: CorrugateOptionResult['stepErrors'] = [];
  const steps = input.quantities.map((qty): CorrugateStep | null => {
    try {
      // The factory's minimum order (`:389-395`).
      if (option.minOrderAmount !== null && qty < option.minOrderAmount) {
        throw new PricingError('process_not_possible', `minimum order ${option.minOrderAmount}`);
      }
      const priced = prepared.map((p) => pricePart(input, option, p, qty));
      // D-289: reused tooling is taken out of every part before the sums, so the sums keep their order.
      const waive = input.waiveTooling?.[option.factoryId];
      const toolingWaived = amounts(
        priced.map((p) => ({
          platesSale: waive?.plates ? p.platesSale : 0,
          dieBlockSale: waive?.dieBlock ? p.dieBlockSale : 0,
          platesBuy: waive?.plates ? p.plates : 0,
          dieBlockBuy: waive?.dieBlock ? p.dieBlock : 0,
        })),
      );
      const parts = waive
        ? priced.map((p) => ({
            ...p,
            ...(waive.plates && { plates: 0, platesSale: 0 }),
            ...(waive.dieBlock && { dieBlock: 0, dieBlockSale: 0 }),
          }))
        : priced;
      stepErrors.push(null);
      const sum = (f: (p: CorrugatePartStep) => number) => parts.reduce((a, p) => a + f(p), 0);
      const designFee = input.design.graphic ? (option.sell.designFee ?? 0) : 0;
      const structureDesignFee = input.design.structure ? (option.sell.structureDesignFee ?? 0) : 0;
      const tooling = sum((p) => p.platesSale + p.dieBlockSale);
      // Per part: sum with delivery + plates + die block (`:937`); design fees once (C14).
      const total =
        sum((p) => p.forSale.total + p.platesSale + p.dieBlockSale) + designFee + structureDesignFee;
      const buyPrice = sum((p) => p.buyPrice + p.plates + p.dieBlock);
      const net = total / vatInclude;
      return {
        qty,
        parts,
        buyPrice,
        perPcs: sum((p) => p.forSale.perPcs),
        perPcsWithDelivery: sum((p) => p.forSale.perPcsWithDelivery),
        sum: sum((p) => p.forSale.sum),
        tooling,
        toolingCharged: amounts(
          parts.map((p) => ({
            platesSale: p.platesSale,
            dieBlockSale: p.dieBlockSale,
            platesBuy: p.plates,
            dieBlockBuy: p.dieBlock,
          })),
        ),
        toolingWaived,
        // Product VAT per part plus the VAT inside the plates and die blocks charged.
        vatPrice: sum((p) => p.forSale.vatPrice) + (tooling - tooling / vatInclude),
        designFee,
        structureDesignFee,
        total,
        leadTimeDays: leadTime(option, qty),
        marginPct: net > 0 ? ((net - buyPrice) / net) * 100 : 0,
      };
    } catch (error) {
      if (!(error instanceof PricingError)) throw error;
      stepErrors.push({ code: error.code, detail: error.detail });
      return null;
    }
  });
  const firstError = stepErrors.find((e) => e !== null) ?? null;
  return { ...head, steps, stepErrors, error: steps.every((s) => s === null) ? firstError : null };
}

function amounts(rows: ToolingAmounts[]): ToolingAmounts {
  return rows.reduce(
    (a, r) => ({
      platesSale: a.platesSale + r.platesSale,
      dieBlockSale: a.dieBlockSale + r.dieBlockSale,
      platesBuy: a.platesBuy + r.platesBuy,
      dieBlockBuy: a.dieBlockBuy + r.dieBlockBuy,
    }),
    { platesSale: 0, dieBlockSale: 0, platesBuy: 0, dieBlockBuy: 0 },
  );
}

export const corrugateCalculator: Calculator<CorrugateInput, CorrugateSnapshot, CorrugateResult> = {
  key: 'corrugate',
  version: CORRUGATE_CALCULATOR_VERSION,
  calculate(input, snapshot) {
    return { options: snapshot.options.map((o) => optionResult(input, o)) };
  },
};
