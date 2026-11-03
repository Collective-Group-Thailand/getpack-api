import { randomUUID } from 'node:crypto';

import { type UserActor } from '@common/context/actor';
import { bangkokDate } from '@common/time/bangkok';
import { AppConfig } from '@config/app-config';
import { PrismaService } from '@database/prisma.service';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';

const URL_TTL_SECONDS = 5 * 60;

/** D-469 / D-470: a CSV the system made from its own data, behind a 5-minute link, audited as an export. */
@Injectable()
export class SalesCsvService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async publish(
    actor: UserActor,
    name: string,
    csv: string,
    audit: { kind: string; resourceType: string; resourcePublicId?: string; rows: number },
  ): Promise<{ url: string; expiresAt: Date }> {
    const body = Buffer.from(csv, 'utf8');
    const now = new Date();
    const file = await this.prisma.fileObject.create({
      data: {
        bucket: this.config.get('S3_BUCKET'),
        storageKey: `pending/${randomUUID()}`,
        originalName: `${name}-${bangkokDate(now)}.csv`,
        mimeType: 'text/csv',
        sizeBytes: BigInt(body.length),
        uploadStatus: 'uploaded',
        scanStatus: 'clean',
        scannedAt: now,
        retentionClass: 'transient',
        ownerUserId: actor.userId,
        createdById: actor.userId,
      },
    });
    const storageKey = `transient/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${file.publicId}`;
    await this.storage.put(storageKey, body, 'text/csv; charset=utf-8');
    await this.prisma.fileObject.update({ where: { id: file.id }, data: { storageKey } });
    await this.audit.recordStandalone({
      category: 'export',
      action: 'export.generated',
      actor,
      resourceType: audit.resourceType,
      ...(audit.resourcePublicId && { resourcePublicId: audit.resourcePublicId }),
      data: { kind: audit.kind, rows: audit.rows, fileId: file.publicId },
    });
    const url = await this.storage.presignGet(storageKey, {
      expiresInSeconds: URL_TTL_SECONDS,
      fileName: file.originalName,
      contentType: 'text/csv',
    });
    return { url, expiresAt: new Date(now.getTime() + URL_TTL_SECONDS * 1000) };
  }
}
