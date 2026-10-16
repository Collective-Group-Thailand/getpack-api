import { calculateMargin, calculateVat } from '../../engine/php';
import { type Calculator } from '../calculator';
import { PricingError } from '../shared/pricing-error';
import { type SellSnapshot } from '../shared/sell';

/**
 * The standard-product calculator (U-B6 standard product): legacy `CalculatePrice::getSteps:12-73`, `sortPrices:133-149`,
 * `findPrice:75-104` and `Utils::costToSalePrice:13-30` as a pure function over options (factory × print type). A stock
 * product's buy-price tiers become sell-price tiers — `⌈⌈(buy + fix) ÷ (1 − m)⌉ × (1 + VAT)⌉` per piece —, the last tier
 * starts at the previous tier's maximum and a later tier whose price is not lower absorbs the earlier ranges (legacy,
 * port map S5, S8); the quantity takes the first tier that holds it. Delivery is its own quote line (D-013), so the
 * tiers are the goods price (legacy folded a delivery charge per piece in, S6, S7). Pure.
 */

export const STANDARD_PRODUCT_CALCULATOR_VERSION = '1.0.0';

export interface StandardProductInput {
  quantities: readonly number[];
  /** The stock product's minimum order (`stock_products.min_order_qty`); absent = 1. */
  minOrderQty?: number;
  design: { graphic: boolean };
}

export interface StockPriceRow {
  minQty: number | null;
  maxQty: number | null;
  unitBuyPrice: number;
  leadTimeDays: number | null;
}

export interface StandardProductOption {
  optionKey: string;
  factoryId: string;
  printTypeId: string;
  /** The factory's price lines for the stock product, in line order. */
  rows: readonly StockPriceRow[];
  sell: SellSnapshot;
  /** Price lines the loader found missing for this configuration; non-empty = no price. */
  unavailable?: readonly string[];
}

export interface StandardProductSnapshot {
  options: readonly StandardProductOption[];
}

export interface PriceTier {
  min: number | null;
  max: number | null;
  /** Legacy `cost_per_pcs`: the factory's buy price per piece. */
  unitBuyPrice: number;
  /** Legacy `margin.with_margin`: (buy + fix) ÷ (1 − m), rounded up to the satang. */
  withMargin: number;
  /** Legacy `sale_price`: per piece, VAT included, rounded up to the satang. */
  perPcs: number;
  leadTimeDays: number | null;
}

export interface StandardProductStep {
  qty: number;
  tier: PriceTier;
  targetMarginPct: number;
  buyPrice: number;
  perPcs: number;
  sum: number;
  vatPrice: number;
  designFee: number;
  /** Customer price, VAT included, shipping excluded (D-013). */
  total: number;
  leadTimeDays: number;
  marginPct: number;
}

type StepError = { code: PricingError['code']; detail: string };

export interface StandardProductOptionResult {
  optionKey: string;
  factoryId: string;
  printTypeId: string;
  /** The sell-price tier table at the first quantity's margin (legacy `getSteps`, for the CS view). */
  tiers: PriceTier[] | null;
  steps: (StandardProductStep | null)[];
  stepErrors: (StepError | null)[];
  error: StepError | null;
}

export interface StandardProductResult {
  options: StandardProductOptionResult[];
}

/** `costToSalePrice` (`Utils.php:13-30`): the fix cost is added per piece, legacy `locopack_fix_cost`. */
function salePrice(
  buy: number,
  sell: SellSnapshot,
  marginPct: number,
): { withMargin: number; withVat: number } {
  const margin = calculateMargin(buy + sell.fixCost, marginPct);
  if (!margin) throw new PricingError('price_line_missing', 'a buy price above 0');
  const vat = calculateVat(margin.withMargin, sell.vatPct);
  if (!vat) throw new PricingError('price_line_missing', 'a sell price above 0');
  return { withMargin: margin.withMargin, withVat: vat.withVat };
}

/**
 * getpack's margin for the quantity: the first `standard_product` margin line whose quantity band holds it (price bounds
 * do not apply — legacy reads one flat `locopack_margin` per factory, quirk S2), else the table's fallback.
 */
export function quantityMargin(sell: SellSnapshot, qty: number): number {
  const line = sell.marginLines.find(
    (l) => (l.qtyMin === null || l.qtyMin <= qty) && (l.qtyMax === null || l.qtyMax >= qty),
  );
  if (line) return line.valuePct;
  if (sell.marginFallbackPct === null) throw new PricingError('price_line_missing', 'sell margin');
  return sell.marginFallbackPct;
}

const nullFirst = (a: number | null, b: number | null) =>
  a === b ? 0 : a === null ? -1 : b === null ? 1 : a - b;

/** `getSteps` + `sortPrices`: the tier table for one margin. */
export function tierTable(
  rows: readonly StockPriceRow[],
  sell: SellSnapshot,
  marginPct: number,
): PriceTier[] {
  // `orderBy('min')`; equal minimums keep the line order.
  const steps = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => nullFirst(a.r.minQty, b.r.minQty) || a.i - b.i)
    .map(({ r }) => r);
  const data: (PriceTier | undefined)[] = steps.map((step, s) => {
    const last = steps.length === s + 1;
    const { withMargin, withVat } = salePrice(step.unitBuyPrice, sell, marginPct);
    return {
      min: steps.length > 1 && last ? steps[s - 1]!.maxQty : step.minQty,
      max: step.maxQty,
      unitBuyPrice: step.unitBuyPrice,
      withMargin,
      perPcs: withVat,
      leadTimeDays: step.leadTimeDays,
    };
  });
  // A later tier whose price is not lower absorbs the earlier ranges at its own price (`sortPrices`, quirk S8).
  for (let key = 0; key < data.length; key++) {
    const prev = data[key - 1];
    const row = data[key]!;
    if (prev !== undefined && row.perPcs >= prev.perPcs) {
      for (let i = key - 1; i >= 0; i--) {
        const earlier = data[i];
        if (earlier !== undefined && row.perPcs >= earlier.perPcs) {
          row.min = earlier.min;
          data[i] = undefined;
        }
      }
    }
  }
  return data.filter((t): t is PriceTier => t !== undefined).sort((a, b) => nullFirst(a.min, b.min));
}

const holds = (tier: PriceTier, qty: number) =>
  (tier.min === null || qty >= tier.min) && (tier.max === null || qty <= tier.max);

function optionResult(
  input: StandardProductInput,
  option: StandardProductOption,
): StandardProductOptionResult {
  const head = { optionKey: option.optionKey, factoryId: option.factoryId, printTypeId: option.printTypeId };
  const failAll = (error: PricingError): StandardProductOptionResult => {
    const e = { code: error.code, detail: error.detail };
    return {
      ...head,
      tiers: null,
      steps: input.quantities.map(() => null),
      stepErrors: input.quantities.map(() => e),
      error: e,
    };
  };
  if (option.unavailable?.length)
    return failAll(new PricingError('price_line_missing', option.unavailable.join(', ')));
  if (option.rows.length === 0)
    return failAll(new PricingError('price_line_missing', 'pl_stock_product_prices'));
  const vatInclude = (100 + option.sell.vatPct) / 100;
  let tiers: PriceTier[] | null = null;
  const stepErrors: StandardProductOptionResult['stepErrors'] = [];
  const steps = input.quantities.map((qty): StandardProductStep | null => {
    try {
      if (input.minOrderQty !== undefined && qty < input.minOrderQty) {
        throw new PricingError('process_not_possible', `minimum order ${input.minOrderQty}`);
      }
      const target = quantityMargin(option.sell, qty);
      const table = tierTable(option.rows, option.sell, target);
      tiers ??= table;
      const tier = table.find((t) => holds(t, qty));
      if (!tier) throw new PricingError('process_not_possible', `quantity ${qty} outside the price tiers`);
      const sum = tier.perPcs * qty;
      const designFee = input.design.graphic ? (option.sell.designFee ?? 0) : 0;
      const total = sum + designFee;
      const buyPrice = tier.unitBuyPrice * qty;
      const net = total / vatInclude;
      stepErrors.push(null);
      return {
        qty,
        tier,
        targetMarginPct: target,
        buyPrice,
        perPcs: tier.perPcs,
        sum,
        vatPrice: (tier.perPcs - tier.withMargin) * qty,
        designFee,
        total,
        leadTimeDays: Math.ceil(tier.leadTimeDays ?? 0),
        marginPct: net > 0 ? ((net - buyPrice) / net) * 100 : 0,
      };
    } catch (error) {
      if (!(error instanceof PricingError)) throw error;
      stepErrors.push({ code: error.code, detail: error.detail });
      return null;
    }
  });
  const firstError = stepErrors.find((e) => e !== null) ?? null;
  return { ...head, tiers, steps, stepErrors, error: steps.every((s) => s === null) ? firstError : null };
}

export const standardProductCalculator: Calculator<
  StandardProductInput,
  StandardProductSnapshot,
  StandardProductResult
> = {
  key: 'standard_product',
  version: STANDARD_PRODUCT_CALCULATOR_VERSION,
  calculate(input, snapshot) {
    return { options: snapshot.options.map((o) => optionResult(input, o)) };
  },
};
