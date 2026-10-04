import { type ToolingAmountsDto } from './quote.dto';
import { type ToolingAmountsView } from './quote-engine.service';

/** Plates and die blocks for staff: buy prices only with `factory_buy_prices.read` (D-141). */
export function toolingView(a: ToolingAmountsView, cost: boolean): ToolingAmountsDto {
  return {
    platesSale: a.platesSale,
    dieBlockSale: a.dieBlockSale,
    platesBuy: cost ? a.platesBuy : null,
    dieBlockBuy: cost ? a.dieBlockBuy : null,
  };
}
