import { AgingBucketsDto } from '@modules/receivables/receivables.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { CONFIG_VERSION_STATUSES } from '@platform/settings/settings.dto';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** B2B credit (D-121, D-122) and monthly statements (D-125). */

export class CreditRequestSummaryDto {
  @ApiProperty({ example: '150000.00' })
  limitAmount!: string;

  @ApiProperty({ type: 'integer', example: 30 })
  termDays!: number;

  @ApiProperty({ format: 'date-time', example: '2026-10-05T10:00:00+07:00' })
  requestedAt!: string;
}

export class CreditEligibilityDto {
  @ApiProperty({ type: 'integer', example: 2, description: 'Paid order groups so far (D-121)' })
  paidOrdersCount!: number;

  @ApiProperty({ type: 'integer', example: 3, description: '`b2b.credit_eligibility_paid_orders`' })
  paidOrdersNeeded!: number;

  @ApiProperty({ example: false, description: 'Enough paid orders, or a verified financial statement' })
  eligible!: boolean;

  @ApiProperty({ example: false, description: 'A financial statement is on file (reviewed or waiting)' })
  financialStatementOnFile!: boolean;

  @ApiProperty({ type: [Number], example: [15, 30, 45, 60], description: '`b2b.credit_terms.allowedDays`' })
  allowedTermDays!: number[];

  @ApiProperty({ type: 'integer', example: 30 })
  defaultTermDays!: number;

  @ApiProperty({
    enum: ['paid_orders', 'financial_statement'],
    enumName: 'CreditEligibilityBasis',
    nullable: true,
    example: 'paid_orders',
    description: 'Why the company is eligible; null while it is not',
  })
  reason!: 'paid_orders' | 'financial_statement' | null;
}

export class CompanyCreditDto {
  @ApiProperty({
    enum: ['prepaid', 'eligible', 'credit', 'blocked_overdue'],
    enumName: 'CreditStatus',
    example: 'credit',
  })
  creditStatus!: string;

  @ApiProperty({ type: String, nullable: true, example: '100000.00' })
  limitAmount!: string | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 30,
    description: 'Payment term in days after delivery',
  })
  termDays!: number | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'D-462: the limit in force is temporary and ends at this time; null when permanent',
  })
  validUntil!: string | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 30,
    description: 'D-462: the permanent term after a temporary limit ends; null without one',
  })
  fallbackTermDays!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'D-462: the permanent limit after a temporary one ends; null without one',
  })
  fallbackLimitAmount!: string | null;

  @ApiProperty({ example: '25000.00', description: 'Open credit-term instalments' })
  exposureAmount!: string;

  @ApiProperty({ example: '75000.00', description: 'Limit − exposure (never below 0)' })
  availableAmount!: string;

  @ApiProperty({ type: CreditRequestSummaryDto, nullable: true, description: 'A limit waiting for approval' })
  pendingRequest!: CreditRequestSummaryDto | null;

  @ApiProperty({
    type: CreditEligibilityDto,
    description: 'Whether the company may apply for credit (D-121)',
  })
  eligibility!: CreditEligibilityDto;

  @ApiProperty({ example: 'THB' })
  currency!: string;
}

export const CREDIT_EXAMPLE: CompanyCreditDto = {
  creditStatus: 'credit',
  limitAmount: '100000.00',
  termDays: 30,
  validUntil: null,
  fallbackTermDays: null,
  fallbackLimitAmount: null,
  exposureAmount: '25000.00',
  availableAmount: '75000.00',
  pendingRequest: null,
  eligibility: {
    paidOrdersCount: 5,
    paidOrdersNeeded: 3,
    eligible: true,
    financialStatementOnFile: false,
    allowedTermDays: [15, 30, 45, 60],
    defaultTermDays: 30,
    reason: 'paid_orders',
  },
  currency: 'THB',
};

/** The pending request as staff see it: with its version and approval (D-121). */
export class AdminCreditRequestSummaryDto extends CreditRequestSummaryDto {
  @ApiProperty({ type: 'integer', example: 2 })
  versionNo!: number;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000c1030',
  })
  approvalId!: string | null;
}

/** One version of the company's credit limit (D-121): requested, approved, rejected or withdrawn. */
export class CreditLimitVersionDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000c1031' })
  id!: string;

  @ApiProperty({ type: 'integer', example: 1 })
  versionNo!: number;

  @ApiProperty({ enum: CONFIG_VERSION_STATUSES, enumName: 'ConfigVersionStatus', example: 'approved' })
  status!: string;

  @ApiProperty({ example: '100000.00' })
  limitAmount!: string;

  @ApiProperty({ type: 'integer', example: 30 })
  termDays!: number;

  @ApiProperty({ example: false, description: 'D-462: a term outside `b2b.credit_terms.allowedDays`' })
  customTerm!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'D-462: a temporary limit ends at this time; null when permanent',
  })
  validUntil!: string | null;

  @ApiProperty({
    enum: ['paid_orders', 'financial_statement'],
    enumName: 'CreditEligibilityBasis',
    example: 'paid_orders',
  })
  basis!: string;

  @ApiProperty({ example: 'ชำระตรงเวลา 3 ครั้ง' })
  reason!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-05T10:00:00+07:00' })
  effectiveFrom!: string;

  @ApiProperty({ type: UserRefDto, nullable: true })
  requestedBy!: UserRefDto | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-05T10:00:00+07:00' })
  requestedAt!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000c1030',
  })
  approvalId!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-06T10:00:00+07:00' })
  decidedAt!: string | null;
}

export class AdminCompanyCreditDto extends CompanyCreditDto {
  @ApiProperty({
    type: AdminCreditRequestSummaryDto,
    nullable: true,
    description: 'A limit waiting for approval',
  })
  declare pendingRequest: AdminCreditRequestSummaryDto | null;

  @ApiProperty({ type: [CreditLimitVersionDto], description: 'Every limit version, newest first' })
  versions!: CreditLimitVersionDto[];
}

export const ADMIN_CREDIT_EXAMPLE: AdminCompanyCreditDto = {
  ...CREDIT_EXAMPLE,
  pendingRequest: null,
  versions: [
    {
      id: '0192f3a0-7c1e-7d2a-9b1f-0000000c1031',
      versionNo: 1,
      status: 'approved',
      limitAmount: '100000.00',
      termDays: 30,
      customTerm: false,
      validUntil: null,
      basis: 'paid_orders',
      reason: 'ชำระตรงเวลา 3 ครั้ง',
      effectiveFrom: '2026-10-05T10:00:00+07:00',
      requestedBy: { id: '0192f3a0-7c1e-7d2a-9b1f-0000000c1012', displayName: 'Dev CS' },
      requestedAt: '2026-10-05T10:00:00+07:00',
      approvalId: '0192f3a0-7c1e-7d2a-9b1f-0000000c1030',
      decidedAt: '2026-10-06T10:00:00+07:00',
    },
  ],
};

/** The Company Admin applies for credit (D-121); Finance / C-Level decide through `credit_limit`. */
export class ApplyForCreditDto {
  @ApiProperty({ example: '100000.00', description: 'THB; above 100,000 goes to C-Level (D-121)' })
  @IsString()
  @Matches(/^\d{1,12}(\.\d{1,2})?$/)
  limitAmount!: string;

  @ApiPropertyOptional({
    type: 'integer',
    example: 30,
    description: 'One of `eligibility.allowedTermDays`; default `defaultTermDays`',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  termDays?: number;

  @ApiProperty({
    enum: ['paid_orders', 'financial_statement'],
    enumName: 'CreditEligibilityBasis',
    example: 'paid_orders',
    description:
      '`paid_orders` once eligible; `financial_statement` with a statement added as a KYC document (Finance reviews it)',
  })
  @IsIn(['paid_orders', 'financial_statement'])
  basis!: 'paid_orders' | 'financial_statement';

  @ApiProperty({ example: 'สั่งซื้อทุกเดือน ขอเครดิต 30 วัน', minLength: 3, maxLength: 500 })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  note!: string;
}

export const CREDIT_NOTICE_CODES = ['due_soon', 'due_today', 'overdue', 'credit_blocked'] as const;

export class CreditNoticeDto {
  @ApiProperty({
    enum: CREDIT_NOTICE_CODES,
    enumName: 'CompanyCreditNoticeCode',
    example: 'due_soon',
    description: 'D-122: due within the reminder window, due today, overdue, credit orders blocked',
  })
  code!: string;

  @ApiProperty({ type: String, nullable: true, example: 'OG-2610-00001' })
  groupCode!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-11-15T10:00:00+07:00' })
  dueAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '42800.00' })
  amount!: string | null;
}

/** What the company owes (D-122): aging of its receivables, what is due next and the D-122 notices. */
export class CompanyReceivablesDto {
  @ApiProperty({ format: 'date', example: '2026-11-08' })
  asOf!: string;

  @ApiProperty({
    example: '25000.00',
    description: 'Open receivables and open credit instalments (the exposure)',
  })
  openAmount!: string;

  @ApiProperty({ example: '0.00', description: 'Open receivables past their due date' })
  overdueAmount!: string;

  @ApiProperty({ type: AgingBucketsDto, description: 'Open receivables by days past due' })
  aging!: AgingBucketsDto;

  @ApiProperty({ type: 'integer', nullable: true, example: null })
  oldestOverdueDays!: number | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-11-15T10:00:00+07:00' })
  nextDueAt!: string | null;

  @ApiProperty({ example: false, description: 'New credit orders blocked for overdue payments (D-122)' })
  creditOrdersBlocked!: boolean;

  @ApiProperty({ type: [CreditNoticeDto] })
  notices!: CreditNoticeDto[];

  @ApiProperty({ example: 'THB' })
  currency!: string;
}

export const RECEIVABLES_EXAMPLE: CompanyReceivablesDto = {
  asOf: '2026-11-08',
  openAmount: '25000.00',
  overdueAmount: '0.00',
  aging: { current: '12000.00', d1_30: '0.00', d31_60: '0.00', d61_90: '0.00', over_90: '0.00' },
  oldestOverdueDays: null,
  nextDueAt: '2026-11-15T10:00:00+07:00',
  creditOrdersBlocked: false,
  notices: [
    { code: 'due_soon', groupCode: 'OG-2610-00001', dueAt: '2026-11-15T10:00:00+07:00', amount: '12000.00' },
  ],
  currency: 'THB',
};

export class RequestCreditLimitDto {
  @ApiProperty({ example: '100000.00', description: 'THB; above 100,000 goes to C-Level (D-121)' })
  @IsString()
  @Matches(/^\d{1,12}(\.\d{1,2})?$/)
  limitAmount!: string;

  @ApiPropertyOptional({
    type: 'integer',
    example: 30,
    description:
      'One of `b2b.credit_terms.allowedDays` (default `defaultDays`), or a custom term within ' +
      '`b2b.credit_custom_terms.minDays`–`maxDays` (D-462)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  termDays?: number;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    example: '2026-12-31T23:59:59+07:00',
    description:
      'D-462: a temporary limit ending at this time (more than a day and at most ' +
      '`b2b.credit_custom_terms.temporaryMaxDays` ahead); omit for a permanent limit',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  validUntil?: string;

  @ApiProperty({
    enum: ['paid_orders', 'financial_statement'],
    enumName: 'CreditEligibilityBasis',
    example: 'paid_orders',
  })
  @IsIn(['paid_orders', 'financial_statement'])
  basis!: 'paid_orders' | 'financial_statement';

  @ApiProperty({ example: 'สั่งซื้อสม่ำเสมอ ชำระตรงเวลา 3 ครั้ง' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class StatementQuery {
  @ApiProperty({
    example: '2026-10',
    pattern: '^\\d{4}-(0[1-9]|1[0-2])$',
    description: 'Month in Bangkok time',
  })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month!: string;
}

export class StatementLineDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000c1011' })
  groupId!: string;

  @ApiProperty({ example: 'OG-2610-00001' })
  groupCode!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T10:00:00+07:00' })
  placedAt!: string;

  @ApiProperty({ type: String, nullable: true, example: '00000' })
  branchCode!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'PO-0001' })
  poNumber!: string | null;

  @ApiProperty({ example: '42800.00' })
  grossAmount!: string;

  @ApiProperty({ example: '0.00' })
  paidAmount!: string;

  @ApiProperty({ example: '42800.00' })
  openAmount!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-11-15T10:00:00+07:00' })
  dueAt!: string | null;
}

export class StatementDto {
  @ApiProperty({ example: '2026-10' })
  month!: string;

  @ApiProperty({ type: [StatementLineDto] })
  lines!: StatementLineDto[];

  @ApiProperty({ example: '42800.00' })
  totalGrossAmount!: string;

  @ApiProperty({ example: '0.00' })
  totalPaidAmount!: string;

  @ApiProperty({ example: '42800.00', description: 'Everything still open at the end of the month' })
  openBalance!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;
}

export const STATEMENT_EXAMPLE: StatementDto = {
  month: '2026-10',
  lines: [
    {
      groupId: '0192f3a0-7c1e-7d2a-9b1f-0000000c1011',
      groupCode: 'OG-2610-00001',
      placedAt: '2026-10-03T10:00:00+07:00',
      branchCode: '00000',
      poNumber: 'PO-0001',
      grossAmount: '42800.00',
      paidAmount: '0.00',
      openAmount: '42800.00',
      dueAt: '2026-11-15T10:00:00+07:00',
    },
  ],
  totalGrossAmount: '42800.00',
  totalPaidAmount: '0.00',
  openBalance: '42800.00',
  currency: 'THB',
};

export class IssuedStatementDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000c1020' })
  id!: string;

  @ApiProperty({ example: '2026-10' })
  month!: string;

  @ApiProperty({ example: '0.00' })
  openingAmount!: string;

  @ApiProperty({ example: '42800.00' })
  invoicedAmount!: string;

  @ApiProperty({ example: '0.00' })
  paidAmount!: string;

  @ApiProperty({ example: '0.00' })
  creditedAmount!: string;

  @ApiProperty({ example: '42800.00' })
  closingAmount!: string;

  @ApiProperty({ example: true, description: 'The PDF can be downloaded' })
  pdfReady!: boolean;

  @ApiProperty({ format: 'date-time', example: '2026-11-01T02:00:00+07:00' })
  generatedAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-11-01T02:05:00+07:00' })
  sentAt!: string | null;

  @ApiProperty({ example: 'THB' })
  currency!: string;
}

export const ISSUED_STATEMENT_EXAMPLE: IssuedStatementDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-0000000c1020',
  month: '2026-10',
  openingAmount: '0.00',
  invoicedAmount: '42800.00',
  paidAmount: '0.00',
  creditedAmount: '0.00',
  closingAmount: '42800.00',
  pdfReady: true,
  generatedAt: '2026-11-01T02:00:00+07:00',
  sentAt: '2026-11-01T02:05:00+07:00',
  currency: 'THB',
};

/** D-462: what every company member who may order sees of the company's credit — no limit, exposure or statements. */
export class CompanyCreditSummaryDto {
  @ApiProperty({
    enum: ['prepaid', 'eligible', 'credit', 'blocked_overdue'],
    enumName: 'CreditStatus',
    example: 'credit',
  })
  creditStatus!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '75000.00',
    description: 'Available credit now; null while the company has no credit in force',
  })
  availableAmount!: string | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 30,
    description: 'Payment term in days after delivery',
  })
  termDays!: number | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'The limit in force is temporary and ends at this time',
  })
  validUntil!: string | null;

  @ApiProperty({ example: 'THB' })
  currency!: string;
}

export const CREDIT_SUMMARY_EXAMPLE: CompanyCreditSummaryDto = {
  creditStatus: 'credit',
  availableAmount: '75000.00',
  termDays: 30,
  validUntil: null,
  currency: 'THB',
};
