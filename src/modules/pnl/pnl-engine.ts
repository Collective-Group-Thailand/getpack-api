import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';

import { FIXED_COST_LINES, PNL_LINES, type PnlLineKey } from './pnl-lines';

/**
 * D-472: the management P&L arithmetic — pure, decimal.js (`MoneyDecimal`, half-up), no I/O. Every value is rounded
 * to 2 places as a cell, and calculated lines are computed from the rounded cells, so what the grid shows adds up.
 * `null` means "no value" (no system data and nothing entered): a formula with a null input treats it as 0 for money
 * sums but stays null for ratios and days that cannot be computed.
 */

export const D = (v: MoneyValue | string | number) => new MoneyDecimal(v);
const ZERO = () => new MoneyDecimal(0);
const r2 = (v: MoneyValue): MoneyValue => v.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
export const fmt = (v: MoneyValue | null): string | null => (v === null ? null : formatMoney(v));

// --- corporate income tax -------------------------------------------------------------------------------------------

/** Setting `tax.cit_rates` (D-472, owner Finance Manager, pending the CPA). Decimal strings. */
export interface CitRates {
  /** Rate when the SME conditions are not met (Revenue Code s.67 bis … standard 20 %). */
  standardRatePct: string;
  sme: {
    /** Progressive bands on the year's net profit; `upTo` null = the rest. */
    bands: { upTo: string | null; ratePct: string }[];
    /** SME conditions: paid-up capital at year end ≤ this and the year's revenue ≤ `revenueMax`. */
    paidUpCapitalMax: string;
    revenueMax: string;
  };
  /** The company's paid-up capital (the accountant enters it); null → the SME rate is not applied. */
  paidUpCapital: string | null;
}

/** SME bands apply only when the paid-up capital is known and both conditions hold; otherwise the standard rate. */
export function smeEligible(rates: CitRates, annualRevenue: MoneyValue): boolean {
  if (rates.paidUpCapital === null) return false;
  return D(rates.paidUpCapital).lte(rates.sme.paidUpCapitalMax) && annualRevenue.lte(rates.sme.revenueMax);
}

/** Tax on a year's profit before tax (≤ 0 → 0), rounded to the satang. */
export function citOn(profit: MoneyValue, rates: CitRates, sme: boolean): MoneyValue {
  if (profit.lte(0)) return ZERO();
  if (!sme) return r2(profit.mul(rates.standardRatePct).div(100));
  let tax = ZERO();
  let lower = ZERO();
  for (const band of rates.sme.bands) {
    const upper = band.upTo === null ? null : D(band.upTo);
    const top = upper === null || profit.lt(upper) ? profit : upper;
    if (top.gt(lower)) tax = tax.add(top.sub(lower).mul(band.ratePct).div(100));
    if (upper === null || profit.lte(upper)) break;
    lower = upper;
  }
  return r2(tax);
}

/**
 * Monthly estimate on the cumulative profit before tax of the plan year: month m = tax(YTD to m) − tax(YTD to m−1).
 * The months add up to the tax on the year's profit; a loss month after profit gives a negative (reversing) month.
 */
export function citByMonth(profitBeforeTax: MoneyValue[], rates: CitRates, sme: boolean): MoneyValue[] {
  let cumulative = ZERO();
  let taxSoFar = ZERO();
  return profitBeforeTax.map((p) => {
    cumulative = cumulative.add(p);
    const tax = citOn(cumulative, rates, sme);
    const month = tax.sub(taxSoFar);
    taxSoFar = tax;
    return month;
  });
}

// --- working capital and break-even ---------------------------------------------------------------------------------

/** Days: average balance ÷ flow × days in the period (null when the flow is not positive). */
export function daysOf(averageBalance: MoneyValue, flow: MoneyValue, days: number): MoneyValue | null {
  if (flow.lte(0)) return null;
  return r2(averageBalance.div(flow).mul(days));
}

/** Cash conversion cycle = DSO − DPO (no inventory: made to order). */
export function cashConversionCycle(dso: MoneyValue | null, dpo: MoneyValue | null): MoneyValue | null {
  return dso === null || dpo === null ? null : r2(dso.sub(dpo));
}

/**
 * Credit cost estimate of a month (management figure, never posted): the cash paid out to factories and carriers
 * (factory + shipping cost) funded for the cash conversion cycle at the cost of capital — the D-470 per-deal
 * estimate aggregated at company level. A cycle ≤ 0 costs nothing.
 */
export function creditCostOf(
  cashOut: MoneyValue,
  annualPct: string,
  ccc: MoneyValue | null,
): MoneyValue | null {
  if (ccc === null) return null;
  if (ccc.lte(0) || cashOut.lte(0)) return ZERO();
  return r2(cashOut.mul(annualPct).div(100).mul(ccc).div(365));
}

/**
 * Break-even revenue: fixed costs ÷ (gross margin % − commission %) of net revenue — the net revenue at which
 * EBIT is 0. Null when net revenue ≤ 0 or the contribution ratio is not positive (no break-even).
 */
export function breakEvenRevenue(
  fixedCosts: MoneyValue,
  netRevenue: MoneyValue,
  grossMargin: MoneyValue,
  commissions: MoneyValue,
): MoneyValue | null {
  if (netRevenue.lte(0)) return null;
  const ratio = grossMargin.sub(commissions).div(netRevenue);
  if (ratio.lte(0)) return null;
  return r2(fixedCosts.div(ratio));
}

/** Percentage a ÷ b × 100, 2 places; null when b ≤ 0. */
export function pctOf(a: MoneyValue, b: MoneyValue): MoneyValue | null {
  return b.lte(0) ? null : r2(a.div(b).mul(100));
}

// --- the plan -------------------------------------------------------------------------------------------------------

export type LineValues = Partial<Record<PnlLineKey, (MoneyValue | null)[]>>;

export interface PlanComputeInput {
  /** `YYYY-MM`, in order. */
  months: string[];
  /** Final values (auto, manual or override) of every `source` line, one per month; null = no value. */
  values: LineValues;
  cit: CitRates;
  /** `finance.cost_of_capital_annual_pct`. */
  costOfCapitalPct: string;
}

export interface PlanComputeResult {
  /** Every line, one value per month (sources as given, rounded; formulas computed). */
  months: Record<PnlLineKey, (MoneyValue | null)[]>;
  /** The total column: money summed, ratios and days recomputed on the year, bad debt = the last month's value. */
  totals: Record<PnlLineKey, MoneyValue | null>;
  smeApplied: boolean;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Computes every formula line of a plan from its source lines (D-472). The CIT estimate is cumulative over the
 * plan's months; the SME bands apply when `smeEligible` holds for the plan's annual net revenue.
 */
export function computePlan(input: PlanComputeInput): PlanComputeResult {
  const n = input.months.length;
  const out = {} as Record<PnlLineKey, (MoneyValue | null)[]>;
  for (const l of PNL_LINES) {
    const given = l.calc === 'source' ? (input.values[l.key] ?? []) : [];
    out[l.key] = Array.from({ length: n }, (_, i): MoneyValue | null => {
      const v = given[i];
      return v === undefined || v === null ? null : r2(v);
    });
  }
  const z = (key: PnlLineKey, i: number) => out[key][i] ?? ZERO();
  const sum = (keys: readonly PnlLineKey[], i: number) => keys.reduce((a, k) => a.add(z(k, i)), ZERO());

  for (let i = 0; i < n; i++) {
    out.net_revenue[i] = z('revenue_goods', i).add(z('revenue_shipping', i)).sub(z('discounts', i));
    out.gross_margin[i] = z('net_revenue', i)
      .sub(z('factory_cost', i))
      .sub(z('shipping_cost', i))
      .sub(z('payment_fees', i));
    out.ebit[i] = z('gross_margin', i)
      .sub(z('agent_commission', i))
      .sub(z('employee_commission', i))
      .sub(sum(FIXED_COST_LINES, i));
  }
  const annualRevenue = out.net_revenue.reduce<MoneyValue>((a, v) => a.add(v ?? 0), ZERO());
  const sme = smeEligible(input.cit, annualRevenue);
  const pbt = Array.from({ length: n }, (_, i) => z('ebit', i).sub(z('finance_cost', i)));
  const cit = citByMonth(pbt, input.cit, sme);
  for (let i = 0; i < n; i++) {
    out.cit_estimate[i] = cit[i]!;
    out.net_profit[i] = pbt[i]!.sub(cit[i]!);
    out.memo_ebitda[i] = z('ebit', i).add(z('depreciation', i));
    const commissions = z('agent_commission', i).add(z('employee_commission', i));
    out.memo_commission_ratio[i] = pctOf(commissions, z('gross_margin', i));
    out.memo_ccc[i] = cashConversionCycle(out.memo_dso[i] ?? null, out.memo_dpo[i] ?? null);
    out.memo_credit_cost[i] = creditCostOf(
      z('factory_cost', i).add(z('shipping_cost', i)),
      input.costOfCapitalPct,
      out.memo_ccc[i] ?? null,
    );
    out.memo_break_even[i] = breakEvenRevenue(
      sum(FIXED_COST_LINES, i),
      z('net_revenue', i),
      z('gross_margin', i),
      commissions,
    );
  }

  return { months: out, totals: planTotals(out, n), smeApplied: sme };
}

/**
 * The year column of a plan from its month values (stored or computed): money summed, ratios and days recomputed on
 * the year, the bad-debt provision (a balance) = the last month with a value.
 */
export function planTotals(
  out: Record<PnlLineKey, (MoneyValue | null)[]>,
  n: number,
): Record<PnlLineKey, MoneyValue | null> {
  const z = (key: PnlLineKey, i: number) => out[key][i] ?? ZERO();
  const totals = {} as Record<PnlLineKey, MoneyValue | null>;
  const total = (key: PnlLineKey) => out[key].reduce<MoneyValue>((a, v) => a.add(v ?? 0), ZERO());
  for (const l of PNL_LINES)
    if (l.unit === 'money' && l.key !== 'memo_bad_debt' && l.key !== 'memo_break_even') {
      totals[l.key] = out[l.key].some((v) => v !== null) ? total(l.key) : null;
    }
  const lastBadDebt = [...out.memo_bad_debt].reverse().find((v) => v !== null);
  totals.memo_bad_debt = lastBadDebt ?? null;
  const commissionsT = total('agent_commission').add(total('employee_commission'));
  totals.memo_commission_ratio = pctOf(commissionsT, total('gross_margin'));
  // Annual DSO / DPO: Σ(days × flow) ÷ Σ flow — the day-weighted average balance over the year's flow.
  const weightedDays = (key: 'memo_dso' | 'memo_dpo', flow: (i: number) => MoneyValue) => {
    let num = ZERO();
    let den = ZERO();
    for (let i = 0; i < n; i++) {
      const d = out[key][i];
      if (d === null || d === undefined) continue;
      num = num.add(d.mul(flow(i)));
      den = den.add(flow(i));
    }
    return den.lte(0) ? null : r2(num.div(den));
  };
  totals.memo_dso = weightedDays('memo_dso', (i) => z('net_revenue', i));
  totals.memo_dpo = weightedDays('memo_dpo', (i) => z('factory_cost', i).add(z('shipping_cost', i)));
  totals.memo_ccc = cashConversionCycle(totals.memo_dso, totals.memo_dpo);
  totals.memo_break_even = breakEvenRevenue(
    FIXED_COST_LINES.reduce((a, k) => a.add(total(k)), ZERO()),
    total('net_revenue'),
    total('gross_margin'),
    commissionsT,
  );
  return totals;
}

// --- forecast helpers -----------------------------------------------------------------------------------------------

/** Σ numerator ÷ Σ denominator over the trailing window; null without a positive denominator. */
export function trailingRatio(numerator: MoneyValue[], denominator: MoneyValue[]): MoneyValue | null {
  const den = denominator.reduce((a, v) => a.add(v), ZERO());
  if (den.lte(0)) return null;
  return numerator.reduce((a, v) => a.add(v), ZERO()).div(den);
}

/** Average of the trailing window; null when the window has no posted line at all. */
export function trailingAverage(values: MoneyValue[], lineCount: number): MoneyValue | null {
  if (lineCount === 0 || values.length === 0) return null;
  return r2(values.reduce((a, v) => a.add(v), ZERO()).div(values.length));
}

export interface PipelineLead {
  /** Expected deal value (ex VAT). */
  value: string;
  stage: string;
  agentKind: 'freelance' | 'employee';
  /** The agent plan's effective first-order rate (%), null when no approved version is in force. */
  ratePct: string | null;
}

export interface PipelineSpread {
  revenuePerMonth: MoneyValue;
  agentCommissionPerMonth: MoneyValue;
  employeeCommissionPerMonth: MoneyValue;
  weightedTotal: MoneyValue;
}

/**
 * Σ open deal value × stage probability, spread evenly over `horizon` forecast months; the commission of each lead
 * at its agent plan's effective rate (freelance → agent commission, employee → employee commission).
 */
export function spreadPipeline(
  leads: PipelineLead[],
  stageProbabilityPct: Record<string, string>,
  horizon: number,
): PipelineSpread {
  let weighted = ZERO();
  let agent = ZERO();
  let employee = ZERO();
  for (const lead of leads) {
    const p = stageProbabilityPct[lead.stage];
    if (p === undefined) continue;
    const w = D(lead.value).mul(p).div(100);
    weighted = weighted.add(w);
    const c = lead.ratePct === null ? ZERO() : w.mul(lead.ratePct).div(100);
    if (lead.agentKind === 'freelance') agent = agent.add(c);
    else employee = employee.add(c);
  }
  const h = Math.max(1, horizon);
  return {
    revenuePerMonth: r2(weighted.div(h)),
    agentCommissionPerMonth: r2(agent.div(h)),
    employeeCommissionPerMonth: r2(employee.div(h)),
    weightedTotal: r2(weighted),
  };
}

export interface CustomerMonthRevenue {
  customerKey: string;
  month: string;
  amount: string;
}

/**
 * Repeat-order run rate: revenue of the customers (company, else person) with revenue in at least `minMonths` of the
 * trailing window, averaged over the window's months. One-off customers are left out (conservative).
 */
export function repeatRunRate(
  rows: CustomerMonthRevenue[],
  windowMonths: string[],
  minMonths: number,
): { perMonth: MoneyValue; customers: string[] } {
  const inWindow = rows.filter((r) => windowMonths.includes(r.month));
  const byCustomer = new Map<string, { months: Set<string>; amount: MoneyValue }>();
  for (const r of inWindow) {
    const c = byCustomer.get(r.customerKey) ?? { months: new Set<string>(), amount: ZERO() };
    if (D(r.amount).gt(0)) c.months.add(r.month);
    c.amount = c.amount.add(r.amount);
    byCustomer.set(r.customerKey, c);
  }
  const repeat = [...byCustomer.entries()].filter(([, c]) => c.months.size >= minMonths && c.amount.gt(0));
  const total = repeat.reduce((a, [, c]) => a.add(c.amount), ZERO());
  return {
    perMonth: windowMonths.length === 0 ? ZERO() : r2(total.div(windowMonths.length)),
    customers: repeat.map(([k]) => k).sort(),
  };
}

export interface ClassRevenueCost {
  classKey: string;
  revenue: string;
  cost: string;
}

/**
 * Factory cost ratio of forecast revenue: Σ over product classes of the trailing revenue mix × (cost ÷ revenue) of
 * the class = (1 − gross margin % by class) weighted by the mix. Null without positive trailing revenue.
 */
export function classMixCostRatio(rows: ClassRevenueCost[]): {
  ratio: MoneyValue | null;
  byClass: { classKey: string; mixPct: string; costRatioPct: string }[];
} {
  const byClass = new Map<string, { revenue: MoneyValue; cost: MoneyValue }>();
  for (const r of rows) {
    const c = byClass.get(r.classKey) ?? { revenue: ZERO(), cost: ZERO() };
    c.revenue = c.revenue.add(r.revenue);
    c.cost = c.cost.add(r.cost);
    byClass.set(r.classKey, c);
  }
  const revenue = [...byClass.values()].reduce((a, c) => a.add(c.revenue), ZERO());
  if (revenue.lte(0)) return { ratio: null, byClass: [] };
  let ratio = ZERO();
  const detail: { classKey: string; mixPct: string; costRatioPct: string }[] = [];
  for (const [classKey, c] of [...byClass.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const mix = c.revenue.div(revenue);
    // A class with cost but no revenue in the window carries its cost on the whole revenue.
    const costRatio = c.revenue.gt(0) ? c.cost.div(c.revenue) : null;
    ratio = ratio.add(costRatio === null ? c.cost.div(revenue) : mix.mul(costRatio));
    detail.push({
      classKey,
      mixPct: r2(mix.mul(100)).toFixed(2),
      costRatioPct: costRatio === null ? 'n/a' : r2(costRatio.mul(100)).toFixed(2),
    });
  }
  return { ratio, byClass: detail };
}

/** Months `YYYY-MM` from `from` (inclusive), `count` of them. */
export function monthsFrom(from: string, count: number): string[] {
  const [y, m] = from.split('-').map(Number) as [number, number];
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

/** The `count` months before `month` (oldest first). */
export function monthsBefore(month: string, count: number): string[] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 - count, 1));
  return monthsFrom(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, count);
}
