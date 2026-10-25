import { createHash } from 'node:crypto';
import { type Readable } from 'node:stream';

import { OBJECT_STORAGE, type ObjectStorage } from '@collective/integrations/storage';
import { VIRUS_SCANNER, type VirusScanner } from '@collective/integrations/virus-scan';
import { systemActor } from '@common/context/actor';
import { bytes } from '@common/crypto/hashing';
import { PrismaService } from '@database/prisma.service';
import { type FileObject } from '@generated/prisma/client';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';
import sharp from 'sharp';

const BATCH = 10;
/** Kept in memory for scanning, image metadata and PDF page counts. */
const SAMPLE_BYTES = 64 * 1024 * 1024;
/** A claimed file is retried by another worker after this long (crash safety). */
const LEASE_MS = 10 * 60_000;
/** An attempt that failed (storage hiccup, scanner outage) is retried on the next tick after this, instead of after the full lease. */
const RETRY_AFTER_MS = 15_000;
/** GETs right after `complete`'s HEAD occasionally miss; retried with 1 s, 2 s, 4 s backoff. */
const READ_RETRIES = 3;
const READ_RETRY_MS = 1000;
/**
 * Wide enough for a product card on a retina screen (a 270 CSS px card at 2× is 540 px) and still a tenth of a
 * 1024 px original; `pnpm files:rethumb` re-makes existing thumbnails when this changes.
 */
export const THUMBNAIL_WIDTH = 640;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/tiff']);

/**
 * Worker side of uploads: SHA-256 over the whole object, malware scan, dimensions / page count,
 * a WebP thumbnail for images; abandoned pending uploads are cleaned up.
 */
@Injectable()
export class FileProcessingJobs {
  private readonly logger = new Logger(FileProcessingJobs.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(VIRUS_SCANNER) private readonly scanner: VirusScanner,
  ) {}

  @ScheduledJob({ name: 'files.process', every: 10_000 })
  async processUploaded(now: Date = new Date()): Promise<number> {
    // `scanned_at` doubles as the lease while the scan is pending.
    const claimed = await this.prisma.$queryRaw<{ id: bigint }[]>`
      UPDATE file_objects SET scanned_at = ${now}
       WHERE id IN (
         SELECT id FROM file_objects
          WHERE upload_status = 'uploaded' AND scan_status = 'pending' AND thumbnail_of_file_id IS NULL
            AND (scanned_at IS NULL OR scanned_at < ${new Date(now.getTime() - LEASE_MS)})
          ORDER BY id LIMIT ${BATCH}
          FOR UPDATE SKIP LOCKED)
      RETURNING id`;
    for (const { id } of claimed) {
      const file = await this.prisma.fileObject.findUniqueOrThrow({ where: { id } });
      await this.processOne(file).catch(async (error: unknown) => {
        this.logger.warn(
          `file ${file.publicId} (${file.storageKey}) processing failed: ${error instanceof Error ? error.message : 'error'}`,
        );
        // Shorten the lease so the next tick after RETRY_AFTER_MS picks the file up again.
        await this.prisma.fileObject
          .updateMany({
            where: { id: file.id, scanStatus: 'pending' },
            data: { scannedAt: new Date(now.getTime() - LEASE_MS + RETRY_AFTER_MS) },
          })
          .catch(() => undefined);
      });
    }
    return claimed.length;
  }

  async processOne(file: FileObject): Promise<void> {
    const { sha256, sample } = await this.read(file.storageKey);
    const verdict = await this.scanner.scan({
      key: file.storageKey,
      sample,
      sizeBytes: Number(file.sizeBytes),
    });
    const meta = verdict === 'clean' ? await this.metadata(file, sample) : {};
    await this.prisma.withTx(async (tx) => {
      await tx.fileObject.update({
        where: { id: file.id },
        data: {
          sha256,
          scanStatus: verdict,
          scannedAt: verdict === 'pending' ? null : new Date(),
          ...meta,
          rowVersion: { increment: 1 },
        },
      });
      if (verdict === 'pending') return;
      const actor = systemActor('files.process');
      if (verdict === 'infected') {
        await this.audit.record(tx, {
          category: 'security',
          action: 'file.infected',
          outcome: 'denied',
          actor,
          resourceType: 'file',
          resourcePublicId: file.publicId,
        });
      }
      await this.events.record(
        tx,
        {
          type: 'file.scanned',
          aggregateType: 'file',
          aggregateId: file.publicId,
          payload: { fileId: file.publicId, verdict },
        },
        actor,
      );
    });
    if (verdict === 'infected') await this.storage.delete(file.storageKey).catch(() => undefined);
    else if (verdict === 'clean' && IMAGE_TYPES.has(file.mimeType))
      await this.thumbnail(file, sample).catch(() => undefined);
  }

  /** Pending uploads that were never completed (24 h): the object and any multipart upload go. */
  @ScheduledJob({ name: 'files.expire_pending', cron: '20 * * * *' })
  async expirePending(now: Date = new Date()): Promise<number> {
    const stale = await this.prisma.fileObject.findMany({
      where: { uploadStatus: 'pending', expiresAt: { lte: now } },
      take: 500,
    });
    for (const file of stale) {
      if (file.multipartUploadId)
        await this.storage.abortMultipart(file.storageKey, file.multipartUploadId).catch(() => undefined);
      await this.storage.delete(file.storageKey).catch(() => undefined);
      await this.prisma.fileObject.update({
        where: { id: file.id },
        data: { uploadStatus: 'failed', multipartUploadId: null },
      });
    }
    return stale.length;
  }

  private async read(key: string): Promise<{ sha256: Uint8Array<ArrayBuffer>; sample: Buffer }> {
    const hash = createHash('sha256');
    const chunks: Buffer[] = [];
    let kept = 0;
    for await (const chunk of await this.open(key)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      hash.update(buffer);
      if (kept < SAMPLE_BYTES) {
        chunks.push(buffer.subarray(0, SAMPLE_BYTES - kept));
        kept += Math.min(buffer.length, SAMPLE_BYTES - kept);
      }
    }
    return { sha256: bytes(hash.digest()), sample: Buffer.concat(chunks) };
  }

  /**
   * Opens the object, retrying a `NoSuchKey` a few times: `complete` has already seen the object
   * with HEAD, so a miss right after is the store catching up, not a lost upload.
   */
  private async open(key: string): Promise<Readable> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.storage.getStream(key);
      } catch (error) {
        const name = (error as { name?: string }).name;
        if (name !== 'NoSuchKey' || attempt >= READ_RETRIES) throw error;
        await new Promise((resolve) => setTimeout(resolve, READ_RETRY_MS * 2 ** attempt));
      }
    }
  }

  private async metadata(
    file: FileObject,
    sample: Buffer,
  ): Promise<{ widthPx?: number; heightPx?: number; pageCount?: number }> {
    if (IMAGE_TYPES.has(file.mimeType) && Number(file.sizeBytes) <= SAMPLE_BYTES) {
      const info = await sharp(sample)
        .metadata()
        .catch(() => null);
      return info?.width && info.height ? { widthPx: info.width, heightPx: info.height } : {};
    }
    if (file.mimeType === 'application/pdf') {
      const pages = sample.toString('latin1').match(/\/Type\s*\/Page(?!s)\b/g)?.length ?? 0;
      return pages > 0 ? { pageCount: pages } : {};
    }
    return {};
  }

  /** Re-makes the thumbnail of a clean image from its stored bytes (`files:rethumb`): the old row is replaced. */
  async rethumbnail(file: FileObject): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of await this.storage.getStream(file.storageKey))
      chunks.push(Buffer.from(chunk as Uint8Array));
    // The new thumbnail takes the old one's storage key (unique), so the old row goes first; a card asking in
    // between gets the original (`store.catalog.getImage` falls back), never a 404.
    await this.prisma.fileObject.deleteMany({ where: { thumbnailOfFileId: file.id } });
    await this.thumbnail(file, Buffer.concat(chunks));
  }

  private async thumbnail(file: FileObject, sample: Buffer): Promise<void> {
    if (Number(file.sizeBytes) > SAMPLE_BYTES) return;
    const image = await sharp(sample)
      .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    const key = `${file.storageKey}.thumb.webp`;
    await this.storage.put(key, image.data, 'image/webp');
    await this.prisma.fileObject.create({
      data: {
        bucket: file.bucket,
        storageKey: key,
        originalName: `${file.originalName}.thumb.webp`,
        mimeType: 'image/webp',
        sizeBytes: BigInt(image.data.length),
        sha256: bytes(createHash('sha256').update(image.data).digest()),
        widthPx: image.info.width,
        heightPx: image.info.height,
        uploadStatus: 'uploaded',
        scanStatus: 'clean',
        scannedAt: new Date(),
        retentionClass: file.retentionClass,
        ownerUserId: file.ownerUserId,
        ownerFactoryId: file.ownerFactoryId,
        ownerCompanyId: file.ownerCompanyId,
        thumbnailOfFileId: file.id,
      },
    });
  }
}
