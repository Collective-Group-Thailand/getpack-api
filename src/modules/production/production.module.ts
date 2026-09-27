import { Global, Module } from '@nestjs/common';

import { FactoryUsersService } from './factory-users.service';
import { JobsQueryService } from './jobs-query.service';
import { MilestoneRoutesService } from './milestone-routes.service';
import { MilestonesService } from './milestones.service';
import { ProductionService } from './production.service';

/** Production jobs, milestones, QC, inspections and scorecards (D-073…D-076, B4.2). */
@Global()
@Module({
  providers: [
    ProductionService,
    JobsQueryService,
    MilestonesService,
    MilestoneRoutesService,
    FactoryUsersService,
  ],
  exports: [
    ProductionService,
    JobsQueryService,
    MilestonesService,
    MilestoneRoutesService,
    FactoryUsersService,
  ],
})
export class ProductionModule {}
