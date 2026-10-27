import { CodeNameRefDto } from '@common/dto/code-name-ref.dto';
import { CART_EXAMPLE, CartDto } from '@modules/carts/carts.dto';
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { RFQ_PRODUCT_EXAMPLE, RfqDto, RfqProductRefDto, SubmitRfqDto } from './rfqs.dto';

/** D-301 technical limit of one basket. */
export const MAX_BASKET_ITEMS = 20;
export const BASKET_STATUSES = ['draft', 'submitted', 'discarded'] as const;

const IDS = {
  basket: '0192f3a0-7c1e-7d2a-9b1f-0000000e7401',
  item: '0192f3a0-7c1e-7d2a-9b1f-0000000e7402',
  design: '0192f3a0-7c1e-7d2a-9b1f-0000000e7403',
  type: '0192f3a0-7c1e-7d2a-9b1f-0000000e7404',
  conversation: '0192f3a0-7c1e-7d2a-9b1f-0000000e7405',
  quotation: '0192f3a0-7c1e-7d2a-9b1f-0000000e7406',
} as const;

export class BasketDesignRefDto {
  @ApiProperty({ format: 'uuid', example: IDS.design, description: 'One of my designs' })
  @IsUUID()
  designId!: string;

  @ApiPropertyOptional({ type: 'integer', example: 3, description: 'Default: its current version' })
  @IsOptional()
  @IsInt()
  @Min(1)
  versionNo?: number;
}

/** One item: the store RFQ form of a product type (D-183 millimetres), without the basket-wide delivery details. */
export class RfqBasketItemInputDto extends OmitType(SubmitRfqDto, [
  'deliveryPostcode',
  'targetDate',
  'notes',
  'routedFrom',
] as const) {
  @ApiPropertyOptional({ type: BasketDesignRefDto, description: 'The design version the item is for' })
  @IsOptional()
  @ValidateNested()
  @Type(() => BasketDesignRefDto)
  design?: BasketDesignRefDto;
}

export class SetBasketDetailsDto {
  @ApiPropertyOptional({
    example: '10110',
    description: 'Where every item is delivered (required to submit)',
  })
  @IsOptional()
  @Matches(/^[0-9]{5}$/)
  deliveryPostcode?: string;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true, example: '2026-11-15' })
  @IsOptional()
  @IsDateString({ strict: true })
  targetDate?: string | null;

  @ApiPropertyOptional({ example: 'ต้องการให้สีโลโก้ตรงกันทุกชิ้น', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class RfqBasketItemDto {
  @ApiProperty({ format: 'uuid', example: IDS.item })
  id!: string;

  @ApiProperty({ type: 'integer', example: 0 })
  sort!: number;

  @ApiProperty({ type: CodeNameRefDto })
  productType!: CodeNameRefDto;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { spec: { material: 'kraft 150 gsm (fake)' }, quantities: [500, 1000] },
    description: 'The item as entered (the RFQ form fields)',
  })
  specification!: Record<string, unknown>;

  @ApiProperty({ type: BasketDesignRefDto, nullable: true })
  design!: BasketDesignRefDto | null;

  @ApiProperty({
    type: RfqProductRefDto,
    nullable: true,
    example: RFQ_PRODUCT_EXAMPLE,
    description:
      'C1 (DECISIONS-STAGE-A §4): the catalogue or stock product the line is for (`catalogProductSlug` / ' +
      '`stockProductSku` of the item); null for a line asked from a category form',
  })
  product!: RfqProductRefDto | null;

  @ApiProperty({
    type: RfqDto,
    nullable: true,
    description: 'Its RFQ once submitted — status, getpack’s quotations per quantity, acceptance',
  })
  rfq!: RfqDto | null;
}

export class RfqBasketDto {
  @ApiProperty({ format: 'uuid', example: IDS.basket })
  id!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'RB-2610-00001',
    description: 'Numbered on submission',
  })
  basketCode!: string | null;

  @ApiProperty({ enum: BASKET_STATUSES, enumName: 'RfqBasketStatus', example: 'draft' })
  status!: string;

  @ApiProperty({ type: String, nullable: true, example: '10110' })
  deliveryPostcode!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-11-15' })
  targetDate!: string | null;

  @ApiProperty({ example: '' })
  notes!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'The basket’s thread with getpack (`store.conversations.*`), from submission',
  })
  conversationId!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  submittedAt!: string | null;

  @ApiProperty({ type: [RfqBasketItemDto] })
  items!: RfqBasketItemDto[];

  @ApiProperty({ format: 'date-time', example: '2026-10-04T10:00:00+07:00' })
  createdAt!: string;
}

export const BASKET_EXAMPLE: RfqBasketDto = {
  id: IDS.basket,
  basketCode: null,
  status: 'draft',
  deliveryPostcode: '10110',
  targetDate: '2026-11-15',
  notes: '',
  conversationId: null,
  submittedAt: null,
  items: [
    {
      id: IDS.item,
      sort: 0,
      productType: { id: IDS.type, code: 'paper_bag', nameTh: 'ถุงกระดาษ', nameEn: 'Paper bag' },
      specification: { spec: { material: 'kraft 150 gsm (fake)' }, quantities: [500, 1000] },
      design: null,
      product: null,
      rfq: null,
    },
  ],
  createdAt: '2026-10-04T10:00:00+07:00',
};

export class AcceptBasketItemDto {
  @ApiProperty({ format: 'uuid', example: IDS.item })
  @IsUUID()
  itemId!: string;

  @ApiProperty({ format: 'uuid', example: IDS.quotation, description: 'The item RFQ’s sent quotation' })
  @IsUUID()
  rfqQuoteId!: string;

  @ApiProperty({ type: 'integer', example: 1000, description: 'One of its quoted quantities' })
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class AcceptBasketItemsDto {
  @ApiProperty({ type: [AcceptBasketItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BASKET_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => AcceptBasketItemDto)
  items!: AcceptBasketItemDto[];
}

export class AcceptedBasketDto {
  @ApiProperty({ type: RfqBasketDto })
  basket!: RfqBasketDto;

  @ApiProperty({
    type: CartDto,
    description: 'My cart with the accepted items at the quoted price and validity',
  })
  cart!: CartDto;
}

export const ACCEPTED_EXAMPLE: AcceptedBasketDto = {
  basket: { ...BASKET_EXAMPLE, status: 'submitted' },
  cart: CART_EXAMPLE,
};
