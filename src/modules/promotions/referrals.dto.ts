import { PageQuery } from '@common/pagination/pagination.dto';
import { IdField, TimestampField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Referral programme (D-136). */

export const REFERRAL_STATUSES = [
  'pending',
  'under_review',
  'qualified',
  'rewarded',
  'rejected_fraud',
] as const;

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

/** The referral rules (D-136, setting `referral.rules`). */
export class ReferralRulesDto {
  @ApiProperty({ example: '5', description: "The friend's discount on their first order, %" })
  refereeDiscountPct!: string;

  @ApiProperty({ example: '500.00', description: 'Cap of that discount' })
  refereeDiscountMaxAmount!: string;

  @ApiProperty({ example: '500.00', description: 'My reward per rewarded referral, in baht' })
  referrerRewardAmount!: string;

  @ApiProperty({ type: 'integer', example: 200, description: 'The same reward in points (D-131)' })
  referrerRewardPoints!: number;

  @ApiProperty({ type: 'integer', example: 10, description: 'Rewarded referrals per calendar month' })
  maxRewardedPerMonth!: number;
}

/** Someone who used my code, as I may see them (first letter of the name only, PDPA). */
export class MyReferralItemDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000e9001' })
  id!: string;

  @ApiProperty({ example: 'ส•••' })
  refereeName!: string;

  @ApiProperty({ enum: REFERRAL_STATUSES, enumName: 'ReferralStatus', example: 'rewarded' })
  status!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T10:00:00+07:00' })
  joinedAt!: string;

  @ApiProperty({ type: 'integer', example: 200, description: 'Points I received for it' })
  rewardPoints!: number;
}

export class MyReferralDto {
  @ApiProperty({ example: 'PK7QX2MA', pattern: '^[A-Z0-9]{6,12}$' })
  code!: string;

  @ApiProperty({ example: 'https://www.getpack.invalid/r/PK7QX2MA' })
  link!: string;

  @ApiProperty({ type: ReferralCountsDto, description: 'People who used my code, by status' })
  referrals!: ReferralCountsDto;

  @ApiProperty({ type: ReferralRulesDto })
  rules!: ReferralRulesDto;

  @ApiProperty({
    type: 'integer',
    example: 1,
    description: 'Referrals qualified or rewarded this calendar month (the D-136 cap)',
  })
  rewardedThisMonth!: number;

  @ApiProperty({ type: [MyReferralItemDto], description: 'The 50 most recent, newest first' })
  recent!: MyReferralItemDto[];
}

export const MY_REFERRAL_EXAMPLE: MyReferralDto = {
  code: 'PK7QX2MA',
  link: 'https://www.getpack.invalid/r/PK7QX2MA',
  referrals: { pending: 2, underReview: 0, qualified: 1, rewarded: 3, rejected: 0 },
  rules: {
    refereeDiscountPct: '5',
    refereeDiscountMaxAmount: '500.00',
    referrerRewardAmount: '500.00',
    referrerRewardPoints: 200,
    maxRewardedPerMonth: 10,
  },
  rewardedThisMonth: 1,
  recent: [
    {
      id: '0192f3a0-7c1e-7d2a-9b1f-0000000e9001',
      refereeName: 'ส•••',
      status: 'rewarded',
      joinedAt: '2026-10-01T10:00:00+07:00',
      rewardPoints: 200,
    },
  ],
};

export class AttributeReferralDto {
  @ApiProperty({ example: 'PK7QX2MA', description: 'The code from the referral link; case does not matter' })
  @IsString()
  @MaxLength(20)
  code!: string;
}

export const REFERRAL_FRAUD_FLAGS = [
  'phone_match',
  'address_match',
  'card_token_match',
  'device_match',
  'linked_referees',
  'monthly_cap',
] as const;

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

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: IDS.group,
    description: 'The referee’s first order group',
  })
  firstOrderGroupId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'OG-2610-0001' })
  firstOrderGroupCode!: string | null;

  @ApiProperty({
    enum: REFERRAL_FRAUD_FLAGS,
    enumName: 'ReferralFraudFlag',
    isArray: true,
    example: [],
    description:
      'Why it was held or rejected: `<kind>_match` (same phone / address / card / device as the referrer), `linked_referees`, `monthly_cap`',
  })
  fraudFlags!: string[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: '14182.80',
    description: 'Gross amount of the first order group',
  })
  firstOrderGrossAmount!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'End of the first order’s claim window: the reward waits for it (D-132)',
  })
  firstOrderClaimWindowEndsAt!: string | null;

  @ApiProperty({
    type: 'integer',
    example: 0,
    description: 'Points credited to the referrer for this referral',
  })
  rewardPoints!: number;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'Marketing review (`referral_review`)',
  })
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
  firstOrderGrossAmount: '14182.80',
  firstOrderClaimWindowEndsAt: null,
  rewardPoints: 0,
};

export class ReferralListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: REFERRAL_STATUSES, enumName: 'ReferralStatus' })
  @IsOptional()
  @IsIn(REFERRAL_STATUSES)
  status?: (typeof REFERRAL_STATUSES)[number];

  @ApiPropertyOptional({ format: 'uuid', description: 'Referrals of this referrer' })
  @IsOptional()
  @IsUUID()
  referrerId?: string;
}
