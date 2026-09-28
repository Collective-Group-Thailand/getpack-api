/**
 * k-anonymity for the partner prospectus (D-102, D-044, D-160): every published figure must be backed by at least
 * k distinct contributors (customers — a company counts once — or factories for factory figures). A figure below
 * k is suppressed (primary). Each metric column is published with its total, so the hidden cells of a column could be
 * recovered together by subtraction: they must jointly reach k contributors, otherwise the next smallest cells are
 * hidden too (complementary suppression) — or the total, when nothing is left to hide. A total below k is hidden. Zero cells stay visible: "no demand"
 * identifies nobody.
 */

export interface Cell {
  /** Integer counts, or decimal strings for money. */
  value: number | string;
  /** Distinct contributors behind the value. */
  contributors: number;
}

export interface MetricColumn {
  key: string;
  labelTh: string;
  labelEn: string;
  kind: 'count' | 'money';
}

export interface ProspectusTable {
  key: string;
  titleTh: string;
  titleEn: string;
  /** Row label headers (e.g. product type, quantity band). */
  labels: { th: string; en: string }[];
  metrics: MetricColumn[];
  rows: { labels: string[]; cells: Cell[] }[];
  /** Per metric: the total over every row (computed on the raw data, with its own contributors). */
  totals: Cell[];
}

export interface PublishedTable extends Omit<ProspectusTable, 'rows' | 'totals'> {
  rows: { labels: string[]; values: (number | string | null)[] }[];
  totals: (number | string | null)[];
}

const isZero = (c: Cell) => Number(c.value) === 0 && c.contributors === 0;

export function suppress(table: ProspectusTable, k: number): { table: PublishedTable; suppressed: number } {
  if (!Number.isInteger(k) || k < 2) throw new Error(`k must be an integer ≥ 2 (got ${k})`);
  const hidden = table.rows.map((row) => row.cells.map((c) => !isZero(c) && c.contributors < k));
  const hiddenTotals = table.totals.map((t) => !isZero(t) && t.contributors < k);
  for (let m = 0; m < table.metrics.length; m++) {
    const column = table.rows.map((row, r) => ({ r, cell: row.cells[m]! }));
    const hiddenContributors = () =>
      column.filter(({ r }) => hidden[r]![m]).reduce((a, { cell }) => a + cell.contributors, 0);
    // Total − visible cells = the sum of the hidden ones: together they must still reach k contributors.
    while (column.some(({ r }) => hidden[r]![m]) && hiddenContributors() < k && !hiddenTotals[m]) {
      const candidate = column
        .filter(({ r, cell }) => !hidden[r]![m] && !isZero(cell))
        .sort(
          (a, b) => a.cell.contributors - b.cell.contributors || Number(a.cell.value) - Number(b.cell.value),
        )[0];
      if (candidate) hidden[candidate.r]![m] = true;
      else hiddenTotals[m] = true;
    }
  }
  const suppressed = hidden.flat().filter(Boolean).length + hiddenTotals.filter(Boolean).length;
  return {
    suppressed,
    table: {
      key: table.key,
      titleTh: table.titleTh,
      titleEn: table.titleEn,
      labels: table.labels,
      metrics: table.metrics,
      rows: table.rows.map((row, r) => ({
        labels: row.labels,
        values: row.cells.map((c, m) => (hidden[r]![m] ? null : c.value)),
      })),
      totals: table.totals.map((t, m) => (hiddenTotals[m] ? null : t.value)),
    },
  };
}
