import { createHash } from 'node:crypto';

import { systemActor } from '@common/context/actor';
import { MAX_SCRUB_BYTES, type ScrubFormat, scrubMetadata } from '@common/files/metadata-scrub';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type ProductionCopyFailure } from '@generated/prisma/client';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { FilesService } from '@platform/files/files.service';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { originalCopyName } from './production-copy-names';

const BATCH = 5;
/** A claimed copy is retried by another worker after this long (crash safety). */
const LEASE_MS = 15 * 60_000;
/** Storage hiccups are retried this many times before the copy is reported `source_unavailable`. */
const MAX_ATTEMPTS = 5;

/**
 * D-442 (DECISIONS-STAGE-A §1 "Production access to originals"): production may download the customer's original
 * artwork file, but with no customer identity. When a proof is approved, each original artwork file of its
 * submission gets a copy request; this worker makes the copy — document metadata stripped (author, creator,
 * company, title, XMP; EXIF / GPS of images) and named by the order code — and stores it as a new private file.
 * The original is never modified. Formats without a safe scrubber (TIFF, SVG, PostScript / EPS, Illustrator,
 * Photoshop, ZIP), encrypted or unreadable files are marked `unsupported` and nothing is offered (open question).
 */
@Injectable()
export class ProductionCopiesService {
  private readonly logger = new Logger(ProductionCopiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** In the approval's transaction: one copy request per original artwork file of the submission (idempotent). */
  async request(tx: Tx, submissionId: bigint): Promise<number> {
    const files = await tx.artworkSubmissionFile.findMany({
      where: { submissionId, role: 'artwork', fileObjectId: { not: null } },
      select: { id: true, fileObjectId: true },
    });
    if (files.length === 0) return 0;
    const created = await tx.artworkProductionCopy.createMany({
      data: files.map((f) => ({ submissionFileId: f.id, sourceFileId: f.fileObjectId! })),
      skipDuplicates: true,
    });
    return created.count;
  }

  @ScheduledJob({ name: 'artwork.production_copies', every: 30_000 })
  async process(now: Date = new Date()): Promise<number> {
    const claimed = await this.prisma.$queryRaw<{ id: bigint }[]>`
      UPDATE artwork_production_copies
         SET locked_until = ${new Date(now.getTime() + LEASE_MS)}, attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM artwork_production_copies
          WHERE status = 'pending' AND (locked_until IS NULL OR locked_until < ${now})
          ORDER BY id LIMIT ${BATCH}
          FOR UPDATE SKIP LOCKED)
      RETURNING id`;
    for (const { id } of claimed) {
      await this.makeOne(id).catch((error: unknown) => {
        this.logger.warn(`production copy ${id} failed: ${error instanceof Error ? error.message : 'error'}`);
      });
    }
    return claimed.length;
  }

  async makeOne(id: bigint): Promise<void> {
    const copy = await this.prisma.artworkProductionCopy.findUniqueOrThrow({
      where: { id },
      include: {
        sourceFile: true,
        submissionFile: {
          select: {
            sort: true,
            submission: {
              select: {
                id: true,
                versionNo: true,
                order: { select: { orderCode: true } },
                files: {
                  where: { role: 'artwork', fileObjectId: { not: null } },
                  orderBy: [{ sort: 'asc' }, { id: 'asc' }],
                  select: { id: true },
                },
              },
            },
          },
        },
      },
    });
    if (copy.status !== 'pending') return;
    const source = copy.sourceFile;
    if (source.uploadStatus !== 'uploaded' || source.scanStatus !== 'clean' || source.purgedAt)
      return this.unsupported(copy.id, copy.publicId, 'source_unavailable');
    if (Number(source.sizeBytes) > MAX_SCRUB_BYTES) return this.unsupported(copy.id, copy.publicId, 'too_large');
    let body: Buffer;
    try {
      body = await this.readAll(source.storageKey);
    } catch (error) {
      if (copy.attempts >= MAX_ATTEMPTS) return this.unsupported(copy.id, copy.publicId, 'source_unavailable');
      throw error; // retried after the lease
    }
    const { submission } = copy.submissionFile;
    const index = submission.files.findIndex((f) => f.id === copy.submissionFileId) + 1;
    const name = (format?: ScrubFormat) =>
      originalCopyName({
        orderCode: submission.order.orderCode,
        submissionVersion: submission.versionNo,
        index,
        total: submission.files.length,
        originalName: source.originalName,
        format,
      });
    const result = await scrubMetadata(body, { pdfxTitle: name().replace(/\.[a-z0-9]+$/, '') });
    if (!result.ok) return this.unsupported(copy.id, copy.publicId, result.reason);
    const fileName = name(result.format);
    // No owner: only staff (`files.read`) and the factories making the approved proof read it (production reader).
    const stored = await this.files.storeSystem({
      body: result.body,
      fileName,
      mimeType: source.mimeType,
      retentionClass: source.retentionClass,
      ownerUserId: null,
    });
    await this.prisma.withTx(async (tx) => {
      const at = new Date();
      await tx.fileObject.update({
        where: { id: stored.id },
        data: { metadataStrippedAt: at, purpose: 'artwork' },
      });
      const updated = await tx.artworkProductionCopy.updateMany({
        where: { id: copy.id, status: 'pending' },
        data: {
          status: 'ready',
          copyFileId: stored.id,
          readyAt: at,
          lockedUntil: null,
          rowVersion: { increment: 1 },
        },
      });
      if (updated.count === 0) return;
      await this.record(tx, copy.publicId, 'artwork.production_copy_ready', {
        copyFileId: stored.publicId,
        sha256: createHash('sha256').update(result.body).digest('hex'),
      });
    });
  }

  private async unsupported(id: bigint, publicId: string, reason: ProductionCopyFailure): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      const updated = await tx.artworkProductionCopy.updateMany({
        where: { id, status: 'pending' },
        data: { status: 'unsupported', failureReason: reason, lockedUntil: null, rowVersion: { increment: 1 } },
      });
      if (updated.count > 0)
        await this.record(tx, publicId, 'artwork.production_copy_unsupported', { reason });
    });
  }

  /** Audit + domain event (outbox) in the same transaction as the state change (CLAUDE.md). */
  private async record(tx: Tx, publicId: string, type: string, data: Record<string, unknown>): Promise<void> {
    const actor = systemActor('artwork.production_copies');
    await this.audit.record(tx, {
      category: 'data_access',
      action: type,
      outcome: type.endsWith('_ready') ? 'success' : 'failure',
      actor,
      resourceType: 'artwork_production_copy',
      resourcePublicId: publicId,
      data,
    });
    await this.events.record(
      tx,
      {
        type,
        aggregateType: 'artwork_production_copy',
        aggregateId: publicId,
        payload: { productionCopyId: publicId, ...data },
      },
      actor,
    );
  }

  private async readAll(key: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of (await this.storage.getStream(key)))
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    return Buffer.concat(chunks);
  }
}
