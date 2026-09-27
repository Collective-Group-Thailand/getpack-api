import { PageQuery } from '@common/pagination/pagination.dto';
import { IdField, TimestampField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** Referral programme (D-136). */

export const REFERRAL_STATUSES = ['pending', 'under_review', 'qualified', 'rewarded', 'rejected_fraud'] as const;

const IDS = {
  referral: '0192f3a0-7c1e-7d2a-9b1f-0000000a0001',
  referrer: '0192f3a0-7c1e-7d2a-9b1f-0000000a0002',
  referee: '0192f3a0-7c1e-7d2a-9b1f-0000000a0003',
  group: '0192f3a0-7c1e-7d2a-9b1f-0000000a0004',
  approval: '0192f3a0-7c1e-7d2a-9b1f-0000000a0005',
};

export class ReferralCountsDto {
  @ApiProperty({ type: 'integer', example: 2 })
  pending!: number;

  @ApiProperty({ type: 'integer', example: 0 })
  underReview!: number;

  @ApiProperty({ type: 'integer', example: 1 })
  qualified!: number;

  @ApiProperty({ type: 'integer', example: 3 })
  rewarded!: number;

  @ApiProperty({ type: 'integer', example: 0 })
  rejected!: number;
}

export class MyReferralDto {
  @ApiProperty({ example: 'PK7QX2MA', pattern: '^[A-Z0-9]{6,12}$' })
  code!: string;

  @ApiProperty({ example: 'https://www.packio.invalid/r/PK7QX2MA' })
  link!: string;

  @ApiProperty({ type: ReferralCountsDto, description: 'People who used my code, by status' })
  referrals!: ReferralCountsDto;
}

export const MY_REFERRAL_EXAMPLE: MyReferralDto = {
  code: 'PK7QX2MA',
  link: 'https://www.packio.invalid/r/PK7QX2MA',
  referrals: { pending: 2, underReview: 0, qualified: 1, rewarded: 3, rejected: 0 },
};

export class AttributeReferralDto {
  @ApiProperty({ example: 'PK7QX2MA', description: 'The code from the referral link; case does not matter' })
  @IsString()
  @MaxLength(20)
  code!: string;
}

export class ReferralDto {
  @IdField(IDS.referral)
  id!: string;

  @ApiProperty({ example: 'PK7QX2MA' })
  code!: string;

  @ApiProperty({ enum: REFERRAL_STATUSES, enumName: 'ReferralStatus', example: 'pending' })
  status!: string;

  @TimestampField('2026-10-01T10:00:00+07:00')
  attributedAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  qualifiedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  rewardedAt!: string | null;
}

export class AdminReferralDto extends ReferralDto {
  @ApiProperty({ type: UserRefDto })
  referrer!: UserRefDto;

  @ApiProperty({ type: UserRefDto })
  referee!: UserRefDto;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: IDS.group, description: 'The referee’s first order group' })
  firstOrderGroupId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'OG-2610-0001' })
  firstOrderGroupCode!: string | null;

  @ApiProperty({
    type: [String],
    example: [],
    description: 'Why it was held or rejected: `<kind>_match` (same phone / address / card / device as the referrer), `linked_referees`, `monthly_cap`',
  })
  fraudFlags!: string[];

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null, description: 'Marketing review (`referral_review`)' })
  approvalId!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  decidedAt!: string | null;
}

export const REFERRAL_EXAMPLE: ReferralDto = {
  id: IDS.referral,
  code: 'PK7QX2MA',
  status: 'pending',
  attributedAt: '2026-10-01T10:00:00+07:00',
  qualifiedAt: null,
  rewardedAt: null,
};

export const ADMIN_REFERRAL_EXAMPLE: AdminReferralDto = {
  ...REFERRAL_EXAMPLE,
  referrer: { id: IDS.referrer, displayName: 'สมชาย ทดสอบ' },
  referee: { id: IDS.referee, displayName: 'สมหญิง ทดสอบ' },
  firstOrderGroupId: IDS.group,
  firstOrderGroupCode: 'OG-2610-0001',
  fraudFlags: [],
  approvalId: null,
  decidedAt: null,
};

export class ReferralListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: REFERRAL_STATUSES, enumName: 'ReferralStatus' })
  @IsOptional()
  @IsIn(REFERRAL_STATUSES)
  status?: (typeof REFERRAL_STATUSES)[number];
}
