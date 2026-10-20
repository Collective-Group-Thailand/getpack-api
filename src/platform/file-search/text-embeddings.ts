import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, dirname } from 'node:path';

import { Logger } from '@nestjs/common';

/**
 * Embeddings for content search by meaning (D-427, ADR-0013): `vector(384)` in `search.file_text_embeddings`.
 * The real one runs inside the process (no document leaves the server: the same reason OCR is local), the fake is
 * a hashed bag of character trigrams for tests and `pnpm dev`.
 */
export const FILE_TEXT_EMBEDDINGS = Symbol('FILE_TEXT_EMBEDDINGS');
export const FILE_TEXT_DIMENSIONS = 384;

export interface FileTextEmbeddings {
  readonly model: string;
  readonly modelVersion: string;
  /**
   * Below this cosine similarity a by-meaning hit is noise (tuned per model: e5 scores unrelated text around 0.7–0.75;
   * the fake has no notion of meaning and only finds shared spellings).
   */
  readonly minSimilarity: number;
  /** One unit-length vector per text; `query` for what a person typed, `passage` for stored chunks. */
  embed(texts: string[], kind: 'query' | 'passage'): Promise<number[][]>;
}

/** Thai has no spaces: character trigrams of each run of letters stand in for words, whole ASCII words too. */
function features(text: string): string[] {
  const clean = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
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

/** Deterministic stand-in: hashed features, L2-normalised. Not a semantic model. */
export class FakeFileTextEmbeddings implements FileTextEmbeddings {
  readonly model = 'fake-hashing';
  readonly modelVersion = '1';
  readonly minSimilarity = 0.35;

  embed(texts: string[]): Promise<number[][]> {
    return Promise.resolve(
      texts.map((t) => {
        const v = new Array<number>(FILE_TEXT_DIMENSIONS).fill(0);
        for (const f of features(t)) {
          const h = createHash('sha256').update(f).digest();
          v[h.readUInt32BE(0) % FILE_TEXT_DIMENSIONS]! += h[4]! & 1 ? 1 : -1;
        }
        const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
        return v.map((x) => x / norm);
      }),
    );
  }
}

type Extractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

/**
 * `intfloat/multilingual-e5-small` (MIT licence, 100 languages including Thai, 384 dimensions, 512 tokens) as ONNX,
 * int8-quantised (≈ 120 MB), run by ONNX Runtime through transformers.js — files from `FILE_SEARCH_MODEL_DIR`
 * (baked into the image, never fetched at run time). e5 wants `query: ` / `passage: ` in front of the text.
 */
export class LocalE5Embeddings implements FileTextEmbeddings {
  readonly model = 'multilingual-e5-small';
  readonly modelVersion: string;
  readonly minSimilarity = 0.8;
  private readonly logger = new Logger(LocalE5Embeddings.name);
  private extractor: Promise<Extractor> | null = null;

  constructor(
    private readonly modelDir: string,
    revision = 'q8',
  ) {
    this.modelVersion = revision;
  }

  /** Model files are present where configured (the image bakes them in; a dev machine may not have them). */
  static available(modelDir: string): boolean {
    return existsSync(`${modelDir}/tokenizer.json`) && existsSync(`${modelDir}/onnx/model_quantized.onnx`);
  }

  private load(): Promise<Extractor> {
    this.extractor ??= (async () => {
      const t = await import('@huggingface/transformers');
      t.env.allowRemoteModels = false;
      t.env.allowLocalModels = true;
      t.env.localModelPath = dirname(this.modelDir);
      const started = Date.now();
      const pipe = await t.pipeline('feature-extraction', basename(this.modelDir), {
        dtype: 'q8',
        local_files_only: true,
      });
      this.logger.log(`embedding model ${this.model} loaded in ${Date.now() - started} ms`);
      return pipe as unknown as Extractor;
    })().catch((error: unknown) => {
      this.extractor = null;
      throw error;
    });
    return this.extractor;
  }

  async embed(texts: string[], kind: 'query' | 'passage'): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await this.load();
    const out: number[][] = [];
    // Small batches keep the worker's memory flat on a long document.
    for (let i = 0; i < texts.length; i += 16) {
      const batch = texts.slice(i, i + 16).map((t) => `${kind}: ${t}`);
      const tensor = await extractor(batch, { pooling: 'mean', normalize: true });
      out.push(...tensor.tolist());
    }
    return out;
  }
}

/** pgvector literal of a vector. */
export const vectorLiteral = (v: number[]) => `[${v.map((x) => x.toFixed(6)).join(',')}]`;
