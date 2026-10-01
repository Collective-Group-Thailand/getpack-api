import { convertNumberFloat, phpFloatval } from '../../engine/php';
import { type Calculator } from '../calculator';
import { PricingError } from '../shared/pricing-error';
import { type ForSale, saleMargin, type SellSnapshot } from '../shared/sell';
import { type LabelCost, labelDigitalCost } from './digital';
import { type LabelLayout, labelLayouts, type LabelProcesses, labelWaste } from './layout';
import { type LabelTables } from './tables';

/**
 * The label calculator (U-B6 label): legacy `LabelCalculator::CSCalculate:374-434` and `calculate:436-643` as a
 * pure function over options (factory × print type). Per quantity: lay-outs on every sheet and roll of the
 * material, waste, the digital cost, the factory margin (`calculateCost:1275-1300`), the cheapest lay-out kept
 * (`:639`), Packio's sell side (`SaleMargin`). Offset label printing is not priced: legacy never produced an
 * offset label price (quirk L2). Pure: no database or clock.
 */

export const LABEL_CALCULATOR_VERSION = '1.0.0';

export interface LabelInput {
  quantities: readonly number[];
  /** Bounding box of the label, mm (legacy pattern 18: `dw = w`, `dl = l`). */
  size: { w: number; l: number };
  /** Ink colours per side; empty = not printed. */
  printFront: readonly string[];
  printBack: readonly string[];
  finishFrontId: string | null;
  finishBackId: string | null;
  diecutTypeId: string | null;
  design: { graphic: boolean };
}

export interface LabelOption {
  optionKey: string;
  factoryId: string;
  printTypeId: string;
  tables: LabelTables;
  /** Ink colours the factory prints on the print type (legacy per-factory `color`). */
  inkColours: ReadonlySet<string>;
  sell: SellSnapshot;
  /** Price lines the loader found missing for this configuration; non-empty = no price. */
  unavailable?: readonly string[];
}

export interface LabelSnapshot {
  options: readonly LabelOption[];
}

export interface LabelStep {
  qty: number;
  layout: LabelLayout;
  cost: LabelCost;
  /** The factory's price per piece, rounded (legacy `margin.suggest_price`, quirk L24). */
  factoryPricePerPcs: number;
  /** What Collective Group pays the factory for the lot (legacy `margin.sale_price`, D-042). */
  buyPrice: number;
  forSale: ForSale;
  designFee: number;
  /** Customer price, VAT included, shipping excluded (legacy `summary.total`). */
  total: number;
  leadTimeDays: number;
  marginPct: number;
}

export interface LabelOptionResult {
  optionKey: string;
  factoryId: string;
  printTypeId: string;
  steps: (LabelStep | null)[];
  stepErrors: ({ code: PricingError['code']; detail: string } | null)[];
  error: { code: PricingError['code']; detail: string } | null;
}

export interface LabelResult {
  options: LabelOptionResult[];
}

function leadTime(tables: LabelTables, qty: number): number {
  const { leadTimeDays, bulkLeadTime } = tables.terms;
  return bulkLeadTime && qty >= bulkLeadTime.minQty ? bulkLeadTime.days : Math.ceil(leadTimeDays ?? 0);
}

/**
 * Legacy's order (`calculateCost:1304-1316`): cost, then more labels per sheet, then the rotated lay-out first
 * (`a.layout_standard <=> b.layout_standard`); stable on the sheet order (quirk L12).
 */
function byCost(a: { layout: LabelLayout; cost: LabelCost }, b: { layout: LabelLayout; cost: LabelCost }) {
  return (
    a.cost.total - b.cost.total ||
    b.layout.layoutAmount - a.layout.layoutAmount ||
    Number(a.layout.standard) - Number(b.layout.standard)
  );
}

function priceStep(
  input: LabelInput,
  option: LabelOption,
  processes: LabelProcesses,
  qty: number,
): LabelStep {
  const { tables } = option;
  const { terms } = tables;
  // The factory's minimum order, per quantity (quirk L3).
  if (terms.minOrderAmount !== null && qty < terms.minOrderAmount) {
    throw new PricingError('process_not_possible', `minimum order ${terms.minOrderAmount}`);
  }
  const request = {
    qty,
    printFront: input.printFront,
    printBack: input.printBack,
    finishFrontId: input.finishFrontId,
    finishBackId: input.finishBackId,
    diecutTypeId: processes.diecut ? input.diecutTypeId : null,
  };
  const priced = labelLayouts(input.size, qty, tables)
    .map((layout) => {
      if (!layout.roll) layout.waste = labelWaste(layout, processes, request.diecutTypeId, tables);
      return { layout, cost: labelDigitalCost(layout, request, tables) };
    })
    // Rolls shorter than the factory runs are dropped (`calculate:456-458`, quirk L13).
    .filter(
      ({ layout }) =>
        !(
          layout.roll &&
          !layout.rollToSheet &&
          terms.minRollLengthM !== null &&
          layout.areaL * 0.001 < terms.minRollLengthM
        ),
    )
    .sort(byCost);
  const best = priced[0];
  if (!best) throw new PricingError('geometry_no_layout', 'no sheet or roll holds the label');
  // Factory margin (`:1278-1291`): its per-piece price rounded to the satang before × qty (quirk L24).
  const total = best.cost.total;
  const marginPrice = total / (1 - terms.factoryMarginPct / 100) - total;
  const salePrice = marginPrice + total;
  const factoryPricePerPcs = phpFloatval(convertNumberFloat(salePrice / qty));
  const buyPrice = factoryPricePerPcs * qty;
  const forSale = saleMargin(option.sell, buyPrice, qty, qty, 0);
  const designFee = input.design.graphic ? (option.sell.designFee ?? 0) : 0;
  const customerTotal = forSale.total + designFee;
  const vatInclude = (100 + option.sell.vatPct) / 100;
  const net = customerTotal / vatInclude;
  return {
    qty,
    layout: best.layout,
    cost: best.cost,
    factoryPricePerPcs,
    buyPrice,
    forSale,
    designFee,
    total: customerTotal,
    leadTimeDays: leadTime(tables, qty),
    marginPct: net > 0 ? ((net - buyPrice) / net) * 100 : 0,
  };
}

function optionResult(input: LabelInput, option: LabelOption): LabelOptionResult {
  const head = { optionKey: option.optionKey, factoryId: option.factoryId, printTypeId: option.printTypeId };
  const failAll = (error: PricingError): LabelOptionResult => ({
    ...head,
    steps: input.quantities.map(() => null),
    stepErrors: input.quantities.map(() => ({ code: error.code, detail: error.detail })),
    error: { code: error.code, detail: error.detail },
  });
  const { terms } = option.tables;
  let processes: LabelProcesses;
  try {
    // Legacy's offset label path never produced a price (quirk L2): offset print types are not priced.
    if (terms.engine !== 'digital') throw new PricingError('process_not_possible', 'offset label printing');
    if (option.unavailable?.length)
      throw new PricingError('price_line_missing', option.unavailable.join(', '));
    // Colours the factory does not print fail in legacy (`CStoFactory:289-330`).
    const missing = [...input.printFront, ...input.printBack].filter((c) => !option.inkColours.has(c));
    if (missing.length) throw new PricingError('process_not_possible', `ink colour ${missing[0]}`);
    processes = {
      printFront: input.printFront.length > 0,
      printBack: input.printBack.length > 0,
      finishFront: input.finishFrontId !== null,
      finishBack: input.finishBackId !== null,
      // Legacy factories 13 / 14 run no die-cut process (`CStoFactory:277`, quirk L7).
      diecut: input.diecutTypeId !== null && terms.diecutAvailable,
    };
  } catch (error) {
    if (error instanceof PricingError) return failAll(error);
    throw error;
  }
  const stepErrors: LabelOptionResult['stepErrors'] = [];
  const steps = input.quantities.map((qty): LabelStep | null => {
    try {
      const step = priceStep(input, option, processes, qty);
      stepErrors.push(null);
      return step;
    } catch (error) {
      if (!(error instanceof PricingError)) throw error;
      stepErrors.push({ code: error.code, detail: error.detail });
      return null;
    }
  });
  const firstError = stepErrors.find((e) => e !== null) ?? null;
  return { ...head, steps, stepErrors, error: steps.every((s) => s === null) ? firstError : null };
}

export const labelCalculator: Calculator<LabelInput, LabelSnapshot, LabelResult> = {
  key: 'label',
  version: LABEL_CALCULATOR_VERSION,
  calculate(input, snapshot) {
    return { options: snapshot.options.map((o) => optionResult(input, o)) };
  },
};
