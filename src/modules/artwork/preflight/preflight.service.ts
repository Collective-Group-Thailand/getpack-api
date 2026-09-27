import { systemActor } from '@common/context/actor';
import { PrismaService } from '@database/prisma.service';
import { type FileObject, type PreflightStatus, type Prisma } from '@generated/prisma/client';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';
import { SettingsService } from '@platform/settings/settings.service';

import { type PreflightFileReportDto } from '../artwork.dto';
import { ArtworkService } from '../artwork.service';
import { type StoredPreflightReport } from '../artwork-views';
import { boxHeight, boxWidth, type FileFacts, mmOf } from './facts';
import { pdfFacts } from './pdf-facts';
import { rasterFacts } from './raster-facts';
import { type CheckResult, evaluate, type ExpectedSize, statusOf } from './rules';

const BATCH = 5;
/** A claimed submission is retried by another worker after this long (crash safety). */
const LEASE_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;
/** Files above this are left to Prepress (the whole file is read into memory; technical bound). */
export const MAX_PREFLIGHT_BYTES = 200 * 1024 * 1024;
const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/tiff', 'image/webp']);

/**
 * The automated preflight of artwork submissions (D-070, ADR-0009): claims pending submissions whose files
 * are scanned, extracts facts per artwork file, evaluates the rules in force against the dieline template
 * sent to the customer, and stores findings (append-only per run) with a Thai report. The status is
 * `blocked` when a block check fails, `passed_with_warnings` on a failing warn check, `error` when a file
 * cannot be read, else `passed`.
 */
@Injectable()
export class PreflightService {
  private readonly logger = new Logger(PreflightService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly artwork: ArtworkService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  @ScheduledJob({ name: 'artwork.preflight', every: 10_000 })
  async runDue(now: Date = new Date()): Promise<number> {
    // Runs that kept crashing are closed as errors rather than retried for ever.
    await this.prisma.$executeRaw`
      UPDATE artwork_submissions
         SET preflight_status = 'error', preflight_completed_at = ${now}, preflight_locked_until = NULL,
             row_version = row_version + 1, updated_at = now()
       WHERE preflight_status = 'running' AND preflight_locked_until < ${now} AND preflight_attempts >= ${MAX_ATTEMPTS}`;
    const claimed = await this.prisma.$queryRaw<{ id: bigint }[]>`
      UPDATE artwork_submissions
         SET preflight_status = 'running', preflight_locked_until = ${new Date(now.getTime() + LEASE_MS)},
             preflight_attempts = preflight_attempts + 1, updated_at = now()
       WHERE id IN (
         SELECT a.id FROM artwork_submissions a
          WHERE (a.preflight_status = 'pending'
                 OR (a.preflight_status = 'running' AND a.preflight_locked_until < ${now}))
            AND a.preflight_attempts < ${MAX_ATTEMPTS}
            AND NOT EXISTS (
              SELECT 1 FROM artwork_submission_files f JOIN file_objects o ON o.id = f.file_object_id
               WHERE f.submission_id = a.id AND o.scan_status = 'pending')
          ORDER BY a.submitted_at
          LIMIT ${BATCH}
          FOR UPDATE SKIP LOCKED)
      RETURNING id`;
    for (const { id } of claimed) {
      await this.processOne(id).catch((error: unknown) => {
        this.logger.warn(
          `preflight of submission ${id} failed: ${error instanceof Error ? error.message : 'error'}`,
        );
      });
    }
    return claimed.length;
  }

  async processOne(id: bigint): Promise<void> {
    const submission = await this.prisma.artworkSubmission.findUniqueOrThrow({
      where: { id },
      include: { files: { include: { fileObject: true }, orderBy: { sort: 'asc' } }, order: true },
    });
    const rules = await this.settings.at('artwork.preflight_rules');
    const expected = await this.expectedSize(submission.orderId);
    const reports: PreflightFileReportDto[] = [];
    const findings: Prisma.PreflightFindingCreateManyInput[] = [];
    const all: CheckResult[] = [];
    let unreadable = false;
    for (const file of submission.files.filter((f) => f.role === 'artwork' || f.role === 'link')) {
      const facts: FileFacts = file.fileObject
        ? await this.factsOf(file.fileObject)
        : { kind: 'unsupported', reason: 'link' };
      if (facts.kind === 'error') unreadable = true;
      const results = evaluate(facts, expected?.size ?? null, rules.value);
      all.push(...results);
      reports.push({
        submissionFileId: file.publicId,
        name: file.fileObject?.originalName ?? file.linkUrl,
        kind: facts.kind,
        pageCount: facts.kind === 'pdf' || facts.kind === 'raster' ? facts.pageCount : null,
        thumbnailFileId: file.fileObject ? await this.thumbnailOf(file.fileObject.id) : null,
        checks: results.map((r) => ({
          check: r.check,
          outcome: r.outcome,
          severity: r.severity,
          page: r.page,
          messageTh: r.messageTh,
          messageEn: r.messageEn,
          measurements: r.measurements,
        })),
      });
      for (const r of results.filter((x) => x.outcome === 'fail')) {
        findings.push({
          submissionId: submission.id,
          fileId: file.id,
          checkKey: r.check,
          severity: r.severity,
          page: r.page,
          details: {
            ...r.measurements,
            messageTh: r.messageTh,
            messageEn: r.messageEn,
          },
        });
      }
    }
    const verdict = statusOf(all);
    const status: PreflightStatus = verdict === 'blocked' ? 'blocked' : unreadable ? 'error' : verdict;
    const last = await this.prisma.preflightFinding.aggregate({
      where: { submissionId: id },
      _max: { run: true },
    });
    const run = (last._max.run ?? 0) + 1;
    const failing = all.filter((r) => r.outcome === 'fail');
    const report: StoredPreflightReport = {
      schemaVersion: 1,
      run,
      expectedSize: expected?.size ?? null,
      files: reports,
      blockCount: failing.filter((r) => r.severity === 'block').length,
      warnCount: failing.filter((r) => r.severity === 'warn').length,
    };

    await this.prisma.withTx(async (tx) => {
      const current = await tx.artworkSubmission.findUniqueOrThrow({ where: { id } });
      if (current.preflightStatus !== 'running') return; // re-queued or closed meanwhile
      if (findings.length)
        await tx.preflightFinding.createMany({ data: findings.map((f) => ({ ...f, run })) });
      const at = new Date();
      await tx.artworkSubmission.update({
        where: { id },
        data: {
          preflightStatus: status,
          preflightReport: report as unknown as Prisma.InputJsonValue,
          preflightRefs: {
            settingVersionIds: { 'artwork.preflight_rules': String(rules.versionId) },
            dielineDeliveryId: expected?.deliveryPublicId ?? null,
          },
          preflightCompletedAt: at,
          preflightLockedUntil: null,
          rowVersion: { increment: 1 },
        },
      });
      await this.artwork.record(
        tx,
        submission.order.publicId,
        'artwork.preflight_completed',
        {
          submissionId: submission.publicId,
          versionNo: submission.versionNo,
          status,
          run,
          blockCount: report.blockCount,
          warnCount: report.warnCount,
        },
        systemActor('artwork.preflight'),
        await this.artwork.customerPublicId(tx, submission.order.customerUserId),
      );
    });
  }

  /** Facts of one stored file; unsupported types and oversized files are left to Prepress. */
  async factsOf(file: FileObject): Promise<FileFacts> {
    if (file.scanStatus === 'infected') return { kind: 'error', reason: 'infected' };
    if (file.scanStatus !== 'clean') return { kind: 'error', reason: 'not_scanned' };
    const isPdf = file.mimeType === 'application/pdf';
    if (!isPdf && !RASTER_TYPES.has(file.mimeType)) return { kind: 'unsupported', reason: 'type' };
    if (file.sizeBytes > BigInt(MAX_PREFLIGHT_BYTES)) return { kind: 'unsupported', reason: 'too_large' };
    const bytes = await this.read(file.storageKey);
    return isPdf ? pdfFacts(bytes) : rasterFacts(bytes);
  }

  /**
   * The finished size the artwork must match: the trim (else media) box of the dieline template sent last
   * to the customer — a generated drawing or the template Prepress uploaded (ADR-0009 §6). PDF only.
   */
  async expectedSize(orderId: bigint): Promise<{ size: ExpectedSize; deliveryPublicId: string } | null> {
    const delivery = await this.prisma.dielineDelivery.findFirst({
      where: { orderId },
      include: { fileObject: true, drawingJob: { include: { outputFile: true } } },
      orderBy: { sentAt: 'desc' },
    });
    const file = delivery?.fileObject ?? delivery?.drawingJob?.outputFile ?? null;
    if (!delivery || !file || file.mimeType !== 'application/pdf') return null;
    const facts = await this.factsOf(file);
    if (facts.kind !== 'pdf' || facts.pages.length === 0) return null;
    const page = facts.pages[0]!;
    const box = page.trimBox ?? page.mediaBox;
    const round = (v: number) => Math.round(v * 10) / 10;
    return {
      size: { widthMm: round(mmOf(boxWidth(box))), heightMm: round(mmOf(boxHeight(box))) },
      deliveryPublicId: delivery.publicId,
    };
  }

  private async thumbnailOf(fileId: bigint): Promise<string | null> {
    const thumb = await this.prisma.fileObject.findFirst({
      where: { thumbnailOfFileId: fileId },
      select: { publicId: true },
    });
    return thumb?.publicId ?? null;
  }

  private async read(key: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of await this.storage.getStream(key)) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  }
}
