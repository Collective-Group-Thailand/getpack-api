/**
 * D-454 (C2b, DECISIONS-STAGE-A §15.3): the minimum order counts **per size** — each standard or custom size is its
 * own die, plate and set-up, so it is one configuration, one quotation, one cart item. An order may mix sizes; each
 * item meets its catalogue product's `quantity_min` / `quantity_max` on its own and is priced on its own. Nothing
 * adds quantities across items (or across a product's sizes) to reach a minimum. Plateless / digital exceptions:
 * later (not decided).
 */
export interface QuantityLimits {
  quantityMin: number | null;
  quantityMax: number | null;
}

export interface QuantityLimitError {
  path: string;
  code: 'min' | 'max';
  message: string;
}

/** The limit one item's quantity breaks, or null; a product without limits (or none) accepts any quantity. */
export function quantityLimitError(
  quantity: number,
  limits: QuantityLimits | null | undefined,
  path = 'quantity',
): QuantityLimitError | null {
  if (limits?.quantityMin != null && quantity < limits.quantityMin)
    return { path, code: 'min', message: `at least ${limits.quantityMin}` };
  if (limits?.quantityMax != null && quantity > limits.quantityMax)
    return { path, code: 'max', message: `at most ${limits.quantityMax}` };
  return null;
}
