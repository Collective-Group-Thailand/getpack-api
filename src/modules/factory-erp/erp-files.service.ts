import { OBJECT_STORAGE, type ObjectStorage } from '@collective/integrations/storage';
import { toBangkokIso } from '@common/time/bangkok';
import { ErpPrismaService } from '@database/erp-prisma.service';
import { type FileRetentionClass } from '@generated/prisma-erp/client';
import { Inject, Injectable } from '@nestjs/common';
import { FilesService } from '@platform/files/files.service';

import { type ErpPdfLinkDto } from './erp-e4.dto';
import { type ErpScope } from './erp-workspace.service';

const TTL_SECONDS = 5 * 60;

/** Files the ERP writes for a factory (D-367, D-368): stored owned by the factory, served by a short-lived link. */
@Injectable()
export class ErpFilesService {
  constructor(
    private readonly prisma: ErpPrismaService,
    private readonly files: FilesService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async store(
    scope: ErpScope,
    body: Buffer,
    fileName: string,
    mimeType: string,
    retentionClass: FileRetentionClass = 'transient',
  ): Promise<ErpPdfLinkDto & { fileId: bigint }> {
    const file = await this.files.storeSystem({
      body,
      fileName,
      mimeType,
      retentionClass,
      ownerUserId: scope.actor.userId,
      ownerFactoryId: scope.factory.id,
    });
    return { ...(await this.link(file.id)), fileId: file.id };
  }

  async link(fileId: bigint): Promise<ErpPdfLinkDto> {
    const file = await this.prisma.fileObject.findUniqueOrThrow({ where: { id: fileId } });
    const url = await this.storage.presignGet(file.storageKey, {
      expiresInSeconds: TTL_SECONDS,
      fileName: file.originalName,
      contentType: file.mimeType,
    });
    return {
      url,
      fileName: file.originalName,
      expiresAt: toBangkokIso(new Date(Date.now() + TTL_SECONDS * 1000)),
    };
  }

  /** The factory's logo as a data URI for its documents (none when it has not set one). */
  async logoDataUri(fileId: bigint | null): Promise<string | null> {
    if (!fileId) return null;
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file || file.purgedAt || !file.mimeType.startsWith('image/')) return null;
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of await this.storage.getStream(file.storageKey))
        chunks.push(Buffer.from(chunk as Buffer));
      return `data:${file.mimeType};base64,${Buffer.concat(chunks).toString('base64')}`;
    } catch {
      return null;
    }
  }
}
