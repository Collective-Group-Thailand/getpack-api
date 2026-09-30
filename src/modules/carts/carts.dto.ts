import {
  EnumField,
  IdField,
  IntField,
  RefField,
  TextField,
  TimestampField,
} from '@modules/catalog/crud/dto-fields';
import { LINE_SUMMARY_EXAMPLE, LineSummaryDto } from '@modules/quotes/line-summary.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsUUID, ValidateNested } from 'class-validator';

/** Carts (schema-design §3.6, B3.1): price-locked quote options with destinations (D-051, D-072). */

export const DESIGN_OPTIONS = ['own_file', 'online_designer', 'hired_design', 'free_design'] as const;
export const MOCKUP_OPTIONS = ['none', 'with_print', 'without_print'] as const;
export const CART_STATUSES = ['active', 'checked_out', 'abandoned'] as const;
export const QUOTE_SOURCES = ['instant', 'rfq'] as const;

export const CART_IDS = {
  cart: '0192f3a0-7c1e-7d2a-9b1f-0000000ca001',
  item: '0192f3a0-7c1e-7d2a-9b1f-0000000ca002',
  destination: '0192f3a0-7c1e-7d2a-9b1f-0000000ca003',
  quote: '0192f3a0-7c1e-7d2a-9b1f-0000000ca004',
  option: '0192f3a0-7c1e-7d2a-9b1f-0000000ca005',
  address: '0192f3a0-7c1e-7d2a-9b1f-0000000c0002',
  province: '0192f3a0-7c1e-7d2a-9b1f-0000000c0004',
  customer: '0192f3a0-7c1e-7d2a-9b1f-0000000c0001',
};

export class DestinationInputDto {
  @RefField({ example: CART_IDS.address, description: 'One of the customer’s delivery addresses' })
  addressId!: string;

  @IntField({ example: 1000, min: 1, description: 'Pieces delivered to this address' })
  quantity!: number;
}

export class AddCartItemDto {
  @RefField({ example: CART_IDS.quote, description: 'A saved quotation (instant or accepted RFQ)' })
  quoteId!: string;

  @RefField({ example: CART_IDS.option, description: 'The quantity option of that quotation' })
  quoteOptionId!: string;

  @EnumField(DESIGN_OPTIONS, 'DesignOption', {
    example: 'own_file',
    description:
      '`hired_design` needs a quotation priced with the design fee; `free_design` only where a promotion offers it (B3.3)',
  })
  designOption!: (typeof DESIGN_OPTIONS)[number];

  @TextField({ example: 'ใช้โลโก้เดิม', max: 500, optional: true, nullable: true })
  designNote?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'My online design for this item (`designOption = online_designer`, B4.1)',
  })
  @IsOptional()
  @IsUUID()
  designDocumentId?: string | null;

  @EnumField(MOCKUP_OPTIONS, 'MockupOption', {
    example: 'none',
    optional: true,
    description: 'Physical proof add-on (D-072); refused until the services calculator can price it',
  })
  mockupOption?: (typeof MOCKUP_OPTIONS)[number];

  @ApiProperty({
    type: [DestinationInputDto],
    required: false,
    description: 'Split of the quantity over addresses; defaults to the default delivery address',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DestinationInputDto)
  destinations?: DestinationInputDto[];
}

export class UpdateCartItemDto {
  @EnumField(DESIGN_OPTIONS, 'DesignOption', { example: 'hired_design', optional: true })
  designOption?: (typeof DESIGN_OPTIONS)[number];

  @TextField({ example: 'ใช้โลโก้เดิม', max: 500, optional: true, nullable: true })
  designNote?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'My online design (B4.1)',
  })
  @IsOptional()
  @IsUUID()
  designDocumentId?: string | null;

  @EnumField(MOCKUP_OPTIONS, 'MockupOption', { example: 'none', optional: true })
  mockupOption?: (typeof MOCKUP_OPTIONS)[number];
}

export class SetDestinationsDto {
  @ApiProperty({
    type: [DestinationInputDto],
    description: 'Replaces every destination; sum = item quantity',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DestinationInputDto)
  destinations!: DestinationInputDto[];
}

export class AddressSnapshotDto {
  @ApiProperty({ example: 'สมชาย ทดสอบ' })
  recipientName!: string;

  @ApiProperty({ example: '+66810001234' })
  phone!: string;

  @ApiProperty({ example: '99/9 ถนนตัวอย่าง' })
  line1!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  line2!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  subdistrictId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  subdistrictNameTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  districtNameTh!: string | null;

  @ApiProperty({ format: 'uuid', example: CART_IDS.province })
  provinceId!: string;

  @ApiProperty({ example: 'กรุงเทพมหานคร' })
  provinceNameTh!: string;

  @ApiProperty({ example: '10110' })
  postcode!: string;
}

export class CartDestinationDto {
  @IdField(CART_IDS.destination)
  id!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: CART_IDS.address })
  addressId!: string | null;

  @ApiProperty({ type: AddressSnapshotDto })
  address!: AddressSnapshotDto;

  @ApiProperty({ type: 'integer', example: 1000 })
  quantity!: number;
}

export class CartRepriceDto {
  @ApiProperty({ format: 'uuid', example: CART_IDS.quote })
  quoteId!: string;

  @ApiProperty({ format: 'uuid', example: CART_IDS.option })
  quoteOptionId!: string;

  @ApiProperty({ example: '13508.40', description: 'Before re-pricing, incl. VAT' })
  previousGrossAmount!: string;

  @ApiProperty({ example: '13722.40', description: 'At today’s prices, incl. VAT' })
  newGrossAmount!: string;

  @ApiProperty({ example: '214.00', description: 'new − previous (negative = cheaper)' })
  differenceAmount!: string;

  @ApiProperty({ example: '13.72' })
  newUnitPrice!: string;

  @TimestampField('2026-10-16T10:00:00+07:00')
  validUntil!: string;
}

export class ReorderRefDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000f1002' })
  orderId!: string;

  @ApiProperty({ example: 'PK-2610-0001-01' })
  orderCode!: string;
}

export class CartItemDto {
  @IdField(CART_IDS.item)
  id!: string;

  @ApiProperty({ format: 'uuid', example: CART_IDS.quote })
  quoteId!: string;

  @ApiProperty({ format: 'uuid', example: CART_IDS.option })
  quoteOptionId!: string;

  @ApiProperty({ type: String, nullable: true, example: 'QT-2026-000042' })
  quoteCode!: string | null;

  @ApiProperty({ enum: QUOTE_SOURCES, enumName: 'QuoteMode', example: 'instant' })
  source!: string;

  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({
    type: LineSummaryDto,
    description: 'Product, product type, sales unit and spec lines to display (from its quote)',
  })
  summary!: LineSummaryDto;

  @ApiProperty({ type: 'integer', example: 1000 })
  quantity!: number;

  @ApiProperty({ example: '13.38', description: 'Per piece incl. VAT, excluding shipping' })
  unitPrice!: string;

  @ApiProperty({
    example: '13380.00',
    description:
      'Price of the configuration incl. VAT and design fees, excluding shipping (priced at checkout)',
  })
  productGrossAmount!: string;

  @ApiProperty({ example: '0.00', description: 'Design fee included above, incl. VAT' })
  designFeeAmount!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '128.40',
    description: 'Shipping the quotation priced for its postcode (indicative; re-priced per destination)',
  })
  quoteShippingAmount!: string | null;

  @ApiProperty({ enum: DESIGN_OPTIONS, enumName: 'DesignOption', example: 'own_file' })
  designOption!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  designNote!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'The online design used (B4.1)',
  })
  designDocumentId!: string | null;

  @ApiProperty({ enum: MOCKUP_OPTIONS, enumName: 'MockupOption', example: 'none' })
  mockupOption!: string;

  @ApiProperty({
    type: ReorderRefDto,
    nullable: true,
    example: null,
    description: 'The past order this item reorders (D-153)',
  })
  reorderOf!: ReorderRefDto | null;

  @ApiProperty({
    example: false,
    description:
      'Reorder with unchanged artwork: the approved proof carries over and no new proof is needed (D-153)',
  })
  reusesApprovedArtwork!: boolean;

  @TimestampField('2026-10-16T10:00:00+07:00')
  priceLockedUntil!: string;

  @ApiProperty({ example: true, description: 'false once the lock passed: re-price and confirm (D-051)' })
  priceLocked!: boolean;

  @ApiProperty({ type: CartRepriceDto, nullable: true })
  pendingReprice!: CartRepriceDto | null;

  @ApiProperty({ type: [CartDestinationDto] })
  destinations!: CartDestinationDto[];

  @ApiProperty({ example: true, description: 'Destinations cover exactly the quantity' })
  destinationsComplete!: boolean;
}

export class CartCodeDto {
  @ApiProperty({ example: 'WELCOME10' })
  code!: string;

  @ApiProperty({ enum: ['validated', 'rejected'], enumName: 'CartCodeStatus', example: 'validated' })
  status!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  rejectReason!: string | null;
}

export class CartDto {
  @IdField(CART_IDS.cart)
  id!: string;

  @ApiProperty({ format: 'uuid', example: CART_IDS.customer })
  customerId!: string;

  @ApiProperty({ enum: ['web', 'cs', 'line', 'b2b'], enumName: 'SalesChannel', example: 'web' })
  channel!: string;

  @ApiProperty({ type: [CartItemDto] })
  items!: CartItemDto[];

  @ApiProperty({ example: '13380.00', description: 'Sum of the items, incl. VAT, excluding shipping' })
  productGrossAmount!: string;

  @ApiProperty({
    type: [CartCodeDto],
    description: 'Coupon codes entered (D-053); the checkout preview says which apply and why others do not',
  })
  codes!: CartCodeDto[];

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @TimestampField()
  updatedAt!: string;
}

const DESTINATION_EXAMPLE: CartDestinationDto = {
  id: CART_IDS.destination,
  addressId: CART_IDS.address,
  address: {
    recipientName: 'สมชาย ทดสอบ',
    phone: '+66810001234',
    line1: '99/9 ถนนตัวอย่าง',
    line2: null,
    subdistrictId: null,
    subdistrictNameTh: null,
    districtNameTh: null,
    provinceId: CART_IDS.province,
    provinceNameTh: 'กรุงเทพมหานคร',
    postcode: '10110',
  },
  quantity: 1000,
};

export const CART_ITEM_EXAMPLE: CartItemDto = {
  id: CART_IDS.item,
  quoteId: CART_IDS.quote,
  quoteOptionId: CART_IDS.option,
  quoteCode: null,
  source: 'instant',
  productTypeCode: 'folding_carton',
  summary: LINE_SUMMARY_EXAMPLE,
  quantity: 1000,
  unitPrice: '13.38',
  productGrossAmount: '13380.00',
  designFeeAmount: '0.00',
  quoteShippingAmount: '128.40',
  designOption: 'own_file',
  designNote: null,
  designDocumentId: null,
  mockupOption: 'none',
  reorderOf: null,
  reusesApprovedArtwork: false,
  priceLockedUntil: '2026-10-16T10:00:00+07:00',
  priceLocked: true,
  pendingReprice: null,
  destinations: [DESTINATION_EXAMPLE],
  destinationsComplete: true,
};

export const CART_EXAMPLE: CartDto = {
  id: CART_IDS.cart,
  customerId: CART_IDS.customer,
  channel: 'web',
  items: [CART_ITEM_EXAMPLE],
  productGrossAmount: '13380.00',
  codes: [{ code: 'WELCOME10', status: 'validated', rejectReason: null }],
  currency: 'THB',
  updatedAt: '2026-10-01T10:00:00+07:00',
};

export const ADD_ITEM_EXAMPLE = {
  quoteId: CART_IDS.quote,
  quoteOptionId: CART_IDS.option,
  designOption: 'own_file',
  destinations: [{ addressId: CART_IDS.address, quantity: 1000 }],
};
