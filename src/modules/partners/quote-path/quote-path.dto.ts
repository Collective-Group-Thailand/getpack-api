import { storeEnum } from '@common/labels/store-words';
import { RefField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import { ENVELOPE_EXAMPLE, TierBEnvelopeDto } from '../configuration/tier-b-envelope.dto';

export const QUOTE_PATH_REASONS = [
  'instant_available',
  'type_rfq_only',
  'no_active_factory',
  'no_price_list',
  'envelope_not_covered',
] as const;
export type QuotePathReason = (typeof QUOTE_PATH_REASONS)[number];

const IDS = {
  productType: '0192f3a0-7c1e-7d2a-9b1f-00000000c002',
  factory: '0192f3a0-7c1e-7d2a-9b1f-00000000f001',
};

export class QuotePathRequestDto {
  @ApiProperty({ example: 'folding_carton', pattern: '^[a-z][a-z0-9_]*$' })
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z][a-z0-9_]*$/)
  productTypeCode!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { patternCode: 'tuck-end', widthMm: 60, lengthMm: 40, heightMm: 120, quantity: 1000 },
    description: 'The configurator state; tier-B coverage is matched against it (D-043)',
  })
  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;
}

export class QuotePathDto {
  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({
    enum: ['instant', 'rfq'],
    enumName: 'QuoteMode',
    example: 'rfq',
    description: '`instant` = a price can be calculated now; otherwise the configurator routes to RFQ',
  })
  mode!: 'instant' | 'rfq';

  @ApiProperty({
    enum: storeEnum(QUOTE_PATH_REASONS),
    enumName: 'StoreQuotePathReason',
    example: 'type_rfq_only',
    description: '`not_instant`: no instant price for this configuration — request a quotation (D-440)',
  })
  reason!: QuotePathReason;
}

export const PRODUCT_AVAILABILITIES = ['instant', 'partial', 'rfq'] as const;
export type ProductAvailability = (typeof PRODUCT_AVAILABILITIES)[number];

/** What a customer may know about a type's instant paths (D-043, D-234): never a factory (D-050, D-044). */
export class ProductTypeAvailabilityDto {
  @ApiProperty({ format: 'uuid', example: IDS.productType })
  productTypeId!: string;

  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({
    enum: PRODUCT_AVAILABILITIES,
    enumName: 'ProductAvailability',
    example: 'partial',
    description: 'instant: priced online · partial: priced online inside `envelope`, RFQ outside it · rfq',
  })
  availability!: ProductAvailability;

  @ApiProperty({
    type: TierBEnvelopeDto,
    nullable: true,
    example: ENVELOPE_EXAMPLE,
    description:
      'partial only: what the instant paths cover together (a dimension is listed only when every path restricts it)',
  })
  envelope!: TierBEnvelopeDto | null;
}

export const AVAILABILITY_EXAMPLE: ProductTypeAvailabilityDto = {
  productTypeId: IDS.productType,
  productTypeCode: 'folding_carton',
  availability: 'partial',
  envelope: ENVELOPE_EXAMPLE,
};

export class CoverageFactoryDto {
  @ApiProperty({ format: 'uuid', example: IDS.factory })
  factoryId!: string;

  @ApiProperty({ example: 'PRINTCO' })
  factoryCode!: string;

  @ApiProperty({ example: 'active' })
  factoryStatus!: string;

  @ApiProperty({ enum: ['active', 'inactive'], enumName: 'CapabilityStatus', example: 'active' })
  capabilityStatus!: 'active' | 'inactive';

  @ApiProperty({ enum: ['A', 'B', 'C'], enumName: 'ParticipationTier', nullable: true, example: 'A' })
  tier!: 'A' | 'B' | 'C' | null;

  @ApiProperty({
    type: TierBEnvelopeDto,
    nullable: true,
    example: null,
    description: 'Tier B: what the path covers (D-234); null for tier A / C',
  })
  envelope!: TierBEnvelopeDto | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Tier B: human summary' })
  envelopeNote!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 2, description: 'Price-list version in force' })
  priceListVersionNo!: number | null;

  @ApiProperty({ type: String, nullable: true, example: '12000.000' })
  weeklyCapacity!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'sheets' })
  capacityUnit!: string | null;
}

/** The last 90 days of demand for a product type (U1 §U-B3 item 7, D-043, D-102). */
export class CoverageDemandDto {
  @ApiProperty({
    type: 'integer',
    example: 120,
    description: 'Calculations of the type (store and CS) in the window',
  })
  calculations!: number;

  @ApiProperty({
    type: 'integer',
    example: 96,
    description: 'Of which an instant path priced the configuration',
  })
  instantCalculations!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '80.0',
    description: 'instantCalculations ÷ calculations, in %, one decimal; null without calculations',
  })
  instantCoveragePct!: string | null;

  @ApiProperty({ type: 'integer', example: 14, description: 'RFQs created for the type in the window' })
  rfqs!: number;
}

export class ProductTypeCoverageDto {
  @ApiProperty({ format: 'uuid', example: IDS.productType })
  productTypeId!: string;

  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({ enum: ['instant', 'rfq'], enumName: 'QuoteMode', example: 'rfq' })
  quoteMode!: 'instant' | 'rfq';

  @ApiProperty({
    enum: QUOTE_PATH_REASONS,
    enumName: 'QuotePathReason',
    example: 'type_rfq_only',
    description: 'Instant path for a configuration inside every envelope (tier A), else why not',
  })
  instantPath!: QuotePathReason;

  @ApiProperty({
    enum: PRODUCT_AVAILABILITIES,
    enumName: 'ProductAvailability',
    example: 'rfq',
    description: 'instant (a tier-A path) · partial (tier-B paths only, D-234) · rfq',
  })
  availability!: ProductAvailability;

  @ApiProperty({ type: [CoverageFactoryDto], description: 'Factories with a capability for the type' })
  factories!: CoverageFactoryDto[];

  @ApiProperty({ type: CoverageDemandDto, description: 'The last 90 days: instant coverage and RFQ volume' })
  last90Days!: CoverageDemandDto;
}

export class CoverageQuery {
  @RefField({ example: IDS.productType, optional: true })
  productTypeId?: string;
}

export const COVERAGE_EXAMPLE: ProductTypeCoverageDto = {
  productTypeId: IDS.productType,
  productTypeCode: 'folding_carton',
  quoteMode: 'rfq',
  instantPath: 'type_rfq_only',
  availability: 'rfq',
  factories: [
    {
      factoryId: IDS.factory,
      factoryCode: 'PRINTCO',
      factoryStatus: 'active',
      capabilityStatus: 'active',
      tier: 'A',
      envelope: null,
      envelopeNote: null,
      priceListVersionNo: 2,
      weeklyCapacity: '12000.000',
      capacityUnit: 'sheets',
    },
  ],
  last90Days: { calculations: 120, instantCalculations: 96, instantCoveragePct: '80.0', rfqs: 14 },
};
