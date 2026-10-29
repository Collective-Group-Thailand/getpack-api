import { systemActor } from '@common/context/actor';
import { PrismaService } from '@database/prisma.service';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';
import { SettingsService } from '@platform/settings/settings.service';

/** Files purged per run; the rest wait for the next run (technical bound). */
const BATCH = 200;
const DAY_MS = 24 * 60 * 60_000;
export const FILE_CHECK_RETENTION_SETTING = 'artwork.file_check_retention_days';

/**
 * D-459 (C11; DECISIONS-STAGE-A §1 "files of unordered drafts are kept 90 days"): the files customers uploaded to a
 * file check (D-457) that never became an order are deleted `artwork.file_check_retention_days` (90) after the check
 * was last touched. A file qualifies only when nothing else holds it: no order artwork (submission file or production
 * copy), no cart line still carrying the checked version, no RFQ / message attachment, no Studio asset, no legal hold
 * — and every check version holding it is past the retention. The object (and its thumbnails) leave storage, the row
 * keeps `purged_at` (never deleted: history and the access log keep pointing at it) and one audit row per file names
 * the check — no file names (PDPA). Idempotent: a purged file is never selected again.
 */
@Injectable()
export class FileCheckRetention {
  private readonly logger = new Logger(FileCheckRetention.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  @ScheduledJob({ name: 'artwork.file_check_retention', cron: '40 3 * * *' })
  async run(now: Date = new Date()): Promise<number> {
    const days = Number((await this.settings.at(FILE_CHECK_RETENTION_SETTING, { at: now })).value);
    if (!Number.isInteger(days) || days < 1) return 0;
    const before = new Date(now.getTime() - days * DAY_MS);
    const due = await this.prisma.$queryRaw<{ id: bigint }[]>`
      SELECT o.id FROM file_objects o
       WHERE o.purged_at IS NULL AND o.legal_hold = false
         AND EXISTS (SELECT 1 FROM file_check_versions v WHERE v.file_object_id = o.id)
         AND NOT EXISTS (
           SELECT 1 FROM file_check_versions v JOIN file_checks c ON c.id = v.file_check_id
            WHERE v.file_object_id = o.id
              AND (v.cart_item_id IS NOT NULL OR c.updated_at > ${before} OR v.created_at > ${before}))
         AND NOT EXISTS (SELECT 1 FROM artwork_submission_files f WHERE f.file_object_id = o.id)
         AND NOT EXISTS (SELECT 1 FROM artwork_production_copies p WHERE p.source_file_id = o.id)
         AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.file_object_id = o.id)
         AND NOT EXISTS (SELECT 1 FROM design_assets d WHERE d.file_object_id = o.id)
         AND NOT EXISTS (SELECT 1 FROM conversation_messages m WHERE m.file_object_id = o.id)
       ORDER BY o.id
       LIMIT ${BATCH}`;
    const actor = systemActor('artwork.file_check_retention');
    let purged = 0;
    for (const { id } of due) {
      const done = await this.prisma.withTx(async (tx) => {
        const file = await tx.fileObject.findUnique({
          where: { id },
          include: {
            thumbnails: { select: { id: true, storageKey: true } },
            fileCheckVersions: { select: { fileCheck: { select: { publicId: true } } } },
          },
        });
        if (!file || file.purgedAt || file.legalHold) return null;
        await tx.fileObject.update({ where: { id }, data: { purgedAt: now } });
        if (file.thumbnails.length)
          await tx.fileObject.updateMany({
            where: { id: { in: file.thumbnails.map((t) => t.id) } },
            data: { purgedAt: now },
          });
        await this.audit.record(tx, {
          actor,
          category: 'data_access',
          action: 'file_check.file_purged',
          resourceType: 'file_object',
          resourcePublicId: file.publicId,
          data: {
            reason: 'unordered_retention',
            retentionDays: days,
            fileChecks: [...new Set(file.fileCheckVersions.map((v) => v.fileCheck.publicId))],
          },
        });
        return [file.storageKey, ...file.thumbnails.map((t) => t.storageKey)];
      });
      if (!done) continue;
      // Storage after the commit: a failed delete leaves an orphan object, never a live row without its bytes.
      for (const key of done)
        await this.storage.delete(key).catch((error: unknown) => {
          this.logger.warn(`purged file object not deleted from storage: ${(error as Error).message}`);
        });
      purged++;
    }
    return purged;
  }
}
