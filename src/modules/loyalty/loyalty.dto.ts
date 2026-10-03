import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  NotEquals,
} from 'class-validator';

/** Loyalty points and tiers (D-130…D-135). */

export const POINTS_ENTRY_TYPES = [
  'earn_order',
  'earn_signup',
  'earn_line_link',
  'earn_review',
  'earn_referral',
  'earn_bonus',
  'redeem',
  'redeem_reversal',
  'reversal_claim_refund',
  'expire',
  'adjust',
] as const;
export const POINTS_STATUSES = ['pending', 'available', 'expired', 'reversed'] as const;

export class ExpiringPointsDto {
  @ApiProperty({ type: 'integer', example: 20 })
  points!: number;

  @ApiProperty({ format: 'date-time', example: '2027-10-20T10:00:00+07:00' })
  expiresAt!: string;
}

export class LoyaltySummaryDto {
  @ApiProperty({ enum: ['member', 'silver', 'gold'], enumName: 'LoyaltyTier', example: 'silver' })
  tier!: string;

  @ApiProperty({ example: '1.25', description: 'Earn multiplier of the tier (D-134)' })
  multiplier!: string;

  @ApiProperty({
    example: '62500.00',
    description: 'Spend of the last 12 months (before VAT, excluding shipping)',
  })
  spend12m!: string;

  @ApiProperty({
    enum: ['member', 'silver', 'gold'],
    enumName: 'LoyaltyTier',
    nullable: true,
    example: 'silver',
    description: 'The next tier up (D-134); null at the top tier',
  })
  nextTier!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '50000.00',
    description: '12-month spend the next tier needs',
  })
  nextTierMinSpend12m!: string | null;

  @ApiProperty({ example: '42.50', description: 'My 12-month spend as % of the next tier (100 at the top)' })
  nextTierProgressPct!: string;

  @ApiProperty({ type: 'integer', example: 128, description: 'Points that can be redeemed now' })
  availablePoints!: number;

  @ApiProperty({
    type: 'integer',
    example: 25,
    description: 'Earned on completed orders, credited after the claim window (D-132)',
  })
  pendingPoints!: number;

  @ApiProperty({ example: '2.50', description: 'THB per point (D-131)' })
  pointValue!: string;

  @ApiProperty({ example: '320.00' })
  availableValue!: string;

  @ApiProperty({
    type: [ExpiringPointsDto],
    description: 'Points expiring within the reminder window (30 days)',
  })
  expiringSoon!: ExpiringPointsDto[];

  @ApiProperty({ example: 'THB' })
  currency!: string;
}

export const SUMMARY_EXAMPLE: LoyaltySummaryDto = {
  tier: 'silver',
  multiplier: '1.25',
  spend12m: '62500.00',
  nextTier: 'silver',
  nextTierMinSpend12m: '50000.00',
  nextTierProgressPct: '42.50',
  availablePoints: 128,
  pendingPoints: 25,
  pointValue: '2.50',
  availableValue: '320.00',
  expiringSoon: [{ points: 20, expiresAt: '2027-10-20T10:00:00+07:00' }],
  currency: 'THB',
};

export class PointsEntryDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000b0001' })
  id!: string;

  @ApiProperty({ enum: POINTS_ENTRY_TYPES, enumName: 'PointsEntryType', example: 'earn_order' })
  entryType!: string;

  @ApiProperty({
    type: 'integer',
    example: 25,
    description: 'Signed: earnings positive, redemptions and expiry negative',
  })
  points!: number;

  @ApiProperty({ example: '62.50' })
  bahtValue!: string;

  @ApiProperty({ enum: POINTS_STATUSES, enumName: 'PointsStatus', example: 'pending' })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-28T10:00:00+07:00' })
  availableAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  expiresAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'Link to the order page',
  })
  orderId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'OR-2610-0001' })
  orderCode!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'OG-2610-0001' })
  groupCode!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Reason of a staff adjustment' })
  reason!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-21T10:00:00+07:00' })
  createdAt!: string;
}

export const ENTRY_EXAMPLE: PointsEntryDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-0000000b0001',
  entryType: 'earn_order',
  points: 25,
  bahtValue: '62.50',
  status: 'pending',
  availableAt: '2026-10-28T10:00:00+07:00',
  expiresAt: null,
  orderId: '0192f3a0-7c1e-7d2a-9b1f-0000000d0002',
  orderCode: 'OR-2610-0001',
  groupCode: 'OG-2610-0001',
  reason: null,
  createdAt: '2026-10-21T10:00:00+07:00',
};

// --- reviews (D-135) ------------------------------------------------------------------------------------

export class SubmitReviewDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 5, example: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'กล่องสวย ส่งตรงเวลา', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string | null;
}

export class ReviewDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000b0010' })
  id!: string;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000b0011' })
  orderId!: string;

  @ApiProperty({ example: 'OR-2610-0001' })
  orderCode!: string;

  @ApiProperty({ type: 'integer', example: 5 })
  rating!: number;

  @ApiProperty({ type: String, nullable: true, example: 'กล่องสวย ส่งตรงเวลา' })
  comment!: string | null;

  @ApiProperty({ enum: ['pending', 'published', 'hidden'], enumName: 'ReviewStatus', example: 'published' })
  status!: string;

  @ApiProperty({ type: 'integer', example: 4, description: 'Points the review earned (D-135)' })
  rewardPoints!: number;

  @ApiProperty({ example: 'folding_carton', description: 'The product type reviewed (D-202)' })
  productTypeCode!: string;

  @ApiProperty({ type: () => ReviewReplyDto, nullable: true, description: 'Packio’s reply (D-265)' })
  reply!: ReviewReplyDto | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-25T10:00:00+07:00' })
  createdAt!: string;
}

export class ReviewReplyDto {
  @ApiProperty({ example: 'ขอบคุณที่ไว้วางใจ Packio ครับ' })
  body!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-26T10:00:00+07:00' })
  repliedAt!: string;
}

export class ReplyReviewDto {
  @ApiProperty({ example: 'ขอบคุณที่ไว้วางใจ Packio ครับ', minLength: 2, maxLength: 2000 })
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  body!: string;
}

/** What the public sees (D-202, D-265): no order, no customer beyond an abbreviated name. */
export class PublicReviewDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000b0010' })
  id!: string;

  @ApiProperty({ type: 'integer', example: 5 })
  rating!: number;

  @ApiProperty({ type: String, nullable: true, example: 'กล่องสวย ส่งตรงเวลา' })
  comment!: string | null;

  @ApiProperty({ example: 'สมหญิง ท.', description: 'First name and the initial of the last name' })
  reviewerName!: string;

  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({ example: 'กล่องกระดาษพับ' })
  productTypeNameTh!: string;

  @ApiProperty({ example: 'Folding carton' })
  productTypeNameEn!: string;

  @ApiProperty({ type: ReviewReplyDto, nullable: true })
  reply!: ReviewReplyDto | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-25T10:00:00+07:00' })
  createdAt!: string;
}

export class ReviewRatingCountDto {
  @ApiProperty({ type: 'integer', example: 5 })
  rating!: number;

  @ApiProperty({ type: 'integer', example: 12 })
  count!: number;
}

export class ReviewTypeSummaryDto {
  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({ type: 'integer', example: 12 })
  count!: number;

  @ApiProperty({ type: String, nullable: true, example: '4.75' })
  averageRating!: string | null;
}

export class ReviewSummaryDto {
  @ApiProperty({ type: 'integer', example: 15 })
  count!: number;

  @ApiProperty({ type: String, nullable: true, example: '4.60', description: 'Null without reviews' })
  averageRating!: string | null;

  @ApiProperty({ type: [ReviewRatingCountDto] })
  distribution!: ReviewRatingCountDto[];

  @ApiProperty({ type: [ReviewTypeSummaryDto] })
  byProductType!: ReviewTypeSummaryDto[];
}

export class PublicReviewQuery extends PageQuery {
  @ApiPropertyOptional({ example: 'folding_carton', pattern: '^[a-z][a-z0-9_]*$' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/)
  productTypeCode?: string;
}

export class AdminReviewDto extends ReviewDto {
  @ApiProperty({ type: UserRefDto })
  customer!: UserRefDto;
}

export const REVIEW_EXAMPLE: ReviewDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-0000000b0010',
  orderId: '0192f3a0-7c1e-7d2a-9b1f-0000000b0011',
  orderCode: 'OR-2610-0001',
  rating: 5,
  comment: 'กล่องสวย ส่งตรงเวลา',
  status: 'published',
  rewardPoints: 4,
  productTypeCode: 'folding_carton',
  reply: null,
  createdAt: '2026-10-25T10:00:00+07:00',
};

export const PUBLIC_REVIEW_EXAMPLE: PublicReviewDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-0000000b0010',
  rating: 5,
  comment: 'กล่องสวย ส่งตรงเวลา',
  reviewerName: 'สมหญิง ท.',
  productTypeCode: 'folding_carton',
  productTypeNameTh: 'กล่องกระดาษพับ',
  productTypeNameEn: 'Folding carton',
  reply: { body: 'ขอบคุณที่ไว้วางใจ Packio ครับ', repliedAt: '2026-10-26T10:00:00+07:00' },
  createdAt: '2026-10-25T10:00:00+07:00',
};

export const REVIEW_SUMMARY_EXAMPLE: ReviewSummaryDto = {
  count: 15,
  averageRating: '4.60',
  distribution: [
    { rating: 1, count: 0 },
    { rating: 2, count: 0 },
    { rating: 3, count: 1 },
    { rating: 4, count: 4 },
    { rating: 5, count: 10 },
  ],
  byProductType: [{ productTypeCode: 'folding_carton', count: 15, averageRating: '4.60' }],
};

export const ADMIN_REVIEW_EXAMPLE: AdminReviewDto = {
  ...REVIEW_EXAMPLE,
  customer: { id: '0192f3a0-7c1e-7d2a-9b1f-0000000e0009', displayName: 'สมหญิง ทดสอบ' },
};

export class ReviewListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['pending', 'published', 'hidden'], enumName: 'ReviewStatus' })
  @IsOptional()
  @IsIn(['pending', 'published', 'hidden'])
  status?: 'pending' | 'published' | 'hidden';
}

// --- staff adjustments ----------------------------------------------------------------------------------

export class AdjustPointsDto {
  @ApiProperty({
    type: 'integer',
    example: 40,
    description: 'Points to add (positive) or remove (negative), never 0',
  })
  @Type(() => Number)
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  @NotEquals(0)
  points!: number;

  @ApiProperty({ example: 'ชดเชยงานล่าช้า', maxLength: 500 })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class LedgerQuery extends PageQuery {
  @ApiPropertyOptional({ enum: POINTS_ENTRY_TYPES, enumName: 'PointsEntryType', example: 'earn_order' })
  @IsOptional()
  @IsIn(POINTS_ENTRY_TYPES)
  entryType?: (typeof POINTS_ENTRY_TYPES)[number];
}
