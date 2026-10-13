import { CodedRefDto } from '@common/dto/factory-ref.dto';
import { NextActionDto } from '@common/next-actions/next-action.dto';
import { PageQuery } from '@common/pagination/pagination.dto';
import { PersonRefDto } from '@modules/financial-reports/financial-reports.dto';
import {
  ACCOUNT_CHANGE_KINDS,
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  CASH_FLOW_CLASSES,
  JOURNAL_KINDS,
  JOURNAL_STATUSES,
  JournalSourceDto,
  LEDGER_SIDES,
  PERIOD_STATUSES,
  TAX_CODES,
  VERSION_STATUSES,
} from '@modules/ledger/ledger.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
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

import { AMOUNT, DAY, ERP_ITEM_KINDS, ErpItemRefDto, ErpRefDto } from './erp.dto';
import { ERP_GL_DIMENSIONS, STATEMENT_LINES } from './erp-ledger.template';

/**
 * Packio Factory ERP E6 (docs/prompts/E6-factory-general-ledger.md, D-385 – D-396): the factory's general
 * ledger — settings, chart of accounts with maker-checker changes, fiscal periods and the close checklist,
 * journals (posted from documents, manual, recurring, reversals), reports, fixed assets, bank reconciliation
 * and tax filings.
 */

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  value === '' || (typeof value === 'string' && value.trim() === '') ? null : value;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const SIGNED_AMOUNT = /^-?\d{1,12}(\.\d{1,2})?$/;
const ACCOUNT_CODE = /^[0-9A-Z][0-9A-Z.-]*$/;

export const E6_IDS = {
  settings: '0192f3a0-7c1e-7d2a-9b1f-00000000f601',
  account: '0192f3a0-7c1e-7d2a-9b1f-00000000f602',
  accountParent: '0192f3a0-7c1e-7d2a-9b1f-00000000f603',
  change: '0192f3a0-7c1e-7d2a-9b1f-00000000f604',
  year: '0192f3a0-7c1e-7d2a-9b1f-00000000f605',
  period: '0192f3a0-7c1e-7d2a-9b1f-00000000f606',
  entry: '0192f3a0-7c1e-7d2a-9b1f-00000000f607',
  rule: '0192f3a0-7c1e-7d2a-9b1f-00000000f608',
  recurring: '0192f3a0-7c1e-7d2a-9b1f-00000000f609',
  category: '0192f3a0-7c1e-7d2a-9b1f-00000000f610',
  asset: '0192f3a0-7c1e-7d2a-9b1f-00000000f611',
  run: '0192f3a0-7c1e-7d2a-9b1f-00000000f612',
  bankAccount: '0192f3a0-7c1e-7d2a-9b1f-00000000f613',
  bankLine: '0192f3a0-7c1e-7d2a-9b1f-00000000f614',
  filing: '0192f3a0-7c1e-7d2a-9b1f-00000000f615',
  supplier: '0192f3a0-7c1e-7d2a-9b1f-00000000f616',
  customer: '0192f3a0-7c1e-7d2a-9b1f-00000000f617',
  item: '0192f3a0-7c1e-7d2a-9b1f-00000000f618',
  machine: '0192f3a0-7c1e-7d2a-9b1f-00000000f619',
  user: '0192f3a0-7c1e-7d2a-9b1f-00000000f620',
  document: '0192f3a0-7c1e-7d2a-9b1f-00000000f621',
  payment: '0192f3a0-7c1e-7d2a-9b1f-00000000f622',
} as const;

export const ERP_GL_ASSET_STATUSES = ['active', 'disposed', 'written_off'] as const;
export const ERP_GL_BANK_LINE_STATUSES = ['open', 'matched', 'ignored'] as const;
export const ERP_GL_BANK_MATCH_TARGETS = ['supplier_payment', 'customer_receipt', 'journal_entry', 'bank_fee', 'interest'] as const;
export const ERP_GL_TAX_RETURNS = ['pp30', 'pnd3', 'pnd53'] as const;
export const ERP_GL_CLOSE_CHECKS = ['stock_valuation', 'payables', 'receivables', 'vat', 'wht', 'bank', 'depreciation', 'open_wip'] as const;
export const ERP_GL_PERIOD_TRANSITIONS = ['soft_close', 'close', 'lock', 'reopen'] as const;
export const ERP_GL_REPORT_SECTIONS = ['assets', 'liabilities', 'equity', 'revenue', 'other_income', 'cost_of_sales', 'manufacturing_overhead', 'selling_admin', 'finance_cost', 'income_tax'] as const;
export const ERP_GL_CASH_FLOW_SECTIONS = ['operating', 'investing', 'financing'] as const;

// ------------------------------------------------------------------------------------ settings

export class ErpGlSettingsDto {
  @ApiProperty({ format: 'uuid', example: E6_IDS.settings, description: 'The factory id (one settings row per factory)' })
  id!: string;

  @ApiProperty({ example: 1, minimum: 1, maximum: 12, description: 'First month of the fiscal year' })
  fiscalYearStartMonth!: number;

  @ApiProperty({ type: String, format: 'date', example: '2026-10-01', description: 'Documents dated before this day are not posted (opening balances cover them)' })
  ledgerStartOn!: string;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, example: { raw_material: '1141', finished_good: '1143' }, description: 'Item kind → inventory account code' })
  itemKindAccounts!: Record<string, string>;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, example: { payables: '2111', receivables: '1131' }, description: 'Purpose → account code the posting rules use' })
  methodAccounts!: Record<string, string>;

  @ApiProperty({ nullable: true, example: 'สำนักงานบัญชี ก.ไก่' })
  cpaName!: string | null;

  @ApiProperty({ nullable: true, example: 'cpa@example.invalid · 02-000-0000' })
  cpaContact!: string | null;

  @ApiProperty({ example: 1 })
  chartTemplateVersion!: number;

  @ApiProperty({ example: 1 })
  rulesTemplateVersion!: number;

  @ApiProperty({ example: 84, description: 'Accounts in the chart' })
  accounts!: number;

  @ApiProperty({ example: 18, description: 'Posting rules with an approved version' })
  rules!: number;

  @ApiProperty({ type: [NextActionDto] })
  nextActions!: NextActionDto[];

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ErpUpdateGlSettingsDto {
  @ApiPropertyOptional({ example: 1, minimum: 1, maximum: 12 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  fiscalYearStartMonth?: number;

  @ApiPropertyOptional({ example: '2026-10-01', pattern: DAY.source })
  @IsOptional()
  @Matches(DAY)
  ledgerStartOn?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' }, example: { consumable: '1144' } })
  @IsOptional()
  @IsObject()
  itemKindAccounts?: Record<string, string>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' }, example: { otherExpenses: '6900' } })
  @IsOptional()
  @IsObject()
  methodAccounts?: Record<string, string>;

  @ApiPropertyOptional({ nullable: true, example: 'สำนักงานบัญชี ก.ไก่', maxLength: 200 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(200)
  cpaName?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'cpa@example.invalid', maxLength: 300 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  cpaContact?: string | null;
}

// ------------------------------------------------------------------------------------ accounts

/** `{ id, code, name }` — the shared coded reference. */
export const ErpGlAccountRefDto = CodedRefDto;
export type ErpGlAccountRefDto = CodedRefDto;

export class ErpGlAccountDto {
  @ApiProperty({ format: 'uuid', example: E6_IDS.account })
  id!: string;

  @ApiProperty({ example: '1141' })
  code!: string;

  @ApiProperty({ example: 'วัตถุดิบ' })
  nameTh!: string;

  @ApiProperty({ example: 'Raw materials' })
  nameEn!: string;

  @ApiProperty({ enum: ACCOUNT_TYPES, enumName: 'AccountType', example: 'asset' })
  accountType!: string;

  @ApiProperty({ enum: LEDGER_SIDES, enumName: 'LedgerSide', example: 'debit' })
  normalSide!: string;

  @ApiProperty({ type: ErpGlAccountRefDto, nullable: true })
  parent!: ErpGlAccountRefDto | null;

  @ApiProperty({ example: false, description: 'Takes postings from documents only' })
  isControl!: boolean;

  @ApiProperty({ example: true, description: 'false = a heading' })
  isPostable!: boolean;

  @ApiProperty({ enum: CASH_FLOW_CLASSES, enumName: 'CashFlowClass', example: 'operating' })
  cashFlowClass!: string;

  @ApiProperty({ enum: STATEMENT_LINES, enumName: 'ErpGlStatementLine', example: 'inventory' })
  statementLine!: string;

  @ApiProperty({ enum: ACCOUNT_STATUSES, enumName: 'CapabilityStatus', example: 'active' })
  status!: string;

  @ApiProperty({ example: '125000.00', pattern: SIGNED_AMOUNT.source, description: 'Balance on the normal side as of today (posted entries)' })
  balance!: string;

  @ApiProperty({ example: false, description: 'A change is waiting for approval' })
  changePending!: boolean;

  @ApiProperty({ type: [NextActionDto] })
  nextActions!: NextActionDto[];

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ErpGlAccountListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ACCOUNT_TYPES, enumName: 'AccountType' })
  @IsOptional()
  @IsIn(ACCOUNT_TYPES)
  accountType?: string;

  @ApiPropertyOptional({ enum: ACCOUNT_STATUSES, enumName: 'CapabilityStatus' })
  @IsOptional()
  @IsIn(ACCOUNT_STATUSES)
  status?: string;


  @ApiPropertyOptional({ example: true, description: 'Postable accounts only (for pickers)' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  postable?: boolean;
}

export class ErpGlAccountProposalDto {
  @ApiPropertyOptional({ example: '1147', pattern: ACCOUNT_CODE.source, description: 'Required for `create`' })
  @IsOptional()
  @Transform(trim)
  @Matches(ACCOUNT_CODE)
  @MaxLength(20)
  code?: string;

  @ApiPropertyOptional({ example: 'หมึกพิมพ์', maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  nameTh?: string;

  @ApiPropertyOptional({ example: 'Printing ink', maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  nameEn?: string;

  @ApiPropertyOptional({ enum: ACCOUNT_TYPES, enumName: 'AccountType' })
  @IsOptional()
  @IsIn(ACCOUNT_TYPES)
  accountType?: string;

  @ApiPropertyOptional({ enum: LEDGER_SIDES, enumName: 'LedgerSide' })
  @IsOptional()
  @IsIn(LEDGER_SIDES)
  normalSide?: string;

  @ApiPropertyOptional({ example: '1100', nullable: true, description: 'Parent account code' })
  @IsOptional()
  @Transform(emptyToNull)
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

  @ApiPropertyOptional({ enum: CASH_FLOW_CLASSES, enumName: 'CashFlowClass' })
  @IsOptional()
  @IsIn(CASH_FLOW_CLASSES)
  cashFlowClass?: string;

  @ApiPropertyOptional({ enum: STATEMENT_LINES, enumName: 'ErpGlStatementLine' })
  @IsOptional()
  @IsIn(STATEMENT_LINES)
  statementLine?: string;
}

export class ErpGlProposeAccountChangeDto {
  @ApiProperty({ enum: ACCOUNT_CHANGE_KINDS, enumName: 'AccountChangeKind', example: 'create' })
  @IsIn(ACCOUNT_CHANGE_KINDS)
  kind!: string;

  @ApiPropertyOptional({ format: 'uuid', example: E6_IDS.account, description: 'The account to change (not for `create`)' })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({ type: ErpGlAccountProposalDto, description: 'The new values (`create` / `update`)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ErpGlAccountProposalDto)
  proposed?: ErpGlAccountProposalDto;

  @ApiProperty({ example: 'แยกหมึกพิมพ์ออกจากวัสดุสิ้นเปลือง', minLength: 3, maxLength: 500 })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class ErpGlAccountChangeDto {
  @ApiProperty({ format: 'uuid', example: E6_IDS.change })
  id!: string;

  @ApiProperty({ enum: ACCOUNT_CHANGE_KINDS, enumName: 'AccountChangeKind', example: 'create' })
  kind!: string;

  @ApiProperty({ type: ErpGlAccountRefDto, nullable: true })
  account!: ErpGlAccountRefDto | null;

  @ApiProperty({ type: ErpGlAccountProposalDto })
  proposed!: ErpGlAccountProposalDto;

  @ApiProperty({ example: 'แยกหมึกพิมพ์ออกจากวัสดุสิ้นเปลือง' })
  reason!: string;

  @ApiProperty({ enum: VERSION_STATUSES, enumName: 'ConfigVersionStatus', example: 'proposed' })
  status!: string;

  @ApiProperty({ nullable: true, example: null })
  decisionNote!: string | null;

  @ApiProperty({ example: 'ฝ่ายบัญชีโรงงาน ทดสอบ' })
  createdBy!: string;

  @ApiProperty({ type: String, format: 'date-time', example: '2026-10-13T09:00:00+07:00' })
  createdAt!: string;

  @ApiProperty({ nullable: true, example: null })
  decidedBy!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  decidedAt!: string | null;

  @ApiProperty({ type: [NextActionDto] })
  nextActions!: NextActionDto[];
}

export class ErpGlChangeListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: VERSION_STATUSES, enumName: 'ConfigVersionStatus' })
  @IsOptional()
  @IsIn(VERSION_STATUSES)
  status?: string;
}

export class ErpGlDecisionDto {
  @ApiPropertyOptional({ example: 'เห็นชอบ', nullable: true, maxLength: 500 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

// ------------------------------------------------------------------------------------- periods

export class ErpGlCloseCheckDto {
  @ApiProperty({ enum: ERP_GL_CLOSE_CHECKS, enumName: 'ErpGlCloseCheck', example: 'stock_valuation' })
  key!: string;

  @ApiProperty({ example: true, description: 'false = the period cannot close until it passes' })
  blocking!: boolean;

  @ApiProperty({ example: true })
  ok!: boolean;

  @ApiProperty({ example: '845000.00', pattern: SIGNED_AMOUNT.source, nullable: true, description: 'Sub-ledger side' })
  expected!: string | null;

  @ApiProperty({ example: '845000.00', pattern: SIGNED_AMOUNT.source, nullable: true, description: 'General-ledger side' })
  actual!: string | null;

  @ApiProperty({ example: '0.00', pattern: SIGNED_AMOUNT.source, nullable: true })
  difference!: string | null;

  @ApiProperty({ example: 'สต็อก 6 รายการ', nullable: true })
  detail!: string | null;
}

export class ErpGlPeriodDto {
  @ApiProperty({ format: 'uuid', example: E6_IDS.period })
  id!: string;

  @ApiProperty({ example: 'FY2026' })
  fiscalYear!: string;

  @ApiProperty({ format: 'uuid', example: E6_IDS.year })
  fiscalYearId!: string;

  @ApiProperty({ example: 10 })
  periodNo!: number;

  @ApiProperty({ example: '2026-10' })
  month!: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-10-01' })
  startDate!: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-10-31' })
  endDate!: string;

  @ApiProperty({ enum: PERIOD_STATUSES, enumName: 'PeriodStatus', example: 'open' })
  status!: string;

  @ApiProperty({ example: 42, description: 'Posted journal entries' })
  entries!: number;

  @ApiProperty({ nullable: true, example: null })
  statusChangedBy!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  statusChangedAt!: string | null;

  @ApiProperty({ nullable: true, example: null })
  closeNote!: string | null;

  @ApiProperty({ type: [ErpGlCloseCheckDto], description: 'The checklist as stored at the last close (empty while open)' })
  closeChecklist!: ErpGlCloseCheckDto[];

  @ApiProperty({ type: [NextActionDto] })
  nextActions!: NextActionDto[];
}

export class ErpGlPeriodListQuery {
  @ApiPropertyOptional({ example: 'FY2026', description: 'A fiscal year label; default: the current and the previous year' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  fiscalYear?: string;
}

export class ErpGlPeriodTransitionDto {
  @ApiProperty({ enum: ERP_GL_PERIOD_TRANSITIONS, enumName: 'ErpGlPeriodTransition', example: 'soft_close' })
  @IsIn(ERP_GL_PERIOD_TRANSITIONS)
  action!: string;

  @ApiPropertyOptional({ example: 'ปิดงวดตุลาคม', nullable: true, maxLength: 500, description: 'Required to reopen' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class ErpGlCloseChecklistDto {
  @ApiProperty({ format: 'uuid', example: E6_IDS.period })
  periodId!: string;

  @ApiProperty({ example: '2026-10' })
  month!: string;

  @ApiProperty({ enum: PERIOD_STATUSES, enumName: 'PeriodStatus', example: 'open' })
  status!: string;

  @ApiProperty({ type: [ErpGlCloseCheckDto] })
  checks!: ErpGlCloseCheckDto[];

  @ApiProperty({ example: true, description: 'Every blocking check passes' })
  canClose!: boolean;

  @ApiProperty({ example: 3, description: 'Production orders still open at month end' })
  openProductionOrders!: number;
}

// ------------------------------------------------------------------------------------ journals

export class ErpGlJournalLineDto {
  @ApiProperty({ example: 1 })
  lineNo!: number;

  @ApiProperty({ type: ErpGlAccountRefDto })
  account!: ErpGlAccountRefDto;

  @ApiProperty({ example: '12500.00', pattern: AMOUNT.source })
  debit!: string;

  @ApiProperty({ example: '0.00', pattern: AMOUNT.source })
  credit!: string;

  @ApiProperty({ nullable: true, example: 'กระดาษคราฟท์ 350 แกรม' })
  description!: string | null;

  @ApiProperty({ type: ErpItemRefDto, nullable: true })
  item!: ErpItemRefDto | null;

  @ApiProperty({ type: ErpRefDto, nullable: true })
  partner!: ErpRefDto | null;

  @ApiProperty({ type: ErpRefDto, nullable: true })
  warehouse!: ErpRefDto | null;

  @ApiProperty({ type: ErpRefDto, nullable: true, description: 'Production order `{ id, code: moNo, name: title }`' })
  productionOrder!: ErpRefDto | null;

  @ApiProperty({ type: PersonRefDto, nullable: true, description: 'Machine' })
  machine!: PersonRefDto | null;

  @ApiProperty({ type: PersonRefDto, nullable: true, description: 'Bank account' })
  bankAccount!: PersonRefDto | null;

  @ApiProperty({ enum: TAX_CODES, enumName: 'TaxCode', nullable: true, example: null })
  taxCode!: string | null;

  @ApiProperty({ nullable: true, example: null, pattern: AMOUNT.source })
  taxBaseAmount!: string | null;
}

/** `{ type, id, number }` — the document a journal entry came from (shared with Packio's ledger). */
export const ErpGlSourceDocDto = JournalSourceDto;
export type ErpGlSourceDocDto = JournalSourceDto;

export class ErpGlJournalDto {
  @ApiProperty({ format: 'uuid', example: E6_IDS.entry })
  id!: string;

  @ApiProperty({ nullable: true, example: 'JV-2610-0012', description: 'Assigned at posting' })
  entryNo!: string | null;

  @ApiProperty({ type: String, format: 'date', example: '2026-10-13' })
  entryDate!: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-10-13' })
  documentDate!: string;

  @ApiProperty({ example: '2026-10' })
  month!: string;

  @ApiProperty({ enum: JOURNAL_KINDS, enumName: 'JournalKind', example: 'auto' })
  kind!: string;

  @ApiProperty({ enum: JOURNAL_STATUSES, enumName: 'JournalStatus', example: 'posted' })
  status!: string;

  @ApiProperty({ example: 'รับสินค้า GR-2610-0003 — บริษัท กระดาษไทย จำกัด' })
  description!: string;

  @ApiProperty({ type: ErpGlSourceDocDto, nullable: true })
  source!: ErpGlSourceDocDto | null;

  @ApiProperty({ nullable: true, example: 'F01', description: 'The posting rule (automatic entries)' })
  ruleKey!: string | null;

  @ApiProperty({ nullable: true, example: null, description: 'The entry this one reverses' })
  reverses!: ErpGlSourceDocDto | null;

  @ApiProperty({ nullable: true, example: null, description: 'The reversal of this entry, if any' })
  reversedBy!: ErpGlSourceDocDto | null;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: null, description: 'An accrual reverses itself on this day' })
  autoReverseOn!: string | null;

  @ApiProperty({ example: '12500.00', pattern: AMOUNT.source })
  totalDebit!: string;

  @ApiProperty({ example: '12500.00', pattern: AMOUNT.source })
  totalCredit!: string;

  @ApiProperty({ nullable: true, example: null })
  rejectionReason!: string | null;

  @ApiProperty({ type: [ErpGlJournalLineDto] })
  lines!: ErpGlJournalLineDto[];

  @ApiProperty({ nullable: true, example: 'ระบบ (กฎ F01)' })
  createdBy!: string | null;

  @ApiProperty({ type: String, format: 'date-time', example: '2026-10-13T10:00:00+07:00' })
  createdAt!: string;

  @ApiProperty({ nullable: true, example: null })
  approvedBy!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-13T10:00:00+07:00' })
  postedAt!: string | null;

  @ApiProperty({ type: [NextActionDto] })
  nextActions!: NextActionDto[];

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ErpGlJournalListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: JOURNAL_KINDS, enumName: 'JournalKind' })
  @IsOptional()
  @IsIn(JOURNAL_KINDS)
  kind?: string;

  @ApiPropertyOptional({ enum: JOURNAL_STATUSES, enumName: 'JournalStatus' })
  @IsOptional()
  @IsIn(JOURNAL_STATUSES)
  status?: string;

  @ApiPropertyOptional({ example: '2026-10', pattern: MONTH.source })
  @IsOptional()
  @Matches(MONTH)
  month?: string;

  @ApiPropertyOptional({ example: '1141', description: 'Entries with a line on this account code' })
  @IsOptional()
  @Transform(trim)
  @Matches(ACCOUNT_CODE)
  accountCode?: string;


  @ApiPropertyOptional({ format: 'uuid', description: 'Entries posted from this document' })
  @IsOptional()
  @IsUUID()
  sourceId?: string;
}

export class ErpGlJournalLineInputDto {
  @ApiProperty({ example: '6150', pattern: ACCOUNT_CODE.source })
  @Transform(trim)
  @Matches(ACCOUNT_CODE)
  accountCode!: string;

  @ApiProperty({ enum: LEDGER_SIDES, enumName: 'LedgerSide', example: 'debit' })
  @IsIn(LEDGER_SIDES)
  side!: string;

  @ApiProperty({ example: '15000.00', pattern: AMOUNT.source })
  @Matches(AMOUNT)
  amount!: string;

  @ApiPropertyOptional({ nullable: true, example: 'ค่าเช่าโรงงาน ต.ค.', maxLength: 300 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  itemId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  partnerId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  warehouseId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  productionOrderId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  machineId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  bankAccountId?: string | null;

  @ApiPropertyOptional({ enum: TAX_CODES, enumName: 'TaxCode', nullable: true })
  @IsOptional()
  @IsIn(TAX_CODES)
  taxCode?: string | null;

  @ApiPropertyOptional({ nullable: true, pattern: AMOUNT.source })
  @IsOptional()
  @Matches(AMOUNT)
  taxBaseAmount?: string | null;
}

export class ErpGlSaveJournalDto {
  @ApiProperty({ example: '2026-10-31', pattern: DAY.source })
  @Matches(DAY)
  documentDate!: string;

  @ApiProperty({ example: 'ค่าเช่าโรงงานเดือนตุลาคม', minLength: 1, maxLength: 500 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string;

  @ApiPropertyOptional({ nullable: true, example: null, pattern: DAY.source, description: 'An accrual: reverse itself on this day' })
  @IsOptional()
  @Matches(DAY)
  autoReverseOn?: string | null;

  @ApiProperty({ type: [ErpGlJournalLineInputDto], minItems: 2, maxItems: 200 })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ErpGlJournalLineInputDto)
  lines!: ErpGlJournalLineInputDto[];

  @ApiPropertyOptional({ example: false, description: 'Submit for approval right away' })
  @IsOptional()
  @IsBoolean()
  submit?: boolean;
}

export class ErpGlReverseJournalDto {
  @ApiProperty({ example: '2026-11-01', pattern: DAY.source })
  @Matches(DAY)
  documentDate!: string;

  @ApiProperty({ example: 'กลับรายการค่าเช่าที่บันทึกซ้ำ', minLength: 3, maxLength: 500 })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class ErpGlRecurringLineDto {
  @ApiProperty({ example: '6150', pattern: ACCOUNT_CODE.source })
  @Transform(trim)
  @Matches(ACCOUNT_CODE)
  accountCode!: string;

  @ApiProperty({ enum: LEDGER_SIDES, enumName: 'LedgerSide', example: 'debit' })
  @IsIn(LEDGER_SIDES)
  side!: string;

  @ApiProperty({ example: '15000.00', pattern: AMOUNT.source })
  @Matches(AMOUNT)
  amount!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 300 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  description?: string | null;
}

export class ErpGlSaveRecurringDto {
  @ApiProperty({ example: 'ค่าเช่าโรงงานรายเดือน', minLength: 1, maxLength: 200 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 'ค่าเช่าโรงงาน {month}', minLength: 1, maxLength: 500, description: '`{month}` is replaced by the run month' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string;

  @ApiProperty({ example: 28, minimum: 1, maximum: 28 })
  @IsInt()
  @Min(1)
  @Max(28)
  dayOfMonth!: number;

  @ApiProperty({ example: '2026-10-01', pattern: DAY.source })
  @Matches(DAY)
  startOn!: string;

  @ApiPropertyOptional({ nullable: true, example: null, pattern: DAY.source })
  @IsOptional()
  @Matches(DAY)
  endOn?: string | null;

  @ApiPropertyOptional({ example: false, description: 'An accrual: each run reverses on the 1st of the next month' })
  @IsOptional()
  @IsBoolean()
  autoReverse?: boolean;

  @ApiProperty({ type: [ErpGlRecurringLineDto], minItems: 2, maxItems: 50 })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ErpGlRecurringLineDto)
  lines!: ErpGlRecurringLineDto[];

  @ApiPropertyOptional({ enum: ACCOUNT_STATUSES, enumName: 'CapabilityStatus', default: 'active' })
  @IsOptional()
  @IsIn(ACCOUNT_STATUSES)
  status?: string;
}

export class ErpGlRecurringDto {
  @ApiProperty({ format: 'uuid', example: E6_IDS.recurring })
  id!: string;

  @ApiProperty({ example: 'ค่าเช่าโรงงานรายเดือน' })
  name!: string;

  @ApiProperty({ example: 'ค่าเช่าโรงงาน {month}' })
  description!: string;

  @ApiProperty({ example: 28 })
  dayOfMonth!: number;

  @ApiProperty({ type: String, format: 'date', example: '2026-10-01' })
  startOn!: string;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: null })
  endOn!: string | null;

  @ApiProperty({ example: false })
  autoReverse!: boolean;

  @ApiProperty({ type: [ErpGlRecurringLineDto] })
  lines!: ErpGlRecurringLineDto[];

  @ApiProperty({ enum: ACCOUNT_STATUSES, enumName: 'CapabilityStatus', example: 'active' })
  status!: string;

  @ApiProperty({ nullable: true, example: '2026-10', description: 'The last month it ran' })
  lastRunMonth!: string | null;

  @ApiProperty({ example: '15000.00', pattern: AMOUNT.source })
  total!: string;

  @ApiProperty({ type: [NextActionDto] })
  nextActions!: NextActionDto[];

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ErpGlRuleDto {
  @ApiProperty({ format: 'uuid', example: E6_IDS.rule })
  id!: string;

  @ApiProperty({ example: 'F01' })
  key!: string;

  @ApiProperty({ example: 'erp_goods_receipt.posted' })
  eventType!: string;

  @ApiProperty({ example: 'รับสินค้าเข้าคลัง' })
  name!: string;

  @ApiProperty({ example: 'Goods receipt: inventory at cost excl. VAT against GR/IR clearing' })
  description!: string;

  @ApiProperty({ example: 1, nullable: true, description: 'The approved version in force' })
  versionNo!: number | null;

  @ApiProperty({ type: 'object', additionalProperties: true, description: 'The template of the version in force' })
  template!: Record<string, unknown>;

  @ApiProperty({ type: [String], example: ['1141', '2115'], description: 'Literal account codes the template posts to' })
  accountCodes!: string[];

  @ApiProperty({ example: 12, description: 'Entries posted by this rule' })
  entries!: number;
}

export class ErpGlCatchUpDto {
  @ApiProperty({ example: 14, description: 'Events posted' })
  posted!: number;

  @ApiProperty({ example: 2, description: 'Events skipped (already posted or nothing to post)' })
  skipped!: number;

  @ApiProperty({ type: [String], example: [], description: 'Events that failed, as `type aggregateId: reason`' })
  failed!: string[];
}

// ------------------------------------------------------------------------------------- reports

export class ErpGlRangeQuery {
  @ApiProperty({ example: '2026-10-01', pattern: DAY.source })
  @Matches(DAY)
  from!: string;

  @ApiProperty({ example: '2026-10-31', pattern: DAY.source })
  @Matches(DAY)
  to!: string;
}

export class ErpGlAsOfQuery {
  @ApiProperty({ example: '2026-10-31', pattern: DAY.source })
  @Matches(DAY)
  asOf!: string;
}

export class ErpGlMonthQuery {
  @ApiProperty({ example: '2026-10', pattern: MONTH.source })
  @Matches(MONTH)
  month!: string;
}

export class ErpGlTrialBalanceRowDto {
  @ApiProperty({ type: ErpGlAccountRefDto })
  account!: ErpGlAccountRefDto;

  @ApiProperty({ enum: ACCOUNT_TYPES, enumName: 'AccountType', example: 'asset' })
  accountType!: string;

  @ApiProperty({ example: '100000.00', pattern: SIGNED_AMOUNT.source, description: 'Opening balance, debit positive' })
  opening!: string;

  @ApiProperty({ example: '45000.00', pattern: AMOUNT.source })
  debit!: string;

  @ApiProperty({ example: '20000.00', pattern: AMOUNT.source })
  credit!: string;

  @ApiProperty({ example: '125000.00', pattern: SIGNED_AMOUNT.source, description: 'Closing balance, debit positive' })
  closing!: string;
}

export class ErpGlTrialBalanceDto {
  @ApiProperty({ type: String, format: 'date', example: '2026-10-01' })
  from!: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-10-31' })
  to!: string;

  @ApiProperty({ type: [ErpGlTrialBalanceRowDto] })
  rows!: ErpGlTrialBalanceRowDto[];

  @ApiProperty({ example: '845000.00', pattern: AMOUNT.source })
  totalDebit!: string;

  @ApiProperty({ example: '845000.00', pattern: AMOUNT.source })
  totalCredit!: string;

  @ApiProperty({ example: true, description: 'Debits equal credits' })
  balanced!: boolean;
}

export class ErpGlDetailQuery extends ErpGlRangeQuery {
  @ApiProperty({ example: '1141', pattern: ACCOUNT_CODE.source })
  @Transform(trim)
  @Matches(ACCOUNT_CODE)
  accountCode!: string;
}

export class ErpGlDetailRowDto {
  @ApiProperty({ format: 'uuid', example: E6_IDS.entry })
  entryId!: string;

  @ApiProperty({ example: 'JV-2610-0012' })
  entryNo!: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-10-13' })
  entryDate!: string;

  @ApiProperty({ example: 'รับสินค้า GR-2610-0003 — บริษัท กระดาษไทย จำกัด' })
  description!: string;

  @ApiProperty({ type: ErpGlSourceDocDto, nullable: true })
  source!: ErpGlSourceDocDto | null;

  @ApiProperty({ example: '12500.00', pattern: AMOUNT.source })
  debit!: string;

  @ApiProperty({ example: '0.00', pattern: AMOUNT.source })
  credit!: string;

  @ApiProperty({ example: '112500.00', pattern: SIGNED_AMOUNT.source, description: 'Running balance, debit positive' })
  balance!: string;
}

export class ErpGlDetailDto {
  @ApiProperty({ type: ErpGlAccountRefDto })
  account!: ErpGlAccountRefDto;

  @ApiProperty({ type: String, format: 'date', example: '2026-10-01' })
  from!: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-10-31' })
  to!: string;

  @ApiProperty({ example: '100000.00', pattern: SIGNED_AMOUNT.source })
  opening!: string;

  @ApiProperty({ type: [ErpGlDetailRowDto] })
  rows!: ErpGlDetailRowDto[];

  @ApiProperty({ example: '125000.00', pattern: SIGNED_AMOUNT.source })
  closing!: string;
}

export class ErpGlStatementAccountDto {
  @ApiProperty({ type: ErpGlAccountRefDto })
  account!: ErpGlAccountRefDto;

  @ApiProperty({ example: '245000.00', pattern: SIGNED_AMOUNT.source, description: 'This period (P&L) or as of (BS), on the natural side of the section' })
  amount!: string;

  @ApiProperty({ example: '610000.00', pattern: SIGNED_AMOUNT.source, nullable: true, description: 'Year to date (P&L) or the comparative (BS)' })
  comparative!: string | null;
}

export class ErpGlStatementLineDto {
  @ApiProperty({ enum: STATEMENT_LINES, enumName: 'ErpGlStatementLine', example: 'inventory' })
  key!: string;

  @ApiProperty({ type: [ErpGlStatementAccountDto] })
  accounts!: ErpGlStatementAccountDto[];

  @ApiProperty({ example: '845000.00', pattern: SIGNED_AMOUNT.source })
  amount!: string;

  @ApiProperty({ example: '610000.00', pattern: SIGNED_AMOUNT.source, nullable: true })
  comparative!: string | null;
}

export class ErpGlStatementSectionDto {
  @ApiProperty({ enum: ERP_GL_REPORT_SECTIONS, enumName: 'ErpGlReportSection', example: 'revenue' })
  key!: string;

  @ApiProperty({ type: [ErpGlStatementLineDto] })
  lines!: ErpGlStatementLineDto[];

  @ApiProperty({ example: '245000.00', pattern: SIGNED_AMOUNT.source })
  amount!: string;

  @ApiProperty({ example: '610000.00', pattern: SIGNED_AMOUNT.source, nullable: true })
  comparative!: string | null;
}

export class ErpGlProfitAndLossDto {
  @ApiProperty({ example: '2026-10' })
  month!: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-10-01', description: 'Fiscal year start (YTD comparative)' })
  yearStart!: string;

  @ApiProperty({ type: [ErpGlStatementSectionDto] })
  sections!: ErpGlStatementSectionDto[];

  @ApiProperty({ example: '245000.00', pattern: SIGNED_AMOUNT.source })
  revenue!: string;

  @ApiProperty({ example: '180000.00', pattern: SIGNED_AMOUNT.source })
  costOfSales!: string;

  @ApiProperty({ example: '65000.00', pattern: SIGNED_AMOUNT.source })
  grossProfit!: string;

  @ApiProperty({ example: '22000.00', pattern: SIGNED_AMOUNT.source })
  expenses!: string;

  @ApiProperty({ example: '43000.00', pattern: SIGNED_AMOUNT.source })
  netProfit!: string;

  @ApiProperty({ example: '96000.00', pattern: SIGNED_AMOUNT.source })
  netProfitYtd!: string;
}

export class ErpGlBalanceSheetDto {
  @ApiProperty({ type: String, format: 'date', example: '2026-10-31' })
  asOf!: string;

  @ApiProperty({ type: String, format: 'date', example: '2025-12-31', description: 'Comparative date (last fiscal year end)' })
  comparativeAsOf!: string;

  @ApiProperty({ type: [ErpGlStatementSectionDto], description: 'assets, liabilities, equity' })
  sections!: ErpGlStatementSectionDto[];

  @ApiProperty({ example: '1250000.00', pattern: SIGNED_AMOUNT.source })
  totalAssets!: string;

  @ApiProperty({ example: '420000.00', pattern: SIGNED_AMOUNT.source })
  totalLiabilities!: string;

  @ApiProperty({ example: '830000.00', pattern: SIGNED_AMOUNT.source, description: 'Including the current-year profit' })
  totalEquity!: string;

  @ApiProperty({ example: '96000.00', pattern: SIGNED_AMOUNT.source })
  currentYearProfit!: string;

  @ApiProperty({ example: true })
  balanced!: boolean;
}

export class ErpGlCashFlowSectionDto {
  @ApiProperty({ enum: ERP_GL_CASH_FLOW_SECTIONS, enumName: 'ErpGlCashFlowSection', example: 'operating' })
  key!: string;

  @ApiProperty({ type: [ErpGlStatementAccountDto], description: 'Changes by account (cash inflow positive)' })
  accounts!: ErpGlStatementAccountDto[];

  @ApiProperty({ example: '52000.00', pattern: SIGNED_AMOUNT.source })
  amount!: string;
}

export class ErpGlCashFlowDto {
  @ApiProperty({ type: String, format: 'date', example: '2026-10-01' })
  from!: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-10-31' })
  to!: string;

  @ApiProperty({ example: '43000.00', pattern: SIGNED_AMOUNT.source })
  netProfit!: string;

  @ApiProperty({ example: '12000.00', pattern: SIGNED_AMOUNT.source, description: 'Depreciation and other non-cash items' })
  nonCash!: string;

  @ApiProperty({ type: [ErpGlCashFlowSectionDto] })
  sections!: ErpGlCashFlowSectionDto[];

  @ApiProperty({ example: '35000.00', pattern: SIGNED_AMOUNT.source })
  netChange!: string;

  @ApiProperty({ example: '150000.00', pattern: SIGNED_AMOUNT.source })
  openingCash!: string;

  @ApiProperty({ example: '185000.00', pattern: SIGNED_AMOUNT.source })
  closingCash!: string;
}

export class ErpGlStockValuationRowDto {
  @ApiProperty({ enum: ERP_ITEM_KINDS, enumName: 'ErpItemKind', example: 'raw_material' })
  kind!: string;

  @ApiProperty({ type: ErpGlAccountRefDto })
  account!: ErpGlAccountRefDto;

  @ApiProperty({ example: 12, description: 'Items with stock' })
  items!: number;

  @ApiProperty({ example: '520000.00', pattern: SIGNED_AMOUNT.source, description: 'Stock value (balances × average cost) as of the date' })
  stockValue!: string;

  @ApiProperty({ example: '520000.00', pattern: SIGNED_AMOUNT.source, description: 'Ledger balance as of the date' })
  ledgerBalance!: string;

  @ApiProperty({ example: '0.00', pattern: SIGNED_AMOUNT.source })
  difference!: string;
}

export class ErpGlStockValuationDto {
  @ApiProperty({ type: String, format: 'date', example: '2026-10-31' })
  asOf!: string;

  @ApiProperty({ type: [ErpGlStockValuationRowDto] })
  rows!: ErpGlStockValuationRowDto[];

  @ApiProperty({ example: '845000.00', pattern: SIGNED_AMOUNT.source })
  stockValue!: string;

  @ApiProperty({ example: '845000.00', pattern: SIGNED_AMOUNT.source })
  ledgerBalance!: string;

  @ApiProperty({ example: '0.00', pattern: SIGNED_AMOUNT.source })
  difference!: string;
}

// -------------------------------------------------------------------------------- fixed assets

export class ErpGlSaveAssetCategoryDto {
  @ApiProperty({ example: 'เครื่องจักร', minLength: 1, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 60, minimum: 1, maximum: 600 })
  @IsInt()
  @Min(1)
  @Max(600)
  usefulLifeMonths!: number;

  @ApiProperty({ example: '1230', pattern: ACCOUNT_CODE.source })
  @Transform(trim)
  @Matches(ACCOUNT_CODE)
  assetAccountCode!: string;

  @ApiProperty({ example: '1239', pattern: ACCOUNT_CODE.source })
  @Transform(trim)
  @Matches(ACCOUNT_CODE)
  accumulatedAccountCode!: string;

  @ApiProperty({ example: '5240', pattern: ACCOUNT_CODE.source })
  @Transform(trim)
  @Matches(ACCOUNT_CODE)
  expenseAccountCode!: string;

  @ApiProperty({ example: '4920', pattern: ACCOUNT_CODE.source })
  @Transform(trim)
  @Matches(ACCOUNT_CODE)
  gainLossAccountCode!: string;

  @ApiPropertyOptional({ enum: ACCOUNT_STATUSES, enumName: 'CapabilityStatus', default: 'active' })
  @IsOptional()
  @IsIn(ACCOUNT_STATUSES)
  status?: string;
}

export class ErpGlAssetCategoryDto {
  @ApiProperty({ format: 'uuid', example: E6_IDS.category })
  id!: string;

  @ApiProperty({ example: 'เครื่องจักร' })
  name!: string;

  @ApiProperty({ example: 60 })
  usefulLifeMonths!: number;

  @ApiProperty({ type: ErpGlAccountRefDto })
  assetAccount!: ErpGlAccountRefDto;

  @ApiProperty({ type: ErpGlAccountRefDto })
  accumulatedAccount!: ErpGlAccountRefDto;

  @ApiProperty({ type: ErpGlAccountRefDto })
  expenseAccount!: ErpGlAccountRefDto;

  @ApiProperty({ type: ErpGlAccountRefDto })
  gainLossAccount!: ErpGlAccountRefDto;

  @ApiProperty({ enum: ACCOUNT_STATUSES, enumName: 'CapabilityStatus', example: 'active' })
  status!: string;

  @ApiProperty({ example: 3, description: 'Active assets' })
  assets!: number;
}

export class ErpGlCreateAssetDto {
  @ApiProperty({ format: 'uuid', example: E6_IDS.category })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ example: 'เครื่องพิมพ์ออฟเซ็ท 4 สี', minLength: 1, maxLength: 200 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: '2026-01-15', pattern: DAY.source })
  @Matches(DAY)
  acquiredOn!: string;

  @ApiProperty({ example: '2400000.00', pattern: AMOUNT.source })
  @Matches(AMOUNT)
  cost!: string;

  @ApiPropertyOptional({ example: '0.00', pattern: AMOUNT.source, default: '0.00' })
  @IsOptional()
  @Matches(AMOUNT)
  salvageValue?: string;

  @ApiPropertyOptional({ example: 60, minimum: 1, maximum: 600, description: 'Default: the category’s' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  usefulLifeMonths?: number;

  @ApiPropertyOptional({ example: '2026-02-01', pattern: DAY.source, description: 'First month depreciated; default: the month after acquisition' })
  @IsOptional()
  @Matches(DAY)
  depreciationStart?: string;

  @ApiPropertyOptional({ example: '0.00', pattern: AMOUNT.source, description: 'Depreciation already taken before the ledger started (opening balance)' })
  @IsOptional()
  @Matches(AMOUNT)
  openingAccumulated?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'The factory machine this asset is' })
  @IsOptional()
  @IsUUID()
  machineId?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class ErpGlDisposeAssetDto {
  @ApiProperty({ example: '2026-10-31', pattern: DAY.source })
  @Matches(DAY)
  disposedOn!: string;

  @ApiPropertyOptional({ example: '150000.00', pattern: AMOUNT.source, description: 'Sale proceeds; omit or 0 for a write-off' })
  @IsOptional()
  @Matches(AMOUNT)
  proceeds?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'The bank account the proceeds went to (default: the default bank account; cash if none)' })
  @IsOptional()
  @IsUUID()
  bankAccountId?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class ErpGlAssetDto {
  @ApiProperty({ format: 'uuid', example: E6_IDS.asset })
  id!: string;

  @ApiProperty({ example: 'FA-2610-0001' })
  assetNo!: string;

  @ApiProperty({ example: 'เครื่องพิมพ์ออฟเซ็ท 4 สี' })
  name!: string;

  @ApiProperty({ type: PersonRefDto, description: 'Category' })
  category!: PersonRefDto;

  @ApiProperty({ type: PersonRefDto, nullable: true, description: 'Machine' })
  machine!: PersonRefDto | null;

  @ApiProperty({ type: String, format: 'date', example: '2026-01-15' })
  acquiredOn!: string;

  @ApiProperty({ example: '2400000.00', pattern: AMOUNT.source })
  cost!: string;

  @ApiProperty({ example: '0.00', pattern: AMOUNT.source })
  salvageValue!: string;

  @ApiProperty({ example: 60 })
  usefulLifeMonths!: number;

  @ApiProperty({ type: String, format: 'date', example: '2026-02-01' })
  depreciationStart!: string;

  @ApiProperty({ example: '40000.00', pattern: AMOUNT.source, description: 'Per month, straight line' })
  monthlyDepreciation!: string;

  @ApiProperty({ example: '320000.00', pattern: AMOUNT.source })
  accumulated!: string;

  @ApiProperty({ example: '2080000.00', pattern: AMOUNT.source })
  netBookValue!: string;

  @ApiProperty({ example: 8 })
  monthsDepreciated!: number;

  @ApiProperty({ enum: ERP_GL_ASSET_STATUSES, enumName: 'ErpGlAssetStatus', example: 'active' })
  status!: string;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: null })
  disposedOn!: string | null;

  @ApiProperty({ nullable: true, example: null, pattern: AMOUNT.source })
  proceeds!: string | null;

  @ApiProperty({ nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ type: [NextActionDto] })
  nextActions!: NextActionDto[];

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ErpGlAssetListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ERP_GL_ASSET_STATUSES, enumName: 'ErpGlAssetStatus' })
  @IsOptional()
  @IsIn(ERP_GL_ASSET_STATUSES)
  status?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

export class ErpGlDepreciationLineDto {
  @ApiProperty({ type: PersonRefDto, description: 'Asset `{ id, name: "FA-… · name" }`' })
  asset!: PersonRefDto;

  @ApiProperty({ example: 1 })
  months!: number;

  @ApiProperty({ example: '40000.00', pattern: AMOUNT.source })
  amount!: string;

  @ApiProperty({ example: '360000.00', pattern: AMOUNT.source })
  accumulatedAfter!: string;
}

export class ErpGlDepreciationRunDto {
  @ApiProperty({ format: 'uuid', example: E6_IDS.run })
  id!: string;

  @ApiProperty({ example: '2026-10' })
  month!: string;

  @ApiProperty({ format: 'uuid', example: E6_IDS.period })
  periodId!: string;

  @ApiProperty({ type: ErpGlSourceDocDto, nullable: true, description: 'The journal entry posted' })
  entry!: ErpGlSourceDocDto | null;

  @ApiProperty({ example: '52000.00', pattern: AMOUNT.source })
  total!: string;

  @ApiProperty({ type: [ErpGlDepreciationLineDto] })
  lines!: ErpGlDepreciationLineDto[];

  @ApiProperty({ example: 'ฝ่ายบัญชีโรงงาน ทดสอบ' })
  createdBy!: string;

  @ApiProperty({ type: String, format: 'date-time', example: '2026-10-31T17:00:00+07:00' })
  createdAt!: string;
}

// ---------------------------------------------------------------------------------------- bank

export class ErpGlSaveBankAccountDto {
  @ApiProperty({ example: 'กสิกรไทย ออมทรัพย์', minLength: 1, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'KBANK', minLength: 1, maxLength: 50 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  bankName!: string;

  @ApiProperty({ example: '4321', pattern: '^\\d{4}$', description: 'Last four digits only' })
  @Matches(/^\d{4}$/)
  accountNoLast4!: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ enum: ACCOUNT_STATUSES, enumName: 'CapabilityStatus', default: 'active' })
  @IsOptional()
  @IsIn(ACCOUNT_STATUSES)
  status?: string;
}

export class ErpGlBankAccountDto {
  @ApiProperty({ format: 'uuid', example: E6_IDS.bankAccount })
  id!: string;

  @ApiProperty({ example: 'กสิกรไทย ออมทรัพย์' })
  name!: string;

  @ApiProperty({ example: 'KBANK' })
  bankName!: string;

  @ApiProperty({ example: '4321' })
  accountNoLast4!: string;

  @ApiProperty({ type: ErpGlAccountRefDto, description: 'Its sub-account under bank deposits' })
  glAccount!: ErpGlAccountRefDto;

  @ApiProperty({ example: true })
  isDefault!: boolean;

  @ApiProperty({ enum: ACCOUNT_STATUSES, enumName: 'CapabilityStatus', example: 'active' })
  status!: string;

  @ApiProperty({ example: '185000.00', pattern: SIGNED_AMOUNT.source, description: 'Ledger balance today' })
  ledgerBalance!: string;

  @ApiProperty({ example: 3, description: 'Statement lines not yet matched or ignored' })
  openLines!: number;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-10-12', description: 'Last statement line imported' })
  lastStatementDate!: string | null;

  @ApiProperty({ type: [NextActionDto] })
  nextActions!: NextActionDto[];

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ErpGlStatementRowInputDto {
  @ApiProperty({ example: '2026-10-12', pattern: DAY.source })
  @Matches(DAY)
  txnDate!: string;

  @ApiProperty({ example: '-12500.00', pattern: SIGNED_AMOUNT.source, description: 'Signed: deposits positive, withdrawals negative' })
  @Matches(SIGNED_AMOUNT)
  amount!: string;

  @ApiProperty({ example: 'โอนเงิน บจก.กระดาษไทย', maxLength: 300 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  description!: string;

  @ApiPropertyOptional({ nullable: true, example: 'TRF2026101200123', maxLength: 100 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(100)
  reference?: string | null;
}

export class ErpGlImportStatementDto {
  @ApiPropertyOptional({ type: [ErpGlStatementRowInputDto], maxItems: 2000, description: 'Rows keyed in or parsed by the browser' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => ErpGlStatementRowInputDto)
  rows?: ErpGlStatementRowInputDto[];

  @ApiPropertyOptional({ example: 'generic_csv', description: 'A bank file format key, with `file`' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  format?: string;

  @ApiPropertyOptional({ description: 'The statement file (CSV), base64', maxLength: 4_000_000 })
  @IsOptional()
  @IsString()
  @MaxLength(4_000_000)
  file?: string;
}

export class ErpGlImportResultDto {
  @ApiProperty({ example: 25 })
  imported!: number;

  @ApiProperty({ example: 3, description: 'Lines already imported (same date, amount, description and reference)' })
  duplicates!: number;

  @ApiProperty({ example: 18, description: 'Lines matched automatically' })
  autoMatched!: number;
}

export class ErpGlBankMatchDto {
  @ApiProperty({ enum: ERP_GL_BANK_MATCH_TARGETS, enumName: 'ErpGlBankMatchTarget', example: 'supplier_payment' })
  targetType!: string;

  @ApiProperty({ format: 'uuid', nullable: true, example: E6_IDS.payment })
  targetId!: string | null;

  @ApiProperty({ nullable: true, example: 'PV-2610-0004' })
  targetNo!: string | null;

  @ApiProperty({ type: ErpGlSourceDocDto, nullable: true, description: 'The journal entry (bank fee / interest)' })
  entry!: ErpGlSourceDocDto | null;

  @ApiProperty({ example: '12500.00', pattern: AMOUNT.source })
  amount!: string;

  @ApiProperty({ example: true })
  auto!: boolean;

  @ApiProperty({ nullable: true, example: null })
  matchedBy!: string | null;

  @ApiProperty({ type: String, format: 'date-time', example: '2026-10-13T10:00:00+07:00' })
  matchedAt!: string;
}

export class ErpGlBankLineDto {
  @ApiProperty({ format: 'uuid', example: E6_IDS.bankLine })
  id!: string;

  @ApiProperty({ type: PersonRefDto, description: 'Bank account' })
  bankAccount!: PersonRefDto;

  @ApiProperty({ type: String, format: 'date', example: '2026-10-12' })
  txnDate!: string;

  @ApiProperty({ example: '-12500.00', pattern: SIGNED_AMOUNT.source })
  amount!: string;

  @ApiProperty({ example: 'โอนเงิน บจก.กระดาษไทย' })
  description!: string;

  @ApiProperty({ nullable: true, example: 'TRF2026101200123' })
  reference!: string | null;

  @ApiProperty({ enum: ERP_GL_BANK_LINE_STATUSES, enumName: 'ErpGlBankLineStatus', example: 'matched' })
  status!: string;

  @ApiProperty({ nullable: true, example: null })
  ignoreReason!: string | null;

  @ApiProperty({ type: [ErpGlBankMatchDto] })
  matches!: ErpGlBankMatchDto[];

  @ApiProperty({ type: [ErpGlBankMatchDto], description: 'Possible matches (open lines): same amount within 3 days' })
  candidates!: ErpGlBankMatchDto[];

  @ApiProperty({ type: String, format: 'date-time', example: '2026-10-13T09:30:00+07:00' })
  importedAt!: string;

  @ApiProperty({ type: [NextActionDto] })
  nextActions!: NextActionDto[];
}

export class ErpGlBankLineListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @ApiPropertyOptional({ enum: ERP_GL_BANK_LINE_STATUSES, enumName: 'ErpGlBankLineStatus' })
  @IsOptional()
  @IsIn(ERP_GL_BANK_LINE_STATUSES)
  status?: string;

  @ApiPropertyOptional({ example: '2026-10', pattern: MONTH.source })
  @IsOptional()
  @Matches(MONTH)
  month?: string;
}

export class ErpGlMatchBankLineDto {
  @ApiProperty({ enum: ERP_GL_BANK_MATCH_TARGETS, enumName: 'ErpGlBankMatchTarget', example: 'supplier_payment' })
  @IsIn(ERP_GL_BANK_MATCH_TARGETS)
  targetType!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'The payment, receipt or journal entry (not for a fee / interest)' })
  @IsOptional()
  @IsUUID()
  targetId?: string;
}

export class ErpGlCashPositionRowDto {
  @ApiProperty({ type: ErpGlBankAccountDto })
  account!: ErpGlBankAccountDto;

  @ApiProperty({ example: '-12500.00', pattern: SIGNED_AMOUNT.source, description: 'Sum of open (unreconciled) statement lines' })
  unreconciled!: string;
}

export class ErpGlCashPositionDto {
  @ApiProperty({ type: String, format: 'date', example: '2026-10-13' })
  asOf!: string;

  @ApiProperty({ example: '12000.00', pattern: SIGNED_AMOUNT.source, description: 'Cash on hand (ledger)' })
  cashOnHand!: string;

  @ApiProperty({ type: [ErpGlCashPositionRowDto] })
  banks!: ErpGlCashPositionRowDto[];

  @ApiProperty({ example: '197000.00', pattern: SIGNED_AMOUNT.source })
  total!: string;

  @ApiProperty({ example: '56000.00', pattern: SIGNED_AMOUNT.source, description: 'Supplier invoices due within 7 days' })
  payablesDue7d!: string;

  @ApiProperty({ example: '82000.00', pattern: SIGNED_AMOUNT.source, description: 'Customer invoices due within 7 days' })
  receivablesDue7d!: string;
}

// ----------------------------------------------------------------------------------------- tax

export class ErpGlTaxFilingDto {
  @ApiProperty({ enum: ERP_GL_TAX_RETURNS, enumName: 'TaxFilingKind', example: 'pp30' })
  form!: string;

  @ApiProperty({ example: '2026-10' })
  month!: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-11-15', description: 'E-filing due date' })
  dueOn!: string;

  @ApiProperty({ example: '12250.00', pattern: SIGNED_AMOUNT.source, description: 'From the ledger: output − input VAT (ภ.พ.30) or WHT payable movement' })
  ledgerAmount!: string;

  @ApiProperty({ example: '12250.00', pattern: SIGNED_AMOUNT.source, description: 'From the E4 tax reports (documents)' })
  documentsAmount!: string;

  @ApiProperty({ example: true })
  reconciled!: boolean;

  @ApiProperty({ example: false })
  filed!: boolean;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: null })
  filedOn!: string | null;

  @ApiProperty({ nullable: true, example: null })
  reference!: string | null;

  @ApiProperty({ nullable: true, example: null, pattern: SIGNED_AMOUNT.source, description: 'Amount filed' })
  filedAmount!: string | null;

  @ApiProperty({ nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ type: [NextActionDto] })
  nextActions!: NextActionDto[];
}

export class ErpGlTaxFilingListQuery {
  @ApiPropertyOptional({ example: 2026, description: 'Calendar year; default: the current one' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  year?: number;
}

export class ErpGlMarkFiledDto {
  @ApiProperty({ enum: ERP_GL_TAX_RETURNS, enumName: 'TaxFilingKind', example: 'pp30' })
  @IsIn(ERP_GL_TAX_RETURNS)
  form!: string;

  @ApiProperty({ example: '2026-10', pattern: MONTH.source })
  @Matches(MONTH)
  month!: string;

  @ApiProperty({ example: '2026-11-14', pattern: DAY.source })
  @Matches(DAY)
  filedOn!: string;

  @ApiPropertyOptional({ nullable: true, example: 'RD-EF-2611-000123', maxLength: 100 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(100)
  reference?: string | null;

  @ApiPropertyOptional({ example: '12250.00', pattern: SIGNED_AMOUNT.source, description: 'Default: the ledger amount' })
  @IsOptional()
  @Matches(SIGNED_AMOUNT)
  amount?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

/** For the dimension pickers of the manual-journal form. */
export const ERP_GL_DIMENSION_KEYS = ERP_GL_DIMENSIONS;
