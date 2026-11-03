import { MoneyDecimal, type MoneyValue } from '@common/money/money';

import {
  classMixCostRatio,
  type ClassRevenueCost,
  type CustomerMonthRevenue,
  D,
  daysInMonth,
  daysOf,
  monthsBefore,
  monthsFrom,
  type PipelineLead,
  repeatRunRate,
  spreadPipeline,
  trailingAverage,
  trailingRatio,
} from './pnl-engine';
import {
  CREDIT_NORMAL_LINES,
  PNL_LINES,
  type PnlForecastRules,
  type PnlLineCatalogue,
  type PnlLineKey,
  TRAILING_AVERAGE_LINES,
} from './pnl-lines';

/**
 * D-472: the system's value of every `source` line and month of a plan year — actual months from the posted ledger,
 * forecast months from the pipeline, run rate, trailing ratios / averages and the fixed-asset register. Pure: the
 * data is read by `PnlDataService` into `AutoInputs`. A null value means "no system data" (the cell is manual).
 */

export type AutoSource =
  | 'gl'
  | 'pipeline_run_rate'
  | 'trailing_ratio'
  | 'trailing_average'
  | 'commission_rates'
  | 'fixed_assets'
  | 'balances'
  | 'formula'
  | 'none';

export interface AutoCell {
  value: MoneyValue | null;
  source: AutoSource;
  /** The inputs (accounts, window, ratios, counts) — never personal data. */
  sourceRef: Record<string, unknown> | null;
}

export interface MonthInfo {
  month: string;
  kind: 'actual' | 'forecast';
  /** An actual month whose fiscal period is not closed / locked ("ยังไม่ปิดงวด"), or the current month. */
  periodOpen: boolean;
  periodStatus: 'open' | 'soft_closed' | 'closed' | 'locked' | null;
}

export interface GlAmount {
  amount: MoneyValue;
  lines: number;
}

export interface Balance {
  opening: MoneyValue;
  closing: MoneyValue;
}

export interface AutoInputs {
  year: number;
  /** The current Asia/Bangkok month `YYYY-MM`. */
  currentMonth: string;
  periodStatus: ReadonlyMap<string, MonthInfo['periodStatus']>;
  catalogue: PnlLineCatalogue;
  rules: PnlForecastRules;
  /** `finance.bad_debt_provision_pct.byGrade.credit`; null = not set. */
  badDebtPct: string | null;
  /** Per mapped line: amount by month (normal side of the line) for the window and the actual months. */
  gl: ReadonlyMap<PnlLineKey, ReadonlyMap<string, GlAmount>>;
  customerRevenue: CustomerMonthRevenue[];
  classRows: ClassRevenueCost[];
  /** AR (memo_dso accounts, debit-normal) and factory AP (memo_dpo accounts, credit-normal) by month. */
  receivables: ReadonlyMap<string, Balance> | null;
  payables: ReadonlyMap<string, Balance> | null;
  pipeline: PipelineLead[];
  /** Forecast depreciation by month from the register. */
  depreciation: ReadonlyMap<string, MoneyValue>;
  assetCount: number;
}

export interface AutoResult {
  months: MonthInfo[];
  window: string[];
  cells: Map<PnlLineKey, AutoCell[]>;
}

const NONE: AutoCell = { value: null, source: 'none', sourceRef: null };
const ZERO = () => D(0);

export function yearMonths(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
}

export function monthInfos(
  year: number,
  currentMonth: string,
  status: ReadonlyMap<string, MonthInfo['periodStatus']>,
): MonthInfo[] {
  return yearMonths(year).map((month) => {
    const periodStatus = status.get(month) ?? null;
    const actual = month <= currentMonth;
    return {
      month,
      kind: actual ? 'actual' : 'forecast',
      periodOpen:
        actual &&
        (month === currentMonth ||
          periodStatus === null ||
          periodStatus === 'open' ||
          periodStatus === 'soft_closed'),
      periodStatus,
    };
  });
}

/** True when the line has at least one GL account in the catalogue in force. */
export function isMapped(catalogue: PnlLineCatalogue, key: PnlLineKey): boolean {
  return catalogue.lines[key].glAccounts.length > 0;
}

export function buildAutoCells(input: AutoInputs): AutoResult {
  const months = monthInfos(input.year, input.currentMonth, input.periodStatus);
  const window = monthsBefore(input.currentMonth, input.rules.trailingMonths);
  const cells = new Map<PnlLineKey, AutoCell[]>();
  const accounts = (key: PnlLineKey) => input.catalogue.lines[key].glAccounts.map((g) => g.code);
  const gl = (key: PnlLineKey, month: string): GlAmount | null =>
    isMapped(input.catalogue, key) ? (input.gl.get(key)?.get(month) ?? { amount: ZERO(), lines: 0 }) : null;
  const windowAmounts = (key: PnlLineKey) => window.map((m) => gl(key, m)?.amount ?? ZERO());
  const windowLines = (key: PnlLineKey) => window.reduce((a, m) => a + (gl(key, m)?.lines ?? 0), 0);

  // --- actual months: the ledger -------------------------------------------------------------------------------
  const actual = (key: PnlLineKey, month: string): AutoCell => {
    const amount = gl(key, month);
    if (!amount) return NONE;
    return {
      value: amount.amount,
      source: 'gl',
      sourceRef: { accounts: accounts(key), lines: amount.lines },
    };
  };

  // --- forecast inputs ---------------------------------------------------------------------------------------
  // The weighted pipeline lands in the months right after the current one (leads carry no expected close date).
  const horizon = new Set(monthsFrom(input.currentMonth, input.rules.pipelineHorizonMonths + 1).slice(1));
  const pipeline = spreadPipeline(
    input.pipeline,
    input.rules.stageProbabilityPct,
    input.rules.pipelineHorizonMonths,
  );
  const runRate = repeatRunRate(input.customerRevenue, window, input.rules.repeatMinMonths);
  const revenueGoodsMapped = isMapped(input.catalogue, 'revenue_goods');
  const revenueHasData = input.pipeline.length > 0 || windowLines('revenue_goods') > 0;
  const goodsForecast = (month: string): MoneyValue | null => {
    if (!revenueGoodsMapped || !revenueHasData) return null;
    const p = horizon.has(month) ? pipeline.revenuePerMonth : ZERO();
    return p.add(runRate.perMonth);
  };
  const ratioTo = (key: PnlLineKey, base: PnlLineKey[]) =>
    trailingRatio(
      windowAmounts(key),
      window.map((_, i) =>
        base.reduce(
          (a, b) => (b === 'discounts' ? a.sub(windowAmounts(b)[i]!) : a.add(windowAmounts(b)[i]!)),
          ZERO(),
        ),
      ),
    );
  const ratioCell = (key: PnlLineKey, baseValue: MoneyValue | null, base: PnlLineKey[]): AutoCell => {
    if (!isMapped(input.catalogue, key) || baseValue === null) return NONE;
    if (windowLines(key) === 0) return NONE;
    const ratio = ratioTo(key, base);
    if (ratio === null) return NONE;
    return {
      value: baseValue.mul(ratio),
      source: 'trailing_ratio',
      sourceRef: { base, ratioPct: ratio.mul(100).toDecimalPlaces(4).toFixed(4), window },
    };
  };
  const mix = classMixCostRatio(input.classRows);

  // --- memo balances ---------------------------------------------------------------------------------------------
  const netRevenueActual = (month: string) =>
    (gl('revenue_goods', month)?.amount ?? ZERO())
      .add(gl('revenue_shipping', month)?.amount ?? ZERO())
      .sub(gl('discounts', month)?.amount ?? ZERO());
  const costActual = (month: string) =>
    (gl('factory_cost', month)?.amount ?? ZERO()).add(gl('shipping_cost', month)?.amount ?? ZERO());
  const balanceDays = (
    balances: ReadonlyMap<string, Balance> | null,
    flow: (m: string) => MoneyValue,
    month: string,
  ): MoneyValue | null => {
    const b = balances?.get(month);
    if (!b) return null;
    return daysOf(b.opening.add(b.closing).div(2), flow(month), daysInMonth(month));
  };
  const dsoOf = (m: string) => balanceDays(input.receivables, netRevenueActual, m);
  const dpoOf = (m: string) => balanceDays(input.payables, costActual, m);
  const badDebtOf = (m: string): MoneyValue | null => {
    const b = input.receivables?.get(m);
    if (!b || input.badDebtPct === null) return null;
    return b.closing.mul(input.badDebtPct).div(100);
  };
  const trailingOf = (f: (m: string) => MoneyValue | null): MoneyValue | null => {
    const values = window.map(f).filter((v): v is MoneyValue => v !== null);
    return values.length === 0 ? null : values.reduce((a, v) => a.add(v), ZERO()).div(values.length);
  };

  // --- per line ------------------------------------------------------------------------------------------------
  for (const line of PNL_LINES) {
    if (line.calc !== 'source') continue;
    const key = line.key;
    const row: AutoCell[] = [];
    // Forecast values that depend on the forecast revenue of the same month.
    for (const info of months) {
      const m = info.month;
      if (key === 'memo_dso' || key === 'memo_dpo' || key === 'memo_bad_debt') {
        const balances = key === 'memo_dpo' ? input.payables : input.receivables;
        if (!balances || !isMapped(input.catalogue, key)) {
          row.push(NONE);
          continue;
        }
        if (key === 'memo_bad_debt' && input.badDebtPct === null) {
          row.push({
            value: null,
            source: 'none',
            sourceRef: { setting: 'finance.bad_debt_provision_pct', status: 'not_set' },
          });
          continue;
        }
        const f = key === 'memo_dso' ? dsoOf : key === 'memo_dpo' ? dpoOf : badDebtOf;
        const value = info.kind === 'actual' ? f(m) : trailingOf(f);
        row.push(
          value === null
            ? NONE
            : {
                value,
                source: info.kind === 'actual' ? 'balances' : 'trailing_average',
                sourceRef: { accounts: accounts(key), ...(info.kind === 'forecast' && { window }) },
              },
        );
        continue;
      }
      if (info.kind === 'actual') {
        row.push(actual(key, m));
        continue;
      }
      // Forecast months.
      const goods = goodsForecast(m);
      const shipping = ratioCell('revenue_shipping', goods, ['revenue_goods']).value;
      const discounts = ratioCell('discounts', goods, ['revenue_goods']).value;
      switch (key) {
        case 'revenue_goods':
          row.push(
            goods === null
              ? NONE
              : {
                  value: goods,
                  source: 'pipeline_run_rate',
                  sourceRef: {
                    pipelinePerMonth: (horizon.has(m) ? pipeline.revenuePerMonth : ZERO()).toFixed(2),
                    runRatePerMonth: runRate.perMonth.toFixed(2),
                    openLeads: input.pipeline.length,
                    repeatCustomers: runRate.customers.length,
                    horizonMonths: input.rules.pipelineHorizonMonths,
                    window,
                  },
                },
          );
          break;
        case 'revenue_shipping':
        case 'discounts':
          row.push(ratioCell(key, goods, ['revenue_goods']));
          break;
        case 'factory_cost':
          row.push(
            !isMapped(input.catalogue, key) || goods === null || mix.ratio === null
              ? NONE
              : {
                  value: goods.mul(mix.ratio),
                  source: 'trailing_ratio',
                  sourceRef: { base: ['revenue_goods'], byClass: mix.byClass, window },
                },
          );
          break;
        case 'shipping_cost':
          row.push(ratioCell(key, shipping, ['revenue_shipping']));
          break;
        case 'payment_fees': {
          const net = goods === null ? null : goods.add(shipping ?? ZERO()).sub(discounts ?? ZERO());
          row.push(ratioCell(key, net, ['revenue_goods', 'revenue_shipping', 'discounts']));
          break;
        }
        case 'agent_commission':
        case 'employee_commission': {
          if (!isMapped(input.catalogue, key) || goods === null) {
            row.push(NONE);
            break;
          }
          const fromPipeline = horizon.has(m)
            ? key === 'agent_commission'
              ? pipeline.agentCommissionPerMonth
              : pipeline.employeeCommissionPerMonth
            : ZERO();
          const ratio = windowLines(key) > 0 ? ratioTo(key, ['revenue_goods']) : null;
          row.push({
            value: fromPipeline.add(ratio === null ? ZERO() : runRate.perMonth.mul(ratio)),
            source: 'commission_rates',
            sourceRef: {
              pipelinePerMonth: fromPipeline.toFixed(2),
              runRateRatioPct: ratio === null ? null : ratio.mul(100).toDecimalPlaces(4).toFixed(4),
              window,
            },
          });
          break;
        }
        case 'depreciation':
          row.push({
            value: input.depreciation.get(m) ?? ZERO(),
            source: 'fixed_assets',
            sourceRef: { assets: input.assetCount },
          });
          break;
        default: {
          if (!TRAILING_AVERAGE_LINES.includes(key) || !isMapped(input.catalogue, key)) {
            row.push(NONE);
            break;
          }
          const avg = trailingAverage(windowAmounts(key), windowLines(key));
          row.push(
            avg === null
              ? NONE
              : { value: avg, source: 'trailing_average', sourceRef: { accounts: accounts(key), window } },
          );
        }
      }
    }
    cells.set(
      key,
      row.map((c) =>
        c.value === null ? c : { ...c, value: c.value.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP) },
      ),
    );
  }
  return { months, window, cells };
}

/** Amount of a mapped line from summed debit and credit: revenue credit − debit, everything else debit − credit. */
export function signedAmount(key: PnlLineKey, debit: MoneyValue, credit: MoneyValue): MoneyValue {
  return CREDIT_NORMAL_LINES.has(key) ? credit.sub(debit) : debit.sub(credit);
}
