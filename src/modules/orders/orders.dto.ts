import { NextActionDto } from '@common/next-actions/next-action.dto';
import { PageQuery } from '@common/pagination/pagination.dto';
import { IdField, TimestampField } from '@modules/catalog/crud/dto-fields';
import { LINE_SUMMARY_EXAMPLE, LineSummaryDto } from '@modules/quotes/line-summary.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { AddressSnapshotDto, DestinationInputDto } from '../carts/carts.dto';

/** Order groups and orders (schema-design §3.6, B3.1). Money: decimal strings, THB. */

export const ORDER_GROUP_STATUSES = [
  'pending_company_approval',
  'waiting_payment',
  'in_progress',
  'completed',
  'cancelled',
] as const;
export const ORDER_STATUSES = [
  'waiting_payment',
  'paid_for_production',
  'artwork_approved',
  'in_production',
  'shipping',
  'completed',
  'cancelled',
] as const;
export const ARTWORK_STATUSES = [
  'awaiting_template',
  'awaiting_upload',
  'uploaded',
  'in_review',
  'proof_sent',
  'changes_requested',
  'approved',
] as const;
export const ORDER_LINE_TYPES = [
  'product',
  'design_fee',
  'structure_design_fee',
  'mockup',
  'plate',
  'die_block',
  'shipping',
  'service',
  'extra_revision',
] as const;
export const WHT_CATEGORIES = ['hire_of_work', 'transport', 'service', 'none'] as const;

export const ORDER_IDS = {
  group: '0192f3a0-7c1e-7d2a-9b1f-0000000d0001',
  order: '0192f3a0-7c1e-7d2a-9b1f-0000000d0002',
  line: '0192f3a0-7c1e-7d2a-9b1f-0000000d0003',
  destination: '0192f3a0-7c1e-7d2a-9b1f-0000000d0004',
  customer: '0192f3a0-7c1e-7d2a-9b1f-0000000c0001',
  quote: '0192f3a0-7c1e-7d2a-9b1f-0000000ca004',
  province: '0192f3a0-7c1e-7d2a-9b1f-0000000c0004',
};

export class MoneyTotalsDto {
  @ApiProperty({ example: '13254.95', description: 'Sum of line nets incl. shipping, before VAT' })
  netAmount!: string;

  @ApiProperty({ example: '0.00' })
  discountAmount!: string;

  @ApiProperty({ example: '120.00', description: 'Shipping part of the net' })
  shippingNetAmount!: string;

  @ApiProperty({ example: '927.85' })
  vatAmount!: string;

  @ApiProperty({ example: '14182.80', description: 'net − discount + VAT' })
  grossAmount!: string;

  @ApiProperty({
    example: '0.00',
    description: 'Expected customer withholding (tax profile withholds, D-174)',
  })
  whtAmount!: string;

  @ApiProperty({ example: '14182.80', description: 'gross − withholding: what the customer transfers' })
  cashAmount!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;
}

export class OrderLineDto {
  @IdField(ORDER_IDS.line)
  id!: string;

  @ApiProperty({ type: 'integer', example: 1 })
  lineNo!: number;

  @ApiProperty({ enum: ORDER_LINE_TYPES, enumName: 'OrderLineType', example: 'product' })
  lineType!: string;

  @ApiProperty({ example: 'สินค้า' })
  descriptionTh!: string;

  @ApiProperty({ example: 'Product' })
  descriptionEn!: string;

  @ApiProperty({ example: '1000', description: 'Quantity (decimal string, up to 3 decimals)' })
  quantity!: string;

  @ApiProperty({ example: '12.504206', description: 'Net per unit (6 decimals)' })
  unitPrice!: string;

  @ApiProperty({ example: '12504.21' })
  netAmount!: string;

  @ApiProperty({ example: '0.00' })
  discountAmount!: string;

  @ApiProperty({ example: '7.0000' })
  vatRatePct!: string;

  @ApiProperty({ example: '875.79' })
  vatAmount!: string;

  @ApiProperty({ example: '13380.00' })
  grossAmount!: string;

  @ApiProperty({ enum: WHT_CATEGORIES, enumName: 'WhtCategory', example: 'hire_of_work' })
  whtCategory!: string;

  @ApiProperty({ example: '0.00' })
  whtAmount!: string;
}

export class OrderDestinationDto {
  @IdField(ORDER_IDS.destination)
  id!: string;

  @ApiProperty({ type: AddressSnapshotDto })
  address!: AddressSnapshotDto;

  @ApiProperty({ type: 'integer', example: 1000 })
  quantity!: number;

  @ApiProperty({ example: '120.00', description: 'Shipping of this destination, before VAT' })
  shippingNetAmount!: string;
}

export const COMPLETION_MODES = ['auto_after_days', 'customer_confirmed'] as const;
export const TOLERANCE_OUTCOMES = [
  'exact',
  'shortage_within',
  'overage_within',
  'shortage_outside',
  'overage_outside',
] as const;

/** Delivery and receipt dates (D-081, D-082): computed by the API, never by the storefront. */
export class OrderReceiptDto {
  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-20T15:00:00+07:00' })
  deliveredAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-27T15:00:00+07:00',
    description:
      'While delivered and not completed: when the order completes by itself (`orders.auto_complete_days`, D-081)',
  })
  autoCompleteAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-27T15:00:00+07:00',
    description: 'Last moment to open a claim (`claims.window_days` from delivery, D-082)',
  })
  claimWindowEndsAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  completedAt!: string | null;

  @ApiProperty({ enum: COMPLETION_MODES, enumName: 'CompletionMode', nullable: true, example: null })
  completionMode!: (typeof COMPLETION_MODES)[number] | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'When I confirmed receipt myself (`completionMode = customer_confirmed`)',
  })
  confirmedAt!: string | null;
}

/** How the delivered quantity compared with the order and its frozen tolerance (D-021, D-080). */
export class OrderToleranceOutcomeDto {
  @ApiProperty({ enum: TOLERANCE_OUTCOMES, enumName: 'ToleranceOutcome', example: 'shortage_within' })
  outcome!: (typeof TOLERANCE_OUTCOMES)[number];

  @ApiProperty({ type: 'integer', example: 1000 })
  orderedQuantity!: number;

  @ApiProperty({ type: 'integer', example: 980 })
  deliveredQuantity!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '267.50',
    description: 'Pro-rata credit for a shortage within tolerance, incl. VAT (D-080); null otherwise',
  })
  creditAmount!: string | null;

  @ApiProperty({ type: String, format: 'date-time', example: '2026-10-20T15:00:00+07:00' })
  evaluatedAt!: string;
}

export class OrderDto {
  @IdField(ORDER_IDS.order)
  id!: string;

  @ApiProperty({ example: 'OR-2610-00042' })
  orderCode!: string;

  @ApiProperty({ enum: ORDER_STATUSES, enumName: 'OrderStatus', example: 'waiting_payment' })
  status!: string;

  @ApiProperty({ enum: ARTWORK_STATUSES, enumName: 'ArtworkStatus', example: 'awaiting_template' })
  artworkStatus!: string;

  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({
    type: LineSummaryDto,
    description:
      'Product, product type, sales unit and spec lines to display (from the quote it was made from)',
  })
  summary!: LineSummaryDto;

  @ApiProperty({ format: 'uuid', example: ORDER_IDS.quote })
  quoteId!: string;

  @ApiProperty({ type: 'integer', example: 1000 })
  quantityOrdered!: number;

  @ApiProperty({
    enum: ['own_file', 'online_designer', 'hired_design', 'free_design'],
    enumName: 'DesignOption',
    example: 'own_file',
  })
  designOption!: string;

  @ApiProperty({ enum: ['none', 'with_print', 'without_print'], enumName: 'MockupOption', example: 'none' })
  mockupOption!: string;

  @ApiProperty({ type: String, nullable: true, example: '5.0000', description: 'Frozen tolerance (D-021)' })
  toleranceShortagePct!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '5.0000' })
  toleranceOveragePct!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 7 })
  leadTimeDays!: number | null;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-10-12' })
  promisedShipDate!: string | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    example: '2026-10-14',
    description:
      'Expected arrival: the quotation’s delivery estimate moved with the promised ship date; null without one',
  })
  estimatedDeliveryDate!: string | null;

  @ApiProperty({ type: MoneyTotalsDto })
  totals!: MoneyTotalsDto;

  @ApiProperty({ type: [OrderLineDto] })
  lines!: OrderLineDto[];

  @ApiProperty({ type: [OrderDestinationDto] })
  destinations!: OrderDestinationDto[];

  @TimestampField()
  statusChangedAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  cancelledAt!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Code of the cancellation reason',
  })
  cancelReasonCode!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  cancelReasonNameTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  cancelReasonNameEn!: string | null;

  @ApiProperty({ type: OrderReceiptDto })
  receipt!: OrderReceiptDto;

  @ApiProperty({
    type: OrderToleranceOutcomeDto,
    nullable: true,
    description: 'Null until the order is delivered',
  })
  toleranceOutcome!: OrderToleranceOutcomeDto | null;

  @ApiProperty({ type: String, format: 'date-time', example: '2026-10-01T09:00:00+07:00' })
  createdAt!: string;

  @ApiProperty({
    type: [NextActionDto],
    description:
      'What the signed-in user may do on the order now, from the actions’ own checks (U-B0.3); paying an ' +
      'instalment is on the payment schedule (`payable`)',
  })
  nextActions!: NextActionDto[];
}

export class OrderGroupDto {
  @IdField(ORDER_IDS.group)
  id!: string;

  @ApiProperty({ example: 'OG-2610-00042' })
  groupCode!: string;

  @ApiProperty({ enum: ORDER_GROUP_STATUSES, enumName: 'OrderGroupStatus', example: 'waiting_payment' })
  status!: string;

  @ApiProperty({ enum: ['web', 'cs', 'line', 'b2b'], enumName: 'SalesChannel', example: 'web' })
  channel!: string;

  @ApiProperty({ format: 'uuid', example: ORDER_IDS.customer })
  customerId!: string;

  @ApiProperty({ type: String, nullable: true, example: 'PO-0001' })
  poNumber!: string | null;

  @ApiProperty({ type: MoneyTotalsDto })
  totals!: MoneyTotalsDto;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-08T10:00:00+07:00',
    description: 'Unpaid groups are cancelled at this instant (D-060)',
  })
  expiresAt!: string | null;

  @TimestampField()
  placedAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  cancelledAt!: string | null;

  @ApiProperty({ type: [String], example: ['account@example.com'] })
  ccEmails!: string[];

  @ApiProperty({ type: [OrderDto] })
  orders!: OrderDto[];
}

export class AdminOrderInternalDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000f0001',
  })
  selectedFactoryId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '10150.00',
    description: 'Masked without `factory_cost.read` (D-141)',
  })
  buyCostNet!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '3104.95',
    description: 'Masked without `margin.read`',
  })
  marginAmount!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '23.4254' })
  marginPct!: string | null;

  @ApiProperty({ example: false })
  belowMarginFloor!: boolean;
}

export class AdminOrderDto extends OrderDto {
  @ApiProperty({ type: AdminOrderInternalDto })
  internal!: AdminOrderInternalDto;
}

export class OrderCustomerRefDto {
  @ApiProperty({ format: 'uuid', example: ORDER_IDS.customer })
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'CU-000042' })
  customerCode!: string | null;

  @ApiProperty({ example: 'สมชาย ทดสอบ' })
  displayName!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'บริษัท ตัวอย่าง จำกัด',
    description: 'The ordering company',
  })
  companyName!: string | null;
}

export class AdminOrderGroupDto extends OrderGroupDto {
  @ApiProperty({ type: String, nullable: true, example: 'ลูกค้าขอส่งด่วน' })
  csRemarks!: string | null;

  @ApiProperty({ format: 'uuid', example: ORDER_IDS.customer, description: 'Who placed it (customer or CS)' })
  placedById!: string;

  @ApiPropertyOptional({ type: Object, nullable: true, example: { source: 'google', medium: 'cpc' } })
  utm!: Record<string, string> | null;

  @ApiProperty({ type: OrderCustomerRefDto })
  customer!: OrderCustomerRefDto;

  @ApiProperty({ type: UserRefDto, description: 'Who placed it (the customer or CS)' })
  placedBy!: UserRefDto;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: { taxType: 'juristic', taxId: '0000000000019', branchCode: '00000', withholdsTax: true },
    description: 'The tax profile the documents are issued to, as placed (snapshot)',
  })
  taxProfile!: Record<string, unknown> | null;

  @ApiProperty({ example: false, description: 'A slip waits for Finance review (D-061)' })
  hasSlipToReview!: boolean;

  @ApiProperty({ type: [AdminOrderDto] })
  declare orders: AdminOrderDto[];
}

export const MONEY_EXAMPLE: MoneyTotalsDto = {
  netAmount: '13254.95',
  discountAmount: '0.00',
  shippingNetAmount: '120.00',
  vatAmount: '927.85',
  grossAmount: '14182.80',
  whtAmount: '0.00',
  cashAmount: '14182.80',
  currency: 'THB',
};

export const ORDER_EXAMPLE: OrderDto = {
  id: ORDER_IDS.order,
  orderCode: 'OR-2610-00042',
  status: 'waiting_payment',
  artworkStatus: 'awaiting_template',
  productTypeCode: 'folding_carton',
  summary: LINE_SUMMARY_EXAMPLE,
  quoteId: ORDER_IDS.quote,
  quantityOrdered: 1000,
  designOption: 'own_file',
  mockupOption: 'none',
  toleranceShortagePct: '5.0000',
  toleranceOveragePct: '5.0000',
  leadTimeDays: 7,
  promisedShipDate: '2026-10-12',
  estimatedDeliveryDate: '2026-10-14',
  totals: MONEY_EXAMPLE,
  lines: [
    {
      id: ORDER_IDS.line,
      lineNo: 1,
      lineType: 'product',
      descriptionTh: 'สินค้า',
      descriptionEn: 'Product',
      quantity: '1000',
      unitPrice: '12.504206',
      netAmount: '12504.21',
      discountAmount: '0.00',
      vatRatePct: '7.0000',
      vatAmount: '875.79',
      grossAmount: '13380.00',
      whtCategory: 'hire_of_work',
      whtAmount: '0.00',
    },
  ],
  destinations: [
    {
      id: ORDER_IDS.destination,
      address: {
        recipientName: 'สมชาย ทดสอบ',
        phone: '+66810001234',
        line1: '99/9 ถนนตัวอย่าง',
        line2: null,
        subdistrictId: null,
        subdistrictNameTh: null,
        districtNameTh: null,
        provinceId: ORDER_IDS.province,
        provinceNameTh: 'กรุงเทพมหานคร',
        postcode: '10110',
      },
      quantity: 1000,
      shippingNetAmount: '120.00',
    },
  ],
  statusChangedAt: '2026-10-01T10:00:00+07:00',
  cancelledAt: null,
  cancelReasonCode: null,
  cancelReasonNameTh: null,
  cancelReasonNameEn: null,
  receipt: {
    deliveredAt: null,
    autoCompleteAt: null,
    claimWindowEndsAt: null,
    completedAt: null,
    completionMode: null,
    confirmedAt: null,
  },
  toleranceOutcome: null,
  createdAt: '2026-10-01T09:00:00+07:00',
  nextActions: [{ key: 'order.upload_artwork', irreversible: false, disabledReason: null }],
};

export const ORDER_GROUP_EXAMPLE: OrderGroupDto = {
  id: ORDER_IDS.group,
  groupCode: 'OG-2610-00042',
  status: 'waiting_payment',
  channel: 'web',
  customerId: ORDER_IDS.customer,
  poNumber: null,
  totals: MONEY_EXAMPLE,
  expiresAt: '2026-10-08T10:00:00+07:00',
  placedAt: '2026-10-01T10:00:00+07:00',
  cancelledAt: null,
  ccEmails: [],
  orders: [ORDER_EXAMPLE],
};

export const ADMIN_ORDER_GROUP_EXAMPLE: AdminOrderGroupDto = {
  ...ORDER_GROUP_EXAMPLE,
  csRemarks: null,
  placedById: ORDER_IDS.customer,
  utm: null,
  customer: {
    id: ORDER_IDS.customer,
    customerCode: 'CU-000042',
    displayName: 'สมชาย ทดสอบ',
    companyName: null,
  },
  placedBy: { id: ORDER_IDS.customer, displayName: 'สมชาย ทดสอบ' },
  taxProfile: null,
  hasSlipToReview: false,
  orders: [
    {
      ...ORDER_EXAMPLE,
      internal: {
        selectedFactoryId: '0192f3a0-7c1e-7d2a-9b1f-0000000f0001',
        buyCostNet: '10150.00',
        marginAmount: '3104.95',
        marginPct: '23.4254',
        belowMarginFloor: false,
      },
    },
  ],
};

export class OrderGroupListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ORDER_GROUP_STATUSES, enumName: 'OrderGroupStatus' })
  @IsOptional()
  @IsIn(ORDER_GROUP_STATUSES)
  status?: (typeof ORDER_GROUP_STATUSES)[number];
}

export class CancelOrderDto {
  @ApiProperty({
    example: 'customer_request',
    description:
      'An active cancel reason (`order_cancel_reasons`); customers may use `customer` reasons only',
  })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/)
  reasonCode!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'ลูกค้าเปลี่ยนแบบ', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

// --- CS operations (B3.1 slice 6) -------------------------------------------------------------------

export class RepriceOrderDto {
  @ApiProperty({
    format: 'uuid',
    example: ORDER_IDS.quote,
    description: 'A live quotation of the same customer and product type',
  })
  @IsUUID()
  quoteId!: string;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000ca005' })
  @IsUUID()
  quoteOptionId!: string;

  @ApiProperty({ example: 'ลูกค้าขอเปลี่ยนจำนวน', maxLength: 500 })
  @IsString()
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({
    enum: ['own_file', 'online_designer', 'hired_design', 'free_design'],
    enumName: 'DesignOption',
  })
  @IsOptional()
  @IsIn(['own_file', 'online_designer', 'hired_design', 'free_design'])
  designOption?: string;

  @ApiPropertyOptional({
    type: [DestinationInputDto],
    description: 'Required when a split order changes quantity',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DestinationInputDto)
  destinations?: DestinationInputDto[];
}

export class ChangeCustomerDto {
  @ApiProperty({ format: 'uuid', example: ORDER_IDS.customer })
  @IsUUID()
  customerId!: string;
}

export class UpdateOrderGroupDto {
  @ApiPropertyOptional({ type: String, nullable: true, example: 'ลูกค้าขอส่งด่วน', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  csRemarks?: string | null;

  @ApiPropertyOptional({ type: [String], example: ['account@example.com'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsEmail({}, { each: true })
  ccEmails?: string[];

  @ApiPropertyOptional({ type: String, nullable: true, example: 'PO-0001', maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  poNumber?: string | null;
}

export class AddOrderNoteDto {
  @ApiProperty({ example: 'โทรยืนยันกับลูกค้าแล้ว', maxLength: 4000 })
  @IsString()
  @MaxLength(4000)
  body!: string;

  @ApiPropertyOptional({ type: [String], format: 'uuid', example: [], description: 'Staff users mentioned' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  mentions?: string[];
}

export class OrderNoteDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000d0005' })
  id!: string;

  @ApiProperty({ example: 'โทรยืนยันกับลูกค้าแล้ว' })
  body!: string;

  @ApiProperty({ type: UserRefDto })
  author!: UserRefDto;

  @ApiProperty({ type: [UserRefDto], description: 'Staff mentioned in the note (D-143)' })
  mentions!: UserRefDto[];

  @TimestampField()
  createdAt!: string;
}

export const ORDER_QUEUES = [
  'waiting_payment',
  'artwork_review',
  'waiting_production',
  'due_soon',
  'late',
] as const;

export class OrderQueueQuery extends PageQuery {
  @ApiPropertyOptional({
    type: 'integer',
    example: 3,
    minimum: 1,
    maximum: 30,
    description: '`due_soon` only: promised ship date within this many days (view filter)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  withinDays?: number;
}

export class OrderQueueItemDto {
  @ApiProperty({ format: 'uuid', example: ORDER_IDS.order })
  orderId!: string;

  @ApiProperty({ example: 'OR-2610-00042' })
  orderCode!: string;

  @ApiProperty({ format: 'uuid', example: ORDER_IDS.group })
  groupId!: string;

  @ApiProperty({ example: 'OG-2610-00042' })
  groupCode!: string;

  @ApiProperty({ example: 'สมชาย ทดสอบ' })
  customerName!: string;

  @ApiProperty({ enum: ORDER_STATUSES, enumName: 'OrderStatus', example: 'paid_for_production' })
  status!: string;

  @ApiProperty({ enum: ARTWORK_STATUSES, enumName: 'ArtworkStatus', example: 'uploaded' })
  artworkStatus!: string;

  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-10-12' })
  promisedShipDate!: string | null;

  @ApiProperty({ example: '14182.80' })
  grossAmount!: string;

  @TimestampField()
  placedAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-08T10:00:00+07:00' })
  groupExpiresAt!: string | null;
}

export const QUEUE_ITEM_EXAMPLE: OrderQueueItemDto = {
  orderId: ORDER_IDS.order,
  orderCode: 'OR-2610-00042',
  groupId: ORDER_IDS.group,
  groupCode: 'OG-2610-00042',
  customerName: 'สมชาย ทดสอบ',
  status: 'paid_for_production',
  artworkStatus: 'uploaded',
  productTypeCode: 'folding_carton',
  promisedShipDate: '2026-10-12',
  grossAmount: '14182.80',
  placedAt: '2026-10-01T10:00:00+07:00',
  groupExpiresAt: null,
};
