import { createHash } from 'node:crypto';

import { bytes as toBytes } from '@common/crypto/hashing';
import { PrismaService } from '@database/prisma.service';
import { type FileObject, type FileTextStatus } from '@generated/prisma/client';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';
import { type FileTextIndexSettings } from '@platform/settings/setting-keys';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import { chunkPages } from './chunking';
import { FILE_TEXT_EMBEDDINGS, type FileTextEmbeddings, vectorLiteral } from './text-embeddings';
import { FILE_TEXT_EXTRACTOR, type FileTextExtractor } from './text-extractor';

/** Used until `files.text_index` is seeded (a fresh database). */
export const TEXT_INDEX_DEFAULTS: FileTextIndexSettings = {
  enabled: true,
  ocr: true,
  ocrLanguages: 'tha+eng',
  ocrMaxPages: 30,
  ocrDpi: 300,
  maxBytes: 100 * 1024 * 1024,
  maxChars: 1_000_000,
  maxAttempts: 3,
};

/** Files read per tick at most, and how long one tick may keep reading before it hands over to the next. */
const BATCH = 25;
const TICK_BUDGET_MS = 90_000;
/** A claimed file is retried by another worker after this (an OCR'd 30-page scan takes a few minutes). */
const LEASE_MS = 20 * 60_000;
/** Chunks embedded per tick at most. */
const EMBED_BATCH = 256;

/**
 * Worker side of content search (D-427, ADR-0013): files the allowlist (`search.file_usages`) covers get a
 * `file_texts` row once their malware scan passed; each is read (text layer, Office XML or Tesseract OCR), chunked
 * and — when embeddings are on — embedded. A re-read that yields the same text keeps its chunks and vectors.
 */
@Injectable()
export class FileTextIndexJobs {
  private readonly logger = new Logger(FileTextIndexJobs.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(FILE_TEXT_EXTRACTOR) private readonly extractor: FileTextExtractor,
    @Inject(FILE_TEXT_EMBEDDINGS) private readonly embeddings: FileTextEmbeddings | null,
  ) {}

  async options(): Promise<FileTextIndexSettings> {
    try {
      return { ...TEXT_INDEX_DEFAULTS, ...(await this.settings.at('files.text_index')).value };
    } catch (error) {
      if (error instanceof SettingNotFoundError) return TEXT_INDEX_DEFAULTS;
      throw error;
    }
  }

  /**
   * New files to read: every clean, uploaded, unpurged file the allowlist covers that has no text row yet. Text of
   * purged files goes (retention follows the file).
   */
  @ScheduledJob({ name: 'files.text_enqueue', every: 60_000 })
  async enqueue(): Promise<number> {
    await this.prisma.$executeRaw`
      DELETE FROM file_texts t USING file_objects f
       WHERE f.id = t.file_object_id AND (f.purged_at IS NOT NULL OR f.scan_status = 'infected')`;
    const added = await this.prisma.$executeRaw`
      INSERT INTO file_texts (file_object_id)
      SELECT DISTINCT u.file_id
        FROM search.file_usages u
        JOIN file_objects f ON f.id = u.file_id
       WHERE f.upload_status = 'uploaded' AND f.scan_status = 'clean' AND f.purged_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM file_texts t WHERE t.file_object_id = u.file_id)
      ON CONFLICT (file_object_id) DO NOTHING`;
    if (added) this.logger.log(`text index: ${added} file(s) queued`);
    return added;
  }

  /** Reads queued files within a time budget per tick, newest first (a fresh upload is searchable soonest). */
  @ScheduledJob({ name: 'files.text_extract', every: 15_000 })
  async extractPending(): Promise<number> {
    const options = await this.options();
    if (!options.enabled) return 0;
    const started = Date.now();
    let done = 0;
    while (done < BATCH && Date.now() - started < TICK_BUDGET_MS) {
      const [row] = await this.claim(new Date(), 1);
      if (!row) break;
      await this.extractOne(row.id, row.file_object_id, row.attempts, options);
      done++;
    }
    return done;
  }

  private claim(now: Date, limit: number) {
    return this.prisma.$queryRaw<{ id: bigint; file_object_id: bigint; attempts: number }[]>`
      UPDATE file_texts SET lease_until = ${new Date(now.getTime() + LEASE_MS)}, attempts = attempts + 1,
             updated_at = ${now}
       WHERE id IN (
         SELECT id FROM file_texts
          WHERE status = 'pending' AND (lease_until IS NULL OR lease_until < ${now})
            AND (retry_at IS NULL OR retry_at <= ${now})
          ORDER BY id DESC LIMIT ${limit}
          FOR UPDATE SKIP LOCKED)
      RETURNING id, file_object_id, attempts`;
  }

  /** Reads one file now (also the reindex path): never throws; failures are recorded on the row. */
  async extractOne(
    textId: bigint,
    fileObjectId: bigint,
    attempts: number,
    options: FileTextIndexSettings,
  ): Promise<FileTextStatus> {
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileObjectId } });
    if (!file || file.purgedAt || file.scanStatus !== 'clean') {
      await this.prisma.fileText.deleteMany({ where: { id: textId } });
      return 'pending';
    }
    try {
      if (Number(file.sizeBytes) > options.maxBytes) return await this.finish(textId, 'too_large', {});
      const bytes = await this.download(file, options.maxBytes);
      const read = await this.extractor.extract(
        { bytes, mimeType: file.mimeType, name: file.originalName },
        options,
      );
      if (read.status === 'unsupported')
        return await this.finish(textId, 'unsupported', { lastError: read.reason ?? null, method: null });
      const chunks = chunkPages(read.pages, options.maxChars);
      const charCount = chunks.reduce((n, c) => n + c.content.length, 0);
      const sha = toBytes(
        createHash('sha256')
          .update(chunks.map((c) => `${c.page ?? ''}\u0001${c.sheet ?? ''}\u0001${c.content}`).join('\u0002'))
          .digest(),
      );
      const facts = {
        method: read.method,
        pageCount: read.pageCount,
        ocrPages: read.ocrPages,
        skippedPages: read.skippedPages,
        ocrConfidence: read.ocrConfidence,
        charCount,
      };
      await this.prisma.withTx(async (tx) => {
        const current = await tx.fileText.findUniqueOrThrow({ where: { id: textId } });
        const same = current.textSha256 && Buffer.from(current.textSha256).equals(Buffer.from(sha));
        if (!same) {
          await tx.fileTextChunk.deleteMany({ where: { fileTextId: textId } });
          if (chunks.length)
            await tx.fileTextChunk.createMany({
              data: chunks.map((c) => ({ fileTextId: textId, fileObjectId, ...c })),
            });
        }
        await tx.fileText.update({
          where: { id: textId },
          data: {
            ...facts,
            status: chunks.length ? 'indexed' : 'empty',
            textSha256: sha,
            lastError: null,
            leaseUntil: null,
            retryAt: null,
            extractedAt: new Date(),
            ...(same ? {} : { embeddedModel: null, embeddedAt: null }),
          },
        });
      });
      return chunks.length ? 'indexed' : 'empty';
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : 'error';
      const last = attempts >= options.maxAttempts;
      this.logger.warn(
        `text of file ${file.publicId} (${file.mimeType}) not read (attempt ${attempts}): ${message}`,
      );
      await this.prisma.fileText.update({
        where: { id: textId },
        data: {
          status: last ? 'failed' : 'pending',
          lastError: message,
          leaseUntil: null,
          // 1, 4, 16 minutes.
          retryAt: last ? null : new Date(Date.now() + 60_000 * 4 ** Math.max(0, attempts - 1)),
        },
      });
      return last ? 'failed' : 'pending';
    }
  }

  private async finish(
    textId: bigint,
    status: FileTextStatus,
    data: { lastError?: string | null; method?: string | null },
  ): Promise<FileTextStatus> {
    await this.prisma.withTx(async (tx) => {
      await tx.fileTextChunk.deleteMany({ where: { fileTextId: textId } });
      await tx.fileText.update({
        where: { id: textId },
        data: {
          status,
          ...data,
          charCount: 0,
          textSha256: null,
          leaseUntil: null,
          retryAt: null,
          extractedAt: new Date(),
          embeddedModel: null,
          embeddedAt: null,
        },
      });
    });
    return status;
  }

  private async download(file: FileObject, maxBytes: number): Promise<Buffer> {
    const parts: Buffer[] = [];
    let size = 0;
    for await (const chunk of await this.storage.getStream(file.storageKey)) {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += b.length;
      if (size > maxBytes) throw new Error(`file over ${maxBytes} bytes`);
      parts.push(b);
    }
    return Buffer.concat(parts);
  }

  /** Embeds the chunks of read files for search by meaning (nothing with embeddings off). */
  @ScheduledJob({ name: 'files.text_embed', every: 20_000 })
  async embedPending(): Promise<number> {
    const model = this.embeddings;
    if (!model) return 0;
    const key = `${model.model}@${model.modelVersion}`;
    const texts = await this.prisma.fileText.findMany({
      where: { status: 'indexed', OR: [{ embeddedModel: null }, { embeddedModel: { not: key } }] },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 20,
    });
    let embedded = 0;
    for (const { id } of texts) {
      if (embedded >= EMBED_BATCH) break;
      const chunks = await this.prisma.$queryRaw<{ id: bigint; content: string }[]>`
        SELECT c.id, c.content FROM file_text_chunks c
         WHERE c.file_text_id = ${id}
           AND NOT EXISTS (SELECT 1 FROM search.file_text_embeddings e
                            WHERE e.chunk_id = c.id AND e.model = ${model.model} AND e.model_version = ${model.modelVersion})
         ORDER BY c.chunk_index LIMIT ${EMBED_BATCH}`;
      if (chunks.length) {
        const vectors = await model.embed(
          chunks.map((c) => c.content),
          'passage',
        );
        for (const [i, c] of chunks.entries())
          await this.prisma.$executeRaw`
            INSERT INTO search.file_text_embeddings (chunk_id, model, model_version, embedding)
            VALUES (${c.id}, ${model.model}, ${model.modelVersion}, ${vectorLiteral(vectors[i]!)}::vector)
            ON CONFLICT DO NOTHING`;
        embedded += chunks.length;
      }
      const left = await this.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM file_text_chunks c
         WHERE c.file_text_id = ${id}
           AND NOT EXISTS (SELECT 1 FROM search.file_text_embeddings e
                            WHERE e.chunk_id = c.id AND e.model = ${model.model} AND e.model_version = ${model.modelVersion})`;
      if (Number(left[0]?.n ?? 0) === 0)
        await this.prisma.fileText.update({
          where: { id },
          data: { embeddedModel: key, embeddedAt: new Date() },
        });
    }
    return embedded;
  }

  /**
   * Reads files again (`admin.fileSearch.reindex`): the given files, or every file in the given states. The text
   * hash stays, so an unchanged re-read keeps chunks and vectors.
   */
  async requeue(filter: { fileObjectIds?: bigint[]; status?: FileTextStatus[] }): Promise<number> {
    const { count } = await this.prisma.fileText.updateMany({
      where: {
        ...(filter.fileObjectIds ? { fileObjectId: { in: filter.fileObjectIds } } : {}),
        ...(filter.status ? { status: { in: filter.status } } : {}),
      },
      data: { status: 'pending', attempts: 0, retryAt: null, leaseUntil: null, lastError: null },
    });
    return count;
  }
}
