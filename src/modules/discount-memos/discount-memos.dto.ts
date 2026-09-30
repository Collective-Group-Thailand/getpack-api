import { PageQuery } from '@common/pagination/pagination.dto';
import { IdField, TimestampField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { AttachedFileDto } from '@platform/files/files.dto';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Discount memos (D-052, D-124, D-162). */

export const MEMO_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'withdrawn',
  'expired',
  'applied',
] as const;
const PCT = /^\d{1,3}(\.\d{1,4})?$/;
const IDS = {
  memo: '0192f3a0-7c1e-7d2a-9b1f-0000000d1001',
  customer: '0192f3a0-7c1e-7d2a-9b1f-0000000d1002',
  company: '0192f3a0-7c1e-7d2a-9b1f-0000000d1003',
  approval: '0192f3a0-7c1e-7d2a-9b1f-0000000d1004',
  file: '0192f3a0-7c1e-7d2a-9b1f-0000000d1005',
  user: '0192f3a0-7c1e-7d2a-9b1f-0000000d1006',
};

export class RaiseOrderMemoDto {
  @ApiProperty({
    format: 'uuid',
    example: IDS.customer,
    description: 'The customer whose CS cart the memo prices',
  })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ example: '8', description: 'Requested %, above `discounts.cs_limit_pct`' })
  @IsString()
  @Matches(PCT)
  requestedPct!: string;

  @ApiProperty({ example: 'คู่แข่งเสนอราคาต่ำกว่า 8%' })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    example: [IDS.file],
    description: 'Evidence files you uploaded (competitor quote…)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  evidenceFileIds?: string[];
}

export class RaiseCompanyMemoDto {
  @ApiProperty({ example: '7', description: 'Company discount %, above `discounts.cs_limit_pct` (D-124)' })
  @IsString()
  @Matches(PCT)
  requestedPct!: string;

  @ApiProperty({ example: 'ลูกค้าองค์กร สั่งประจำทุกเดือน' })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;

  @ApiPropertyOptional({ type: [String], format: 'uuid', example: [IDS.file] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  evidenceFileIds?: string[];
}

export class DiscountMemoDto {
  @IdField(IDS.memo)
  id!: string;

  @ApiProperty({ enum: ['order', 'company'], enumName: 'DiscountMemoScope', example: 'order' })
  scope!: string;

  @ApiProperty({ enum: MEMO_STATUSES, enumName: 'MemoStatus', example: 'pending_approval' })
  status!: string;

  @ApiProperty({ type: UserRefDto })
  requestedBy!: UserRefDto;

  @ApiProperty({ type: UserRefDto, nullable: true })
  customer!: UserRefDto | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  companyId!: string | null;

  @ApiProperty({ example: '42800.00', description: 'Order value incl. VAT when raised' })
  orderValue!: string;

  @ApiProperty({ example: '8.0000' })
  requestedPct!: string;

  @ApiProperty({ example: '2800.00', description: 'Requested discount before VAT' })
  requestedAmount!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '14.2000',
    description: 'Resulting margin % — only with `margin.read` or `margin.read_pct_when_discounting` (D-141)',
  })
  resultingMarginPct!: string | null;

  @ApiProperty({ example: false, description: 'Below the margin floor → C-Level only (D-052)' })
  belowMarginFloor!: boolean;

  @ApiProperty({ example: 'คู่แข่งเสนอราคาต่ำกว่า 8%' })
  reason!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  approvedPct!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: IDS.approval })
  approvalId!: string | null;

  @ApiProperty({
    format: 'date-time',
    example: '2026-10-16T10:00:00+07:00',
    description: 'The quote validity (D-052)',
  })
  validUntil!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Order group the memo was used on',
  })
  appliedGroupCode!: string | null;

  @TimestampField()
  createdAt!: string;

  @ApiProperty({ type: [AttachedFileDto], description: 'The evidence files the memo was raised with (D-052)' })
  evidence!: AttachedFileDto[];
}

export const MEMO_EXAMPLE: DiscountMemoDto = {
  id: IDS.memo,
  scope: 'order',
  status: 'pending_approval',
  requestedBy: { id: IDS.user, displayName: 'Dev CS' },
  customer: { id: IDS.customer, displayName: 'สมหญิง ทดสอบ' },
  companyId: null,
  orderValue: '42800.00',
  requestedPct: '8.0000',
  requestedAmount: '2800.00',
  resultingMarginPct: '14.2000',
  belowMarginFloor: false,
  reason: 'คู่แข่งเสนอราคาต่ำกว่า 8%',
  approvedPct: null,
  approvalId: IDS.approval,
  validUntil: '2026-10-16T10:00:00+07:00',
  appliedGroupCode: null,
  createdAt: '2026-10-01T10:00:00+07:00',
  evidence: [
    { id: '0192f3a0-7c1e-7d2a-9b1f-00000000f001', originalName: 'quote-competitor.pdf', mimeType: 'application/pdf', sizeBytes: 245760 },
  ],
};

export class MemoListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: MEMO_STATUSES, enumName: 'MemoStatus' })
  @IsOptional()
  @IsIn(MEMO_STATUSES)
  status?: (typeof MEMO_STATUSES)[number];

  @ApiPropertyOptional({ format: 'uuid', example: IDS.customer })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Memos raised by this staff member' })
  @IsOptional()
  @IsUUID()
  requestedBy?: string;
}
