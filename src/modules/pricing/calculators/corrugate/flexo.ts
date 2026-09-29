import { numberFormat, phpRound } from '../../engine/php';
import { PricingError } from '../shared/pricing-error';
import { type Blank } from './geometry';
import {
  type BoardPrice,
  type DifficultyMargin,
  type DifficultyTerms,
  type EngineTerms,
  type FlexoDieBlock,
  type PercentReduce,
  type ProcessTerms,
} from './tables';

/**
 * The corrugate flexo engines (U-B6, port map §7): legacy `CalculatorCorrugate::CalRSCFlexo:867-1082` (RSC:
 * boxes laid on the board roll) and `CalDCFlexo:1084-1335` (die-cut: blanks laid on a die block, blocks laid
 * on the roll), with the print setup of `calculate:234-286, :487-586, :606-611, :695-697`. Every layout is
 * priced and ordered like legacy (`sort_data:1556`); the caller keeps the first (`calculate_cs:768`). Pure:
 * each call starts from its own inputs (quirk C1: legacy reused one object across factories and parts).
 */

export interface FlexoPrint {
  /** Colours printed on the side, each as the % of the blank it covers (resolved by the caller). */
  frontPercents: readonly number[];
  backPercents: readonly number[];
}

export interface FlexoInput {
  blank: Blank;
  /** Made as RSC (`isRsc`), else die-cut. */
  rsc: boolean;
  qty: number;
  print: FlexoPrint;
  /** Σ the part's assemblies (`calculateAssembly`). */
  assemblyTotal: number;
  /** Die delivery rounds (fixed options, `:685`). */
  dieDeliveryRounds: number;
  /** The size is a standard size of the product: no die block is charged (`:1211`). */
  standardSize: boolean;
}

export interface FlexoTables {
  terms: EngineTerms;
  process: ProcessTerms;
  /** Board roll widths of the factory, inches, ascending (`:874`). */
  rollWidthsIn: readonly number[];
  /** Board price bands of the material × print type, ordered by `minSheet` (`:203`). */
  boardPrices: readonly BoardPrice[];
  difficulty: DifficultyTerms;
  margins: readonly DifficultyMargin[];
  percentReduces: readonly PercentReduce[];
  /** Flexo die blocks of the print type (and flute), line order (`:208-215`). */
  dieBlocks: readonly FlexoDieBlock[];
}

export interface FlexoLayout {
  rollWidthIn: number;
  widthLayout: number;
  lengthLayout: number;
  /** Die lay-out across × along (die-cut only). */
  dieLayout: { w: number; l: number } | null;
  dieSize: string | null;
  dWlay: number;
  dLlay: number;
  sheets: number;
  runLengthM: number;
  totalPaperAreaSqm: number;
  waste: number;
  paperPricePerSqft: number;
  paperCost: number;
  printPrice: number;
  percentMargin: number;
  /** Print plates at the factory's price after the reduction (legacy `print_paper_cost`), charged apart. */
  plates: number;
  /** Die-cutting (in the buy price) and die delivery (in the buy price). */
  dieCut: number;
  dieDelivery: number;
  /** Die block at the factory's price after the reduction, charged apart (0 for RSC). */
  dieBlock: number;
  assemblyTotal: number;
  /** Cost before profit (legacy `total_cost`). */
  totalCost: number;
  minTotalProfit: number;
  reduceFactor: number;
  /** Legacy `show_total_sell_price` rounded to the satang: the layout ordering key (`:1064, :1315`). */
  showTotal: number;
  /** Legacy `cost_per_pcs` (display, before the factory margin). */
  costPerPcs: number;
  /** The factory's price for the lot, plates and die block excluded (legacy `sort_total_price`). */
  buyPrice: number;
}

/** The print setup every flexo layout shares (`:234-286`, `:487-586`). */
interface PrintSetup {
  printFront: boolean;
  printBack: boolean;
  percentFront: number;
  percentBack: number;
  /** Legacy `min_margin_thb` at the most colours (`:267-280`). */
  minMarginPerPcs: number;
  /** Legacy `$this->dmm->min_margin_per_job` (`:206, :973`). */
  minMarginPerJob: number;
  boxAreaSqin: number;
  printAreaFrontSqin: number;
  printAreaBackSqin: number;
}

function printSetup(input: FlexoInput, t: FlexoTables): PrintSetup {
  const front = input.print.frontPercents;
  const back = input.print.backPercents;
  const margin = (colours: number) => t.margins.find((m) => m.colourAmount === colours);
  // Flexo print margins by colour count (`:239-248`): a side not printed reads the 0-colour row.
  let percentFront = margin(front.length)?.percentMargin ?? 0;
  const percentBack = margin(back.length)?.percentMargin ?? 0;
  if (front.length === 0 && back.length === 0) {
    // Nothing printed: the 0-colour row is required (`:282-286`, quirk C3).
    const none = margin(0);
    if (!none) throw new PricingError('price_line_missing', 'difficulty_margins 0 colours');
    percentFront = none.percentMargin;
  }
  const most = margin(Math.max(front.length, back.length));
  if (!most)
    throw new PricingError(
      'price_line_missing',
      `difficulty_margins ${Math.max(front.length, back.length)} colours`,
    );
  const boxAreaSqin = (input.blank.dl / 25.4) * (input.blank.dw / 25.4);
  const areaOf = (percents: readonly number[]) =>
    percents.reduce((sum, p) => sum + boxAreaSqin * (p / 100), 0);
  return {
    printFront: front.length > 0,
    printBack: back.length > 0,
    percentFront,
    percentBack,
    minMarginPerPcs: most.minMarginPerPcs,
    minMarginPerJob: most.minMarginPerJob,
    boxAreaSqin,
    printAreaFrontSqin: areaOf(front),
    printAreaBackSqin: areaOf(back),
  };
}

/** Legacy `Calculator::calculatePercentReduce:452-469`: the first band (by `minPrice` descending) at or below. */
export function reduceFactor(reduces: readonly PercentReduce[], price: number): number {
  const sorted = [...reduces].sort((a, b) => b.minPrice - a.minPrice);
  const band = sorted.find((r) => r.minPrice <= price);
  return (100 - (band?.percent ?? 0)) / 100;
}

/**
 * The board price band for the sheets (`:899-910` RSC, `:1141-1153` die-cut): below every band the first band
 * (die-cut also raises the sheets to its minimum), inside a band that band, above every band the last band
 * whose maximum is at or below the sheets.
 */
function boardBand(
  bands: readonly BoardPrice[],
  sheets: number,
  raiseToBandMin: boolean,
): { price: number; sheets: number } {
  if (bands.length === 0) throw new PricingError('price_line_missing', 'board_prices');
  let price: number | null = null;
  let found = false;
  let out = sheets;
  for (const b of bands) {
    if (found) break;
    if (b.minSheet !== null && b.minSheet > out) {
      if (raiseToBandMin) out = b.minSheet;
      price = b.pricePerSqft;
      found = true;
    } else if ((b.minSheet === null || b.minSheet <= out) && (b.maxSheet === null || b.maxSheet >= out)) {
      price = b.pricePerSqft;
      found = true;
    } else if (b.maxSheet !== null && b.maxSheet <= out) {
      price = b.pricePerSqft;
    }
  }
  if (price === null) throw new PricingError('price_line_missing', `board_prices for ${sheets} sheets`);
  return { price, sheets: out };
}

/** Legacy `width_layout:1574`: boxes across the roll after the trim. */
const widthLayout = (rollWidthM: number, trimMm: number, dWlay: number) =>
  Math.floor((rollWidthM - trimMm / 1000) / (dWlay / 1000));

/** `ceil(number_format($x, 10, '.', ''))` (`:888, :1137`). */
const ceil10 = (x: number) => Math.ceil(Number(numberFormat(x, 10, '.', '')));

/** Paper to cost: sq m → sq in → sq ft × THB per sq ft (`:916, :1164`). */
const paperCostOf = (areaSqm: number, pricePerSqft: number) =>
  ((areaSqm * 10000) / (2.54 * 2.54) / (12 * 12)) * pricePerSqft;

/** Print price: board ÷ (1 − margin); two printed sides add the margin twice (`:929-933`, `:1175-1179`). */
function printPrice(paperCost: number, percentMargin: number, bothSides: boolean): number {
  const withMargin = paperCost / (1 - percentMargin / 100);
  return bothSides ? withMargin + (withMargin - paperCost) : withMargin;
}

interface Profit {
  minTotalProfit: number;
  reduceFactor: number;
  sell: number;
}

/** Profit floors and the volume reduction (`:972-990`, `:1228-1245`). */
function profit(
  setup: PrintSetup,
  t: FlexoTables,
  qty: number,
  printPriceValue: number,
  paperCost: number,
  totalCost: number,
): Profit {
  let totalProfit = printPriceValue - paperCost;
  if (totalProfit < setup.minMarginPerJob) totalProfit = setup.minMarginPerJob;
  const profitPerUnit = totalProfit / qty;
  const factor = reduceFactor(t.percentReduces, printPriceValue);
  const lowProfitPerUnit =
    profitPerUnit < setup.minMarginPerPcs && factor === 1 ? setup.minMarginPerPcs : profitPerUnit;
  const minTotalProfit = lowProfitPerUnit * qty;
  return { minTotalProfit, reduceFactor: factor, sell: (totalCost + minTotalProfit) * factor };
}

/** Legacy `calculate_factory_margin:1956`: the factory's margin on its selling price. */
function withFactoryMargin(price: number, marginPct: number): number {
  const marginPrice = price / ((100 - marginPct) / 100) - price;
  return price + marginPrice;
}

/** RSC on the roll (`CalRSCFlexo:867-1082`). */
function rscLayouts(input: FlexoInput, t: FlexoTables, setup: PrintSetup): FlexoLayout[] {
  const { blank: b, qty } = input;
  const p = t.process;
  const dWIn = b.dw / 25.4;
  const dLIn = b.dl / 25.4;
  // Blanks per cut sheet (LOC-426, `:606-609`) and the lay-out size (`:696-697`).
  const cutWidthAmount = Math.ceil(p.pwRscMinIn / dWIn);
  const cutLengthAmount = Math.ceil(p.plRscMinIn / dLIn);
  const cutWidth = cutWidthAmount * dWIn;
  const cutLength = cutLengthAmount * dLIn;
  const dLlay = t.terms.paperCut ? Math.ceil(Number(numberFormat(cutLength * 25.4, 10, '.', ''))) : b.dl;
  const dWlay = t.terms.paperCut ? Math.ceil(Number(numberFormat(cutWidth * 25.4, 10, '.', ''))) : b.dw;
  const cutAmount = cutWidthAmount * cutLengthAmount;
  const out: FlexoLayout[] = [];
  for (const rollIn of t.rollWidthsIn) {
    const roll = (rollIn * 2.54) / 100;
    const across = widthLayout(roll, p.trimMm, dWlay);
    if (!(across <= p.widthLayoutMax && across >= 1)) continue;
    const lengthLayout = Math.max(Math.ceil(qty / (across * cutAmount)), Math.ceil(p.minLengthLayoutSlot));
    const boxLayoutArea = ((dWlay * dLlay) / 1000000) * qty;
    const calLength = (dLlay * lengthLayout) / 1000;
    const length = calLength < p.minLengthM ? p.minLengthM : calLength;
    let sheets = across * ceil10(length / (dLlay / 1000));
    // RSC raises the sheets to the process minimum before the board band (`:892-894`).
    if (p.minSheet > sheets) sheets = p.minSheet;
    const band = boardBand(t.boardPrices, sheets, false);
    const totalPaperArea = roll * (((sheets / across) * dLlay) / 1000);
    const waste = phpRound(((totalPaperArea - boxLayoutArea) / totalPaperArea) * 100, 1);
    const paperCost = paperCostOf(totalPaperArea, band.price);
    // RSC margin: the front's when it has one, else the back's (`:919-927`).
    const percentMargin =
      setup.percentFront === 0 && setup.percentBack > 0 ? setup.percentBack : setup.percentFront;
    const price = printPrice(paperCost, percentMargin, setup.printFront && setup.printBack);
    const plateFront =
      setup.percentFront > 0 ? setup.printAreaFrontSqin * t.difficulty.printPlatePricePerIn2 : 0;
    const plateBack =
      setup.percentBack > 0 ? setup.printAreaBackSqin * t.difficulty.printPlatePricePerIn2 : 0;
    const plates = plateFront + plateBack;
    // No die-cut and no die block on RSC (`:969`; legacy's stale block of a previous call, quirk C1).
    const totalCost = paperCost + plates + input.assemblyTotal;
    const pr = profit(setup, t, qty, price, paperCost, totalCost);
    const show = pr.sell;
    const platesReduced = plates * pr.reduceFactor;
    // Plates are charged apart (`:998-1000`; every live caller asks for it).
    const sell = pr.sell - platesReduced;
    const cpp = sell / qty;
    out.push({
      rollWidthIn: rollIn,
      widthLayout: across,
      lengthLayout,
      dieLayout: null,
      dieSize: null,
      dWlay,
      dLlay,
      sheets,
      runLengthM: length,
      totalPaperAreaSqm: totalPaperArea,
      waste,
      paperPricePerSqft: band.price,
      paperCost,
      printPrice: price,
      percentMargin,
      plates: platesReduced,
      dieCut: 0,
      dieDelivery: 0,
      dieBlock: 0,
      assemblyTotal: input.assemblyTotal,
      totalCost,
      minTotalProfit: pr.minTotalProfit,
      reduceFactor: pr.reduceFactor,
      showTotal: phpRound(show, 2),
      costPerPcs: cpp < t.difficulty.minPricePerPcs ? t.difficulty.minPricePerPcs : cpp,
      buyPrice: withFactoryMargin(sell, t.terms.factoryMarginPct),
    });
  }
  return out;
}

/** Blanks across one die side: legacy drops one when the rest cannot hold the gaps and trim (`:1090-1100`). */
function dieCount(blockMm: number, blankMm: number, gapMm: number, trimMm: number): number {
  const n = Math.floor(blockMm / blankMm);
  return blockMm - n * blankMm < (n - 1) * gapMm + trimMm ? n - 1 : n;
}

/** PHP float-to-string of a block size (e.g. `40`, `40.5`) for the die-size key (`:1269`). */
const phpNum = (n: number) => String(n);

/** Die-cut boxes on die blocks (`CalDCFlexo:1084-1335`). */
function dieCutLayouts(input: FlexoInput, t: FlexoTables, setup: PrintSetup): FlexoLayout[] {
  const { blank: b, qty } = input;
  const p = t.process;
  const dWIn = b.dw / 25.4;
  const dLIn = b.dl / 25.4;
  // Blocks the blank fits (`:633-638`); none → "ขนาดกระดาษไม่พอ" (`:655-657`).
  const blocks = t.dieBlocks.filter((d) => dLIn <= d.blockMaxLIn && dWIn <= d.blockMaxWIn);
  if (blocks.length === 0) throw new PricingError('process_not_possible', 'no die block fits the blank');
  const out: FlexoLayout[] = [];
  for (const block of blocks) {
    const across = dieCount(block.blockMaxWIn * 25.4, b.dw, p.gapMm, p.twMm);
    const along = dieCount(block.blockMaxLIn * 25.4, b.dl, p.gapMm, p.tlMm);
    if (across <= 0 || along <= 0) continue;
    const dWlay = across * b.dw + ((across - 1) * p.gapMm + p.twMm);
    const dLlay = along * b.dl + ((along - 1) * p.gapMm + p.tlMm);
    // LOC-426: the cut sheet is at least the RSC minimum; its length may hold several die lengths (`:1109-1115`).
    const cutLength = Math.max(dLlay, p.plRscMinIn * 25.4);
    const cutLengthAmount = along < Math.floor(cutLength / b.dl) ? Math.floor(cutLength / b.dl) : 1;
    for (const rollIn of t.rollWidthsIn) {
      const roll = (rollIn * 2.54) / 100;
      const rollAcross = widthLayout(roll, p.trimMm, dWlay);
      if (!(rollAcross <= p.widthLayoutMax && rollAcross >= 1)) continue;
      const lengthLayout = Math.max(
        Math.ceil(Math.ceil(qty / (rollAcross * across * along)) / cutLengthAmount),
        Math.ceil(p.minLengthLayoutSlot),
      );
      const boxLayoutArea = ((dWlay * dLlay) / 1000000) * qty;
      const calLength = (cutLength * lengthLayout) / 1000;
      const length = calLength < p.minLengthM ? p.minLengthM : calLength;
      let sheets = rollAcross * ceil10(length / (cutLength / 1000));
      // Die-cut walks the board bands first (raising to a band's minimum), then the process minimum (`:1141-1157`).
      const band = boardBand(t.boardPrices, sheets, true);
      sheets = band.sheets;
      if (p.minSheet > sheets) sheets = p.minSheet;
      const totalPaperArea = roll * (((sheets / rollAcross) * cutLength) / 1000);
      const paperCost = paperCostOf(totalPaperArea, band.price);
      const waste = phpRound(((totalPaperArea - boxLayoutArea) / totalPaperArea) * 100, 1);
      // Die-cut margin: the larger side's (`:1172`).
      const percentMargin = setup.percentBack > setup.percentFront ? setup.percentBack : setup.percentFront;
      const price = printPrice(paperCost, percentMargin, setup.printFront && setup.printBack);
      const ups = across * along;
      const plateFront =
        setup.percentFront > 0
          ? setup.printAreaFrontSqin * t.difficulty.printPlatePricePerIn2 * across * along
          : 0;
      const plateBack =
        setup.percentBack > 0
          ? setup.printAreaBackSqin * t.difficulty.printPlatePricePerIn2 * across * along
          : 0;
      const plates = plateFront + plateBack;
      const dieBlock = input.standardSize ? 0 : block.blockPrice;
      const dieDelivery = (block.deliveryCost ?? 0) * input.dieDeliveryRounds;
      let dieCut: number;
      if (block.pricePerPcs) {
        dieCut = block.pricePerPcs * qty;
      } else {
        if (block.min1layDiecutPrice === null || block.stepDiecutPrice === null) {
          throw new PricingError('price_line_missing', 'corrugate_die_blocks die-cut price');
        }
        dieCut = sheets * (block.min1layDiecutPrice + (ups - 1) * block.stepDiecutPrice);
      }
      if (block.minDiecutPrice !== null && dieCut < block.minDiecutPrice) dieCut = block.minDiecutPrice;
      const totalCost = paperCost + plates + dieCut + dieBlock + input.assemblyTotal + dieDelivery;
      const pr = profit(setup, t, qty, price, paperCost, totalCost);
      const show = pr.sell;
      const platesReduced = plates * pr.reduceFactor;
      const blockReduced = dieBlock * pr.reduceFactor;
      // Plates and the die block are charged apart (`:1249-1260`).
      const sell = pr.sell - platesReduced - blockReduced;
      const cpp = sell / qty;
      out.push({
        rollWidthIn: rollIn,
        widthLayout: rollAcross,
        lengthLayout,
        dieLayout: { w: across, l: along },
        dieSize:
          block.sideType === 'T'
            ? `${phpNum(block.blockMaxWIn)}x${phpNum(block.blockMaxLIn)}T`
            : `${phpNum(block.blockMaxLIn)}x${phpNum(block.blockMaxWIn)}${block.sideType ?? ''}`,
        dWlay,
        dLlay,
        sheets,
        runLengthM: length,
        totalPaperAreaSqm: totalPaperArea,
        waste,
        paperPricePerSqft: band.price,
        paperCost,
        printPrice: price,
        percentMargin,
        plates: platesReduced,
        dieCut,
        dieDelivery,
        dieBlock: blockReduced,
        assemblyTotal: input.assemblyTotal,
        totalCost,
        minTotalProfit: pr.minTotalProfit,
        reduceFactor: pr.reduceFactor,
        showTotal: phpRound(show, 2),
        costPerPcs: cpp < t.difficulty.minPricePerPcs ? t.difficulty.minPricePerPcs : cpp,
        buyPrice: withFactoryMargin(sell, t.terms.factoryMarginPct),
      });
    }
  }
  return out;
}

/** PHP `strcmp` order of two non-numeric strings (die sizes such as `40x60T`). */
const byteCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Legacy `sort_data:1556-1572`: by the rounded selling price before the factory margin, then waste, roll
 * width, die size; then line order (stable, quirk C18). `limit_10` keeps ten (`:1547`).
 */
export function orderLayouts(layouts: FlexoLayout[]): FlexoLayout[] {
  return layouts
    .map((l, i) => ({ l, i }))
    .sort(
      (a, b) =>
        a.l.showTotal - b.l.showTotal ||
        a.l.waste - b.l.waste ||
        a.l.rollWidthIn - b.l.rollWidthIn ||
        byteCompare(a.l.dieSize ?? '', b.l.dieSize ?? '') ||
        a.i - b.i,
    )
    .slice(0, 10)
    .map((x) => x.l);
}

/** Every flexo layout of a part, ordered; the first is the price (`calculate_cs:768`). */
export function priceFlexoPart(input: FlexoInput, tables: FlexoTables): FlexoLayout[] {
  const setup = printSetup(input, tables);
  const layouts = input.rsc ? rscLayouts(input, tables, setup) : dieCutLayouts(input, tables, setup);
  if (layouts.length === 0) throw new PricingError('no_priced_layout', 'no roll width lays the blank out');
  return orderLayouts(layouts);
}
