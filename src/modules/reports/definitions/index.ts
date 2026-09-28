import { type ReportDefinition } from '../report-types';
import { ORDERS_REPORT, QUOTATIONS_REPORT, SALES_REPORT } from './commerce.reports';
import {
  AP_AGING_REPORT,
  AR_AGING_REPORT,
  PAYMENTS_REPORT,
  PAYOUT_HISTORY_REPORT,
  SALES_TAX_REPORT,
} from './finance.reports';
import {
  CAMPAIGN_USAGE_REPORT,
  CLAIMS_REPORT,
  FACTORY_SCORECARDS_REPORT,
  POINTS_LIABILITY_REPORT,
} from './operations.reports';

/**
 * The R1 operational reports (B6.2). The legacy-style calculate / search / drawing / event-log reports and the
 * row-level promotion-usage report are R2 (D-111).
 */
export const REPORTS: readonly ReportDefinition[] = [
  SALES_REPORT,
  SALES_TAX_REPORT,
  PAYMENTS_REPORT,
  ORDERS_REPORT,
  QUOTATIONS_REPORT,
  CAMPAIGN_USAGE_REPORT,
  POINTS_LIABILITY_REPORT,
  AR_AGING_REPORT,
  AP_AGING_REPORT,
  PAYOUT_HISTORY_REPORT,
  FACTORY_SCORECARDS_REPORT,
  CLAIMS_REPORT,
];

export const REPORT_KEYS = REPORTS.map((r) => r.key);

export function reportOf(key: string): ReportDefinition | undefined {
  return REPORTS.find((r) => r.key === key);
}
