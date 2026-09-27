import { formatMoney, MoneyDecimal } from '@common/money/money';

/**
 * Quantity tolerance billing (D-021, D-080, D-165), pure. The tolerance is the one frozen in the quote
 * snapshot (order columns). Delivered = what receivers accepted (PODs).
 *  - exact → nothing;
 *  - shortage within tolerance → pro-rata credit of the product lines (net and VAT, P19);
 *  - overage within tolerance → not charged;
 *  - outside tolerance either way → automatic claim (B4.5).
 * The factory is paid for min(delivered, ordered) (D-165).
 */
export type ToleranceOutcomeValue =
  'exact' | 'shortage_within' | 'overage_within' | 'shortage_outside' | 'overage_outside';

export interface ToleranceInput {
  ordered: number;
  delivered: number;
  shortagePct: string;
  overagePct: string;
  /** Product lines of the order: net after discount and their VAT. */
  productNet: string;
  productVat: string;
}

export interface ToleranceResult {
  outcome: ToleranceOutcomeValue;
  payable: number;
  /** Signed: (delivered − ordered) / ordered × 100, 4 decimals. */
  deviationPct: string;
  credit: { net: string; vat: string; gross: string } | null;
}

export function evaluateTolerance(input: ToleranceInput): ToleranceResult {
  if (!Number.isInteger(input.ordered) || input.ordered <= 0) throw new RangeError('ordered must be > 0');
  if (!Number.isInteger(input.delivered) || input.delivered < 0)
    throw new RangeError('delivered must be ≥ 0');
  const ordered = new MoneyDecimal(input.ordered);
  const diff = new MoneyDecimal(input.delivered).sub(ordered);
  const deviation = diff.div(ordered).mul(100);
  const payable = Math.min(input.delivered, input.ordered);
  const deviationPct = deviation.toDecimalPlaces(4).toFixed(4);
  if (diff.isZero()) return { outcome: 'exact', payable, deviationPct, credit: null };
  if (diff.isNegative()) {
    if (deviation.abs().gt(new MoneyDecimal(input.shortagePct)))
      return { outcome: 'shortage_outside', payable, deviationPct, credit: null };
    const share = diff.abs().div(ordered);
    const net = formatMoney(new MoneyDecimal(input.productNet).mul(share));
    const vat = formatMoney(new MoneyDecimal(input.productVat).mul(share));
    return {
      outcome: 'shortage_within',
      payable,
      deviationPct,
      credit: { net, vat, gross: formatMoney(new MoneyDecimal(net).add(vat)) },
    };
  }
  if (deviation.gt(new MoneyDecimal(input.overagePct)))
    return { outcome: 'overage_outside', payable, deviationPct, credit: null };
  return { outcome: 'overage_within', payable, deviationPct, credit: null };
}
