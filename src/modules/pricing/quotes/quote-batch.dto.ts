import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  CONFIGURATION_EXAMPLE,
  CONFIGURATION_SCHEMA,
  QuoteCalculationDto,
  STORE_CALCULATION_EXAMPLE,
} from './quote.dto';

/** Most variants one batch prices (the configurator's option cards of one step). */
export const MAX_BATCH_VARIANTS = 24;
/** Most quantities of the optional override (the same cap as a configuration's `quantities`). */
export const MAX_BATCH_QUANTITIES = 10;

export class QuoteBatchVariantDto {
  @ApiProperty({
    example: 'size:s2',
    minLength: 1,
    maxLength: 64,
    description: 'Client id of the variant, echoed in `results`; unique within the request',
  })
  @IsString()
  @Length(1, 64)
  key!: string;

  @ApiProperty(CONFIGURATION_SCHEMA)
  @IsObject()
  configuration!: Record<string, unknown>;
}

export class CalculateQuoteBatchDto {
  @ApiProperty({ example: 'folding_carton', pattern: '^[a-z][a-z0-9_]*$' })
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z][a-z0-9_]*$/)
  productTypeCode!: string;

  @ApiProperty({
    required: false,
    type: [Number],
    example: [500, 1000],
    description:
      'Replaces `configuration.quantities` of every variant (1 to 10 quantities); omit to price each as sent',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH_QUANTITIES)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(10_000_000, { each: true })
  quantities?: number[];

  @ApiProperty({ type: [QuoteBatchVariantDto], minItems: 1, maxItems: MAX_BATCH_VARIANTS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH_VARIANTS)
  @ValidateNested({ each: true })
  @Type(() => QuoteBatchVariantDto)
  variants!: QuoteBatchVariantDto[];
}

export class QuoteBatchProblemDto {
  @ApiProperty({
    example: 'pricing.print_combination_invalid',
    description: 'The error code `calculate` would raise',
  })
  code!: string;

  @ApiProperty({ example: 'The print combination is not offered for this product.' })
  message!: string;
}

export class QuoteBatchResultDto {
  @ApiProperty({ example: 'size:s2' })
  key!: string;

  @ApiProperty({
    type: () => QuoteCalculationDto,
    nullable: true,
    description: 'Null when the variant failed',
  })
  calculation!: QuoteCalculationDto | null;

  @ApiProperty({
    type: () => QuoteBatchProblemDto,
    nullable: true,
    description: 'Null when the variant was priced',
  })
  problem!: QuoteBatchProblemDto | null;
}

export class QuoteBatchCalculationDto {
  @ApiProperty({ type: [QuoteBatchResultDto], description: 'One entry per variant, in request order' })
  results!: QuoteBatchResultDto[];
}

export const CALCULATE_BATCH_EXAMPLE = {
  productTypeCode: 'folding_carton',
  quantities: [1000],
  variants: [
    { key: 'size:s1', configuration: CONFIGURATION_EXAMPLE },
    { key: 'size:s2', configuration: { ...CONFIGURATION_EXAMPLE, w: 80 } },
  ],
};

export const STORE_CALCULATION_BATCH_EXAMPLE: QuoteBatchCalculationDto = {
  results: [
    { key: 'size:s1', calculation: STORE_CALCULATION_EXAMPLE, problem: null },
    {
      key: 'size:s2',
      calculation: null,
      problem: {
        code: 'validation.failed',
        message: 'The request has invalid fields.',
      },
    },
  ],
};
