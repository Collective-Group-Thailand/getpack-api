import { ApiProperty } from '@nestjs/swagger';

import { CATALOG_STATUSES } from '../crud/dto-fields';
import { QUOTE_MODES } from '../product-structure/product-structure.dto';

/** One catalogue row that still needs something, enough to open it. */
export class ReadinessItemDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000c001' })
  id!: string;

  @ApiProperty({ example: 'tuck-end-box', description: 'The slug (product), SKU (stock) or code (style)' })
  key!: string;

  @ApiProperty({ example: 'กล่องฝาเสียบ' })
  nameTh!: string;

  @ApiProperty({ example: 'Tuck-end box' })
  nameEn!: string;
}

/** A list of rows needing the same thing: how many, and the first of them. */
export class ReadinessListDto {
  @ApiProperty({ type: 'integer', example: 3 })
  count!: number;

  @ApiProperty({ type: [ReadinessItemDto], description: 'Up to 50; `count` is the whole number' })
  items!: ReadinessItemDto[];
}

export class ReadinessProductTypeDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000c0004' })
  id!: string;

  @ApiProperty({ example: 'standard_product' })
  code!: string;

  @ApiProperty({ example: 'สินค้ามาตรฐาน' })
  nameTh!: string;

  @ApiProperty({ example: 'Stock products' })
  nameEn!: string;

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: (typeof CATALOG_STATUSES)[number];

  @ApiProperty({ enum: QUOTE_MODES, enumName: 'QuoteMode', example: 'rfq' })
  quoteMode!: (typeof QUOTE_MODES)[number];

  @ApiProperty({
    example: true,
    description: 'Its calculator is shipped with golden tests, so it may switch to instant (D-100, A-16)',
  })
  calculatorShipped!: boolean;

  @ApiProperty({
    type: 'integer',
    example: 12,
    description: 'Active catalogue or stock products of this type',
  })
  activeProducts!: number;
}

export class ReadinessProductsDto {
  @ApiProperty({ type: 'integer', example: 42, description: 'Active rows' })
  total!: number;

  @ApiProperty({ type: ReadinessListDto, description: 'Active, with no image at all' })
  noImage!: ReadinessListDto;

  @ApiProperty({
    type: ReadinessListDto,
    description: 'Active, every image a reference render — no photograph uploaded yet (D-426)',
  })
  referenceOnly!: ReadinessListDto;

  @ApiProperty({ type: ReadinessListDto, description: 'Draft or inactive, so not on the storefront' })
  notActive!: ReadinessListDto;

  @ApiProperty({
    type: ReadinessListDto,
    description: 'Active, but the product type is quote-only, so no instant price (A-16)',
  })
  quoteOnly!: ReadinessListDto;
}

export class ReadinessStylesDto {
  @ApiProperty({ type: 'integer', example: 122, description: 'Active bases' })
  total!: number;

  @ApiProperty({
    type: ReadinessListDto,
    description: 'Active, no card photo (the rendered thumbnail shows)',
  })
  noPhoto!: ReadinessListDto;

  @ApiProperty({
    type: ReadinessListDto,
    description: 'Active, the card photo is a reference render (D-426)',
  })
  referenceOnly!: ReadinessListDto;

  @ApiProperty({
    type: ReadinessListDto,
    description: 'Active, not hidden, yet no publishable variant (D-243)',
  })
  notPublishable!: ReadinessListDto;

  @ApiProperty({ type: ReadinessListDto, description: 'Hidden by curation — never published' })
  hidden!: ReadinessListDto;
}

/**
 * What the catalogue still needs before every customer-facing row is complete: a photograph, an
 * active status, an instant price, a publishable variant. For the catalogue owner to work through
 * as a list instead of opening rows one by one.
 */
export class CatalogReadinessDto {
  @ApiProperty({ type: [ReadinessProductTypeDto], description: 'Active types, in catalogue order' })
  productTypes!: ReadinessProductTypeDto[];

  @ApiProperty({ type: ReadinessProductsDto })
  products!: ReadinessProductsDto;

  @ApiProperty({ type: ReadinessProductsDto })
  stock!: ReadinessProductsDto;

  @ApiProperty({ type: ReadinessStylesDto })
  styles!: ReadinessStylesDto;
}

export const READINESS_EXAMPLE: CatalogReadinessDto = {
  productTypes: [
    {
      id: '0192f3a0-7c1e-7d2a-9b1f-0000000c0004',
      code: 'standard_product',
      nameTh: 'สินค้ามาตรฐาน',
      nameEn: 'Stock products',
      status: 'active',
      quoteMode: 'rfq',
      calculatorShipped: true,
      activeProducts: 101,
    },
  ],
  products: {
    total: 42,
    noImage: { count: 0, items: [] },
    referenceOnly: {
      count: 1,
      items: [
        {
          id: '0192f3a0-7c1e-7d2a-9b1f-00000000c001',
          key: 'tuck-end-box',
          nameTh: 'กล่องฝาเสียบ',
          nameEn: 'Tuck-end box',
        },
      ],
    },
    notActive: { count: 0, items: [] },
    quoteOnly: { count: 0, items: [] },
  },
  stock: {
    total: 101,
    noImage: { count: 0, items: [] },
    referenceOnly: { count: 0, items: [] },
    notActive: { count: 0, items: [] },
    quoteOnly: { count: 0, items: [] },
  },
  styles: {
    total: 122,
    noPhoto: { count: 0, items: [] },
    referenceOnly: { count: 0, items: [] },
    notPublishable: { count: 0, items: [] },
    hidden: { count: 0, items: [] },
  },
};
