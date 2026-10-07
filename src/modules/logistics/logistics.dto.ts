import { ApiStatusLabelAdminTh, ApiStatusLabelTh } from '@common/labels/status-label.decorators';
import { statusLabels } from '@common/labels/status-labels';
import { NextActionDto } from '@common/next-actions/next-action.dto';
import { PageQuery } from '@common/pagination/pagination.dto';
import { GeoRefDto } from '@modules/customers/customers.dto';
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
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Shipments, proofs of delivery and delivery reconciliation (D-013, D-021, D-080, D-081, D-114, D-142). */

export const SHIPMENT_STATUSES = [
  'draft',
  'ready',
  'picked_up',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'failed',
  'returned',
  'cancelled',
] as const;
export type ShipmentStatusValue = (typeof SHIPMENT_STATUSES)[number];
/** What a factory (own fleet) or staff report between pickup and delivery; delivery itself needs a POD. */
export const TRANSIT_STATUSES = ['in_transit', 'out_for_delivery', 'failed', 'returned'] as const;
export const CARRIER_CODES = ['factory_fleet', 'flash_express', 'deliveree'] as const;
export const FALLBACK_CARRIERS = ['flash_express', 'deliveree'] as const;
/** Staff work queues (U-B0.2): pickup, transit, delivery exceptions (D-230) and POD reviews (D-229). */
export const SHIPMENT_QUEUES = ['awaiting_pickup', 'in_transit', 'exceptions', 'pod_review'] as const;
export const EXCEPTION_RESOLUTIONS = ['retry', 'return', 'cancel'] as const;
export const TOLERANCE_OUTCOMES = [
  'exact',
  'shortage_within',
  'overage_within',
  'shortage_outside',
  'overage_outside',
] as const;

export const SHIPMENT_IDS = {
  shipment: '0192f3a0-7c1e-7d2a-9b1f-0000000f2001',
  job: '0192f3a0-7c1e-7d2a-9b1f-0000000f1001',
  order: '0192f3a0-7c1e-7d2a-9b1f-0000000f1002',
  factory: '0192f3a0-7c1e-7d2a-9b1f-0000000f1003',
  destination: '0192f3a0-7c1e-7d2a-9b1f-0000000f2002',
  label: '0192f3a0-7c1e-7d2a-9b1f-0000000f2003',
  packingList: '0192f3a0-7c1e-7d2a-9b1f-0000000f2004',
  photo: '0192f3a0-7c1e-7d2a-9b1f-0000000f2005',
  signature: '0192f3a0-7c1e-7d2a-9b1f-0000000f2006',
};

// --- requests ------------------------------------------------------------------------------------------

export class ShipmentItemInputDto {
  @ApiProperty({
    format: 'uuid',
    example: SHIPMENT_IDS.job,
    description: 'The completed job whose goods ship',
  })
  @IsUUID()
  jobId!: string;

  @ApiProperty({
    format: 'uuid',
    example: SHIPMENT_IDS.destination,
    description: 'A delivery destination of the job’s order (`destinations[].id` of the job)',
  })
  @IsUUID()
  destinationId!: string;

  @ApiProperty({ type: 'integer', minimum: 1, example: 600 })
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateShipmentDto {
  @ApiProperty({
    type: [ShipmentItemInputDto],
    minItems: 1,
    maxItems: 50,
    description: 'Everything on this trip; all destinations must be the same address (one trip, one address)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ShipmentItemInputDto)
  items!: ShipmentItemInputDto[];

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 500, example: 3, description: 'One label per carton' })
  @IsInt()
  @Min(1)
  @Max(500)
  cartonsCount!: number;

  @ApiProperty({ type: 'integer', minimum: 1, example: 18000, description: 'Total weight in grams' })
  @IsInt()
  @Min(1)
  weightG!: number;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, example: 120000, description: 'Total volume in cm³' })
  @IsOptional()
  @IsInt()
  @Min(1)
  volumeCm3?: number;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-20' })
  @IsOptional()
  @IsISO8601({ strict: true })
  plannedShipOn?: string;

  @ApiPropertyOptional({ example: 'ส่งช่วงเช้า', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ShipmentStatusUpdateDto {
  @ApiProperty({ enum: TRANSIT_STATUSES, enumName: 'ShipmentTransitStatus', example: 'in_transit' })
  @IsIn(TRANSIT_STATUSES)
  status!: (typeof TRANSIT_STATUSES)[number];

  @ApiPropertyOptional({ format: 'date-time', example: '2026-10-20T09:30:00+07:00' })
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

  @ApiPropertyOptional({ example: 'ถึงศูนย์กระจายสินค้าบางนา', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @ApiPropertyOptional({ example: 'ผู้รับไม่อยู่ นัดส่งใหม่พรุ่งนี้', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class CancelShipmentDto {
  @ApiProperty({ example: 'รวมกับรอบส่งถัดไป', minLength: 3, maxLength: 400 })
  @IsString()
  @MinLength(3)
  @MaxLength(400)
  reason!: string;
}

export class BookCarrierDto {
  @ApiProperty({ enum: FALLBACK_CARRIERS, enumName: 'FallbackCarrier', example: 'flash_express' })
  @IsIn(FALLBACK_CARRIERS)
  carrier!: (typeof FALLBACK_CARRIERS)[number];

  @ApiPropertyOptional({ format: 'date-time', example: '2026-10-20T10:00:00+07:00' })
  @IsOptional()
  @IsISO8601()
  pickupAt?: string;

  @ApiPropertyOptional({
    example: 'โรงงานไม่มีรถวิ่งเชียงราย',
    minLength: 3,
    maxLength: 400,
    description: 'Why the factory’s fleet cannot serve (kept on the event and the audit trail)',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(400)
  reason?: string;
}

export class ResolveShipmentExceptionDto {
  @ApiProperty({
    enum: EXCEPTION_RESOLUTIONS,
    enumName: 'ShipmentExceptionResolution',
    example: 'retry',
    description: 'failed: retry | return; returned: retry | cancel (D-230)',
  })
  @IsIn(EXCEPTION_RESOLUTIONS)
  resolution!: (typeof EXCEPTION_RESOLUTIONS)[number];

  @ApiProperty({ example: 'ลูกค้านัดรับใหม่พรุ่งนี้', minLength: 3, maxLength: 400 })
  @IsString()
  @MinLength(3)
  @MaxLength(400)
  reason!: string;
}

export class SplitItemDto {
  @ApiProperty({ format: 'uuid', example: SHIPMENT_IDS.destination })
  @IsUUID()
  destinationId!: string;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    example: 200,
    description: 'Pieces that move to the new shipment',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class SplitShipmentDto {
  @ApiProperty({ type: [SplitItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SplitItemDto)
  items!: SplitItemDto[];

  @ApiProperty({ type: 'integer', minimum: 1, example: 1, description: 'Cartons of the new shipment' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cartonsCount!: number;

  @ApiProperty({ type: 'integer', minimum: 1, example: 6000, description: 'Weight of the new shipment (g)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  weightG!: number;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, example: 40000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  volumeCm3?: number;

  @ApiProperty({ example: 'แยกส่งสองรอบ รถเล็ก', minLength: 3, maxLength: 400 })
  @IsString()
  @MinLength(3)
  @MaxLength(400)
  reason!: string;
}

export class ReviewPodDto {
  @ApiPropertyOptional({
    example: 'ลายเซ็นไม่ชัด',
    minLength: 3,
    maxLength: 500,
    description: 'Required to reject (D-229)',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  note?: string;
}

export class PodItemDto {
  @ApiProperty({ format: 'uuid', example: SHIPMENT_IDS.destination })
  @IsUUID()
  destinationId!: string;

  @ApiProperty({ type: 'integer', minimum: 0, example: 590, description: 'Pieces the receiver accepted' })
  @IsInt()
  @Min(0)
  deliveredQuantity!: number;
}

export class RecordPodDto {
  @ApiProperty({ example: 'สมหญิง ใจดี', minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  receiverName!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: SHIPMENT_IDS.signature,
    description: 'Signature image (evidence upload); required for a factory delivery (D-013)',
  })
  @IsOptional()
  @IsUUID()
  signatureFileId?: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    maxItems: 10,
    example: [SHIPMENT_IDS.photo],
    description: 'Delivery photos (evidence uploads); at least one for a factory delivery (D-013)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  photoFileIds?: string[];

  @ApiProperty({
    type: [PodItemDto],
    minItems: 1,
    description: 'Delivered pieces per destination on the trip',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PodItemDto)
  items!: PodItemDto[];

  @ApiPropertyOptional({ format: 'date-time', example: '2026-10-21T14:05:00+07:00' })
  @IsOptional()
  @IsISO8601()
  capturedAt?: string;

  @ApiPropertyOptional({ type: 'number', example: 13.7563 })
  @IsOptional()
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ type: 'number', example: 100.5018 })
  @IsOptional()
  @IsLongitude()
  lng?: number;

  @ApiPropertyOptional({
    example: 'FLASH-POD-7781',
    maxLength: 200,
    description: 'Staff only: the carrier’s POD reference (a carrier delivery)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  carrierPodRef?: string;

  @ApiPropertyOptional({ example: 'กล่องที่ 2 มุมบุบเล็กน้อย', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ShipmentListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: SHIPMENT_STATUSES, enumName: 'ShipmentStatus' })
  @IsOptional()
  @IsIn(SHIPMENT_STATUSES)
  status?: ShipmentStatusValue;

  @ApiPropertyOptional({ format: 'uuid', description: 'Shipments carrying this order' })
  @IsOptional()
  @IsUUID()
  orderId?: string;
}

export class AdminShipmentListQuery extends ShipmentListQuery {
  @ApiPropertyOptional({
    enum: SHIPMENT_QUEUES,
    enumName: 'ShipmentQueue',
    description:
      'awaiting_pickup = packed; in_transit = picked up, in transit or out for delivery; exceptions = failed, or ' +
      'returned and not closed (D-230); pod_review = delivered with a POD not reviewed yet (D-229)',
  })
  @IsOptional()
  @IsIn(SHIPMENT_QUEUES)
  queue?: (typeof SHIPMENT_QUEUES)[number];

  @ApiPropertyOptional({ enum: CARRIER_CODES, enumName: 'CarrierCode' })
  @IsOptional()
  @IsIn(CARRIER_CODES)
  carrier?: (typeof CARRIER_CODES)[number];

  @ApiPropertyOptional({ format: 'uuid', description: 'The shipping factory' })
  @IsOptional()
  @IsUUID()
  factoryId?: string;
}

// --- responses -----------------------------------------------------------------------------------------

export class ShipmentItemDto {
  @ApiProperty({ format: 'uuid', example: SHIPMENT_IDS.destination })
  destinationId!: string;

  @ApiProperty({ format: 'uuid', example: SHIPMENT_IDS.job })
  jobId!: string;

  @ApiProperty({ example: 'JOB-2610-0001' })
  jobNo!: string;

  @ApiProperty({ example: 'PK-2610-0001-01' })
  orderCode!: string;

  @ApiProperty({ type: 'integer', example: 600 })
  quantity!: number;

  @ApiProperty({ type: 'integer', nullable: true, example: null })
  deliveredQuantity!: number | null;

  @ApiProperty({
    enum: TOLERANCE_OUTCOMES,
    enumName: 'ToleranceOutcome',
    nullable: true,
    example: null,
    description:
      'The order’s delivered-vs-ordered result once every shipment of it is delivered (D-021, D-080)',
  })
  toleranceOutcome!: string | null;
}

export class ShipmentEventDto {
  @ApiProperty({ format: 'date-time', example: '2026-10-20T09:30:00+07:00' })
  occurredAt!: string;

  @ApiProperty({ enum: SHIPMENT_STATUSES, enumName: 'ShipmentStatus', example: 'in_transit' })
  status!: ShipmentStatusValue;

  @ApiStatusLabelTh('ShipmentStatus')
  statusLabelTh!: string;

  @ApiStatusLabelAdminTh('ShipmentStatus')
  statusLabelAdminTh!: string;

  @ApiProperty({
    enum: ['factory', 'carrier_webhook', 'carrier_poll', 'staff'],
    enumName: 'ShipmentEventSource',
  })
  source!: string;

  @ApiProperty({ nullable: true, example: 'ศูนย์กระจายสินค้าบางนา' })
  location!: string | null;

  @ApiProperty({ nullable: true, example: null })
  note!: string | null;
}

export class ProofOfDeliveryDto {
  @ApiProperty({ enum: ['factory_photo_signature', 'carrier_pod'], enumName: 'PodKind' })
  kind!: string;

  @ApiProperty({ example: 'สมหญิง ใจดี' })
  receiverName!: string;

  @ApiProperty({ type: 'integer', example: 590 })
  deliveredQuantity!: number;

  @ApiProperty({ format: 'date-time', example: '2026-10-21T14:05:00+07:00' })
  capturedAt!: string;

  @ApiProperty({ format: 'uuid', nullable: true, example: SHIPMENT_IDS.signature })
  signatureFileId!: string | null;

  @ApiProperty({ type: [String], format: 'uuid', example: [SHIPMENT_IDS.photo] })
  photoFileIds!: string[];

  @ApiProperty({ nullable: true, example: null })
  carrierPodRef!: string | null;
}

export class ShipmentDestinationDto {
  @ApiProperty({ example: 'สมหญิง ใจดี' })
  recipientName!: string;

  @ApiProperty({ example: '+66810001234' })
  phone!: string;

  @ApiProperty({ example: '99/9 ถนนสุขุมวิท' })
  line1!: string;

  @ApiProperty({ nullable: true, example: 'แขวงคลองตัน เขตคลองเตย' })
  line2!: string | null;

  @ApiProperty({ example: '10110' })
  postcode!: string;

  @ApiProperty({ type: GeoRefDto })
  province!: GeoRefDto;
}

export class ShipmentCartonDto {
  @ApiProperty({ type: 'integer', example: 1 })
  seq!: number;

  @ApiProperty({ example: '9F3A0C1B2D4E-01', description: 'Printed on the carton label (QR → tracking)' })
  labelCode!: string;

  @ApiProperty({ type: 'integer', nullable: true, example: null })
  weightG!: number | null;
}

export class CarrierRequestDto {
  @ApiProperty({ format: 'date-time', example: '2026-10-19T17:00:00+07:00' })
  requestedAt!: string;

  @ApiProperty({ example: 'รถโรงงานไม่วิ่งเชียงราย' })
  reason!: string;
}

/** `{ reason }` (3–400 characters), the shape of a cancellation reason. */
export const RequestCarrierDto = CancelShipmentDto;
export type RequestCarrierDto = CancelShipmentDto;

/** The factory's view (D-142): destination contacts, no price, no customer identity beyond the recipient. */
export class PartnerShipmentDto {
  @ApiProperty({ format: 'uuid', example: SHIPMENT_IDS.shipment })
  id!: string;

  @ApiProperty({ example: 'SH-2610-0001' })
  shipmentNo!: string;

  @ApiProperty({ enum: SHIPMENT_STATUSES, enumName: 'ShipmentStatus', example: 'ready' })
  status!: ShipmentStatusValue;

  @ApiStatusLabelTh('ShipmentStatus')
  statusLabelTh!: string;

  @ApiStatusLabelAdminTh('ShipmentStatus')
  statusLabelAdminTh!: string;

  @ApiProperty({ enum: CARRIER_CODES, enumName: 'CarrierCode', example: 'factory_fleet' })
  carrier!: string;

  @ApiProperty({ nullable: true, example: null })
  trackingNo!: string | null;

  @ApiProperty({ type: ShipmentDestinationDto })
  destination!: ShipmentDestinationDto;

  @ApiProperty({ type: 'integer', example: 3 })
  cartonsCount!: number;

  @ApiProperty({ type: 'integer', example: 18000 })
  weightG!: number;

  @ApiProperty({ type: 'integer', nullable: true, example: 120000 })
  volumeCm3!: number | null;

  @ApiProperty({ format: 'date', nullable: true, example: '2026-10-20' })
  plannedShipOn!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, example: '2026-10-19T16:00:00+07:00' })
  readyAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, example: null })
  pickedUpAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, example: null })
  deliveredAt!: string | null;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    example: SHIPMENT_IDS.label,
    description: 'Carton labels PDF',
  })
  labelFileId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, example: SHIPMENT_IDS.packingList })
  packingListFileId!: string | null;

  @ApiProperty({ type: [ShipmentItemDto] })
  items!: ShipmentItemDto[];

  @ApiProperty({ type: [ShipmentEventDto] })
  events!: ShipmentEventDto[];

  @ApiProperty({ type: ProofOfDeliveryDto, nullable: true })
  proofOfDelivery!: ProofOfDeliveryDto | null;

  @ApiProperty({ nullable: true, example: null })
  note!: string | null;

  @ApiProperty({
    type: [ShipmentCartonDto],
    description: 'One per carton once packed (label code on the carton)',
  })
  cartons!: ShipmentCartonDto[];

  @ApiProperty({
    example: false,
    description: 'Not picked up yet and an order still owes instalments due before shipping (B3.2)',
  })
  blockedByPayment!: boolean;

  @ApiProperty({
    type: CarrierRequestDto,
    nullable: true,
    description: 'The factory asked Packio for a fallback carrier (D-013, D-114)',
  })
  carrierRequest!: CarrierRequestDto | null;

  @ApiProperty({
    type: [NextActionDto],
    description: 'What the signed-in user may do on the trip now (U-B0.3)',
  })
  nextActions!: NextActionDto[];
}

/** A failed or returned delivery and how staff resolved it (D-230). */
export class ShipmentExceptionDto {
  @ApiProperty({ enum: ['failed', 'returned'], enumName: 'ShipmentExceptionStatus', example: 'failed' })
  status!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'ไม่มีผู้รับ',
    description: 'From the failure event',
  })
  note!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-21T15:00:00+07:00' })
  occurredAt!: string;

  @ApiProperty({
    enum: EXCEPTION_RESOLUTIONS,
    enumName: 'ShipmentExceptionResolution',
    nullable: true,
    example: null,
  })
  resolution!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  resolutionNote!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  resolvedAt!: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  resolvedBy!: UserRefDto | null;
}

/** The staff review of the proof of delivery (D-229). */
export class PodReviewDto {
  @ApiProperty({ enum: ['pending', 'accepted', 'rejected'], enumName: 'PodReviewState', example: 'pending' })
  state!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  reviewedAt!: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  reviewedBy!: UserRefDto | null;
}

export class ShipmentRefDto {
  @ApiProperty({ format: 'uuid', example: SHIPMENT_IDS.shipment })
  id!: string;

  @ApiProperty({ example: 'SH-2610-0001' })
  shipmentNo!: string;
}

export class AdminShipmentDto extends PartnerShipmentDto {
  @ApiProperty({ format: 'uuid', example: SHIPMENT_IDS.factory })
  factoryId!: string;

  @ApiProperty({ example: 'F-0001' })
  factoryCode!: string;

  @ApiProperty({ nullable: true, example: null })
  carrierBookingRef!: string | null;

  @ApiProperty({ nullable: true, example: null })
  trackingUrl!: string | null;

  @ApiProperty({
    nullable: true,
    example: '120.00',
    description: 'Factory shipping payout (P15); only with `factory_buy_prices.read` (D-141)',
  })
  payoutAmount!: string | null;

  @ApiProperty({
    nullable: true,
    example: null,
    description: 'Fallback carrier cost (P25); only with `factory_buy_prices.read`',
  })
  carrierCostAmount!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, example: null })
  cancelledAt!: string | null;

  @ApiProperty({ nullable: true, example: null })
  cancelReason!: string | null;

  @ApiProperty({ type: ShipmentExceptionDto, nullable: true, description: 'Failed or returned (D-230)' })
  exception!: ShipmentExceptionDto | null;

  @ApiProperty({
    type: PodReviewDto,
    nullable: true,
    description: 'Null without a proof of delivery (D-229)',
  })
  podReview!: PodReviewDto | null;

  @ApiProperty({ type: ShipmentRefDto, nullable: true, description: 'The shipment this one was split from' })
  splitFrom!: ShipmentRefDto | null;
}

export class SplitShipmentResultDto {
  @ApiProperty({ type: AdminShipmentDto, description: 'The original, with what stays on it' })
  shipment!: AdminShipmentDto;

  @ApiProperty({ type: AdminShipmentDto, description: 'The new draft shipment' })
  created!: AdminShipmentDto;
}

export class ShipmentCarrierQuoteDto {
  @ApiProperty({ enum: FALLBACK_CARRIERS, enumName: 'FallbackCarrier', example: 'flash_express' })
  carrier!: string;

  @ApiProperty({ example: true, description: 'The carrier quoted the trip' })
  available!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '85.00',
    description: 'Packio’s cost (P25), THB; only with `factory_buy_prices.read` (D-141)',
  })
  amount!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 2 })
  transitDays!: number | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Why the carrier cannot quote' })
  reason!: string | null;

  @ApiProperty({ example: 'THB' })
  currency!: string;
}

export class CreatedShipmentDto extends PartnerShipmentDto {}

const SHIPMENT_BASE = {
  id: SHIPMENT_IDS.shipment,
  shipmentNo: 'SH-2610-0001',
  status: 'ready',
  ...statusLabels('ShipmentStatus', 'ready'),
  carrier: 'factory_fleet',
  trackingNo: null,
  destination: {
    recipientName: 'สมหญิง ใจดี',
    phone: '+66810001234',
    line1: '99/9 ถนนสุขุมวิท',
    line2: 'แขวงคลองตัน เขตคลองเตย',
    postcode: '10110',
    province: { id: '0192f3a0-7c1e-7d2a-9b1f-0000000f2007', nameTh: 'กรุงเทพมหานคร', nameEn: 'Bangkok' },
  },
  cartonsCount: 3,
  weightG: 18000,
  volumeCm3: 120000,
  plannedShipOn: '2026-10-20',
  readyAt: '2026-10-19T16:00:00+07:00',
  pickedUpAt: null,
  deliveredAt: null,
  labelFileId: SHIPMENT_IDS.label,
  packingListFileId: SHIPMENT_IDS.packingList,
  items: [
    {
      destinationId: SHIPMENT_IDS.destination,
      jobId: SHIPMENT_IDS.job,
      jobNo: 'JOB-2610-0001',
      orderCode: 'PK-2610-0001-01',
      quantity: 600,
      deliveredQuantity: null,
      toleranceOutcome: null,
    },
  ],
  events: [
    {
      occurredAt: '2026-10-19T16:00:00+07:00',
      status: 'ready',
      ...statusLabels('ShipmentStatus', 'ready'),
      source: 'factory',
      location: null,
      note: null,
    },
  ],
  proofOfDelivery: null,
  note: null,
  cartons: [
    { seq: 1, labelCode: '9F3A0C1B2D4E-01', weightG: null },
    { seq: 2, labelCode: '9F3A0C1B2D4E-02', weightG: null },
    { seq: 3, labelCode: '9F3A0C1B2D4E-03', weightG: null },
  ],
  blockedByPayment: false,
  carrierRequest: null,
  nextActions: [],
};
export const PARTNER_SHIPMENT_EXAMPLE = SHIPMENT_BASE;
export const ADMIN_SHIPMENT_EXAMPLE = {
  ...SHIPMENT_BASE,
  factoryId: SHIPMENT_IDS.factory,
  factoryCode: 'F-0001',
  carrierBookingRef: null,
  trackingUrl: null,
  payoutAmount: '120.00',
  carrierCostAmount: null,
  cancelledAt: null,
  cancelReason: null,
  exception: null,
  podReview: null,
  splitFrom: null,
};
export const POD_EXAMPLE = {
  kind: 'factory_photo_signature',
  receiverName: 'สมหญิง ใจดี',
  deliveredQuantity: 590,
  capturedAt: '2026-10-21T14:05:00+07:00',
  signatureFileId: SHIPMENT_IDS.signature,
  photoFileIds: [SHIPMENT_IDS.photo],
  carrierPodRef: null,
};

export class DeliveryReconciliationDto {
  @ApiProperty({ enum: TOLERANCE_OUTCOMES, enumName: 'ToleranceOutcome', example: 'shortage_within' })
  outcome!: string;

  @ApiProperty({ type: 'integer', example: 1000 })
  orderedQuantity!: number;

  @ApiProperty({ type: 'integer', example: 980 })
  deliveredQuantity!: number;

  @ApiProperty({
    type: 'integer',
    example: 980,
    description: 'Factory payable quantity: min(delivered, ordered) (D-165)',
  })
  payableQuantity!: number;

  @ApiProperty({ example: '-2.0000', description: 'Signed deviation from the ordered quantity, %' })
  deviationPct!: string;

  @ApiProperty({ example: '5.0000' })
  toleranceShortagePct!: string;

  @ApiProperty({ example: '5.0000' })
  toleranceOveragePct!: string;

  @ApiProperty({
    nullable: true,
    example: '200.00',
    description: 'Pro-rata credit, net of VAT (shortage within tolerance)',
  })
  creditNetAmount!: string | null;

  @ApiProperty({ nullable: true, example: '14.00' })
  creditVatAmount!: string | null;

  @ApiProperty({ nullable: true, example: '214.00' })
  creditAmount!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-21T14:05:00+07:00' })
  evaluatedAt!: string;
}

export const RECONCILIATION_EXAMPLE = {
  outcome: 'shortage_within',
  orderedQuantity: 1000,
  deliveredQuantity: 980,
  payableQuantity: 980,
  deviationPct: '-2.0000',
  toleranceShortagePct: '5.0000',
  toleranceOveragePct: '5.0000',
  creditNetAmount: '200.00',
  creditVatAmount: '14.00',
  creditAmount: '214.00',
  evaluatedAt: '2026-10-21T14:05:00+07:00',
};

export class StoreShipmentItemDto {
  @ApiProperty({ example: 'PK-2610-0001-01' })
  orderCode!: string;

  @ApiProperty({ type: 'integer', example: 600 })
  quantity!: number;

  @ApiProperty({ type: 'integer', nullable: true, example: 590 })
  deliveredQuantity!: number | null;
}

export class StoreShipmentEventDto {
  @ApiProperty({ format: 'date-time', example: '2026-10-20T09:30:00+07:00' })
  occurredAt!: string;

  @ApiProperty({ enum: SHIPMENT_STATUSES, enumName: 'ShipmentStatus', example: 'in_transit' })
  status!: ShipmentStatusValue;

  @ApiStatusLabelTh('ShipmentStatus')
  statusLabelTh!: string;

  @ApiStatusLabelAdminTh('ShipmentStatus')
  statusLabelAdminTh!: string;

  @ApiProperty({ nullable: true, example: 'ศูนย์กระจายสินค้าบางนา' })
  location!: string | null;
}

export class StorePodDto {
  @ApiProperty({ example: 'สมหญิง ใจดี' })
  receiverName!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-21T14:05:00+07:00' })
  capturedAt!: string;

  @ApiProperty({ type: [String], format: 'uuid', example: [SHIPMENT_IDS.photo] })
  photoFileIds!: string[];
}

/** The customer's view: no factory, no costs (D-050); the carrier only when Packio booked one. */
export class StoreShipmentDto {
  @ApiProperty({ format: 'uuid', example: SHIPMENT_IDS.shipment })
  id!: string;

  @ApiProperty({ example: 'SH-2610-0001' })
  shipmentNo!: string;

  @ApiProperty({ enum: SHIPMENT_STATUSES, enumName: 'ShipmentStatus', example: 'delivered' })
  status!: ShipmentStatusValue;

  @ApiStatusLabelTh('ShipmentStatus')
  statusLabelTh!: string;

  @ApiStatusLabelAdminTh('ShipmentStatus')
  statusLabelAdminTh!: string;

  @ApiProperty({
    enum: ['packio', 'flash_express', 'deliveree'],
    enumName: 'StoreCarrier',
    example: 'packio',
  })
  carrier!: string;

  @ApiProperty({ nullable: true, example: null })
  trackingNo!: string | null;

  @ApiProperty({ nullable: true, example: null })
  trackingUrl!: string | null;

  @ApiProperty({ type: ShipmentDestinationDto })
  destination!: ShipmentDestinationDto;

  @ApiProperty({ type: 'integer', example: 3 })
  cartonsCount!: number;

  @ApiProperty({ format: 'date-time', nullable: true, example: '2026-10-20T08:00:00+07:00' })
  pickedUpAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, example: '2026-10-21T14:05:00+07:00' })
  deliveredAt!: string | null;

  @ApiProperty({ type: [StoreShipmentItemDto] })
  items!: StoreShipmentItemDto[];

  @ApiProperty({ type: [StoreShipmentEventDto] })
  events!: StoreShipmentEventDto[];

  @ApiProperty({ type: StorePodDto, nullable: true })
  proofOfDelivery!: StorePodDto | null;
}

export const STORE_SHIPMENT_EXAMPLE = {
  id: SHIPMENT_IDS.shipment,
  shipmentNo: 'SH-2610-0001',
  status: 'delivered',
  ...statusLabels('ShipmentStatus', 'delivered'),
  carrier: 'packio',
  trackingNo: null,
  trackingUrl: null,
  destination: SHIPMENT_BASE.destination,
  cartonsCount: 3,
  pickedUpAt: '2026-10-20T08:00:00+07:00',
  deliveredAt: '2026-10-21T14:05:00+07:00',
  items: [{ orderCode: 'PK-2610-0001-01', quantity: 600, deliveredQuantity: 590 }],
  events: [
    {
      occurredAt: '2026-10-20T08:00:00+07:00',
      status: 'picked_up',
      ...statusLabels('ShipmentStatus', 'picked_up'),
      location: null,
    },
    {
      occurredAt: '2026-10-21T14:05:00+07:00',
      status: 'delivered',
      ...statusLabels('ShipmentStatus', 'delivered'),
      location: null,
    },
  ],
  proofOfDelivery: {
    receiverName: 'สมหญิง ใจดี',
    capturedAt: '2026-10-21T14:05:00+07:00',
    photoFileIds: [SHIPMENT_IDS.photo],
  },
};

// --- U-B0.3: partner views, ship plan --------------------------------------------------------------------

export const PARTNER_SHIPMENT_VIEWS = ['open', 'in_transit', 'delivered', 'exceptions'] as const;

export class PartnerShipmentListQuery extends ShipmentListQuery {
  @ApiPropertyOptional({
    enum: PARTNER_SHIPMENT_VIEWS,
    enumName: 'PartnerShipmentView',
    description:
      'open = draft or packed; in_transit = picked up to out for delivery; exceptions = failed or returned',
  })
  @IsOptional()
  @IsIn(PARTNER_SHIPMENT_VIEWS)
  view?: (typeof PARTNER_SHIPMENT_VIEWS)[number];
}

export class ShipPlanDestinationDto {
  @ApiProperty({ format: 'uuid', example: SHIPMENT_IDS.destination })
  destinationId!: string;

  @ApiProperty({ example: 'สมหญิง ใจดี' })
  recipientName!: string;

  @ApiProperty({ example: '10110' })
  postcode!: string;

  @ApiProperty({ example: 'กรุงเทพมหานคร' })
  provinceNameTh!: string;

  @ApiProperty({ type: 'integer', example: 600, description: 'Pieces for this address' })
  quantity!: number;

  @ApiProperty({ type: 'integer', example: 0, description: 'On live shipments already' })
  shippedQuantity!: number;

  @ApiProperty({ type: 'integer', example: 600 })
  remainingQuantity!: number;
}

export class ShipPlanJobDto {
  @ApiProperty({ format: 'uuid', example: SHIPMENT_IDS.job })
  jobId!: string;

  @ApiProperty({ example: 'JOB-2610-0001' })
  jobNo!: string;

  @ApiProperty({ example: 'PK-2610-0001-01' })
  orderCode!: string;

  @ApiProperty({ type: 'integer', example: 1000 })
  quantityOrdered!: number;

  @ApiProperty({ type: 'integer', nullable: true, example: 1000, description: 'Good pieces reported' })
  quantityGood!: number | null;

  @ApiProperty({
    enum: ['payment_pending', 'inspection_pending'],
    enumName: 'ShipBlockedReason',
    nullable: true,
    example: null,
    description: 'Why pickup would be refused today (the shipping gate, B3.2 / D-076)',
  })
  blockedReason!: string | null;

  @ApiProperty({ type: [ShipPlanDestinationDto] })
  destinations!: ShipPlanDestinationDto[];
}

export const SHIP_PLAN_EXAMPLE: ShipPlanJobDto = {
  jobId: SHIPMENT_IDS.job,
  jobNo: 'JOB-2610-0001',
  orderCode: 'PK-2610-0001-01',
  quantityOrdered: 1000,
  quantityGood: 1000,
  blockedReason: null,
  destinations: [
    {
      destinationId: SHIPMENT_IDS.destination,
      recipientName: 'สมหญิง ใจดี',
      postcode: '10110',
      provinceNameTh: 'กรุงเทพมหานคร',
      quantity: 600,
      shippedQuantity: 0,
      remainingQuantity: 600,
    },
  ],
};
