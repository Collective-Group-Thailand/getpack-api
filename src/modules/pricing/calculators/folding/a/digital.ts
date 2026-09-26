import { convertTo2Decimal } from '../../../engine/php';
import { type LayoutCandidate } from '../geometry/types';
import { digitalFactoryMargin, type FactoryMargin } from '../margin';
import {
  hasAssembly,
  hasDiecut,
  hasPrintBack,
  hasPrintFront,
  type PartRequest,
  PricingError,
  type PrintColour,
} from '../request';
import { type DigitalTables, type FinishPriceRow, inBand, inSheetBand, type PrintPriceRow } from '../tables';
import { type WasteResult } from './waste';

/**
 * Cost of engine A digital (legacy `app/Libraries/Folding/A/CalculateCostDigital.php`, the live part:
 * `calculate:75-513`, `initCost:1614-1878`, `calMargin:2379-2425`). Legacy branches on factories 9, 16
 * and 23 are the `DigitalTerms` of the print type (quirk Q11). Every component is rounded up to the
 * satang where legacy does (`convertTo2Decimal`).
 */

export interface DigitalPricedLayout {
  layout: LayoutCandidate;
  waste: WasteResult;
  paper: number;
  paperPerPcs: number;
  printFront: number | null;
  printBack: number | null;
  twoSidePrint: number;
  finish1Front: number | null;
  finish1Back: number | null;
  diecut: { price: number; blockPrice: number; totalCost: number } | null;
  assembly: number[];
  totalCost: number;
  costPerPcs: number;
  margin: FactoryMargin;
}

/** `inch2toM2` (helpers.php:223-228). */
export const inch2toM2 = (inch2: number): number => (inch2 * 2.54 * 2.54) / 10000;

const missing = (what: string): PricingError => new PricingError('price_line_missing', what);

function paperCost(
  request: PartRequest,
  layout: LayoutCandidate,
  waste: WasteResult,
  tables: DigitalTables,
): { paper: number; perPcs: number } {
  const t = tables.terms;
  const box = layout.boxAmount;
  if (t.paperMethod === 'per_piece_band') {
    // Legacy factory 9: the price per piece of the paper band holding the sheets (`:112-130`).
    const banded = tables.materialPrices.filter(
      (r) => r.minPaperAmount !== null || r.maxPaperAmount !== null,
    );
    const row = request.customCost
      ? banded[0]
      : banded.find((r) => inBand(r.minPaperAmount, r.maxPaperAmount, layout.paperAmount));
    if (!row || row.costPerPcs === null) throw missing(`material_prices band @${layout.paperAmount}`);
    const paper = convertTo2Decimal(row.costPerPcs / layout.layoutAmount) * box;
    return { paper, perPcs: paper / box };
  }
  const base = tables.materialPrices.find((r) => r.minPaperAmount === null && r.maxPaperAmount === null);
  if (!base) throw missing('material_prices');
  if (t.paperMethod === 'per_sheet') {
    // Legacy factory 23 (`:131-133`).
    if (base.costPerPcs === null) throw missing('material_prices cost per piece');
    return { paper: base.costPerPcs * waste.totalSheets, perPcs: base.costPerPcs };
  }
  if (base.costPerM2 === null) throw missing('material_prices cost per m²');
  if (t.trimDlMm > 0 || t.trimDwMm > 0) {
    // The blank plus its trims, per piece (`:134-136`).
    const paper = (((layout.dl + t.trimDlMm) * (layout.dw + t.trimDwMm)) / 1000000) * box * base.costPerM2;
    return { paper, perPcs: paper / box };
  }
  // The press sheet, per sheet (`:137-140`).
  return {
    paper: convertTo2Decimal(base.costPerM2 * inch2toM2(layout.pw * layout.pl) * waste.totalSheets),
    perPcs: base.costPerM2 * ((layout.pw * 2.54 * (layout.pl * 2.54)) / 10000),
  };
}

interface PrintSide {
  cost: number;
  twoSide: number | null;
}

/** One printed side (`:146-227`), or null when the colours have no price (legacy skips the layout). */
function printSide(
  request: PartRequest,
  colours: readonly PrintColour[],
  sheets: number,
  bandByBox: boolean,
  layout: LayoutCandidate,
  tables: DigitalTables,
): PrintSide | null {
  const t = tables.terms;
  const ids = new Set(colours.map((c) => c.inkColourId));
  const percent = Math.max(...colours.map((c) => c.percent));
  let rows: PrintPriceRow[] = tables.printPrices.filter(
    (r) =>
      ids.has(r.inkColourId) &&
      (bandByBox ? inBand(r.minBox ?? null, r.maxBox ?? null, layout.boxAmount) : inSheetBand(r, sheets)),
  );
  let twoSide: number | null = null;
  if (t.printByMaterial) {
    // Legacy factory 16: prices per paper, with the two-sided add-on (`:161-164`).
    rows = rows.filter((r) => r.materialId === request.materialId);
    twoSide = rows.length > 0 ? Math.max(...rows.map((r) => r.addTwoSidePerSqm ?? 0)) : 0;
  }
  const sum = rows.reduce(
    (a, r) => a + (t.printMethod === 'per_sheet' ? r.pricePerPcs : (r.priceInkPerM2 ?? 0)),
    0,
  );
  if (sum === 0 && !t.printByMaterial) return null;
  let cost: number;
  if (t.printMethod === 'blank_area') {
    cost = convertTo2Decimal(((layout.dl * layout.dw) / 1000000) * layout.boxAmount * sum);
  } else if (t.printMethod === 'per_sheet') {
    cost = convertTo2Decimal(sum * sheets);
  } else {
    cost = convertTo2Decimal(sum * inch2toM2(layout.pw * layout.pl) * sheets);
  }
  return { cost: cost * (percent / 100), twoSide };
}

function finishSide(
  row: FinishPriceRow,
  sheets: number,
  layout: LayoutCandidate,
  tables: DigitalTables,
): number {
  const t = tables.terms;
  let cost: number;
  switch (t.finishMethod) {
    case 'blank_area_in2': // legacy factory 16 (`:238-239`)
      cost = ((layout.dl * layout.dw) / 100 / (2.54 * 2.54)) * row.priceByAreaPerIn2 * layout.boxAmount;
      break;
    case 'per_sheet_per_layout': // legacy factory 9 (`:240-241`)
      cost = convertTo2Decimal((row.pricePerSheet / layout.layoutAmount) * layout.boxAmount);
      break;
    case 'per_sheet': // legacy factory 23 (`:242-243`)
      cost = convertTo2Decimal(row.pricePerSheet * sheets);
      break;
    default:
      cost = convertTo2Decimal(layout.pw * layout.pl * row.priceByAreaPerIn2 * sheets);
  }
  return cost < row.minPrice ? row.minPrice : cost;
}

/** Die-cut (`:287-362`), or null when no price band matches (legacy skips the layout). */
function diecutCost(
  layout: LayoutCandidate,
  waste: WasteResult,
  tables: DigitalTables,
): DigitalPricedLayout['diecut'] {
  const t = tables.terms;
  const box = layout.boxAmount;
  let price: number;
  let minPrice: number;
  if (t.usePaperAmountForCal) {
    // Legacy compares the band's minimum with the run and its maximum with the die-cut sheets (`:291-292`).
    const row = tables.diecutPrices.find(
      (r) =>
        (r.minSheets === null || r.minSheets <= box) && (r.maxSheets === null || r.maxSheets >= waste.diecut),
    );
    if (!row) return null;
    price = row.diecutPrice > 0 ? row.diecutPrice : waste.diecut * row.pricePerSheet;
    minPrice = row.minPrice ?? 0;
  } else {
    const row = tables.diecutPrices.find((r) => inSheetBand(r, box));
    if (!row) return null;
    const perPcs = row.pricePerPcs ?? 0;
    price =
      perPcs > 0
        ? box * perPcs
        : row.pricePerSheet > 0
          ? (row.pricePerSheet / layout.layoutAmount) * box
          : row.diecutPrice;
    minPrice = row.minPrice ?? 0;
  }
  let total = price < minPrice ? minPrice : price;
  let blockPrice = 0;
  if (t.diecutBlock !== 'none') {
    // Legacy factories 9 and 23 add a die block (`:325-353`).
    const block = tables.diecutBlocks.find(
      (b) =>
        b.wMin <= layout.pw &&
        b.wMax >= layout.pw &&
        b.lMin <= layout.pl &&
        b.lMax >= layout.pl &&
        (t.diecutBlock !== 'flat_by_pieces' || inBand(b.minPcs ?? null, b.maxPcs ?? null, box)),
    );
    if (block) {
      blockPrice = t.diecutBlock === 'flat_by_pieces' ? block.diecutPrice : (block.pricePerPcs ?? 0) * box;
      const min = block.minDiecutPrice ?? 0;
      if (blockPrice < min) blockPrice = min;
    }
    total += blockPrice;
  }
  return { price, blockPrice, totalCost: total };
}

/** Assemblies (`:365-456`), or null when one has no price (legacy skips the layout). */
function assemblyCosts(
  request: PartRequest,
  layout: LayoutCandidate,
  tables: DigitalTables,
): number[] | null {
  if (!hasAssembly(request)) return [];
  const box = layout.boxAmount;
  // Legacy reads the full finish-plate trim from `paper_trim` here, not the halved one (`:424-428`).
  const trimPlate = layout.patternArea.trimFinishPlateMm * 2;
  const costs: number[] = [];
  for (const asb of request.assemblies) {
    const w0 = asb.w?.[0] ?? 0;
    const l0 = asb.l?.[0] ?? 0;
    const areaSqcm = (w0 * l0) / 100;
    const row = tables.assemblyPrices.find(
      (r) =>
        r.assemblyId === asb.assemblyId &&
        r.printTypeId === tables.printTypeId &&
        inBand(r.rangeMin, r.rangeMax, box) &&
        (r.digitalMethod !== 'per_piece_area_band' ||
          ((r.minAreaSqcm === null || r.minAreaSqcm === undefined || r.minAreaSqcm < areaSqcm) &&
            (r.maxAreaSqcm === null || r.maxAreaSqcm === undefined || r.maxAreaSqcm >= areaSqcm))),
    );
    if (!row) return null;
    const amount = asb.amount ?? 0;
    if (row.digitalMethod === 'per_carton') {
      // Legacy factory 9 group 22 counts shipping cartons through the carrier engine (`:395-411`), which
      // is not wired to the B2.4 packing helper yet (needs the carton spec setting and the part's pack).
      throw new PricingError(
        'process_not_possible',
        `assembly ${asb.assemblyId} priced per shipping carton (not supported yet)`,
      );
    }
    if (row.digitalMethod === 'per_piece_area_band') {
      costs.push(Math.max(box * amount * row.pricePerPcs, row.minPrice));
      continue;
    }
    const sum = row.pricePerPcs * box;
    let cost = sum < row.minPrice ? row.minPrice : sum;
    if (asb.requiresAmount) {
      const material =
        (((w0 + trimPlate) * (l0 + trimPlate)) / (25.4 * 25.4)) * row.materialPricePerIn2 * amount;
      cost += material * box;
    }
    costs.push(cost);
  }
  return costs;
}

/** Cost of one layout, or null when legacy skips it. */
export function priceDigitalLayout(
  request: PartRequest,
  layout: LayoutCandidate,
  waste: WasteResult,
  tables: DigitalTables,
): DigitalPricedLayout | null {
  const t = tables.terms;
  const { paper, perPcs } = paperCost(request, layout, waste, tables);
  const twoSideRates: number[] = [];
  let printFront: number | null = null;
  if (hasPrintFront(request)) {
    const side = printSide(
      request,
      request.printFront!,
      waste.printFront,
      t.printBand === 'box' && !request.customCost,
      layout,
      tables,
    );
    if (!side) return null;
    printFront = side.cost;
    if (side.twoSide !== null) twoSideRates.push(side.twoSide);
  }
  let printBack: number | null = null;
  if (hasPrintBack(request)) {
    // Legacy's back band ignores the custom-cost switch (`:195`).
    const side = printSide(
      request,
      request.printBack!,
      waste.printBack,
      t.printBand === 'box',
      layout,
      tables,
    );
    if (!side) return null;
    printBack = side.cost;
    if (side.twoSide !== null) twoSideRates.push(side.twoSide);
  }
  const twoSidePrint =
    printFront && printBack && twoSideRates.length > 0
      ? layout.boxAmount * ((layout.dl * layout.dw) / 1000000) * Math.max(...twoSideRates)
      : 0;
  const finishRow = (id: string): FinishPriceRow => {
    const row = tables.finishPrices.find((r) => r.finishId === id);
    if (!row) throw missing(`finish_prices ${id}`);
    return row;
  };
  const finish1Front =
    request.finish1FrontId !== undefined
      ? finishSide(finishRow(request.finish1FrontId), waste.finish1Front, layout, tables)
      : null;
  const finish1Back =
    request.finish1BackId !== undefined
      ? finishSide(finishRow(request.finish1BackId), waste.finish1Back, layout, tables)
      : null;
  let diecut: DigitalPricedLayout['diecut'] = null;
  if (hasDiecut(request)) {
    diecut = diecutCost(layout, waste, tables);
    if (!diecut) return null;
  }
  const parts = [
    paper,
    printFront ?? 0,
    printBack ?? 0,
    twoSidePrint,
    finish1Front ?? 0,
    finish1Back ?? 0,
    diecut?.totalCost ?? 0,
  ];
  let totalCost = parts.reduce((a, b) => a + b, 0);
  const assembly = assemblyCosts(request, layout, tables);
  if (assembly === null) return null;
  totalCost += assembly.reduce((a, b) => a + b, 0);
  // Legacy factory 9 uplifts the cost before the margin (`:459-469`).
  totalCost = totalCost * t.costMultiplier;
  return {
    layout,
    waste,
    paper,
    paperPerPcs: perPcs,
    printFront,
    printBack,
    twoSidePrint,
    finish1Front,
    finish1Back,
    diecut,
    assembly,
    totalCost,
    costPerPcs: totalCost / layout.boxAmount,
    margin: digitalFactoryMargin(totalCost, t.factoryMarginPct, layout.boxAmount, t.minLotPrice),
  };
}

/** Legacy digital order (`:502-511`): total cost, then rotated before standard; ties keep the order. */
export function sortDigitalLayouts(layouts: DigitalPricedLayout[]): DigitalPricedLayout[] {
  return layouts
    .map((p, i) => ({ p, i }))
    .sort(
      (a, b) =>
        a.p.totalCost - b.p.totalCost ||
        Number(a.p.layout.layoutStandard) - Number(b.p.layout.layoutStandard) ||
        a.i - b.i,
    )
    .map((x) => x.p);
}
