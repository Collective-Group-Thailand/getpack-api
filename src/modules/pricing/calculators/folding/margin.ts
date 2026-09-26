import { convertNumberFloat, phpFloatval } from '../../engine/php';

/**
 * The factory's margin on its cost — part of the buy price Packio pays (D-042), never Packio's markup.
 * Port of `A/CalculateCost::calMargin` (legacy `A/CalculateCost.php:2178-2225`, compute id 2) followed
 * by `Object/Margin::calculate` (`Object/Margin.php:65-110`), which recomputes the sale price.
 */
export interface FactoryMargin {
  percentMargin: number;
  /** Legacy `margin`: cost ÷ (1 − m) − cost. */
  margin: number;
  /** Per-piece price rounded to satang, times the requested quantity (legacy `sale_value_baht_per_lot`). */
  saleValueBahtPerLot: number;
  totalCost: number;
  /** Legacy stores the requested quantity under `box_amount`. */
  qty: number;
  /** Buy price of the lot, unrounded (`Object/Margin::calSalePrice`). */
  salePrice: number;
  /** Per-piece buy price as legacy's 2-decimal string (`Object/Margin::calSuggestPrice`). */
  suggestPrice: string;
}

export function factoryMargin(totalCost: number, marginPct: number, qty: number): FactoryMargin {
  // calMargin, compute id 2
  const marginPrice = totalCost / (1 - marginPct / 100) - totalCost;
  const lotSuggest = convertNumberFloat((marginPrice + totalCost) / qty);
  // Object/Margin: contribution uses the margin when positive (`calContribution`), floored at 0.
  const contribution = totalCost / (1 - (marginPct > 0 ? marginPct : 0) / 100) - totalCost;
  const salePrice = totalCost + Math.max(0, contribution);
  return {
    percentMargin: marginPct,
    margin: marginPrice,
    saleValueBahtPerLot: phpFloatval(lotSuggest) * qty,
    totalCost,
    qty,
    salePrice,
    suggestPrice: convertNumberFloat(salePrice / qty),
  };
}

/**
 * Digital margin (legacy `A/CalculateCostDigital::calMargin:2379-2425`): on the production run, with the
 * factory's lowest lot price; legacy then shows the rounded lot as the sale price (`:487-488`).
 */
export function digitalFactoryMargin(
  totalCost: number,
  marginPct: number,
  boxAmount: number,
  minLotPrice: number | null,
): FactoryMargin {
  const marginPrice = totalCost / (1 - marginPct / 100) - totalCost;
  let salePrice = marginPrice + totalCost;
  if (salePrice < (minLotPrice ?? 0)) salePrice = minLotPrice ?? 0;
  const suggestPrice = convertNumberFloat(salePrice / boxAmount);
  const saleValue = phpFloatval(suggestPrice) * boxAmount;
  return {
    percentMargin: marginPct,
    margin: marginPrice,
    saleValueBahtPerLot: saleValue,
    totalCost,
    qty: boxAmount,
    salePrice: saleValue,
    suggestPrice,
  };
}
