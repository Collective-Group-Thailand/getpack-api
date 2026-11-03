import { PageQuery } from '@common/pagination/pagination.dto';
import { LocalisedTextDto } from '@modules/styles/style-library-settings.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { PNL_LINE_CALCS, PNL_LINE_GROUPS, PNL_LINE_KEYS, PNL_LINE_UNITS } from './pnl-lines';
import { PNL_SCENARIOS } from './pnl-plans.service';

/**
 * D-472 contract of the management P&L planner. Money and ratios are decimal strings (2 places); days and percent
 * memo lines too (`unit` tells which). Months are `YYYY-MM` (Asia/Bangkok calendar).
 */

export const PNL_PLAN_STATUSES = ['draft', 'locked'] as const;
export const PNL_CELL_MODES = ['auto', 'calculated', 'manual', 'override'] as const;
export const PNL_CELL_SOURCES = [
  'gl',
  'pipeline_run_rate',
  'trailing_ratio',
  'trailing_average',
  'commission_rates',
  'fixed_assets',
  'balances',
  'formula',
  'none',
] as const;
export const PNL_MONTH_KINDS = ['actual', 'forecast'] as const;
export const PERIOD_STATUSES = ['open', 'soft_closed', 'closed', 'locked'] as const;
export const PNL_ACTUAL_BASES = ['ledger', 'calculated', 'includes_plan_values', 'none', 'not_yet'] as const;
export const PNL_SOURCE_KINDS = [
  'gl_line',
  'commission',
  'lead',
  'fixed_asset',
  'customer_run_rate',
] as const;
export const PNL_EXPORT_FORMATS = ['xlsx', 'pdf'] as const;
export const PNL_EXPORT_VIEWS = ['plan', 'variance'] as const;

export const PLAN_ID = '0192f3a0-7c1e-7d2a-9b1f-0000000a0472';
const USER = { id: '0192f3a0-7c1e-7d2a-9b1f-3c4d5e6f7a8b', displayName: 'การเงิน ทดสอบ' };
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// --- line catalogue ---------------------------------------------------------------------------------------------------

export class PnlGlAccountDto {
  @ApiProperty({ example: '4110' })
  code!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'รายได้ — บรรจุภัณฑ์สั่งผลิต',
    description: 'null: not in the chart',
  })
  nameTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Sales — made-to-order packaging' })
  nameEn!: string | null;

  @ApiProperty({ type: [String], example: [], description: 'Only journal lines of these posting rules' })
  onlyRules!: string[];

  @ApiProperty({
    type: [String],
    example: [],
    description: 'Journal lines of these posting rules are left out',
  })
  excludeRules!: string[];
}

export class PnlLineDto {
  @ApiProperty({ enum: PNL_LINE_KEYS, enumName: 'PnlLineKey', example: 'revenue_goods' })
  key!: (typeof PNL_LINE_KEYS)[number];

  @ApiProperty({ enum: PNL_LINE_GROUPS, enumName: 'PnlLineGroup', example: 'revenue' })
  group!: (typeof PNL_LINE_GROUPS)[number];

  @ApiProperty({ enum: PNL_LINE_UNITS, enumName: 'PnlLineUnit', example: 'money' })
  unit!: (typeof PNL_LINE_UNITS)[number];

  @ApiProperty({
    enum: PNL_LINE_CALCS,
    enumName: 'PnlLineCalc',
    example: 'source',
    description: '`source`: from the system or entered; `formula`: calculated from other lines (read-only)',
  })
  calc!: (typeof PNL_LINE_CALCS)[number];

  @ApiProperty({ example: true, description: 'Part of the P&L; memo lines are not' })
  inTotal!: boolean;

  @ApiProperty({ example: true, description: 'A person may enter (manual) or override (auto) its cells' })
  editable!: boolean;

  @ApiProperty({
    example: false,
    description: 'Has GL accounts; an editable line without them is filled by hand',
  })
  mapped!: boolean;

  @ApiProperty({ example: 'รายได้จากการขายสินค้า' })
  labelTh!: string;

  @ApiProperty({ example: 'Revenue — goods' })
  labelEn!: string;

  @ApiProperty({ type: LocalisedTextDto, description: 'Tooltip: what the line is' })
  definition!: LocalisedTextDto;

  @ApiProperty({ type: LocalisedTextDto, description: 'Tooltip: how it is calculated' })
  formula!: LocalisedTextDto;

  @ApiProperty({ type: LocalisedTextDto, description: 'Tooltip: where the system takes it from' })
  source!: LocalisedTextDto;

  @ApiProperty({
    type: LocalisedTextDto,
    nullable: true,
    description: 'Tooltip for an empty manual cell (lines a person may enter)',
  })
  howToFill!: LocalisedTextDto | null;

  @ApiProperty({ type: [PnlGlAccountDto] })
  glAccounts!: PnlGlAccountDto[];
}

export class PnlLineCatalogueDto {
  @ApiProperty({
    format: 'date-time',
    example: '2026-11-03T00:00:00+07:00',
    description: 'The catalogue version in force since',
  })
  effectiveFrom!: string;

  @ApiProperty({ type: [PnlLineDto] })
  lines!: PnlLineDto[];
}

// --- plans ------------------------------------------------------------------------------------------------------------

export class PnlPlanDto {
  @ApiProperty({ format: 'uuid', example: PLAN_ID })
  id!: string;

  @ApiProperty({ example: 'แผนปี 2027' })
  name!: string;

  @ApiProperty({
    type: 'integer',
    example: 2027,
    description: 'Calendar year (months Jan–Dec, Asia/Bangkok)',
  })
  fiscalYear!: number;

  @ApiProperty({ enum: PNL_SCENARIOS, enumName: 'PnlScenario', example: 'base' })
  scenario!: (typeof PNL_SCENARIOS)[number];

  @ApiProperty({ enum: PNL_PLAN_STATUSES, enumName: 'PnlPlanStatus', example: 'draft' })
  status!: (typeof PNL_PLAN_STATUSES)[number];

  @ApiProperty({
    type: 'integer',
    example: 1,
    description: 'Next version of the same name, year and scenario on copy',
  })
  version!: number;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ type: UserRefDto })
  owner!: UserRefDto;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  copiedFromId!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-11-03T10:00:00+07:00',
    description: 'Last refresh from the system (null: never computed)',
  })
  computedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  lockedAt!: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  lockedBy!: UserRefDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'SHA-256 (hex) of the cells at lock',
  })
  snapshotSha256!: string | null;

  @ApiProperty({
    example: '"pXH2c5mJ3Lr0v1QkTqv2xQ"',
    description: 'Send as If-Match to update, recompute, lock, delete',
  })
  etag!: string;

  @ApiProperty({ format: 'date-time', example: '2026-11-03T09:00:00+07:00' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-11-03T10:00:00+07:00' })
  updatedAt!: string;
}

export class PnlPlanListQuery extends PageQuery {
  @ApiPropertyOptional({ type: 'integer', example: 2027 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2200)
  fiscalYear?: number;

  @ApiPropertyOptional({ enum: PNL_SCENARIOS, enumName: 'PnlScenario' })
  @IsOptional()
  @IsIn(PNL_SCENARIOS)
  scenario?: (typeof PNL_SCENARIOS)[number];

  @ApiPropertyOptional({ enum: PNL_PLAN_STATUSES, enumName: 'PnlPlanStatus' })
  @IsOptional()
  @IsIn(PNL_PLAN_STATUSES)
  status?: (typeof PNL_PLAN_STATUSES)[number];
}

export class CreatePnlPlanDto {
  @ApiProperty({ example: 'แผนปี 2027', minLength: 1, maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ type: 'integer', example: 2027, minimum: 2000, maximum: 2200 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2200)
  fiscalYear!: number;

  @ApiProperty({ enum: PNL_SCENARIOS, enumName: 'PnlScenario', example: 'base' })
  @IsIn(PNL_SCENARIOS)
  scenario!: (typeof PNL_SCENARIOS)[number];

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'ตามเป้าที่ประชุมผู้บริหาร',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class UpdatePnlPlanDto {
  @ApiPropertyOptional({ example: 'แผนปี 2027 (ปรับ)', minLength: 1, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'ปรับตามยอดไตรมาส 1', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class CopyPnlPlanDto {
  @ApiProperty({ enum: PNL_SCENARIOS, enumName: 'PnlScenario', example: 'worst' })
  @IsIn(PNL_SCENARIOS)
  scenario!: (typeof PNL_SCENARIOS)[number];

  @ApiPropertyOptional({
    example: 'แผนปี 2027',
    maxLength: 120,
    description: 'Defaults to the source plan’s name',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'กรณียอดขายลด 20 %', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

// --- grid -------------------------------------------------------------------------------------------------------------

export class PnlMonthDto {
  @ApiProperty({ example: '2027-01', pattern: MONTH.source })
  month!: string;

  @ApiProperty({ enum: PNL_MONTH_KINDS, enumName: 'PnlMonthKind', example: 'actual' })
  kind!: (typeof PNL_MONTH_KINDS)[number];

  @ApiProperty({
    example: false,
    description: 'Actual month whose period is not closed yet: show "ยังไม่ปิดงวด"',
  })
  periodOpen!: boolean;

  @ApiProperty({ enum: PERIOD_STATUSES, enumName: 'PeriodStatus', nullable: true, example: 'closed' })
  periodStatus!: (typeof PERIOD_STATUSES)[number] | null;
}

export class PnlCellDto {
  @ApiProperty({ example: '2027-01', pattern: MONTH.source })
  month!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '1000000.00',
    description: 'THB, days or percent per the line’s unit',
  })
  value!: string | null;

  @ApiProperty({
    enum: PNL_CELL_MODES,
    enumName: 'PnlCellMode',
    example: 'auto',
    description: 'ระบบ (auto) · คำนวณ (calculated) · กรอกเอง (manual) · แก้ทับ (override)',
  })
  mode!: (typeof PNL_CELL_MODES)[number];

  @ApiProperty({
    type: String,
    nullable: true,
    example: '1000000.00',
    description: 'The system’s value, shown beside an override; null: no system data',
  })
  autoValue!: string | null;

  @ApiProperty({ enum: PNL_CELL_SOURCES, enumName: 'PnlCellSource', example: 'gl' })
  source!: (typeof PNL_CELL_SOURCES)[number];

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: { accounts: ['4110', '4120'], lines: 42 },
    description: 'Inputs behind the auto value (accounts, window, ratios, counts) for the tooltip',
  })
  sourceRef!: Record<string, unknown> | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Manual note or override reason' })
  note!: string | null;

  @ApiProperty({ example: false })
  periodOpen!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-11-03T10:00:00+07:00',
    description: 'ข้อมูลถึง',
  })
  asOf!: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true, description: 'Who entered or overrode the value' })
  updatedBy!: UserRefDto | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-11-03T10:00:00+07:00' })
  updatedAt!: string | null;

  @ApiProperty({ example: '"q2b0m8vP1nKk7yYt3tU9Zw"', description: 'Send as If-Match to updateCell' })
  etag!: string;

  @ApiProperty({ example: true, description: 'Has source records (listCellSources)' })
  drillable!: boolean;
}

export class PnlGridLineDto {
  @ApiProperty({ type: PnlLineDto })
  line!: PnlLineDto;

  @ApiProperty({ type: [PnlCellDto] })
  cells!: PnlCellDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: '12000000.00',
    description: 'Year column: money summed; ratios / days recomputed on the year; bad debt = the last month',
  })
  total!: string | null;
}

export class PnlSummaryDto {
  @ApiProperty({ type: String, nullable: true, example: '12000000.00' })
  netRevenue!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '3000000.00' })
  grossMargin!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '25.00', description: 'Percent of net revenue' })
  grossMarginPct!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '2500000.00', description: '“กำไรหลังหักค่าคอม”' })
  contributionAfterCommission!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '20.83' })
  contributionAfterCommissionPct!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '900000.00' })
  ebitda!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '700000.00' })
  netProfit!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '10.67', description: 'Days' })
  cashConversionDays!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '8400000.00' })
  breakEvenRevenue!: string | null;

  @ApiProperty({ example: false, description: 'The CIT estimate used the SME bands' })
  citSmeApplied!: boolean;

  @ApiProperty({ type: 'integer', example: 24, description: 'Editable cells without a value (กรอกค่า)' })
  emptyManualCells!: number;
}

export class PnlGridDto {
  @ApiProperty({ type: PnlPlanDto })
  plan!: PnlPlanDto;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ type: [PnlMonthDto] })
  months!: PnlMonthDto[];

  @ApiProperty({ type: [PnlGridLineDto] })
  lines!: PnlGridLineDto[];

  @ApiProperty({ type: PnlSummaryDto, description: 'Year figures of the summary strip' })
  summary!: PnlSummaryDto;
}

export class UpdatePnlCellDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '250000.00',
    description: 'THB, ≤ 2 places; null reverts an override to the auto value or clears a manual value',
  })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Matches(/^-?\d{1,12}(\.\d{1,2})?$/)
  value!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'พนักงาน 5 คน × 50,000',
    maxLength: 1000,
    description: 'Required (≥ 3 characters) on the first manual entry and on every override',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

// --- plan vs actual ---------------------------------------------------------------------------------------------------

export class PnlVarianceCellDto {
  @ApiProperty({ example: '2027-01', pattern: MONTH.source })
  month!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '1000000.00',
    description: 'The locked (or current) plan value',
  })
  plan!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '1100000.00' })
  actual!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '100000.00', description: 'actual − plan' })
  variance!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '10.00',
    description: 'variance ÷ |plan| × 100; null when plan is 0',
  })
  variancePct!: string | null;

  @ApiProperty({
    enum: PNL_ACTUAL_BASES,
    enumName: 'PnlActualBasis',
    example: 'ledger',
    description:
      '`ledger` posted figures · `calculated` from actual lines · `includes_plan_values` a formula that used the plan value of a line with no actual source · `none` no actual source · `not_yet` a future month',
  })
  actualBasis!: (typeof PNL_ACTUAL_BASES)[number];

  @ApiProperty({ type: String, nullable: true, example: 'ลูกค้ารายใหญ่สั่งเร็วกว่าแผน' })
  note!: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  noteBy!: UserRefDto | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  noteUpdatedAt!: string | null;
}

export class PnlVarianceLineDto {
  @ApiProperty({ type: PnlLineDto })
  line!: PnlLineDto;

  @ApiProperty({ type: [PnlVarianceCellDto] })
  cells!: PnlVarianceCellDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: '3000000.00',
    description: 'Plan of the actual months',
  })
  totalPlan!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '3100000.00',
    description: 'Actual of the actual months',
  })
  totalActual!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '100000.00' })
  totalVariance!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '3.33' })
  totalVariancePct!: string | null;
}

export class PnlVarianceDto {
  @ApiProperty({ type: PnlPlanDto })
  plan!: PnlPlanDto;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ format: 'date-time', example: '2026-11-03T10:00:00+07:00', description: 'Actuals as of' })
  asOf!: string;

  @ApiProperty({ type: [PnlMonthDto] })
  months!: PnlMonthDto[];

  @ApiProperty({ type: [PnlVarianceLineDto] })
  lines!: PnlVarianceLineDto[];
}

export class SetPnlVarianceNoteDto {
  @ApiProperty({ example: 'ลูกค้ารายใหญ่สั่งเร็วกว่าแผน', minLength: 3, maxLength: 1000 })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note!: string;
}

// --- drill-down -------------------------------------------------------------------------------------------------------

export class PnlSourceItemDto {
  @ApiProperty({ enum: PNL_SOURCE_KINDS, enumName: 'PnlSourceKind', example: 'gl_line' })
  kind!: (typeof PNL_SOURCE_KINDS)[number];

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000000e1',
    description:
      'gl_line: journal entry id · commission · lead · fixed_asset: their id · customer_run_rate: null',
  })
  id!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'JE202701-000012',
    description: 'Human key (entry no, asset no…)',
  })
  code!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2027-01-15' })
  date!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '107000.00',
    description: 'THB on the line’s side (weighted for leads)',
  })
  amount!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '4110' })
  accountCode!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'ขายสินค้า TR2701-00012' })
  description!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'customer_document' })
  sourceDocumentType!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  sourceDocumentId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'TR2701-00012' })
  sourceDocumentNo!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  orderId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  orderCode!: string | null;
}

// --- export -----------------------------------------------------------------------------------------------------------

export class ExportPnlPlanDto {
  @ApiProperty({ enum: PNL_EXPORT_FORMATS, enumName: 'PnlExportFormat', example: 'xlsx' })
  @IsIn(PNL_EXPORT_FORMATS)
  format!: (typeof PNL_EXPORT_FORMATS)[number];

  @ApiPropertyOptional({ enum: PNL_EXPORT_VIEWS, enumName: 'PnlExportView', default: 'plan' })
  @IsOptional()
  @IsIn(PNL_EXPORT_VIEWS)
  view?: (typeof PNL_EXPORT_VIEWS)[number];
}

// --- examples ---------------------------------------------------------------------------------------------------------

export const PLAN_EXAMPLE: PnlPlanDto = {
  id: PLAN_ID,
  name: 'แผนปี 2027',
  fiscalYear: 2027,
  scenario: 'base',
  status: 'draft',
  version: 1,
  note: null,
  owner: USER,
  copiedFromId: null,
  computedAt: '2026-11-03T10:00:00+07:00',
  lockedAt: null,
  lockedBy: null,
  snapshotSha256: null,
  etag: '"pXH2c5mJ3Lr0v1QkTqv2xQ"',
  createdAt: '2026-11-03T09:00:00+07:00',
  updatedAt: '2026-11-03T10:00:00+07:00',
};

export const LINE_EXAMPLE: PnlLineDto = {
  key: 'revenue_goods',
  group: 'revenue',
  unit: 'money',
  calc: 'source',
  inTotal: true,
  editable: true,
  mapped: true,
  labelTh: 'รายได้จากการขายสินค้า',
  labelEn: 'Revenue — goods',
  definition: { th: 'มูลค่าสินค้าที่ออกใบกำกับภาษีแล้วในเดือนนั้น ก่อนหักส่วนลด', en: null },
  formula: { th: 'Σ ยอดสินค้าก่อน VAT ตามใบกำกับ', en: null },
  source: {
    th: 'GL รายได้ขายสินค้า; forecast = pipeline × ความน่าจะเป็นตามขั้น + ยอดสั่งซ้ำเฉลี่ย 3 เดือน',
    en: null,
  },
  howToFill: { th: 'ใส่ยอดขายที่คาดไว้ ระบุว่ามาจากเป้าหรือดีลไหน', en: null },
  glAccounts: [
    {
      code: '4110',
      nameTh: 'รายได้ — บรรจุภัณฑ์สั่งผลิต',
      nameEn: 'Sales — made-to-order packaging',
      onlyRules: [],
      excludeRules: [],
    },
  ],
};

export const CELL_EXAMPLE: PnlCellDto = {
  month: '2027-01',
  value: '1000000.00',
  mode: 'auto',
  autoValue: '1000000.00',
  source: 'gl',
  sourceRef: { accounts: ['4110', '4120'], lines: 42 },
  note: null,
  periodOpen: false,
  asOf: '2026-11-03T10:00:00+07:00',
  updatedBy: null,
  updatedAt: '2026-11-03T10:00:00+07:00',
  etag: '"q2b0m8vP1nKk7yYt3tU9Zw"',
  drillable: true,
};

export const GRID_EXAMPLE: PnlGridDto = {
  plan: PLAN_EXAMPLE,
  currency: 'THB',
  months: [{ month: '2027-01', kind: 'actual', periodOpen: false, periodStatus: 'closed' }],
  lines: [{ line: LINE_EXAMPLE, cells: [CELL_EXAMPLE], total: '12000000.00' }],
  summary: {
    netRevenue: '12000000.00',
    grossMargin: '3000000.00',
    grossMarginPct: '25.00',
    contributionAfterCommission: '2500000.00',
    contributionAfterCommissionPct: '20.83',
    ebitda: '900000.00',
    netProfit: '700000.00',
    cashConversionDays: '10.67',
    breakEvenRevenue: '8400000.00',
    citSmeApplied: false,
    emptyManualCells: 24,
  },
};

export const VARIANCE_EXAMPLE: PnlVarianceDto = {
  plan: { ...PLAN_EXAMPLE, status: 'locked', lockedAt: '2026-12-28T10:00:00+07:00', lockedBy: USER },
  currency: 'THB',
  asOf: '2027-02-03T10:00:00+07:00',
  months: [{ month: '2027-01', kind: 'actual', periodOpen: false, periodStatus: 'closed' }],
  lines: [
    {
      line: LINE_EXAMPLE,
      cells: [
        {
          month: '2027-01',
          plan: '1000000.00',
          actual: '1100000.00',
          variance: '100000.00',
          variancePct: '10.00',
          actualBasis: 'ledger',
          note: 'ลูกค้ารายใหญ่สั่งเร็วกว่าแผน',
          noteBy: USER,
          noteUpdatedAt: '2027-02-03T11:00:00+07:00',
        },
      ],
      totalPlan: '1000000.00',
      totalActual: '1100000.00',
      totalVariance: '100000.00',
      totalVariancePct: '10.00',
    },
  ],
};

export const SOURCE_EXAMPLE: PnlSourceItemDto = {
  kind: 'gl_line',
  id: '0192f3a0-7c1e-7d2a-9b1f-0000000000e1',
  code: 'JE202701-000012',
  date: '2027-01-15',
  amount: '107000.00',
  accountCode: '4110',
  description: 'ขายสินค้า TR2701-00012',
  sourceDocumentType: 'customer_document',
  sourceDocumentId: null,
  sourceDocumentNo: 'TR2701-00012',
  orderId: null,
  orderCode: null,
};
