import { Global, Module } from '@nestjs/common';

import { FactoryCountersService } from './factory-counters';
import { FactoryUsersService } from './factory-users.service';
import { JobsQueryService } from './jobs-query.service';
import { MilestoneRoutesService } from './milestone-routes.service';
import { MilestonesService } from './milestones.service';
import { ProductionService } from './production.service';
import { ProductionOversightService } from './production-oversight.service';

const SERVICES = [
  ProductionService,
  JobsQueryService,
  MilestonesService,
  MilestoneRoutesService,
  FactoryUsersService,
  ProductionOversightService,
  FactoryCountersService,
];

/** Production jobs, milestones, QC, inspections and scorecards (D-073…D-076, D-155, B4.2). */
@Global()
@Module({ providers: SERVICES, exports: SERVICES })
export class ProductionModule {}
