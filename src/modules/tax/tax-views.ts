import { dayOf } from '@common/ledger-core/dates';
import { toBangkokIso } from '@common/time/bangkok';

import { type TaxCalendarItemDto, type TaxReportDto, type TaxReportSummaryDto } from './tax.dto';
import { type TaxCalendarService } from './tax-calendar.service';
import { type ReportRow } from './tax-reports.service';

export const summaryDto = (r: ReportRow): TaxReportSummaryDto => ({
  id: r.publicId,
  kind: r.kind,
  period: dayOf(r.fiscalPeriod.startDate).slice(0, 7),
  fiscalPeriodId: r.fiscalPeriod.publicId,
  status: r.status,
  totals: r.totals as Record<string, string>,
  lineCount: r.lineCount,
  reportAmount: r.reportAmount.toFixed(2),
  glAmount: r.glAmount.toFixed(2),
  glDifference: r.glDifference.toFixed(2),
  generatedAt: toBangkokIso(r.generatedAt),
  finalisedAt: r.finalisedAt ? toBangkokIso(r.finalisedAt) : null,
  filedAt: r.filedAt ? toBangkokIso(r.filedAt) : null,
  filingRef: r.filingRef,
  paidOn: r.paidOn ? dayOf(r.paidOn) : null,
  paidAmount: r.paidAmount ? r.paidAmount.toFixed(2) : null,
  fileReady: r.fileObjectIds.length > 0,
});

export const reportDto = (r: ReportRow): TaxReportDto => ({
  ...summaryDto(r),
  lines: r.lines as Record<string, unknown>[],
});

export const calendarDto = (
  i: Awaited<ReturnType<TaxCalendarService['list']>>[number],
): TaxCalendarItemDto => ({
  id: i.publicId,
  kind: i.kind,
  period: dayOf(i.fiscalPeriod.startDate).slice(0, 7),
  dueOn: dayOf(i.dueOn),
  status: i.status,
  remindedAt: i.remindedAt ? toBangkokIso(i.remindedAt) : null,
  taxReportId: i.taxReport?.publicId ?? null,
});
