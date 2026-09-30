import { PageQuery } from '@common/pagination/pagination.dto';
import { OrderRefDto } from '@modules/carts/carts.dto';
import { IdField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Payment schedules (D-020, ADR-0008). */

export const DUE_TRIGGERS = [
  'at_checkout',
  'before_production',
  'before_shipping',
  'on_delivery',
  'days_after_delivery',
] as const;
export const REQUIRED_BEFORE = ['none', 'production', 'shipping'] as const;
export const INSTALMENT_STATUSES = [
  'pending',
  'due',
  'partially_paid',
  'paid',
  'overdue',
  'cancelled',
  'refunded',
] as const;

const IDS = {
  schedule: '0192f3a0-7c1e-7d2a-9b1f-0000000b0001',
  instalment: '0192f3a0-7c1e-7d2a-9b1f-0000000b0002',
  order: '0192f3a0-7c1e-7d2a-9b1f-0000000d0002',
};

export class InstalmentAllocationDto {
  @ApiProperty({ format: 'uuid', example: IDS.order })
  orderId!: string;

  @ApiProperty({ example: 'OR-2610-00042' })
  orderCode!: string;

  @ApiProperty({ example: '7091.40' })
  grossAmount!: string;

  @ApiProperty({ example: '7091.40' })
  cashAmount!: string;
}

export class InstalmentDto {
  @IdField(IDS.instalment)
  id!: string;

  @ApiProperty({ type: 'integer', example: 1 })
  seq!: number;

  @ApiProperty({ example: 'มัดจำ 50%' })
  labelTh!: string;

  @ApiProperty({ example: '50 % deposit' })
  labelEn!: string;

  @ApiProperty({ example: '50.0000' })
  pct!: string;

  @ApiProperty({ enum: DUE_TRIGGERS, enumName: 'DueTrigger', example: 'at_checkout' })
  dueTrigger!: string;

  @ApiProperty({ enum: REQUIRED_BEFORE, enumName: 'RequiredBefore', example: 'production' })
  requiredBefore!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-01T10:00:00+07:00' })
  dueAt!: string | null;

  @ApiProperty({ enum: INSTALMENT_STATUSES, enumName: 'InstalmentStatus', example: 'due' })
  status!: string;

  @ApiProperty({ example: '7091.40', description: 'Incl. VAT' })
  grossAmount!: string;

  @ApiProperty({ example: '0.00', description: 'Expected customer withholding (D-174)' })
  whtAmount!: string;

  @ApiProperty({ example: '7091.40', description: 'What the customer transfers' })
  cashAmount!: string;

  @ApiProperty({ example: '0.00' })
  paidAmount!: string;

  @ApiProperty({ example: '7091.40', description: 'cash − paid' })
  openAmount!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  paidAt!: string | null;

  @ApiPropertyOptional({
    type: [InstalmentAllocationDto],
    description: 'Staff only: share of each order (ADR-0008)',
  })
  allocations?: InstalmentAllocationDto[];
}

/** One of my instalments across my order groups (U-B0.1 `store.instalments`). */
export class StoreInstalmentDto extends InstalmentDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000d0001' })
  groupId!: string;

  @ApiProperty({ example: 'OG-2610-00042' })
  groupCode!: string;

  @ApiProperty({ type: [OrderRefDto], description: 'The orders this instalment pays for' })
  orders!: OrderRefDto[];

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'A started payment still open on this instalment (continue it instead of starting another)',
  })
  activePaymentId!: string | null;

  @ApiProperty({
    example: true,
    description: 'Something is left to pay and the group takes payments (pay it with `store.payments.initiate`)',
  })
  payable!: boolean;
}

export class StoreInstalmentQuery extends PageQuery {
  @ApiPropertyOptional({ enum: INSTALMENT_STATUSES, enumName: 'InstalmentStatus', example: 'due' })
  @IsOptional()
  @IsIn(INSTALMENT_STATUSES)
  status?: (typeof INSTALMENT_STATUSES)[number];
}

export class PaymentScheduleDto {
  @IdField(IDS.schedule)
  id!: string;

  @ApiProperty({ example: 'deposit_50_before_shipping_50' })
  templateKey!: string;

  @ApiProperty({ example: '50 % deposit, 50 % before shipping' })
  templateNameEn!: string;

  @ApiProperty({ example: 'มัดจำ 50% ส่วนที่เหลือก่อนจัดส่ง' })
  templateNameTh!: string;

  @ApiProperty({ example: false })
  isOverride!: boolean;

  @ApiProperty({ example: true, description: 'The instalments required before production are paid (D-073)' })
  productionGateOpen!: boolean;

  @ApiProperty({ example: false, description: 'The instalments required before shipping are paid' })
  shippingGateOpen!: boolean;

  @ApiProperty({ example: '7091.40', description: 'Cash still to pay on open instalments' })
  openAmount!: string;

  @ApiProperty({ type: [InstalmentDto] })
  instalments!: InstalmentDto[];
}

export class AdminPaymentScheduleDto extends PaymentScheduleDto {
  @ApiProperty({ type: String, nullable: true, example: null })
  overrideReason!: string | null;
}

const INSTALMENT_EXAMPLE: InstalmentDto = {
  id: IDS.instalment,
  seq: 1,
  labelTh: 'มัดจำ 50%',
  labelEn: '50 % deposit',
  pct: '50.0000',
  dueTrigger: 'at_checkout',
  requiredBefore: 'production',
  dueAt: '2026-10-01T10:00:00+07:00',
  status: 'due',
  grossAmount: '7091.40',
  whtAmount: '0.00',
  cashAmount: '7091.40',
  paidAmount: '0.00',
  openAmount: '7091.40',
  paidAt: null,
};

export const SCHEDULE_EXAMPLE: PaymentScheduleDto = {
  id: IDS.schedule,
  templateKey: 'deposit_50_before_shipping_50',
  templateNameEn: '50 % deposit, 50 % before shipping',
  templateNameTh: 'มัดจำ 50% ส่วนที่เหลือก่อนจัดส่ง',
  isOverride: false,
  productionGateOpen: false,
  shippingGateOpen: false,
  openAmount: '14182.80',
  instalments: [
    INSTALMENT_EXAMPLE,
    {
      ...INSTALMENT_EXAMPLE,
      id: '0192f3a0-7c1e-7d2a-9b1f-0000000b0003',
      seq: 2,
      labelTh: 'ส่วนที่เหลือก่อนจัดส่ง',
      labelEn: 'Balance before shipping',
      dueTrigger: 'before_shipping',
      requiredBefore: 'shipping',
      dueAt: null,
      status: 'pending',
    },
  ],
};

export const ADMIN_SCHEDULE_EXAMPLE: AdminPaymentScheduleDto = {
  ...SCHEDULE_EXAMPLE,
  overrideReason: null,
  instalments: SCHEDULE_EXAMPLE.instalments.map((i) => ({
    ...i,
    allocations: [
      {
        orderId: IDS.order,
        orderCode: 'OR-2610-00042',
        grossAmount: i.grossAmount,
        cashAmount: i.cashAmount,
      },
    ],
  })),
};

export class ScheduleOverrideDto {
  @ApiProperty({ example: 'full_upfront', description: 'A payment schedule template in force' })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/)
  templateKey!: string;

  @ApiProperty({ example: 'ลูกค้าขอชำระเต็มจำนวน', maxLength: 500 })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

// --- templates (admin) ------------------------------------------------------------------------------

export class TemplateInstalmentDto {
  @ApiProperty({ example: 'มัดจำ 50%' })
  @IsString()
  @MaxLength(100)
  labelTh!: string;

  @ApiProperty({ example: '50 % deposit' })
  @IsString()
  @MaxLength(100)
  labelEn!: string;

  @ApiProperty({ example: '50', description: 'Percent of the group total; instalments add up to 100' })
  @IsString()
  @Matches(/^\d{1,3}(\.\d{1,4})?$/)
  pct!: string;

  @ApiProperty({ enum: DUE_TRIGGERS, enumName: 'DueTrigger', example: 'at_checkout' })
  @IsIn(DUE_TRIGGERS)
  dueTrigger!: (typeof DUE_TRIGGERS)[number];

  @ApiPropertyOptional({ type: 'integer', nullable: true, example: null, description: 'Days after delivery' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  dueOffsetDays?: number | null;

  @ApiProperty({ enum: REQUIRED_BEFORE, enumName: 'RequiredBefore', example: 'production' })
  @IsIn(REQUIRED_BEFORE)
  requiredBefore!: (typeof REQUIRED_BEFORE)[number];
}

export class CreateTemplateVersionDto {
  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-01T00:00:00+07:00',
    description: 'Never in the past',
  })
  @IsISO8601()
  effectiveFrom!: string;

  @ApiProperty({
    type: Object,
    example: { orderValue: { gte: { setting: 'payments.schedule_split_threshold' } } },
    description: 'orderValue.gte / lt (amount or {setting}), customerTypes, productTypeCodes, creditApproved',
  })
  @IsObject()
  selectionRule!: Record<string, unknown>;

  @ApiProperty({ type: 'integer', example: 100, description: 'Lower is tried first' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  priority!: number;

  @ApiPropertyOptional({
    example: false,
    description: 'Selected only by CS with `payment_schedules.override`',
  })
  @IsOptional()
  @IsBoolean()
  requiresPermissionToSelect?: boolean;

  @ApiProperty({ type: [TemplateInstalmentDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => TemplateInstalmentDto)
  instalments!: TemplateInstalmentDto[];

  @ApiProperty({ example: 'สามงวด 30/40/30 สำหรับงานใหญ่', maxLength: 500 })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class TemplateDto {
  @ApiProperty({ example: 'deposit_50_before_shipping_50' })
  key!: string;

  @ApiProperty({ example: 'มัดจำ 50% ส่วนที่เหลือก่อนจัดส่ง' })
  nameTh!: string;

  @ApiProperty({ example: '50 % deposit, 50 % before shipping' })
  nameEn!: string;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 1,
    description: 'Version in force; null when none',
  })
  versionNo!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 100 })
  priority!: number | null;

  @ApiProperty({
    type: Object,
    nullable: true,
    example: { orderValue: { gte: { setting: 'payments.schedule_split_threshold' } } },
  })
  selectionRule!: Record<string, unknown> | null;

  @ApiProperty({ example: false })
  requiresPermissionToSelect!: boolean;

  @ApiProperty({ type: [TemplateInstalmentDto] })
  instalments!: TemplateInstalmentDto[];
}

export const TEMPLATE_EXAMPLE: TemplateDto = {
  key: 'deposit_50_before_shipping_50',
  nameTh: 'มัดจำ 50% ส่วนที่เหลือก่อนจัดส่ง',
  nameEn: '50 % deposit, 50 % before shipping',
  versionNo: 1,
  priority: 100,
  selectionRule: { orderValue: { gte: { setting: 'payments.schedule_split_threshold' } } },
  requiresPermissionToSelect: false,
  instalments: [
    {
      labelTh: 'มัดจำ 50%',
      labelEn: '50 % deposit',
      pct: '50.0000',
      dueTrigger: 'at_checkout',
      dueOffsetDays: null,
      requiredBefore: 'production',
    },
    {
      labelTh: 'ส่วนที่เหลือก่อนจัดส่ง',
      labelEn: 'Balance before shipping',
      pct: '50.0000',
      dueTrigger: 'before_shipping',
      dueOffsetDays: null,
      requiredBefore: 'shipping',
    },
  ],
};

export const STORE_INSTALMENT_EXAMPLE: StoreInstalmentDto = {
  ...INSTALMENT_EXAMPLE,
  groupId: '0192f3a0-7c1e-7d2a-9b1f-0000000d0001',
  groupCode: 'OG-2610-00042',
  orders: [{ orderId: IDS.order, orderCode: 'OR-2610-00042' }],
  activePaymentId: null,
  payable: true,
};
