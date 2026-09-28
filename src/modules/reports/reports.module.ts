import { Global, Module } from '@nestjs/common';

import { ReportsJobs } from './reports.jobs';
import { ReportsService } from './reports.service';

/**
 * Operational reports (B6.2): report definitions, previews, files on request or on a schedule. Loaded by both
 * processes: the HTTP app serves the admin surface; the worker generates the files and runs the schedules.
 */
@Global()
@Module({ providers: [ReportsService, ReportsJobs], exports: [ReportsService] })
export class ReportsModule {}
