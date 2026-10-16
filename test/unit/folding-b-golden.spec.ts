import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type BPricedLayout, priceBLayout, sortBLayouts } from '@modules/pricing/calculators/folding/b/cost';
import { type BTables } from '@modules/pricing/calculators/folding/b/tables';
import { bLayoutWaste } from '@modules/pricing/calculators/folding/b/waste';
import { FOLDING_CALCULATOR_VERSION } from '@modules/pricing/calculators/folding/folding-calculator';
import { type LayoutCandidate } from '@modules/pricing/calculators/folding/geometry/types';
import { type PartRequest, PricingError } from '@modules/pricing/calculators/folding/request';

/**
 * Golden folding engine B cases (U-B6 tail, D-233). The inputs and the expected priced copies are in
 * `test/golden/folding-b/golden.json`, written by `test/golden/folding-b/cases.py`: the expected values come from the
 * independent Python transcription of the PHP (`reference/folding_b_reference.py`), not from this port. Every number
 * must agree within 1e-6. Folding geometry (the layout candidates) is engine A's, golden-tested in B2.3, so each case
 * starts from the candidates of one quantity step. `UPDATE_GOLDEN=1` rewrites `docs/pricing-validation-folding-b.md`.
 */

const DIR = join(__dirname, '..', 'golden', 'folding-b');
const DOC = join(__dirname, '..', '..', 'docs', 'pricing-validation-folding-b.md');
const TOLERANCE = 1e-6;
const update = process.env['UPDATE_GOLDEN'] === '1';

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
  signOff.calculatorVersion === FOLDING_CALCULATOR_VERSION &&
  signOff.goldenSha256 === goldenSha256 &&
  ['Pricing owner', 'Finance'].every((role) => signOff.signatures.some((s) => s.role === role));

interface GoldenCase {
  key: string;
  title: string;
  part: PartRequest;
  layouts: Record<string, unknown>[];
  tables: BTables;
  expected: { error: string } | { copies: Record<string, unknown>[] };
}

type Copy = ReturnType<typeof summarise>;

function summarise(p: BPricedLayout, layoutIndex: number) {
  return {
    layoutIndex,
    plateWMax: p.printPlate?.wMax ?? 0,
    blockMaxW: p.diecut?.blockMaxW ?? 0,
    totalSheets: p.waste.totalSheets,
    costPaperSize: p.waste.costPaperSize,
    printFront: p.printFront?.totalCost ?? null,
    printBack: p.printBack?.totalCost ?? null,
    diecut: p.diecut?.totalCost ?? null,
    finish1Front: p.finish1Front?.totalCost ?? 0,
    finish1Back: p.finish1Back?.totalCost ?? 0,
    finish2: p.finish2.map((f) => f.totalCost),
    foil: p.foil.map((f) => ({
      axis: f.axis,
      md: f.area.md.areaM2,
      cd: f.area.cd.areaM2,
      total: f.totalCost,
    })),
    assembly: p.assembly.map((a) => a.totalCost),
    totalCost: p.totalCost,
    contribution: p.margin.contribution,
    maxCont: p.margin.maxCont,
    salePrice: p.margin.salePrice,
    suggestPrice: p.margin.suggestPrice,
  };
}

function run(c: GoldenCase): { error: string } | { copies: Copy[] } {
  try {
    const all: { p: BPricedLayout; i: number }[] = [];
    c.layouts.forEach((raw, i) => {
      const layout = raw as unknown as LayoutCandidate;
      const waste = bLayoutWaste(c.part, layout, c.tables);
      for (const p of priceBLayout(c.part, layout, waste, c.tables)) all.push({ p, i });
    });
    const index = new Map(all.map((x) => [x.p, x.i]));
    return { copies: sortBLayouts(all.map((x) => x.p)).map((p) => summarise(p, index.get(p)!)) };
  } catch (error) {
    if (error instanceof PricingError) return { error: error.code };
    throw error;
  }
}

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
      if (k in (actual as Record<string, unknown>)) {
        compare((actual as Record<string, unknown>)[k], v, `${path}.${k}`, errors);
      }
    }
    return;
  }
  if (actual !== expected) errors.push(`${path}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);
}

const money = (n: number | null) => (n === null ? '—' : n.toFixed(2));

function renderDoc(results: { c: GoldenCase; r: ReturnType<typeof run> }[]): string {
  const lines: string[] = [
    '# Folding engine B pricing — validation cases (U-B6 tail)',
    '',
    (signedOff
      ? `> **Status: signed off** (${signOff.signatures.map((x) => `${x.role} ${x.date}`).join(', ')}).`
      : '> **Status: pending business sign-off.** Engine B stays off (`pricing.folding_engine_b`) until it is signed.') +
      ' Generated by `UPDATE_GOLDEN=1` from `test/golden/folding-b/golden.json`; do not edit by hand. Calculator version `' +
      FOLDING_CALCULATOR_VERSION +
      '`.',
    '',
    '## How these were derived and how to sign them off',
    '- Legacy engine B (`B/CalculateWaste`, `B/CalculateCost`, `Object/Foil`) was never reachable from a live Locopack',
    '  screen (port map `docs/legacy/05-folding-b-port-map.md` §1), and no Locopack dump holds calculator outputs. The',
    '  expected values were therefore derived twice, independently, from the PHP: by the TypeScript port and by a Python',
    '  transcription that keeps the PHP statement order (`test/golden/folding-b/reference/folding_b_reference.py`). The',
    '  two agree on every number below within 1e-6 (`test/unit/folding-b-golden.spec.ts`).',
    "- Each case prices the layout candidates of one quantity step (the folding geometry is engine A's, validated in",
    '  `docs/pricing-validation-folding.md`) on a complete, **made-up** B price list (no real supplier data, D-005). The',
    "  figures are the factory side: the cost build-up and the factory price (buy price) of the lot. getpack's sell side is",
    "  engine A's, unchanged. To sign off, the Pricing owner enters the same rows for a type-B test factory on a Locopack",
    '  staging copy and posts the same request to `POST /api/folding/calculate` (the only route that reaches B), with',
    '  `marginComputeId` 2 at the factory margin, then compares the total cost and the suggested price per piece.',
    '- **What a customer configuration feeds B (D-233):** colour amount = number of colours; **no semi-tone (จุดกึ่ง)',
    '  plates or waste** — a job that needs semi-tones would cost more in legacy, so the Pricing owner confirms whether that',
    '  is acceptable; automatic foil axis; no sorting, packing or delivery (delivery is its own quote line, D-013); one foil',
    "  location at the blank's origin (positions do not change the cost of one location); a foil with 2+ locations is",
    '  refused.',
    '- **Known, intended differences from Locopack** (port map §7): a missing price, plate, die-cut, foil or code-margin',
    '  line refuses the option instead of pricing the process at 0 or failing (QB3, QB9–QB11, QB14, QB21, QB26); the first',
    '  line in price-list order where legacy read an unordered `[0]` (QB5); finish-2 waste kept by position (QB12); every',
    '  foil block must take the sheet (QB15); totals computed per layout (QB24); unequal finish-2 location sizes are summed.',
    '  **Kept as legacy, for the business to note:** the finish-1 back block price is flat while the front one is per in²',
    '  (QB16); the finish-2 material and block prices are flat, not per in² (QB17); assembly types 3 and 4 are the same.',
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
  for (const { c, r } of results) {
    lines.push(`## ${c.key} — ${c.title}`, '');
    if ('error' in r) {
      lines.push(`No price: \`${r.error}\`.`, '');
    } else if (r.copies.length === 0) {
      lines.push('No layout can be priced (the configuration has no instant price on this option).', '');
    } else {
      lines.push(
        '| # | Layout | Plate ≤ w″ | Block ≤ w″ | Sheets | Paper | Print F | Print B | Die-cut | F1 F | F1 B | F2 | Foil (axis) | Assembly | Total cost | Factory price | Per piece |',
        '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
      );
      r.copies.forEach((x, i) => {
        const foil = x.foil.map((f) => `${money(f.total)} (${f.axis})`).join(', ') || '—';
        lines.push(
          `| ${i + 1} | ${x.layoutIndex + 1} | ${x.plateWMax || '—'} | ${x.blockMaxW || '—'} | ${x.totalSheets} | ${money(x.costPaperSize)} | ${money(x.printFront)} | ${money(x.printBack)} | ${money(x.diecut)} | ${money(x.finish1Front)} | ${money(x.finish1Back)} | ${x.finish2.map(money).join(', ') || '—'} | ${foil} | ${x.assembly.map(money).join(', ') || '—'} | ${money(x.totalCost)} | ${money(x.salePrice)} | ${x.suggestPrice} |`,
        );
      });
      lines.push('');
    }
    lines.push('<details><summary>Request, layouts and price rows</summary>', '', '```json');
    lines.push(JSON.stringify({ part: c.part, layouts: c.layouts, tables: c.tables }, null, 2));
    lines.push('```', '', '</details>', '');
  }
  return lines.join('\n');
}

describe('folding engine B golden cases (U-B6 tail)', () => {
  const cases = JSON.parse(readFileSync(join(DIR, 'golden.json'), 'utf8')) as GoldenCase[];
  const results = cases.map((c) => ({ c, r: run(c) }));

  if (update) writeFileSync(DOC, renderDoc(results));

  it('keeps its sign-off current: re-sign after any change to the calculator version or the cases', () => {
    if (signOff === null) return; // not signed yet: the doc says pending
    expect({ calculatorVersion: signOff.calculatorVersion, goldenSha256: signOff.goldenSha256 }).toEqual({
      calculatorVersion: FOLDING_CALCULATOR_VERSION,
      goldenSha256,
    });
    expect(signedOff).toBe(true);
  });

  it('has 20 cases: one refused, one without a layout, the rest priced', () => {
    expect(cases).toHaveLength(20);
    expect(results.filter(({ r }) => 'error' in r).map(({ c }) => c.key)).toEqual(['20-foil-two-locations']);
    expect(results.filter(({ r }) => 'copies' in r && r.copies.length === 0).map(({ c }) => c.key)).toEqual([
      '16-foil-block-misses',
    ]);
  });

  it.each(cases.map((c) => [c.key, c] as const))(
    '%s agrees with the Python transcription of the PHP',
    (_k, c) => {
      const errors: string[] = [];
      compare(run(c), c.expected, c.key, errors);
      expect(errors).toEqual([]);
    },
  );
});
