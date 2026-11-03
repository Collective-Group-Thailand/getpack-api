import { PageQuery } from '@common/pagination/pagination.dto';
import { AGENT_IDS, AgentRefDto } from '@modules/agents/agents.dto';
import { P3_IDS } from '@modules/agents/agents-pipeline.dto';
import {
  AgentDiscountRequestDto,
  AgentQuoteLeadRefDto,
  DISCOUNT_REQUEST_EXAMPLE,
} from '@modules/agents/agents-quotes.dto';
import { IdField, TimestampField } from '@modules/catalog/crud/dto-fields';
import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { APPROVAL_LEVELS, AUTHORITY_COLOURS, WATERFALL_TIERS } from './discount-approval-rules';
import { P4_IDS } from './sales-pipeline.dto';

/** D-470: the discount approval desk. Money: decimal strings, THB, before VAT; percentages in percent. */

const PCT = /^\d{1,2}(\.\d{1,4})?$/;
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
export const APPROVAL_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'countered',
  'stale',
  'withdrawn',
] as const;
export const DECISIONS = ['approve', 'reject', 'counter'] as const;
export const OPTION_KINDS = ['standard', 'co_fund', 'spiff'] as const;
const FEE_STATUSES = ['set', 'not_set'] as const;
const BAD_DEBT_STATUSES = ['set', 'not_set', 'not_applicable'] as const;
const FLOOR_CHECKS = ['pass', 'fail'] as const;

// --- waterfall tiers -------------------------------------------------------------------------------------------------

export class AuthorityWaterfallDto {
  @ApiProperty({
    enum: ['authority'],
    enumName: 'SalesWaterfallAuthorityVisibility',
    example: 'authority',
    description: '`authority`: no figures — the authority colour only (reps, D-470)',
  })
  visibility!: string;

  @ApiProperty({
    enum: AUTHORITY_COLOURS,
    enumName: 'SalesAuthorityColour',
    example: 'amber',
    description: 'green = within a rep’s authority · amber = a sales manager decides · red = C-Level decides',
  })
  authorityLevel!: string;
}

export class MarginPctWaterfallDto extends AuthorityWaterfallDto {
  @ApiProperty({
    enum: ['margin_pct'],
    enumName: 'SalesWaterfallMarginPctVisibility',
    example: 'margin_pct',
    description: '`margin_pct`: percentages and the floor check only (sales managers)',
  })
  declare visibility: string;

  @ApiProperty({ example: '5.00' }) discountPct!: string;
  @ApiProperty({ example: '12.40', description: 'Gross margin ÷ net revenue, %' }) grossMarginPct!: string;
  @ApiProperty({ example: '6.10', description: 'กำไรหลังหักค่าคอม ÷ net revenue, %' })
  contributionPct!: string;
  @ApiProperty({ example: '10.00', description: 'Walk-away gross margin % of the product class' })
  floorPct!: string;
  @ApiProperty({ enum: FLOOR_CHECKS, enumName: 'SalesFloorCheck', example: 'pass' }) floorCheck!: string;
}

export class PaymentFeeLineDto {
  @ApiProperty({ type: String, nullable: true, example: 'bank_transfer' }) method!: string | null;
  @ApiProperty({ example: '0.00' }) amount!: string;
  @ApiProperty({
    enum: FEE_STATUSES,
    enumName: 'SalesFeeStatus',
    example: 'not_set',
    description: '`not_set`: `payments.method_fees` has no fee for the method (counted as 0)',
  })
  status!: string;
}

export class BadDebtLineDto {
  @ApiProperty({ type: String, nullable: true, example: null }) pct!: string | null;
  @ApiProperty({ example: '0.00' }) amount!: string;
  @ApiProperty({
    enum: BAD_DEBT_STATUSES,
    enumName: 'SalesBadDebtStatus',
    example: 'not_applicable',
    description:
      '`not_applicable`: the customer pays before production · `not_set`: no rate for the credit grade yet (0)',
  })
  status!: string;
}

export class FullWaterfallDto extends MarginPctWaterfallDto {
  @ApiProperty({
    enum: ['full'],
    enumName: 'SalesWaterfallFullVisibility',
    example: 'full',
    description: '`full`: every line (C-Level, VP, Director, Finance Manager, Superadmin)',
  })
  declare visibility: string;

  @ApiProperty({ example: '1080000.00', description: 'List revenue before VAT, excluding shipping' })
  listRevenue!: string;
  @ApiProperty({ example: '54000.00' }) discountAmount!: string;
  @ApiProperty({ example: '1026000.00' }) netRevenue!: string;
  @ApiProperty({ example: '936000.00', description: 'Factory buy price (net)' }) factoryCost!: string;
  @ApiProperty({ example: '3000.00', description: 'Shipping charged − shipping paid (net)' })
  shippingDifference!: string;
  @ApiProperty({ type: PaymentFeeLineDto }) paymentFee!: PaymentFeeLineDto;
  @ApiProperty({ example: '0.00', description: 'Samples and free services given' }) freeServices!: string;
  @ApiProperty({ example: '93000.00' }) grossMargin!: string;
  @ApiProperty({ example: '3.0000' }) commissionRatePct!: string;
  @ApiProperty({ example: '30780.00' }) commissionAmount!: string;
  @ApiProperty({ example: '11399.00', description: 'Credit cost estimate (management figure, not posted)' })
  creditCost!: string;
  @ApiProperty({ example: '1.11' }) creditCostPct!: string;
  @ApiProperty({ type: BadDebtLineDto }) badDebtProvision!: BadDebtLineDto;
  @ApiProperty({ example: '50821.00', description: '"กำไรหลังหักค่าคอม" — contribution after commission' })
  contributionAfterCommission!: string;
}

export const WATERFALL_ONE_OF = {
  oneOf: [
    { $ref: getSchemaPath(AuthorityWaterfallDto) },
    { $ref: getSchemaPath(MarginPctWaterfallDto) },
    { $ref: getSchemaPath(FullWaterfallDto) },
  ],
  discriminator: {
    propertyName: 'visibility',
    mapping: {
      authority: getSchemaPath(AuthorityWaterfallDto),
      margin_pct: getSchemaPath(MarginPctWaterfallDto),
      full: getSchemaPath(FullWaterfallDto),
    },
  },
};

export const FULL_WATERFALL_EXAMPLE = {
  visibility: 'full',
  authorityLevel: 'red',
  listRevenue: '1080000.00',
  discountPct: '5.00',
  discountAmount: '54000.00',
  netRevenue: '1026000.00',
  factoryCost: '936000.00',
  shippingDifference: '3000.00',
  paymentFee: { method: 'bank_transfer', amount: '0.00', status: 'not_set' },
  freeServices: '0.00',
  grossMargin: '93000.00',
  grossMarginPct: '9.06',
  commissionRatePct: '3.0000',
  commissionAmount: '30780.00',
  creditCost: '11399.00',
  creditCostPct: '1.11',
  badDebtProvision: { pct: null, amount: '0.00', status: 'not_applicable' },
  contributionAfterCommission: '50821.00',
  contributionPct: '4.95',
  floorPct: '10.00',
  floorCheck: 'fail',
};

@ApiExtraModels(AuthorityWaterfallDto, MarginPctWaterfallDto, FullWaterfallDto)
export class OptionWaterfallDto {
  @ApiProperty({ format: 'uuid', example: P3_IDS.discountOption }) optionId!: string;
  @ApiProperty({ enum: OPTION_KINDS, enumName: 'AgentDiscountOptionKind', example: 'standard' })
  kind!: string;
  @ApiProperty({ example: '5.00' }) discountPct!: string;
  @ApiProperty({ ...WATERFALL_ONE_OF, description: 'In the viewer’s tier' }) waterfall!: object;
}

// --- queue and detail ------------------------------------------------------------------------------------------------

export class DiscountApprovalQuoteRefDto {
  @ApiProperty({ format: 'uuid', example: P3_IDS.quote }) id!: string;
  @ApiProperty({ type: String, nullable: true, example: 'QT-2611-00042' }) quoteCode!: string | null;
  @TimestampField('2026-11-18T23:59:59+07:00') validUntil!: string;
}

export class DiscountApprovalSummaryDto {
  @IdField(P4_IDS.approval) id!: string;
  @ApiProperty({ enum: APPROVAL_STATUSES, enumName: 'SalesDiscountApprovalStatus', example: 'pending' })
  status!: string;
  @ApiProperty({ enum: APPROVAL_LEVELS, enumName: 'SalesDiscountApprovalLevel', example: 'sales_manager' })
  level!: string;
  @ApiProperty({ enum: APPROVAL_LEVELS, enumName: 'SalesDiscountApprovalLevel', example: 'rep' })
  baseLevel!: string;
  @ApiProperty({ enum: AUTHORITY_COLOURS, enumName: 'SalesAuthorityColour', example: 'amber' })
  authorityLevel!: string;
  @ApiProperty({ example: true, description: '"เจรจาราคาสูง": the level was raised one step' })
  negotiationHeavy!: boolean;
  @ApiProperty({ example: '5.00' }) requestedPct!: string;
  @ApiProperty({ type: 'integer', example: 1 }) round!: number;
  @ApiProperty({ format: 'uuid', example: P3_IDS.discountRequest }) requestId!: string;
  @ApiProperty({ format: 'uuid', example: P3_IDS.agentQuote }) agentQuoteId!: string;
  @ApiProperty({ type: DiscountApprovalQuoteRefDto }) quote!: DiscountApprovalQuoteRefDto;
  @ApiProperty({ type: AgentRefDto }) agent!: AgentRefDto;
  @ApiProperty({ type: AgentQuoteLeadRefDto }) lead!: AgentQuoteLeadRefDto;
  @ApiProperty({ type: UserRefDto }) requestedBy!: UserRefDto;
  @TimestampField('2026-11-03T14:00:00+07:00') dueAt!: string;
  @ApiProperty({ example: false }) overdue!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null }) escalatedAt!:
    string | null;
  @ApiProperty({ type: UserRefDto, nullable: true }) decidedBy!: UserRefDto | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null }) decidedAt!:
    string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null }) validUntil!:
    string | null;
  @TimestampField('2026-11-03T10:00:00+07:00') createdAt!: string;
}

export class PriceLockDto {
  @IdField(P4_IDS.priceLock) id!: string;
  @ApiProperty({ example: '936000.00', description: 'Factory buy price locked (net)' }) buyPrice!: string;
  @ApiProperty({
    enum: ['requested', 'confirmed', 'expired', 'released'],
    enumName: 'SalesFactoryPriceLockStatus',
    example: 'requested',
    description: '`requested`: the factory’s confirmation in the partner zone is not built yet (deferred)',
  })
  status!: string;
  @TimestampField('2026-11-10T10:00:00+07:00') validUntil!: string;
}

@ApiExtraModels(AuthorityWaterfallDto, MarginPctWaterfallDto, FullWaterfallDto)
export class DiscountApprovalDto extends DiscountApprovalSummaryDto {
  @ApiProperty({
    type: AgentDiscountRequestDto,
    description: 'The round: give-get, evidence, options offered',
  })
  request!: AgentDiscountRequestDto;
  @ApiProperty({
    ...WATERFALL_ONE_OF,
    description: 'The quote at the requested discount, in the viewer’s tier',
  })
  waterfall!: object;
  @ApiProperty({ type: [OptionWaterfallDto] }) optionWaterfalls!: OptionWaterfallDto[];
  @ApiProperty({ type: String, nullable: true, example: null }) decisionNote!: string | null;
  @ApiProperty({ type: Object, nullable: true, example: null, description: 'Counter-offer conditions' })
  counter!: Record<string, unknown> | null;
  @ApiProperty({ example: false, description: '"อนุมัติด้วยตนเอง" (D-449 solo-owner mode)' })
  selfApproved!: boolean;
  @ApiPropertyOptional({
    type: [PriceLockDto],
    description: 'Factory buy-price locks — only in the full tier (absent otherwise)',
  })
  priceLocks?: PriceLockDto[];
}

export class DiscountApprovalListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: APPROVAL_STATUSES, enumName: 'SalesDiscountApprovalStatus' })
  @IsOptional()
  @IsIn(APPROVAL_STATUSES)
  status?: (typeof APPROVAL_STATUSES)[number];

  @ApiPropertyOptional({ enum: APPROVAL_LEVELS, enumName: 'SalesDiscountApprovalLevel' })
  @IsOptional()
  @IsIn(APPROVAL_LEVELS)
  level?: (typeof APPROVAL_LEVELS)[number];

  @ApiPropertyOptional({ type: Boolean, description: 'Pending approvals I may decide (not my own requests)' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  awaitingMe?: boolean;
}

export class OpenDiscountApprovalDto {
  @ApiProperty({ format: 'uuid', example: P3_IDS.discountRequest }) @IsUUID() discountRequestId!: string;
}

export class SimulateDiscountApprovalDto {
  @ApiProperty({ example: '5.00', pattern: PCT.source }) @Matches(PCT) discountPct!: string;

  @ApiPropertyOptional({
    type: 'integer',
    example: 30,
    minimum: 0,
    maximum: 180,
    description: 'Credit days after delivery',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(180)
  creditDays?: number;

  @ApiPropertyOptional({ example: 'deposit_50', description: 'A payment schedule template key (D-020)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  paymentTemplateKey?: string;

  @ApiPropertyOptional({ example: '50.00', pattern: PCT.source })
  @IsOptional()
  @Matches(PCT)
  depositPct?: string;

  @ApiPropertyOptional({
    example: '2.0000',
    pattern: PCT.source,
    description: 'Co-fund (lower) or spiff (higher) rate',
  })
  @IsOptional()
  @Matches(PCT)
  ratePct?: string;

  @ApiPropertyOptional({ example: 'bank_transfer', maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  paymentMethod?: string;

  @ApiPropertyOptional({
    example: '1500.00',
    pattern: MONEY.source,
    description: 'Samples / free services given',
  })
  @IsOptional()
  @Matches(MONEY)
  freeServicesAmount?: string;
}

@ApiExtraModels(AuthorityWaterfallDto, MarginPctWaterfallDto, FullWaterfallDto)
export class DiscountSimulationDto {
  @ApiProperty({ enum: APPROVAL_LEVELS, enumName: 'SalesDiscountApprovalLevel', example: 'sales_manager' })
  level!: string;
  @ApiProperty({ ...WATERFALL_ONE_OF, description: 'Recomputed in the viewer’s tier; nothing is saved' })
  waterfall!: object;
}

export class ApprovalOptionInputDto {
  @ApiProperty({ enum: OPTION_KINDS, enumName: 'AgentDiscountOptionKind', example: 'standard' })
  @IsIn(OPTION_KINDS)
  kind!: (typeof OPTION_KINDS)[number];

  @ApiProperty({ example: '5.00', pattern: PCT.source }) @Matches(PCT) discountPct!: string;

  @ApiPropertyOptional({ example: '2.0000', pattern: PCT.source, description: 'co_fund / spiff only' })
  @IsOptional()
  @Matches(PCT)
  ratePct?: string;
}

export class DecideDiscountApprovalDto {
  @ApiProperty({ enum: DECISIONS, enumName: 'SalesDiscountDecision', example: 'approve' })
  @IsIn(DECISIONS)
  decision!: (typeof DECISIONS)[number];

  @ApiPropertyOptional({
    type: [ApprovalOptionInputDto],
    description: '`approve`: 1–3 options; the first must be `standard` (the agent’s full rate)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ApprovalOptionInputDto)
  options?: ApprovalOptionInputDto[];

  @ApiPropertyOptional({
    example: 'อนุมัติเมื่อมัดจำ 50%',
    maxLength: 500,
    description: 'Required to reject or counter',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    type: Object,
    example: { depositPct: '50.00', quantityChange: 8000 },
    description: '`counter`: the give-get conditions asked for instead',
  })
  @IsOptional()
  @IsObject()
  counter?: Record<string, unknown>;

  @ApiPropertyOptional({
    example: 'อนุมัติเองระหว่างโหมดเจ้าของคนเดียว ไม่มีผู้อนุมัติอื่น',
    minLength: 10,
    maxLength: 500,
    description: 'D-449: a Superadmin deciding their own request under solo-owner mode',
  })
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  selfApprovalReason?: string;
}

export class WaterfallViewDto {
  @IdField(P4_IDS.view) id!: string;
  @ApiProperty({ type: UserRefDto }) viewer!: UserRefDto;
  @ApiProperty({ format: 'uuid', example: P3_IDS.quote }) quoteId!: string;
  @ApiProperty({ type: String, nullable: true, example: 'QT-2611-00042' }) quoteCode!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: P4_IDS.approval }) approvalId!:
    string | null;
  @ApiProperty({ enum: WATERFALL_TIERS, enumName: 'SalesWaterfallTier', example: 'full' }) tier!: string;
  @ApiProperty({
    enum: ['view', 'simulate', 'export'],
    enumName: 'SalesWaterfallViewPurpose',
    example: 'view',
  })
  purpose!: string;
  @TimestampField('2026-11-03T10:12:00+07:00') viewedAt!: string;
}

export class WaterfallViewListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid', description: 'One quote' }) @IsOptional() @IsUUID() quoteId?: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'One viewer (staff user)' })
  @IsOptional()
  @IsUUID()
  viewerId?: string;
}

const SUMMARY: DiscountApprovalSummaryDto = {
  id: P4_IDS.approval,
  status: 'pending',
  level: 'sales_manager',
  baseLevel: 'rep',
  authorityLevel: 'amber',
  negotiationHeavy: true,
  requestedPct: '5.00',
  round: 1,
  requestId: P3_IDS.discountRequest,
  agentQuoteId: P3_IDS.agentQuote,
  quote: { id: P3_IDS.quote, quoteCode: 'QT-2611-00042', validUntil: '2026-11-18T23:59:59+07:00' },
  agent: { id: AGENT_IDS.agent, code: 'K7QX2MAP', legalName: 'สมชาย ขายเก่ง', kind: 'freelance' },
  lead: { id: AGENT_IDS.lead, contactName: 'คุณมานี ใจดี', organisationName: 'ร้านกาแฟบ้านสวน' },
  requestedBy: { id: AGENT_IDS.user, displayName: 'สมชาย ขายเก่ง' },
  dueAt: '2026-11-03T14:00:00+07:00',
  overdue: false,
  escalatedAt: null,
  decidedBy: null,
  decidedAt: null,
  validUntil: null,
  createdAt: '2026-11-03T10:00:00+07:00',
};
export const APPROVAL_SUMMARY_EXAMPLE = SUMMARY;
export const APPROVAL_EXAMPLE: DiscountApprovalDto = {
  ...SUMMARY,
  request: { ...DISCOUNT_REQUEST_EXAMPLE, status: 'open', options: [], decidedAt: null },
  waterfall: FULL_WATERFALL_EXAMPLE,
  optionWaterfalls: [],
  decisionNote: null,
  counter: null,
  selfApproved: false,
  priceLocks: [],
};
