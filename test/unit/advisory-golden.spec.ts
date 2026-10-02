import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseRuleSet } from '@modules/advisory/rule-set';
import {
  ADVISOR_ENGINE_VERSION,
  type AdvisoryLoadInputs,
  type BoxGeometry,
  type CandidateBoard,
  evaluate,
} from '@modules/advisory/structure-engine';
import { type AdvisoryRuleSet } from '@platform/settings/setting-keys';

import { DEV_ADVISORY_RULE_SET } from '../../prisma/seed/dev-advisory';

/**
 * Golden Structure Advisor cases (U2.2, D-189). Inputs and expected values are in `test/golden/advisory/golden.json`,
 * written by `test/golden/advisory/cases.py` — an independent transcription of the D-239 rule, not of this port — on
 * the literature-based rule-set **proposal** and made-up boards. Figures must agree within 0.1 (they are rounded to
 * 0.1 N / 0.1 %). `UPDATE_GOLDEN=1` (with `--testPathPatterns advisory-golden`) rewrites `docs/advisory-validation.md`
 * from the port's results. The advisor opens to customers only once the Partner Manager and Prepress sign
 * (`test/golden/advisory/sign-off.json`) and a Superadmin sets the rule set and the flag (D-237).
 */

const DIR = join(__dirname, '..', 'golden', 'advisory');
const DOC = join(__dirname, '..', '..', 'docs', 'advisory-validation.md');
const update = process.env['UPDATE_GOLDEN'] === '1';

interface GoldenCase {
  key: string;
  title: string;
  inputs: AdvisoryLoadInputs;
  boards: CandidateBoard[];
  box: BoxGeometry;
  expected: {
    outcome: string;
    recommendedMaterialId: string | null;
    closestMaterialId: string | null;
    boxWeightKg: number;
    loadN: number;
    combinedFactor: number;
    requiredBctN: number;
    leadLowN: number;
    leadHighN: number;
    leadMarginPct: number | null;
    warnings: string[];
    passing: string[];
    excluded: string[];
  };
}

const golden = JSON.parse(readFileSync(join(DIR, 'golden.json'), 'utf8')) as {
  ruleSet: AdvisoryRuleSet;
  cases: GoldenCase[];
};
const goldenSha256 = createHash('sha256')
  .update(readFileSync(join(DIR, 'golden.json')))
  .digest('hex');
const SIGN_OFF = join(DIR, 'sign-off.json');
const signOff = existsSync(SIGN_OFF)
  ? (JSON.parse(readFileSync(SIGN_OFF, 'utf8')) as {
      engineVersion: string;
      goldenSha256: string;
      signatures: { role: string; name: string; date: string }[];
    })
  : null;
const signedOff =
  signOff !== null &&
  signOff.engineVersion === ADVISOR_ENGINE_VERSION &&
  signOff.goldenSha256 === goldenSha256 &&
  ['Partner Manager', 'Prepress'].every((role) => signOff.signatures.some((s) => s.role === role));

const rules = parseRuleSet(golden.ruleSet);
const near = (a: number | null, b: number | null) =>
  a === null || b === null ? a === b : Math.abs(a - b) <= 0.1 + 1e-9;

describe('Structure Advisor golden cases (U2.2, D-189)', () => {
  const results = golden.cases.map((c) => ({ c, out: evaluate(c.inputs, c.box, c.boards, rules) }));

  it.each(golden.cases.map((c) => [c.key, c] as const))('%s', (_key, c) => {
    const out = evaluate(c.inputs, c.box, c.boards, rules);
    const e = c.expected;
    expect(out.outcome).toBe(e.outcome);
    expect(out.recommendedMaterialId).toBe(e.recommendedMaterialId);
    expect(out.closestMaterialId).toBe(e.closestMaterialId);
    expect(out.warnings).toEqual(e.warnings);
    expect(out.options.filter((o) => o.passes).map((o) => o.materialId)).toEqual(e.passing);
    expect(out.excluded.map((x) => x.materialId)).toEqual(e.excluded);
    const lead = out.options.find((o) => o.materialId === (e.recommendedMaterialId ?? e.closestMaterialId))!;
    for (const [got, want] of [
      [out.requirement.boxWeightKg, e.boxWeightKg],
      [out.requirement.loadN, e.loadN],
      [out.requirement.combinedFactor, e.combinedFactor],
      [out.requirement.requiredBctN, e.requiredBctN],
      [lead.bctN.low, e.leadLowN],
      [lead.bctN.high, e.leadHighN],
      [lead.marginPct, e.leadMarginPct],
    ] as const) {
      expect(near(got, want)).toBe(true);
    }
  });

  it('uses the same rule-set proposal as the dev seed', () => {
    expect(golden.ruleSet).toEqual(DEV_ADVISORY_RULE_SET);
  });

  it('writes docs/advisory-validation.md from the port (UPDATE_GOLDEN=1) and keeps it current', () => {
    const doc = render(results, signedOff);
    if (update) writeFileSync(DOC, doc);
    expect(readFileSync(DOC, 'utf8')).toBe(doc);
  });
});

function render(results: { c: GoldenCase; out: ReturnType<typeof evaluate> }[], signed: boolean): string {
  const rs = golden.ruleSet;
  const f = rs.factors;
  const table = (name: string, rows: Record<string, string>, source: string) =>
    `| ${name} | ${Object.entries(rows)
      .map(([k, v]) => `${k} ${v}`)
      .join(' · ')} | ${source} |`;
  const lines = [
    '# Structure Advisor — validation cases (U2.2)',
    '',
    `> **Status: ${signed ? 'signed' : 'pending business sign-off'}.** The advisor stays off for customers (flag \`advisory.structure_advisor\`) and \`advisory.rule_set\` stays unset in production until the Partner Manager and Prepress sign (D-189, D-237). Generated by \`UPDATE_GOLDEN=1\` from \`test/golden/advisory/golden.json\`; do not edit by hand. Engine version \`${ADVISOR_ENGINE_VERSION}\`.`,
    '',
    '## Method (D-239)',
    '- Load on the bottom box = (boxes high − 1) × box gross weight × 9.80665; box gross weight = units × unit weight + tare; tare = the ported corrugate blank area × the grammage of the **heaviest** candidate board (one requirement for every board).',
    '- Required BCT = load ÷ the product of the retained-strength factors below.',
    '- Estimated BCT = simplified McKee, k × ECT [kN/m] × √(caliper [mm] × inside perimeter [mm]) in newtons, shown ± the uncertainty band; a board **passes** when the low end ≥ the requirement.',
    '- Recommended = the cheapest passing board with an instant price (tie → stronger); without one, the weakest passing board (routes to CS); none passing → no recommendation, the strongest board is the closest. Alternatives: cheapest, strongest, fastest. Warnings: `no_board_meets_load`, `thin_margin` (margin below the threshold), `below_requirement`.',
    '- Board strength comes only from the partners’ signed data sheets (D-188, D-236); a board without one is never recommended.',
    '',
    '## Proposed rule set (to confirm — not a production value)',
    'Retained compression strength under each condition, from the classic packaging-engineering tables; **the signers confirm or replace every value**. Where no table exists the value is engineering judgement and says so.',
    '',
    `McKee constant k = **${rs.mckeeConstant}** (McKee, Gander & Wachuta 1963, simplified form in SI units) · uncertainty **± ${rs.uncertaintyPct} %** (the simplified relation is usually quoted within ± 10–20 % for regular slotted boxes) · thin margin below **${rs.thinMarginPct} %** · styles: ${rs.formulas.map((x) => `\`${x}\``).join(', ')} (D-235).`,
    '',
    '| Factor | Bands → retained strength | Source |',
    '|---|---|---|',
    table(
      'Humidity',
      f.humidity,
      'RH ≤ 50 % 1.00, 60 % 0.90, 70 % 0.80, 80 % 0.68, 90 % 0.50 (Kellicutt); each band takes its upper end',
    ),
    table(
      'Storage time',
      f.storage,
      'Under constant load: 10 days 0.63, 30 days 0.60, 90 days 0.55, 180 days 0.50 (Kellicutt)',
    ),
    table(
      'Pallet pattern',
      f.palletPattern,
      'Column aligned 0.9–1.0, interlocked 0.5–0.6 (published ranges); not palletised: judgement',
    ),
    table('Pallet overhang', f.palletOverhang, 'About 25 mm overhang loses 20–40 % (published ranges)'),
    table('Transport', f.transport, '**Judgement** — no single published table for handling and vibration'),
    table('Fragility', f.fragility, '**Judgement** — the product is assumed to carry none of the load'),
    '',
    '## Made-up boards (D-005)',
    'Box 400 × 300 × 250 mm inside (perimeter 1400 mm).',
    '',
    '| Board | ECT kN/m | Caliper mm | Grammage g/m² | Blank m² | Unit price | Lead days |',
    '|---|---|---|---|---|---|---|',
    ...golden.cases[0]!.boards.map(
      (b) =>
        `| \`${b.materialId}\` | ${b.sheet?.ectKnPerM ?? '— no sheet'} | ${b.sheet?.caliperMm ?? '—'} | ${b.sheet?.grammageGsm ?? '—'} | ${b.blankAreaSqm} | ${b.price.unitPrice ?? '—'} | ${b.price.leadTimeDays ?? '—'} |`,
    ),
    '',
    '## Cases',
    '',
    '| Case | Inputs | Required BCT N | Recommended (or closest) | Low – high N | Margin % | Warnings | Alternatives |',
    '|---|---|---|---|---|---|---|---|',
    ...results.map(({ c, out }) => {
      const i = c.inputs;
      const lead = out.options.find(
        (o) => o.materialId === (out.recommendedMaterialId ?? out.closestMaterialId),
      );
      const pallet = i.pallet ? `${i.pallet.pattern}${i.pallet.overhang ? ' + overhang' : ''}` : 'no pallet';
      return [
        `**${c.key}** ${c.title}`,
        `${i.unitsPerBox} × ${i.productWeightG} g, ${i.stackLayers} high, ${pallet}, ${i.humidity}, ${i.storage}, ${i.transportMode}, ${i.fragility}`,
        out.requirement.requiredBctN.toFixed(1),
        out.recommendedMaterialId
          ? `\`${out.recommendedMaterialId}\``
          : `none — closest \`${out.closestMaterialId}\``,
        lead ? `${lead.bctN.low.toFixed(1)} – ${lead.bctN.high.toFixed(1)}` : '—',
        lead?.marginPct === null || lead?.marginPct === undefined ? '—' : lead.marginPct.toFixed(1),
        out.warnings.join(', ') || '—',
        out.alternatives.map((a) => `\`${a.materialId}\` (${a.roles.join(', ')})`).join('<br>') || '—',
      ]
        .join(' | ')
        .replace(/^/, '| ')
        .concat(' |');
    }),
    '',
    '## Sign-off (D-189)',
    'Sign when the method, the factors and the expected board of every case are right; then record the names in `test/golden/advisory/sign-off.json` (engine version and the sha256 of `golden.json`), a Superadmin sets `advisory.rule_set` to the signed values and switches on `advisory.structure_advisor`.',
    '',
    '| Business sign-off | Name | Date |',
    '|---|---|---|',
    ...['Partner Manager', 'Prepress'].map((role) => {
      const s = signOff?.signatures.find((x) => x.role === role);
      return `| ${role} | ${signed && s ? s.name : ''} | ${signed && s ? s.date : ''} |`;
    }),
    '',
  ];
  return lines.join('\n');
}
