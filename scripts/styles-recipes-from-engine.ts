/**
 * `pnpm styles:recipes-from-engine <out.json>` (U3.B5, ADR-0010, D-270) — writes a recipe bundle from the vendored
 * `@packio/dieline` engine: one recipe per style base it names, with processes and size ranges per material class.
 * Then `pnpm styles:import <out.json> --recipes` shows the diff and, with `--confirm`, stores the recipes for
 * Prepress approval (D-243).
 */
import { writeFileSync } from 'node:fs';

import { PackioDielineEngine } from '../src/integrations/dieline/packio-dieline.engine';
import { engineBundle } from '../src/modules/styles/engine-recipes';

async function main(): Promise<void> {
  const out = process.argv[2];
  if (!out) {
    console.error('usage: styles:recipes-from-engine <out.json>');
    process.exit(2);
  }
  const engine = new PackioDielineEngine();
  if (!(await engine.available())) {
    console.error('the vendored @packio/dieline bundle is missing or does not match VERSION.json (ADR-0010)');
    process.exit(1);
  }
  const bundle = await engineBundle(engine);
  writeFileSync(out, `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(`${bundle.recipes.length} recipes from ${bundle.source} → ${out}`);
}

void main();
