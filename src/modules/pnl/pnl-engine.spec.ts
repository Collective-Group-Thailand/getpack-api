import {
  breakEvenRevenue,
  cashConversionCycle,
  citByMonth,
  citOn,
  type CitRates,
  classMixCostRatio,
  computePlan,
  creditCostOf,
  D,
  daysInMonth,
  daysOf,
  fmt,
  monthsBefore,
  monthsFrom,
  repeatRunRate,
  smeEligible,
  spreadPipeline,
  trailingAverage,
  trailingRatio,
} from './pnl-engine';
import { CIT_RATES_SEED, type PnlLineKey } from './pnl-lines';

/** The seeded table (setting `tax.cit_rates`, D-472): SME 0 % to 300,000, 15 % to 3,000,000, 20 % above. */
const RATES: CitRates = {
  standardRatePct: '20.00',
  sme: {
    bands: [
      { upTo: '300000.00', ratePct: '0.00' },
      { upTo: '3000000.00', ratePct: '15.00' },
      { upTo: null, ratePct: '20.00' },
    ],
    paidUpCapitalMax: '5000000.00',
    revenueMax: '30000000.00',
  },
  paidUpCapital: null,
};
const SME: CitRates = { ...RATES, paidUpCapital: '1000000.00' };
const s = (v: Parameters<typeof D>[0] | null) => (v === null ? null : fmt(D(v)));

describe('corporate income tax estimate — GOLDEN (D-472)', () => {
  it.each([
    ['0.00', '0.00'],
    ['300000.00', '0.00'],
    ['300001.00', '0.15'],
    ['1000000.00', '105000.00'],
    ['3000000.00', '405000.00'],
    ['5000000.00', '805000.00'],
    ['-250000.00', '0.00'],
  ])('SME band on a profit of %s is %s', (profit, tax) => {
    expect(fmt(citOn(D(profit), SME, true))).toBe(tax);
  });

  it.each([
    ['1000000.00', '200000.00'],
    ['300000.00', '60000.00'],
    ['123456.78', '24691.36'],
    ['-1.00', '0.00'],
  ])('non-SME 20 %% on a profit of %s is %s', (profit, tax) => {
    expect(fmt(citOn(D(profit), RATES, false))).toBe(tax);
  });

  it('applies the SME bands only with a known paid-up capital within the limit and revenue within the limit', () => {
    expect(smeEligible(RATES, D('1000000'))).toBe(false);
    expect(smeEligible(SME, D('30000000.00'))).toBe(true);
    expect(smeEligible(SME, D('30000000.01'))).toBe(false);
    expect(smeEligible({ ...SME, paidUpCapital: '5000000.01' }, D('1000000'))).toBe(false);
  });

  it('estimates monthly on the cumulative profit, so the months add up to the tax on the year', () => {
    const months = citByMonth(['200000', '200000', '-100000', '500000'].map(D), SME, true).map(fmt);
    expect(months).toEqual(['0.00', '15000.00', '-15000.00', '75000.00']);
    const nonSme = citByMonth(['200000', '200000', '-100000', '500000'].map(D), RATES, false).map(fmt);
    expect(nonSme).toEqual(['40000.00', '40000.00', '-20000.00', '100000.00']);
    // Σ = tax(800,000) in both cases.
    expect(fmt(citOn(D('800000'), SME, true))).toBe('75000.00');
    expect(fmt(citOn(D('800000'), RATES, false))).toBe('160000.00');
  });

  it('keeps a loss year at zero tax', () => {
    expect(citByMonth(['-100000', '50000', '-10000'].map(D), RATES, false).map(fmt)).toEqual([
      '0.00',
      '0.00',
      '0.00',
    ]);
  });
});

describe('break-even, cash conversion cycle, EBITDA, credit cost — GOLDEN (D-472)', () => {
  it('break-even revenue = fixed costs ÷ (gross margin % − commission %)', () => {
    expect(s(breakEvenRevenue(D('300000'), D('1000000'), D('250000'), D('50000')))).toBe('1500000.00');
    // No positive contribution → no break-even.
    expect(breakEvenRevenue(D('300000'), D('1000000'), D('50000'), D('50000'))).toBeNull();
    expect(breakEvenRevenue(D('300000'), D('0'), D('0'), D('0'))).toBeNull();
  });

  it('DSO / DPO = average balance ÷ flow × days; CCC = DSO − DPO', () => {
    const dso = daysOf(D('500000'), D('1000000'), 30);
    const dpo = daysOf(D('400000'), D('800000'), 30);
    expect([s(dso), s(dpo), s(cashConversionCycle(dso, dpo))]).toEqual(['15.00', '15.00', '0.00']);
    const dso2 = daysOf(D('400000').add('600000').div(2), D('1500000'), 31);
    expect(s(dso2)).toBe('10.33');
    expect(s(cashConversionCycle(dso2, D('4.50')))).toBe('5.83');
    expect(daysOf(D('1'), D('0'), 30)).toBeNull();
    expect(cashConversionCycle(null, D('1'))).toBeNull();
  });

  it('credit cost = cash out × cost of capital × CCC ÷ 365; nothing when the cycle is not positive', () => {
    expect(s(creditCostOf(D('718000'), '7.00', D('10')))).toBe('1376.99');
    expect(s(creditCostOf(D('718000'), '7.00', D('-3')))).toBe('0.00');
    expect(creditCostOf(D('718000'), '7.00', null)).toBeNull();
  });

  it('counts days in a month by the calendar', () => {
    expect([daysInMonth('2027-02'), daysInMonth('2028-02'), daysInMonth('2027-12')]).toEqual([28, 29, 31]);
  });
});

describe('a full small plan — GOLDEN (D-472)', () => {
  const months = ['2027-01', '2027-02', '2027-03'];
  const each = (...v: (string | null)[]) => v.map((x) => (x === null ? null : D(x)));
  const values: Partial<Record<PnlLineKey, ReturnType<typeof each>>> = {
    revenue_goods: each('1000000', '1200000', '800000'),
    revenue_shipping: each('20000', '24000', '16000'),
    discounts: each('10000', '12000', '8000'),
    factory_cost: each('700000', '840000', '560000'),
    shipping_cost: each('18000', '21600', '14400'),
    payment_fees: each('5000', '6000', '4000'),
    agent_commission: each('30000', '36000', '24000'),
    employee_commission: each('10000', '12000', '8000'),
    marketing: each('20000', '20000', '20000'),
    salaries: each('100000', '100000', '100000'),
    rent_utilities: each('30000', '30000', '30000'),
    software_cloud: each('10000', '10000', '10000'),
    professional_fees: each('5000', '5000', '5000'),
    depreciation: each('2000', '2000', '2000'),
    other_opex: each('3000', '3000', '3000'),
    finance_cost: each('1000', '1000', '1000'),
    memo_dso: each('30.00', '25.00', '40.00'),
    memo_dpo: each('20.00', '20.00', '20.00'),
    memo_bad_debt: each('5000', '6000', null),
  };
  const plan = computePlan({ months, values, cit: RATES, costOfCapitalPct: '7.00' });
  const row = (key: PnlLineKey) => [...plan.months[key].map(s), s(plan.totals[key])];

  it('computes revenue, margin, EBIT and the non-SME tax', () => {
    expect(row('net_revenue')).toEqual(['1010000.00', '1212000.00', '808000.00', '3030000.00']);
    expect(row('gross_margin')).toEqual(['287000.00', '344400.00', '229600.00', '861000.00']);
    expect(row('ebit')).toEqual(['77000.00', '126400.00', '27600.00', '231000.00']);
    expect(row('cit_estimate')).toEqual(['15200.00', '25080.00', '5320.00', '45600.00']);
    expect(row('net_profit')).toEqual(['60800.00', '100320.00', '21280.00', '182400.00']);
    expect(plan.smeApplied).toBe(false);
  });

  it('computes the memo band', () => {
    expect(row('memo_ebitda')).toEqual(['79000.00', '128400.00', '29600.00', '237000.00']);
    expect(row('memo_commission_ratio')).toEqual(['13.94', '13.94', '13.94', '13.94']);
    expect(row('memo_ccc')).toEqual(['10.00', '5.00', '20.00', '10.67']);
    expect(row('memo_dso')).toEqual(['30.00', '25.00', '40.00', '30.67']);
    expect(row('memo_dpo')).toEqual(['20.00', '20.00', '20.00', '20.00']);
    expect(row('memo_credit_cost')).toEqual(['1376.99', '826.19', '2203.18', '4406.36']);
    expect(row('memo_break_even')).toEqual(['695141.70', '695141.70', '695141.70', '2085425.10']);
    expect(row('memo_bad_debt')).toEqual(['5000.00', '6000.00', null, '6000.00']);
  });

  it('applies the SME bands when the company qualifies (profit to date ≤ 300,000 → no tax)', () => {
    const sme = computePlan({ months, values, cit: SME, costOfCapitalPct: '7.00' });
    expect(sme.smeApplied).toBe(true);
    expect(sme.months.cit_estimate.map(s)).toEqual(['0.00', '0.00', '0.00']);
    expect(s(sme.totals.net_profit)).toBe('228000.00');
  });

  it('treats an empty manual line as 0 in sums and leaves ratios it cannot compute empty', () => {
    const partial = computePlan({
      months: ['2027-04'],
      values: { revenue_goods: [null], salaries: [null] },
      cit: RATES,
      costOfCapitalPct: '7.00',
    });
    expect(s(partial.months.net_revenue[0]!)).toBe('0.00');
    expect(partial.months.memo_commission_ratio[0]).toBeNull();
    expect(partial.months.memo_break_even[0]).toBeNull();
    expect(partial.months.memo_ccc[0]).toBeNull();
    expect(partial.totals.salaries).toBeNull();
  });
});

describe('forecast helpers (D-472)', () => {
  it('spreads the weighted pipeline over the horizon with commission at each agent plan’s rate', () => {
    const spread = spreadPipeline(
      [
        { value: '100000.00', stage: 'quoted', agentKind: 'freelance', ratePct: '5.0000' },
        { value: '300000.00', stage: 'negotiating', agentKind: 'employee', ratePct: '2.0000' },
        { value: '50000.00', stage: 'won', agentKind: 'freelance', ratePct: '5.0000' },
        { value: '90000.00', stage: 'new', agentKind: 'freelance', ratePct: null },
      ],
      { new: '10', contacted: '20', quoted: '40', negotiating: '60' },
      3,
    );
    // 40,000 + 180,000 + 9,000 = 229,000 over 3 months.
    expect(fmt(spread.weightedTotal)).toBe('229000.00');
    expect(fmt(spread.revenuePerMonth)).toBe('76333.33');
    expect(fmt(spread.agentCommissionPerMonth)).toBe('666.67');
    expect(fmt(spread.employeeCommissionPerMonth)).toBe('1200.00');
  });

  it('counts only repeat customers in the run rate', () => {
    const window = ['2027-01', '2027-02', '2027-03'];
    const rr = repeatRunRate(
      [
        { customerKey: 'c:1', month: '2027-01', amount: '30000' },
        { customerKey: 'c:1', month: '2027-03', amount: '30000' },
        { customerKey: 'c:2', month: '2027-02', amount: '90000' },
        { customerKey: 'u:9', month: '2026-12', amount: '10000' },
        { customerKey: 'u:9', month: '2027-01', amount: '10000' },
      ],
      window,
      2,
    );
    expect(fmt(rr.perMonth)).toBe('20000.00');
    expect(rr.customers).toEqual(['c:1']);
  });

  it('weights the cost ratio by the trailing product-class mix', () => {
    const mix = classMixCostRatio([
      { classKey: 'a', revenue: '600000', cost: '420000' },
      { classKey: 'b', revenue: '400000', cost: '320000' },
    ]);
    expect(fmt(mix.ratio)).toBe('0.74');
    expect(mix.byClass).toEqual([
      { classKey: 'a', mixPct: '60.00', costRatioPct: '70.00' },
      { classKey: 'b', mixPct: '40.00', costRatioPct: '80.00' },
    ]);
    expect(classMixCostRatio([]).ratio).toBeNull();
  });

  it('averages and ratios the trailing window, empty without data', () => {
    expect(fmt(trailingAverage(['10', '20', '33'].map(D), 4))).toBe('21.00');
    expect(trailingAverage([D(0), D(0), D(0)], 0)).toBeNull();
    expect(fmt(trailingRatio(['10', '20'].map(D), ['100', '200'].map(D)))).toBe('0.10');
    expect(trailingRatio([D(1)], [D(0)])).toBeNull();
  });

  it('walks months across years', () => {
    expect(monthsFrom('2026-11', 4)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(monthsBefore('2027-02', 3)).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});

describe('the seeded tax table (D-472)', () => {
  it('is the golden table of these tests', () => {
    expect(CIT_RATES_SEED).toEqual(RATES);
  });
});
