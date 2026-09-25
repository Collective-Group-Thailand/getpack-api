import { RefField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

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

  @ApiProperty({ enum: QUOTE_PATH_REASONS, enumName: 'QuotePathReason', example: 'type_rfq_only' })
  reason!: QuotePathReason;
}

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

  @ApiProperty({ type: 'integer', nullable: true, example: 2, description: 'Price-list version in force' })
  priceListVersionNo!: number | null;

  @ApiProperty({ type: String, nullable: true, example: '12000.000' })
  weeklyCapacity!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'sheets' })
  capacityUnit!: string | null;
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

  @ApiProperty({ type: [CoverageFactoryDto], description: 'Factories with a capability for the type' })
  factories!: CoverageFactoryDto[];
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
  factories: [
    {
      factoryId: IDS.factory,
      factoryCode: 'PRINTCO',
      factoryStatus: 'active',
      capabilityStatus: 'active',
      tier: 'A',
      priceListVersionNo: 2,
      weeklyCapacity: '12000.000',
      capacityUnit: 'sheets',
    },
  ],
};
