import { MoneyDecimal, type MoneyValue } from './money';

/**
 * The one VAT calculation of getpack (GLOBAL-RULES §5, DECISIONS-STAGE-A §7): each taxable line is
 * taken ex-VAT and rounded to 2 decimals, the lines are summed (goods, design fees, shipping charged
 * by getpack) and VAT is `ratePct` % of that sum, half-up to 2 decimals. The rate always comes from
 * the approved `vat_standard` tax-rate version, never a constant. Issued documents keep their amounts.
 */
export interface VatLine {
  amount: MoneyValue | string;
  /** True when `amount` includes VAT (instant quotation prices); false for a VAT-exclusive amount. */
  inclusive: boolean;
}

export interface VatResult {
  /** Ex-VAT amount of each line, rounded to 2 decimals, in input order. */
  lineNets: MoneyValue[];
  net: MoneyValue;
  vat: MoneyValue;
}

const round2 = (v: MoneyValue) => v.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);

/** Ex-VAT amount of one line, rounded to the satang. */
export function exVat(line: VatLine, ratePct: MoneyValue | string): MoneyValue {
  const amount = new MoneyDecimal(line.amount);
  if (!line.inclusive) return round2(amount);
  return round2(amount.mul(100).div(new MoneyDecimal(ratePct).add(100)));
}

export function computeVat(lines: VatLine[], ratePct: MoneyValue | string): VatResult {
  const lineNets = lines.map((l) => exVat(l, ratePct));
  const net = lineNets.reduce((a, b) => a.add(b), new MoneyDecimal(0));
  const vat = round2(net.mul(ratePct).div(100));
  return { lineNets, net, vat };
}
