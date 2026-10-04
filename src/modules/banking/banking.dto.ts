import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Cash & bank (B5.3, accounting-design §6, D-061, D-093). Money: strings, THB; amounts on lines are signed. */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^\d{1,12}\.\d{2}$/;
const SIGNED = /^-?\d{1,12}(\.\d{1,2})?$/;

export const PURPOSES = ['collection', 'payout', 'both'] as const;
export const MATCH_STATUSES = ['unmatched', 'matched', 'unidentified', 'ignored'] as const;
export const MATCH_TARGETS = [
  'payment',
  'gateway_settlement',
  'payout_run',
  'refund',
  'unidentified_receipt',
  'tax_payment',
] as const;
export const UNIDENTIFIED_STATUSES = ['open', 'matched', 'refunded'] as const;

export const BANK_IDS = {
  account: '0192f3a0-7c1e-7d2a-9b1f-000000530103',
  approval: '0192f3a0-7c1e-7d2a-9b1f-000000530201',
  line: '0192f3a0-7c1e-7d2a-9b1f-000000530202',
  import: '0192f3a0-7c1e-7d2a-9b1f-000000530203',
  receipt: '0192f3a0-7c1e-7d2a-9b1f-000000530204',
  settlement: '0192f3a0-7c1e-7d2a-9b1f-000000530205',
  group: '0192f3a0-7c1e-7d2a-9b1f-0000000b0001',
  file: '0192f3a0-7c1e-7d2a-9b1f-000000530206',
};

export class CompanyBankAccountDto {
  @ApiProperty({ format: 'uuid', example: BANK_IDS.account })
  id!: string;

  @ApiProperty({ example: '014' })
  bankCode!: string;

  @ApiProperty({ type: String, nullable: true, example: 'สาขาตัวอย่าง' })
  branchName!: string | null;

  @ApiProperty({ example: 'บริษัท คอลเลคทีฟ กรุ๊ป (ประเทศไทย) จำกัด (fake)' })
  accountName!: string;

  @ApiProperty({ example: '1234', description: 'Only the last 4 digits ever leave the API (PDPA)' })
  accountNoLast4!: string;

  @ApiProperty({ example: '1121', description: 'Its own postable cash GL account (112x)' })
  glAccountCode!: string;

  @ApiProperty({ enum: PURPOSES, enumName: 'BankAccountPurpose', example: 'both' })
  purpose!: string;

  @ApiProperty({ example: 'generic_csv' })
  defaultBulkFormat!: string;

  @ApiProperty({
    enum: ['pending_approval', 'active', 'superseded', 'rejected'],
    enumName: 'BankAccountStatus',
    example: 'active',
  })
  status!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: BANK_IDS.approval })
  approvalRequestId!: string | null;
}

export const COMPANY_ACCOUNT_EXAMPLE: CompanyBankAccountDto = {
  id: BANK_IDS.account,
  bankCode: '014',
  branchName: 'สาขาตัวอย่าง',
  accountName: 'บริษัท คอลเลคทีฟ กรุ๊ป (ประเทศไทย) จำกัด (fake)',
  accountNoLast4: '1234',
  glAccountCode: '1121',
  purpose: 'both',
  defaultBulkFormat: 'generic_csv',
  status: 'active',
  approvalRequestId: BANK_IDS.approval,
};

export class ProposeCompanyBankAccountDto {
  @ApiProperty({ example: '014', pattern: '^[A-Z0-9]{3,11}$' })
  @Matches(/^[A-Z0-9]{3,11}$/)
  bankCode!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'สาขาตัวอย่าง' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  branchName?: string | null;

  @ApiProperty({ example: 'บริษัท คอลเลคทีฟ กรุ๊ป (ประเทศไทย) จำกัด (fake)' })
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  accountName!: string;

  @ApiProperty({ example: '000-0-00000-1', description: 'Stored encrypted; never returned or logged' })
  @Matches(/^[0-9][0-9 -]{4,28}[0-9]$/)
  accountNo!: string;

  @ApiProperty({
    example: '1121',
    description: 'A postable, active cash account not linked to another bank account',
  })
  @Matches(/^[0-9A-Z][0-9A-Z.-]*$/)
  glAccountCode!: string;

  @ApiProperty({ enum: PURPOSES, enumName: 'BankAccountPurpose', example: 'both' })
  @IsIn(PURPOSES)
  purpose!: (typeof PURPOSES)[number];

  @ApiPropertyOptional({ example: 'generic_csv' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  defaultBulkFormat?: string;
}

export class StatementRowDto {
  @ApiProperty({ format: 'date', example: '2026-10-27' })
  @Matches(DAY)
  txnDate!: string;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true, example: null })
  @IsOptional()
  @Matches(DAY)
  valueDate?: string | null;

  @ApiProperty({ example: '-5504.40', description: 'Signed: + money in, − money out' })
  @Matches(SIGNED)
  amount!: string;

  @ApiProperty({ example: 'TRF OUT PR20261027' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'PR20261027-ABC' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  counterparty?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '100000.00' })
  @IsOptional()
  @Matches(SIGNED)
  balance?: string | null;
}

export class ImportStatementDto {
  @ApiProperty({ format: 'uuid', example: BANK_IDS.account })
  @IsUUID()
  companyBankAccountId!: string;

  @ApiPropertyOptional({
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000b2005',
    format: 'uuid',
    description: 'An uploaded statement file, parsed by `format`',
  })
  @IsOptional()
  @IsUUID()
  fileId?: string;

  @ApiPropertyOptional({ example: 'generic_csv' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  format?: string;

  @ApiPropertyOptional({ type: [StatementRowDto], description: 'Rows from a bank API instead of a file' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => StatementRowDto)
  rows?: StatementRowDto[];
}

export class ImportResultDto {
  @ApiProperty({ format: 'uuid', example: BANK_IDS.import })
  importId!: string;

  @ApiProperty({
    type: 'integer',
    example: 12,
    description: 'New lines (lines already imported are skipped)',
  })
  lines!: number;

  @ApiProperty({ type: 'integer', example: 9, description: 'Lines matched automatically' })
  matched!: number;
}

export class BankMatchDto {
  @ApiProperty({ enum: MATCH_TARGETS, enumName: 'BankMatchTarget', example: 'payout_run' })
  targetType!: string;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-000000530101' })
  targetId!: string;

  @ApiProperty({ example: '-5504.40' })
  amount!: string;

  @ApiProperty({ example: true })
  auto!: boolean;
}

export class BankStatementLineDto {
  @ApiProperty({ format: 'uuid', example: BANK_IDS.line })
  id!: string;

  @ApiProperty({ format: 'uuid', example: BANK_IDS.account })
  companyBankAccountId!: string;

  @ApiProperty({ example: '1234' })
  accountNoLast4!: string;

  @ApiProperty({ format: 'date', example: '2026-10-27' })
  txnDate!: string;

  @ApiProperty({ example: '-5504.40' })
  amount!: string;

  @ApiProperty({ example: 'TRF OUT PR20261027' })
  description!: string;

  @ApiProperty({ type: String, nullable: true, example: 'PR20261027-ABC' })
  reference!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '94495.60' })
  runningBalance!: string | null;

  @ApiProperty({ enum: MATCH_STATUSES, enumName: 'BankMatchStatus', example: 'matched' })
  matchStatus!: string;

  @ApiProperty({ type: [BankMatchDto] })
  matches!: BankMatchDto[];
}

export const LINE_EXAMPLE: BankStatementLineDto = {
  id: BANK_IDS.line,
  companyBankAccountId: BANK_IDS.account,
  accountNoLast4: '1234',
  txnDate: '2026-10-27',
  amount: '-5504.40',
  description: 'TRF OUT PR20261027',
  reference: 'PR20261027-ABC',
  runningBalance: '94495.60',
  matchStatus: 'matched',
  matches: [
    {
      targetType: 'payout_run',
      targetId: '0192f3a0-7c1e-7d2a-9b1f-000000530101',
      amount: '-5504.40',
      auto: true,
    },
  ],
};

export class StatementLineQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  companyBankAccountId?: string;

  @ApiPropertyOptional({ enum: MATCH_STATUSES, enumName: 'BankMatchStatus' })
  @IsOptional()
  @IsIn(MATCH_STATUSES)
  matchStatus?: (typeof MATCH_STATUSES)[number];
}

export class ManualMatchDto {
  @ApiProperty({ enum: MATCH_TARGETS, enumName: 'BankMatchTarget', example: 'payment' })
  @IsIn(MATCH_TARGETS)
  targetType!: (typeof MATCH_TARGETS)[number];

  @ApiProperty({ example: '0192f3a0-7c1e-7d2a-9b1f-0000000b2014', format: 'uuid' })
  @IsUUID()
  targetId!: string;
}

export class IdentifyReceiptDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The order group the money belongs to',
    example: BANK_IDS.group,
  })
  @IsUUID()
  orderGroupId!: string;
}

export class UnidentifiedReceiptDto {
  @ApiProperty({ format: 'uuid', example: BANK_IDS.receipt })
  id!: string;

  @ApiProperty({ example: '5350.00' })
  amount!: string;

  @ApiProperty({ format: 'date', example: '2026-10-27' })
  receivedOn!: string;

  @ApiProperty({ example: 'TRF IN นาย ตัวอย่าง' })
  description!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  reference!: string | null;

  @ApiProperty({ enum: UNIDENTIFIED_STATUSES, enumName: 'UnidentifiedReceiptStatus', example: 'open' })
  status!: string;
}

export const RECEIPT_EXAMPLE: UnidentifiedReceiptDto = {
  id: BANK_IDS.receipt,
  amount: '5350.00',
  receivedOn: '2026-10-27',
  description: 'TRF IN นาย ตัวอย่าง',
  reference: null,
  status: 'open',
};

export class UnidentifiedQuery {
  @ApiPropertyOptional({ enum: UNIDENTIFIED_STATUSES, enumName: 'UnidentifiedReceiptStatus' })
  @IsOptional()
  @IsIn(UNIDENTIFIED_STATUSES)
  status?: (typeof UNIDENTIFIED_STATUSES)[number];
}

export class SettlementLineInputDto {
  @ApiProperty({ example: 'SCB-TXN-0001', description: 'The gateway reference of the payment' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  providerRef!: string;

  @ApiProperty({ example: '5350.00', pattern: MONEY.source })
  @Matches(MONEY)
  grossAmount!: string;

  @ApiProperty({ example: '85.60', pattern: MONEY.source })
  @Matches(MONEY)
  feeAmount!: string;
}

export class ImportSettlementDto {
  @ApiProperty({ enum: ['scb', 'twoc2p'], enumName: 'SettlementProvider', example: 'scb' })
  @IsIn(['scb', 'twoc2p'])
  provider!: 'scb' | 'twoc2p';

  @ApiProperty({ format: 'uuid', example: BANK_IDS.account })
  @IsUUID()
  companyBankAccountId!: string;

  @ApiProperty({ format: 'date', example: '2026-10-28' })
  @Matches(DAY)
  settlementDate!: string;

  @ApiProperty({
    example: '5.99',
    pattern: MONEY.source,
    description: 'VAT on the fees (claimable with the gateway’s tax invoice)',
  })
  @Matches(MONEY)
  vatOnFee!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'SCB-TI-2610-01' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  feeTaxInvoiceNo?: string | null;

  @ApiProperty({ type: [SettlementLineInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => SettlementLineInputDto)
  lines!: SettlementLineInputDto[];
}

export class SettlementDto {
  @ApiProperty({ format: 'uuid', example: BANK_IDS.settlement })
  id!: string;

  @ApiProperty({ enum: ['scb', 'twoc2p'], enumName: 'SettlementProvider', example: 'scb' })
  provider!: string;

  @ApiProperty({ format: 'date', example: '2026-10-28' })
  settlementDate!: string;

  @ApiProperty({ example: '5350.00' })
  grossAmount!: string;

  @ApiProperty({ example: '85.60' })
  feeAmount!: string;

  @ApiProperty({ example: '5.99' })
  vatOnFee!: string;

  @ApiProperty({ example: '5258.41' })
  netAmount!: string;

  @ApiProperty({
    enum: ['imported', 'posted'],
    enumName: 'SettlementStatus',
    example: 'imported',
    description: '`posted` once matched to the bank line (P04)',
  })
  status!: string;

  @ApiProperty({ type: 'integer', example: 1 })
  lineCount!: number;

  @ApiProperty({ type: 'integer', example: 0, description: 'Lines whose payment was not found' })
  unmatchedLines!: number;
  @ApiProperty({
    format: 'uuid',
    example: BANK_IDS.account,
    description: 'The account the net amount arrives in',
  })
  companyBankAccountId!: string;
}

export const SETTLEMENT_EXAMPLE: SettlementDto = {
  id: BANK_IDS.settlement,
  provider: 'scb',
  settlementDate: '2026-10-28',
  grossAmount: '5350.00',
  feeAmount: '85.60',
  vatOnFee: '5.99',
  netAmount: '5258.41',
  status: 'imported',
  companyBankAccountId: BANK_IDS.account,
  lineCount: 1,
  unmatchedLines: 0,
};

export class CashPositionQuery {
  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-31',
    description: 'Default: today (Asia/Bangkok)',
  })
  @IsOptional()
  @Matches(DAY)
  asOf?: string;
}

export class CashBankRowDto {
  @ApiProperty({ format: 'uuid', example: BANK_IDS.account })
  companyBankAccountId!: string;

  @ApiProperty({ example: '1234' })
  accountNoLast4!: string;

  @ApiProperty({ example: '1121' })
  glAccountCode!: string;

  @ApiProperty({ example: '94495.60' })
  glBalance!: string;

  @ApiProperty({ type: String, nullable: true, example: '94495.60' })
  statementBalance!: string | null;

  @ApiProperty({ type: 'integer', example: 0 })
  unmatchedLines!: number;
}

export class ClearingRowDto {
  @ApiProperty({ example: '1131' })
  accountCode!: string;

  @ApiProperty({ example: '0.00' })
  balance!: string;
}

export class CashPositionDto {
  @ApiProperty({ format: 'date', example: '2026-10-31' })
  asOf!: string;

  @ApiProperty({ type: [CashBankRowDto] })
  banks!: CashBankRowDto[];

  @ApiProperty({
    type: [ClearingRowDto],
    description: 'Gateway / slip clearing (1131–1133) and unidentified receipts (1140)',
  })
  clearing!: ClearingRowDto[];
}

export const CASH_EXAMPLE: CashPositionDto = {
  asOf: '2026-10-31',
  banks: [
    {
      companyBankAccountId: BANK_IDS.account,
      accountNoLast4: '1234',
      glAccountCode: '1121',
      glBalance: '94495.60',
      statementBalance: '94495.60',
      unmatchedLines: 0,
    },
  ],
  clearing: [{ accountCode: '1131', balance: '0.00' }],
};

// --- suggestions, split, settlement list (U-B0.3) -------------------------------------------------------------

export const SUGGESTION_REASONS = ['reference', 'amount', 'date_window'] as const;

export class BankLineSuggestionDto {
  @ApiProperty({ enum: MATCH_TARGETS, enumName: 'BankMatchTarget', example: 'payment' })
  targetType!: string;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000d0001' })
  targetId!: string;

  @ApiProperty({ example: 'PKAB23CD45EF67GH', description: 'Payment reference, run number or settlement' })
  label!: string;

  @ApiProperty({ example: '5350.00' })
  amount!: string;

  @ApiProperty({ format: 'date', example: '2026-10-28' })
  date!: string;

  @ApiProperty({
    enum: SUGGESTION_REASONS,
    enumName: 'BankSuggestionReason',
    isArray: true,
    example: ['reference', 'amount', 'date_window'],
  })
  reasons!: string[];
}

export class SplitPartDto {
  @ApiProperty({ enum: MATCH_TARGETS, enumName: 'BankMatchTarget', example: 'payment' })
  @IsIn(MATCH_TARGETS)
  targetType!: (typeof MATCH_TARGETS)[number];

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000d0001' })
  @IsUUID()
  targetId!: string;

  @ApiProperty({ example: '2675.00', description: 'Positive; the parts add up to the line' })
  @Matches(/^\d{1,12}(\.\d{1,2})?$/)
  amount!: string;
}

export class SplitLineDto {
  @ApiProperty({ type: [SplitPartDto], minItems: 2, maxItems: 20 })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SplitPartDto)
  parts!: SplitPartDto[];
}

export class SettlementListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['imported', 'posted'], enumName: 'SettlementStatus' })
  @IsOptional()
  @IsIn(['imported', 'posted'])
  status?: 'imported' | 'posted';

  @ApiPropertyOptional({ enum: ['scb', 'twoc2p'], enumName: 'SettlementProvider' })
  @IsOptional()
  @IsIn(['scb', 'twoc2p'])
  provider?: 'scb' | 'twoc2p';
}
