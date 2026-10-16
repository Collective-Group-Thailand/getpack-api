import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CORRUGATE_CALCULATOR_VERSION,
  corrugateCalculator,
  type CorrugateInput,
  type CorrugateOption,
  type CorrugateOptionResult,
} from '@modules/pricing/calculators/corrugate/corrugate-calculator';

/**
 * Golden corrugate cases (U-B6 slice 8). The inputs and the expected values are in
 * `test/golden/corrugate/golden.json`, written by `test/golden/corrugate/cases.py`: the expected values come from
 * the independent Python transcription of the PHP (`reference/calculate_reference.py` on the engine references),
 * not from this port. Every number must agree within 1e-6. `UPDATE_GOLDEN=1` rewrites
 * `docs/pricing-validation-corrugate.md` from the port's results; the expected values change only by rerunning
 * the Python.
 */

const DIR = join(__dirname, '..', 'golden', 'corrugate');
const DOC = join(__dirname, '..', '..', 'docs', 'pricing-validation-corrugate.md');
const TOLERANCE = 1e-6;
const update = process.env['UPDATE_GOLDEN'] === '1';

/**
 * The business sign-off of the validation doc (`test/golden/corrugate/sign-off.json`), tied to the calculator
 * version and the exact golden cases: a change to either makes it stale and fails this spec until it is signed
 * again (a signed price never changes silently).
 */
interface SignOff {
  calculatorVersion: string;
  goldenSha256: string;
  evidence: string;
  signatures: { role: string; name: string; date: string }[];
}
const SIGN_OFF = join(DIR, 'sign-off.json');
const signOff: SignOff | null = existsSync(SIGN_OFF)
  ? (JSON.parse(readFileSync(SIGN_OFF, 'utf8')) as SignOff)
  : null;
const goldenSha256 = createHash('sha256')
  .update(readFileSync(join(DIR, 'golden.json')))
  .digest('hex');
const signedOff =
  signOff !== null &&
  signOff.calculatorVersion === CORRUGATE_CALCULATOR_VERSION &&
  signOff.goldenSha256 === goldenSha256 &&
  ['Pricing owner', 'Finance'].every((role) => signOff.signatures.some((s) => s.role === role));

type JsonOption = Omit<CorrugateOption, 'inkColours'> & { inkColours: string[] };
interface GoldenCase {
  id: string;
  title: string;
  legacy: string[];
  input: CorrugateInput;
  options: JsonOption[];
  expect: Summary;
}

type Summary = ReturnType<typeof summarise>;

const errorText = (e: { code: string; detail: string } | null) => (e ? `${e.code}: ${e.detail}` : null);

function summarise(options: CorrugateOptionResult[]) {
  return options.map((o) => ({
    optionKey: o.optionKey,
    error: errorText(o.error),
    stepErrors: o.stepErrors.map(errorText),
    steps: o.steps.map((s) =>
      s
        ? {
            qty: s.qty,
            buyPrice: s.buyPrice,
            perPcs: s.perPcs,
            sum: s.sum,
            tooling: s.tooling,
            vatPrice: s.vatPrice,
            designFee: s.designFee,
            structureDesignFee: s.structureDesignFee,
            total: s.total,
            leadTimeDays: s.leadTimeDays,
            marginPct: s.marginPct,
            parts: s.parts.map((p) => ({
              partKey: p.partKey,
              rsc: p.rsc,
              dw: p.blank.dw,
              dl: p.blank.dl,
              layout:
                'rollWidthIn' in p.layout
                  ? {
                      rollWidthIn: p.layout.rollWidthIn,
                      sheets: p.layout.sheets,
                      dieSize: p.layout.dieSize,
                    }
                  : {
                      sheet: `${p.layout.sheetWIn}x${p.layout.sheetLIn}`,
                      sheets: p.layout.sheets,
                    },
              assemblyTotal: p.layout.assemblyTotal,
              buyPrice: p.buyPrice,
              plates: p.plates,
              dieBlock: p.dieBlock,
              platesSale: p.platesSale,
              dieBlockSale: p.dieBlockSale,
              perPcs: p.forSale.perPcs,
              sum: p.forSale.sum,
              vatPrice: p.forSale.vatPrice,
              total: p.forSale.total,
              targetMarginPct: p.forSale.targetMarginPct,
            })),
          }
        : null,
    ),
  }));
}

/** Refusals are compared by code: the Python names the part, the port says why. */
const code = (v: unknown) => (typeof v === 'string' ? v.split(':')[0] : v);

function compare(actual: unknown, expected: unknown, path: string, errors: string[]): void {
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (Math.abs(actual - expected) > TOLERANCE) errors.push(`${path}: ${actual} ≠ ${expected}`);
    return;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (actual.length !== expected.length)
      errors.push(`${path}: length ${actual.length} ≠ ${expected.length}`);
    expected.forEach((e, i) => compare(actual[i], e, `${path}[${i}]`, errors));
    return;
  }
  if (expected && typeof expected === 'object' && actual && typeof actual === 'object') {
    for (const [k, v] of Object.entries(expected)) {
      const a = (actual as Record<string, unknown>)[k];
      if (k === 'error' || path.endsWith('.stepErrors')) compare(code(a), code(v), `${path}.${k}`, errors);
      else compare(a, v, `${path}.${k}`, errors);
    }
    return;
  }
  if (code(actual) !== code(expected))
    errors.push(`${path}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);
}

const money = (n: number) => n.toFixed(2);

function renderDoc(results: { c: GoldenCase; s: Summary }[]): string {
  const lines: string[] = [
    '# Corrugate pricing — validation cases (U-B6)',
    '',
    (signedOff
      ? `> **Status: signed off** (${signOff.signatures.map((x) => `${x.role} ${x.date}`).join(', ')}).`
      : '> **Status: pending business sign-off.**') +
      ' Generated by `UPDATE_GOLDEN=1 pnpm test -- corrugate-golden` from',
    '> `test/golden/corrugate/golden.json`; do not edit by hand. Calculator version `' +
      CORRUGATE_CALCULATOR_VERSION +
      '`.',
    '',
    '## How these were derived and how to sign them off',
    '- No Locopack dump with calculator **outputs** exists (`test/fixtures/legacy/calculate_logs_*.sql` holds inputs only). The',
    '  expected values were therefore derived twice, independently, from the PHP: once by the TypeScript port and once by a',
    '  Python transcription that keeps the PHP statement order (`test/golden/corrugate/reference/*.py`: geometry, flexo RSC /',
    '  die-cut, digital, assemblies, packing, and the `calculate_cs` + `SaleMargin` orchestration). The two agree on every',
    '  number below within 1e-6 (`test/unit/corrugate-golden.spec.ts`); the unit tests pin each engine on its own vectors.',
    '- The 20 cases price complete, **made-up** price lists (no real supplier data, D-005). To sign off, the business team',
    '  enters the same rows for a test factory in a Locopack staging copy, runs the CS corrugate calculator (`/api/corrugate/',
    '  calculate_cs`) with the same configuration, and compares the per-piece price, plates, die block and total. Expect',
    '  sub-satang differences where Locopack stores prices as `FLOAT` (float32) and getpack as exact decimals.',
    '- Known, intended differences from Locopack (port map `docs/legacy/05-corrugate-port-map.md` §5): C1 fresh state per',
    '  calculation; C2 digital keeps the cheapest sheet size, not the first; C3 a missing row refuses the option instead of',
    '  pricing 0; C5 a coating on flexo is refused (legacy accepted it and never priced it); C6 legacy factory ids replaced by',
    '  terms (packing per box family, free packing on RSC, top + side formula, bulk lead time, digital flags); C8 the',
    '  automatic packing assembly on every part; C14 design fees once per quote; C17 an option is priced only when every part',
    '  is; C19 open NULL bounds. Shipping is its own quote line (D-013), so no delivery is included here. getpack additions',
    '  (D-042): the step buy price includes plates and die block; the step VAT includes the VAT inside plates and die block.',
    '',
    '| Business sign-off | Name | Date |',
    '|---|---|---|',
    ...['Pricing owner', 'Finance'].map((role) => {
      const x = signedOff ? signOff.signatures.find((y) => y.role === role) : undefined;
      return `| ${role} | ${x?.name ?? ''} | ${x?.date ?? ''} |`;
    }),
    ...(signedOff ? ['', `Evidence: ${signOff.evidence}`] : []),
    '',
  ];
  for (const { c, s } of results) {
    lines.push(`## ${c.id} — ${c.title}`, '', `Legacy: ${c.legacy.map((l) => '`' + l + '`').join(', ')}`, '');
    lines.push(
      '| Option | Qty | Parts (layout) | Buy price | Plates + die block (VAT incl.) | Per piece (VAT incl.) | Total (VAT incl.) | Lead time |',
      '|---|---|---|---|---|---|---|---|',
    );
    for (const o of s) {
      if (o.error) {
        lines.push(`| ${o.optionKey} | — | — | ${o.error} | — | — | — | — |`);
        continue;
      }
      o.steps.forEach((st, i) => {
        if (!st) {
          lines.push(
            `| ${o.optionKey} | ${c.input.quantities[i]} | ${o.stepErrors[i]} | — | — | — | — | — |`,
          );
          return;
        }
        const parts = st.parts
          .map((p) => {
            const l = p.layout as {
              rollWidthIn?: number;
              sheet?: string;
              sheets: number;
              dieSize?: string | null;
            };
            const how =
              l.rollWidthIn !== undefined
                ? `roll ${l.rollWidthIn}″${l.dieSize ? `, die ${l.dieSize}` : ''}`
                : `sheet ${l.sheet}`;
            return `${p.partKey}: ${p.rsc ? 'RSC' : 'die-cut'} ${money(p.dw)}×${money(p.dl)} mm, ${how}, ${l.sheets} sheets`;
          })
          .join('; ');
        lines.push(
          `| ${o.optionKey} | ${st.qty} | ${parts} | ${money(st.buyPrice)} | ${money(st.tooling)} | ${money(st.perPcs)} | ${money(st.total)} | ${st.leadTimeDays} d |`,
        );
      });
    }
    lines.push('', '<details><summary>Configuration and price rows</summary>', '', '```json');
    lines.push(JSON.stringify({ input: c.input, options: c.options }, null, 2));
    lines.push('```', '', '</details>', '');
  }
  return lines.join('\n');
}

describe('corrugate golden cases (U-B6)', () => {
  const cases = JSON.parse(readFileSync(join(DIR, 'golden.json'), 'utf8')) as GoldenCase[];
  const results = cases.map((c) => ({
    c,
    s: summarise(
      corrugateCalculator.calculate(c.input, {
        options: c.options.map((o) => ({ ...o, inkColours: new Set(o.inkColours) })),
      }).options,
    ),
  }));

  if (update) writeFileSync(DOC, renderDoc(results));

  it('keeps its sign-off current: re-sign after any change to the calculator version or the cases', () => {
    if (signOff === null) return; // not signed yet: the doc says pending
    expect({
      calculatorVersion: signOff.calculatorVersion,
      goldenSha256: signOff.goldenSha256,
    }).toEqual({ calculatorVersion: CORRUGATE_CALCULATOR_VERSION, goldenSha256 });
    expect(signedOff).toBe(true);
  });

  it('has 20 cases, each with at least one priced quantity', () => {
    expect(cases).toHaveLength(20);
    for (const { c, s } of results) {
      expect([c.id, s.some((o) => o.steps.some((st) => st !== null))]).toEqual([c.id, true]);
    }
  });

  it.each(results.map((r) => [r.c.id, r] as const))(
    '%s agrees with the Python transcription of the PHP within 1e-6',
    (_id, { c, s }) => {
      const errors: string[] = [];
      compare(s, c.expect, c.id, errors);
      expect(errors).toEqual([]);
    },
  );
});
