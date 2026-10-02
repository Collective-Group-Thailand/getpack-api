import { DecimalField, IntField } from '@modules/catalog/crud/dto-fields';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsUUID, ValidateNested } from 'class-validator';

/**
 * Tier-B envelope in the API (D-043, D-234, schema-design A-77). Structural checks here; the dimensions a calculator
 * allows, bands and "at least one dimension" are checked by `parseEnvelope` (422 `validation.failed`).
 */

const EXAMPLE_IDS = {
  printType: '0192f3a0-7c1e-7d2a-9b1f-00000000d101',
  standardSize: '0192f3a0-7c1e-7d2a-9b1f-00000000d201',
  material: '0192f3a0-7c1e-7d2a-9b1f-00000000d301',
};

export class EnvelopeQuantityDto {
  @IntField({
    example: 500,
    nullable: true,
    min: 0,
    max: 10_000_000,
    description: 'Lowest quantity; null = open',
  })
  min!: number | null;

  @IntField({
    example: 20000,
    nullable: true,
    min: 0,
    max: 10_000_000,
    description: 'Highest quantity; null = open',
  })
  max!: number | null;
}

export class EnvelopeSizeRangeDto {
  @DecimalField({ example: 50, nullable: true, unit: 'mm (internal, D-182)', description: 'Smallest width' })
  wMin!: number | null;

  @DecimalField({ example: 250, nullable: true, unit: 'mm (internal, D-182)', description: 'Largest width' })
  wMax!: number | null;

  @DecimalField({ example: 50, nullable: true, unit: 'mm (internal, D-182)', description: 'Smallest length' })
  lMin!: number | null;

  @DecimalField({ example: 350, nullable: true, unit: 'mm (internal, D-182)', description: 'Largest length' })
  lMax!: number | null;

  @DecimalField({
    example: null,
    nullable: true,
    unit: 'mm (internal, D-182)',
    description: 'Smallest depth',
  })
  dMin!: number | null;

  @DecimalField({ example: null, nullable: true, unit: 'mm (internal, D-182)', description: 'Largest depth' })
  dMax!: number | null;
}

const refList = (example: string[], description: string) => [
  ApiPropertyOptional({ type: [String], format: 'uuid', example, description }),
  IsOptional(),
  IsArray(),
  ArrayMinSize(1),
  ArrayMaxSize(200),
  IsUUID('all', { each: true }),
];

const apply =
  (decorators: PropertyDecorator[]): PropertyDecorator =>
  (target, key) => {
    for (const d of decorators) d(target, key);
  };

export class TierBEnvelopeDto {
  @ApiPropertyOptional({ type: EnvelopeQuantityDto, description: 'Quantities covered' })
  @IsOptional()
  @ValidateNested()
  @Type(() => EnvelopeQuantityDto)
  quantity?: EnvelopeQuantityDto;

  @apply(refList([EXAMPLE_IDS.printType], 'Print types covered'))
  printTypeIds?: string[];

  @ApiPropertyOptional({
    type: [EnvelopeSizeRangeDto],
    description: 'Sizes covered (one size dimension with the standard sizes)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => EnvelopeSizeRangeDto)
  sizeRanges?: EnvelopeSizeRangeDto[];

  @apply(refList([EXAMPLE_IDS.standardSize], 'Standard sizes covered'))
  standardSizeIds?: string[];

  @apply(refList(['0192f3a0-7c1e-7d2a-9b1f-00000000d401'], 'Patterns covered'))
  patternIds?: string[];

  @apply(refList([EXAMPLE_IDS.material], 'Materials covered'))
  materialIds?: string[];

  @apply(refList(['0192f3a0-7c1e-7d2a-9b1f-00000000d501'], 'Stock products covered (standard products)'))
  stockProductIds?: string[];

  @apply(refList(['0192f3a0-7c1e-7d2a-9b1f-00000000d601'], 'Service items covered (services)'))
  catalogProductIds?: string[];
}

export const ENVELOPE_EXAMPLE = {
  quantity: { min: 500, max: 20000 },
  printTypeIds: [EXAMPLE_IDS.printType],
  standardSizeIds: [EXAMPLE_IDS.standardSize],
  materialIds: [EXAMPLE_IDS.material],
};
