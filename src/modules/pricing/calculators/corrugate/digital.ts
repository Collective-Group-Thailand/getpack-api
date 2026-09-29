import { phpRound } from '../../engine/php';
import { PricingError } from '../shared/pricing-error';
import { type Blank } from './geometry';
import { type BoardPrice, type DifficultyTerms, within } from './tables';

/**
 * The corrugate digital engine (U-B6, port map §7): legacy `CalculatorCorrugate::CalDigital:1337-1545` with
 * the digital setup of `calculate:587-602, :640-653, :701-831`. One layout per board sheet size; legacy keeps
 * the first size in query order (quirk C2), Packio the cheapest. Pure (quirk C1). Every price the digital
 * branch reads and legacy silently skips when missing (a colour, a coating, the die-cut, the die block) refuses
 * the option instead (quirk C3).
 */

export interface DigitalTerms {
  factoryMarginPct: number;
  /** Blank trims (legacy `factory_match_print_type.trim_dl/dw`), mm. */
  trimDlMm: number;
  trimDwMm: number;
  /** Fix cost per m² of blank, printed or not (legacy `print_fix_cost_thb_per_sqm`, `non_print_…`). */
  printFixCostPerSqm: number | null;
  nonPrintFixCostPerSqm: number | null;
  /** Legacy `corrugate_use_amount_find_paper_price`: the board band is read at the order quantity. */
  paperPriceByOrderAmount: boolean;
  /** Legacy `corrugate_cal_diecut_block_price`: a die block per m² (quirk C10). */
  digitalDieBlock: boolean;
  /** Lowest buy price of a lot (legacy `corrugate_fix_min_cost`, 500). */
  minLotPrice: number | null;
  /** Legacy factory 9: the back prints at this flat rate per m² (15 × 1.2) instead of the colour prices. */
  backPrintPricePerM2: number | null;
  /** Legacy factory 16: a two-sided add-on per m² when both sides print. */
  twoSideAddon: boolean;
}

/** The die lay-out gaps and trims of the process terms (legacy `find_pattern_type.gap_mm, tl_mm, tw_mm`). */
export interface DigitalProcess {
  gapMm: number;
  tlMm: number;
  twMm: number;
}

export interface DigitalPrintPrice {
  inkColourId: string;
  /** Legacy factory 16: prices per board; null = any board. */
  materialId: string | null;
  /** Legacy factory 9: by order-quantity band; null = open. */
  minQty: number | null;
  maxQty: number | null;
  /** THB per m² of blank per piece (legacy `print_price_per_pcs` / `price_ink_thb_per_m2`). */
  pricePerM2: number;
  addTwoSidePerSqm: number | null;
}

export interface DigitalDiecutPrice {
  minQty: number | null;
  maxQty: number | null;
  pricePerJob: number | null;
  pricePerPcs: number | null;
  pricePerM2: number | null;
}

export interface DigitalDieBlock {
  minPcs: number | null;
  maxPcs: number | null;
  pricePerSqm: number;
}

export interface FixCostPct {
  basis: 'box_area_sqm' | 'pcs';
  minValue: number | null;
  maxValue: number | null;
  percent: number;
}

export interface DigitalTables {
  terms: DigitalTerms;
  process: DigitalProcess;
  /** Board sheet sizes of the material × print type, inches, line order (legacy `paper_sizes`). */
  sheetSizes: readonly { wIn: number; lIn: number }[];
  boardPrices: readonly BoardPrice[];
  difficulty: DifficultyTerms;
  printPrices: readonly DigitalPrintPrice[];
  /** Coating prices by area at the difficulty (legacy `finish_price.finish_price_by_area_thb_per_in2`). */
  finishPrices: readonly { finishId: string; priceByAreaPerIn2: number }[];
  diecutPrices: readonly DigitalDiecutPrice[];
  dieBlocks: readonly DigitalDieBlock[];
  fixCostPcts: readonly FixCostPct[];
}

export interface DigitalInput {
  blank: Blank;
  qty: number;
  materialId: string;
  /** Ink colours printed per side (duplicates already removed, `calculate_cs:514-520`). */
  frontColours: readonly string[];
  backColours: readonly string[];
  /**
   * Front coverage % (legacy `printing_calculate_type` 2: the largest colour %, `:587-594, :1406-1408`); null
   * = type 1, the whole blank.
   */
  frontCoveragePct: number | null;
  finishFrontId: string | null;
  finishBackId: string | null;
  assemblyTotal: number;
  /** The part carries at least one assembly: the assembly waste applies (`:1365-1367`). */
  hasAssemblies: boolean;
  /** A standard size of the product: no die block (`:1452`). */
  standardSize: boolean;
}

export interface DigitalLayout {
  sheetWIn: number;
  sheetLIn: number;
  dieLayout: { w: number; l: number };
  dWlay: number;
  dLlay: number;
  sheets: number;
  paperPricePerSqft: number;
  paperCost: number;
  printCost: number;
  finishCost: number;
  dieCut: number;
  dieBlock: number;
  printingFixCost: number;
  assemblyTotal: number;
  /** Before the fix-cost uplift and the factory margin (legacy `without_margin`, first value). */
  costBeforeUplift: number;
  fixCostPct: number | null;
  costPerPcs: number;
  /** The factory's price for the lot (legacy `sort_total_price`); the die block is inside it (`calculate_cs:835`). */
  buyPrice: number;
}

/** Blanks across one sheet side (`:1345-1354`): the test uses the bare blank, the count the trimmed one. */
function sheetCount(
  sheetIn: number,
  blankMm: number,
  trimMm: number,
  gapMm: number,
  sideTrimMm: number,
): number {
  const mm = Math.ceil(sheetIn * 25.4);
  const fits = Math.floor(mm / blankMm);
  return sheetIn * 25.4 - fits * blankMm >= (fits - 1) * gapMm + sideTrimMm
    ? Math.floor(mm / (blankMm + trimMm))
    : Math.floor(mm / (blankMm + trimMm)) - 1;
}

/** `ceil(((1 + pct / 100) × sheets) + setup)` (`:1366, :1372, :1375`). */
const withWaste = (sheets: number, pct: number, setup: number) => Math.ceil((1 + pct / 100) * sheets + setup);

function colourPrices(
  colours: readonly string[],
  t: DigitalTables,
  input: DigitalInput,
): { total: number; addOns: number[] } {
  let total = 0;
  const addOns: number[] = [];
  for (const colour of colours) {
    const row = t.printPrices.find(
      (p) =>
        p.inkColourId === colour &&
        (p.materialId === null || p.materialId === input.materialId) &&
        within(input.qty, p.minQty, p.maxQty),
    );
    if (!row) throw new PricingError('price_line_missing', `corrugate_print_prices ${colour}`);
    total += row.pricePerM2;
    if (t.terms.twoSideAddon) addOns.push(row.addTwoSidePerSqm ?? 0);
  }
  return { total, addOns };
}

/** Coating by area (`:784-823`): blank in² × price × qty. */
function finishCost(finishId: string | null, t: DigitalTables, input: DigitalInput): number {
  if (finishId === null) return 0;
  const row = t.finishPrices.find((f) => f.finishId === finishId);
  if (!row) throw new PricingError('price_line_missing', `finish_prices ${finishId}`);
  return (input.blank.dl / 25.4) * (input.blank.dw / 25.4) * row.priceByAreaPerIn2 * input.qty;
}

/** Legacy `factory_fix_cost_percents` (`:1480-1497`): the blank-area band first (`min < v ≤ max`), then pieces. */
function fixCostPct(rows: readonly FixCostPct[], boxAreaSqm: number, qty: number): number | null {
  const byArea = rows.find(
    (r) =>
      r.basis === 'box_area_sqm' &&
      (r.minValue === null || r.minValue < boxAreaSqm) &&
      (r.maxValue === null || r.maxValue >= boxAreaSqm),
  );
  if (byArea) return byArea.percent;
  return rows.find((r) => r.basis === 'pcs' && within(qty, r.minValue, r.maxValue))?.percent ?? null;
}

/** Every digital layout of a part, cheapest first. */
export function priceDigitalPart(input: DigitalInput, t: DigitalTables): DigitalLayout[] {
  const { blank: b, qty } = input;
  const terms = t.terms;
  const dWIn = b.dw / 25.4;
  const dLIn = b.dl / 25.4;
  // A sheet the blank fits (`:647-653`); none → "ขนาดกระดาษไม่พอ".
  if (!t.sheetSizes.some((s) => dWIn <= s.wIn && dLIn <= s.lIn)) {
    throw new PricingError('process_not_possible', 'no board sheet fits the blank');
  }
  const printFront = input.frontColours.length > 0;
  const printBack = input.backColours.length > 0;
  const front = colourPrices(input.frontColours, t, input);
  const back = colourPrices(input.backColours, t, input);
  // Legacy tests `selectBackcolor`, a key that never exists: only front colours choose the fix cost (quirk C20).
  const fixCostPerSqm = (printFront ? terms.printFixCostPerSqm : terms.nonPrintFixCostPerSqm) ?? 0;
  const finishFront = finishCost(input.finishFrontId, t, input);
  const finishBack = finishCost(input.finishBackId, t, input);
  const diecutRow = t.diecutPrices.find((d) => within(qty, d.minQty, d.maxQty));
  if (!diecutRow) throw new PricingError('price_line_missing', 'corrugate_diecut_prices');
  const boxAreaSqm = ((b.dl + terms.trimDlMm) * (b.dw + terms.trimDwMm)) / 1000000;

  const out: DigitalLayout[] = [];
  for (const size of t.sheetSizes) {
    const across = sheetCount(size.wIn, b.dw, terms.trimDwMm, t.process.gapMm, t.process.twMm);
    const along = sheetCount(size.lIn, b.dl, terms.trimDlMm, t.process.gapMm, t.process.tlMm);
    if (across <= 0 || along <= 0) continue;
    const dWlay = across * b.dw + ((across - 1) * t.process.gapMm + t.process.twMm);
    const dLlay = along * b.dl + ((along - 1) * t.process.gapMm + t.process.tlMm);
    let sheets = Math.ceil(qty / (across * along));
    const d = t.difficulty;
    if (input.hasAssemblies) sheets = withWaste(sheets, d.assemblyWastePct, d.assemblySetupSheets);
    if (printBack) sheets = withWaste(sheets, d.printWastePct, d.printSetupSheets);
    if (printFront) sheets = withWaste(sheets, d.printWastePct, d.printSetupSheets);
    const findBy = terms.paperPriceByOrderAmount ? qty : sheets;
    const band = t.boardPrices.find((p) => within(findBy, p.minSheet, p.maxSheet));
    // Legacy returns at the first size without a band (`:1383-1385`): the option is not priced.
    if (!band) throw new PricingError('price_line_missing', `board_prices for ${findBy}`);
    const paperCost =
      ((b.dl + terms.trimDlMm) / 25.4 / 12) * ((b.dw + terms.trimDwMm) / 25.4 / 12) * qty * band.pricePerSqft;
    const printAreaSqm = (b.dw * b.dl) / 1000000;
    let frontCost = 0;
    let backCost = 0;
    if (printFront) {
      frontCost = qty * printAreaSqm * front.total;
      if (input.frontCoveragePct) frontCost = (frontCost * input.frontCoveragePct) / 100;
    }
    if (printBack) {
      backCost =
        terms.backPrintPricePerM2 !== null
          ? qty * printAreaSqm * terms.backPrintPricePerM2
          : qty * printAreaSqm * back.total;
    }
    let printCost = frontCost + backCost;
    if (terms.twoSideAddon && frontCost > 0 && backCost > 0) {
      printCost += qty * printAreaSqm * Math.max(...front.addOns, ...back.addOns);
    }
    let dieCut = 0;
    if (diecutRow.pricePerJob) dieCut = diecutRow.pricePerJob;
    else if (diecutRow.pricePerPcs) dieCut = qty * diecutRow.pricePerPcs;
    else if (diecutRow.pricePerM2) dieCut = ((b.dl * b.dw) / 1000000) * diecutRow.pricePerM2 * qty;
    let dieBlock = 0;
    if (!input.standardSize && terms.digitalDieBlock) {
      const block = t.dieBlocks.find((x) => within(qty, x.minPcs, x.maxPcs));
      if (!block) throw new PricingError('price_line_missing', 'corrugate_die_blocks digital');
      dieBlock = boxAreaSqm * block.pricePerSqm;
    }
    const printingFixCost = ((b.dl * b.dw) / 1000000) * fixCostPerSqm * qty;
    // Summed in legacy's order (`:1476`).
    const costBeforeUplift =
      paperCost +
      printCost +
      (dieCut + dieBlock) +
      input.assemblyTotal +
      finishFront +
      finishBack +
      printingFixCost;
    const pct = fixCostPct(t.fixCostPcts, boxAreaSqm, qty);
    let sell = pct === null ? costBeforeUplift : costBeforeUplift * ((100 + pct) / 100);
    sell += sell / ((100 - terms.factoryMarginPct) / 100) - sell;
    if (terms.minLotPrice !== null && sell < terms.minLotPrice) sell = terms.minLotPrice;
    out.push({
      sheetWIn: size.wIn,
      sheetLIn: size.lIn,
      dieLayout: { w: across, l: along },
      dWlay,
      dLlay,
      sheets,
      paperPricePerSqft: band.pricePerSqft,
      paperCost,
      printCost,
      finishCost: finishFront + finishBack,
      dieCut,
      dieBlock,
      printingFixCost,
      assemblyTotal: input.assemblyTotal,
      costBeforeUplift,
      fixCostPct: pct,
      costPerPcs: phpRound(sell / qty, 2),
      buyPrice: sell,
    });
  }
  if (out.length === 0) throw new PricingError('no_priced_layout', 'no sheet size lays the blank out');
  // Cheapest first, then sheet order (quirk C2; legacy kept the first size).
  return out
    .map((l, i) => ({ l, i }))
    .sort((x, y) => x.l.buyPrice - y.l.buyPrice || x.i - y.i)
    .map((x) => x.l);
}
