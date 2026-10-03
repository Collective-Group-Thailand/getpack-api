/** D-289: which tooling a reorder reuses at a factory — neither charged nor bought there. */
export interface ToolingWaive {
  plates: boolean;
  dieBlock: boolean;
}

/** Plates and die blocks of every part: sale VAT included, buy at the factory's price. */
export interface ToolingAmounts {
  platesSale: number;
  dieBlockSale: number;
  platesBuy: number;
  dieBlockBuy: number;
}
