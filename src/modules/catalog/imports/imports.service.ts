import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { bangkokDate } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { FilesService } from '@platform/files/files.service';

import {
  type ImportKind,
  type ImportPlan,
  MAX_IMPORT_ROWS,
  MAX_REPORTED_ERRORS,
  planImport,
} from './import-engine';
import { IMPORT_KINDS } from './import-kinds';
import { type ImportPreviewDto } from './imports.dto';
import { readWorkbook, writeWorkbook } from './workbook';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Bulk writes of a whole country's subdistricts need more than Prisma's 5 s default. */
const CONFIRM_TIMEOUT_MS = 120_000;
/** Kinds that need a permission beyond `catalog.import`. */
const EXTRA_PERMISSION: Record<string, string> = {
  geography: 'geography.manage',
  national_holidays: 'business_calendar.manage',
};

/**
 * Excel import with preview → confirm, and export in the same layout (B2.1, D-005, D-170).
 * Preview is a dry run that returns counts, row errors and `previewSha256`; confirm re-plans the
 * same file inside one transaction, refuses when the plan differs from the previewed one
 * (`catalog.import_stale`) or has errors (`catalog.import_invalid`), then writes every sheet.
 */
@Injectable()
export class CatalogImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly permissions: PermissionResolver,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  kind(key: string): ImportKind {
    const kind = IMPORT_KINDS.find((k) => k.key === key);
    if (!kind) throw new DomainException('http.not_found');
    return kind;
  }

  async preview(actor: UserActor, kindKey: string, fileId: string): Promise<ImportPreviewDto> {
    const kind = await this.authorised(actor, kindKey);
    const { workbook, sha256 } = await this.load(actor, fileId);
    const plan = await planImport(this.prisma, kind, workbook, sha256);
    return this.toPreview(kind, fileId, plan);
  }

  async confirm(
    actor: UserActor,
    kindKey: string,
    fileId: string,
    previewSha256: string,
  ): Promise<ImportPreviewDto> {
    const kind = await this.authorised(actor, kindKey);
    const { workbook, sha256 } = await this.load(actor, fileId);
    const plan = await this.prisma.withTx(
      async (tx) => {
        const check = await planImport(tx, kind, workbook, sha256);
        if (check.sha256 !== previewSha256) throw new DomainException('catalog.import_stale');
        if (check.invalid > 0) throw new DomainException('catalog.import_invalid');
        const written = await planImport(tx, kind, workbook, sha256, { actorUserId: actor.userId });
        const counts = this.counts(written);
        await this.audit.record(tx, {
          category: 'config',
          action: 'catalog.import_applied',
          resourceType: 'catalog_import',
          resourcePublicId: fileId,
          data: { kind: kind.key, ...counts },
        });
        await this.events.record(tx, {
          type: 'catalog.import_applied',
          aggregateType: 'catalog_import',
          aggregateId: fileId,
          payload: { kind: kind.key, fileId, ...counts },
        });
        return check;
      },
      { timeout: CONFIRM_TIMEOUT_MS },
    );
    return this.toPreview(kind, fileId, plan);
  }

  /**
   * The current rows in the import layout (an empty table exports as the template), stored as a
   * transient file behind a 5-minute signed URL; the export is audited (`export`).
   */
  async export(
    actor: UserActor,
    kindKey: string,
  ): Promise<{ fileId: string; url: string; rows: number; expiresAt: Date }> {
    const kind = await this.authorised(actor, kindKey);
    const sheets = [];
    let rows = 0;
    for (const sheet of kind.sheets) {
      const data = await sheet.exportRows(this.prisma);
      rows += data.length;
      sheets.push({ name: sheet.name, headers: sheet.columns.map((c) => c.header), rows: data });
    }
    const stored = await this.files.storeGenerated(actor, {
      body: await writeWorkbook(sheets),
      fileName: `getpack-${kind.key}-${bangkokDate(new Date())}.xlsx`,
      mimeType: XLSX,
      retentionClass: 'transient',
    });
    await this.audit.recordStandalone({
      category: 'export',
      action: 'catalog.exported',
      resourceType: 'catalog_import',
      resourcePublicId: stored.fileId,
      data: { kind: kind.key, rows },
      actor,
    });
    return { ...stored, rows };
  }

  private async authorised(actor: UserActor, kindKey: string): Promise<ImportKind> {
    const kind = this.kind(kindKey);
    const extra = EXTRA_PERMISSION[kind.key];
    if (extra && !(await this.permissions.forUser(actor.userId)).permissions.has(extra)) {
      throw new DomainException('auth.forbidden');
    }
    return kind;
  }

  private async load(actor: UserActor, fileId: string) {
    const file = await this.files.get(actor, fileId);
    if (file.uploadStatus !== 'uploaded') throw new DomainException('file.not_ready');
    if (file.scanStatus === 'infected') throw new DomainException('file.infected');
    if (file.scanStatus !== 'clean' || !file.sha256) throw new DomainException('file.not_ready');
    if (file.mimeType !== XLSX) throw new DomainException('catalog.import_unreadable');
    const stream = await this.storage.getStream(file.storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
    const workbook = await readWorkbook(Buffer.concat(chunks));
    const rows = workbook.reduce((sum, sheet) => sum + sheet.rows.length, 0);
    if (rows > MAX_IMPORT_ROWS) {
      throw new DomainException('catalog.import_too_large', { params: { max: MAX_IMPORT_ROWS } });
    }
    return { workbook, sha256: Buffer.from(file.sha256).toString('hex') };
  }

  private counts(plan: ImportPlan) {
    const sum = (key: 'create' | 'update' | 'unchanged') => plan.sheets.reduce((n, s) => n + s[key], 0);
    return {
      create: sum('create'),
      update: sum('update'),
      unchanged: sum('unchanged'),
      invalid: plan.invalid,
    };
  }

  private toPreview(kind: ImportKind, fileId: string, plan: ImportPlan): ImportPreviewDto {
    const counts = this.counts(plan);
    return {
      kind: kind.key,
      fileId,
      previewSha256: plan.sha256,
      canConfirm: plan.invalid === 0 && counts.create + counts.update > 0,
      totals: counts,
      sheets: plan.sheets.map((s) => ({
        name: s.name,
        create: s.create,
        update: s.update,
        unchanged: s.unchanged,
        invalid: s.invalid,
      })),
      errors: plan.errors.slice(0, MAX_REPORTED_ERRORS),
      errorsTruncated: plan.errors.length > MAX_REPORTED_ERRORS,
    };
  }
}
