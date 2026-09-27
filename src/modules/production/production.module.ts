import { Global, Module } from '@nestjs/common';

import { JobsQueryService } from './jobs-query.service';
import { ProductionService } from './production.service';

/** Production jobs, milestones, QC, inspections and scorecards (D-073…D-076, B4.2). */
@Global()
@Module({
  providers: [ProductionService, JobsQueryService],
  exports: [ProductionService, JobsQueryService],
})
export class ProductionModule {}
