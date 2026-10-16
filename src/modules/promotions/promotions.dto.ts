import { CodedRefDto } from '@common/dto/factory-ref.dto';
import { PageQuery } from '@common/pagination/pagination.dto';
import { IdField, TimestampField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Promotions, campaigns and coupons (D-053, D-154). Conditions and benefits are validated as JSON schema v1. */

export const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'active', 'paused', 'exhausted', 'ended'] as const;
export const PROMOTION_KINDS = ['coupon', 'automatic', 'referral'] as const;
export const STACKING_MODES = ['exclusive', 'stackable', 'best_of'] as const;
export const PROMOTION_STATUSES = ['draft', 'active', 'paused', 'ended'] as const;
export const COUPON_KINDS = ['single', 'bulk_unique', 'per_customer'] as const;
export const COUPON_STATUSES = ['active', 'used_up', 'disabled'] as const;
export const BENEFIT_TYPES = [
  'percent',
  'fixed',
  'tiered',
  'free_shipping',
  'unit_price_override',
  'free_design',
  'free_revision_rounds',
  'free_mockup',
  'points_multiplier',
  'bonus_points',
] as const;
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

const IDS = {
  campaign: '0192f3a0-7c1e-7d2a-9b1f-000000090001',
  promotion: '0192f3a0-7c1e-7d2a-9b1f-000000090002',
  coupon: '0192f3a0-7c1e-7d2a-9b1f-000000090003',
  batch: '0192f3a0-7c1e-7d2a-9b1f-000000090004',
  user: '0192f3a0-7c1e-7d2a-9b1f-0000000e0001',
};

// --- campaigns ------------------------------------------------------------------------------------------

export class CreateCampaignDto {
  @ApiProperty({ example: 'launch-2026', pattern: '^[a-z0-9][a-z0-9_-]{1,39}$' })
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{1,39}$/)
  code!: string;

  @ApiProperty({ example: 'เปิดตัว getpack' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ type: String, format: 'date-time', example: '2026-11-01T00:00:00+07:00' })
  @IsISO8601()
  startsAt!: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-12-31T23:59:59+07:00',
  })
  @IsOptional()
  @IsISO8601()
  endsAt?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '50000.00',
    description: 'THB budget (D-154); null = none',
  })
  @IsOptional()
  @IsString()
  @Matches(MONEY)
  budgetAmount?: string | null;

  @ApiPropertyOptional({
    type: Object,
    example: { newCustomers: 100 },
    description: 'Free-form goals shown on the dashboard',
  })
  @IsOptional()
  @IsObject()
  goals?: Record<string, unknown>;
}

export class UpdateCampaignDto {
  @ApiPropertyOptional({ example: 'เปิดตัว getpack' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', example: '2026-11-01T00:00:00+07:00' })
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, example: null })
  @IsOptional()
  @IsISO8601()
  endsAt?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '80000.00' })
  @IsOptional()
  @IsString()
  @Matches(MONEY)
  budgetAmount?: string | null;

  @ApiPropertyOptional({ type: Object, example: { newCustomers: 150 } })
  @IsOptional()
  @IsObject()
  goals?: Record<string, unknown>;
}

export class CampaignDto {
  @IdField(IDS.campaign)
  id!: string;

  @ApiProperty({ example: 'launch-2026' })
  code!: string;

  @ApiProperty({ example: 'เปิดตัว getpack' })
  name!: string;

  @ApiProperty({ enum: CAMPAIGN_STATUSES, enumName: 'CampaignStatus', example: 'active' })
  status!: string;

  @TimestampField('2026-11-01T00:00:00+07:00')
  startsAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  endsAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '50000.00' })
  budgetAmount!: string | null;

  @ApiProperty({ example: '12500.00' })
  spentAmount!: string;

  @ApiProperty({
    example: '80.0000',
    description: 'Marketing is alerted at this share of the budget (D-154)',
  })
  alertThresholdPct!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  alertedAt!: string | null;

  @ApiProperty({ type: Object, example: { newCustomers: 100 } })
  goals!: Record<string, unknown>;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ type: UserRefDto, nullable: true, description: 'Who created it' })
  owner!: UserRefDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '25.00',
    description: 'Spent as % of the budget (2 decimals); null without a budget (D-154)',
  })
  spentPct!: string | null;

  @ApiProperty({ type: 'integer', example: 3 })
  promotionsCount!: number;

  @ApiProperty({ format: 'date-time', example: '2026-10-20T10:00:00+07:00' })
  createdAt!: string;
}

export const CAMPAIGN_EXAMPLE: CampaignDto = {
  id: IDS.campaign,
  code: 'launch-2026',
  name: 'เปิดตัว getpack',
  status: 'active',
  startsAt: '2026-11-01T00:00:00+07:00',
  endsAt: null,
  budgetAmount: '50000.00',
  spentAmount: '12500.00',
  alertThresholdPct: '80.0000',
  alertedAt: null,
  goals: { newCustomers: 100 },
  currency: 'THB',
  owner: { id: '0192f3a0-7c1e-7d2a-9b1f-0000000e0001', displayName: 'Dev Marketing' },
  spentPct: '25.00',
  promotionsCount: 3,
  createdAt: '2026-10-20T10:00:00+07:00',
};

export class CampaignListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: CAMPAIGN_STATUSES, enumName: 'CampaignStatus' })
  @IsOptional()
  @IsIn(CAMPAIGN_STATUSES)
  status?: (typeof CAMPAIGN_STATUSES)[number];
}

// --- promotions ----------------------------------------------------------------------------------------

export class PromotionConditionsDto {
  @ApiPropertyOptional({
    type: [String],
    example: ['web', 'line'],
    enum: ['web', 'cs', 'line', 'b2b'],
    enumName: 'SalesChannel',
  })
  channels?: string[];

  @ApiPropertyOptional({ type: [String], example: ['new'], description: 'new | returning | b2b' })
  segments?: string[];

  @ApiPropertyOptional({ type: [String], example: ['folding_carton'] })
  productTypeCodes?: string[];

  @ApiPropertyOptional({ type: [String], example: ['folding_carton'] })
  categoryCodes?: string[];

  @ApiPropertyOptional({ type: [String], format: 'uuid', example: [] })
  catalogProductIds?: string[];

  @ApiPropertyOptional({ type: 'integer', example: 500, description: 'Pieces on a matching line' })
  minQuantity?: number;

  @ApiPropertyOptional({ example: '5000.00', description: 'Gross of the matching lines, incl. VAT' })
  minOrderValue?: string;

  @ApiPropertyOptional({ example: true })
  firstOrderOnly?: boolean;

  @ApiPropertyOptional({ type: [String], example: ['scb_qr'], description: 'Enforced when paying' })
  paymentMethods?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['bkk'],
    description: 'Shipping zone codes of every destination',
  })
  zoneCodes?: string[];
}

export class BenefitTierDto {
  @ApiProperty({ example: '1000', description: 'Pieces or THB (basis)' })
  min!: string;

  @ApiPropertyOptional({ example: '8' })
  pct?: string;

  @ApiPropertyOptional({ example: '300.00' })
  amount?: string;
}

export class PromotionBenefitDto {
  @ApiProperty({ enum: BENEFIT_TYPES, enumName: 'PromotionBenefitType', example: 'percent' })
  type!: string;

  @ApiPropertyOptional({ example: '10' })
  pct?: string;

  @ApiPropertyOptional({ example: '500.00' })
  maxAmount?: string;

  @ApiPropertyOptional({ example: '300.00' })
  amount?: string;

  @ApiPropertyOptional({ enum: ['quantity', 'value'], enumName: 'BenefitTierBasis', example: 'quantity' })
  basis?: string;

  @ApiPropertyOptional({ type: [BenefitTierDto] })
  tiers?: BenefitTierDto[];

  @ApiPropertyOptional({ example: '9.500000', description: 'Per piece incl. VAT' })
  unitPrice?: string;

  @ApiPropertyOptional({ type: 'integer', example: 2 })
  rounds?: number;

  @ApiPropertyOptional({ example: '2' })
  multiplier?: string;

  @ApiPropertyOptional({ type: 'integer', example: 100 })
  points?: number;
}

export class CreatePromotionDto {
  @ApiProperty({ example: 'ลด 10% ลูกค้าใหม่' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'สำหรับคำสั่งซื้อแรก' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, example: IDS.campaign })
  @IsOptional()
  @IsUUID()
  campaignId?: string | null;

  @ApiProperty({ enum: ['coupon', 'automatic'], enumName: 'PromotionKind', example: 'coupon' })
  @IsIn(['coupon', 'automatic'])
  kind!: 'coupon' | 'automatic';

  @ApiProperty({ type: 'integer', example: 100, description: 'Lower applies first' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  priority!: number;

  @ApiProperty({ enum: STACKING_MODES, enumName: 'StackingMode', example: 'stackable' })
  @IsIn(STACKING_MODES)
  stacking!: (typeof STACKING_MODES)[number];

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: null,
    description: 'Stackable promotions in one group: only the best applies',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  stackGroup?: string | null;

  @ApiProperty({ type: String, format: 'date-time', example: '2026-11-01T00:00:00+07:00' })
  @IsISO8601()
  startsAt!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, example: null })
  @IsOptional()
  @IsISO8601()
  endsAt?: string | null;

  @ApiProperty({ type: PromotionConditionsDto })
  @IsObject()
  conditions!: Record<string, unknown>;

  @ApiProperty({ type: PromotionBenefitDto })
  @IsObject()
  benefit!: Record<string, unknown>;

  @ApiPropertyOptional({ type: 'integer', nullable: true, example: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  usageLimitTotal?: number | null;

  @ApiPropertyOptional({ type: 'integer', nullable: true, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  usageLimitPerCustomer?: number | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '10000.00',
    description: 'Budget of this promotion alone',
  })
  @IsOptional()
  @IsString()
  @Matches(MONEY)
  budgetAmount?: string | null;
}

export class UpdatePromotionDto {
  @ApiPropertyOptional({ example: 'ลด 10% ลูกค้าใหม่' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: null })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ type: 'integer', example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  priority?: number;

  @ApiPropertyOptional({ enum: STACKING_MODES, enumName: 'StackingMode', example: 'exclusive' })
  @IsOptional()
  @IsIn(STACKING_MODES)
  stacking?: (typeof STACKING_MODES)[number];

  @ApiPropertyOptional({ type: String, nullable: true, example: null })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  stackGroup?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', example: '2026-11-01T00:00:00+07:00' })
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, example: null })
  @IsOptional()
  @IsISO8601()
  endsAt?: string | null;

  @ApiPropertyOptional({ type: PromotionConditionsDto })
  @IsOptional()
  @IsObject()
  conditions?: Record<string, unknown>;

  @ApiPropertyOptional({ type: PromotionBenefitDto })
  @IsOptional()
  @IsObject()
  benefit?: Record<string, unknown>;

  @ApiPropertyOptional({ type: 'integer', nullable: true, example: 2000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  usageLimitTotal?: number | null;

  @ApiPropertyOptional({ type: 'integer', nullable: true, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  usageLimitPerCustomer?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null })
  @IsOptional()
  @IsString()
  @Matches(MONEY)
  budgetAmount?: string | null;
}

export class PromotionUsageDto {
  @ApiProperty({ type: 'integer', example: 42, description: 'Reserved and applied redemptions' })
  redemptions!: number;

  @ApiProperty({ example: '12500.00', description: 'Discounts given, before VAT' })
  discountAmount!: string;

  @ApiProperty({ example: '800.00', description: 'Removed by the margin guard or the budget' })
  cappedAmount!: string;
}

export class PromotionPriorityDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    minItems: 1,
    maxItems: 500,
    example: [IDS.promotion],
    description: 'In evaluation order',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  promotionIds!: string[];
}

export class PromotionPriorityResultDto {
  @ApiProperty({ type: 'integer', example: 3, description: 'Promotions whose priority changed' })
  updated!: number;
}

export class CouponListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid', description: 'Codes of one generation batch' })
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiPropertyOptional({ enum: ['active', 'used_up', 'disabled'], enumName: 'CouponStatus' })
  @IsOptional()
  @IsIn(['active', 'used_up', 'disabled'])
  status?: 'active' | 'used_up' | 'disabled';
}

export class PromotionDto {
  @IdField(IDS.promotion)
  id!: string;

  @ApiProperty({ example: 'ลด 10% ลูกค้าใหม่' })
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  description!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: IDS.campaign })
  campaignId!: string | null;

  @ApiProperty({ enum: PROMOTION_KINDS, enumName: 'PromotionKind', example: 'coupon' })
  kind!: string;

  @ApiProperty({ type: 'integer', example: 100 })
  priority!: number;

  @ApiProperty({ enum: STACKING_MODES, enumName: 'StackingMode', example: 'stackable' })
  stacking!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  stackGroup!: string | null;

  @ApiProperty({ enum: PROMOTION_STATUSES, enumName: 'PromotionStatus', example: 'active' })
  status!: string;

  @TimestampField('2026-11-01T00:00:00+07:00')
  startsAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  endsAt!: string | null;

  @ApiProperty({ type: PromotionConditionsDto })
  conditions!: Record<string, unknown>;

  @ApiProperty({ type: PromotionBenefitDto })
  benefit!: Record<string, unknown>;

  @ApiProperty({ type: 'integer', nullable: true, example: 1000 })
  usageLimitTotal!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 1 })
  usageLimitPerCustomer!: number | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  budgetAmount!: string | null;

  @ApiProperty({ example: '0.00' })
  spentAmount!: string;

  @ApiProperty({ example: 'ลด 10% สูงสุด 500.00 บาท', description: 'The benefit in words (Thai)' })
  benefitSummaryTh!: string;

  @ApiProperty({ example: '10% off, up to THB 500.00' })
  benefitSummaryEn!: string;

  @ApiProperty({ type: () => PromotionUsageDto })
  usage!: PromotionUsageDto;

  @ApiProperty({ type: () => CodedRefDto, nullable: true })
  campaign!: CodedRefDto | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-20T10:00:00+07:00' })
  updatedAt!: string;
}

export const PROMOTION_EXAMPLE: PromotionDto = {
  id: IDS.promotion,
  name: 'ลด 10% ลูกค้าใหม่',
  description: null,
  campaignId: IDS.campaign,
  kind: 'coupon',
  priority: 100,
  stacking: 'stackable',
  stackGroup: null,
  status: 'active',
  startsAt: '2026-11-01T00:00:00+07:00',
  endsAt: null,
  conditions: { segments: ['new'], productTypeCodes: ['folding_carton'] },
  benefit: { type: 'percent', pct: '10', maxAmount: '500.00' },
  usageLimitTotal: 1000,
  usageLimitPerCustomer: 1,
  budgetAmount: null,
  spentAmount: '0.00',
  benefitSummaryTh: 'ลด 10% สูงสุด 500.00 บาท',
  benefitSummaryEn: '10% off, up to THB 500.00',
  usage: { redemptions: 0, discountAmount: '0.00', cappedAmount: '0.00' },
  campaign: { id: IDS.campaign, code: 'launch-2026', name: 'เปิดตัว getpack' },
  updatedAt: '2026-10-20T10:00:00+07:00',
};

export const CREATE_PROMOTION_EXAMPLE = {
  name: 'ลด 10% ลูกค้าใหม่',
  campaignId: IDS.campaign,
  kind: 'coupon',
  priority: 100,
  stacking: 'stackable',
  startsAt: '2026-11-01T00:00:00+07:00',
  conditions: { segments: ['new'], productTypeCodes: ['folding_carton'] },
  benefit: { type: 'percent', pct: '10', maxAmount: '500.00' },
  usageLimitTotal: 1000,
  usageLimitPerCustomer: 1,
};

export class PromotionListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: PROMOTION_STATUSES, enumName: 'PromotionStatus' })
  @IsOptional()
  @IsIn(PROMOTION_STATUSES)
  status?: (typeof PROMOTION_STATUSES)[number];

  @ApiPropertyOptional({ enum: PROMOTION_KINDS, enumName: 'PromotionKind' })
  @IsOptional()
  @IsIn(PROMOTION_KINDS)
  kind?: (typeof PROMOTION_KINDS)[number];

  @ApiPropertyOptional({ format: 'uuid', example: IDS.campaign })
  @IsOptional()
  @IsUUID()
  campaignId?: string;
}

// --- coupons --------------------------------------------------------------------------------------------

export class GenerateCouponsDto {
  @ApiProperty({ enum: COUPON_KINDS, enumName: 'CouponKind', example: 'bulk_unique' })
  @IsIn(COUPON_KINDS)
  kind!: (typeof COUPON_KINDS)[number];

  @ApiPropertyOptional({ example: 'WELCOME10', description: '`single`: the code customers type' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9-]{3,40}$/)
  code?: string;

  @ApiPropertyOptional({ type: 'integer', example: 500, description: '`bulk_unique`: how many codes' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  count?: number;

  @ApiPropertyOptional({ example: 'PK', description: 'Prefix of generated codes (A–Z, 0–9)' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{1,12}$/)
  prefix?: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    example: [IDS.user],
    description: '`per_customer`: one code each',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsUUID('all', { each: true })
  customerIds?: string[];

  @ApiPropertyOptional({
    type: 'integer',
    nullable: true,
    example: null,
    description: 'Uses per code (generated codes: 1)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  usageLimit?: number | null;
}

export class CouponBatchResultDto {
  @ApiProperty({ format: 'uuid', example: IDS.batch })
  batchId!: string;

  @ApiProperty({ type: 'integer', example: 500 })
  count!: number;

  @ApiProperty({
    enum: ['single', 'bulk_unique', 'per_customer'],
    enumName: 'CouponKind',
    example: 'bulk_unique',
  })
  kind!: string;

  @ApiProperty({ type: String, nullable: true, example: 'PK' })
  prefix!: string | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 1,
    description: 'Uses per code; null = unlimited',
  })
  usageLimit!: number | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-20T10:00:00+07:00' })
  generatedAt!: string;

  @ApiProperty({ type: UserRefDto, nullable: true })
  generatedBy!: UserRefDto | null;
}

/** A generated batch as listed (same facts, `id` names it). */
export class CouponBatchDto {
  @ApiProperty({ format: 'uuid', example: IDS.batch })
  id!: string;

  @ApiProperty({
    enum: ['single', 'bulk_unique', 'per_customer'],
    enumName: 'CouponKind',
    example: 'bulk_unique',
  })
  kind!: string;

  @ApiProperty({ type: 'integer', example: 500 })
  count!: number;

  @ApiProperty({ type: String, nullable: true, example: 'PK' })
  prefix!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 1 })
  usageLimit!: number | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-20T10:00:00+07:00' })
  generatedAt!: string;

  @ApiProperty({ type: UserRefDto, nullable: true })
  generatedBy!: UserRefDto | null;
}

export class CouponCodeDto {
  @IdField(IDS.coupon)
  id!: string;

  @ApiProperty({ example: 'PKAB23CD45' })
  code!: string;

  @ApiProperty({ enum: COUPON_STATUSES, enumName: 'CouponStatus', example: 'active' })
  status!: string;

  @ApiProperty({ type: 'integer', nullable: true, example: 1 })
  usageLimit!: number | null;

  @ApiProperty({ type: 'integer', example: 0 })
  usedCount!: number;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  assignedCustomerId!: string | null;

  @ApiProperty({
    type: UserRefDto,
    nullable: true,
    description: 'The customer a per-customer code belongs to',
  })
  assignedCustomer!: UserRefDto | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: IDS.batch })
  batchId!: string | null;
}

export const COUPON_EXAMPLE: CouponCodeDto = {
  id: IDS.coupon,
  code: 'PKAB23CD45',
  status: 'active',
  usageLimit: 1,
  usedCount: 0,
  assignedCustomerId: null,
  assignedCustomer: null,
  batchId: IDS.batch,
};

export class PromotionReportDto {
  @ApiProperty({ type: 'integer', example: 42, description: 'Reserved and applied redemptions' })
  redemptions!: number;

  @ApiProperty({ type: 'integer', example: 30, description: 'On paid order groups' })
  appliedRedemptions!: number;

  @ApiProperty({ example: '12500.00', description: 'Cost of the promotion (discounts given, before VAT)' })
  discountAmount!: string;

  @ApiProperty({ example: '800.00', description: 'Removed by the margin guard or the budget' })
  cappedAmount!: string;

  @ApiProperty({ type: 'integer', example: 40 })
  orderGroups!: number;

  @ApiProperty({ example: '420000.00', description: 'Gross of the order groups that used it' })
  grossAmount!: string;

  @ApiProperty({ type: 'integer', example: 38 })
  customers!: number;

  @ApiProperty({ example: 'THB' })
  currency!: string;
}

export const REPORT_EXAMPLE: PromotionReportDto = {
  redemptions: 42,
  appliedRedemptions: 30,
  discountAmount: '12500.00',
  cappedAmount: '800.00',
  orderGroups: 40,
  grossAmount: '420000.00',
  customers: 38,
  currency: 'THB',
};

export class CouponExportQuery {
  @ApiPropertyOptional({ format: 'uuid', example: IDS.batch, description: 'Only the codes of one batch' })
  @IsOptional()
  @IsUUID()
  batchId?: string;
}

export class CouponExportDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000f11f' })
  fileId!: string;

  @ApiProperty({
    example: 'https://getpack-files.s3.example.com/…&X-Amz-Expires=300',
    description: 'Signed for 5 minutes',
  })
  url!: string;

  @ApiProperty({ type: 'integer', example: 500 })
  codes!: number;

  @ApiProperty({ format: 'date-time', example: '2026-11-01T10:05:00+07:00' })
  expiresAt!: string;
}

export class ReportQuery {
  @ApiPropertyOptional({ format: 'uuid', example: IDS.campaign })
  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @ApiPropertyOptional({ format: 'uuid', example: IDS.promotion })
  @IsOptional()
  @IsUUID()
  promotionId?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    example: '2026-11-01T00:00:00+07:00',
    description: 'Reserved from (inclusive)',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    example: '2026-12-01T00:00:00+07:00',
    description: 'Reserved before',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
