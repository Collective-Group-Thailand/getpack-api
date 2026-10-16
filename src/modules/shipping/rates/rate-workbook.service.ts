import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { bangkokDate } from '@common/time/bangkok';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { MAX_IMPORT_ROWS } from '@modules/catalog/imports/import-engine';
import {
  type CellValue,
  readWorkbook,
  type SheetRows,
  writeWorkbook,
} from '@modules/catalog/imports/workbook';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { FilesService } from '@platform/files/files.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Reads uploaded rate-card workbooks and writes exports (Excel preview → confirm, like the catalogue
 * imports of B2.1 and A-14: the uploaded file is the only stored artefact).
 */
@Injectable()
export class RateWorkbookService {
  constructor(
    private readonly files: FilesService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
  ) {}

  async load(actor: UserActor, fileId: string): Promise<{ workbook: SheetRows[]; sha256: string }> {
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

  async export(
    actor: UserActor,
    input: {
      name: string;
      sheet: string;
      headers: string[];
      rows: Record<string, CellValue>[];
      resourceType: string;
      resourcePublicId: string;
    },
  ): Promise<{ fileId: string; url: string; rows: number; expiresAt: Date }> {
    const stored = await this.files.storeGenerated(actor, {
      body: await writeWorkbook([{ name: input.sheet, headers: input.headers, rows: input.rows }]),
      fileName: `getpack-${input.name}-${bangkokDate(new Date())}.xlsx`,
      mimeType: XLSX,
      retentionClass: 'transient',
    });
    await this.audit.recordStandalone({
      category: 'export',
      action: `${input.resourceType}.exported`,
      resourceType: input.resourceType,
      resourcePublicId: input.resourcePublicId,
      data: { fileId: stored.fileId, rows: input.rows.length },
      actor,
    });
    return { ...stored, rows: input.rows.length };
  }
}
