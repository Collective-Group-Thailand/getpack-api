import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Ledger (B5.1, accounting-design §1, §3, §5; ADR-0007). Money: decimal strings, THB. */

export const MONEY = /^\d{1,12}\.\d{2}$/;
export const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const ACCOUNT_CODE = /^[0-9A-Z][0-9A-Z.-]*$/;

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'cost_of_sales', 'expense'] as const;
export const LEDGER_SIDES = ['debit', 'credit'] as const;
export const LEDGER_DIMENSIONS = [
  'order',
  'order_group',
  'customer',
  'company',
  'factory',
  'vendor',
  'product_type',
  'channel',
  'campaign',
  'promotion',
  'cost_centre',
] as const;
export const ACCOUNT_STATUSES = ['active', 'inactive'] as const;
export const CASH_FLOW_CLASSES = [
  'cash',
  'operating',
  'investing',
  'financing',
  'equity',
  'non_cash',
] as const;
export const JOURNAL_KINDS = ['auto', 'manual', 'reversal', 'recurring', 'closing'] as const;
export const JOURNAL_STATUSES = ['draft', 'pending_approval', 'posted', 'rejected'] as const;
export const TAX_CODES = [
  'output_vat',
  'output_vat_not_due',
  'input_vat',
  'input_vat_pending',
  'wht_receivable',
  'wht_pnd3',
  'wht_pnd53',
] as const;
export const PERIOD_STATUSES = ['open', 'soft_closed', 'closed', 'locked'] as const;
export const ACCOUNT_CHANGE_KINDS = ['create', 'update', 'deactivate', 'reactivate'] as const;
export const RECURRING_STATUSES = ['pending_approval', 'active', 'paused', 'ended', 'rejected'] as const;
export const VERSION_STATUSES = [
  'draft',
  'proposed',
  'pending_acceptance',
  'approved',
  'rejected',
  'withdrawn',
] as const;
export const SALES_CHANNELS = ['web', 'cs', 'line', 'b2b'] as const;

export const LEDGER_IDS = {
  account: '0192f3a0-7c1e-7d2a-9b1f-000000510001',
  change: '0192f3a0-7c1e-7d2a-9b1f-000000510002',
  period: '0192f3a0-7c1e-7d2a-9b1f-000000510003',
  year: '0192f3a0-7c1e-7d2a-9b1f-000000510004',
  journal: '0192f3a0-7c1e-7d2a-9b1f-000000510005',
  rule: '0192f3a0-7c1e-7d2a-9b1f-000000510006',
  ruleVersion: '0192f3a0-7c1e-7d2a-9b1f-000000510007',
  approval: '0192f3a0-7c1e-7d2a-9b1f-000000510008',
  event: '0192f3a0-7c1e-7d2a-9b1f-000000510009',
  document: '0192f3a0-7c1e-7d2a-9b1f-00000051000a',
  recurring: '0192f3a0-7c1e-7d2a-9b1f-00000051000b',
  costCentre: '0192f3a0-7c1e-7d2a-9b1f-00000051000c',
  taxRate: '0192f3a0-7c1e-7d2a-9b1f-00000051000d',
  order: '0192f3a0-7c1e-7d2a-9b1f-0000000c0001',
  user: '0192f3a0-7c1e-7d2a-9b1f-000000000101',
};

const JSON_OBJECT = { type: 'object', additionalProperties: true } as const;

// --- chart of accounts ------------------------------------------------------------------------------------

export class AccountDto {
  @ApiProperty({ format: 'uuid', example: LEDGER_IDS.account })
  id!: string;

  @ApiProperty({ example: '1210', pattern: ACCOUNT_CODE.source })
  code!: string;

  @ApiProperty({ example: 'ลูกหนี้การค้า' })
  nameTh!: string;

  @ApiProperty({ example: 'Trade receivables' })
  nameEn!: string;

  @ApiProperty({ enum: ACCOUNT_TYPES, enumName: 'AccountType', example: 'asset' })
  accountType!: string;

  @ApiProperty({ enum: LEDGER_SIDES, enumName: 'LedgerSide', example: 'debit' })
  normalSide!: string;

  @ApiProperty({ type: String, nullable: true, example: '1000' })
  parentCode!: string | null;

  @ApiProperty({ example: true, description: 'Only sub-ledger (automatic) postings (§3)' })
  isControl!: boolean;

  @ApiProperty({ example: true, description: 'False for heading accounts' })
  isPostable!: boolean;

  @ApiProperty({
    enum: LEDGER_DIMENSIONS,
    enumName: 'LedgerDimension',
    isArray: true,
    example: ['customer', 'order'],
  })
  allowedDimensions!: string[];

  @ApiProperty({ enum: LEDGER_DIMENSIONS, enumName: 'LedgerDimension', isArray: true, example: ['customer'] })
  requiredDimensions!: string[];

  @ApiProperty({ enum: CASH_FLOW_CLASSES, enumName: 'CashFlowClass', example: 'operating' })
  cashFlowClass!: string;

  @ApiProperty({ enum: ACCOUNT_STATUSES, enumName: 'CapabilityStatus', example: 'active' })
  status!: string;
}

export const ACCOUNT_EXAMPLE: AccountDto = {
  id: LEDGER_IDS.account,
  code: '1210',
  nameTh: 'ลูกหนี้การค้า',
  nameEn: 'Trade receivables',
  accountType: 'asset',
  normalSide: 'debit',
  parentCode: '1000',
  isControl: true,
  isPostable: true,
  allowedDimensions: ['customer', 'order'],
  requiredDimensions: ['customer'],
  cashFlowClass: 'operating',
  status: 'active',
};

export class AccountFieldsDto {
  @ApiPropertyOptional({
    example: '1124',
    pattern: ACCOUNT_CODE.source,
    description: 'Required when creating',
  })
  @IsOptional()
  @IsString()
  @Matches(ACCOUNT_CODE)
  @MaxLength(20)
  code?: string;

  @ApiPropertyOptional({ example: 'เงินฝากธนาคาร บัญชีที่ 4' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  nameTh?: string;

  @ApiPropertyOptional({ example: 'Bank account 4' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  nameEn?: string;

  @ApiPropertyOptional({ enum: ACCOUNT_TYPES, enumName: 'AccountType', example: 'asset' })
  @IsOptional()
  @IsIn(ACCOUNT_TYPES)
  accountType?: (typeof ACCOUNT_TYPES)[number];

  @ApiPropertyOptional({ enum: LEDGER_SIDES, enumName: 'LedgerSide', example: 'debit' })
  @IsOptional()
  @IsIn(LEDGER_SIDES)
  normalSide?: (typeof LEDGER_SIDES)[number];

  @ApiPropertyOptional({ type: String, nullable: true, example: '1120' })
  @IsOptional()
  @IsString()
  @Matches(ACCOUNT_CODE)
  parentCode?: string | null;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isControl?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isPostable?: boolean;

  @ApiPropertyOptional({
    enum: LEDGER_DIMENSIONS,
    enumName: 'LedgerDimension',
    isArray: true,
    example: ['cost_centre'],
  })
  @IsOptional()
  @IsArray()
  @IsIn(LEDGER_DIMENSIONS, { each: true })
  allowedDimensions?: (typeof LEDGER_DIMENSIONS)[number][];

  @ApiPropertyOptional({ enum: LEDGER_DIMENSIONS, enumName: 'LedgerDimension', isArray: true, example: [] })
  @IsOptional()
  @IsArray()
  @IsIn(LEDGER_DIMENSIONS, { each: true })
  requiredDimensions?: (typeof LEDGER_DIMENSIONS)[number][];

  @ApiPropertyOptional({ enum: CASH_FLOW_CLASSES, enumName: 'CashFlowClass', example: 'cash' })
  @IsOptional()
  @IsIn(CASH_FLOW_CLASSES)
  cashFlowClass?: (typeof CASH_FLOW_CLASSES)[number];
}

export class ProposeAccountChangeDto {
  @ApiProperty({ enum: ACCOUNT_CHANGE_KINDS, enumName: 'AccountChangeKind', example: 'create' })
  @IsIn(ACCOUNT_CHANGE_KINDS)
  kind!: (typeof ACCOUNT_CHANGE_KINDS)[number];

  @ApiPropertyOptional({ example: '1122', description: 'The account to change (not for `create`)' })
  @IsOptional()
  @IsString()
  @Matches(ACCOUNT_CODE)
  accountCode?: string;

  @ApiPropertyOptional({ type: AccountFieldsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AccountFieldsDto)
  fields?: AccountFieldsDto;

  @ApiProperty({ example: 'เปิดบัญชีธนาคารใหม่สำหรับจ่ายโรงงาน' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class AccountChangeDto {
  @ApiProperty({ format: 'uuid', example: LEDGER_IDS.change })
  id!: string;

  @ApiProperty({ enum: ACCOUNT_CHANGE_KINDS, enumName: 'AccountChangeKind', example: 'create' })
  kind!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Existing account (null when creating)',
  })
  accountCode!: string | null;

  @ApiProperty({ type: AccountFieldsDto })
  proposed!: AccountFieldsDto;

  @ApiProperty({ example: 'เปิดบัญชีธนาคารใหม่สำหรับจ่ายโรงงาน' })
  reason!: string;

  @ApiProperty({ enum: VERSION_STATUSES, enumName: 'ConfigVersionStatus', example: 'proposed' })
  status!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: LEDGER_IDS.approval })
  approvalRequestId!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T10:00:00+07:00' })
  createdAt!: string;
}

export const ACCOUNT_CHANGE_EXAMPLE: AccountChangeDto = {
  id: LEDGER_IDS.change,
  kind: 'create',
  accountCode: null,
  proposed: {
    code: '1124',
    nameTh: 'เงินฝากธนาคาร บัญชีที่ 4',
    nameEn: 'Bank account 4',
    accountType: 'asset',
    normalSide: 'debit',
    parentCode: '1120',
    cashFlowClass: 'cash',
  },
  reason: 'เปิดบัญชีธนาคารใหม่สำหรับจ่ายโรงงาน',
  status: 'proposed',
  approvalRequestId: LEDGER_IDS.approval,
  createdAt: '2026-10-01T10:00:00+07:00',
};

export class AccountChangeListQuery {
  @ApiPropertyOptional({ enum: VERSION_STATUSES, enumName: 'ConfigVersionStatus', example: 'proposed' })
  @IsOptional()
  @IsIn(['proposed', 'approved', 'rejected', 'withdrawn'])
  status?: 'proposed' | 'approved' | 'rejected' | 'withdrawn';
}

export class CostCentreDto {
  @ApiProperty({ format: 'uuid', example: LEDGER_IDS.costCentre })
  id!: string;

  @ApiProperty({ example: 'OPS' })
  code!: string;

  @ApiProperty({ example: 'ฝ่ายปฏิบัติการ' })
  name!: string;

  @ApiProperty({ enum: ACCOUNT_STATUSES, enumName: 'CapabilityStatus', example: 'active' })
  status!: string;
}

export const COST_CENTRE_EXAMPLE: CostCentreDto = {
  id: LEDGER_IDS.costCentre,
  code: 'OPS',
  name: 'ฝ่ายปฏิบัติการ',
  status: 'active',
};

export class CreateCostCentreDto {
  @ApiProperty({ example: 'OPS', pattern: '^[A-Z0-9][A-Z0-9_-]*$' })
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9_-]*$/)
  @MaxLength(20)
  code!: string;

  @ApiProperty({ example: 'ฝ่ายปฏิบัติการ' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}

// --- periods -------------------------------------------------------------------------------------------------

export class FiscalPeriodDto {
  @ApiProperty({ format: 'uuid', example: LEDGER_IDS.period })
  id!: string;

  @ApiProperty({ type: 'integer', example: 10 })
  periodNo!: number;

  @ApiProperty({ format: 'date', example: '2026-10-01' })
  startDate!: string;

  @ApiProperty({ format: 'date', example: '2026-10-31' })
  endDate!: string;

  @ApiProperty({ enum: PERIOD_STATUSES, enumName: 'PeriodStatus', example: 'open' })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  statusChangedAt!: string | null;
}

export class FiscalYearDto {
  @ApiProperty({ format: 'uuid', example: LEDGER_IDS.year })
  id!: string;

  @ApiProperty({ example: 'FY2026' })
  label!: string;

  @ApiProperty({ format: 'date', example: '2026-01-01' })
  startDate!: string;

  @ApiProperty({ format: 'date', example: '2026-12-31' })
  endDate!: string;

  @ApiProperty({ enum: PERIOD_STATUSES, enumName: 'PeriodStatus', example: 'open' })
  status!: string;

  @ApiProperty({ type: [FiscalPeriodDto] })
  periods!: FiscalPeriodDto[];
}

export const PERIOD_EXAMPLE: FiscalPeriodDto = {
  id: LEDGER_IDS.period,
  periodNo: 10,
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  status: 'open',
  statusChangedAt: null,
};

export const FISCAL_YEAR_EXAMPLE: FiscalYearDto = {
  id: LEDGER_IDS.year,
  label: 'FY2026',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  status: 'open',
  periods: [PERIOD_EXAMPLE],
};

export class PeriodTransitionDto {
  @ApiPropertyOptional({ example: 'ปิดงวดเบื้องต้นเพื่อให้ผู้จัดการตรวจ' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

// --- journals ------------------------------------------------------------------------------------------------

export class JournalLineDimensionsDto {
  @ApiPropertyOptional({ format: 'uuid', example: LEDGER_IDS.order })
  @IsOptional()
  @IsUUID()
  order?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  orderGroup?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Customer user id' })
  @IsOptional()
  @IsUUID()
  customer?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  company?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  factory?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  vendor?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  productType?: string;

  @ApiPropertyOptional({ enum: SALES_CHANNELS, enumName: 'SalesChannel' })
  @IsOptional()
  @IsIn(SALES_CHANNELS)
  channel?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  campaign?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  promotion?: string;

  @ApiPropertyOptional({ example: 'OPS', description: 'Cost centre code' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  costCentre?: string;
}

export class ManualJournalLineDto {
  @ApiProperty({ example: '2410', pattern: ACCOUNT_CODE.source })
  @IsString()
  @Matches(ACCOUNT_CODE)
  accountCode!: string;

  @ApiProperty({ enum: LEDGER_SIDES, enumName: 'LedgerSide', example: 'credit' })
  @IsIn(LEDGER_SIDES)
  side!: 'debit' | 'credit';

  @ApiProperty({ example: '15000.00', pattern: MONEY.source })
  @Matches(MONEY)
  amount!: string;

  @ApiPropertyOptional({ example: 'ค่าเช่าคลังค้างจ่าย ตุลาคม' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({ type: JournalLineDimensionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => JournalLineDimensionsDto)
  dimensions?: JournalLineDimensionsDto;
}

export class ManualJournalDto {
  @ApiProperty({ format: 'date', example: '2026-10-31' })
  @Matches(DAY)
  documentDate!: string;

  @ApiProperty({ example: 'ตั้งค่าเช่าคลังค้างจ่าย ตุลาคม 2569' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  description!: string;

  @ApiProperty({ type: [ManualJournalLineDto] })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ManualJournalLineDto)
  lines!: ManualJournalLineDto[];

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: true,
    example: '2026-11-01',
    description: 'Auto-reversing journal: the reversal posts on this date',
  })
  @IsOptional()
  @Matches(DAY)
  autoReverseOn?: string | null;
}

export class ReverseJournalDto {
  @ApiProperty({ format: 'date', example: '2026-11-01' })
  @Matches(DAY)
  documentDate!: string;

  @ApiProperty({ example: 'บันทึกผิดบัญชี' })
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

export class JournalLineDto {
  @ApiProperty({ type: 'integer', example: 1 })
  lineNo!: number;

  @ApiProperty({ example: '1210' })
  accountCode!: string;

  @ApiProperty({ example: 'ลูกหนี้การค้า' })
  accountName!: string;

  @ApiProperty({ example: '1070.00' })
  debit!: string;

  @ApiProperty({ example: '0.00' })
  credit!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  description!: string | null;

  @ApiProperty({ type: JournalLineDimensionsDto })
  dimensions!: JournalLineDimensionsDto;

  @ApiProperty({ enum: TAX_CODES, enumName: 'TaxCode', nullable: true, example: null })
  taxCode!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  taxBaseAmount!: string | null;
}

export class JournalSourceDto {
  @ApiProperty({ example: 'customer_document' })
  type!: string;

  @ApiProperty({ format: 'uuid', example: LEDGER_IDS.document })
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'TR256910-00001' })
  number!: string | null;
}

export class JournalDto {
  @ApiProperty({ format: 'uuid', example: LEDGER_IDS.journal })
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'JE202610-000001' })
  entryNo!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'JV number of a manual journal (§4)',
  })
  jvNumber!: string | null;

  @ApiProperty({ enum: JOURNAL_KINDS, enumName: 'JournalKind', example: 'auto' })
  kind!: string;

  @ApiProperty({ enum: JOURNAL_STATUSES, enumName: 'JournalStatus', example: 'posted' })
  status!: string;

  @ApiProperty({ format: 'date', example: '2026-10-05' })
  entryDate!: string;

  @ApiProperty({ format: 'date', example: '2026-10-05', description: 'Original document date (tax), §1.4' })
  documentDate!: string;

  @ApiProperty({ format: 'uuid', example: LEDGER_IDS.period })
  periodId!: string;

  @ApiProperty({ example: 'ใบกำกับภาษี/ใบเสร็จรับเงิน TR256910-00001 (งวด)' })
  description!: string;

  @ApiProperty({ example: '1070.00' })
  totalDebit!: string;

  @ApiProperty({ example: '1070.00' })
  totalCredit!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ type: JournalSourceDto, nullable: true })
  source!: JournalSourceDto | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: LEDGER_IDS.event,
    description: 'Domain event that produced the entry (drill-down)',
  })
  domainEventId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'P01' })
  postingRule!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 1 })
  postingRuleVersion!: number | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  reversesId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  reversedById!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: null })
  autoReverseOn!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  approvalRequestId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  rejectionReason!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null, description: 'Maker' })
  createdBy!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null, description: 'Checker' })
  approvedBy!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-05T10:00:00+07:00' })
  postedAt!: string | null;

  @ApiProperty({ type: [JournalLineDto] })
  lines!: JournalLineDto[];
}

export const JOURNAL_EXAMPLE: JournalDto = {
  id: LEDGER_IDS.journal,
  entryNo: 'JE202610-000001',
  jvNumber: null,
  kind: 'auto',
  status: 'posted',
  entryDate: '2026-10-05',
  documentDate: '2026-10-05',
  periodId: LEDGER_IDS.period,
  description: 'ใบกำกับภาษี/ใบเสร็จรับเงิน TR256910-00001 (งวด)',
  totalDebit: '1070.00',
  totalCredit: '1070.00',
  currency: 'THB',
  source: { type: 'customer_document', id: LEDGER_IDS.document, number: 'TR256910-00001' },
  domainEventId: LEDGER_IDS.event,
  postingRule: 'P01',
  postingRuleVersion: 1,
  reversesId: null,
  reversedById: null,
  autoReverseOn: null,
  approvalRequestId: null,
  rejectionReason: null,
  createdBy: null,
  approvedBy: null,
  postedAt: '2026-10-05T10:00:00+07:00',
  lines: [
    {
      lineNo: 1,
      accountCode: '1132',
      accountName: 'Clearing — SCB',
      debit: '1070.00',
      credit: '0.00',
      description: null,
      dimensions: { order: LEDGER_IDS.order },
      taxCode: null,
      taxBaseAmount: null,
    },
    {
      lineNo: 2,
      accountCode: '2310',
      accountName: 'Customer advances / contract liabilities',
      debit: '0.00',
      credit: '1000.00',
      description: null,
      dimensions: { order: LEDGER_IDS.order },
      taxCode: null,
      taxBaseAmount: null,
    },
    {
      lineNo: 3,
      accountCode: '2210',
      accountName: 'Output VAT',
      debit: '0.00',
      credit: '70.00',
      description: null,
      dimensions: {},
      taxCode: 'output_vat',
      taxBaseAmount: '1000.00',
    },
  ],
};

export class JournalListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: JOURNAL_STATUSES, enumName: 'JournalStatus' })
  @IsOptional()
  @IsIn(JOURNAL_STATUSES)
  status?: (typeof JOURNAL_STATUSES)[number];

  @ApiPropertyOptional({ enum: JOURNAL_KINDS, enumName: 'JournalKind' })
  @IsOptional()
  @IsIn(JOURNAL_KINDS)
  kind?: (typeof JOURNAL_KINDS)[number];

  @ApiPropertyOptional({ format: 'uuid', description: 'Fiscal period' })
  @IsOptional()
  @IsUUID()
  periodId?: string;

  @ApiPropertyOptional({ example: '1210', description: 'Entries with a line on this account' })
  @IsOptional()
  @Matches(ACCOUNT_CODE)
  accountCode?: string;

  @ApiPropertyOptional({ example: 'customer_document', description: 'Source document type (drill-down)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceType?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Source document id (drill-down)' })
  @IsOptional()
  @IsUUID()
  sourceId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Domain event id (drill-down)' })
  @IsOptional()
  @IsUUID()
  domainEventId?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-01' })
  @IsOptional()
  @Matches(DAY)
  from?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-31' })
  @IsOptional()
  @Matches(DAY)
  to?: string;
}

// --- recurring journals ---------------------------------------------------------------------------------------

export class RecurringJournalInputDto {
  @ApiProperty({ example: 'ค่าเช่าสำนักงานรายเดือน' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 'ตั้งค่าเช่าสำนักงานค้างจ่ายทุกสิ้นเดือน' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  description!: string;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 28, example: 28 })
  @IsInt()
  @Min(1)
  @Max(28)
  dayOfMonth!: number;

  @ApiProperty({ format: 'date', example: '2026-10-01' })
  @Matches(DAY)
  startOn!: string;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true, example: null })
  @IsOptional()
  @Matches(DAY)
  endOn?: string | null;

  @ApiProperty({ example: true, description: 'Reverse each posting on the first day of the next month' })
  @IsBoolean()
  autoReverse!: boolean;

  @ApiProperty({ type: [ManualJournalLineDto] })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ManualJournalLineDto)
  lines!: ManualJournalLineDto[];
}

export class RecurringJournalDto {
  @ApiProperty({ format: 'uuid', example: LEDGER_IDS.recurring })
  id!: string;

  @ApiProperty({ example: 'ค่าเช่าสำนักงานรายเดือน' })
  name!: string;

  @ApiProperty({ example: 'ตั้งค่าเช่าสำนักงานค้างจ่ายทุกสิ้นเดือน' })
  description!: string;

  @ApiProperty({ type: 'integer', example: 28 })
  dayOfMonth!: number;

  @ApiProperty({ format: 'date', example: '2026-10-01' })
  startOn!: string;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: null })
  endOn!: string | null;

  @ApiProperty({ format: 'date', example: '2026-10-28' })
  nextRunOn!: string;

  @ApiProperty({ example: true })
  autoReverse!: boolean;

  @ApiProperty({ enum: RECURRING_STATUSES, enumName: 'RecurringJournalStatus', example: 'active' })
  status!: string;

  @ApiProperty({ type: [ManualJournalLineDto] })
  lines!: ManualJournalLineDto[];

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: LEDGER_IDS.approval })
  approvalRequestId!: string | null;
}

export const RECURRING_EXAMPLE: RecurringJournalDto = {
  id: LEDGER_IDS.recurring,
  name: 'ค่าเช่าสำนักงานรายเดือน',
  description: 'ตั้งค่าเช่าสำนักงานค้างจ่ายทุกสิ้นเดือน',
  dayOfMonth: 28,
  startOn: '2026-10-01',
  endOn: null,
  nextRunOn: '2026-10-28',
  autoReverse: true,
  status: 'active',
  lines: [
    { accountCode: '6900', side: 'debit', amount: '15000.00' },
    { accountCode: '2410', side: 'credit', amount: '15000.00' },
  ],
  approvalRequestId: LEDGER_IDS.approval,
};

// --- posting rules ------------------------------------------------------------------------------------------

export class PostingRuleVersionDto {
  @ApiProperty({ format: 'uuid', example: LEDGER_IDS.ruleVersion })
  id!: string;

  @ApiProperty({ type: 'integer', example: 1 })
  versionNo!: number;

  @ApiProperty({ format: 'date-time', example: '2026-01-01T00:00:00+07:00' })
  effectiveFrom!: string;

  @ApiProperty({ enum: VERSION_STATUSES, enumName: 'ConfigVersionStatus', example: 'approved' })
  status!: string;

  @ApiProperty({
    ...JSON_OBJECT,
    nullable: true,
    example: { field: 'payload.docType', op: 'eq', value: 'tr' },
    description: 'Approval-engine condition over `payload.<path>`',
  })
  conditions!: Record<string, unknown> | null;

  @ApiProperty({
    ...JSON_OBJECT,
    example: { description: 'TR {docNumber}', lines: [] },
    description: 'Journal template (ADR-0007)',
  })
  template!: Record<string, unknown>;

  @ApiProperty({ example: 'Seed default from accounting-design.md §5' })
  reason!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  approvalRequestId!: string | null;
}

export class PostingRuleDto {
  @ApiProperty({ format: 'uuid', example: LEDGER_IDS.rule })
  id!: string;

  @ApiProperty({ example: 'P01' })
  key!: string;

  @ApiProperty({ example: 'customer_document.issued' })
  eventType!: string;

  @ApiProperty({ example: 'Instalment paid by gateway — TR' })
  name!: string;

  @ApiProperty({ example: 'Instalment / deposit paid by 2C2P or SCB before delivery (§5 P01)' })
  description!: string;

  @ApiProperty({ type: [String], example: ['D-020', 'D-033'] })
  decisionRefs!: string[];

  @ApiProperty({ type: [PostingRuleVersionDto] })
  versions!: PostingRuleVersionDto[];
}

export const RULE_VERSION_EXAMPLE: PostingRuleVersionDto = {
  id: LEDGER_IDS.ruleVersion,
  versionNo: 1,
  effectiveFrom: '2026-01-01T00:00:00+07:00',
  status: 'approved',
  conditions: { field: 'payload.docType', op: 'eq', value: 'tr' },
  template: { description: 'TR {docNumber}', lines: [] },
  reason: 'Seed default from accounting-design.md §5',
  approvalRequestId: null,
};

export const RULE_EXAMPLE: PostingRuleDto = {
  id: LEDGER_IDS.rule,
  key: 'P01',
  eventType: 'customer_document.issued',
  name: 'Instalment paid by gateway — TR',
  description: 'Instalment / deposit paid by 2C2P or SCB before delivery (§5 P01)',
  decisionRefs: ['D-020', 'D-033'],
  versions: [RULE_VERSION_EXAMPLE],
};

export class ProposeRuleVersionDto {
  @ApiProperty({ format: 'date-time', example: '2026-11-01T00:00:00+07:00' })
  @IsISO8601({ strict: true })
  effectiveFrom!: string;

  @ApiPropertyOptional({
    ...JSON_OBJECT,
    nullable: true,
    example: { field: 'payload.docType', op: 'eq', value: 'tr' },
  })
  @IsOptional()
  @IsObject()
  conditions?: Record<string, unknown> | null;

  @ApiProperty({
    ...JSON_OBJECT,
    example: {
      description: 'TR {docNumber}',
      documentDate: 'documentDate',
      lines: [
        { account: '1132', side: 'debit', amount: 'grossAmount' },
        { account: '2310', side: 'credit', amount: 'grossAmount' },
      ],
    },
  })
  @IsObject()
  template!: Record<string, unknown>;

  @ApiProperty({ example: 'ผู้สอบบัญชีให้แยกบัญชีพักตามธนาคาร' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class PreviewRuleDto {
  @ApiProperty({
    ...JSON_OBJECT,
    example: {
      docType: 'tr',
      docKind: 'instalment',
      receiptVia: 'scb',
      grossAmount: '1070.00',
      netAmount: '1000.00',
      vatAmount: '70.00',
    },
  })
  @IsObject()
  payload!: Record<string, unknown>;

  @ApiPropertyOptional({
    type: 'integer',
    example: 2,
    description: 'Version to try (default: the one in force)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  versionNo?: number;
}

export class PreviewLineDto {
  @ApiProperty({ example: '1132' })
  accountCode!: string;

  @ApiProperty({ enum: LEDGER_SIDES, enumName: 'LedgerSide', example: 'debit' })
  side!: string;

  @ApiProperty({ example: '1070.00' })
  amount!: string;

  @ApiProperty({ enum: TAX_CODES, enumName: 'TaxCode', nullable: true, example: null })
  taxCode!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  taxBase!: string | null;
}

export class RulePreviewDto {
  @ApiProperty({ example: 'P01' })
  key!: string;

  @ApiProperty({ type: 'integer', example: 1 })
  versionNo!: number;

  @ApiProperty({ example: true, description: 'Whether the conditions match the payload' })
  applies!: boolean;

  @ApiProperty({ example: true })
  balanced!: boolean;

  @ApiProperty({ example: 'TR (งวด)' })
  description!: string;

  @ApiProperty({ example: '1070.00' })
  totalDebit!: string;

  @ApiProperty({ example: '1070.00' })
  totalCredit!: string;

  @ApiProperty({ type: [PreviewLineDto] })
  lines!: PreviewLineDto[];
}

export const PREVIEW_EXAMPLE: RulePreviewDto = {
  key: 'P01',
  versionNo: 1,
  applies: true,
  balanced: true,
  description: 'TR (งวด)',
  totalDebit: '1070.00',
  totalCredit: '1070.00',
  lines: [
    { accountCode: '1132', side: 'debit', amount: '1070.00', taxCode: null, taxBase: null },
    { accountCode: '2310', side: 'credit', amount: '1000.00', taxCode: null, taxBase: null },
    { accountCode: '2210', side: 'credit', amount: '70.00', taxCode: 'output_vat', taxBase: '1000.00' },
  ],
};

// --- tax rates -------------------------------------------------------------------------------------------------

export class TaxRateVersionDto {
  @ApiProperty({ type: 'integer', example: 1 })
  versionNo!: number;

  @ApiProperty({ format: 'date-time', example: '2026-01-01T00:00:00+07:00' })
  effectiveFrom!: string;

  @ApiProperty({ enum: VERSION_STATUSES, enumName: 'ConfigVersionStatus', example: 'approved' })
  status!: string;

  @ApiProperty({ example: '7.0000', description: 'Percent' })
  ratePct!: string;

  @ApiProperty({ example: 'Seed default' })
  reason!: string;
}

export class TaxRateDto {
  @ApiProperty({ format: 'uuid', example: LEDGER_IDS.taxRate })
  id!: string;

  @ApiProperty({ example: 'vat_standard' })
  code!: string;

  @ApiProperty({ example: 'ภาษีมูลค่าเพิ่ม อัตราทั่วไป' })
  nameTh!: string;

  @ApiProperty({ example: 'VAT, standard rate' })
  nameEn!: string;

  @ApiProperty({ example: 'Output VAT on sales' })
  description!: string;

  @ApiProperty({ type: [TaxRateVersionDto] })
  versions!: TaxRateVersionDto[];
}

export const TAX_RATE_EXAMPLE: TaxRateDto = {
  id: LEDGER_IDS.taxRate,
  code: 'vat_standard',
  nameTh: 'ภาษีมูลค่าเพิ่ม อัตราทั่วไป',
  nameEn: 'VAT, standard rate',
  description: 'Output VAT on sales',
  versions: [
    {
      versionNo: 1,
      effectiveFrom: '2026-01-01T00:00:00+07:00',
      status: 'approved',
      ratePct: '7.0000',
      reason: 'Seed default',
    },
  ],
};

export class ProposeTaxRateDto {
  @ApiProperty({ example: '7', pattern: '^\\d{1,3}(\\.\\d{1,4})?$', description: 'Percent' })
  @Matches(/^\d{1,3}(\.\d{1,4})?$/)
  ratePct!: string;

  @ApiProperty({ format: 'date-time', example: '2027-01-01T00:00:00+07:00' })
  @IsISO8601({ strict: true })
  effectiveFrom!: string;

  @ApiProperty({ example: 'พระราชกฤษฎีกาลดอัตราภาษีมูลค่าเพิ่ม' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
