import { RefField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { DesignOptionsDto, MAX_QUANTITY_TIERS } from './quote.dto';

/** Standard-product configuration DTO (U-B6 standard product): a ready-made stock product and the quantities. */

export const STANDARD_PRODUCT_IDS = {
  stockProduct: '0192f3a0-7c1e-7d2a-9b1f-00000000e201',
};

export class StandardProductConfigurationDto {
  @RefField({
    example: STANDARD_PRODUCT_IDS.stockProduct,
    description: 'The stock product (a standard product SKU)',
  })
  stockProductId!: string;

  @ApiProperty({
    type: [Number],
    example: [500, 1000],
    description: 'Quantities to price in the product’s unit, 1 to 10',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_QUANTITY_TIERS)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(10_000_000, { each: true })
  quantities!: number[];

  @ApiPropertyOptional({
    type: DesignOptionsDto,
    description: 'Graphic design only (printable standard products; no structure fee)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DesignOptionsDto)
  design?: DesignOptionsDto;
}

export const STANDARD_PRODUCT_CONFIGURATION_EXAMPLE = {
  stockProductId: STANDARD_PRODUCT_IDS.stockProduct,
  quantities: [500, 1000],
  design: { graphic: false, structure: false },
};
