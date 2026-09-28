import { type Type } from '@nestjs/common';

import {
  AdminReportRunsController,
  AdminReportSchedulesController,
  AdminReportsController,
} from './reports.controller';

export const REPORTS_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminReportsController,
  AdminReportRunsController,
  AdminReportSchedulesController,
];
