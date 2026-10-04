import { JOB_STATUSES } from '@modules/partners/pricing/pricing.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { REPORT_KEYS } from './definitions';
import { RELATIVE_PERIODS } from './report-filters';
import { COLUMN_TYPES, FILTER_KINDS } from './report-types';

/** Operational reports (B6.2). Money cells are decimal strings with 2 decimals (THB); dates `YYYY-MM-DD`. */

export const REPORT_FORMATS = ['xlsx', 'csv'] as const;
export const FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
const FILTER_KEYS = ['period', 'channel', 'productTypeId', 'factoryId', 'status', 'provider'] as const;
const IDS = {
  run: '0192f3a0-7c1e-7d2a-9b1f-000000620001',
  schedule: '0192f3a0-7c1e-7d2a-9b1f-000000620002',
  user: '0192f3a0-7c1e-7d2a-9b1f-3c4d5e6f7a8b',
};
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export class ReportColumnDto {
  @ApiProperty({ example: 'gross' })
  key!: string;

  @ApiProperty({ example: 'รวมทั้งสิ้น' })
  labelTh!: string;

  @ApiProperty({ example: 'Gross' })
  labelEn!: string;

  @ApiProperty({ enum: COLUMN_TYPES, enumName: 'ReportColumnType', example: 'money' })
  type!: string;
  @ApiProperty({ example: true, description: 'Added up in the totals row (money and counts)' })
  total!: boolean;
}

export class ReportFilterDefDto {
  @ApiProperty({
    enum: FILTER_KEYS,
    enumName: 'ReportFilterKey',
    example: 'period',
    description: '`period` is the date filter: its kind says which query parameters it takes',
  })
  key!: string;

  @ApiProperty({
    enum: FILTER_KINDS,
    enumName: 'ReportFilterKind',
    example: 'range',
    description:
      '`range`: from + to (or period); `as_of`: asOf (or period); `month`: month (or period); `enum` / `uuid`: the key itself',
  })
  kind!: string;

  @ApiProperty({ example: true })
  required!: boolean;

  @ApiProperty({
    type: [String],
    nullable: true,
    example: null,
    description: 'Allowed values of an `enum` filter',
  })
  values!: string[] | null;
}

export class ReportDefinitionDto {
  @ApiProperty({ enum: REPORT_KEYS, enumName: 'ReportKey', example: 'sales' })
  key!: string;

  @ApiProperty({
    enum: ['sales', 'finance', 'marketing', 'operations'],
    enumName: 'ReportGroup',
    example: 'sales',
  })
  group!: string;

  @ApiProperty({ example: 'รายงานยอดขาย' })
  nameTh!: string;

  @ApiProperty({ example: 'Sales register' })
  nameEn!: string;

  @ApiProperty({ example: 'Every order of the order groups placed in the period…' })
  description!: string;

  @ApiProperty({ type: [String], example: ['D-010', 'D-020'] })
  decisions!: string[];

  @ApiProperty({ type: [ReportFilterDefDto] })
  filters!: ReportFilterDefDto[];

  @ApiProperty({ type: [ReportColumnDto] })
  columns!: ReportColumnDto[];

  @ApiProperty({ enum: REPORT_FORMATS, enumName: 'ReportFormat', isArray: true, example: ['xlsx', 'csv'] })
  formats!: string[];
}

/** Filters in the query string of a preview (each report uses the subset its catalogue entry lists). */
export class ReportFilterQuery {
  @ApiPropertyOptional({ format: 'date', example: '2026-10-01' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-31' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-31', description: 'Aging reports' })
  @IsOptional()
  @IsString()
  asOf?: string;

  @ApiPropertyOptional({ example: '2026-10', description: 'Monthly reports (YYYY-MM)' })
  @IsOptional()
  @IsString()
  month?: string;

  @ApiPropertyOptional({
    enum: RELATIVE_PERIODS,
    enumName: 'RelativePeriod',
    description: 'Instead of explicit dates (Asia/Bangkok)',
  })
  @IsOptional()
  @IsString()
  period?: string;

  @ApiPropertyOptional({ example: 'web' })
  @IsOptional()
  @IsString()
  channel?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsString()
  productTypeId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsString()
  factoryId?: string;

  @ApiPropertyOptional({ example: 'completed' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'scb' })
  @IsOptional()
  @IsString()
  provider?: string;
}

export class ReportFiltersDto {
  @ApiPropertyOptional({
    enum: RELATIVE_PERIODS,
    enumName: 'RelativePeriod',
    example: 'previous_month',
    description: 'Relative period (required on schedules); or explicit dates below',
  })
  @IsOptional()
  @IsIn(RELATIVE_PERIODS)
  period?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-01' })
  @IsOptional()
  @Matches(DAY)
  from?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-31' })
  @IsOptional()
  @Matches(DAY)
  to?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-31' })
  @IsOptional()
  @Matches(DAY)
  asOf?: string;

  @ApiPropertyOptional({ example: '2026-10' })
  @IsOptional()
  @Matches(MONTH)
  month?: string;

  @ApiPropertyOptional({ example: 'web' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  channel?: string;

  @ApiPropertyOptional({ example: '0192f3a0-7c1e-7d2a-9b1f-0000000b2022', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  productTypeId?: string;

  @ApiPropertyOptional({ example: '0192f3a0-7c1e-7d2a-9b1f-0000000b2021', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  factoryId?: string;

  @ApiPropertyOptional({ example: 'completed' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  status?: string;

  @ApiPropertyOptional({ example: 'scb' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  provider?: string;
}

export class ResolvedReportFiltersDto {
  @ApiPropertyOptional({ format: 'date', nullable: true, example: '2026-10-01' })
  from?: string;

  @ApiPropertyOptional({ format: 'date', nullable: true, example: '2026-10-31' })
  to?: string;

  @ApiPropertyOptional({ format: 'date', nullable: true, example: null })
  asOf?: string;

  @ApiPropertyOptional({ nullable: true, example: null })
  month?: string;

  @ApiPropertyOptional({ nullable: true, example: 'web' })
  channel?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, example: null })
  productTypeId?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, example: null })
  factoryId?: string;

  @ApiPropertyOptional({ nullable: true, example: null })
  status?: string;

  @ApiPropertyOptional({ nullable: true, example: null })
  provider?: string;
}

export class ReportPreviewDto {
  @ApiProperty({ enum: REPORT_KEYS, enumName: 'ReportKey', example: 'sales' })
  reportKey!: string;

  @ApiProperty({ type: ResolvedReportFiltersDto })
  filters!: ResolvedReportFiltersDto;

  @ApiProperty({ type: [ReportColumnDto] })
  columns!: ReportColumnDto[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean', 'null'] } },
    description: 'Rows keyed by column key; money as decimal strings',
    example: [{ orderCode: 'ORD-2610-00012', gross: '10700.00', quantity: 1000 }],
  })
  rows!: Record<string, string | number | boolean | null>[];

  @ApiProperty({
    example: false,
    description: 'More rows than the preview limit (200): export the file for all of them',
  })
  truncated!: boolean;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: ['string', 'number'] },
    example: { gross: '10700.00', quantity: 1000 },
    description: 'Sum of every row of the report (not only the previewed ones) for the totalled columns',
  })
  totals!: Record<string, string | number>;

  @ApiProperty({ format: 'date-time', example: '2026-11-01T09:00:00+07:00' })
  generatedAt!: string;
}

export class CreateReportExportDto {
  @ApiProperty({ enum: REPORT_FORMATS, enumName: 'ReportFormat', example: 'xlsx' })
  @IsIn(REPORT_FORMATS)
  format!: (typeof REPORT_FORMATS)[number];

  @ApiProperty({ type: ReportFiltersDto })
  @ValidateNested()
  @Type(() => ReportFiltersDto)
  filters!: ReportFiltersDto;
}

export class ReportRunDto {
  @ApiProperty({ format: 'uuid', example: IDS.run })
  id!: string;

  @ApiProperty({ enum: REPORT_KEYS, enumName: 'ReportKey', example: 'sales' })
  reportKey!: string;

  @ApiProperty({ enum: REPORT_FORMATS, enumName: 'ReportFormat', example: 'xlsx' })
  format!: string;

  @ApiProperty({ enum: JOB_STATUSES, enumName: 'JobStatus', example: 'succeeded' })
  status!: string;

  @ApiProperty({ type: ResolvedReportFiltersDto })
  filters!: ResolvedReportFiltersDto;

  @ApiProperty({ type: 'integer', nullable: true, example: 128 })
  rowCount!: number | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  error!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'The schedule that produced it',
  })
  scheduleId!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-11-01T07:00:00+07:00' })
  queuedAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-11-01T07:00:12+07:00' })
  finishedAt!: string | null;
}

export class ReportRunQuery {
  @ApiPropertyOptional({ enum: REPORT_KEYS, enumName: 'ReportKey' })
  @IsOptional()
  @IsIn(REPORT_KEYS)
  reportKey?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  scheduleId?: string;
}

export class CreateReportScheduleDto {
  @ApiProperty({ enum: REPORT_KEYS, enumName: 'ReportKey', example: 'ar_aging' })
  @IsIn(REPORT_KEYS)
  reportKey!: string;

  @ApiProperty({ example: 'AR aging — every Monday', maxLength: 120 })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: REPORT_FORMATS, enumName: 'ReportFormat', example: 'xlsx' })
  @IsIn(REPORT_FORMATS)
  format!: (typeof REPORT_FORMATS)[number];

  @ApiProperty({ enum: FREQUENCIES, enumName: 'ReportFrequency', example: 'weekly' })
  @IsIn(FREQUENCIES)
  frequency!: (typeof FREQUENCIES)[number];

  @ApiProperty({ example: '07:00', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: 'Asia/Bangkok' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  runAt!: string;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: 7,
    example: 1,
    description: 'Weekly: ISO weekday (1 = Monday)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek?: number;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: 28,
    example: 1,
    description: 'Monthly: day of month (1–28)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  dayOfMonth?: number;

  @ApiProperty({ type: ReportFiltersDto, description: 'With a relative `period` for the date filter' })
  @ValidateNested()
  @Type(() => ReportFiltersDto)
  filters!: ReportFiltersDto;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    example: [IDS.user],
    description: 'Staff who may read and export the report',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  recipientIds!: string[];
}

export class ReportScheduleDto {
  @ApiProperty({ format: 'uuid', example: IDS.schedule })
  id!: string;

  @ApiProperty({ enum: REPORT_KEYS, enumName: 'ReportKey', example: 'ar_aging' })
  reportKey!: string;

  @ApiProperty({ example: 'AR aging — every Monday' })
  name!: string;

  @ApiProperty({ enum: REPORT_FORMATS, enumName: 'ReportFormat', example: 'xlsx' })
  format!: string;

  @ApiProperty({ enum: FREQUENCIES, enumName: 'ReportFrequency', example: 'weekly' })
  frequency!: string;

  @ApiProperty({
    example: '07:00',
    pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
    description: 'Time of day, Asia/Bangkok',
  })
  runAt!: string;

  @ApiProperty({ type: 'integer', nullable: true, example: 1 })
  dayOfWeek!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: null })
  dayOfMonth!: number | null;

  @ApiProperty({ type: ReportFiltersDto })
  filters!: ReportFiltersDto;

  @ApiProperty({ type: [UserRefDto] })
  recipients!: UserRefDto[];

  @ApiProperty({ example: true })
  active!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-11-02T07:00:00+07:00' })
  nextRunAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  lastRunAt!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-28T15:00:00+07:00' })
  createdAt!: string;
}

export const EXAMPLES = { ids: IDS };
