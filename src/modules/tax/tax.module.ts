import { Global, Module } from '@nestjs/common';

import { TaxJobs } from './tax.jobs';
import { TaxCalendarService } from './tax-calendar.service';
import { TaxReportsService } from './tax-reports.service';

const SERVICES = [TaxCalendarService, TaxReportsService];

/** Tax (B5.4, accounting-design §2, §6, §7 step 7): reports and working papers reconciled to the GL, tax calendar. */
@Global()
@Module({ providers: [...SERVICES, TaxJobs], exports: SERVICES })
export class TaxModule {}
