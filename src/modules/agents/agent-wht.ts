import { MoneyDecimal, type MoneyValue } from '@common/money/money';

/**
 * Withholding on agent commission (D-465, amends D-421; PLAN §5 of docs/design/agent-portal).
 *
 * - Individuals (s.40(2) income): s.50(1) progressive, cumulative per calendar year and agent. Run when a statement is
 *   approved; the December statement trues up to the actual year (`remainingMonths = 0`).
 * - Juristic agents: a service, 3 % when the payment is at least ฿1,000.00 (ภ.ง.ด.53), unchanged.
 * - Employee agents: through payroll (D-420), not here.
 *
 * Pure functions with decimal strings in and out: every figure comes from effective-dated settings
 * (`tax.pit_brackets`, `tax.wht_40_2.*`) read by the caller. Golden tests: `agent-wht.spec.ts`.
 */

const D = (v: string | number | MoneyValue) => new MoneyDecimal(v.toString());
const round2 = (v: MoneyValue) => v.toDecimalPlaces(2);
const money = (v: MoneyValue) => round2(v).toFixed(2);

/** One band of the personal income tax table: net income up to `upTo` (inclusive), `null` = above the last bound. */
export interface PitBracket {
  upTo: string | null;
  ratePct: string;
}

/** Seed of `tax.pit_brackets` (Revenue Code s.48(1), tax years from 2017). */
export const PIT_BRACKETS_SEED: readonly PitBracket[] = [
  { upTo: '150000.00', ratePct: '0' },
  { upTo: '300000.00', ratePct: '5' },
  { upTo: '500000.00', ratePct: '10' },
  { upTo: '750000.00', ratePct: '15' },
  { upTo: '1000000.00', ratePct: '20' },
  { upTo: '2000000.00', ratePct: '25' },
  { upTo: '5000000.00', ratePct: '30' },
  { upTo: null, ratePct: '35' },
];

/** Annual personal income tax on a net income (never negative). */
export function annualPit(net: string, brackets: readonly PitBracket[]): string {
  let remaining = D(net);
  if (remaining.lte(0)) return '0.00';
  let floor = D(0);
  let tax = D(0);
  for (const b of brackets) {
    const ceiling = b.upTo === null ? null : D(b.upTo);
    const width = ceiling === null ? remaining : MoneyDecimal.min(remaining, ceiling.sub(floor));
    if (width.lte(0)) break;
    tax = tax.add(width.mul(b.ratePct).div(100));
    remaining = remaining.sub(width);
    if (ceiling === null || remaining.lte(0)) break;
    floor = ceiling;
  }
  return money(tax);
}

export interface ProgressiveWhtInput {
  /** Commission paid to the agent this calendar year, this statement included. */
  ytdPaid: string;
  /** This statement's amount. */
  thisStatement: string;
  /** Whole months left in the calendar year after the payment month (December = 0: true-up). */
  remainingMonths: number;
  /** Withheld from the agent this calendar year before this statement. */
  whtWithheldYtd: string;
  /** `tax.wht_40_2.expense_rate` (0.50). */
  expenseRate: string;
  /** `tax.wht_40_2.expense_cap` (100000.00). */
  expenseCap: string;
  /** Personal allowance + the allowances of an accepted ล.ย.01. */
  allowances: string;
  brackets: readonly PitBracket[];
}

export interface ProgressiveWhtResult {
  projected: string;
  expense: string;
  net: string;
  annualTax: string;
  /** What to withhold from this statement. */
  whtNow: string;
}

/**
 * PLAN §5 steps 1–4:
 *   projected = YTD + thisStatement × remainingMonths
 *   net = projected − min(expenseRate × projected, expenseCap) − allowances
 *   whtNow = max(0, round2(annualTax(net) × YTD ÷ projected) − whtWithheldYTD)
 */
export function progressiveWht(input: ProgressiveWhtInput): ProgressiveWhtResult {
  if (!Number.isInteger(input.remainingMonths) || input.remainingMonths < 0 || input.remainingMonths > 11)
    throw new RangeError(`remainingMonths must be 0–11, got ${input.remainingMonths}`);
  const ytd = D(input.ytdPaid);
  const projected = ytd.add(D(input.thisStatement).mul(input.remainingMonths));
  if (projected.lte(0) || ytd.lte(0))
    return { projected: money(projected), expense: '0.00', net: '0.00', annualTax: '0.00', whtNow: '0.00' };
  const expense = MoneyDecimal.min(projected.mul(input.expenseRate), D(input.expenseCap));
  const netRaw = projected.sub(expense).sub(input.allowances);
  const net = netRaw.gt(0) ? netRaw : D(0);
  const annualTax = D(annualPit(money(net), input.brackets));
  const dueToDate = round2(annualTax.mul(ytd).div(projected));
  const whtNow = dueToDate.sub(input.whtWithheldYtd);
  return {
    projected: money(projected),
    expense: money(expense),
    net: money(net),
    annualTax: money(annualTax),
    whtNow: money(whtNow.gt(0) ? whtNow : D(0)),
  };
}

/** Months left in the year after the Bangkok month of the payment (1–12). */
export function remainingMonthsAfter(month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError(`month 1–12, got ${month}`);
  return 12 - month;
}

/** A juristic agent's service withholding (unchanged by D-465): `ratePct` when the payment is ≥ the threshold. */
export function juristicWht(net: string, ratePct: string, threshold = '1000.00'): string {
  const amount = D(net);
  if (amount.lt(threshold)) return '0.00';
  return money(amount.mul(ratePct).div(100));
}

/** The allowance groups of a ล.ย.01 (`SalesAgentTaxDeclaration.allowances`), summed with the personal allowance. */
export const DECLARATION_ALLOWANCE_KEYS = [
  'spouse',
  'children',
  'parents',
  'disabledDependants',
  'lifeInsurance',
  'healthInsurance',
  'parentsHealthInsurance',
  'pensionInsurance',
  'providentFund',
  'rmf',
  'ssf',
  'thaiEsg',
  'socialSecurity',
  'homeLoanInterest',
  'donations',
  'educationDonations',
] as const;
export type DeclarationAllowanceKey = (typeof DECLARATION_ALLOWANCE_KEYS)[number];

export function totalAllowances(
  personalAllowance: string,
  declared: Partial<Record<DeclarationAllowanceKey, string>> | null,
): string {
  let total = D(personalAllowance);
  for (const key of DECLARATION_ALLOWANCE_KEYS) {
    const v = declared?.[key];
    if (v) total = total.add(v);
  }
  return money(total);
}
