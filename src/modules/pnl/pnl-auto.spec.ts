import { type AutoInputs, buildAutoCells, type GlAmount, monthInfos } from './pnl-auto';
import { D, fmt } from './pnl-engine';
import { PNL_FORECAST_RULES_SEED, PNL_LINE_CATALOGUE_SEED, type PnlLineKey } from './pnl-lines';

const g = (amount: string, lines = 1): GlAmount => ({ amount: D(amount), lines });

/** Current month March 2027: Jan / Feb actual and closed, March actual and open, April onwards forecast. */
function inputs(over: Partial<AutoInputs> = {}): AutoInputs {
  const gl = new Map<PnlLineKey, Map<string, GlAmount>>([
    [
      'revenue_goods',
      new Map([
        ['2026-12', g('900000')],
        ['2027-01', g('1000000')],
        ['2027-02', g('1100000')],
        ['2027-03', g('400000')],
      ]),
    ],
    [
      'revenue_shipping',
      new Map([
        ['2026-12', g('18000')],
        ['2027-01', g('20000')],
        ['2027-02', g('22000')],
      ]),
    ],
    ['discounts', new Map([['2027-01', g('30000')]])],
    [
      'factory_cost',
      new Map([
        ['2026-12', g('630000')],
        ['2027-01', g('700000')],
        ['2027-02', g('770000')],
      ]),
    ],
    [
      'shipping_cost',
      new Map([
        ['2026-12', g('15000')],
        ['2027-01', g('17000')],
        ['2027-02', g('19000')],
      ]),
    ],
    ['payment_fees', new Map([['2027-01', g('9000')]])],
    ['agent_commission', new Map([['2027-01', g('30000')]])],
    [
      'marketing',
      new Map([
        ['2026-12', g('10000')],
        ['2027-01', g('20000')],
        ['2027-02', g('33000')],
      ]),
    ],
    ['depreciation', new Map([['2027-01', g('2000')]])],
  ]);
  return {
    year: 2027,
    currentMonth: '2027-03',
    periodStatus: new Map([
      ['2027-01', 'closed'],
      ['2027-02', 'soft_closed'],
      ['2027-03', 'open'],
    ]),
    catalogue: PNL_LINE_CATALOGUE_SEED,
    rules: PNL_FORECAST_RULES_SEED,
    badDebtPct: '2.00',
    gl,
    customerRevenue: [
      { customerKey: 'c:1', month: '2026-12', amount: '300000' },
      { customerKey: 'c:1', month: '2027-02', amount: '300000' },
      { customerKey: 'c:2', month: '2027-01', amount: '900000' },
    ],
    classRows: [
      { classKey: 'mailer', revenue: '2000000', cost: '1400000' },
      { classKey: 'label', revenue: '1000000', cost: '700000' },
    ],
    receivables: new Map([
      ['2027-01', { opening: D('400000'), closing: D('600000') }],
      ['2027-02', { opening: D('600000'), closing: D('500000') }],
      ['2026-12', { opening: D('300000'), closing: D('400000') }],
    ]),
    payables: new Map([['2027-01', { opening: D('200000'), closing: D('300000') }]]),
    pipeline: [
      { value: '300000.00', stage: 'quoted', agentKind: 'freelance', ratePct: '5.0000' },
      { value: '100000.00', stage: 'new', agentKind: 'employee', ratePct: '3.0000' },
    ],
    depreciation: new Map([['2027-04', D('1500')]]),
    assetCount: 2,
    ...over,
  };
}

const at = (cells: ReturnType<typeof buildAutoCells>['cells'], key: PnlLineKey, month: number) =>
  cells.get(key)![month - 1]!;

describe('auto values of a plan year (D-472)', () => {
  const result = buildAutoCells(inputs());

  it('marks actual months, the open period ("ยังไม่ปิดงวด") and forecast months', () => {
    expect(result.months.slice(0, 4)).toEqual([
      { month: '2027-01', kind: 'actual', periodOpen: false, periodStatus: 'closed' },
      { month: '2027-02', kind: 'actual', periodOpen: true, periodStatus: 'soft_closed' },
      { month: '2027-03', kind: 'actual', periodOpen: true, periodStatus: 'open' },
      { month: '2027-04', kind: 'forecast', periodOpen: false, periodStatus: null },
    ]);
    expect(result.window).toEqual(['2026-12', '2027-01', '2027-02']);
    // A past month without a fiscal period is not final either.
    expect(monthInfos(2027, '2027-03', new Map())[0]!.periodOpen).toBe(true);
  });

  it('takes actual months from the ledger (0 when nothing posted), unmapped lines stay manual', () => {
    expect(at(result.cells, 'revenue_goods', 1)).toMatchObject({ source: 'gl' });
    expect(fmt(at(result.cells, 'revenue_goods', 3).value)).toBe('400000.00');
    expect(fmt(at(result.cells, 'discounts', 2).value)).toBe('0.00');
    expect(at(result.cells, 'salaries', 1)).toEqual({ value: null, source: 'none', sourceRef: null });
    expect(at(result.cells, 'finance_cost', 6)).toEqual({ value: null, source: 'none', sourceRef: null });
  });

  it('forecasts goods revenue from the weighted pipeline (next 3 months) and the repeat run rate', () => {
    // Pipeline 300,000 × 40 % + 100,000 × 10 % = 130,000 → 43,333.33 a month; run rate c:1 600,000 ÷ 3 = 200,000.
    expect(fmt(at(result.cells, 'revenue_goods', 4).value)).toBe('243333.33');
    expect(fmt(at(result.cells, 'revenue_goods', 6).value)).toBe('243333.33');
    expect(fmt(at(result.cells, 'revenue_goods', 7).value)).toBe('200000.00');
    expect(at(result.cells, 'revenue_goods', 4).sourceRef).toMatchObject({
      openLeads: 2,
      repeatCustomers: 1,
      pipelinePerMonth: '43333.33',
      runRatePerMonth: '200000.00',
    });
  });

  it('forecasts cost lines by trailing ratios and the product-class mix', () => {
    // Shipping 60,000 ÷ 3,000,000 = 2 % of 243,333.33.
    expect(fmt(at(result.cells, 'revenue_shipping', 4).value)).toBe('4866.67');
    // Factory cost ratio 70 % (both classes).
    expect(fmt(at(result.cells, 'factory_cost', 4).value)).toBe('170333.33');
    expect(at(result.cells, 'factory_cost', 4).sourceRef).toMatchObject({
      byClass: [
        { classKey: 'label', mixPct: '33.33', costRatioPct: '70.00' },
        { classKey: 'mailer', mixPct: '66.67', costRatioPct: '70.00' },
      ],
    });
    // Shipping cost 51,000 ÷ 60,000 of revenue shipping.
    expect(fmt(at(result.cells, 'shipping_cost', 4).value)).toBe('4136.67');
    expect(at(result.cells, 'payment_fees', 4).source).toBe('trailing_ratio');
  });

  it('forecasts commission at the plans’ rates on the pipeline plus the run rate at the trailing ratio', () => {
    // Agent: 120,000 × 5 % ÷ 3 = 2,000 + 200,000 × (30,000 ÷ 3,000,000) = 2,000 → 4,000.
    expect(fmt(at(result.cells, 'agent_commission', 4).value)).toBe('4000.00');
    expect(fmt(at(result.cells, 'agent_commission', 8).value)).toBe('2000.00');
    // Employee: 10,000 × 3 % ÷ 3 = 100; no trailing employee commission.
    expect(fmt(at(result.cells, 'employee_commission', 4).value)).toBe('100.00');
    expect(fmt(at(result.cells, 'employee_commission', 8).value)).toBe('0.00');
  });

  it('forecasts fixed costs as the trailing average and depreciation from the register', () => {
    expect(fmt(at(result.cells, 'marketing', 5).value)).toBe('21000.00');
    expect(at(result.cells, 'marketing', 5).source).toBe('trailing_average');
    expect(fmt(at(result.cells, 'other_opex', 5).value)).toBeNull();
    expect(at(result.cells, 'depreciation', 4)).toMatchObject({ source: 'fixed_assets' });
    expect(fmt(at(result.cells, 'depreciation', 4).value)).toBe('1500.00');
    expect(fmt(at(result.cells, 'depreciation', 5).value)).toBe('0.00');
  });

  it('computes DSO, DPO and the bad-debt provision from the balances', () => {
    // Jan: AR (400,000 + 600,000) ÷ 2 ÷ net (1,000,000 + 20,000 − 30,000) × 31.
    expect(fmt(at(result.cells, 'memo_dso', 1).value)).toBe('15.66');
    expect(fmt(at(result.cells, 'memo_dpo', 1).value)).toBe('10.81');
    expect(fmt(at(result.cells, 'memo_bad_debt', 1).value)).toBe('12000.00');
    expect(at(result.cells, 'memo_dso', 5).source).toBe('trailing_average');
    const unset = buildAutoCells(inputs({ badDebtPct: null }));
    expect(at(unset.cells, 'memo_bad_debt', 1)).toMatchObject({
      value: null,
      sourceRef: { status: 'not_set' },
    });
  });

  it('has no system data for revenue without history and without leads', () => {
    const empty = buildAutoCells(inputs({ gl: new Map(), pipeline: [], customerRevenue: [], classRows: [] }));
    expect(at(empty.cells, 'revenue_goods', 6).value).toBeNull();
    expect(at(empty.cells, 'factory_cost', 6).value).toBeNull();
    expect(at(empty.cells, 'marketing', 6).value).toBeNull();
    // Actual months of mapped lines are 0, not "no data": the ledger is the truth.
    expect(fmt(at(empty.cells, 'revenue_goods', 1).value)).toBe('0.00');
  });
});
