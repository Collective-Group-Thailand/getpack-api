import { calLayoutAmount } from '../geometry/layout-amount';
import { type LayoutCandidate } from '../geometry/types';
import { type FactoryMargin, factoryMargin } from '../margin';
import {
  type AssemblyRequest,
  hasAssembly,
  hasDiecut,
  hasFinish2,
  hasPrintBack,
  hasPrintFront,
  type PartRequest,
  PricingError,
  printAmount,
  type PrintColour,
} from '../request';
import {
  type DiecutBlockRow,
  type DiecutPriceRow,
  type FinishPriceRow,
  inBand,
  inSheetBand,
  type OffsetTables,
  type PrintPlateRow,
  type SizeRange,
} from '../tables';
import { type WasteResult } from './waste';

/**
 * Cost of engine A offset (legacy `app/Libraries/Folding/A/CalculateCost.php`). For every layout that
 * survived the waste step: the cheapest print plate, then the cheapest die block, finishing, assembly,
 * and the factory margin; layouts are then ordered like legacy (`calculate:298-336`). A price row the
 * factory lacks makes legacy price that process at 0; getpack refuses instead (quirk Q16).
 */

export interface PrintCost {
  platePrice: number;
  printPrice: number;
  combinePrice: number;
  operationCost: number;
  totalCost: number;
  paperAmount: number;
}

export interface Finish1Cost {
  finishId: string;
  priceByArea: number;
  pricePerSheet: number;
  selectedPrice: number;
  toolingPrice: number;
  diecutBlockPrice: number;
  blockPrice: number;
  operationCost: number;
  totalCost: number;
  paperAmount: number;
}

export interface Finish2Cost {
  finishId: string;
  area: number;
  paperAmount: number;
  platePrice: number;
  price: number;
  selectedPrice: number;
  materialPrice: number;
  toolingPrice: number;
  operationCost: number;
  totalCost: number;
}

export interface DiecutCost {
  machineId: string;
  blockMaxW: number;
  blockMaxL: number;
  blockPrice: number;
  price: number;
  operationCost: number;
  totalCost: number;
  paperAmount: number;
}

export interface AssemblyCost {
  assemblyId: string;
  case: 1 | 2 | 3 | 4;
  price: number;
  selectedPrice: number;
  materialPrice: number;
  blockPrice: number;
  diecutBlockPrice: number;
  diecutPrice: number;
  totalCost: number;
}

export interface PricedLayout {
  layout: LayoutCandidate;
  waste: WasteResult;
  printPlate: PrintPlateRow | null;
  printFront: PrintCost | null;
  printBack: PrintCost | null;
  diecut: DiecutCost | null;
  finish1Front: Finish1Cost | null;
  finish1Back: Finish1Cost | null;
  finish2: Finish2Cost[];
  assembly: AssemblyCost[];
  costPaperSize: number;
  totalCost: number;
  costPerPcs: number;
  margin: FactoryMargin;
}

const missing = (what: string): PricingError => new PricingError('price_line_missing', what);

/** Legacy `paperSheetIsAvailableBlock` (`:338-354`): the sheet fits the range on both sides. */
const fits = (r: SizeRange, w: number, l: number): boolean =>
  w >= r.wMin && w <= r.wMax && l >= r.lMin && l <= r.lMax;

/** First element with the lowest key, like legacy `array_multisort(..., SORT_ASC)` then `[0]`. */
function cheapest<T>(items: readonly T[], key: (t: T) => number): T | undefined {
  let best: T | undefined;
  for (const item of items) if (best === undefined || key(item) < key(best)) best = item;
  return best;
}

interface SheetContext {
  areaMm2: number;
  areaF1: number;
  /** Cut sheet without edge, short and long side, inches (`c_paper_sheet_in_w/l`). */
  sheetInW: number;
  sheetInL: number;
}

// --- printing (`calCostPrint:356-677`) ---------------------------------------------------------

/** One printed side on one plate, or the missing price line that makes the plate unusable. */
function printSide(
  colours: readonly PrintColour[],
  paperAmount: number,
  plate: PrintPlateRow,
  tables: OffsetTables,
  side: string,
): PrintCost | string {
  const passes = printAmount(colours);
  const platePrice = [...passes.values()].reduce((a, b) => a + b, 0) * plate.platePrice;
  const rows = tables.printPrices.filter(
    (r) => r.machineId === plate.machineId && inSheetBand(r, paperAmount),
  );
  const maxPercent = Math.max(...colours.map((c) => c.percent));
  const prices: number[] = [];
  const combines: number[] = [];
  const operations: number[] = [];
  let count = 0;
  for (const colour of colours) {
    const normal = (): string | null => {
      const row = rows.find((r) => r.inkColourId === colour.inkColourId && r.percentColor === colour.percent);
      if (!row) return `print_prices ${side} ${colour.inkColourId} ${colour.percent}% @${paperAmount}`;
      prices.push(row.pricePerSheet + row.pricePerPcs * paperAmount);
      combines.push(row.priceColorCombineSpecialColor);
      operations.push(row.operationCost);
      return null;
    };
    let gap: string | null = null;
    // A standard colour laid four times is one 4-colour pass at the flat price (`:421-486`).
    if (tables.standardInkColours.has(colour.inkColourId) && passes.get(colour.inkColourId)! >= 4) {
      count++;
      if (count === 4) {
        const row = rows.find(
          (r) =>
            r.inkColourId === colour.inkColourId &&
            (!tables.terms.fourColourPriceByMaxPercent || r.percentColor === maxPercent),
        );
        if (!row) return `print_prices ${side} 4-colour ${colour.inkColourId} @${paperAmount}`;
        prices.push(row.flatPriceFourColor + row.flatPriceFourColorPerPcs * paperAmount);
        combines.push(row.priceColorCombineSpecialColor);
        operations.push(row.operationCost);
      } else if (count > 4) {
        gap = normal();
      }
    } else {
      gap = normal();
    }
    if (gap) return gap;
  }
  const printPrice = prices.reduce((a, b) => a + b, 0);
  const combinePrice = combines.reduce((a, b) => a + b, 0);
  // Legacy charges the operation cost of the first colour only (`:531`).
  const operationCost = operations[0] ?? 0;
  return {
    platePrice,
    printPrice,
    combinePrice,
    operationCost,
    totalCost: platePrice + printPrice + combinePrice + operationCost,
    paperAmount,
  };
}

interface PrintChoice {
  plate: PrintPlateRow;
  front: PrintCost | null;
  back: PrintCost | null;
}

/**
 * The cheapest plate that fits the sheet (`:374-676`). Legacy prices a missing colour row at 0, which
 * made that plate look cheapest; getpack skips an incomplete plate and refuses when none is complete.
 */
function choosePrint(
  request: PartRequest,
  waste: WasteResult,
  ctx: SheetContext,
  tables: OffsetTables,
): PrintChoice | null {
  if (tables.printPlates.length === 0) throw missing('print_plates');
  const gaps: string[] = [];
  const options: PrintChoice[] = [];
  for (const plate of tables.printPlates.filter((p) => fits(p, ctx.sheetInW, ctx.sheetInL))) {
    const front = hasPrintFront(request)
      ? printSide(request.printFront!, waste.printFront, plate, tables, 'front')
      : null;
    const back = hasPrintBack(request)
      ? printSide(request.printBack!, waste.printBack, plate, tables, 'back')
      : null;
    if (typeof front === 'string' || typeof back === 'string') {
      gaps.push(typeof front === 'string' ? front : (back as string));
      continue;
    }
    options.push({ plate, front, back });
  }
  if (options.length === 0 && gaps.length > 0) throw missing(gaps[0]!);
  return cheapest(options, (o) => (o.front?.totalCost ?? 0) + (o.back?.totalCost ?? 0)) ?? null;
}

// --- die-cut (`calCostDiecut:679-840`) ---------------------------------------------------------

function chooseDiecut(layout: LayoutCandidate, waste: WasteResult, tables: OffsetTables): DiecutCost | null {
  if (tables.diecutPrices.length === 0 || tables.diecutBlocks.length === 0) {
    throw missing('diecut_prices / diecut_block_prices');
  }
  const maxVal = Math.max(layout.paperSheetWWithoutEdge, layout.paperSheetLWithoutEdge);
  const minVal = Math.min(layout.paperSheetWWithoutEdge, layout.paperSheetLWithoutEdge);
  const layoutAmount = Math.trunc(layout.layoutAmount);
  const blocks = tables.diecutBlocks.filter(
    (b) =>
      b.wMin <= minVal &&
      b.wMax >= minVal &&
      b.lMin <= maxVal &&
      b.lMax >= maxVal &&
      inBand(b.layMin, b.layMax, layoutAmount),
  );
  // One option per machine, with that machine's first block (legacy `groupBy('machine_id')`, `:721`).
  const byMachine = new Map<string, DiecutBlockRow>();
  for (const b of blocks) if (!byMachine.has(b.machineId)) byMachine.set(b.machineId, b);
  const options: DiecutCost[] = [];
  for (const [machineId, block] of byMachine) {
    const price = tables.diecutPrices.find((p) => p.machineId === machineId && inSheetBand(p, waste.diecut));
    if (!price) continue;
    const blockPrice = block.diecutPrice + block.pricePerDrawing * layout.layoutAmount;
    const cutPrice = price.diecutPrice + waste.diecut * price.pricePerSheet;
    options.push({
      machineId,
      blockMaxW: block.wMax,
      blockMaxL: block.lMax,
      blockPrice,
      price: cutPrice,
      operationCost: price.operationCost,
      totalCost: cutPrice + blockPrice + price.operationCost,
      paperAmount: waste.diecut,
    });
  }
  return cheapest(options, (o) => o.price + o.blockPrice) ?? null;
}

// --- finishing (`calCostFinish:924-1198`) ------------------------------------------------------

function finish1(
  row: FinishPriceRow,
  side: 'front' | 'back',
  paperAmount: number,
  ctx: SheetContext,
  diecut: DiecutCost | null,
): Finish1Cost {
  let diecutBlockPrice = 0;
  if (row.addsDiecutWindow) {
    // Front adds half the block plus the cut and its operation; back only half the block (`:946-991`).
    diecutBlockPrice = diecut ? diecut.blockPrice / 2 : 0;
    if (side === 'front') {
      diecutBlockPrice += diecut ? diecut.price : 0;
      diecutBlockPrice += diecut ? diecut.operationCost : 0;
    }
  }
  const priceByArea =
    side === 'front'
      ? ctx.areaF1 * row.priceByAreaPerIn2 * paperAmount
      : ctx.areaF1 * row.priceByAreaPerIn2 * paperAmount * 1;
  const pricePerSheet = paperAmount * row.pricePerSheet;
  const selectedPrice = Math.max(priceByArea, row.minPrice, pricePerSheet);
  const blockPrice = ctx.areaF1 * row.blockPricePerIn2;
  return {
    finishId: row.finishId,
    priceByArea,
    pricePerSheet,
    selectedPrice,
    toolingPrice: row.toolingPrice + diecutBlockPrice,
    diecutBlockPrice,
    blockPrice,
    operationCost: row.operationCost,
    totalCost: selectedPrice + row.toolingPrice + blockPrice + diecutBlockPrice + row.operationCost,
    paperAmount,
  };
}

/** Finish 2 of every position, or null when a plate or a machine price is missing (legacy drops the layout). */
function finish2Costs(
  request: PartRequest,
  layout: LayoutCandidate,
  waste: WasteResult,
  ctx: SheetContext,
  tables: OffsetTables,
): Finish2Cost[] | null {
  const trimPlate = layout.patternArea.trimFinishPlateMm;
  const costs: Finish2Cost[] = [];
  for (const [i, f2] of request.finish2.entries()) {
    const plate = tables.finishPlates.find(
      (p) => p.finishId === f2.finishId && fits(p, ctx.sheetInW, ctx.sheetInL),
    );
    if (!plate) return null;
    const paperAmount = waste.finish2[i]!;
    if (!tables.finishPrices.some((r) => r.finishId === f2.finishId && inSheetBand(r, paperAmount))) {
      throw missing(`finish_prices ${f2.finishId} @${paperAmount}`);
    }
    // Area of the finish: its locations with the plate trim, else the whole sheet (`:1105-1115`).
    const areas =
      f2.requiresWidth && f2.requiresLength && f2.w?.length && f2.l?.length
        ? f2.w.map((w, k) => ((w + trimPlate * 2) / 25.4) * ((f2.l![k]! + trimPlate * 2) / 25.4))
        : [ctx.areaF1];
    const area = areas.reduce((a, b) => a + b, 0);
    let platePrice = area * plate.pricePerIn2 * layout.layoutAmount;
    if (platePrice < plate.minPlatePrice) platePrice = plate.minPlatePrice;
    const row = tables.finishPrices.find(
      (r) => r.finishId === f2.finishId && inSheetBand(r, paperAmount) && r.machineId === plate.machineId,
    );
    if (!row) return null;
    const price = row.finishPrice + row.pricePerSheet * paperAmount;
    const selectedPrice = Math.max(row.minPrice, price);
    const materialPrice = row.materialPricePerIn2 * area * layout.layoutAmount * paperAmount;
    costs.push({
      finishId: f2.finishId,
      area,
      paperAmount,
      platePrice,
      price,
      selectedPrice,
      materialPrice,
      toolingPrice: row.toolingPrice,
      operationCost: row.operationCost,
      totalCost: row.toolingPrice + materialPrice + selectedPrice + platePrice + row.operationCost,
    });
  }
  return costs;
}

// --- assembly (`calCostAssembly:1200-1603`) ----------------------------------------------------

interface WindowDiecut {
  blockPrice: number;
  price: number;
  totalDiecut: number;
  slotW: number;
  slotL: number;
  areaW: number;
  areaL: number;
}

/** The cheapest die block for an assembly window on the factory's assembly sheets (`:1262-1440`). */
function windowDiecut(
  asb: AssemblyRequest,
  layout: LayoutCandidate,
  tables: OffsetTables,
): WindowDiecut | null {
  const trim = layout.patternArea;
  const boxAmount = layout.boxAmount;
  const options: WindowDiecut[] = [];
  for (const sheet of tables.assemblySheets) {
    const pw = sheet.wIn - trim.paperTrimW / 25.4 - trim.edgeTrim / 25.4;
    const pl = sheet.lIn - trim.paperTrimL / 25.4 - trim.edgeTrim / 25.4;
    const checkBlock = tables.diecutBlocks.some(
      (b) => b.wMin <= pw && b.wMax >= pw && b.lMin <= pl && b.lMax >= pl,
    );
    if (!checkBlock) continue;
    for (const [k, w] of (asb.w ?? []).entries()) {
      const l = asb.l![k]!;
      const dwWithGap = w + trim.paperTrimGap + trim.trimFinishPlateMm * 2;
      const dlWithGap = l + trim.paperTrimGap + trim.trimFinishPlateMm * 2;
      for (const standard of [true, false]) {
        const res = calLayoutAmount({
          pw: pw * 25.4,
          pl: pl * 25.4,
          dw: dwWithGap,
          dl: dlWithGap,
          c: 0,
          layoutStandard: standard,
          trimGap: trim.paperTrimGap,
          paperTrimW: trim.paperTrimW,
          paperTrimL: trim.paperTrimL,
        });
        // Legacy guards only the rotated layout (`:1367`).
        if (!standard && !res.layout) continue;
        const totalLay = res.layout;
        const block = tables.diecutBlocks.find(
          (b) =>
            b.wMax === sheet.wIn && b.lMax === sheet.lIn && inBand(b.layMin, b.layMax, Math.trunc(totalLay)),
        );
        if (!block) continue;
        const sheets = Math.ceil(boxAmount / totalLay);
        // With no lay the legacy sheet count is infinite and never in a band (`:1342`).
        const price: DiecutPriceRow | undefined =
          totalLay > 0
            ? tables.diecutPrices.find((p) => p.machineId === block.machineId && inSheetBand(p, sheets))
            : undefined;
        const blockPrice = block.diecutPrice + block.pricePerDrawing * totalLay;
        const cutPrice = price ? price.diecutPrice + sheets * price.pricePerSheet : 0;
        options.push({
          blockPrice,
          price: cutPrice,
          totalDiecut: blockPrice + cutPrice,
          slotW: res.slotW,
          slotL: res.slotL,
          areaW: res.areaW,
          areaL: res.areaL,
        });
      }
    }
  }
  return cheapest(options, (o) => o.totalDiecut) ?? null;
}

/** Assembly costs, or null when legacy drops the layout (no price in the band, no window block). */
function assemblyCosts(
  request: PartRequest,
  layout: LayoutCandidate,
  ctx: SheetContext,
  tables: OffsetTables,
): AssemblyCost[] | null {
  if (!hasAssembly(request)) return [];
  if (tables.assemblyPrices.length === 0) return null;
  const area = layout.patternArea;
  const boxAmount = layout.boxAmount;
  const trimPlate = area.trimFinishPlateMm;
  const depthCm = tables.patternKind === 1 ? area.w * 0.1 : area.d * 0.1;
  const costs: AssemblyCost[] = [];
  // The window layout is carried across assemblies like legacy's local `$diecutAssembly` (`:1290`).
  let windowDc: WindowDiecut | null = null;
  for (const asb of request.assemblies) {
    const row = tables.assemblyPrices.find(
      (r) => r.assemblyId === asb.assemblyId && inBand(r.rangeMin, r.rangeMax, boxAmount),
    );
    if (!row) return null;
    let areas = [ctx.areaF1];
    let perimeter = 0;
    if (asb.requiresWidth && asb.requiresLength && asb.w?.length && asb.l?.length) {
      const sumW = asb.w.reduce((a, b) => a + b, 0);
      const sumL = asb.l.reduce((a, b) => a + b, 0);
      perimeter = (sumW + trimPlate * 2) * 0.1 * 2 + (sumL + trimPlate * 2) * 0.1 * 2;
      areas = asb.w.map((w, k) => ((w + trimPlate * 2) / 25.4) * ((asb.l![k]! + trimPlate * 2) / 25.4));
    }
    if (row.addsDiecutWindow) {
      windowDc = windowDiecut(asb, layout, tables);
      if (!windowDc) return null;
    }
    const diecutBlockPrice = row.addsDiecutWindow ? windowDc!.blockPrice : 0;
    const diecutPrice = row.addsDiecutWindow ? windowDc!.price : 0;
    const sumArea = areas.reduce((a, b) => a + b, 0);
    let price: number;
    let selectedPrice: number;
    let materialPrice: number;
    let totalCost: number;
    switch (row.assemblyType) {
      case 1: // by box height
        price = row.pricePerCm !== 0 ? boxAmount * row.pricePerCm * depthCm : boxAmount * row.pricePerPcs;
        selectedPrice = Math.max(price, row.minPrice);
        if (row.minimumOperation !== 0) selectedPrice += row.minimumOperation;
        materialPrice = row.materialPricePerIn2 * sumArea * boxAmount;
        totalCost = selectedPrice + row.blockPrice + materialPrice + diecutBlockPrice + diecutPrice;
        break;
      case 2: // by window perimeter
        price = boxAmount * row.pricePerCm * perimeter + row.pricePerPcs * boxAmount;
        selectedPrice = Math.max(price, row.minPrice);
        materialPrice = windowDc
          ? row.materialPricePerIn2 *
            (((windowDc.areaL / 25.4) * (windowDc.areaW / 25.4)) / (windowDc.slotW * windowDc.slotL)) *
            boxAmount
          : row.materialPricePerIn2 * sumArea * boxAmount;
        totalCost =
          selectedPrice +
          row.blockPrice +
          materialPrice +
          (diecutBlockPrice + diecutPrice) +
          row.minimumOperation;
        break;
      case 3: // per piece
        price = boxAmount * row.pricePerPcs;
        selectedPrice = Math.max(price, row.minPrice);
        materialPrice = row.materialPricePerIn2 * sumArea * boxAmount;
        totalCost = selectedPrice + row.blockPrice + materialPrice + diecutBlockPrice + diecutPrice;
        break;
      case 4: {
        // by box width
        const length = tables.patternKind === 1 ? (area.l / 2) * 0.1 : area.w * 2 * 0.1;
        price = boxAmount * row.pricePerCm * length + row.pricePerPcs * boxAmount;
        materialPrice = row.materialPricePerIn2 * length * boxAmount;
        selectedPrice = Math.max(price, row.minPrice);
        totalCost = selectedPrice + row.blockPrice + materialPrice + diecutBlockPrice + diecutPrice;
        break;
      }
    }
    costs.push({
      assemblyId: asb.assemblyId,
      case: row.assemblyType,
      price,
      selectedPrice,
      materialPrice,
      blockPrice: row.blockPrice + diecutBlockPrice,
      diecutBlockPrice,
      diecutPrice,
      totalCost,
    });
  }
  return costs;
}

// --- per layout and ordering (`calculate:70-336`) ----------------------------------------------

/** Cost of one layout, or null when legacy drops it (no plate / block / finish-2 plate / assembly price). */
export function priceLayout(
  request: PartRequest,
  layout: LayoutCandidate,
  waste: WasteResult,
  tables: OffsetTables,
): PricedLayout | null {
  const ctx: SheetContext = {
    areaMm2: (layout.areaW * layout.areaL) / 1000000,
    areaF1: layout.paperSheetWWithoutEdge * layout.paperSheetLWithoutEdge,
    sheetInW: Math.min(layout.paperSheetWWithoutEdge, layout.paperSheetLWithoutEdge),
    sheetInL: Math.max(layout.paperSheetWWithoutEdge, layout.paperSheetLWithoutEdge),
  };
  let print: PrintChoice | null = null;
  if (hasPrintFront(request) || hasPrintBack(request)) {
    print = choosePrint(request, waste, ctx, tables);
    if (!print) return null;
  }
  let diecut: DiecutCost | null = null;
  if (hasDiecut(request)) {
    diecut = chooseDiecut(layout, waste, tables);
    if (!diecut) return null;
  }
  const f1Row = (id: string | undefined): FinishPriceRow | null => {
    if (id === undefined) return null;
    // Legacy takes the finish's first price row, whatever its band or machine (`:1773-1806`).
    const row = tables.finishPrices.find((r) => r.finishId === id);
    if (!row) throw missing(`finish_prices ${id}`);
    return row;
  };
  const front = f1Row(request.finish1FrontId);
  const back = f1Row(request.finish1BackId);
  const finish1Front = front ? finish1(front, 'front', waste.finish1Front, ctx, diecut) : null;
  const finish1Back = back ? finish1(back, 'back', waste.finish1Back, ctx, diecut) : null;
  const finish2 = hasFinish2(request) ? finish2Costs(request, layout, waste, ctx, tables) : [];
  if (finish2 === null) return null;
  const assembly = assemblyCosts(request, layout, ctx, tables);
  if (assembly === null) return null;

  // Sorting, packing and factory delivery are always 0 on this path (quirk Q8).
  const parts = [
    waste.costPaperSize,
    print?.front?.totalCost ?? 0,
    print?.back?.totalCost ?? 0,
    finish1Front?.totalCost ?? 0,
    finish1Back?.totalCost ?? 0,
    finish2.reduce((a, f) => a + f.totalCost, 0),
    assembly.reduce((a, c) => a + c.totalCost, 0),
    diecut?.totalCost ?? 0,
    0,
    0,
    0,
  ];
  const totalCost = parts.reduce((a, b) => a + b, 0);
  return {
    layout,
    waste,
    printPlate: print?.plate ?? null,
    printFront: print?.front ?? null,
    printBack: print?.back ?? null,
    diecut,
    finish1Front,
    finish1Back,
    finish2,
    assembly,
    costPaperSize: waste.costPaperSize,
    totalCost,
    costPerPcs: totalCost / layout.boxAmount,
    margin: factoryMargin(totalCost, tables.terms.factoryMarginPct, layout.qty),
  };
}

/**
 * Legacy order of the priced layouts of a step (`:313-330`): total cost, then rotated before
 * standard, the grain along the long side first, then the smaller plate and die block. Ties keep
 * the layout order (legacy's sort is not stable — quirk Q10).
 */
export function sortPricedLayouts(layouts: PricedLayout[]): PricedLayout[] {
  const keys = (p: PricedLayout): number[] => [
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
