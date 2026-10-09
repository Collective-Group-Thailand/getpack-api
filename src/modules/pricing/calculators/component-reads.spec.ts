import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { CORRUGATE_PRICE_COMPONENTS } from './corrugate/price-components';
import { FOLDING_PRICE_COMPONENTS } from './folding/price-components';
import { LABEL_PRICE_COMPONENTS } from './label/price-components';
import { POUCH_PRICE_COMPONENTS } from './pouch/price-components';
import { SERVICE_PRICE_COMPONENTS } from './service/price-components';
import { STANDARD_PRODUCT_PRICE_COMPONENTS } from './standard-product/price-components';
import { CALCULATOR_READS } from './component-reads';

const ROOT = join(__dirname, '../../../..');
const DESCRIPTORS = [
  ...FOLDING_PRICE_COMPONENTS,
  ...CORRUGATE_PRICE_COMPONENTS,
  ...LABEL_PRICE_COMPONENTS,
  ...POUCH_PRICE_COMPONENTS,
  ...SERVICE_PRICE_COMPONENTS,
  ...STANDARD_PRODUCT_PRICE_COMPONENTS,
];

/** Prisma model (camelCase client accessor) → `pl_*` table, from the schema's `@@map`. */
function plModels(): Map<string, string> {
  const dir = join(ROOT, 'prisma/schema');
  const schema = readdirSync(dir)
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
  const out = new Map<string, string>();
  for (const m of schema.matchAll(/model (Pl\w+) \{([\s\S]*?)\n\}/g)) {
    const table = /@@map\("(pl_\w+)"\)/.exec(m[2]!)?.[1];
    if (table) out.set(m[1]![0]!.toLowerCase() + m[1]!.slice(1), table);
  }
  return out;
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.ts$/.test(name) && !/\.spec\.ts$|price-components/.test(name) ? [path] : [];
  });
}

/** The components a calculator directory's code queries (`db.plX` / `tx.plX`). */
function readsOf(dir: string): string[] {
  const models = plModels();
  const byTable = new Map(DESCRIPTORS.map((d) => [d.table, d.component as string]));
  const found = new Set<string>();
  for (const file of sources(join(__dirname, dir))) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\.(pl[A-Z]\w*)\b/g)) {
      const table = models.get(m[1]!);
      if (table) found.add(byTable.get(table) ?? table);
    }
  }
  return [...found].sort();
}

describe('price components each calculator reads (partner UX, 2026-10-09)', () => {
  it.each([
    ['folding', 'folding'],
    ['corrugate', 'corrugate'],
    ['label', 'label'],
    ['pouch', 'pouch'],
    ['service', 'service'],
    ['standard_product', 'standard-product'],
  ] as const)('%s lists exactly what its loader reads', (key, dir) => {
    expect([...CALCULATOR_READS[key]].sort()).toEqual(readsOf(dir));
  });

  it('prices tag & sleeve through the folding loader', () => {
    expect(CALCULATOR_READS.tag_sleeve).toEqual(CALCULATOR_READS.folding);
  });

  it('names only registered components', () => {
    const registered = new Set(DESCRIPTORS.map((d) => d.component as string));
    for (const list of Object.values(CALCULATOR_READS)) for (const c of list) expect(registered).toContain(c);
  });
});
