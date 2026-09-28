import fc from 'fast-check';

import { type Cell, type ProspectusTable, suppress } from './k-anonymity';

const table = (rows: Cell[][], totals: Cell[]): ProspectusTable => ({
  key: 't',
  titleTh: 'ท',
  titleEn: 'T',
  labels: [{ th: 'ป', en: 'P' }],
  metrics: rows[0]!.map((_, i) => ({
    key: `m${i}`,
    labelTh: `m${i}`,
    labelEn: `m${i}`,
    kind: 'count' as const,
  })),
  rows: rows.map((cells, i) => ({ labels: [`r${i}`], cells })),
  totals,
});
const c = (value: number, contributors: number): Cell => ({ value, contributors });

describe('prospectus k-anonymity (D-102, D-044, D-160)', () => {
  it('shows cells backed by at least k contributors and zero cells', () => {
    const { table: out, suppressed } = suppress(table([[c(10, 5)], [c(7, 3)], [c(0, 0)]], [c(17, 8)]), 3);
    expect(out.rows.map((r) => r.values[0])).toEqual([10, 7, 0]);
    expect(out.totals).toEqual([17]);
    expect(suppressed).toBe(0);
  });

  it('hides a small cell and enough others that the total cannot give it away', () => {
    const { table: out, suppressed } = suppress(table([[c(40, 9)], [c(12, 4)], [c(2, 1)]], [c(54, 14)]), 3);
    // r2 (1 contributor) is hidden; alone it would be total − visible, so r1 (the next smallest) is hidden too.
    expect(out.rows.map((r) => r.values[0])).toEqual([40, null, null]);
    expect(out.totals).toEqual([54]);
    expect(suppressed).toBe(2);
  });

  it('hides the total when nothing else can protect a small cell', () => {
    const { table: out } = suppress(table([[c(2, 1)]], [c(2, 1)]), 3);
    expect(out.rows[0]!.values).toEqual([null]);
    expect(out.totals).toEqual([null]);
  });

  it('suppresses per metric column', () => {
    const { table: out } = suppress(
      table(
        [
          [c(30, 6), c(1, 1)],
          [c(20, 4), c(9, 4)],
          [c(25, 5), c(8, 3)],
        ],
        [c(75, 15), c(18, 8)],
      ),
      3,
    );
    expect(out.rows.map((r) => r.values)).toEqual([
      [30, null],
      [20, 9],
      [25, null],
    ]);
  });

  it('refuses a k below 2', () => {
    expect(() => suppress(table([[c(1, 1)]], [c(1, 1)]), 1)).toThrow('k must be');
  });

  it('never publishes a group below k, alone or recoverable from the total (property)', () => {
    const cell = fc
      .integer({ min: 0, max: 8 })
      .map((contributors) => c(contributors === 0 ? 0 : contributors * 3, contributors));
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        fc.array(fc.array(cell, { minLength: 2, maxLength: 2 }), { minLength: 1, maxLength: 8 }),
        (k, rows) => {
          const totals = [0, 1].map((m) =>
            c(
              rows.reduce((a, r) => a + Number(r[m]!.value), 0),
              rows.reduce((a, r) => a + r[m]!.contributors, 0),
            ),
          );
          const { table: out } = suppress(table(rows, totals), k);
          for (let m = 0; m < 2; m++) {
            const visible = rows.filter((_, r) => out.rows[r]!.values[m] !== null);
            for (const v of visible) expect(v[m]!.contributors === 0 || v[m]!.contributors >= k).toBe(true);
            const hidden = rows.filter((_, r) => out.rows[r]!.values[m] === null);
            const hiddenContributors = hidden.reduce((a, r) => a + r[m]!.contributors, 0);
            // Whatever the total reveals about the hidden cells is backed by at least k contributors.
            if (hidden.length && out.totals[m] !== null) expect(hiddenContributors).toBeGreaterThanOrEqual(k);
            if (out.totals[m] !== null)
              expect(totals[m]!.contributors === 0 || totals[m]!.contributors >= k).toBe(true);
          }
        },
      ),
    );
  });
});
