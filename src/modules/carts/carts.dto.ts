import {
  EnumField,
  IdField,
  IntField,
  RefField,
  TextField,
  TimestampField,
} from '@modules/catalog/crud/dto-fields';
import { QuoteArrivalDto } from '@modules/pricing/quotes/quote.dto';
import { LINE_SUMMARY_EXAMPLE, LineSummaryDto, LocalisedLabelDto } from '@modules/quotes/line-summary.dto';
import { ReorderQuantityLimitsDto } from '@modules/quotes/quantity-limits.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** Carts (schema-design §3.6, B3.1): price-locked quote options with destinations (D-051, D-072). */

export const DESIGN_OPTIONS = ['own_file', 'online_designer', 'hired_design', 'free_design'] as const;
export const MOCKUP_OPTIONS = ['none', 'with_print', 'without_print'] as const;
export const CART_STATUSES = ['active', 'checked_out', 'abandoned'] as const;
export const QUOTE_SOURCES = ['instant', 'rfq', 'sample', 'call_off'] as const;

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

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    example: 3,
    description:
      'D-276 the design version to order; absent: the current version (pinned now, never changed by later edits)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  designVersionNo?: number;

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

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    example: 3,
    description:
      'D-276 the design version to order; absent: the current version (pinned now, never changed by later edits)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  designVersionNo?: number;

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

/** A reference to one of the customer's orders (id + code). */
export class OrderRefDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000f1002' })
  orderId!: string;

  @ApiProperty({ example: 'PK-2610-0001-01' })
  orderCode!: string;
}

/** D-452 (C5): a cheaper quantity of the same locked quotation (the pricing service's own option). */
export class CartTierHintDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000ca006' })
  quoteOptionId!: string;

  @ApiProperty({ type: 'integer', example: 2000 })
  quantity!: number;

  @ApiProperty({ example: '12.10', description: 'Per piece incl. VAT, excluding shipping' })
  unitPrice!: string;

  @ApiProperty({
    example: '24200.00',
    description: 'That quantity incl. VAT and design fees, excluding shipping',
  })
  productGrossAmount!: string;
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

  @ApiProperty({ enum: QUOTE_SOURCES, enumName: 'QuoteSource', example: 'instant' })
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

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: null,
    description: 'D-276 the design version this item orders (pinned; later edits make new versions)',
  })
  designVersionNo!: number | null;

  @ApiProperty({ enum: MOCKUP_OPTIONS, enumName: 'MockupOption', example: 'none' })
  mockupOption!: string;

  @ApiProperty({
    type: OrderRefDto,
    nullable: true,
    example: null,
    description: 'The past order this item reorders (D-153)',
  })
  reorderOf!: OrderRefDto | null;

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

  @ApiProperty({
    example: true,
    description:
      'D-452: the quantity can be changed in the cart (`changeQuantity`) — an instant quotation without a Studio ' +
      'design pin, not a reorder and with no re-priced option waiting for confirmation',
  })
  quantityEditable!: boolean;

  @ApiProperty({
    type: ReorderQuantityLimitsDto,
    nullable: true,
    example: { min: 100, max: null },
    description:
      'D-452: the catalogue product’s quantity limits; null when the quotation has no catalogue product',
  })
  quantityLimits!: ReorderQuantityLimitsDto | null;

  @ApiProperty({
    type: CartTierHintDto,
    nullable: true,
    example: null,
    description:
      'D-452: the smallest larger quantity of the same locked quotation with a lower unit price ("สั่ง n ชิ้น ' +
      'ราคาต่อชิ้นเหลือ ฿x"); null when there is none, the lock passed or a re-price waits',
  })
  tierHint!: CartTierHintDto | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    example: '2026-11-09',
    description:
      'D-452: the quotation’s earliest ship date (Bangkok day) while it is still ahead; null when passed or unknown',
  })
  earliestShipDate!: string | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 5,
    description:
      'D-452: production working days of the quotation option (after artwork approval); null when unknown',
  })
  leadTimeDays!: number | null;
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
    type: String,
    nullable: true,
    example: '875.33',
    description:
      'D-452: VAT included in `productGrossAmount` — the order lines checkout builds before shipping (shared VAT ' +
      'helper, DECISIONS-STAGE-A §7, each quotation’s VAT rate). Always set by `store.cart.*` and the code ' +
      'endpoints; null in carts returned by other modules (read the cart again)',
  })
  vatAmount!: string | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 3,
    description:
      'D-452: coupon codes the cart may hold (`promotions.max_codes_per_cart`); null as `vatAmount`',
  })
  maxCodes!: number | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 50,
    description:
      'D-452: pieces the quantity stepper moves by (`storefront.cart_quantity_step`); null as `vatAmount`',
  })
  quantityStep!: number | null;

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
  designVersionNo: null,
  mockupOption: 'none',
  reorderOf: null,
  reusesApprovedArtwork: false,
  priceLockedUntil: '2026-10-16T10:00:00+07:00',
  priceLocked: true,
  pendingReprice: null,
  destinations: [DESTINATION_EXAMPLE],
  destinationsComplete: true,
  quantityEditable: true,
  quantityLimits: { min: 100, max: null },
  tierHint: {
    quoteOptionId: '0192f3a0-7c1e-7d2a-9b1f-0000000ca006',
    quantity: 2000,
    unitPrice: '12.10',
    productGrossAmount: '24200.00',
  },
  earliestShipDate: '2026-11-09',
  leadTimeDays: 5,
};

export const CART_EXAMPLE: CartDto = {
  id: CART_IDS.cart,
  customerId: CART_IDS.customer,
  channel: 'web',
  items: [CART_ITEM_EXAMPLE],
  productGrossAmount: '13380.00',
  vatAmount: '875.33',
  maxCodes: 3,
  quantityStep: 50,
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

/** D-452 (C5): a new quantity for a cart item. */
export class ChangeQuantityDto {
  @ApiProperty({ type: 'integer', example: 2000, minimum: 1, maximum: 1000000, description: 'Pieces' })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;
}

/** D-452 (C5): a postcode for the cart's shipping estimate. */
export class EstimateShippingDto {
  @ApiProperty({ example: '10110', pattern: '^\\d{5}$' })
  @Matches(/^\d{5}$/)
  postcode!: string;
}

/** D-452 (C5): what shipping the whole cart to one postcode would cost — an estimate, nothing is saved. */
export class CartShippingEstimateDto {
  @ApiProperty({ example: '10110' })
  postcode!: string;

  @ApiProperty({ example: true, description: 'Every item can be shipped to the postcode' })
  available!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '235.40',
    description:
      'Shipping of every item to the postcode incl. VAT (customer rate card, D-013); null when not available',
  })
  shippingGrossAmount!: string | null;

  @ApiProperty({
    type: LocalisedLabelDto,
    nullable: true,
    description: 'The destination zone’s name (customer side only)',
  })
  zone!: LocalisedLabelDto | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    example: '2026-11-09',
    description:
      'The latest ready (ship) date of the items as promised at checkout; null when one is unknown',
  })
  readyDate!: string | null;

  @ApiProperty({
    type: QuoteArrivalDto,
    nullable: true,
    description:
      'Ready date + the zone’s transit working days (`shipping.transit_days`, national calendar); null when unknown',
  })
  arrival!: QuoteArrivalDto | null;

  @ApiProperty({ type: [String], example: [], description: 'Items that cannot be shipped to the postcode' })
  unavailableItemIds!: string[];
}

export const SHIPPING_ESTIMATE_EXAMPLE: CartShippingEstimateDto = {
  postcode: '10110',
  available: true,
  shippingGrossAmount: '235.40',
  zone: { th: 'กรุงเทพฯ และปริมณฑล', en: 'Bangkok & vicinity' },
  readyDate: '2026-11-09',
  arrival: { from: '2026-11-10', to: '2026-11-11' },
  unavailableItemIds: [],
};
