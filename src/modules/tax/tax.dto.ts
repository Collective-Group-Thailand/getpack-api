import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

/** Tax reports and working papers (B5.4, accounting-design §2, §6, §7 step 7). Money: strings, THB. */

export const REPORT_KINDS = ['sales_tax', 'purchase_tax', 'pp30', 'pnd3', 'pnd53', 'wht_issued_register', 'wht_received_register'] as const;
export const REPORT_STATUSES = ['draft', 'final', 'filed'] as const;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const TAX_IDS = {
  report: '0192f3a0-7c1e-7d2a-9b1f-000000540001',
  period: '0192f3a0-7c1e-7d2a-9b1f-000000510010',
  bank: '0192f3a0-7c1e-7d2a-9b1f-000000530103',
  item: '0192f3a0-7c1e-7d2a-9b1f-000000540002',
};

export class TaxReportSummaryDto {
  @ApiProperty({ format: 'uuid', example: TAX_IDS.report })
  id!: string;

  @ApiProperty({ enum: REPORT_KINDS, enumName: 'TaxReportKind', example: 'pp30' })
  kind!: string;

  @ApiProperty({ example: '2026-10', description: 'Month (YYYY-MM)' })
  period!: string;

  @ApiProperty({ format: 'uuid', example: TAX_IDS.period })
  fiscalPeriodId!: string;

  @ApiProperty({ enum: REPORT_STATUSES, enumName: 'TaxReportStatus', example: 'final' })
  status!: string;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, example: { outputVat: '700.00', inputVat: '560.00', netPayable: '140.00' } })
  totals!: Record<string, string>;

  @ApiProperty({ type: 'integer', example: 12 })
  lineCount!: number;

  @ApiProperty({ example: '140.00', description: 'What the report says' })
  reportAmount!: string;

  @ApiProperty({ example: '140.00', description: 'Movement of its GL control accounts (setting `tax.gl_accounts`)' })
  glAmount!: string;

  @ApiProperty({ example: '0.00', description: 'Must be 0 to finalise (§7 step 7)' })
  glDifference!: string;

  @ApiProperty({ format: 'date-time', example: '2026-11-05T10:00:00+07:00' })
  generatedAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-11-05T10:05:00+07:00' })
  finalisedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  filedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  filingRef!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: null })
  paidOn!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  paidAmount!: string | null;

  @ApiProperty({ example: true, description: 'Its CSV export (for ภ.ง.ด.3 / 53 the attachment) is stored' })
  fileReady!: boolean;
}

export class TaxReportDto extends TaxReportSummaryDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Report lines (columns per kind: VAT reports by source document; WHT by certificate)',
    example: [{ seq: 1, documentDate: '2026-10-05', documentNo: 'DEVTR-2610-00001', partyName: 'บริษัท ตัวอย่าง จำกัด (fake)', partyTaxId: '0000000000001', partyBranch: '00000', base: '1000.00', vat: '70.00', late: false }],
  })
  lines!: Record<string, unknown>[];
}

export const REPORT_EXAMPLE: TaxReportDto = {
  id: TAX_IDS.report,
  kind: 'sales_tax',
  period: '2026-10',
  fiscalPeriodId: TAX_IDS.period,
  status: 'draft',
  totals: { vat: '70.00', base: '1000.00' },
  lineCount: 1,
  reportAmount: '70.00',
  glAmount: '70.00',
  glDifference: '0.00',
  generatedAt: '2026-11-05T10:00:00+07:00',
  finalisedAt: null,
  filedAt: null,
  filingRef: null,
  paidOn: null,
  paidAmount: null,
  fileReady: false,
  lines: [{ seq: 1, documentDate: '2026-10-05', documentNo: 'DEVTR-2610-00001', partyName: 'บริษัท ตัวอย่าง จำกัด (fake)', partyTaxId: '0000000000001', partyBranch: '00000', base: '1000.00', vat: '70.00', late: false }],
};
const { lines: _lines, ...SUMMARY } = REPORT_EXAMPLE;
export const SUMMARY_EXAMPLE: TaxReportSummaryDto = SUMMARY;

export class GenerateTaxReportDto {
  @ApiProperty({ enum: REPORT_KINDS, enumName: 'TaxReportKind', example: 'pp30' })
  @IsIn(REPORT_KINDS)
  kind!: (typeof REPORT_KINDS)[number];

  @ApiProperty({ example: '2026-10', pattern: MONTH.source })
  @Matches(MONTH)
  period!: string;
}

export class TaxReportListQuery {
  @ApiPropertyOptional({ example: '2026-10', pattern: MONTH.source })
  @IsOptional()
  @Matches(MONTH)
  period?: string;

  @ApiPropertyOptional({ enum: REPORT_KINDS, enumName: 'TaxReportKind' })
  @IsOptional()
  @IsIn(REPORT_KINDS)
  kind?: (typeof REPORT_KINDS)[number];
}

export class FileTaxReportDto {
  @ApiProperty({ example: 'RD-2611-000123', description: 'The Revenue Department’s filing reference' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  filingRef!: string;

  @ApiPropertyOptional({ format: 'date-time', example: '2026-11-14T10:00:00+07:00', description: 'Default: now' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  filedAt?: Date;
}

export class PayTaxReportDto {
  @ApiProperty({ format: 'date', example: '2026-11-14' })
  @Matches(DAY)
  paidOn!: string;

  @ApiProperty({ format: 'uuid', example: TAX_IDS.bank })
  @IsUUID()
  companyBankAccountId!: string;
}

export class TaxCalendarItemDto {
  @ApiProperty({ format: 'uuid', example: TAX_IDS.item })
  id!: string;

  @ApiProperty({ enum: ['pp30', 'pnd3', 'pnd53'], enumName: 'TaxFilingKind', example: 'pnd53' })
  kind!: string;

  @ApiProperty({ example: '2026-10' })
  period!: string;

  @ApiProperty({ format: 'date', example: '2026-11-07' })
  dueOn!: string;

  @ApiProperty({ enum: ['open', 'done'], enumName: 'TaxCalendarStatus', example: 'open' })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-11-04T08:00:00+07:00' })
  remindedAt!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  taxReportId!: string | null;
}

export const CALENDAR_EXAMPLE: TaxCalendarItemDto = { id: TAX_IDS.item, kind: 'pnd53', period: '2026-10', dueOn: '2026-11-07', status: 'open', remindedAt: '2026-11-04T08:00:00+07:00', taxReportId: null };

export class TaxCalendarQuery {
  @ApiPropertyOptional({ enum: ['open', 'done'], enumName: 'TaxCalendarStatus' })
  @IsOptional()
  @IsIn(['open', 'done'])
  status?: 'open' | 'done';
}
