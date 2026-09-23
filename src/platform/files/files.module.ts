import { Global, Module } from '@nestjs/common';

import { FileProcessingJobs } from './file-processing.jobs';
import { FilesService } from './files.service';

/** Files (schema-design §2.8). Both processes: HTTP presign/download, worker scan/metadata/thumbnails. */
@Global()
@Module({ providers: [FilesService, FileProcessingJobs], exports: [FilesService, FileProcessingJobs] })
export class FilesModule {}
