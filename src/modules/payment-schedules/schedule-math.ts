import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';

/**
 * Payment-schedule arithmetic (ADR-0008), pure. Amounts are decimal strings (THB, 2 decimals).
 * - instalments: each §2.9 column split by percentage, half-up to the satang, the last instalment takes the
 *   remainder; cash = gross − withholding;
 * - allocation to orders: in proportion to each order's gross, remainder on the largest gross (ties: first);
 * - payments: cash applied to unpaid instalments in `seq` order (FIFO).
 */

export interface AmountSet {
  net: string;
  vat: string;
  gross: string;
  wht: string;
  cash: string;
}

const D = (v: string | number | MoneyValue) => new MoneyDecimal(v.toString());
const round2 = (v: MoneyValue) => v.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
/** Split independently; net and cash are derived so every row keeps §2.9 arithmetic exactly. */
const KEYS = ['vat', 'gross', 'wht'] as const;

const withCash = (a: Omit<AmountSet, 'cash'>): AmountSet => ({
  ...a,
  cash: formatMoney(D(a.gross).sub(a.wht)),
});
const derive = (a: Pick<AmountSet, 'vat' | 'gross' | 'wht'>): AmountSet =>
  withCash({ ...a, net: formatMoney(D(a.gross).sub(a.vat)) });

export const ZERO: AmountSet = { net: '0.00', vat: '0.00', gross: '0.00', wht: '0.00', cash: '0.00' };

export function addSets(a: AmountSet, b: AmountSet): AmountSet {
  return withCash({
    net: formatMoney(D(a.net).add(b.net)),
    vat: formatMoney(D(a.vat).add(b.vat)),
    gross: formatMoney(D(a.gross).add(b.gross)),
    wht: formatMoney(D(a.wht).add(b.wht)),
  });
}

export function subSets(a: AmountSet, b: AmountSet): AmountSet {
  return withCash({
    net: formatMoney(D(a.net).sub(b.net)),
    vat: formatMoney(D(a.vat).sub(b.vat)),
    gross: formatMoney(D(a.gross).sub(b.gross)),
    wht: formatMoney(D(a.wht).sub(b.wht)),
  });
}

/** Splits `total` by percentages (adding up to 100, or to anything when `renormalise`). */
export function splitByPct(total: AmountSet, pcts: readonly string[], renormalise = false): AmountSet[] {
  if (pcts.length === 0) return [];
  const sum = pcts.reduce((a, p) => a.add(p), D(0));
  if (!renormalise && !sum.eq(100)) throw new RangeError(`percentages add up to ${sum.toString()}, not 100`);
  const base = renormalise ? sum : D(100);
  const out: Pick<AmountSet, 'vat' | 'gross' | 'wht'>[] = [];
  const running = { vat: D(0), gross: D(0), wht: D(0) };
  pcts.forEach((pct, index) => {
    const last = index === pcts.length - 1;
    const part = {} as Pick<AmountSet, 'vat' | 'gross' | 'wht'>;
    for (const k of KEYS) {
      const value = last ? D(total[k]).sub(running[k]) : round2(D(total[k]).mul(pct).div(base));
      running[k] = running[k].add(value);
      part[k] = formatMoney(value);
    }
    out.push(part);
  });
  return out.map(derive);
}

/** Allocates `amount` across orders by gross; the remainder goes to the largest gross (ties: first listed). */
export function allocateByGross<K>(
  amount: AmountSet,
  orders: readonly { key: K; gross: string }[],
): Map<K, AmountSet> {
  const result = new Map<K, AmountSet>();
  if (orders.length === 0) return result;
  const total = orders.reduce((a, o) => a.add(o.gross), D(0));
  let largest = 0;
  orders.forEach((o, i) => {
    if (D(o.gross).gt(orders[largest]!.gross)) largest = i;
  });
  const running = { vat: D(0), gross: D(0), wht: D(0) };
  const parts: Pick<AmountSet, 'vat' | 'gross' | 'wht'>[] = orders.map((o, i) => {
    const part = {} as Pick<AmountSet, 'vat' | 'gross' | 'wht'>;
    for (const k of KEYS) {
      const value = i === largest ? D(0) : total.gt(0) ? round2(D(amount[k]).mul(o.gross).div(total)) : D(0);
      running[k] = running[k].add(value);
      part[k] = formatMoney(value);
    }
    return part;
  });
  for (const k of KEYS) parts[largest]![k] = formatMoney(D(amount[k]).sub(running[k]));
  orders.forEach((o, i) => result.set(o.key, derive(parts[i]!)));
  return result;
}

export interface PayableInstalment<K> {
  key: K;
  cash: string;
  gross: string;
  paid: string;
}

export interface PaymentApplication<K> {
  key: K;
  cash: string;
  /** The gross this cash settles (cash + the proportional withholding). */
  gross: string;
  fullyPaid: boolean;
}

/** Applies `cash` to unpaid instalments in order (FIFO); returns what each takes and what is left over. */
export function applyFifo<K>(
  instalments: readonly PayableInstalment<K>[],
  cash: string,
): { applications: PaymentApplication<K>[]; leftover: string } {
  let left = D(cash);
  const applications: PaymentApplication<K>[] = [];
  for (const i of instalments) {
    if (left.lte(0)) break;
    const open = D(i.cash).sub(i.paid);
    if (open.lte(0)) continue;
    const take = MoneyDecimal.min(open, left);
    const gross = D(i.cash).gt(0) ? round2(take.mul(i.gross).div(i.cash)) : take;
    applications.push({
      key: i.key,
      cash: formatMoney(take),
      gross: formatMoney(gross),
      fullyPaid: take.eq(open),
    });
    left = left.sub(take);
  }
  return { applications, leftover: formatMoney(left) };
}

export interface SelectionRule {
  orderValue?: {
    gte?: { setting: string } | string;
    lt?: { setting: string } | string;
  };
  customerTypes?: string[];
  productTypeCodes?: string[];
  creditApproved?: boolean;
}

export interface SelectionContext {
  grossAmount: string;
  customerType: string;
  productTypeCodes: readonly string[];
  creditApproved: boolean;
  /** Setting values referenced by rules (`payments.schedule_split_threshold`). */
  settings: Record<string, string>;
}

export interface TemplateCandidate {
  key: string;
  priority: number;
  rule: SelectionRule;
}

function bound(value: { setting: string } | string, settings: Record<string, string>): MoneyValue {
  if (typeof value === 'string') return D(value);
  const resolved = settings[value.setting];
  if (resolved === undefined) throw new RangeError(`setting ${value.setting} is not available`);
  return D(resolved);
}

export function matches(rule: SelectionRule, ctx: SelectionContext): boolean {
  if (rule.creditApproved !== undefined && rule.creditApproved !== ctx.creditApproved) return false;
  if (rule.customerTypes && !rule.customerTypes.includes(ctx.customerType)) return false;
  if (rule.productTypeCodes && !ctx.productTypeCodes.every((c) => rule.productTypeCodes!.includes(c)))
    return false;
  const value = D(ctx.grossAmount);
  if (rule.orderValue?.gte !== undefined && value.lt(bound(rule.orderValue.gte, ctx.settings))) return false;
  if (rule.orderValue?.lt !== undefined && value.gte(bound(rule.orderValue.lt, ctx.settings))) return false;
  return true;
}

/** The first matching template by priority (lower first, then key for a stable order); null when none. */
export function selectTemplate<T extends TemplateCandidate>(
  candidates: readonly T[],
  ctx: SelectionContext,
): T | null {
  const ordered = [...candidates].sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
  return ordered.find((c) => matches(c.rule, ctx)) ?? null;
}
