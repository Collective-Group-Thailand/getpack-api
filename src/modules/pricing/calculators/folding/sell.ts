import { convertTo2Decimal } from '../../engine/php';
import { PricingError } from './request';

/**
 * Packio's sell side on top of a factory buy price (legacy `Calculator::SaleMargin`,
 * `app/Models/Calculator.php:223-449`, called from `FoldingCalculator::calculate:1400-1455`). The
 * margin tiers, fix cost and design fees are Packio's `sell_margin_tables` (D-063), VAT the dated
 * `vat_standard` rate. Customer prices include VAT, as legacy; shipping arrives with B2.4 (D-013).
 */

export interface SellMarginLine {
  qtyMin: number | null;
  qtyMax: number | null;
  priceMin: number | null;
  priceMax: number | null;
  valuePct: number;
}

export interface SellSnapshot {
  /** `margin` table lines of the product type / print type (legacy `locopack_margins`). */
  marginLines: readonly SellMarginLine[];
  /** Legacy `factory_match_print_type.locopack_margin`, used when no line matches. */
  marginFallbackPct: number | null;
  /** Legacy `locopack_fix_cost`, added to the buy price before the margin. */
  fixCost: number;
  /** Graphic design fee (legacy `SALE_MARGIN_GRAPHIC_DESIGN_FEE_FOLDING`); null = not offered. */
  designFee: number | null;
  /** Structure design fee (legacy `SALE_MARGIN_STRUCTURE_DESIGN_FEE`); null = not offered. */
  structureDesignFee: number | null;
  vatPct: number;
}

/** A tier: run inclusive on both ends, price half-open (`FoldingCalculator.php:1419-1427`). */
function tier(lines: readonly SellMarginLine[], qty: number, price: number): number | undefined {
  return lines.find(
    (l) =>
      (l.qtyMin === null || l.qtyMin <= qty) &&
      (l.qtyMax === null || l.qtyMax >= qty) &&
      (l.priceMin === null || l.priceMin <= price) &&
      (l.priceMax === null || l.priceMax > price),
  )?.valuePct;
}

/**
 * Target and base margin (`:1409-1436`): the tier of the run and buy price, and the tier at run 1 and
 * price 1 as the base; without a tier both are the fallback. Legacy reads a missing base tier as 0.
 */
export function sellMargins(
  sell: SellSnapshot,
  runQty: number,
  buyPrice: number,
): { target: number; base: number } {
  const target = tier(sell.marginLines, runQty, buyPrice);
  if (target !== undefined) return { target, base: tier(sell.marginLines, 1, 1) ?? 0 };
  if (sell.marginFallbackPct === null) throw new PricingError('price_line_missing', 'sell margin');
  return { target: sell.marginFallbackPct, base: sell.marginFallbackPct };
}

export interface ForSale {
  perPcs: number;
  perPcsWithDelivery: number;
  perPcsBaseWithDelivery: number;
  deliveryPricePerPcs: number;
  /** Per piece × quantity, VAT included. */
  sum: number;
  deliveryCost: number;
  deliveryPrice: number;
  fixCost: number;
  targetMarginPct: number;
  baseMarginPct: number;
  /** Price at the base margin minus the price at the target margin (legacy `discount_from_margin`). */
  discountFromMargin: number;
  vatPrice: number;
  /** Sum with delivery (design fees are added once per quote, quirk Q2). */
  total: number;
}

/**
 * `SaleMargin` for one part and step. `qty` is the quantity asked for, `runQty` the production run the
 * tiers are read at (legacy passes both, `:1389, :1442`); `shippingCost` is the carrier cost before VAT.
 */
export function saleMargin(
  sell: SellSnapshot,
  buyPrice: number,
  qty: number,
  runQty: number,
  shippingCost: number,
): ForSale {
  const { target, base } = sellMargins(sell, runQty, buyPrice);
  const vatInclude = (100 + sell.vatPct) / 100;
  let deliveryPrice = Math.ceil(shippingCost * vatInclude);
  const deliveryPricePerPcs = convertTo2Decimal(deliveryPrice / qty);
  deliveryPrice = deliveryPricePerPcs * qty;
  const pricePlusFixCost = buyPrice + sell.fixCost;
  const percentMargin = (100 - target) / 100;
  const percentBaseMargin = (100 - base) / 100;
  const totalWithMarginVat = (pricePlusFixCost / percentMargin) * vatInclude;
  const vatPrice = totalWithMarginVat - totalWithMarginVat / vatInclude;
  const totalWithBaseMarginVat = (pricePlusFixCost / percentBaseMargin) * vatInclude;
  const perPcs = convertTo2Decimal(totalWithMarginVat / qty);
  const perPcsBase = convertTo2Decimal(totalWithBaseMarginVat / qty);
  const perPcsWithDelivery = perPcs + deliveryPricePerPcs;
  const perPcsBaseWithDelivery = perPcsBase + deliveryPricePerPcs;
  const sumWithDelivery = perPcsWithDelivery * qty;
  return {
    perPcs,
    perPcsWithDelivery,
    perPcsBaseWithDelivery,
    deliveryPricePerPcs,
    sum: perPcs * qty,
    deliveryCost: shippingCost,
    deliveryPrice,
    fixCost: sell.fixCost,
    targetMarginPct: target,
    baseMarginPct: base,
    discountFromMargin: perPcsBaseWithDelivery * qty - sumWithDelivery,
    vatPrice,
    total: sumWithDelivery,
  };
}
