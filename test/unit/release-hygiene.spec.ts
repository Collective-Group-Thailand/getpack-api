import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { check } from '../../scripts/release-hygiene';

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'hygiene-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const BASE = {
  'src/app.ts': 'export const app = 1;\n',
  'prisma/seed/reference-seed.ts': 'export {};\n',
  'prisma/seed/run.ts': 'export {};\n',
  'prisma/seed/data/flags.ts': "export const X_FEATURE_FLAGS = [{ key: 'a', description: 'a' }] as const;\n",
};

describe('release hygiene check (D-296)', () => {
  it('passes a clean tree, the product term mockup and tests or dev seeds with markers', () => {
    expect(
      check(
        repo({
          ...BASE,
          'src/jobs.ts': "const kind = 'mockup'; // a mock-up job\n",
          'src/jobs.spec.ts': "jest.mock('x'); // [Dev]\n",
          'prisma/seed/dev-folding.ts': "const taxId = '0999999999001'; // [DEV]\n",
        }),
      ),
    ).toEqual([]);
  });

  it('fails on markers and test tax ids in production code and reference seeds', () => {
    const rules = check(
      repo({
        ...BASE,
        'src/a.ts': "const name = '[Dev] factory';\n",
        'src/b.ts': '// use a mock here\n',
        'src/c.ts': '// TODO-REMOVE before launch\n',
        'prisma/seed/data/vendors.ts': "export const TAX = '0999999999001';\n",
        'src/allowed.ts': "const markers = ['[Dev]']; // release-hygiene: allow\n",
      }),
    ).map((f) => `${f.file}:${f.rule}`);
    expect(rules.sort()).toEqual([
      'prisma/seed/data/vendors.ts:test tax id',
      'src/a.ts:dev marker',
      'src/b.ts:mock marker',
      'src/c.ts:TODO-REMOVE marker',
    ]);
  });

  it('fails when a non-dev seed switches a feature flag on', () => {
    const findings = check(
      repo({
        ...BASE,
        'prisma/seed/reference-seed.ts':
          "await tx.featureFlag.create({\n  data: { key: 'a', description: 'a', enabled: true, ownerRoleKey: 'x' },\n});\n",
      }),
    );
    expect(findings.map((f) => f.rule)).toEqual(['flag switched on by a non-dev seed']);
  });
});
