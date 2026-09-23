import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn', 'expired'] as const;
export const APPROVAL_STEP_STATUSES = ['pending', 'approved', 'rejected', 'skipped', 'expired'] as const;
export const APPROVAL_ACTION_KINDS = [
  'approve',
  'reject',
  'withdraw',
  'delegate',
  'comment',
  'escalate',
] as const;

const REQUEST_ID = '0192f3a0-7c1e-7d2a-9b1f-00000000a0a0';
const USER = { id: '0192f3a0-7c1e-7d2a-9b1f-3c4d5e6f7a8b', displayName: 'การเงิน ทดสอบ' };

export class UserRefDto {
  @ApiProperty({ format: 'uuid', example: USER.id })
  id!: string;

  @ApiProperty({ example: USER.displayName })
  displayName!: string;
}

export class ApprovalStepDto {
  @ApiProperty({ type: 'integer', example: 1 })
  stepNo!: number;

  @ApiProperty({ example: 'finance', description: 'Role that approves this step' })
  role!: string;

  @ApiProperty({ type: 'integer', example: 1, description: 'Approvals needed' })
  quorum!: number;

  @ApiProperty({ enum: APPROVAL_STEP_STATUSES, enumName: 'ApprovalStepStatus', example: 'pending' })
  status!: (typeof APPROVAL_STEP_STATUSES)[number];

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-09-24T14:05:00+07:00',
    description: 'SLA deadline',
  })
  dueAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  completedAt!: string | null;
}

export class ApprovalActionDto {
  @ApiProperty({ enum: APPROVAL_ACTION_KINDS, enumName: 'ApprovalActionKind', example: 'approve' })
  action!: (typeof APPROVAL_ACTION_KINDS)[number];

  @ApiProperty({ type: 'integer', nullable: true, example: 1 })
  stepNo!: number | null;

  @ApiProperty({ type: UserRefDto })
  actor!: UserRefDto;

  @ApiProperty({
    type: UserRefDto,
    nullable: true,
    description: 'Delegator when acting through a delegation',
  })
  onBehalfOf!: UserRefDto | null;

  @ApiProperty({ type: String, nullable: true, example: 'Verified by phone with the factory' })
  comment!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-09-23T15:00:00+07:00' })
  at!: string;
}

export class ApprovalRequestDto {
  @ApiProperty({ format: 'uuid', example: REQUEST_ID })
  id!: string;

  @ApiProperty({ example: 'vendor_bank_account_change', description: 'Approval policy key' })
  policy!: string;

  @ApiProperty({ example: 'vendor_bank_account' })
  subjectType!: string;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000b0b0' })
  subjectId!: string;

  @ApiProperty({ enum: APPROVAL_STATUSES, enumName: 'ApprovalStatus', example: 'pending' })
  status!: (typeof APPROVAL_STATUSES)[number];

  @ApiProperty({ type: UserRefDto })
  requester!: UserRefDto;

  @ApiProperty({ type: String, nullable: true, example: '120000.00', description: 'Money (THB, 2 decimals)' })
  amount!: string | null;

  @ApiProperty({
    enum: ['THB'],
    enumName: 'Currency',
    example: 'THB',
    description: 'Always THB (one currency)',
  })
  currency!: 'THB';

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Percent, e.g. "12.5000" = 12.5 %',
  })
  pct!: string | null;

  @ApiProperty({ type: [String], example: [] })
  flags!: string[];

  @ApiProperty({ type: 'integer', nullable: true, example: 1 })
  currentStepNo!: number | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  expiresAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  decidedAt!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-09-23T14:05:00+07:00' })
  createdAt!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { vendor: 'โรงงาน ทดสอบ', bankLast4: '1234' },
    description: 'What the approvers decide on, frozen at request time',
  })
  payload!: Record<string, unknown>;

  @ApiProperty({ type: [ApprovalStepDto] })
  steps!: ApprovalStepDto[];

  @ApiProperty({ type: [ApprovalActionDto] })
  actions!: ApprovalActionDto[];
}

export const APPROVAL_EXAMPLE: ApprovalRequestDto = {
  id: REQUEST_ID,
  policy: 'vendor_bank_account_change',
  subjectType: 'vendor_bank_account',
  subjectId: '0192f3a0-7c1e-7d2a-9b1f-00000000b0b0',
  status: 'pending',
  requester: { id: '0192f3a0-7c1e-7d2a-9b1f-00000000c0c0', displayName: 'ผู้ขอ ทดสอบ' },
  amount: null,
  currency: 'THB',
  pct: null,
  flags: [],
  currentStepNo: 2,
  expiresAt: null,
  decidedAt: null,
  createdAt: '2026-09-23T14:05:00+07:00',
  payload: { vendor: 'โรงงาน ทดสอบ', bankLast4: '1234' },
  steps: [
    {
      stepNo: 1,
      role: 'finance',
      quorum: 1,
      status: 'approved',
      dueAt: null,
      completedAt: '2026-09-23T15:00:00+07:00',
    },
    { stepNo: 2, role: 'finance_manager', quorum: 1, status: 'pending', dueAt: null, completedAt: null },
  ],
  actions: [
    {
      action: 'approve',
      stepNo: 1,
      actor: USER,
      onBehalfOf: null,
      comment: 'Verified by phone with the factory',
      at: '2026-09-23T15:00:00+07:00',
    },
  ],
};

export class ApprovalListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: APPROVAL_STATUSES, enumName: 'ApprovalStatus' })
  @IsOptional()
  @IsIn(APPROVAL_STATUSES)
  status?: (typeof APPROVAL_STATUSES)[number];

  @ApiPropertyOptional({ example: 'discount_memo' })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_]*$/)
  policy?: string;

  @ApiPropertyOptional({ example: 'discount_memo' })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_]*$/)
  subjectType?: string;
}

export class ApproveDto {
  @ApiPropertyOptional({ example: 'Verified by phone with the factory', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class RejectDto {
  @ApiProperty({ example: 'Bank letter does not match the vendor name', minLength: 3, maxLength: 1000 })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  comment!: string;
}

export class WithdrawDto {
  @ApiProperty({ example: 'Raised by mistake', minLength: 3, maxLength: 1000 })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}

export class DelegationDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000d001' })
  id!: string;

  @ApiProperty({ type: UserRefDto })
  delegator!: UserRefDto;

  @ApiProperty({ type: UserRefDto })
  delegate!: UserRefDto;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Limited to one policy, or null = all',
  })
  policy!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T00:00:00+07:00' })
  validFrom!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-08T00:00:00+07:00' })
  validTo!: string;

  @ApiProperty({ example: 'Annual leave' })
  reason!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  revokedAt!: string | null;
}

export const DELEGATION_EXAMPLE: DelegationDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-00000000d001',
  delegator: USER,
  delegate: { id: '0192f3a0-7c1e-7d2a-9b1f-00000000c0c1', displayName: 'ผู้แทน ทดสอบ' },
  policy: null,
  validFrom: '2026-10-01T00:00:00+07:00',
  validTo: '2026-10-08T00:00:00+07:00',
  reason: 'Annual leave',
  revokedAt: null,
};

export class CreateDelegationDto {
  @ApiProperty({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-00000000c0c1',
    description: 'Staff user who approves for you',
  })
  @IsUUID()
  delegateId!: string;

  @ApiPropertyOptional({ example: 'discount_memo', description: 'Only this policy; omit for all' })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_]*$/)
  policy?: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T00:00:00+07:00' })
  @Type(() => Date)
  @IsDate()
  validFrom!: Date;

  @ApiProperty({ format: 'date-time', example: '2026-10-08T00:00:00+07:00' })
  @Type(() => Date)
  @IsDate()
  validTo!: Date;

  @ApiProperty({ example: 'Annual leave', minLength: 3, maxLength: 500 })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
