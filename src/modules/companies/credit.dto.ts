import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** B2B credit (D-121, D-122) and monthly statements (D-125). */

export class CreditRequestSummaryDto {
  @ApiProperty({ example: '150000.00' })
  limitAmount!: string;

  @ApiProperty({ type: 'integer', example: 30 })
  termDays!: number;

  @ApiProperty({ format: 'date-time', example: '2026-10-05T10:00:00+07:00' })
  requestedAt!: string;
}

export class CompanyCreditDto {
  @ApiProperty({ enum: ['prepaid', 'eligible', 'credit', 'blocked_overdue'], enumName: 'CreditStatus', example: 'credit' })
  creditStatus!: string;

  @ApiProperty({ type: String, nullable: true, example: '100000.00' })
  limitAmount!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 30, description: 'Payment term in days after delivery' })
  termDays!: number | null;

  @ApiProperty({ example: '25000.00', description: 'Open credit-term instalments' })
  exposureAmount!: string;

  @ApiProperty({ example: '75000.00', description: 'Limit − exposure (never below 0)' })
  availableAmount!: string;

  @ApiProperty({ type: CreditRequestSummaryDto, nullable: true, description: 'A limit waiting for approval' })
  pendingRequest!: CreditRequestSummaryDto | null;

  @ApiProperty({ example: 'THB' })
  currency!: string;
}

export const CREDIT_EXAMPLE: CompanyCreditDto = {
  creditStatus: 'credit',
  limitAmount: '100000.00',
  termDays: 30,
  exposureAmount: '25000.00',
  availableAmount: '75000.00',
  pendingRequest: null,
  currency: 'THB',
};

export class RequestCreditLimitDto {
  @ApiProperty({ example: '100000.00', description: 'THB; above 100,000 goes to C-Level (D-121)' })
  @IsString()
  @Matches(/^\d{1,12}(\.\d{1,2})?$/)
  limitAmount!: string;

  @ApiPropertyOptional({ type: 'integer', example: 30, description: 'One of `b2b.credit_terms.allowedDays`; default `defaultDays`' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  termDays?: number;

  @ApiProperty({ enum: ['paid_orders', 'financial_statement'], enumName: 'CreditEligibilityBasis', example: 'paid_orders' })
  @IsIn(['paid_orders', 'financial_statement'])
  basis!: 'paid_orders' | 'financial_statement';

  @ApiProperty({ example: 'สั่งซื้อสม่ำเสมอ ชำระตรงเวลา 3 ครั้ง' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class StatementQuery {
  @ApiProperty({ example: '2026-10', pattern: '^\\d{4}-(0[1-9]|1[0-2])$', description: 'Month in Bangkok time' })
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
