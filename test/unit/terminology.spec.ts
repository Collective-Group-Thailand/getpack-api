import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * D-313 Proof terminology (UX round 2 Phase 4 §A3, packio-web `docs/ui/glossary.md`): customers read
 * "ตรวจแบบก่อนพิมพ์" (the step) and "แบบตัวอย่าง" (the file), staff and factories "Proof". The Thai
 * transliterations and the older terms never appear in text this repo emits, seeds, tests or publishes in
 * the contract. Applied migrations are history and are not scanned; this file, which lists the words, is skipped.
 */
const FORBIDDEN = ['ปรู๊ฟ', 'ปรูฟ', 'พรู๊ฟ', 'พรูฟ', 'ตัวอย่างงานพิมพ์', 'พิสูจน์อักษร'];

const ROOT = join(__dirname, '..', '..');
const SCANNED = ['src', 'prisma/seed', 'test', 'scripts', 'contract/openapi.json'];
const SKIPPED_DIRS = new Set(['node_modules', 'generated', 'migrations', 'dist']);
const TEXT = /\.(ts|json|md|hbs|html|txt|ya?ml)$/;

function files(path: string): string[] {
  const full = join(ROOT, path);
  let stat;
  try {
    stat = statSync(full);
  } catch {
    return [];
  }
  if (stat.isFile()) return TEXT.test(path) ? [path] : [];
  return readdirSync(full)
    .filter((name) => !SKIPPED_DIRS.has(name))
    .flatMap((name) => files(join(path, name)));
}

describe('Proof terminology (D-313)', () => {
  it('no source, seed, test or contract text uses the retired Thai terms', () => {
    const hits: string[] = [];
    for (const path of SCANNED.flatMap(files).filter((p) => !p.endsWith('terminology.spec.ts'))) {
      const lines = readFileSync(join(ROOT, path), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (FORBIDDEN.some((word) => line.includes(word)))
          hits.push(`${relative(ROOT, join(ROOT, path))}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
