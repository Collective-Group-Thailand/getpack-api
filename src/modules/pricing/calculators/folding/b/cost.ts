import { convertNumberFloat, phpFloatval } from '../../../engine/php';
import { type LayoutCandidate } from '../geometry/types';
import { type FactoryMargin } from '../margin';
import {
  type Finish2Request,
  hasDiecut,
  hasPrintBack,
  hasPrintFront,
  type PartRequest,
  PricingError,
  printAmount,
  type PrintColour,
} from '../request';
import { inBand, type PrintPlateRow, type SizeRange } from '../tables';
import { type FoilArea, foilArea } from './foil';
import { type BTables, type CodeMarginRow } from './tables';
import { type BWasteResult } from './waste';

/**
 * Cost of engine B (legacy `app/Libraries/Folding/B/CalculateCost.php:60-298`, port map §5). Every fitting print plate
 * and every fitting die block gives its own copy of the layout (`calCostPrint:319-445`, `calCostDiecut:447-503`);
 * finishing, foil and assembly are then costed per copy and the copies are ordered with engine A's keys. A price line
 * the factory lacks refuses the configuration instead of pricing the process at 0 (Q16; QB9–QB11, QB14, QB21, QB26).
 */

export interface BPrintCost {
  platePrice: number;
  printPrice: number;
  combinePrice: number;
  totalCost: number;
  paperAmount: number;
}

export interface BDiecutCost {
  blockMaxW: number;
  blockMaxL: number;
  blockPrice: number;
  price: number;
  totalCost: number;
  paperAmount: number;
}

export interface BFinishCost {
  finishId: string;
  price: number;
  selectedPrice: number;
  toolingPrice: number;
  blockPrice: number;
  materialPrice: number;
  totalCost: number;
  paperAmount: number;
}

export interface BFoilCost {
  finishId: string;
  axis: 'md' | 'cd';
  area: FoilArea;
  wagePrice: number;
  foilPricePerM2: number;
  totalCostMd: number;
  totalCostCd: number;
  totalCost: number;
  paperAmount: number;
}

export interface BAssemblyCost {
  assemblyId: string;
  case: 1 | 2 | 3 | 4;
  price: number;
  selectedPrice: number;
  materialPrice: number;
  blockPrice: number;
  totalCost: number;
}

export interface BMargin extends FactoryMargin {
  codeName: string | null;
  maxRangeContPct: number;
  minContBahtPerLot: number;
  /** `Object/Margin::calContribution`: cost ÷ (1 − m) − cost. */
  contribution: number;
  /** `calMaxContribution`: the contribution floored by the code's minimum per lot. */
  maxCont: number;
}

export interface BPricedLayout {
  layout: LayoutCandidate;
  waste: BWasteResult;
  printPlate: PrintPlateRow | null;
  printFront: BPrintCost | null;
  printBack: BPrintCost | null;
  diecut: BDiecutCost | null;
  finish1Front: BFinishCost | null;
  finish1Back: BFinishCost | null;
  finish2: BFinishCost[];
  foil: BFoilCost[];
  assembly: BAssemblyCost[];
  costPaperSize: number;
  totalCost: number;
  costPerPcs: number;
  margin: BMargin;
}

const missing = (what: string): PricingError => new PricingError('price_line_missing', what);
const refused = (what: string): PricingError => new PricingError('process_not_possible', what);

/** Legacy `paperSheetIsAvailableBlock` (`:302-317`). */
const fits = (r: SizeRange, w: number, l: number): boolean =>
  w >= r.wMin && w <= r.wMax && l >= r.lMin && l <= r.lMax;

interface SheetContext {
  /** m² of the print area, despite legacy's name (`calPrintArea`). */
  areaMm2: number;
  areaInch2: number;
  /** Cut sheet without edge, in² (`calFinishingArea`). */
  areaF1: number;
  areaM2: number;
  sheetInW: number;
  sheetInL: number;
}

// --- printing (`calCostPrint:319-445`, `calPrintPriceCost:1524`) ---------------------------------

/** One side on one plate, or the missing line that makes the plate unusable (an incomplete plate is skipped). */
function printSide(
  colours: readonly PrintColour[],
  sheets: number,
  plate: PrintPlateRow,
  ctx: SheetContext,
  tables: BTables,
  side: string,
): BPrintCost | string {
  // Semi-tones are none (D-233): the passes are the colours' counts (`print_amount`, no AW extras).
  const passes = printAmount(colours);
  const platePrice = [...passes.values()].reduce((a, b) => a + b, 0) * plate.platePrice;
  let printPrice = 0;
  let combinePrice = 0;
  for (const [inkColourId, count] of passes) {
    const row = tables.printPrices.find(
      (r) => r.machineId === plate.machineId && r.inkColourId === inkColourId && r.colourCount === count,
    );
    if (!row) return `b_print_prices ${side} ${inkColourId}×${count} machine ${plate.machineId}`;
    printPrice += ctx.areaMm2 * row.priceInkPerM2 * sheets;
    combinePrice += row.priceColorCombineSpecialColor;
  }
  return {
    platePrice,
    printPrice,
    combinePrice,
    totalCost: platePrice + printPrice + combinePrice,
    paperAmount: sheets,
  };
}

interface PrintCopy {
  plate: PrintPlateRow | null;
  front: BPrintCost | null;
  back: BPrintCost | null;
}

function printCopies(
  request: PartRequest,
  waste: BWasteResult,
  ctx: SheetContext,
  tables: BTables,
): PrintCopy[] {
  if (!hasPrintFront(request) && !hasPrintBack(request)) return [{ plate: null, front: null, back: null }];
  if (tables.printPlates.length === 0) throw missing('print_plates');
  const gaps: string[] = [];
  const copies: PrintCopy[] = [];
  for (const plate of tables.printPlates.filter((p) => fits(p, ctx.sheetInW, ctx.sheetInL))) {
    const front = hasPrintFront(request)
      ? printSide(request.printFront!, waste.sheets.printFront, plate, ctx, tables, 'front')
      : null;
    const back = hasPrintBack(request)
      ? printSide(request.printBack!, waste.sheets.printBack, plate, ctx, tables, 'back')
      : null;
    if (typeof front === 'string' || typeof back === 'string') {
      gaps.push(typeof front === 'string' ? front : (back as string));
      continue;
    }
    copies.push({ plate, front, back });
  }
  if (copies.length === 0 && gaps.length > 0) throw missing(gaps[0]!);
  return copies;
}

// --- die-cut (`calCostDiecut:447-503`, `initCostDiecut:1473`) -------------------------------------

function diecutCopies(request: PartRequest, waste: BWasteResult, ctx: SheetContext, tables: BTables) {
  if (!hasDiecut(request)) return [null];
  // Legacy prices the die-cut only when both a price and a block exist (`:1484-1490`); else it was free.
  const price = tables.diecutPrices[0];
  if (!price || tables.diecutBlocks.length === 0) throw missing('diecut_prices / diecut_block_prices');
  const dcPrice = ctx.areaM2 * price.diecutPrice * waste.sheets.diecut;
  return tables.diecutBlocks
    .filter((b) => fits(b, ctx.sheetInW, ctx.sheetInL))
    .map((b): BDiecutCost => ({
      blockMaxW: b.wMax,
      blockMaxL: b.lMax,
      blockPrice: b.diecutPrice,
      price: dcPrice,
      totalCost: dcPrice + b.diecutPrice,
      paperAmount: waste.sheets.diecut,
    }));
}

// --- finishing (`calCostFinish:584-1083`) ---------------------------------------------------------

function finish1(
  id: string | undefined,
  side: 'front' | 'back',
  sheets: number,
  ctx: SheetContext,
  tables: BTables,
): BFinishCost | null {
  if (id === undefined) return null;
  const row = tables.finishPrices.find((r) => r.finishId === id);
  if (!row) throw missing(`finish_prices finish1_${side} ${id}`);
  const price = ctx.areaF1 * row.priceByAreaPerIn2 * sheets;
  const selectedPrice = price < row.minPrice ? row.minPrice : price;
  // The block price is per in² on the front but flat on the back (QB16, ported).
  const blockPrice = side === 'front' ? ctx.areaF1 * row.blockPricePerIn2 : row.blockPricePerIn2;
  return {
    finishId: id,
    price,
    selectedPrice,
    toolingPrice: row.toolingPrice,
    blockPrice,
    materialPrice: 0,
    totalCost: selectedPrice + row.toolingPrice + blockPrice,
    paperAmount: sheets,
  };
}

/**
 * Area (in²) and count of a non-foil finish 2 (`:765-771`): the whole sheet once, or the location size × amount when
 * the finish requires them. getpack carries a size per location (D-233): equal sizes give legacy's size × amount;
 * unequal sizes are summed once each (legacy took one size).
 */
function finish2Area(f: Finish2Request, ctx: SheetContext): { area: number; amount: number } {
  const amount = f.requiresAmount && f.amount !== undefined ? f.amount : 1;
  if (!(f.requiresWidth && f.requiresLength && f.w?.length && f.l?.length))
    return { area: ctx.areaF1, amount };
  const areas = f.w.map((w, k) => (w / 25.4) * (f.l![k]! / 25.4));
  if (areas.every((a) => a === areas[0])) return { area: areas[0]!, amount };
  return { area: areas.reduce((a, b) => a + b, 0), amount: 1 };
}

/** One location per foil finish (D-233): the configuration carries no position, which only matters for 2+ locations. */
function foilLocation(f: Finish2Request): { x: number; y: number; width: number; length: number } {
  const locations = f.w?.length ?? 0;
  if (locations === 0 || !f.l?.length) throw refused(`foil ${f.finishId} needs its size (one location)`);
  if (locations > 1 || (f.amount !== undefined && f.amount > 1)) {
    throw refused(`foil ${f.finishId} with ${Math.max(locations, f.amount ?? 1)} locations needs positions`);
  }
  return { x: 0, y: 0, width: f.w![0]!, length: f.l[0]! };
}

interface Finish2Result {
  finish2: BFinishCost[];
  foil: BFoilCost[];
}

/** Finish 2 of one layout copy, or null when a foil block does not take the sheet (the copy is dropped). */
function finish2Costs(
  request: PartRequest,
  layout: LayoutCandidate,
  waste: BWasteResult,
  ctx: SheetContext,
  tables: BTables,
): Finish2Result | null {
  const finish2: BFinishCost[] = [];
  const foil: BFoilCost[] = [];
  for (const [i, f] of request.finish2.entries()) {
    // Sheets of this finish: the finish-2 sheets minus the waste of the finishes before it (`array_splice`).
    const sheets = Math.abs(waste.sheets.finish2 - waste.finish2.slice(0, i).reduce((a, b) => a + b, 0));
    if (f.isFoil) {
      const row = tables.foilPrices.find((r) => r.finishId === f.finishId);
      if (!row) throw missing(`foil_prices ${f.finishId}`);
      // Every foil block must take the sheet (legacy let the last foil decide, QB15).
      if (!fits(row, ctx.sheetInW, ctx.sheetInL)) return null;
      const area = foilArea([foilLocation(f)], {
        layoutStandard: layout.layoutStandard,
        c: layout.c,
        gap: layout.gap,
        dw: layout.dw,
        dl: layout.dl,
        trim: layout.trimFoilMm,
        layPw: layout.slotW,
        layPl: layout.slotL,
      });
      if (!area) throw refused(`foil ${f.finishId} area`);
      const wagePrice = row.priceByAreaPerIn2 * ctx.areaInch2;
      const foilPricePerM2 = row.bahtPerRoll / (row.rollWidthIn * 0.0254 * (row.rollLengthIn * 0.0254));
      const axisCost = (areaM2: number): number => {
        const cost = (wagePrice + foilPricePerM2 * areaM2) * sheets;
        const min = row.bahtPerRoll + wagePrice * sheets;
        return Math.max(cost, min) + row.toolingPrice;
      };
      const totalCostMd = axisCost(area.md.areaM2);
      const totalCostCd = axisCost(area.cd.areaM2);
      // Automatic axis (`:838-873`): fewer lines, then cheaper, then CD.
      const axis: 'md' | 'cd' =
        area.md.totalLine > area.cd.totalLine
          ? 'cd'
          : area.md.totalLine < area.cd.totalLine
            ? 'md'
            : totalCostMd < totalCostCd
              ? 'md'
              : 'cd';
      foil.push({
        finishId: f.finishId,
        axis,
        area,
        wagePrice,
        foilPricePerM2,
        totalCostMd,
        totalCostCd,
        totalCost: axis === 'md' ? totalCostMd : totalCostCd,
        paperAmount: sheets,
      });
      continue;
    }
    const row = tables.finishPrices.find((r) => r.finishId === f.finishId);
    if (!row) throw missing(`finish_prices finish2[${i}] ${f.finishId}`);
    const { area, amount } = finish2Area(f, ctx);
    const price = area * row.priceByAreaPerIn2 * sheets * amount;
    const selectedPrice = price < row.minPrice ? row.minPrice : price;
    // Material and block are added flat, not per in² (QB17, ported).
    finish2.push({
      finishId: f.finishId,
      price,
      selectedPrice,
      toolingPrice: row.toolingPrice,
      blockPrice: row.blockPricePerIn2,
      materialPrice: row.materialPricePerIn2,
      totalCost: row.toolingPrice + row.materialPricePerIn2 + row.blockPricePerIn2 + selectedPrice,
      paperAmount: sheets,
    });
  }
  return { finish2, foil };
}

// --- assembly (`calCostAssembly:1085-1245`) -------------------------------------------------------

function assemblyCosts(request: PartRequest, layout: LayoutCandidate, tables: BTables): BAssemblyCost[] {
  return request.assemblies.map((a): BAssemblyCost => {
    // Rows by the run (`initCostAssembly:1284`, `box_amount` band, inclusive, open when blank).
    const row = tables.assemblyPrices.find(
      (r) => r.assemblyId === a.assemblyId && inBand(r.rangeMin, r.rangeMax, layout.boxAmount),
    );
    if (!row) throw missing(`b_assembly_prices ${a.assemblyId} @${layout.boxAmount}`);
    const amount = a.requiresAmount && a.amount !== undefined ? a.amount : layout.boxAmount;
    let price: number;
    let materialPrice = 0;
    switch (row.assemblyType) {
      case 1: {
        price = amount * row.pricePerDepthM * (layout.dw * 0.001);
        const widthInch = layout.dw / 25.4;
        materialPrice = row.materialPricePerIn2 * (widthInch * widthInch);
        break;
      }
      case 2: {
        // Legacy reads one window size (`:1155`); getpack sums each window's area.
        if (!a.w?.length || !a.l?.length) throw refused(`assembly ${a.assemblyId} needs the window size`);
        const area = a.w.reduce((s, w, k) => s + (w / 25.4) * (a.l![k]! / 25.4), 0);
        price = amount * row.minPricePerAreaIn2 * area;
        break;
      }
      default:
        // Types 3 and 4 are identical (QB31).
        price = amount * row.pricePerPcs;
    }
    const selectedPrice = price < row.minPrice ? row.minPrice : price;
    return {
      assemblyId: a.assemblyId,
      case: row.assemblyType,
      price,
      selectedPrice,
      materialPrice,
      blockPrice: row.blockPrice,
      totalCost: selectedPrice + row.blockPrice + materialPrice,
    };
  });
}

// --- margin (`calMargin:1780-1836`, `Object/Margin::calculate:65-110`) -----------------------------

/** The code with the smallest `max_range_cont` above the margin % (`CodeMarginController::index:21-24`). */
export function codeMarginFor(rows: readonly CodeMarginRow[], marginPct: number): CodeMarginRow | undefined {
  let best: CodeMarginRow | undefined;
  for (const r of rows) {
    if (r.maxRangeContPct > marginPct && (!best || r.maxRangeContPct < best.maxRangeContPct)) best = r;
  }
  return best;
}

/** Compute type 2 at the factory margin % (D-233): the contribution, floored by the code's minimum per lot. */
export function bFactoryMargin(
  totalCost: number,
  marginPct: number,
  qty: number,
  code: CodeMarginRow,
): BMargin {
  const contribution = totalCost / (1 - marginPct / 100) - totalCost;
  const maxCont = Math.max(code.minContBahtPerLot, contribution);
  const salePrice = totalCost + maxCont;
  const suggestPrice = convertNumberFloat(salePrice / qty);
  return {
    percentMargin: marginPct,
    margin: contribution,
    saleValueBahtPerLot: phpFloatval(suggestPrice) * qty,
    totalCost,
    qty,
    salePrice,
    suggestPrice,
    codeName: code.codeName,
    maxRangeContPct: code.maxRangeContPct,
    minContBahtPerLot: code.minContBahtPerLot,
    contribution,
    maxCont,
  };
}

// --- per layout and ordering (`calculate:60-298`) ---------------------------------------------------

/** Every priced copy of one layout (one per fitting plate × fitting die block); empty when none fits. */
export function priceBLayout(
  request: PartRequest,
  layout: LayoutCandidate,
  waste: BWasteResult,
  tables: BTables,
): BPricedLayout[] {
  const code = codeMarginFor(tables.codeMargins, tables.terms.factoryMarginPct);
  if (!code) throw missing(`code_margins above ${tables.terms.factoryMarginPct}%`);
  const areaMm2 = (layout.areaW * layout.areaL) / 1000000;
  const areaF1 = layout.paperSheetWWithoutEdge * layout.paperSheetLWithoutEdge;
  const ctx: SheetContext = {
    areaMm2,
    areaInch2: areaMm2 * 1550,
    areaF1,
    areaM2: areaF1 * 0.00064516,
    sheetInW: Math.min(layout.paperSheetWWithoutEdge, layout.paperSheetLWithoutEdge),
    sheetInL: Math.max(layout.paperSheetWWithoutEdge, layout.paperSheetLWithoutEdge),
  };
  const prints = printCopies(request, waste, ctx, tables);
  if (prints.length === 0) return [];
  const diecuts = diecutCopies(request, waste, ctx, tables);
  if (diecuts.length === 0) return [];
  const finish1Front = finish1(request.finish1FrontId, 'front', waste.sheets.finish1Front, ctx, tables);
  const finish1Back = finish1(request.finish1BackId, 'back', waste.sheets.finish1Back, ctx, tables);
  const f2 = finish2Costs(request, layout, waste, ctx, tables);
  if (!f2) return [];
  const assembly = assemblyCosts(request, layout, tables);
  const fixed =
    waste.costPaperSize +
    (finish1Front?.totalCost ?? 0) +
    (finish1Back?.totalCost ?? 0) +
    f2.finish2.reduce((a, c) => a + c.totalCost, 0) +
    f2.foil.reduce((a, c) => a + c.totalCost, 0) +
    assembly.reduce((a, c) => a + c.totalCost, 0);
  const copies: BPricedLayout[] = [];
  for (const print of prints) {
    for (const diecut of diecuts) {
      // Sorting, packing and factory delivery are none (D-233).
      const totalCost =
        fixed + (print.front?.totalCost ?? 0) + (print.back?.totalCost ?? 0) + (diecut?.totalCost ?? 0);
      copies.push({
        layout,
        waste,
        printPlate: print.plate,
        printFront: print.front,
        printBack: print.back,
        diecut,
        finish1Front,
        finish1Back,
        finish2: f2.finish2,
        foil: f2.foil,
        assembly,
        costPaperSize: waste.costPaperSize,
        totalCost,
        costPerPcs: totalCost / layout.boxAmount,
        margin: bFactoryMargin(totalCost, tables.terms.factoryMarginPct, layout.qty, code),
      });
    }
  }
  return copies;
}

/** Engine A's ordering keys (`:271-298`, `A/CalculateCost.php:313-329`); ties keep the copy order (Q10). */
export function sortBLayouts(layouts: BPricedLayout[]): BPricedLayout[] {
  const keys = (p: BPricedLayout): number[] => [
    p.totalCost,
    p.layout.layoutStandard ? 1 : 0,
    p.layout.lIsGrainStandard ? -1 : 0,
    p.printPlate?.wMax ?? 0,
    p.printPlate?.lMax ?? 0,
    p.diecut?.blockMaxW ?? 0,
    p.diecut?.blockMaxL ?? 0,
  ];
  return layouts
    .map((p, i) => ({ p, i, k: keys(p) }))
    .sort((a, b) => {
      for (let j = 0; j < a.k.length; j++) if (a.k[j] !== b.k[j]) return a.k[j]! - b.k[j]!;
      return a.i - b.i;
    })
    .map((x) => x.p);
}
