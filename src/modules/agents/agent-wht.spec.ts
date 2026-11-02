import {
  annualPit,
  juristicWht,
  PIT_BRACKETS_SEED,
  progressiveWht,
  remainingMonthsAfter,
  totalAllowances,
} from './agent-wht';

/**
 * Golden tests for D-465 (PLAN §5). Expected figures were computed by an independent implementation
 * (Python `decimal`, ROUND_HALF_UP) from the same rules, not by this module.
 */
const SETTINGS = { expenseRate: '0.50', expenseCap: '100000.00', brackets: PIT_BRACKETS_SEED };

/** A 12-month schedule: a month with nothing paid (Feb, Sep), a refund month netted low (Jun), December true-up. */
const SCHEDULE: [month: number, amount: string][] = [
  [1, '40000.00'],
  [2, '0.00'],
  [3, '60000.00'],
  [4, '25000.00'],
  [5, '80000.00'],
  [6, '12500.50'],
  [7, '45000.00'],
  [8, '50000.00'],
  [9, '0.00'],
  [10, '70000.00'],
  [11, '35000.00'],
  [12, '55000.00'],
];

function runYear(allowances: string) {
  let ytd = 0n; // satang
  let withheld = 0n;
  const out: Record<number, string | null> = {};
  for (const [month, amount] of SCHEDULE) {
    const satang = BigInt(Math.round(Number(amount) * 100));
    if (satang === 0n) {
      out[month] = null; // no statement → nothing to withhold
      continue;
    }
    ytd += satang;
    const r = progressiveWht({
      ...SETTINGS,
      ytdPaid: (Number(ytd) / 100).toFixed(2),
      thisStatement: amount,
      remainingMonths: remainingMonthsAfter(month),
      whtWithheldYtd: (Number(withheld) / 100).toFixed(2),
      allowances,
    });
    out[month] = r.whtNow;
    withheld += BigInt(Math.round(Number(r.whtNow) * 100));
  }
  return { out, total: (Number(withheld) / 100).toFixed(2) };
}

describe('progressive withholding on agent commission (D-465)', () => {
  it('bracket table gives the annual tax of a net income', () => {
    expect(annualPit('150000.00', PIT_BRACKETS_SEED)).toBe('0.00');
    expect(annualPit('300000.00', PIT_BRACKETS_SEED)).toBe('7500.00');
    expect(annualPit('500000.00', PIT_BRACKETS_SEED)).toBe('27500.00');
    expect(annualPit('1000000.00', PIT_BRACKETS_SEED)).toBe('115000.00');
    expect(annualPit('6000000.00', PIT_BRACKETS_SEED)).toBe('1615000.00');
    expect(annualPit('-5.00', PIT_BRACKETS_SEED)).toBe('0.00');
  });

  it('12-month schedule with the personal allowance only', () => {
    const { out, total } = runYear('60000.00');
    expect(out).toEqual({
      1: '791.67',
      2: null,
      3: '3192.71',
      4: '0.00',
      5: '7605.49',
      6: '0.00',
      7: '0.00',
      8: '0.00',
      9: null,
      10: '0.00',
      11: '0.00',
      12: '0.00',
    });
    expect(total).toBe('11589.87');
  });

  it('12-month schedule with an accepted ล.ย.01 (spouse, life insurance, social security)', () => {
    const allowances = totalAllowances('60000.00', {
      spouse: '60000.00',
      lifeInsurance: '30000.00',
      socialSecurity: '25000.00',
    });
    expect(allowances).toBe('175000.00');
    const { out, total } = runYear(allowances);
    expect(out[1]).toBe('229.17');
    expect(out[3]).toBe('1958.33');
    expect(out[5]).toBe('4913.81');
    expect(out[12]).toBe('0.00');
    expect(total).toBe('7101.31');
  });

  it('December trues up on the actual year (projected = YTD)', () => {
    const r = progressiveWht({
      ...SETTINGS,
      ytdPaid: '472500.50',
      thisStatement: '55000.00',
      remainingMonths: 0,
      whtWithheldYtd: '0.00',
      allowances: '60000.00',
    });
    expect(r.projected).toBe('472500.50');
    expect(r.expense).toBe('100000.00');
    expect(r.net).toBe('312500.50');
    expect(r.annualTax).toBe('8750.05');
    expect(r.whtNow).toBe('8750.05');
  });

  it('never withholds below zero and nothing on an empty year', () => {
    expect(
      progressiveWht({
        ...SETTINGS,
        ytdPaid: '0.00',
        thisStatement: '0.00',
        remainingMonths: 5,
        whtWithheldYtd: '0.00',
        allowances: '60000.00',
      }).whtNow,
    ).toBe('0.00');
    expect(() => remainingMonthsAfter(13)).toThrow(RangeError);
  });

  it('juristic agent: 3 % only from ฿1,000.00', () => {
    expect(juristicWht('999.99', '3')).toBe('0.00');
    expect(juristicWht('1000.00', '3')).toBe('30.00');
    expect(juristicWht('56400.00', '3')).toBe('1692.00');
  });
});
