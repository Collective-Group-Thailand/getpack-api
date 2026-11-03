import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CHART_OF_ACCOUNTS } from '../../../prisma/seed/data/finance-accounts';
import {
  PNL_LINE_BY_KEY,
  PNL_LINE_CATALOGUE_SEED,
  PNL_LINE_KEYS,
  PNL_LINES,
  type PnlLineKey,
} from './pnl-lines';

/** PNL-LINES.md rows: key · label · definition · formula · source · how to fill · GL class. */
function pnlLinesMd(): Map<string, string[]> {
  const md = readFileSync(join(__dirname, '../../../docs/design/agent-portal/PNL-LINES.md'), 'utf8');
  const rows = new Map<string, string[]>();
  for (const line of md.split('\n')) {
    if (!line.startsWith('| ') || line.startsWith('| key')) continue;
    const cells = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());
    if (cells.length === 7 && !cells[0]!.startsWith('---')) rows.set(cells[0]!, cells);
  }
  return rows;
}

/** The one documented difference: the planner says how it aggregates the credit cost (D-472). */
const SOURCE_DIFFERS: ReadonlySet<PnlLineKey> = new Set(['memo_credit_cost']);
/** Editable lines the system always fills (the fixed-asset register): no "how to fill" in PNL-LINES.md. */
const NO_HOW_TO_FILL: ReadonlySet<PnlLineKey> = new Set(['depreciation']);

describe('P&L line catalogue (D-472, PNL-LINES.md)', () => {
  it('has every line once, in the order of PNL-LINES.md', () => {
    expect(PNL_LINES.map((l) => l.key)).toEqual([...PNL_LINE_KEYS]);
    expect([...pnlLinesMd().keys()]).toEqual([...PNL_LINE_KEYS]);
  });

  it('gives every line key a label, definition, formula, source, how-to-fill (when a person enters it) and GL accounts', () => {
    for (const key of PNL_LINE_KEYS) {
      const entry = PNL_LINE_CATALOGUE_SEED.lines[key];
      const def = PNL_LINE_BY_KEY.get(key)!;
      expect([key, entry.labelTh.length > 0, entry.labelEn.length > 0]).toEqual([key, true, true]);
      for (const field of ['definition', 'formula', 'source'] as const)
        expect([key, field, entry[field].th.trim().length > 0, 'en' in entry[field]]).toEqual([
          key,
          field,
          true,
          true,
        ]);
      expect(Array.isArray(entry.glAccounts)).toBe(true);
      const needsHowToFill = def.editable && !NO_HOW_TO_FILL.has(key);
      expect([key, entry.howToFill !== null]).toEqual([key, needsHowToFill]);
      if (entry.howToFill) expect(entry.howToFill.th.trim().length).toBeGreaterThan(0);
    }
  });

  it('keeps the seeded texts in step with PNL-LINES.md', () => {
    const md = pnlLinesMd();
    for (const key of PNL_LINE_KEYS) {
      const [, label, definition, formula, source, howToFill] = md.get(key)!;
      const entry = PNL_LINE_CATALOGUE_SEED.lines[key];
      expect([key, entry.labelTh, entry.definition.th, entry.formula.th]).toEqual([
        key,
        label,
        definition,
        formula,
      ]);
      if (!SOURCE_DIFFERS.has(key)) expect([key, entry.source.th]).toEqual([key, source]);
      expect([key, entry.howToFill?.th ?? '—']).toEqual([key, howToFill]);
    }
  });

  it('maps only postable accounts of the seeded chart, each at most once per line; unmapped lines are the ones recorded', () => {
    const postable = new Set(CHART_OF_ACCOUNTS.filter((a) => a.postable !== false).map((a) => a.code));
    const unmapped: string[] = [];
    for (const key of PNL_LINE_KEYS) {
      const def = PNL_LINE_BY_KEY.get(key)!;
      const codes = PNL_LINE_CATALOGUE_SEED.lines[key].glAccounts.map((g) => g.code);
      for (const code of codes) expect([key, code, postable.has(code)]).toEqual([key, code, true]);
      if (def.calc === 'source' && codes.length === 0) unmapped.push(key);
      if (def.calc === 'formula') expect([key, codes]).toEqual([key, []]);
    }
    expect(unmapped).toEqual([
      'salaries',
      'rent_utilities',
      'software_cloud',
      'professional_fees',
      'finance_cost',
    ]);
  });

  it('splits account 6160 between agents and the employee accrual (AG01) without overlap', () => {
    expect(PNL_LINE_CATALOGUE_SEED.lines.agent_commission.glAccounts).toEqual([
      { code: '6160', excludeRules: ['AG01'] },
    ]);
    expect(PNL_LINE_CATALOGUE_SEED.lines.employee_commission.glAccounts).toEqual([
      { code: '6160', onlyRules: ['AG01'] },
    ]);
  });

  it('never maps one account to two P&L lines (memo balance lines aside)', () => {
    const seen = new Map<string, string>();
    for (const l of PNL_LINES.filter((x) => x.inTotal))
      for (const g of PNL_LINE_CATALOGUE_SEED.lines[l.key].glAccounts) {
        const id = `${g.code}|${(g.onlyRules ?? []).join()}|${(g.excludeRules ?? []).join()}`;
        expect([id, seen.get(id) ?? l.key]).toEqual([id, l.key]);
        seen.set(id, l.key);
      }
  });

  it('keeps memo lines out of the total and formula / memo lines read-only', () => {
    for (const l of PNL_LINES) {
      expect([l.key, l.inTotal]).toEqual([l.key, l.group !== 'memo']);
      if (l.calc === 'formula' || l.group === 'memo') expect([l.key, l.editable]).toEqual([l.key, false]);
    }
  });
});
