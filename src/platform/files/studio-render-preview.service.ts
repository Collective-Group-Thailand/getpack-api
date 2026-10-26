import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';

import { CustomerFileAccessService } from './customer-file-access.service';
import { FileProcessingJobs } from './file-processing.jobs';
import { FilesService } from './files.service';

/**
 * B-API-7 (D-446): the low-resolution, metadata-free preview of a Studio render for staff handling the order (support
 * through `order_support_assignments` or an open order conversation) and Prepress. The preview is the render's
 * thumbnail (`thumbnail_of_file_id`, WebP at `THUMBNAIL_WIDTH`), made now with the upload pipeline when missing.
 * The render itself stays restricted (D-444); the URL goes through `FilesService.downloadUrl`, so the access check
 * runs again and the download is logged with purpose `thumbnail`.
 */
@Injectable()
export class StudioRenderPreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CustomerFileAccessService,
    private readonly files: FilesService,
    private readonly thumbnails: FileProcessingJobs,
  ) {}

  async previewUrl(actor: Actor, renderPublicId: string): Promise<{ url: string; expiresAt: Date }> {
    const render = await this.prisma.fileObject.findUnique({ where: { publicId: renderPublicId } });
    if (
      !render ||
      render.purgedAt ||
      render.thumbnailOfFileId !== null ||
      actor.type !== 'user' ||
      actor.audience !== 'staff'
    )
      throw new DomainException('http.not_found');
    // Checked before anything is generated; 404 for a file that is not a Studio render or not handled.
    if (!(await this.access.staffMayPreview(actor.userId, render.id)))
      throw new DomainException('http.not_found');
    if (render.uploadStatus !== 'uploaded' || render.scanStatus !== 'clean')
      throw new DomainException('file.not_ready');
    const preview = await this.thumbnails.ensureThumbnail(render);
    if (!preview) throw new DomainException('file.not_ready');
    return this.files.downloadUrl(actor, preview.publicId, 'admin');
  }
}
