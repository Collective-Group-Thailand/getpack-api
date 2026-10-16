import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { dielineEngineInfo } from '@common/openapi/openapi.document';

const ROOT = join(__dirname, '..', '..');
const DIR = join(ROOT, 'vendor/getpack-dieline');

/**
 * ADR-0010: the vendored `@getpack/dieline` is the web's engine, whole (`pnpm dieline:vendor <getpack-web>`). This side
 * checks the bundle against its record and publishes the record in the contract; getpack-web's CI compares its own
 * `packages/dieline` git tree with `info.x-getpack-dieline.sourceTree` of the contract it pins, so the two cannot drift.
 */
describe('vendored @getpack/dieline', () => {
  const meta = JSON.parse(readFileSync(join(DIR, 'VERSION.json'), 'utf8')) as Record<string, unknown>;
  const bundle = readFileSync(join(DIR, 'index.mjs'));

  it('is the bundle its VERSION.json records, from a committed getpack-web tree', () => {
    expect(createHash('sha256').update(bundle).digest('hex')).toBe(meta['bundleSha256']);
    expect(meta['sourceTree']).toMatch(/^[0-9a-f]{40}$/);
    expect(meta['getpackWebCommit']).toMatch(/^[0-9a-f]{40}$/);
    expect(meta['uncommittedChanges']).toBe(0);
  });

  it('carries the whole style library, not only the core recipes', () => {
    const text = bundle.toString('utf8');
    expect(text).toContain('ALL_RECIPES');
    expect(text).toContain('registerLibrary');
  });

  it('is named in the contract the web pins (run `pnpm contract:build` after `pnpm dieline:vendor`)', () => {
    const contract = JSON.parse(readFileSync(join(ROOT, 'contract/openapi.json'), 'utf8')) as {
      info: Record<string, unknown>;
    };
    expect(contract.info['x-getpack-dieline']).toEqual(dielineEngineInfo(join(DIR, 'VERSION.json')));
  });
});
