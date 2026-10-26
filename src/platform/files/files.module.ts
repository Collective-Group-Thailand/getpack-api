import { Global, Module } from '@nestjs/common';

import { CustomerFileAccessService } from './customer-file-access.service';
import { FileProcessingJobs } from './file-processing.jobs';
import { FilesService } from './files.service';
import { StudioRenderPreviewService } from './studio-render-preview.service';
import { SupportAssignmentJobs } from './support-assignment.jobs';

/** Files (schema-design §2.8). Both processes: HTTP presign/download, worker scan/metadata/thumbnails. */
@Global()
@Module({
  providers: [
    FilesService,
    FileProcessingJobs,
    CustomerFileAccessService,
    SupportAssignmentJobs,
    StudioRenderPreviewService,
  ],
  exports: [FilesService, FileProcessingJobs, CustomerFileAccessService, StudioRenderPreviewService],
})
export class FilesModule {}
