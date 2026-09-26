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
