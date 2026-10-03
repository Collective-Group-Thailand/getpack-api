/**
 * D-296 release hygiene (D-210), run in CI (`pnpm release:check`). Fails when
 *  - production code (`src/`, not tests) or the reference seed (`prisma/seed/reference-seed.ts`, `prisma/seed/data/`)
 *    carries a debug marker: `[Dev]` / `[DEV]`, the word `mock` (not `mockup` / `mock-up`, a product term),
 *    `TODO-REMOVE`;
 *  - a test tax id (the fake `0999999…` series of the dev seed) appears outside the dev seed and the tests;
 *  - a non-dev seed switches a feature flag on, or the reference flags mark a development-only flag on.
 * The production boot guard (`FeatureFlagsService.onApplicationBootstrap`) covers what is switched on at run time.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Run from the repository root (`pnpm release:check`), compiled into dist/scripts.
const ROOT = process.cwd();

interface Finding {
  file: string;
  line: number;
  rule: string;
  text: string;
}

function files(dir: string, accept: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === 'node_modules' || name === 'generated' || name.startsWith('.')) continue;
    if (statSync(path).isDirectory()) out.push(...files(path, accept));
    else if (accept(path)) out.push(path);
  }
  return out;
}

const isSource = (p: string) => /\.(ts|hbs|json)$/.test(p) && !/\.(spec|int-spec|e2e-spec)\.ts$/.test(p);
const MARKERS: { rule: string; pattern: RegExp }[] = [
  { rule: 'dev marker', pattern: /\[dev\]/i },
  { rule: 'mock marker', pattern: /\bmock\b(?!-up)/i },
  { rule: 'TODO-REMOVE marker', pattern: /TODO-REMOVE/ },
];
const TEST_TAX_ID = /(?<!\d)0999999\d{6}(?!\d)/;

/** Lines a reviewer explicitly allowed, e.g. a rule that names a marker: `// release-hygiene: allow`. */
const allowed = (line: string) => line.includes('release-hygiene: allow');

export function check(root = ROOT): Finding[] {
  const findings: Finding[] = [];
  const scan = (path: string, rules: { rule: string; pattern: RegExp }[]) => {
    const lines = readFileSync(path, 'utf8').split('\n');
    lines.forEach((text, i) => {
      if (allowed(text)) return;
      for (const r of rules)
        if (r.pattern.test(text))
          findings.push({ file: relative(root, path), line: i + 1, rule: r.rule, text: text.trim() });
    });
  };
  const production = [
    ...files(join(root, 'src'), isSource),
    join(root, 'prisma/seed/reference-seed.ts'),
    join(root, 'prisma/seed/run.ts'),
    ...files(join(root, 'prisma/seed/data'), isSource),
  ];
  for (const path of production) scan(path, [...MARKERS, { rule: 'test tax id', pattern: TEST_TAX_ID }]);

  // A non-dev seed never switches a flag on; the reference flag lists never mark one on.
  for (const path of [
    join(root, 'prisma/seed/reference-seed.ts'),
    ...files(join(root, 'prisma/seed/data'), isSource),
  ]) {
    const text = readFileSync(path, 'utf8');
    const flagWrite = /featureFlag\.(create|update|upsert)\([\s\S]{0,600}?enabled:\s*true/g;
    for (const m of text.matchAll(flagWrite))
      findings.push({
        file: relative(root, path),
        line: text.slice(0, m.index).split('\n').length,
        rule: 'flag switched on by a non-dev seed',
        text: m[0].split('\n')[0]!.trim(),
      });
    if (/FEATURE_FLAGS\s*=\s*\[[\s\S]*?enabled:\s*true[\s\S]*?\]\s*as const/.test(text))
      findings.push({
        file: relative(root, path),
        line: 1,
        rule: 'flag on in a reference flag list',
        text: '',
      });
  }
  return findings;
}

if (require.main === module) {
  const findings = check();
  for (const f of findings) console.error(`${f.file}:${f.line}  ${f.rule}  ${f.text}`);
  if (findings.length > 0) {
    console.error(`release hygiene: ${findings.length} finding(s) (D-296)`);
    process.exit(1);
  }
  console.log('release hygiene: clean (D-296)');
}
