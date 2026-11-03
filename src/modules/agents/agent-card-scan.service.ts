import { type Readable } from 'node:stream';

import { systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import { type SalesAgent } from '@generated/prisma/client';
import { OCR, type OcrLine, type OcrPort } from '@integrations/ocr/ocr.port';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { FILE_PURPOSES } from '@platform/files/file-purposes';
import { SettingsService } from '@platform/settings/settings.service';

import { DAY_MS, recordAgentEvent } from './agent-shared';
import { parseCard, type ParsedCard } from './card-parser';

const LANGUAGES = ['tha', 'eng'] as const;
const PURGE_BATCH = 200;

async function readAll(stream: Readable, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += b.length;
    if (size > max) throw new DomainException('file.too_large');
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

/**
 * D-468 (Phase 3 item 6): "สแกนนามบัตร" — the agent uploads a photo (purpose `agent_card_scan`), the API reads it
 * (OCR tha+eng through `OcrPort`) and returns parsed fields with a confidence each. Nothing is saved from it: the
 * agent reviews the fields and registers the lead (source `card_scan`). The photo is deleted after
 * `agents.card_scan_retention_days` (7). Neither the image nor its text is ever logged (PDPA).
 */
@Injectable()
export class AgentCardScanService {
  private readonly logger = new Logger(AgentCardScanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    @Inject(OCR) private readonly ocr: OcrPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    readonly events: DomainEvents,
    readonly activity: ActivityLogService,
  ) {}

  async scan(
    actor: UserActor,
    agent: SalesAgent,
    filePublicId: string,
    languages: readonly string[] = LANGUAGES,
  ): Promise<{ fileId: string; engine: string; lines: OcrLine[]; fields: ParsedCard; deleteAfter: Date }> {
    if (agent.status !== 'active') throw new DomainException('agents.agent_inactive');
    const file = await this.prisma.fileObject.findUnique({ where: { publicId: filePublicId } });
    if (
      !file ||
      file.purpose !== 'agent_card_scan' ||
      file.purgedAt ||
      (file.ownerUserId !== actor.userId && file.createdById !== actor.userId)
    )
      throw new DomainException('http.not_found');
    if (file.uploadStatus !== 'uploaded') throw new DomainException('file.upload_incomplete');
    if (file.scanStatus === 'infected') throw new DomainException('file.infected');
    if (file.scanStatus !== 'clean') throw new DomainException('file.not_ready');
    const now = new Date();
    const days = await this.settings.value('agents.card_scan_retention_days', now);
    const deleteAfter = new Date(file.createdAt.getTime() + days * DAY_MS);
    let result;
    try {
      const image = await readAll(
        await this.storage.getStream(file.storageKey),
        FILE_PURPOSES.agent_card_scan.maxBytes,
      );
      result = await this.ocr.recognise(image, languages.length ? [...new Set(languages)] : LANGUAGES);
    } catch (error) {
      if (error instanceof DomainException) throw error;
      // The reason only — never the image or any text read from it (PDPA).
      this.logger.warn(`card scan failed: ${(error as Error).message}`);
      throw new DomainException('agents.card_scan_failed');
    }
    const fields = parseCard(result.lines);
    await this.prisma.withTx(async (tx) => {
      if (!file.expiresAt)
        await tx.fileObject.update({ where: { id: file.id }, data: { expiresAt: deleteAfter } });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_lead.card_scanned',
        aggregateType: 'sales_agent',
        aggregateId: agent.publicId,
        // No contact data in the event (PDPA): which file, which engine, which fields were found.
        payload: {
          fileId: file.publicId,
          engine: result.engine,
          found: Object.entries(fields)
            .filter(([, v]) => (Array.isArray(v) ? v.length > 0 : v !== null))
            .map(([k]) => k),
        },
        actor,
      });
    });
    return { fileId: file.publicId, engine: result.engine, lines: result.lines, fields, deleteAfter };
  }

  /** Scheduled daily: card photos older than the retention leave storage; the row keeps `purged_at` (audited). */
  async purge(now = new Date()): Promise<number> {
    const days = await this.settings.value('agents.card_scan_retention_days', now);
    const before = new Date(now.getTime() - days * DAY_MS);
    const due = await this.prisma.fileObject.findMany({
      where: { purpose: 'agent_card_scan', purgedAt: null, legalHold: false, createdAt: { lte: before } },
      select: { id: true },
      take: PURGE_BATCH,
      orderBy: { id: 'asc' },
    });
    const actor = systemActor('agents.card_scan_purge');
    let purged = 0;
    for (const { id } of due) {
      const keys = await this.prisma.withTx(async (tx) => {
        const file = await tx.fileObject.findUnique({
          where: { id },
          include: { thumbnails: { select: { id: true, storageKey: true } } },
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
          action: 'agent_card_scan.file_purged',
          resourceType: 'file_object',
          resourcePublicId: file.publicId,
          data: { retentionDays: days },
        });
        return [file.storageKey, ...file.thumbnails.map((t) => t.storageKey)];
      });
      if (!keys) continue;
      purged += 1;
      // After the commit: a failed delete leaves an orphan object, never a live row without its bytes.
      for (const key of keys)
        await this.storage.delete(key).catch((error: unknown) => {
          this.logger.warn(`card photo not deleted from storage: ${(error as Error).message}`);
        });
    }
    return purged;
  }
}
