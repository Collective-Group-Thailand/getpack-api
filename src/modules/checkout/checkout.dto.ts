import { RefField, TextField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
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

import { MONEY_EXAMPLE, MoneyTotalsDto, ORDER_IDS, OrderLineDto } from '../orders/orders.dto';
import { ScheduleOverrideDto } from '../payment-schedules/payment-schedules.dto';
import { PAYMENT_METHODS } from '../payments/payments.dto';

/** Checkout (B3.1): preview and place the order group. */

export class UtmDto {
  @ApiPropertyOptional({ example: 'google' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  source?: string;

  @ApiPropertyOptional({ example: 'cpc' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  medium?: string;

  @ApiPropertyOptional({ example: 'launch-2026' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  campaign?: string;

  @ApiPropertyOptional({ example: 'กล่องพิมพ์ลาย' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  term?: string;

  @ApiPropertyOptional({ example: 'banner-a' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  content?: string;
}

export class CheckoutDto {
  @RefField({
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000c0003',
    optional: true,
    nullable: true,
    description: 'Buyer for a full-form tax invoice; its withholding flag sets the expected cash (D-174)',
  })
  taxProfileId?: string | null;

  @TextField({
    example: 'PO-0001',
    max: 60,
    optional: true,
    nullable: true,
    description: 'Customer PO number (D-125)',
  })
  poNumber?: string | null;

  @ApiPropertyOptional({
    type: [String],
    example: ['account@example.com'],
    description: 'Copies of order e-mails (max 10)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsEmail({}, { each: true })
  ccEmails?: string[];

  @ApiPropertyOptional({ type: UtmDto, description: 'Campaign attribution of this order (D-102)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => UtmDto)
  utm?: UtmDto;

  @ApiPropertyOptional({
    type: String,
    example: '14182.80',
    pattern: '^\\d{1,12}\\.\\d{2}$',
    description:
      'The total the client showed; a different server total is refused (`checkout.total_changed`)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,12}\.\d{2}$/)
  expectedGrossAmount?: string;
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    example: 40,
    description:
      'Points to redeem (D-133): capped at 20 % of the order value, the margin floor and the balance; min THB 10',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  redeemPoints?: number;
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000c1001',
    description:
      'Order for this B2B company (I must be allowed to order for it); the invoice names its branch (D-125)',
  })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000c1002',
    description: 'Company branch on the tax invoice; default branch when omitted',
  })
  @IsOptional()
  @IsUUID()
  companyBranchId?: string;
}

export class AdminCheckoutDto extends CheckoutDto {
  @ApiPropertyOptional({
    type: ScheduleOverrideDto,
    description: 'Another schedule than the one the rules pick (`payment_schedules.override`, D-020)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ScheduleOverrideDto)
  paymentSchedule?: ScheduleOverrideDto;

  @TextField({
    example: 'ลูกค้าขอส่งด่วน',
    max: 2000,
    optional: true,
    nullable: true,
    description: 'Internal only',
  })
  csRemarks?: string | null;

  @ApiPropertyOptional({
    type: String,
    example: '5',
    description:
      'CS discount % on the non-shipping lines, up to `discounts.cs_limit_pct` (D-052); above it raise a discount memo',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,3}(\.\d{1,4})?$/)
  csDiscountPct?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000d1001',
    description: 'An approved discount memo of this customer (D-052), used once',
  })
  @IsOptional()
  @IsUUID()
  discountMemoId?: string;
}

export class PreviewDestinationDto {
  @ApiProperty({ example: '10110' })
  postcode!: string;

  @ApiProperty({ type: 'integer', example: 1000 })
  quantity!: number;

  @ApiProperty({ example: '120.00', description: 'Before VAT' })
  shippingNetAmount!: string;
}

export class PreviewDiscountDto {
  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 1,
    description: 'Line the discount is on; null = the whole order',
  })
  lineNo!: number | null;

  @ApiProperty({
    enum: [
      'coupon',
      'automatic_promotion',
      'referral',
      'cs_discount',
      'discount_memo',
      'company_discount',
      'points_redemption',
    ],
    enumName: 'DiscountSource',
    example: 'coupon',
  })
  source!: string;

  @ApiProperty({ example: '500.00', description: 'Before VAT' })
  amount!: string;

  @ApiProperty({ example: '0.00', description: 'Removed by the margin guard or the budget (D-053)' })
  cappedAmount!: string;

  @ApiProperty({
    nullable: true,
    enum: ['margin_floor', 'budget'],
    enumName: 'DiscountCapReason',
    example: null,
  })
  capReason!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: '0192f3a0-7c1e-7d2a-9b1f-000000090002',
  })
  promotionId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'WELCOME10' })
  code!: string | null;
}

export class PreviewOrderDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000ca002',
  })
  cartItemId!: string | null;

  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({ type: 'integer', example: 1000 })
  quantity!: number;

  @ApiProperty({ type: MoneyTotalsDto })
  totals!: MoneyTotalsDto;

  @ApiProperty({ type: [OrderLineDto], description: 'Lines as they will be written (ids are placeholders)' })
  lines!: OrderLineDto[];

  @ApiProperty({ type: [PreviewDestinationDto] })
  destinations!: PreviewDestinationDto[];

  @ApiProperty({
    type: [PreviewDiscountDto],
    description: 'Discounts on this order (promotions, points, memos)',
  })
  discounts!: PreviewDiscountDto[];
}

export class CheckoutNoticeDto {
  @ApiProperty({ example: 'promotion.capped' })
  code!: string;

  @ApiPropertyOptional({ type: Object, example: { cappedAmount: '120.00' } })
  params?: Record<string, unknown>;
}

export class PreviewInstalmentDto {
  @ApiProperty({ type: 'integer', example: 1 })
  seq!: number;

  @ApiProperty({ example: '50 % deposit' })
  labelEn!: string;

  @ApiProperty({ example: 'มัดจำ 50%' })
  labelTh!: string;

  @ApiProperty({ example: '50.0000' })
  pct!: string;

  @ApiProperty({
    enum: ['at_checkout', 'before_production', 'before_shipping', 'on_delivery', 'days_after_delivery'],
    enumName: 'DueTrigger',
    example: 'at_checkout',
  })
  dueTrigger!: string;

  @ApiProperty({
    enum: ['none', 'production', 'shipping'],
    enumName: 'RequiredBefore',
    example: 'production',
  })
  requiredBefore!: string;

  @ApiProperty({ example: '7091.40' })
  grossAmount!: string;

  @ApiProperty({ example: '7091.40' })
  cashAmount!: string;
}

export class PreviewScheduleDto {
  @ApiProperty({ example: 'deposit_50_before_shipping_50' })
  templateKey!: string;

  @ApiProperty({ type: [PreviewInstalmentDto] })
  instalments!: PreviewInstalmentDto[];
}

export class PointsPreviewDto {
  @ApiProperty({ type: 'integer', example: 120, description: 'Points I can use now' })
  balance!: number;

  @ApiProperty({ example: '2.50', description: 'Baht per point (D-131)' })
  pointValue!: string;

  @ApiProperty({ type: 'integer', example: 4, description: 'Fewest points one redemption takes (THB 10, D-133)' })
  minimumPoints!: number;

  @ApiProperty({
    type: 'integer',
    example: 120,
    description:
      'Most points this order can take: the balance and 20 % of the order value (D-133); the margin floor may still cap it (`points.capped`)',
  })
  maximumPoints!: number;

  @ApiProperty({ type: 'integer', example: 0, description: 'Points redeemed in this preview' })
  redeemedPoints!: number;

  @ApiProperty({
    type: 'integer',
    example: 25,
    description: 'Points the order earns once completed and past the claim window (D-130, D-132, tier multiplier)',
  })
  toEarn!: number;
}

export class CompanyPreviewDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000e0001' })
  companyId!: string;

  @ApiProperty({ example: 'บริษัท ทดสอบ จำกัด' })
  legalName!: string;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000e0002', description: 'Tax-invoice branch' })
  branchId!: string;

  @ApiProperty({ enum: ['required', 'optional', 'none'], enumName: 'PoNumberPolicy', example: 'optional' })
  poNumberPolicy!: string;

  @ApiProperty({ type: String, nullable: true, example: '50000.00', description: "The company's own approval threshold (D-123)" })
  approvalThreshold!: string | null;

  @ApiProperty({ example: false, description: 'The order waits for the company approver (D-123)' })
  approvalRequired!: boolean;

  @ApiProperty({ enum: ['prepaid', 'eligible', 'credit', 'blocked_overdue'], enumName: 'CreditStatus', example: 'credit' })
  creditStatus!: string;

  @ApiProperty({ type: String, nullable: true, example: '85000.00', description: 'Credit left (D-121); null without a limit' })
  creditAvailableAmount!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 30 })
  creditTermDays!: number | null;

  @ApiProperty({ example: true, description: 'This order goes on the credit term (otherwise it is prepaid)' })
  onCredit!: boolean;
}

export class PaymentMethodOptionDto {
  @ApiProperty({ enum: PAYMENT_METHODS, enumName: 'PaymentMethod', example: 'scb_qr' })
  method!: string;

  @ApiProperty({ example: true, description: 'Offered now (provider accounts live, D-176)' })
  available!: boolean;
}

export class CheckoutPreviewDto {
  @ApiProperty({
    type: PreviewScheduleDto,
    nullable: true,
    description: 'The payment schedule the order will get (D-020)',
  })
  paymentSchedule!: PreviewScheduleDto | null;

  @ApiProperty({ type: MoneyTotalsDto })
  totals!: MoneyTotalsDto;

  @ApiProperty({ type: [PreviewOrderDto] })
  orders!: PreviewOrderDto[];

  @ApiProperty({ example: false, description: 'The chosen tax profile withholds tax (D-174)' })
  withholding!: boolean;

  @ApiProperty({ type: [CheckoutNoticeDto] })
  notices!: CheckoutNoticeDto[];

  @ApiProperty({
    type: [PaymentMethodOptionDto],
    description: 'How the instalments can be paid (chosen when paying, `store.payments.initiate`); no surcharge',
  })
  paymentMethods!: PaymentMethodOptionDto[];

  @ApiProperty({ type: PointsPreviewDto, nullable: true, description: 'Null only when points cannot be read' })
  points!: PointsPreviewDto | null;

  @ApiProperty({ type: CompanyPreviewDto, nullable: true, description: 'When ordering for a company (B2B)' })
  company!: CompanyPreviewDto | null;
}

export const CHECKOUT_EXAMPLE = {
  taxProfileId: '0192f3a0-7c1e-7d2a-9b1f-0000000c0003',
  ccEmails: ['account@example.com'],
  expectedGrossAmount: '14182.80',
};

export const PREVIEW_EXAMPLE: CheckoutPreviewDto = {
  totals: MONEY_EXAMPLE,
  orders: [
    {
      cartItemId: '0192f3a0-7c1e-7d2a-9b1f-0000000ca002',
      productTypeCode: 'folding_carton',
      quantity: 1000,
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
      destinations: [{ postcode: '10110', quantity: 1000, shippingNetAmount: '120.00' }],
      discounts: [],
    },
  ],
  withholding: false,
  notices: [],
  paymentSchedule: {
    templateKey: 'full_upfront',
    instalments: [
      {
        seq: 1,
        labelEn: 'Full payment',
        labelTh: 'ชำระเต็มจำนวน',
        pct: '100.0000',
        dueTrigger: 'at_checkout',
        requiredBefore: 'production',
        grossAmount: '14182.80',
        cashAmount: '14182.80',
      },
    ],
  },
  paymentMethods: [
    { method: 'scb_qr', available: true },
    { method: 'bank_transfer_slip', available: true },
  ],
  points: { balance: 120, pointValue: '2.50', minimumPoints: 4, maximumPoints: 120, redeemedPoints: 0, toEarn: 25 },
  company: null,
};
