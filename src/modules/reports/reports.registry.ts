import { type Type } from '@nestjs/common';

import { AdminListExportsController } from './list-exports.controller';
import {
  AdminReportRunsController,
  AdminReportSchedulesController,
  AdminReportsController,
} from './reports.controller';

export const REPORTS_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminReportsController,
  AdminReportRunsController,
  AdminReportSchedulesController,
  AdminListExportsController,
];
