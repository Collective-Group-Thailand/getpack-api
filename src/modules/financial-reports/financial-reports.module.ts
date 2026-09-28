import { Global, Module } from '@nestjs/common';

import { FinancialReportsService } from './financial-reports.service';

/** Financial reports (B5.6): trial balance, GL detail, balance sheet, P&L by dimension, indirect cash flow. */
@Global()
@Module({ providers: [FinancialReportsService], exports: [FinancialReportsService] })
export class FinancialReportsModule {}
