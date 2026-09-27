import { ApiProperty } from '@nestjs/swagger';

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

  @ApiProperty({ example: '62500.00', description: 'Spend of the last 12 months (before VAT, excluding shipping)' })
  spend12m!: string;

  @ApiProperty({ type: 'integer', example: 128, description: 'Points that can be redeemed now' })
  availablePoints!: number;

  @ApiProperty({ type: 'integer', example: 25, description: 'Earned on completed orders, credited after the claim window (D-132)' })
  pendingPoints!: number;

  @ApiProperty({ example: '2.50', description: 'THB per point (D-131)' })
  pointValue!: string;

  @ApiProperty({ example: '320.00' })
  availableValue!: string;

  @ApiProperty({ type: [ExpiringPointsDto], description: 'Points expiring within the reminder window (30 days)' })
  expiringSoon!: ExpiringPointsDto[];

  @ApiProperty({ example: 'THB' })
  currency!: string;
}

export const SUMMARY_EXAMPLE: LoyaltySummaryDto = {
  tier: 'silver',
  multiplier: '1.25',
  spend12m: '62500.00',
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

  @ApiProperty({ type: 'integer', example: 25, description: 'Signed: earnings positive, redemptions and expiry negative' })
  points!: number;

  @ApiProperty({ example: '62.50' })
  bahtValue!: string;

  @ApiProperty({ enum: POINTS_STATUSES, enumName: 'PointsStatus', example: 'pending' })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-28T10:00:00+07:00' })
  availableAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  expiresAt!: string | null;

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
  orderCode: 'OR-2610-0001',
  groupCode: 'OG-2610-0001',
  reason: null,
  createdAt: '2026-10-21T10:00:00+07:00',
};
