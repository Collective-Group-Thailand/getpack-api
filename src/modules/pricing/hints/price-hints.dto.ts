import { SLUG, SNAKE_CODE } from '@modules/catalog/crud/dto-fields';
import { SpecLineDto } from '@modules/quotes/line-summary.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const list = ({ value }: { value: unknown }) =>
  (Array.isArray(value) ? value : [value])
    .flatMap((v) => String(v).split(','))
    .map((v) => v.trim())
    .filter(Boolean);

export class PriceHintQuery {
  @ApiPropertyOptional({ example: 'folding_carton', description: 'Product type code' })
  @IsOptional()
  @Matches(SNAKE_CODE)
  productType?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['tuck-end-box'],
    description: 'Catalogue product slugs (comma-separated or repeated, ≤ 100); all products of the type when omitted',
  })
  @IsOptional()
  @Transform(list)
  @IsArray()
  @ArrayMaxSize(100)
  @Matches(SLUG, { each: true })
  slugs?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['PKO-BTL-0250'],
    description: 'Stock product SKUs (comma-separated or repeated, ≤ 100)',
  })
  @IsOptional()
  @Transform(list)
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  skus?: string[];
}

export const PRICE_HINT_KINDS = ['catalog_product', 'stock_product'] as const;

/** What a "starting from" price assumes — always shown with the figure (D-181). */
export class PriceHintBasisDto {
  @ApiProperty({ type: 'integer', example: 1000, description: 'Quantity the price per piece is for' })
  quantity!: number;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Standard size code, when the reference is one' })
  sizeCode!: string | null;

  @ApiProperty({ example: true })
  includesVat!: boolean;

  @ApiProperty({ example: false, description: 'Delivery is quoted for the delivery postcode, not in this figure' })
  includesDelivery!: boolean;

  @ApiProperty({ type: [SpecLineDto], description: 'The reference specification, as spec lines' })
  specs!: SpecLineDto[];
}

export class BusinessDayRangeDto {
  @ApiProperty({ type: 'integer', example: 7 })
  min!: number;

  @ApiProperty({ type: 'integer', example: 7 })
  max!: number;
}

export class PriceHintDto {
  @ApiProperty({ example: 'tuck-end-box', description: 'Catalogue product slug or stock product SKU' })
  key!: string;

  @ApiProperty({ enum: PRICE_HINT_KINDS, enumName: 'PriceHintKind', example: 'catalog_product' })
  kind!: (typeof PRICE_HINT_KINDS)[number];

  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '4.28',
    description:
      'Price per piece at the reference configuration, rounded up to the satang; null = no instant price (RFQ, D-043)',
  })
  startingFromPerPiece!: string | null;

  @ApiProperty({ enum: ['THB'], enumName: 'Currency', example: 'THB' })
  currency!: 'THB';

  @ApiProperty({ type: PriceHintBasisDto, nullable: true })
  basis!: PriceHintBasisDto | null;

  @ApiProperty({
    type: BusinessDayRangeDto,
    nullable: true,
    description: 'Production lead time in working days (factory capacity, D-101); null when unknown',
  })
  leadTimeBusinessDays!: BusinessDayRangeDto | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-01T09:00:00+07:00' })
  computedAt!: string | null;
}

export const PRICE_HINT_EXAMPLE: PriceHintDto = {
  key: 'tuck-end-box',
  kind: 'catalog_product',
  productTypeCode: 'folding_carton',
  startingFromPerPiece: '4.28',
  currency: 'THB',
  basis: {
    quantity: 1000,
    sizeCode: null,
    includesVat: true,
    includesDelivery: false,
    specs: [
      { key: 'size', labelTh: 'ขนาด (กว้าง × ยาว × ลึก)', labelEn: 'Size (W × L × D)', valueTh: '60 × 60 × 150 มม.', valueEn: '60 × 60 × 150 mm' },
    ],
  },
  leadTimeBusinessDays: { min: 7, max: 7 },
  computedAt: '2026-10-01T09:00:00+07:00',
};
