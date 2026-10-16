import { convertTo2Decimal, roundUp } from '../../engine/php';
import { type Calculator } from '../calculator';
import { PricingError } from '../shared/pricing-error';
import { sellMargins, type SellSnapshot } from '../shared/sell';
import { type PouchDimension, pouchDimension, type PouchFormula, type PouchSize } from './geometry';
import { inQtyBand, type PouchTables } from './tables';

/**
 * The pouch calculator (U-B6 pouch): legacy `PouchCalculator::fromCS:259-376` and `calculate:468-555` as a pure
 * function over options (factory × print type). Per quantity: the film per pouch on the roll (minimum run or repeat +
 * setup length), material on the web width, print on the film width, lamination, pouch making and the chosen options,
 * the cost per piece rounded up to the satang, the factory margin rounded up to 0.1 THB, getpack's margin and VAT per
 * piece (`calculateMargin:673-688`). Port map `docs/legacy/05-pouch-port-map.md` §9: a quantity below the factory's
 * minimum is refused (legacy raised it), a missing row refuses the factory instead of failing the request. Pure.
 */

export const POUCH_CALCULATOR_VERSION = '1.0.0';

export interface PouchInput {
  quantities: readonly number[];
  patternId: string;
  formula: PouchFormula;
  size: PouchSize;
  materialId: string;
  /** The print colour set (legacy colour group); null = an unprinted pouch, no print cost. */
  printColourId: string | null;
  /** Options in the order asked (legacy `assemblies`, catalogue assemblies). */
  optionIds: readonly string[];
  design: { graphic: boolean };
}

export interface PouchOption {
  optionKey: string;
  factoryId: string;
  printTypeId: string;
  tables: PouchTables;
  sell: SellSnapshot;
  /** Price lines the loader found missing for this configuration; non-empty = no price. */
  unavailable?: readonly string[];
}

export interface PouchSnapshot {
  options: readonly PouchOption[];
}

export interface PouchCostLine {
  key: string;
  pricePerPcs: number;
}

export interface PouchStep {
  qty: number;
  dimension: PouchDimension;
  /** Film length charged per pouch (legacy `pow`) and web width (legacy `pol`), mm. */
  pow: number;
  pol: number;
  materialPerPcs: number;
  printPerPcs: number;
  /** Lamination, making, then the options in the order asked (legacy `calculateAssembly`). */
  processes: PouchCostLine[];
  /** Legacy `cost.per_pcs`, rounded up to the satang. */
  costPerPcs: number;
  factoryMarginPct: number;
  /** Legacy `cost.per_pcs_with_margin`: the factory's price per piece, rounded up to 0.1 THB. */
  factoryPricePerPcs: number;
  /** What Collective Group pays the factory for the lot (legacy `cost.total`, D-042). */
  buyPrice: number;
  targetMarginPct: number;
  /** Legacy `margin.sale_price_per_pcs`: per piece, VAT included, rounded up to the satang. */
  perPcs: number;
  /** Per piece × quantity. */
  sum: number;
  vatPrice: number;
  designFee: number;
  /** Customer price, VAT included, shipping excluded (D-013). */
  total: number;
  leadTimeDays: number;
  marginPct: number;
}

type StepError = { code: PricingError['code']; detail: string };

export interface PouchOptionResult {
  optionKey: string;
  factoryId: string;
  printTypeId: string;
  steps: (PouchStep | null)[];
  stepErrors: (StepError | null)[];
  error: StepError | null;
}

export interface PouchResult {
  options: PouchOptionResult[];
}

const missing = (what: string) => new PricingError('price_line_missing', what);

function processLine(tables: PouchTables, process: 'lamination' | 'making', qty: number): number {
  const row = tables.processPrices.find((r) => r.process === process && inQtyBand(r, qty));
  if (!row) throw missing(`pouch_process_prices ${process}`);
  return row.minPrice;
}

function priceStep(
  input: PouchInput,
  option: PouchOption,
  prices: { material: number; print: number | null },
  dimension: PouchDimension,
  qty: number,
): PouchStep {
  const { tables } = option;
  const { terms } = tables;
  // Minimum order by the pouch's area (`recheckMinAmount:583-594`); refused instead of raised (port map §9.4).
  const band = tables.minQuantities.find(
    (r) =>
      (r.minSqcm === null || r.minSqcm <= dimension.calSqcm) &&
      (r.maxSqcm === null || r.maxSqcm >= dimension.calSqcm),
  );
  if (!band) throw missing('pouch_min_quantities');
  if (qty < band.minQty) throw new PricingError('process_not_possible', `minimum order ${band.minQty}`);
  const amount = qty;

  // Film per pouch on the roll (`calculate:482-487`).
  const pow = Math.max(
    (terms.minMaterialLengthM * 1000) / amount,
    dimension.dw + terms.bridgeMm + (terms.setupLengthM * 1000) / amount,
  );
  const pol = Math.max(dimension.calDl, terms.webWidthMm);
  const minMaterialCost = terms.minMaterialCost / amount;
  const materialPerPcs = Math.max(((pol * pow) / 100) * prices.material, minMaterialCost);
  const printPerPcs = prices.print === null ? 0 : ((dimension.calDl * pow) / 100) * prices.print;

  // Lamination and making always run, then the options asked (`ConvertCSDataToFactory:415-436`, `:616-661`).
  const lamination =
    Math.max(
      terms.laminationRatePerM2 * (terms.laminationWebWidthM * ((pow * amount) / 1000)),
      processLine(tables, 'lamination', amount),
    ) / amount;
  const makingMin = processLine(tables, 'making', amount);
  const making =
    amount > terms.makingQtyThreshold ? (amount * terms.makingPricePerPcs) / amount : makingMin / amount;
  const processes: PouchCostLine[] = [
    { key: 'lamination', pricePerPcs: lamination },
    { key: 'making', pricePerPcs: making },
  ];
  for (const assemblyId of input.optionIds) {
    const row = tables.optionPrices.find((r) => r.assemblyId === assemblyId && inQtyBand(r, amount));
    if (!row) throw missing(`pouch_option_prices ${assemblyId}`);
    let pricePerPcs: number;
    if (row.priceMode === 'per_cm2') {
      pricePerPcs = (row.pricePerCm2 ?? 0) * dimension.calSqcm;
    } else if (row.priceMode === 'zipper') {
      // Per piece, else per cm of width; neither = no price (legacy threw, quirk P8).
      if ((row.pricePerPcs ?? 0) > 0) pricePerPcs = row.pricePerPcs!;
      else if ((row.pricePerCm ?? 0) > 0) pricePerPcs = (input.size.w / 10) * row.pricePerCm!;
      else throw missing(`pouch_option_prices ${assemblyId} (zipper price)`);
    } else {
      pricePerPcs = row.pricePerPcs ?? 0;
    }
    processes.push({ key: assemblyId, pricePerPcs });
  }
  let processTotal = 0;
  for (const p of processes) processTotal += p.pricePerPcs;

  // Factory cost and margin (`calculate:491-497`, `calculateCost:663-671`).
  const costPerPcs = convertTo2Decimal(materialPerPcs + printPerPcs + processTotal);
  const factoryMarginPct =
    tables.factoryMargins.find((r) => inQtyBand(r, amount))?.marginPct ?? terms.factoryMarginPct;
  const factoryPricePerPcs = roundUp(costPerPcs * (1 + factoryMarginPct / 100), 1);
  const buyPrice = factoryPricePerPcs * amount;

  // getpack's margin and VAT per piece (`calculate:507-518`, `calculateMargin:673-688`).
  const { target } = sellMargins(option.sell, amount, buyPrice);
  const fixCostPerPcs = option.sell.fixCost / amount;
  const perPcsWithFixCost = factoryPricePerPcs + fixCostPerPcs;
  const perPcsWithMargin = perPcsWithFixCost / ((100 - target) / 100);
  const vatInclude = (100 + option.sell.vatPct) / 100;
  const perPcs = convertTo2Decimal(perPcsWithMargin * vatInclude);
  const vatPerPcs = perPcs - perPcsWithMargin;
  const sum = perPcs * qty;
  const designFee = input.design.graphic ? (option.sell.designFee ?? 0) : 0;
  const total = sum + designFee;
  const net = total / vatInclude;
  return {
    qty,
    dimension,
    pow,
    pol,
    materialPerPcs,
    printPerPcs,
    processes,
    costPerPcs,
    factoryMarginPct,
    factoryPricePerPcs,
    buyPrice,
    targetMarginPct: target,
    perPcs,
    sum,
    vatPrice: vatPerPcs * qty,
    designFee,
    total,
    leadTimeDays: Math.ceil(terms.leadTimeDays ?? 0),
    marginPct: net > 0 ? ((net - buyPrice) / net) * 100 : 0,
  };
}

function optionResult(input: PouchInput, option: PouchOption): PouchOptionResult {
  const head = { optionKey: option.optionKey, factoryId: option.factoryId, printTypeId: option.printTypeId };
  const { tables } = option;
  let prices: { material: number; print: number | null };
  let dimension: PouchDimension;
  try {
    if (option.unavailable?.length) throw missing(option.unavailable.join(', '));
    // Per factory, in legacy's order (`ConvertCSDataToFactory:402-436`, `calculate:470-473`): material, print,
    // options offered for the pattern and material, then the film width.
    const material = tables.materialPrices.find((r) => r.materialId === input.materialId);
    if (!material) throw new PricingError('process_not_possible', `material ${input.materialId}`);
    let print: number | null = null;
    if (input.printColourId !== null) {
      const row = tables.printPrices.find((r) => r.inkColourId === input.printColourId);
      if (!row) throw new PricingError('process_not_possible', `print colour ${input.printColourId}`);
      print = row.pricePerCm2;
    }
    const offered = new Set(
      tables.optionRules
        .filter((r) => r.patternId === input.patternId && r.materialId === input.materialId)
        .map((r) => r.assemblyId),
    );
    const notOffered = input.optionIds.find((id) => !offered.has(id));
    if (notOffered !== undefined) {
      throw new PricingError('process_not_possible', `option ${notOffered} for this pattern and material`);
    }
    prices = { material: material.pricePerCm2, print };
    dimension = pouchDimension(input.formula, input.size, tables.terms);
    if (dimension.calDl > tables.terms.maxDlMm) {
      throw new PricingError(
        'process_not_possible',
        `film ${dimension.calDl} mm wider than ${tables.terms.maxDlMm} mm`,
      );
    }
  } catch (error) {
    if (!(error instanceof PricingError)) throw error;
    const e = { code: error.code, detail: error.detail };
    return {
      ...head,
      steps: input.quantities.map(() => null),
      stepErrors: input.quantities.map(() => e),
      error: e,
    };
  }
  const stepErrors: PouchOptionResult['stepErrors'] = [];
  const steps = input.quantities.map((qty): PouchStep | null => {
    try {
      const step = priceStep(input, option, prices, dimension, qty);
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

export const pouchCalculator: Calculator<PouchInput, PouchSnapshot, PouchResult> = {
  key: 'pouch',
  version: POUCH_CALCULATOR_VERSION,
  calculate(input, snapshot) {
    return { options: snapshot.options.map((o) => optionResult(input, o)) };
  },
};
