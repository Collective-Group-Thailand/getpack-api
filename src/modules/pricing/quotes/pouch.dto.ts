import { DecimalField, RefField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { DesignOptionsDto, MAX_QUANTITY_TIERS } from './quote.dto';

/**
 * Pouch configuration DTO (U-B6 pouch): a pouch pattern (its shape), W × L and the gussets / centre seal the shape
 * needs, the laminated film, the print colour set and the options (legacy `pouch/cs.vue:749-790`). Catalogue public
 * ids, millimetres.
 */

export const POUCH_IDS = {
  catalogProduct: '0192f3a0-7c1e-7d2a-9b1f-00000000e101',
  pattern: '0192f3a0-7c1e-7d2a-9b1f-00000000e102',
  film: '0192f3a0-7c1e-7d2a-9b1f-00000000e103',
  printColour: '0192f3a0-7c1e-7d2a-9b1f-00000000e104',
  zipper: '0192f3a0-7c1e-7d2a-9b1f-00000000e105',
  tearNotch: '0192f3a0-7c1e-7d2a-9b1f-00000000e106',
};

const MM = { unit: 'mm', scale: 2 };

export class PouchConfigurationDto {
  @RefField({
    example: POUCH_IDS.pattern,
    description: 'A pouch pattern: its shape (3-side seal, stand-up…)',
  })
  patternId!: string;

  @RefField({
    example: POUCH_IDS.catalogProduct,
    optional: true,
    description: 'The catalogue product (required on the store); staff may price without one',
  })
  catalogProductId?: string;

  @DecimalField({ example: 140, positive: true, ...MM, description: 'Pouch width, seals included' })
  w!: number;

  @DecimalField({ example: 200, positive: true, ...MM, description: 'Pouch height, seals included' })
  l!: number;

  @DecimalField({
    example: 60,
    optional: true,
    positive: true,
    ...MM,
    description: 'Bottom gusset (stand-up pouch), seal included',
  })
  b?: number;

  @DecimalField({
    example: 30,
    optional: true,
    positive: true,
    ...MM,
    description: 'Side gusset (centre-seal gusset and quad-seal pouches), seal included',
  })
  s?: number;

  @DecimalField({
    example: 10,
    optional: true,
    positive: true,
    ...MM,
    description: 'Centre seal (pillow and centre-seal gusset pouches)',
  })
  cs?: number;

  @RefField({
    example: POUCH_IDS.film,
    description: 'The laminated film (a `film` material: structure and micron)',
  })
  materialId!: string;

  @RefField({
    example: POUCH_IDS.printColour,
    optional: true,
    description: 'The print colour set (e.g. CMYK gloss, CMYK + matt OPV); omit for an unprinted pouch',
  })
  printColourId?: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    example: [POUCH_IDS.zipper, POUCH_IDS.tearNotch],
    description: 'Options: zipper, valve, spout, tear notch, white base… (catalogue assemblies), each once',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  optionIds?: string[];

  @ApiProperty({ type: [Number], example: [3000, 5000], description: 'Quantities to price, 1 to 10' })
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
    description: 'Graphic design only (pouches have no structure fee)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DesignOptionsDto)
  design?: DesignOptionsDto;
}

export const POUCH_CONFIGURATION_EXAMPLE = {
  patternId: POUCH_IDS.pattern,
  catalogProductId: POUCH_IDS.catalogProduct,
  w: 140,
  l: 200,
  b: 60,
  materialId: POUCH_IDS.film,
  printColourId: POUCH_IDS.printColour,
  optionIds: [POUCH_IDS.zipper, POUCH_IDS.tearNotch],
  quantities: [3000],
  design: { graphic: false, structure: false },
};
