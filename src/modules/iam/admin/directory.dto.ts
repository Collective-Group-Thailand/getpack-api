import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

/** Staff directory and segregation-of-duties rules (D-140, D-168; U-B0.3). */

export class StaffDirectoryQuery {
  @ApiPropertyOptional({
    example: 'สมชาย',
    minLength: 2,
    maxLength: 100,
    description: 'Part of the display name',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ example: 'cs_lead', description: 'Holders of this staff role' })
  @IsOptional()
  @Matches(/^[a-z][a-z_]{1,63}$/)
  role?: string;

  @ApiPropertyOptional({
    example: 'rfqs.manage',
    description: 'Holders of this permission through their roles (e.g. who an RFQ can be assigned to)',
  })
  @IsOptional()
  @Matches(/^[a-z][a-z_]*\.[a-z][a-z_]*$/)
  permission?: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 50, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

/** A staff member as any colleague may see them: no e-mail or phone (PDPA least privilege). */
export class StaffDirectoryEntryDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-000000000a01' })
  id!: string;

  @ApiProperty({ example: 'Dev CS Lead' })
  displayName!: string;

  @ApiProperty({ type: [String], example: ['cs_lead'], description: 'Active platform role keys' })
  roles!: string[];
}

export const SOD_KINDS = ['role_pair', 'action_pair'] as const;
export const SOD_ENFORCEMENTS = ['block', 'warn'] as const;
export const SOD_SUBJECT_MATCHES = ['same_subject', 'same_vendor', 'same_customer'] as const;

export class SodRuleDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-000000000a02' })
  id!: string;

  @ApiProperty({ example: 'payout_run_create_approve' })
  key!: string;

  @ApiProperty({ enum: SOD_KINDS, enumName: 'SodRuleKind', example: 'action_pair' })
  kind!: string;

  @ApiProperty({
    example: 'payout_runs.propose',
    description: 'Role key (role_pair) or permission key (action_pair)',
  })
  left!: string;

  @ApiProperty({ example: 'payout_runs.approve' })
  right!: string;

  @ApiProperty({
    enum: SOD_SUBJECT_MATCHES,
    enumName: 'SodSubjectMatch',
    nullable: true,
    example: 'same_subject',
    description: 'For action pairs: the two actions conflict only on the same subject, vendor or customer',
  })
  subjectMatch!: string | null;

  @ApiProperty({ enum: SOD_ENFORCEMENTS, enumName: 'SodEnforcement', example: 'block' })
  enforcement!: string;

  @ApiProperty({ example: 'Who proposes a payout run does not approve it' })
  description!: string;

  @ApiProperty({ type: [String], example: ['D-168'] })
  decisions!: string[];
}

export const STAFF_DIRECTORY_EXAMPLE: StaffDirectoryEntryDto[] = [
  { id: '0192f3a0-7c1e-7d2a-9b1f-000000000a01', displayName: 'Dev CS Lead', roles: ['cs_lead'] },
];

export const SOD_RULE_EXAMPLE: SodRuleDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-000000000a02',
  key: 'payout_run_create_approve',
  kind: 'action_pair',
  left: 'payout_runs.propose',
  right: 'payout_runs.approve',
  subjectMatch: 'same_subject',
  enforcement: 'block',
  description: 'Who proposes a payout run does not approve it',
  decisions: ['D-168'],
};
