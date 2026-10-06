import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SIGNAL_KEYS } from '@modules/ops/ops-signals.service';

/**
 * The launch documents (B6.3, refreshed in U-B5) stay true to the code: every operational signal has its alert in
 * MONITORING.md, every environment variable is explained in a launch document, and every automated test the UAT
 * package points the signers to exists.
 */
const root = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('launch documents', () => {
  it('list every ops signal of the registry in MONITORING.md', () => {
    const monitoring = read('docs/launch/MONITORING.md');
    expect(SIGNAL_KEYS.filter((key) => !monitoring.includes(`\`${key}\``))).toEqual([]);
  });

  it('explain every environment variable the API validates', () => {
    const schema = read('src/config/env.schema.ts');
    const keys = [...schema.matchAll(/^ {2}([A-Z][A-Z0-9_]+)[?!]?\s*[:=]/gm)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(40);
    const docs = [
      'docs/launch/INTEGRATIONS.md',
      'docs/launch/SECURITY.md',
      'docs/launch/MONITORING.md',
      'docs/launch/PERFORMANCE.md',
      'docs/RUNBOOK.md',
    ]
      .map(read)
      .join('\n');
    // A prefix family documented once (e.g. `SEED_ENTITY_*`, `SCB_*`) covers its members.
    const families = [...docs.matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)_\*`/g)].map((m) => `${m[1]}_`);
    const undocumented = keys.filter(
      (key) => !docs.includes(key) && !families.some((prefix) => key.startsWith(prefix)),
    );
    expect(undocumented).toEqual([]);
  });

  it('point the UAT signers only to automated tests that exist', () => {
    const uat = read('docs/launch/UAT.md') + read('docs/launch/UAT-DATA.md');
    const named = new Set(
      [...uat.matchAll(/`((?:test\/[a-z]+\/)?[a-z0-9-]+\.(?:e2e-spec|int-spec|spec)\.ts)`/g)].map(
        (m) => m[1]!,
      ),
    );
    expect(named.size).toBeGreaterThan(40);
    const missing = [...named].filter((file) => {
      if (file.startsWith('test/')) return !existsSync(join(root, file));
      const dir = file.endsWith('.e2e-spec.ts')
        ? 'e2e'
        : file.endsWith('.int-spec.ts')
          ? 'integration'
          : 'unit';
      return !existsSync(join(root, 'test', dir, file));
    });
    expect(missing).toEqual([]);
  });
});
