import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { UserRefDto } from './approvals.dto';

/** Approval-policy versions (D-063; B6.3 launch gap, U-B0.3). */

export const SCOPE_RULES = ['platform', 'subject_factory', 'subject_company', 'subject_entity'] as const;
export const CALENDAR_BASES = ['business', 'calendar'] as const;
export const VERSION_STATUSES = [
  'draft',
  'proposed',
  'pending_acceptance',
  'approved',
  'rejected',
  'withdrawn',
] as const;

const CONDITION_DOC =
  '`{ all: [...] } | { any: [...] } | { field, op, value } | { field, op, ref }` over amount, pct, flags, entity or ' +
  'payload.<path>; null = always (ADR-0006)';

export class PolicyStepInputDto {
  @ApiProperty({ example: 'Finance (≤ THB 100,000)', minLength: 2, maxLength: 200 })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 'finance', description: 'Role key that approves the step' })
  @Matches(/^[a-z][a-z_]{1,63}$/)
  approverRole!: string;

  @ApiPropertyOptional({ enum: SCOPE_RULES, enumName: 'ApprovalScopeRule', default: 'platform' })
  @IsOptional()
  @IsIn(SCOPE_RULES)
  approverScope?: (typeof SCOPE_RULES)[number];

  @ApiPropertyOptional({
    type: 'object',
    nullable: true,
    additionalProperties: true,
    example: { field: 'amount', op: 'lte', value: '100000.00' },
    description: CONDITION_DOC,
  })
  @IsOptional()
  condition?: unknown;

  @ApiPropertyOptional({ example: 1, type: 'integer', minimum: 1, maximum: 5, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  quorum?: number;

  @ApiPropertyOptional({ type: 'integer', nullable: true, minimum: 1, example: 480, description: 'Step SLA' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  slaMinutes?: number | null;

  @ApiPropertyOptional({ enum: CALENDAR_BASES, enumName: 'CalendarBasis', default: 'business' })
  @IsOptional()
  @IsIn(CALENDAR_BASES)
  slaCalendar?: (typeof CALENDAR_BASES)[number];

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: null,
    description: 'Role the overdue step escalates to',
  })
  @IsOptional()
  @Matches(/^[a-z][a-z_]{1,63}$/)
  escalateToRole?: string | null;
}

export class ProposePolicyVersionDto {
  @ApiProperty({ format: 'date-time', example: '2026-11-01T00:00:00+07:00', description: 'Now or later' })
  @IsISO8601()
  effectiveFrom!: string;

  @ApiProperty({
    example: 'Raise the Finance limit to THB 150,000 (board 2026-10)',
    minLength: 3,
    maxLength: 500,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '500000.00',
    description:
      'D-449 B: requests at or below this amount (THB, 2 decimals) are approved at creation without the second ' +
      'approval; only on a policy whose steps have an amount condition; Superadmin only; omit to keep the value in ' +
      'force, null to remove it',
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Matches(/^\d{1,12}\.\d{2}$/)
  autoApproveMaxAmount?: string | null;

  @ApiProperty({ type: [PolicyStepInputDto], minItems: 1, maxItems: 10 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PolicyStepInputDto)
  steps!: PolicyStepInputDto[];
}

export class PolicyStepDto {
  @ApiProperty({ type: 'integer', example: 1 })
  stepNo!: number;

  @ApiProperty({ example: 'Finance (≤ THB 100,000)' })
  name!: string;

  @ApiProperty({ example: 'finance' })
  approverRole!: string;

  @ApiProperty({ enum: SCOPE_RULES, enumName: 'ApprovalScopeRule', example: 'platform' })
  approverScope!: string;

  @ApiProperty({
    type: 'object',
    nullable: true,
    additionalProperties: true,
    example: { field: 'amount', op: 'lte', value: '100000.00' },
    description: CONDITION_DOC,
  })
  condition!: unknown;

  @ApiProperty({ type: 'integer', example: 1 })
  quorum!: number;

  @ApiProperty({ type: 'integer', nullable: true, example: null })
  slaMinutes!: number | null;

  @ApiProperty({ enum: CALENDAR_BASES, enumName: 'CalendarBasis', example: 'business' })
  slaCalendar!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  escalateToRole!: string | null;
}

export class PolicyVersionDto {
  @ApiProperty({ type: 'integer', example: 2 })
  versionNo!: number;

  @ApiProperty({ enum: VERSION_STATUSES, enumName: 'ConfigVersionStatus', example: 'proposed' })
  status!: string;

  @ApiProperty({ format: 'date-time', example: '2026-11-01T00:00:00+07:00' })
  effectiveFrom!: string;

  @ApiProperty({ example: 'Raise the Finance limit to THB 150,000 (board 2026-10)' })
  reason!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '500000.00',
    description:
      'D-449 B: requests at or below this amount (THB) are approved at creation ("below threshold"); null = none',
  })
  autoApproveMaxAmount!: string | null;

  @ApiProperty({ type: [PolicyStepDto] })
  steps!: PolicyStepDto[];

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: '0192f3a0-7c1e-7d2a-9b1f-00000000e0a1',
  })
  approvalId!: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  createdBy!: UserRefDto | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-05T10:00:00+07:00' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  decidedAt!: string | null;
}

export class ApprovalPolicyDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000e0a0' })
  id!: string;

  @ApiProperty({ example: 'credit_limit' })
  key!: string;

  @ApiProperty({ example: 'company_credit_limit' })
  subjectType!: string;

  @ApiProperty({ example: 'B2B credit limits: up to THB 100,000 by Finance, above by C-Level (D-121)' })
  description!: string;

  @ApiProperty({ type: [String], example: ['D-121'] })
  decisions!: string[];

  @ApiProperty({ type: PolicyVersionDto, nullable: true, description: 'The version in force now' })
  current!: PolicyVersionDto | null;

  @ApiProperty({ type: PolicyVersionDto, nullable: true, description: 'Approved, from a later date' })
  upcoming!: PolicyVersionDto | null;

  @ApiProperty({ type: PolicyVersionDto, nullable: true, description: 'Waiting for the Superadmin' })
  pending!: PolicyVersionDto | null;
}

const STEP_EXAMPLE: PolicyStepDto = {
  stepNo: 1,
  name: 'Finance (≤ THB 100,000)',
  approverRole: 'finance',
  approverScope: 'platform',
  condition: { field: 'amount', op: 'lte', value: '100000.00' },
  quorum: 1,
  slaMinutes: null,
  slaCalendar: 'business',
  escalateToRole: null,
};

export const POLICY_VERSION_EXAMPLE: PolicyVersionDto = {
  versionNo: 2,
  status: 'proposed',
  effectiveFrom: '2026-11-01T00:00:00+07:00',
  reason: 'Raise the Finance limit to THB 150,000 (board 2026-10)',
  autoApproveMaxAmount: '500000.00',
  steps: [STEP_EXAMPLE],
  approvalId: '0192f3a0-7c1e-7d2a-9b1f-00000000e0a1',
  createdBy: { id: '0192f3a0-7c1e-7d2a-9b1f-000000000a01', displayName: 'Dev Superadmin' },
  createdAt: '2026-10-05T10:00:00+07:00',
  decidedAt: null,
};

export const APPROVAL_POLICY_EXAMPLE: ApprovalPolicyDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-00000000e0a0',
  key: 'credit_limit',
  subjectType: 'company_credit_limit',
  description: 'B2B credit limits: up to THB 100,000 by Finance, above by C-Level (D-121)',
  decisions: ['D-121'],
  current: {
    ...POLICY_VERSION_EXAMPLE,
    versionNo: 1,
    status: 'approved',
    approvalId: null,
    decidedAt: '2026-09-23T10:00:00+07:00',
  },
  upcoming: null,
  pending: POLICY_VERSION_EXAMPLE,
};
