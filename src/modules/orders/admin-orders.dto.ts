import { FactoryRefDto } from '@common/dto/factory-ref.dto';
import { PageQuery } from '@common/pagination/pagination.dto';
import { SALES_CHANNELS } from '@modules/ledger/ledger.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
} from 'class-validator';

import { ARTWORK_STATUSES, ORDER_IDS, ORDER_STATUSES, OrderCustomerRefDto } from './orders.dto';

/** Staff order reads and actions added by U-B0.2 (D-060, D-061, D-141, D-143). */

export class AdminOrderListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ORDER_STATUSES, enumName: 'OrderStatus' })
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: (typeof ORDER_STATUSES)[number];

  @ApiPropertyOptional({ enum: ARTWORK_STATUSES, enumName: 'ArtworkStatus' })
  @IsOptional()
  @IsIn(ARTWORK_STATUSES)
  artworkStatus?: (typeof ARTWORK_STATUSES)[number];

  @ApiPropertyOptional({ enum: SALES_CHANNELS, enumName: 'SalesChannel' })
  @IsOptional()
  @IsIn(SALES_CHANNELS)
  channel?: (typeof SALES_CHANNELS)[number];

  @ApiPropertyOptional({ example: 'folding_box' })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_]{0,59}$/)
  productTypeCode?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'The factory producing it' })
  @IsOptional()
  @IsUUID()
  factoryId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-01', description: 'Placed on or after (Bangkok)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  placedFrom?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-31',
    description: 'Placed on or before (Bangkok)',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  placedTo?: string;
}

export class NextInstalmentDto {
  @ApiProperty({ type: 'integer', example: 2 })
  seq!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-20T10:00:00+07:00' })
  dueAt!: string | null;

  @ApiProperty({ example: '5000.00', description: 'Still to pay' })
  openAmount!: string;
}

export class AdminOrderListItemDto {
  @ApiProperty({ format: 'uuid', example: ORDER_IDS.order })
  orderId!: string;

  @ApiProperty({ example: 'PK-2610-0001-01' })
  orderCode!: string;

  @ApiProperty({ format: 'uuid', example: ORDER_IDS.group })
  groupId!: string;

  @ApiProperty({ example: 'PK-2610-0001' })
  groupCode!: string;

  @ApiProperty({ enum: ORDER_STATUSES, enumName: 'OrderStatus', example: 'in_production' })
  status!: string;

  @ApiProperty({ enum: ARTWORK_STATUSES, enumName: 'ArtworkStatus', example: 'approved' })
  artworkStatus!: string;

  @ApiProperty({ enum: SALES_CHANNELS, enumName: 'SalesChannel', example: 'web' })
  channel!: string;

  @ApiProperty({ example: 'folding_box' })
  productTypeCode!: string;

  @ApiProperty({ type: 'integer', example: 1000 })
  quantity!: number;

  @ApiProperty({ example: 'piece' })
  unit!: string;

  @ApiProperty({ type: OrderCustomerRefDto })
  customer!: OrderCustomerRefDto;

  @ApiProperty({ type: FactoryRefDto, nullable: true, description: 'Staff only (D-050)' })
  factory!: FactoryRefDto | null;

  @ApiProperty({ example: '14182.80' })
  grossAmount!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-10-20' })
  promisedShipDate!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T10:00:00+07:00' })
  placedAt!: string;

  @ApiProperty({ example: false, description: 'A slip of the group waits for Finance review (D-061)' })
  hasSlipToReview!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description:
      'Review due time of that slip (`payments.slip_review_sla_business_hours`, business hours D-175)',
  })
  slipReviewDueAt!: string | null;

  @ApiProperty({
    type: NextInstalmentDto,
    nullable: true,
    description: 'The next unpaid instalment of the group',
  })
  nextInstalment!: NextInstalmentDto | null;
}

export const ADMIN_ORDER_ROW_EXAMPLE: AdminOrderListItemDto = {
  orderId: ORDER_IDS.order,
  orderCode: 'PK-2610-0001-01',
  groupId: ORDER_IDS.group,
  groupCode: 'PK-2610-0001',
  status: 'in_production',
  artworkStatus: 'approved',
  channel: 'web',
  productTypeCode: 'folding_box',
  quantity: 1000,
  unit: 'piece',
  customer: {
    id: ORDER_IDS.customer,
    customerCode: 'CU-000042',
    displayName: 'สมชาย ทดสอบ',
    companyName: null,
  },
  factory: { id: '0192f3a0-7c1e-7d2a-9b1f-0000000d1003', code: 'F0001', name: 'โรงพิมพ์ ทดสอบ' },
  grossAmount: '14182.80',
  currency: 'THB',
  promisedShipDate: '2026-10-20',
  placedAt: '2026-10-01T10:00:00+07:00',
  hasSlipToReview: false,
  slipReviewDueAt: null,
  nextInstalment: { seq: 2, dueAt: '2026-10-20T10:00:00+07:00', openAmount: '5000.00' },
};

export const CANCEL_REASON_APPLIES = ['customer', 'staff', 'system'] as const;

export class CancelReasonQuery {
  @ApiPropertyOptional({ enum: CANCEL_REASON_APPLIES, enumName: 'CancelReasonAppliesTo', example: 'staff' })
  @IsOptional()
  @IsIn(CANCEL_REASON_APPLIES)
  appliesTo?: (typeof CANCEL_REASON_APPLIES)[number];
}

export class CancelReasonDto {
  @ApiProperty({ example: 'duplicate_order' })
  code!: string;

  @ApiProperty({ example: 'สั่งซ้ำ' })
  nameTh!: string;

  @ApiProperty({ example: 'Duplicate order' })
  nameEn!: string;

  @ApiProperty({ enum: CANCEL_REASON_APPLIES, enumName: 'CancelReasonAppliesTo', example: 'staff' })
  appliesTo!: string;

  @ApiProperty({ example: false, description: 'A paid order cancelled for this reason needs a credit note' })
  requiresCreditNote!: boolean;
}

export class BulkPaymentReminderDto {
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 100, example: [ORDER_IDS.order] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  @Type(() => String)
  orderIds!: string[];
}

export class ReminderSkipDto {
  @ApiProperty({ format: 'uuid', example: ORDER_IDS.order })
  orderId!: string;

  @ApiProperty({
    example: 'payments.nothing_due',
    description:
      'Why no reminder went: an error code (`payments.nothing_due`, `payments.reminder_recent`, `http.not_found`)',
  })
  reason!: string;
}

export class PaymentReminderResultDto {
  @ApiProperty({ type: 'integer', example: 1 })
  sent!: number;

  @ApiProperty({ type: [ReminderSkipDto] })
  skipped!: ReminderSkipDto[];
}
