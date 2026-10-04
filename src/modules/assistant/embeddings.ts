import { createHash } from 'node:crypto';

/** Help-search embeddings (ADR-0001 `vector(1536)`); the vendor is chosen with ADR-0012. */
export const HELP_EMBEDDINGS = Symbol('HELP_EMBEDDINGS');
export const EMBEDDING_DIMENSIONS = 1536;

export interface HelpEmbeddings {
  readonly model: string;
  readonly modelVersion: string;
  embed(texts: string[]): Promise<number[][]>;
}

/** Words of a text: Thai has no spaces, so overlapping character trigrams stand in for words. */
function features(text: string): string[] {
  const clean = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  const out: string[] = [];
  for (const word of clean.split(' ')) {
    if (!word) continue;
    if (/^[a-z0-9]+$/.test(word)) out.push(`w:${word}`);
    else for (let i = 0; i + 3 <= word.length; i++) out.push(`t:${word.slice(i, i + 3)}`);
    if (word.length < 3) out.push(`w:${word}`);
  }
  return out;
}

/**
 * A deterministic stand-in (tests, `pnpm dev`, evaluation): hashed features into 1536 dimensions, L2-normalised — texts
 * sharing words land near each other. Not a semantic model.
 */
export class FakeHelpEmbeddings implements HelpEmbeddings {
  readonly model = 'fake-hashing';
  readonly modelVersion = '1';

  embed(texts: string[]): Promise<number[][]> {
    return Promise.resolve(
      texts.map((t) => {
        const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
        for (const f of features(t)) {
          const h = createHash('sha256').update(f).digest();
          v[h.readUInt32BE(0) % EMBEDDING_DIMENSIONS]! += h[4]! & 1 ? 1 : -1;
        }
        const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
        return v.map((x) => x / norm);
      }),
    );
  }
}
