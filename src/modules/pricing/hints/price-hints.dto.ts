import { SLUG, SNAKE_CODE } from '@modules/catalog/crud/dto-fields';
import { SPEC_LABEL_EXAMPLE, SpecLabelDto, SpecLineDto } from '@modules/quotes/line-summary.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import { QuoteStepDto, STORE_CALCULATION_EXAMPLE } from '../quotes/quote.dto';

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
    description:
      'Catalogue product slugs (comma-separated or repeated, ≤ 100); all products of the type when omitted',
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
  @ApiProperty({
    type: 'integer',
    example: 1000,
    description:
      'Quantity the price per piece is for — for a stock product its minimum order quantity, the first price tier ' +
      '(C1b, DECISIONS-STAGE-A §10.5); show it with the price ("สั่งขั้นต่ำ N")',
  })
  quantity!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Standard size code, when the reference is one',
  })
  sizeCode!: string | null;

  @ApiProperty({ example: true })
  includesVat!: boolean;

  @ApiProperty({
    example: false,
    description: 'Delivery is quoted for the delivery postcode, not in this figure',
  })
  includesDelivery!: boolean;

  @ApiProperty({
    type: [SpecLineDto],
    description: 'The default spec (D-220, D-441) — the spec the configurator opens on — as spec lines',
  })
  specs!: SpecLineDto[];

  @ApiProperty({
    type: SpecLabelDto,
    example: SPEC_LABEL_EXAMPLE,
    description: 'The same spec as one string (D-441); show it with the price',
  })
  label!: SpecLabelDto;
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

  @ApiProperty({
    type: String,
    nullable: true,
    example: '4.00',
    description:
      "C1b (DECISIONS-STAGE-A §10.6): the same price per piece without VAT — the shared VAT helper's ex-VAT of " +
      '`startingFromPerPiece` at the approved `vat_standard` rate, half-up to the satang. Null when ' +
      '`startingFromPerPiece` is null or no rate is approved. For the storefront\'s "ราคารวม VAT / ไม่รวม VAT" switch.',
  })
  startingFromPerPieceExVat!: string | null;

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
  startingFromPerPieceExVat: '4.00',
  currency: 'THB',
  basis: {
    quantity: 1000,
    sizeCode: null,
    includesVat: true,
    includesDelivery: false,
    specs: [
      {
        key: 'size',
        labelTh: 'ขนาด (ยาว × กว้าง × สูง)',
        labelEn: 'Size (L × W × H)',
        valueTh: '60 × 60 × 150 มม.',
        valueEn: '60 × 60 × 150 mm',
      },
    ],
    label: { th: '60 × 60 × 150 มม.', en: '60 × 60 × 150 mm' },
  },
  leadTimeBusinessDays: { min: 7, max: 7 },
  computedAt: '2026-10-01T09:00:00+07:00',
};

/**
 * C1-API-2 (products R2, approved in DECISIONS-STAGE-A §4): the default spec of one product priced at every quantity
 * preset of its configurator — the quick calculator's tier table, cacheable, no calculate log.
 */
export class PriceTiersDto {
  @ApiProperty({ example: 'tuck-end-box', description: 'Catalogue product slug' })
  key!: string;

  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({ enum: ['THB'], enumName: 'Currency', example: 'THB' })
  currency!: 'THB';

  @ApiProperty({
    type: PriceHintBasisDto,
    nullable: true,
    description:
      'The default spec the tiers are priced at (D-441) — the spec the configurator opens on; `quantity` is the ' +
      'reference quantity of the "starting from" price. Null when the product has no instant default spec',
  })
  basis!: PriceHintBasisDto | null;

  @ApiProperty({
    type: [QuoteStepDto],
    description:
      'One entry per configurator quantity preset (ascending, ≤ 10), each exactly as `store.quotes.calculate` ' +
      'answers it for the default spec without a delivery postcode (shipping pending). Empty when the product has ' +
      'no instant default spec',
  })
  tiers!: QuoteStepDto[];

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-01T09:00:00+07:00' })
  computedAt!: string | null;
}

export const PRICE_TIERS_EXAMPLE: PriceTiersDto = {
  key: 'tuck-end-box',
  productTypeCode: 'folding_carton',
  currency: 'THB',
  basis: PRICE_HINT_EXAMPLE.basis,
  // Without a delivery postcode: shipping pending, so the totals are the goods (13,380.00 incl. 875.33 VAT).
  tiers: STORE_CALCULATION_EXAMPLE.steps.map((s) => ({
    ...s,
    shippingAmount: null,
    shippingNetAmount: null,
    shippingVatAmount: null,
    shippingPending: true,
    shippingPendingReason: null,
    zoneName: null,
    arrival: null,
    earliestDeliveryDate: null,
    vatAmount: '875.33',
    netAmount: '12504.67',
    grossAmount: '13380.00',
  })),
  computedAt: '2026-10-01T09:00:00+07:00',
};
