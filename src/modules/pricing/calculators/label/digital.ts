import { inBand } from '../folding/tables';
import { PricingError } from '../shared/pricing-error';
import { type LabelLayout } from './layout';
import { type LabelTables } from './tables';

/**
 * The digital label cost (legacy `LabelCalculator::calculateCost:1081-1274`, print types 4 / 7 / 8): a sheet
 * lay-out pays paper, ink, coating and die-cut on its sheets with waste; a roll (or roll-to-sheet) on the m² of
 * web it runs. Missing price rows that legacy read off `null` (and so failed) are refused (quirk L15).
 */

export interface LabelCostRequest {
  qty: number;
  printFront: readonly string[];
  printBack: readonly string[];
  finishFrontId: string | null;
  finishBackId: string | null;
  /** Null: no die-cut (none asked, or the factory runs none). */
  diecutTypeId: string | null;
}

export interface LabelCost {
  paper: number;
  printFront: number;
  printBack: number;
  finishFront: number;
  finishBack: number;
  diecut: number;
  /** Sum of the above (legacy `cost.total`). */
  total: number;
  /** Roll web area, m² (rolls only). */
  areaM2: number | null;
}

/** `inch2toM2` (helpers.php:224-227). */
const inch2toM2 = (inch2: number) => (inch2 * 2.54 * 2.54) / 10000;

/** Legacy `collection->whereIn('color_id', ids)`: a colour asked twice is priced once (quirk L15). */
const distinct = (ids: readonly string[]) => new Set(ids);

function finishRow(tables: Pick<LabelTables, 'finishPrices'>, finishId: string) {
  const row = tables.finishPrices.find((r) => r.finishId === finishId);
  if (!row) throw new PricingError('price_line_missing', `finish price ${finishId}`);
  return row;
}

export function labelDigitalCost(
  layout: LabelLayout,
  request: LabelCostRequest,
  tables: Pick<
    LabelTables,
    'material' | 'printPrices' | 'rollPrintPrices' | 'finishPrices' | 'diecutPrices' | 'dieBlocks'
  >,
): LabelCost {
  const costPerM2 = tables.material.costPerM2;
  if (costPerM2 === null) throw new PricingError('price_line_missing', 'material price per m²');
  const { sheetWIn: inW, sheetLIn: inL } = layout.sheet;
  const qty = request.qty;
  const cost: LabelCost = {
    paper: 0,
    printFront: 0,
    printBack: 0,
    finishFront: 0,
    finishBack: 0,
    diecut: 0,
    total: 0,
    areaM2: null,
  };

  if (!layout.roll) {
    const waste = layout.waste!;
    cost.paper = costPerM2 * inch2toM2(inW * inL) * waste.total;
    const inkPerM2 = (ids: readonly string[], sheets: number) => {
      const wanted = distinct(ids);
      return tables.printPrices
        .filter((r) => wanted.has(r.inkColourId) && inBand(r.minSheets, r.maxSheets, sheets))
        .reduce((a, r) => a + (r.priceInkPerM2 ?? 0), 0);
    };
    if (request.printFront.length > 0) {
      cost.printFront =
        inkPerM2(request.printFront, waste.printFront!) * inch2toM2(inW * inL) * waste.printFront!;
    }
    if (request.printBack.length > 0) {
      cost.printBack =
        inkPerM2(request.printBack, waste.printBack!) * inch2toM2(inW * inL) * waste.printBack!;
    }
    if (request.finishFrontId !== null) {
      cost.finishFront =
        inW * inL * finishRow(tables, request.finishFrontId).priceByAreaPerIn2 * waste.finishFront!;
    }
    if (request.finishBackId !== null) {
      cost.finishBack =
        inW * inL * finishRow(tables, request.finishBackId).priceByAreaPerIn2 * waste.finishBack!;
    }
    if (request.diecutTypeId !== null) {
      const row = tables.diecutPrices.find(
        (r) => r.diecutTypeId === request.diecutTypeId && inBand(r.minSheets, r.maxSheets, waste.total),
      );
      if (!row) throw new PricingError('price_line_missing', `die-cut price ${request.diecutTypeId}`);
      if ((row.diecutPrice ?? 0) > 0) {
        cost.diecut = row.diecutPrice!;
      } else {
        const sheetM2 = (inW * 2.54 * (inL * 2.54)) / 10000;
        cost.diecut = qty * (((row.pricePerM2 ?? 0) * sheetM2) / layout.layoutAmount);
      }
    }
  } else {
    const areaM2 = (layout.areaL * (inW * 25.4)) / 1000000;
    cost.areaM2 = areaM2;
    cost.paper = costPerM2 * areaM2;
    const rollInk = (ids: readonly string[]) => {
      const wanted = distinct(ids);
      return tables.rollPrintPrices
        .filter((r) => wanted.has(r.inkColourId))
        .reduce((a, r) => a + r.pricePerM2, 0);
    };
    if (request.printFront.length > 0) cost.printFront = rollInk(request.printFront) * areaM2;
    if (request.printBack.length > 0) cost.printBack = rollInk(request.printBack) * areaM2;
    if (request.finishFrontId !== null) {
      cost.finishFront = areaM2 * 1550.0031 * finishRow(tables, request.finishFrontId).priceByAreaPerIn2;
    }
    if (request.finishBackId !== null) {
      cost.finishBack = areaM2 * 1550.0031 * finishRow(tables, request.finishBackId).priceByAreaPerIn2;
    }
    if (request.diecutTypeId !== null) {
      // Rolls read the die-cut price by quantity band, whatever the type (`:1247-1249`).
      const row = tables.diecutPrices.find((r) => r.diecutTypeId === null && inBand(r.minBox, r.maxBox, qty));
      if (!row) throw new PricingError('price_line_missing', 'roll die-cut price');
      if ((row.diecutPrice ?? 0) > 0) {
        cost.diecut = row.diecutPrice!;
      } else {
        const block = tables.dieBlocks[0];
        if (!block) throw new PricingError('price_line_missing', 'die block price');
        cost.diecut = (qty * ((row.pricePerM2 ?? 0) * areaM2)) / layout.layoutAmount + block.diecutPrice;
      }
    }
  }
  cost.total =
    cost.paper + cost.printFront + cost.printBack + cost.finishFront + cost.finishBack + cost.diecut;
  return cost;
}
