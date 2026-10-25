import { ApiStatusLabelAdminTh, ApiStatusLabelTh } from '@common/labels/status-label.decorators';
import { statusLabels } from '@common/labels/status-labels';
import { STORE_CLAIM_OWNERS, storeEnum } from '@common/labels/store-words';
import { NextActionDto } from '@common/next-actions/next-action.dto';
import { PageQuery } from '@common/pagination/pagination.dto';
import { DECISION_CHANNELS } from '@modules/artwork/proofs.dto';
import { OrderCustomerRefDto } from '@modules/orders/orders.dto';
import { ToolingWaiverDto } from '@modules/pricing/quotes/quote.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { LIABILITY_RULES } from './liability';

/** Claims and reorder (D-080, D-082, D-083, D-153; B4.5). */

export const CLAIM_TYPES = [
  'damaged',
  'wrong_spec',
  'print_defect',
  'quantity_short',
  'late',
  'other',
] as const;
export const CLAIM_STATUSES = [
  'submitted',
  'under_review',
  'need_info',
  'factory_review',
  'approved',
  'rejected',
  'resolved',
  'closed',
] as const;
export const RESOLUTION_KINDS = ['reprint', 'partial_refund', 'full_refund', 'credit', 'goodwill'] as const;
export const CLAIM_SEVERITIES = ['minor', 'major', 'critical'] as const;
export const GUARANTEE_REMEDIES = ['reprint', 'refund', 'partial_credit', 'goodwill'] as const;
export const CLAIM_OWNERS = ['getpack', 'customer', 'factory', 'none'] as const;
export const LIABILITIES = ['factory', 'customer', 'carrier', 'getpack', 'undetermined'] as const;
export const CLAIM_ACTIONS = [
  'reproduction_job',
  'refund',
  'credit_note',
  'store_credit',
  'factory_deduction',
  'carrier_recovery',
] as const;
/** D-440: what a store response can carry (factory-named values aliased or absent, `store-words.ts`). */
export const STORE_CLAIM_STATUSES = storeEnum(CLAIM_STATUSES);
/** Recoveries from a factory or a carrier are never on the customer's claim (`claim-views.ts`). */
export const STORE_CLAIM_ACTIONS = CLAIM_ACTIONS.filter(
  (a) => a !== 'factory_deduction' && a !== 'carrier_recovery',
);
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

export const CLAIM_IDS = {
  claim: '0192f3a0-7c1e-7d2a-9b1f-0000000f3001',
  order: '0192f3a0-7c1e-7d2a-9b1f-0000000f1002',
  shipment: '0192f3a0-7c1e-7d2a-9b1f-0000000f2001',
  job: '0192f3a0-7c1e-7d2a-9b1f-0000000f1001',
  factory: '0192f3a0-7c1e-7d2a-9b1f-0000000f1003',
  photo: '0192f3a0-7c1e-7d2a-9b1f-0000000f3002',
  carton: '0192f3a0-7c1e-7d2a-9b1f-0000000f3003',
  payment: '0192f3a0-7c1e-7d2a-9b1f-0000000f3004',
};

/** Photos of each kind one claim takes (technical bound, as `SubmitClaimDto`). */
export const MAX_CLAIM_PHOTOS = 10;

// --- requests ------------------------------------------------------------------------------------------

export class SubmitClaimDto {
  @ApiProperty({ enum: CLAIM_TYPES, enumName: 'ClaimType', example: 'damaged' })
  @IsIn(CLAIM_TYPES)
  type!: (typeof CLAIM_TYPES)[number];

  @ApiProperty({ example: 'กล่องบุบ 2 ลัง สินค้าด้านในเสียหาย', minLength: 5, maxLength: 4000 })
  @IsString()
  @MinLength(5)
  @MaxLength(4000)
  description!: string;

  @ApiProperty({ enum: RESOLUTION_KINDS, enumName: 'ClaimResolutionKind', example: 'reprint' })
  @IsIn(RESOLUTION_KINDS)
  requestedResolution!: (typeof RESOLUTION_KINDS)[number];

  @ApiPropertyOptional({ format: 'uuid', example: CLAIM_IDS.shipment, description: 'The delivery concerned' })
  @IsOptional()
  @IsUUID()
  shipmentId?: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, example: 120 })
  @IsOptional()
  @IsInt()
  @Min(1)
  claimedQuantity?: number;

  @ApiPropertyOptional({ example: '1500.00', description: 'THB, when a refund or credit is asked for' })
  @IsOptional()
  @Matches(MONEY)
  claimedAmount?: string;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    minItems: 1,
    maxItems: 10,
    example: [CLAIM_IDS.photo],
    description: 'Photos of the product (D-082)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CLAIM_PHOTOS)
  @IsUUID('all', { each: true })
  productPhotoFileIds!: string[];

  @ApiProperty({
    type: [String],
    format: 'uuid',
    minItems: 1,
    maxItems: 10,
    example: [CLAIM_IDS.carton],
    description: 'Photos of the shipping cartons (D-082)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CLAIM_PHOTOS)
  @IsUUID('all', { each: true })
  cartonPhotoFileIds!: string[];
}

/** Staff open claims for the customer: same fields, photos optional. */
export class StaffClaimDto {
  @ApiProperty({ enum: CLAIM_TYPES, enumName: 'ClaimType', example: 'damaged' })
  @IsIn(CLAIM_TYPES)
  type!: (typeof CLAIM_TYPES)[number];

  @ApiProperty({ example: 'กล่องบุบ 2 ลัง สินค้าด้านในเสียหาย', minLength: 5, maxLength: 4000 })
  @IsString()
  @MinLength(5)
  @MaxLength(4000)
  description!: string;

  @ApiProperty({ enum: RESOLUTION_KINDS, enumName: 'ClaimResolutionKind', example: 'reprint' })
  @IsIn(RESOLUTION_KINDS)
  requestedResolution!: (typeof RESOLUTION_KINDS)[number];

  @ApiPropertyOptional({ format: 'uuid', example: CLAIM_IDS.shipment, description: 'The delivery concerned' })
  @IsOptional()
  @IsUUID()
  shipmentId?: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, example: 120 })
  @IsOptional()
  @IsInt()
  @Min(1)
  claimedQuantity?: number;

  @ApiPropertyOptional({ example: '1500.00', description: 'THB, when a refund or credit is asked for' })
  @IsOptional()
  @Matches(MONEY)
  claimedAmount?: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    maxItems: 10,
    example: [CLAIM_IDS.photo],
    description: 'Photos of the product (D-082) — optional for staff',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  productPhotoFileIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    maxItems: 10,
    example: [CLAIM_IDS.carton],
    description: 'Photos of the shipping cartons (D-082) — optional for staff',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  cartonPhotoFileIds?: string[];
}

export class ClaimNoteDto {
  @ApiProperty({ example: 'โปรดส่งรูปฉลากข้างกล่องเพิ่มเติม', minLength: 3, maxLength: 2000 })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  note!: string;
}

export class ClaimInfoDto {
  @ApiProperty({ example: 'แนบรูปฉลากข้างกล่องแล้ว', minLength: 1, maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  response!: string;

  @ApiPropertyOptional({ type: [String], format: 'uuid', maxItems: 10, example: [CLAIM_IDS.photo] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  photoFileIds?: string[];
}

export class FactoryClaimResponseDto {
  @ApiProperty({ enum: ['accepted', 'disputed'], enumName: 'FactoryClaimResponse', example: 'accepted' })
  @IsIn(['accepted', 'disputed'])
  response!: 'accepted' | 'disputed';

  @ApiPropertyOptional({ example: 'ยอมรับ จะผลิตทดแทนภายใน 5 วัน', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    maxItems: MAX_CLAIM_PHOTOS,
    description: 'The factory’s own evidence (uploaded files, purpose `evidence`), U-B0.3',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CLAIM_PHOTOS)
  @IsUUID('all', { each: true })
  evidenceFileIds?: string[];
}

export class OverrideLiabilityDto {
  @ApiProperty({ enum: LIABILITIES, enumName: 'ClaimLiability', example: 'customer' })
  @IsIn(LIABILITIES)
  liability!: (typeof LIABILITIES)[number];

  @ApiProperty({ example: 'ตำแหน่งตัวอักษรผิดตามไฟล์ที่ลูกค้าอนุมัติ', minLength: 10, maxLength: 2000 })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;
}

export class DecideClaimDto {
  @ApiProperty({ enum: ['approved', 'rejected'], enumName: 'ClaimDecision', example: 'approved' })
  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  @ApiProperty({ example: 'รูปยืนยันความเสียหายจากการขนส่ง', minLength: 3, maxLength: 2000 })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  note!: string;

  @ApiPropertyOptional({
    enum: CLAIM_SEVERITIES,
    enumName: 'ClaimSeverity',
    example: 'major',
    description: 'Required to approve a claim on getpack’s side (D-261)',
  })
  @IsOptional()
  @IsIn(CLAIM_SEVERITIES)
  severity?: (typeof CLAIM_SEVERITIES)[number];

  @ApiPropertyOptional({
    enum: GUARANTEE_REMEDIES,
    enumName: 'GuaranteeRemedy',
    example: 'reprint',
    description:
      'Default: what the customer asked for; must be allowed by the claim’s guarantee version for its type and ' +
      'severity (D-261); `goodwill` needs `goodwillMemoId` (D-262)',
  })
  @IsOptional()
  @IsIn(GUARANTEE_REMEDIES)
  remedy?: (typeof GUARANTEE_REMEDIES)[number];

  @ApiPropertyOptional({
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000b2004',
    format: 'uuid',
    description: 'An approved discount memo of the customer (goodwill, D-262)',
  })
  @IsOptional()
  @IsUUID()
  goodwillMemoId?: string;
}

export class StoreClaimSlaDto {
  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-23T09:00:00+07:00' })
  responseDueAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-22T11:00:00+07:00' })
  respondedAt!: string | null;

  @ApiProperty({ example: false, description: 'No response yet and past its due time' })
  responseOverdue!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-27T09:00:00+07:00',
    description:
      'Null while getpack waits for the customer’s information (the clock stops, D-263) or once decided',
  })
  decisionDueAt!: string | null;

  @ApiProperty({ example: false })
  decisionOverdue!: boolean;

  @ApiProperty({
    enum: STORE_CLAIM_OWNERS,
    enumName: 'StoreClaimOwner',
    example: 'getpack',
    description: 'Who must act now: getpack (our team), the customer (information), nobody (D-263, D-440)',
  })
  currentOwner!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 1,
    description: 'The guarantee version the claim follows (D-260)',
  })
  guaranteeVersionNo!: number | null;
}

/** Staff and factories: the factory is a party of its own. */
export class ClaimSlaDto extends StoreClaimSlaDto {
  @ApiProperty({
    enum: CLAIM_OWNERS,
    enumName: 'ClaimOwner',
    example: 'getpack',
    description:
      'Who must act now: getpack, the customer (information), the factory (its review), nobody (D-263)',
  })
  declare currentOwner: string;
}

export const CLAIM_TIMELINE_EVENTS = [
  'claim.submitted',
  'claim.under_review',
  'claim.info_requested',
  'claim.info_provided',
  'claim.approved',
  'claim.rejected',
  'claim.resolved',
  'claim.closed',
] as const;

export class ClaimTimelineEventDto {
  @ApiProperty({ enum: CLAIM_TIMELINE_EVENTS, enumName: 'ClaimTimelineEvent', example: 'claim.submitted' })
  type!: (typeof CLAIM_TIMELINE_EVENTS)[number];

  @ApiProperty({ format: 'date-time', example: '2026-10-22T09:00:00+07:00' })
  at!: string;
}

export class ClaimTimelineDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000c101' })
  claimId!: string;

  @ApiProperty({ enum: STORE_CLAIM_STATUSES, enumName: 'StoreClaimStatus', example: 'under_review' })
  status!: string;

  @ApiProperty({ type: StoreClaimSlaDto })
  sla!: StoreClaimSlaDto;

  @ApiProperty({
    type: [ClaimTimelineEventDto],
    description: 'Oldest first; getpack’s internal steps are not shown',
  })
  events!: ClaimTimelineEventDto[];
}

export class ResolutionActionDto {
  @ApiProperty({ enum: CLAIM_ACTIONS, enumName: 'ClaimAction', example: 'reproduction_job' })
  @IsIn(CLAIM_ACTIONS)
  action!: (typeof CLAIM_ACTIONS)[number];

  @ApiPropertyOptional({ example: '1500.00', description: 'THB; required for money actions' })
  @IsOptional()
  @Matches(MONEY)
  amount?: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, example: 120, description: 'Pieces to re-produce' })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    example: CLAIM_IDS.payment,
    description: 'Payment to refund (refund)',
  })
  @IsOptional()
  @IsUUID()
  paymentId?: string;

  @ApiPropertyOptional({ example: 'ผลิตทดแทน 120 ชิ้น', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ResolveClaimDto {
  @ApiProperty({ type: [ResolutionActionDto], minItems: 1, maxItems: 6 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => ResolutionActionDto)
  actions!: ResolutionActionDto[];
}

export class ClaimListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: CLAIM_STATUSES, enumName: 'ClaimStatus' })
  @IsOptional()
  @IsIn(CLAIM_STATUSES)
  status?: (typeof CLAIM_STATUSES)[number];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  orderId?: string;
}

export const CLAIM_ORIGINS = ['customer', 'tolerance_auto', 'staff'] as const;

export class AdminClaimListQuery extends ClaimListQuery {
  @ApiPropertyOptional({ enum: CLAIM_TYPES, enumName: 'ClaimType' })
  @IsOptional()
  @IsIn(CLAIM_TYPES)
  type?: (typeof CLAIM_TYPES)[number];

  @ApiPropertyOptional({ enum: CLAIM_ORIGINS, enumName: 'ClaimOrigin' })
  @IsOptional()
  @IsIn(CLAIM_ORIGINS)
  origin?: (typeof CLAIM_ORIGINS)[number];

  @ApiPropertyOptional({ format: 'uuid', description: 'Claims of this customer' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Claims against this factory' })
  @IsOptional()
  @IsUUID()
  factoryId?: string;
}

export class ReorderOrderDto {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    example: 2000,
    description: 'Default: the past quantity',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({
    example: true,
    description: 'Keep the approved artwork (proof skipped); false to send new artwork',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  reuseArtwork?: boolean;

  @ApiPropertyOptional({
    example: 'Hq3v…',
    maxLength: 100,
    description:
      'From `store.claims.previewReorder` with the same quantity and artwork choice: refused with 409 ' +
      '`orders.reorder_repriced` when today’s price differs from the preview',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  previewToken?: string;
}

export class ReorderPreviewQuery {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    example: 2000,
    description: 'Default: the past quantity',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({ type: Boolean, default: true, example: true })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  reuseArtwork?: boolean;
}

// --- responses -------------------------------------------------------------------------------------------

export class StoreClaimResolutionDto {
  @ApiProperty({ enum: STORE_CLAIM_ACTIONS, enumName: 'StoreClaimAction', example: 'reproduction_job' })
  action!: string;

  @ApiProperty({ nullable: true, example: null })
  amount!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 120 })
  quantity!: number | null;

  @ApiProperty({
    nullable: true,
    example: 'DEVJOB-2610-00002',
    description: 'Re-production job (staff and factory)',
  })
  jobNo!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, example: null })
  refundId!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-25T11:00:00+07:00' })
  executedAt!: string;
}

/** Staff and factories also see the recoveries (factory deduction, carrier recovery). */
export class ClaimResolutionDto extends StoreClaimResolutionDto {
  @ApiProperty({ enum: CLAIM_ACTIONS, enumName: 'ClaimAction', example: 'reproduction_job' })
  declare action: string;
}

export class ClaimPhotosDto {
  @ApiProperty({ type: [String], format: 'uuid', example: [CLAIM_IDS.photo] })
  product!: string[];

  @ApiProperty({ type: [String], format: 'uuid', example: [CLAIM_IDS.carton] })
  carton!: string[];
}

/** The tolerances frozen on the order the claim is judged against (D-021, D-186). */
export class ClaimToleranceDto {
  @ApiProperty({ type: String, nullable: true, example: '5.0000', description: 'Quantity shortage %' })
  shortagePct!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '5.0000', description: 'Quantity overage %' })
  overagePct!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '1.00',
    description: 'Dimensional ± mm (D-186); null = none published, or an order placed before it',
  })
  dimensionalMm!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '3.00',
    description:
      'Colour ΔE2000 against the approved proof (D-186); null = not printed, or an order placed before it',
  })
  colourDeltaE!: string | null;
}

/** The customer's view: no factory, no internal liability reasoning. */
export class StoreClaimDto {
  @ApiProperty({ format: 'uuid', example: CLAIM_IDS.claim })
  id!: string;

  @ApiProperty({ example: 'DEVCL-2610-0001' })
  claimNo!: string;

  @ApiProperty({ format: 'uuid', example: CLAIM_IDS.order })
  orderId!: string;

  @ApiProperty({ example: 'PK-2610-0001-01' })
  orderCode!: string;

  @ApiProperty({ enum: CLAIM_TYPES, enumName: 'ClaimType', example: 'damaged' })
  type!: string;

  @ApiProperty({
    enum: ['customer', 'tolerance_auto', 'staff'],
    enumName: 'ClaimOrigin',
    example: 'customer',
  })
  origin!: string;

  @ApiProperty({ enum: STORE_CLAIM_STATUSES, enumName: 'StoreClaimStatus', example: 'under_review' })
  status!: string;

  @ApiStatusLabelTh('ClaimStatus')
  statusLabelTh!: string;

  @ApiStatusLabelAdminTh('ClaimStatus')
  statusLabelAdminTh!: string;

  @ApiProperty({ example: 'กล่องบุบ 2 ลัง สินค้าด้านในเสียหาย' })
  description!: string;

  @ApiProperty({ enum: RESOLUTION_KINDS, enumName: 'ClaimResolutionKind', example: 'reprint' })
  requestedResolution!: string;

  @ApiProperty({ type: 'integer', nullable: true, example: 120 })
  claimedQuantity!: number | null;

  @ApiProperty({ nullable: true, example: null })
  claimedAmount!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-21T14:05:00+07:00' })
  receivedAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-28T14:05:00+07:00' })
  windowEndsAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-22T09:00:00+07:00' })
  submittedAt!: string;

  @ApiProperty({ nullable: true, example: null, description: 'What getpack asked for (status need_info)' })
  infoRequest!: string | null;

  @ApiProperty({ nullable: true, example: null })
  decisionNote!: string | null;

  @ApiProperty({ type: ClaimPhotosDto })
  photos!: ClaimPhotosDto;

  @ApiProperty({
    type: ClaimToleranceDto,
    description: 'What a wrong-spec, print-defect or quantity claim is judged against (D-186, D-021)',
  })
  tolerance!: ClaimToleranceDto;

  @ApiProperty({ type: [StoreClaimResolutionDto] })
  resolutions!: StoreClaimResolutionDto[];

  @ApiProperty({ enum: CLAIM_SEVERITIES, enumName: 'ClaimSeverity', nullable: true, example: null })
  severity!: (typeof CLAIM_SEVERITIES)[number] | null;

  @ApiProperty({
    enum: GUARANTEE_REMEDIES,
    enumName: 'GuaranteeRemedy',
    nullable: true,
    example: null,
    description: 'The remedy decided (D-261)',
  })
  remedy!: (typeof GUARANTEE_REMEDIES)[number] | null;

  @ApiProperty({ type: StoreClaimSlaDto, description: 'SLA countdowns and the current owner (D-263)' })
  sla!: StoreClaimSlaDto;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'The sample claimed (D-259)',
  })
  sampleId!: string | null;

  @ApiProperty({
    type: [NextActionDto],
    description: 'What the signed-in user may do on the claim now, from the actions’ own checks (U-B0.3)',
  })
  nextActions!: NextActionDto[];
}

/** What getpack recovers from the factory for a claim (D-083): against its payables, else as a receivable. */
export class ClaimDeductionDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000f3007' })
  id!: string;

  @ApiProperty({ example: '500.00' })
  amount!: string;

  @ApiProperty({ enum: ['pending', 'applied', 'cancelled'], enumName: 'DeductionStatus', example: 'applied' })
  status!: string;

  @ApiProperty({ enum: ['payable', 'receivable'], enumName: 'DeductionOffset', example: 'payable' })
  offsetAgainst!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-24T10:00:00+07:00' })
  recordedAt!: string;
}

export class PartnerClaimDto extends StoreClaimDto {
  @ApiProperty({ enum: CLAIM_STATUSES, enumName: 'ClaimStatus', example: 'under_review' })
  declare status: string;

  @ApiProperty({ type: [ClaimResolutionDto] })
  declare resolutions: ClaimResolutionDto[];

  @ApiProperty({ type: ClaimSlaDto, description: 'SLA countdowns and the current owner (D-263)' })
  declare sla: ClaimSlaDto;

  @ApiProperty({ format: 'uuid', nullable: true, example: CLAIM_IDS.job })
  jobId!: string | null;

  @ApiProperty({ nullable: true, example: 'DEVJOB-2610-00001' })
  jobNo!: string | null;

  @ApiProperty({ enum: LIABILITIES, enumName: 'ClaimLiability', example: 'factory' })
  liability!: string;

  @ApiProperty({
    enum: ['accepted', 'disputed'],
    enumName: 'FactoryClaimResponse',
    nullable: true,
    example: null,
  })
  factoryResponse!: string | null;

  @ApiProperty({ nullable: true, example: null })
  factoryResponseNote!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  factoryRespondedAt!: string | null;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    example: [],
    description: 'Files the factory attached to its response',
  })
  factoryEvidenceFileIds!: string[];

  @ApiProperty({ type: String, nullable: true, example: 'SH-2610-0001' })
  shipmentNo!: string | null;

  @ApiProperty({
    example: '0.00',
    description: 'Recovered from the factory for this claim (cancelled ones left out)',
  })
  deductionAmount!: string;

  @ApiProperty({ type: [ClaimDeductionDto] })
  deductions!: ClaimDeductionDto[];
}

/** The proof the customer approved for the order: evidence for errors in approved artwork (D-083). */
export class ClaimApprovedProofDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000f3004' })
  id!: string;

  @ApiProperty({ type: 'integer', example: 2 })
  versionNo!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-10T10:00:00+07:00' })
  approvedAt!: string | null;

  @ApiProperty({ enum: DECISION_CHANNELS, enumName: 'DecisionChannel', nullable: true, example: 'web' })
  channel!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000f3005',
    description: 'The locked copy of the approved file',
  })
  approvedFileId!: string | null;
}

export class AdminClaimDto extends PartnerClaimDto {
  @ApiProperty({ enum: LIABILITIES, enumName: 'ClaimLiability', example: 'factory' })
  liabilityByRule!: string;

  @ApiProperty({
    nullable: true,
    example: null,
    description: 'Why the rule’s liability was overridden (D-083)',
  })
  overrideReason!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, example: CLAIM_IDS.factory })
  factoryId!: string | null;

  @ApiProperty({ nullable: true, example: 'F-0001' })
  factoryCode!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, example: CLAIM_IDS.shipment })
  shipmentId!: string | null;

  @ApiProperty({ nullable: true, example: null })
  infoResponse!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, example: null })
  decidedAt!: string | null;

  @ApiProperty({ type: OrderCustomerRefDto })
  customer!: OrderCustomerRefDto;

  @ApiProperty({
    enum: LIABILITY_RULES,
    enumName: 'ClaimLiabilityRule',
    example: 'factory_production',
    description:
      'The D-083 rule behind `liabilityByRule`: factory_production (wrong spec, print defect), ' +
      'factory_short_delivery, factory_fleet_transit / carrier_transit (damage by who shipped), staff_decides ' +
      '(late, other)',
  })
  liabilityRule!: string;

  @ApiProperty({ type: UserRefDto, nullable: true, description: 'Who overrode the rule’s liability' })
  liabilityOverriddenBy!: UserRefDto | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  decidedBy!: UserRefDto | null;

  @ApiProperty({
    type: ClaimApprovedProofDto,
    nullable: true,
    description: 'Null when no proof was approved',
  })
  approvedProof!: ClaimApprovedProofDto | null;
}

const BASE = {
  id: CLAIM_IDS.claim,
  claimNo: 'DEVCL-2610-0001',
  orderId: CLAIM_IDS.order,
  orderCode: 'PK-2610-0001-01',
  type: 'damaged',
  origin: 'customer',
  status: 'under_review',
  ...statusLabels('ClaimStatus', 'under_review'),
  description: 'กล่องบุบ 2 ลัง สินค้าด้านในเสียหาย',
  requestedResolution: 'reprint',
  claimedQuantity: 120,
  claimedAmount: null,
  receivedAt: '2026-10-21T14:05:00+07:00',
  windowEndsAt: '2026-10-28T14:05:00+07:00',
  submittedAt: '2026-10-22T09:00:00+07:00',
  infoRequest: null,
  decisionNote: null,
  photos: { product: [CLAIM_IDS.photo], carton: [CLAIM_IDS.carton] },
  tolerance: { shortagePct: '5.0000', overagePct: '5.0000', dimensionalMm: '1.00', colourDeltaE: '3.00' },
  resolutions: [],
  severity: null,
  remedy: null,
  sla: {
    responseDueAt: '2026-10-23T09:00:00+07:00',
    respondedAt: '2026-10-22T11:00:00+07:00',
    responseOverdue: false,
    decisionDueAt: '2026-10-27T09:00:00+07:00',
    decisionOverdue: false,
    currentOwner: 'getpack',
    guaranteeVersionNo: 1,
  },
  sampleId: null,
  nextActions: [] as NextActionDto[],
};
export const STORE_CLAIM_EXAMPLE = BASE;
export const PARTNER_CLAIM_EXAMPLE = {
  ...BASE,
  status: 'factory_review',
  ...statusLabels('ClaimStatus', 'factory_review'),
  jobId: CLAIM_IDS.job,
  jobNo: 'DEVJOB-2610-00001',
  liability: 'factory',
  factoryResponse: null,
  factoryResponseNote: null,
  factoryRespondedAt: null,
  factoryEvidenceFileIds: [],
  shipmentNo: 'SH-2610-0001',
  deductionAmount: '0.00',
  deductions: [],
};
export const ADMIN_CLAIM_EXAMPLE = {
  ...PARTNER_CLAIM_EXAMPLE,
  status: 'under_review',
  ...statusLabels('ClaimStatus', 'under_review'),
  liabilityByRule: 'factory',
  overrideReason: null,
  factoryId: CLAIM_IDS.factory,
  factoryCode: 'F-0001',
  shipmentId: CLAIM_IDS.shipment,
  infoResponse: null,
  decidedAt: null,
  customer: {
    id: '0192f3a0-7c1e-7d2a-9b1f-0000000f3006',
    customerCode: 'CU-000042',
    displayName: 'สมชาย ทดสอบ',
    companyName: null,
  },
  liabilityRule: 'factory_production',
  liabilityOverriddenBy: null,
  decidedBy: null,
  approvedProof: {
    id: '0192f3a0-7c1e-7d2a-9b1f-0000000f3004',
    versionNo: 2,
    approvedAt: '2026-10-10T10:00:00+07:00',
    channel: 'web',
    approvedFileId: '0192f3a0-7c1e-7d2a-9b1f-0000000f3005',
  },
};
export const RESOLVED_EXAMPLE = {
  ...ADMIN_CLAIM_EXAMPLE,
  status: 'resolved',
  ...statusLabels('ClaimStatus', 'resolved'),
  decidedAt: '2026-10-24T10:00:00+07:00',
  resolutions: [
    {
      action: 'reproduction_job',
      amount: null,
      quantity: 120,
      jobNo: 'DEVJOB-2610-00002',
      refundId: null,
      executedAt: '2026-10-25T11:00:00+07:00',
    },
  ],
};

// --- claim form (U-B0.1) ---------------------------------------------------------------------------------

export class ClaimFormShipmentDto {
  @ApiProperty({ format: 'uuid', example: CLAIM_IDS.shipment })
  id!: string;

  @ApiProperty({ example: 'SH-2610-0001' })
  shipmentNo!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-20T14:00:00+07:00' })
  deliveredAt!: string;

  @ApiProperty({ type: 'integer', example: 1000, description: 'Quantity of this order in the delivery' })
  quantity!: number;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 1000,
    description: 'As counted at delivery, when recorded',
  })
  deliveredQuantity!: number | null;

  @ApiProperty({
    format: 'date-time',
    example: '2026-10-27T14:00:00+07:00',
    description: 'Last moment to claim it',
  })
  windowEndsAt!: string;

  @ApiProperty({ example: true })
  open!: boolean;
}

export class ClaimEvidenceRulesDto {
  @ApiProperty({ example: 'evidence', description: 'File purpose to presign photo uploads with' })
  purpose!: string;

  @ApiProperty({ type: [String], example: ['image/png', 'image/jpeg', 'image/webp'] })
  accept!: string[];

  @ApiProperty({ type: 'integer', example: 104857600 })
  maxBytes!: number;

  @ApiProperty({ type: 'integer', example: 1, description: 'Photos of the product required (D-082)' })
  productPhotosMin!: number;

  @ApiProperty({ type: 'integer', example: MAX_CLAIM_PHOTOS })
  productPhotosMax!: number;

  @ApiProperty({
    type: 'integer',
    example: 1,
    description: 'Photos of the shipping cartons required (D-082)',
  })
  cartonPhotosMin!: number;

  @ApiProperty({ type: 'integer', example: MAX_CLAIM_PHOTOS })
  cartonPhotosMax!: number;
}

/** What the claim form of one of my orders needs (D-082): the window, the deliveries and the evidence rules. */
export class ClaimFormDto {
  @ApiProperty({ format: 'uuid', example: CLAIM_IDS.order })
  orderId!: string;

  @ApiProperty({ example: 'PK-2610-0001-01' })
  orderCode!: string;

  @ApiProperty({ type: 'integer', example: 1000 })
  quantityOrdered!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-20T14:00:00+07:00' })
  deliveredAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-27T14:00:00+07:00',
    description: 'Receipt + `claims.window_days` (D-082); the latest window of the deliveries',
  })
  windowEndsAt!: string | null;

  @ApiProperty({ example: true, description: 'A claim can be submitted now' })
  open!: boolean;

  @ApiProperty({
    enum: ['not_delivered', 'window_closed'],
    enumName: 'ClaimFormClosedReason',
    nullable: true,
    example: null,
  })
  closedReason!: 'not_delivered' | 'window_closed' | null;

  @ApiProperty({ enum: CLAIM_TYPES, enumName: 'ClaimType', isArray: true, example: [...CLAIM_TYPES] })
  types!: string[];

  @ApiProperty({
    enum: RESOLUTION_KINDS,
    enumName: 'ClaimResolutionKind',
    isArray: true,
    example: [...RESOLUTION_KINDS],
  })
  resolutions!: string[];

  @ApiProperty({
    type: [ClaimFormShipmentDto],
    description: 'Delivered shipments of the order (no addresses)',
  })
  shipments!: ClaimFormShipmentDto[];

  @ApiProperty({ type: ClaimEvidenceRulesDto })
  evidence!: ClaimEvidenceRulesDto;
}

export const CLAIM_FORM_EXAMPLE: ClaimFormDto = {
  orderId: CLAIM_IDS.order,
  orderCode: 'PK-2610-0001-01',
  quantityOrdered: 1000,
  deliveredAt: '2026-10-20T14:00:00+07:00',
  windowEndsAt: '2026-10-27T14:00:00+07:00',
  open: true,
  closedReason: null,
  types: [...CLAIM_TYPES],
  resolutions: [...RESOLUTION_KINDS],
  shipments: [
    {
      id: CLAIM_IDS.shipment,
      shipmentNo: 'SH-2610-0001',
      deliveredAt: '2026-10-20T14:00:00+07:00',
      quantity: 1000,
      deliveredQuantity: 1000,
      windowEndsAt: '2026-10-27T14:00:00+07:00',
      open: true,
    },
  ],
  evidence: {
    purpose: 'evidence',
    accept: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/quicktime'],
    maxBytes: 104857600,
    productPhotosMin: 1,
    productPhotosMax: MAX_CLAIM_PHOTOS,
    cartonPhotosMin: 1,
    cartonPhotosMax: MAX_CLAIM_PHOTOS,
  },
};

// --- reorder preview (U-B0.1, D-153) -------------------------------------------------------------------

export class ReorderQuantityLimitsDto {
  @ApiProperty({ type: 'integer', nullable: true, example: 500 })
  min!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 100000 })
  max!: number | null;
}

/** Today's price of reordering one of my orders (D-153): nothing is saved until the reorder is added. */
export class ReorderPreviewDto {
  @ApiProperty({ format: 'uuid', example: CLAIM_IDS.order })
  orderId!: string;

  @ApiProperty({ example: 'PK-2610-0001-01' })
  orderCode!: string;

  @ApiProperty({ type: 'integer', example: 2000 })
  quantity!: number;

  @ApiProperty({ type: 'integer', example: 1000, description: 'The quantity of the past order' })
  previousQuantity!: number;

  @ApiProperty({ type: ReorderQuantityLimitsDto, description: 'Of the catalogue product (null: no limit)' })
  quantityLimits!: ReorderQuantityLimitsDto;

  @ApiProperty({ example: '4.250000' })
  unitPrice!: string;

  @ApiProperty({ example: '8500.00' })
  productAmount!: string;

  @ApiProperty({ example: '0.00' })
  designFeeAmount!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Plates and die blocks, incl. VAT',
  })
  toolingAmount!: string | null;

  @ApiProperty({
    type: ToolingWaiverDto,
    nullable: true,
    description:
      'The factory keeps the plates / die block of an earlier order of this specification: not charged again (D-289)',
  })
  toolingWaiver!: ToolingWaiverDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '535.00',
    description: 'Null while shipping is not priced',
  })
  shippingAmount!: string | null;

  @ApiProperty({ example: '630.00' })
  vatAmount!: string;

  @ApiProperty({ example: '9630.00' })
  grossAmount!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ type: 'integer', nullable: true, example: 7 })
  leadTimeDays!: number | null;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-11-10' })
  earliestShipDate!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-11-12' })
  earliestDeliveryDate!: string | null;

  @ApiProperty({
    example: true,
    description: 'The approved artwork carries over and no new proof is needed (D-153)',
  })
  proofSkipped!: boolean;

  @ApiProperty({ example: 'Hq3v…', description: 'Send with the reorder to be warned if the price changes' })
  previewToken!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-30T10:30:00+07:00' })
  previewExpiresAt!: string;
}

export const REORDER_PREVIEW_EXAMPLE: ReorderPreviewDto = {
  orderId: CLAIM_IDS.order,
  orderCode: 'PK-2610-0001-01',
  quantity: 2000,
  previousQuantity: 1000,
  quantityLimits: { min: 500, max: 100000 },
  unitPrice: '4.250000',
  productAmount: '8500.00',
  designFeeAmount: '0.00',
  toolingAmount: null,
  toolingWaiver: null,
  shippingAmount: '535.00',
  vatAmount: '630.00',
  grossAmount: '9630.00',
  currency: 'THB',
  leadTimeDays: 7,
  earliestShipDate: '2026-11-10',
  earliestDeliveryDate: '2026-11-12',
  proofSkipped: true,
  previewToken: 'Hq3v…',
  previewExpiresAt: '2026-10-30T10:30:00+07:00',
};

// --- company bulk reorder (U-B0.1, D-153) --------------------------------------------------------------

/** Rows one bulk reorder takes (technical bound: each row is priced). */
export const MAX_BULK_REORDER_ROWS = 100;

export class BulkReorderRowDto {
  @ApiProperty({ type: 'integer', minimum: 1, example: 2, description: 'The row of the uploaded sheet' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  line!: number;

  @ApiProperty({ example: 'PK-2610-0001-01', maxLength: 40 })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  orderCode!: string;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    example: 2000,
    description: 'Default: the past quantity',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;
}

export class BulkReorderPreviewRequestDto {
  @ApiProperty({ type: [BulkReorderRowDto], minItems: 1, maxItems: MAX_BULK_REORDER_ROWS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_REORDER_ROWS)
  @ValidateNested({ each: true })
  @Type(() => BulkReorderRowDto)
  rows!: BulkReorderRowDto[];
}

export class BulkReorderPreviewRowDto {
  @ApiProperty({ type: 'integer', example: 2 })
  line!: number;

  @ApiProperty({ example: 'PK-2610-0001-01' })
  orderCode!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: CLAIM_IDS.order })
  orderId!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 2000 })
  quantity!: number | null;

  @ApiProperty({ enum: ['ok', 'refused'], enumName: 'BulkReorderRowStatus', example: 'ok' })
  status!: 'ok' | 'refused';

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description:
      'Why the row cannot be reordered: an error code (e.g. `orders.not_found`, `orders.reorder_unavailable`)',
  })
  reason!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '4.250000' })
  unitPrice!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '9630.00', description: 'Today’s price incl. VAT' })
  grossAmount!: string | null;

  @ApiProperty({ example: true, description: 'The approved artwork carries over (D-153)' })
  proofSkipped!: boolean;
}

export class BulkReorderPreviewDto {
  @ApiProperty({ type: [BulkReorderPreviewRowDto] })
  rows!: BulkReorderPreviewRowDto[];

  @ApiProperty({ type: 'integer', example: 1 })
  okCount!: number;

  @ApiProperty({ type: 'integer', example: 0 })
  refusedCount!: number;

  @ApiProperty({ example: '9630.00', description: 'Sum of the rows that can be reordered' })
  grossAmount!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Hq3v…',
    description: 'Null when no row can be reordered',
  })
  previewToken!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-30T10:30:00+07:00' })
  previewExpiresAt!: string | null;
}

export class BulkReorderAddDto {
  @ApiProperty({ example: 'Hq3v…', maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  previewToken!: string;
}

export class BulkReorderAddedDto {
  @ApiProperty({ type: 'integer', example: 2 })
  line!: number;

  @ApiProperty({ example: 'PK-2610-0001-01' })
  orderCode!: string;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000f3010' })
  cartItemId!: string;
}

export class BulkReorderFailedDto {
  @ApiProperty({ type: 'integer', example: 3 })
  line!: number;

  @ApiProperty({ example: 'PK-2610-0002-01' })
  orderCode!: string;

  @ApiProperty({ example: 'cart.item_exists' })
  code!: string;
}

export class BulkReorderResultDto {
  @ApiProperty({ type: [BulkReorderAddedDto] })
  added!: BulkReorderAddedDto[];

  @ApiProperty({ type: [BulkReorderFailedDto], description: 'Rows the cart refused; the others were added' })
  failed!: BulkReorderFailedDto[];
}

export const BULK_PREVIEW_EXAMPLE: BulkReorderPreviewDto = {
  rows: [
    {
      line: 2,
      orderCode: 'PK-2610-0001-01',
      orderId: CLAIM_IDS.order,
      quantity: 2000,
      status: 'ok',
      reason: null,
      unitPrice: '4.250000',
      grossAmount: '9630.00',
      proofSkipped: true,
    },
    {
      line: 3,
      orderCode: 'PK-2610-0099-01',
      orderId: null,
      quantity: 500,
      status: 'refused',
      reason: 'orders.not_found',
      unitPrice: null,
      grossAmount: null,
      proofSkipped: false,
    },
  ],
  okCount: 1,
  refusedCount: 1,
  grossAmount: '9630.00',
  currency: 'THB',
  previewToken: 'Hq3v…',
  previewExpiresAt: '2026-10-30T10:30:00+07:00',
};
