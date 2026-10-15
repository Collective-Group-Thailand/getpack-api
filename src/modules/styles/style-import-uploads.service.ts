import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { Inject, Injectable } from '@nestjs/common';
import { FilesService } from '@platform/files/files.service';

import { brief, StyleImportService } from './style-import.service';
import { type StyleImportPreviewDto, type StyleImportResultDto } from './styles-admin.dto';
import { StylesAdminService } from './styles-admin.service';

type Kind = StyleImportPreviewDto['kind'];

/**
 * D-411: the style library's imports from the admin — the same plan and run as `pnpm styles:import` (D-242), on a
 * JSON file uploaded with purpose `import`. Preview is a dry run; confirm re-plans the same file and refuses when its
 * checksum is not the previewed one, so what was reviewed is what is written. Changes to published rows are held for
 * the `style_library_change` approval as from the command line.
 */
@Injectable()
export class StyleImportUploadsService {
  constructor(
    private readonly imports: StyleImportService,
    private readonly admin: StylesAdminService,
    private readonly files: FilesService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async preview(actor: UserActor, kind: Kind, fileId: string): Promise<StyleImportPreviewDto> {
    const plan = await this.plan(actor, kind, fileId);
    const { axes: _axes, ...shown } = plan;
    return {
      ...shown,
      direct: plan.direct.map(brief),
      pending: plan.pending.map(brief),
    };
  }

  async confirm(
    actor: UserActor,
    kind: Kind,
    fileId: string,
    checksum: string,
  ): Promise<StyleImportResultDto> {
    const plan = await this.plan(actor, kind, fileId);
    if (plan.checksum !== checksum) throw new DomainException('styles.import_stale');
    if (plan.noop) return { run: null, noopReason: plan.noopReason };
    const run = await this.imports.apply(actor, plan);
    return { run: run ? await this.admin.run(run.publicId) : null, noopReason: null };
  }

  private async plan(actor: UserActor, kind: Kind, fileId: string) {
    const file = await this.files.get(actor, fileId);
    if (file.uploadStatus !== 'uploaded') throw new DomainException('file.not_ready');
    if (file.scanStatus === 'infected') throw new DomainException('file.infected');
    if (file.scanStatus !== 'clean') throw new DomainException('file.not_ready');
    if (file.mimeType !== 'application/json') throw new DomainException('styles.import_unreadable');
    const stream = await this.storage.getStream(file.storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
    const content = Buffer.concat(chunks).toString('utf8');
    try {
      return await this.imports.plan(kind, file.originalName, content);
    } catch (error) {
      if (error instanceof DomainException) throw error;
      // Not JSON, or not the shape of a master file / recipe bundle.
      throw new DomainException('styles.import_unreadable', {
        params: { reason: (error as Error).message.slice(0, 300) },
      });
    }
  }
}
