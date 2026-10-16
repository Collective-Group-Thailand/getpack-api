import { createHash } from 'node:crypto';

import { canonical } from '@modules/catalog/imports/import-engine';

/**
 * A recipe bundle from `@getpack/dieline` (U3.B1, gap §U3 assumption 3): `{ schemaVersion, recipes: [{ baseCode,
 * recipe, processes?, sizeRanges? }] }`. Checked structurally here; the package validates the recipe itself once it
 * is installed (finding S1). The checksum is over the canonical JSON, so key order does not matter.
 */

export interface BundleRecipe {
  baseCode: string;
  recipe: Record<string, unknown>;
  processes: string[];
  sizeRanges: Record<string, unknown> | null;
  checksum: Buffer;
}

export interface ParsedBundle {
  schemaVersion: string;
  recipes: BundleRecipe[];
}

export class RecipeBundleError extends Error {
  constructor(readonly problems: string[]) {
    super(`recipe bundle: ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? ' …' : ''}`);
    this.name = 'RecipeBundleError';
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

export function recipeChecksum(recipe: Record<string, unknown>): Buffer {
  return createHash('sha256')
    .update(JSON.stringify(canonical(recipe)))
    .digest();
}

export function parseRecipeBundle(raw: unknown): ParsedBundle {
  const problems: string[] = [];
  const file = isObject(raw) ? raw : {};
  const schemaVersion = typeof file['schemaVersion'] === 'string' ? file['schemaVersion'].trim() : '';
  if (!/^\d+\.\d+(\.\d+)?$/.test(schemaVersion)) problems.push('schemaVersion must be like 1.0');
  const list = Array.isArray(file['recipes']) ? (file['recipes'] as unknown[]) : [];
  if (list.length === 0) problems.push('recipes is empty');
  const seen = new Set<string>();
  const recipes: BundleRecipe[] = [];
  for (const [i, item] of list.entries()) {
    const r = isObject(item) ? item : {};
    const baseCode = typeof r['baseCode'] === 'string' ? r['baseCode'] : '';
    const at = `recipes[${i}] ${baseCode}`;
    if (!/^PK-[A-Z0-9]{2,8}-[0-9]{2,3}$/.test(baseCode)) problems.push(`${at}: baseCode is not a style code`);
    if (seen.has(baseCode)) problems.push(`${at}: one recipe per base in a bundle`);
    seen.add(baseCode);
    if (!isObject(r['recipe'])) problems.push(`${at}: recipe must be an object`);
    const processes = Array.isArray(r['processes']) ? (r['processes'] as unknown[]) : [];
    if (!processes.every((p) => typeof p === 'string' && /^[a-z][a-z0-9_]*$/.test(p)))
      problems.push(`${at}: processes must be process codes`);
    if (r['sizeRanges'] !== undefined && r['sizeRanges'] !== null && !isObject(r['sizeRanges']))
      problems.push(`${at}: sizeRanges must be an object per material class`);
    if (isObject(r['recipe']))
      recipes.push({
        baseCode,
        recipe: r['recipe'],
        processes: [...new Set(processes as string[])].sort(),
        sizeRanges: isObject(r['sizeRanges']) ? r['sizeRanges'] : null,
        checksum: recipeChecksum(r['recipe']),
      });
  }
  if (problems.length > 0) throw new RecipeBundleError(problems);
  return { schemaVersion, recipes };
}
