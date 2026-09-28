import { type Type } from '@nestjs/common';

import { AdminFinancialReportsController } from './financial-reports.controller';

export const FINANCIAL_REPORTS_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminFinancialReportsController];
