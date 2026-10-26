import { MoneyDecimal, type MoneyValue } from '@common/money/money';
import { computeVat } from '@common/money/vat';

/**
 * The amounts of one RFQ quotation line (B-API-6, GLOBAL-RULES §5): CS quotes a VAT-exclusive unit price and an
 * ex-VAT shipping amount; the goods (unit × quantity) and shipping are the line's taxable lines, VAT comes from the
 * shared helper (`computeVat`: each line ex-VAT rounded to 2 decimals, summed, rate % half-up). The rate is the
 * `vat_standard` version in force, never a constant. A quotation already sent keeps the amounts it was sent with.
 */
export function rfqLineAmounts(
  unitPrice: MoneyValue | string,
  quantity: number,
  shippingNetAmount: MoneyValue | string,
  ratePct: MoneyValue | string,
): { netAmount: MoneyValue; vatAmount: MoneyValue; grossAmount: MoneyValue } {
  const goods = new MoneyDecimal(unitPrice).mul(quantity);
  const { net, vat } = computeVat(
    [
      { amount: goods, inclusive: false },
      { amount: shippingNetAmount, inclusive: false },
    ],
    ratePct,
  );
  return { netAmount: net, vatAmount: vat, grossAmount: net.add(vat) };
}

/** The VAT of an ex-VAT shipping amount on its own (the shipping line of an accepted RFQ quote). */
export function shippingVat(
  shippingNetAmount: MoneyValue | string,
  ratePct: MoneyValue | string,
): MoneyValue {
  return computeVat([{ amount: shippingNetAmount, inclusive: false }], ratePct).vat;
}
