import { DecimalField, RefField } from '@modules/catalog/crud/dto-fields';
import { type MeasurementBasis } from '@modules/specs/dimension-conversion';
import { BasisField } from '@modules/specs/specs.dto';
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

import {
  DesignOptionsDto,
  Finish2Dto,
  IDS,
  MAX_QUANTITY_TIERS,
  PrintColourDto,
  QuoteAssemblyInputDto,
} from './quote.dto';

/**
 * Tag & sleeve configuration DTO (U-B6 tag & sleeve): one flat blank — W × L, no depth, no parts — with the folding
 * processes (legacy `cs-v2.vue:1605-1666` → `CStoFactoryFolding`). Catalogue public ids, millimetres.
 */

export const TAG_SLEEVE_IDS = {
  catalogProduct: '0192f3a0-7c1e-7d2a-9b1f-00000000d101',
  pattern: '0192f3a0-7c1e-7d2a-9b1f-00000000d102',
  hole: '0192f3a0-7c1e-7d2a-9b1f-00000000d103',
  cornerCut: '0192f3a0-7c1e-7d2a-9b1f-00000000d104',
};

const MM = { unit: 'mm', scale: 2 };

export class TagSleeveConfigurationDto {
  @RefField({ example: TAG_SLEEVE_IDS.pattern, description: 'A tag & sleeve pattern (one flat blank)' })
  patternId!: string;

  @RefField({
    example: TAG_SLEEVE_IDS.catalogProduct,
    optional: true,
    description:
      'The catalogue product (required on the store, where the difficulty level must be the product’s own); staff ' +
      'may price without one',
  })
  catalogProductId?: string;

  @BasisField('flat')
  basis?: MeasurementBasis;

  @DecimalField({ example: 50, positive: true, ...MM, description: 'Tag or sleeve width (flat)' })
  w!: number;

  @DecimalField({
    example: 90,
    positive: true,
    ...MM,
    description: 'Tag or sleeve length (flat, no glue flap)',
  })
  l!: number;

  @RefField({ example: IDS.material, description: 'The paper or board' })
  materialId!: string;

  @RefField({ example: IDS.difficulty })
  difficultyLevelId!: string;

  @ApiProperty({ type: [Number], example: [500, 1000, 3000], description: 'Quantities to price, 1 to 10' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_QUANTITY_TIERS)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(10_000_000, { each: true })
  quantities!: number[];

  @ApiPropertyOptional({
    type: [PrintColourDto],
    description: 'Colours printed on the front; a process set is its colour four times',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => PrintColourDto)
  printFront?: PrintColourDto[];

  @ApiPropertyOptional({ type: [PrintColourDto], description: 'Colours printed on the back' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => PrintColourDto)
  printBack?: PrintColourDto[];

  @RefField({ example: IDS.finish, optional: true, description: 'Coating or lamination, front' })
  finish1FrontId?: string;

  @RefField({ example: IDS.finish, optional: true, description: 'Coating or lamination, back' })
  finish1BackId?: string;

  @ApiPropertyOptional({
    type: [Finish2Dto],
    description: 'Foil, spot UV, emboss or deboss — printed offset only (legacy, port map T9)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => Finish2Dto)
  finish2?: Finish2Dto[];

  @RefField({ example: IDS.diecut, description: 'The die-cut (a tag is always die-cut)' })
  diecutTypeId!: string;

  @ApiPropertyOptional({
    type: [QuoteAssemblyInputDto],
    description: 'Hole, corner cut, string, eyelet…',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => QuoteAssemblyInputDto)
  assemblies?: QuoteAssemblyInputDto[];

  @ApiPropertyOptional({
    type: DesignOptionsDto,
    description: 'Graphic design only (tags and sleeves have no structure fee)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DesignOptionsDto)
  design?: DesignOptionsDto;
}

export const TAG_SLEEVE_CONFIGURATION_EXAMPLE = {
  patternId: TAG_SLEEVE_IDS.pattern,
  catalogProductId: TAG_SLEEVE_IDS.catalogProduct,
  w: 50,
  l: 90,
  materialId: IDS.material,
  difficultyLevelId: IDS.difficulty,
  quantities: [1000],
  printFront: [1, 2, 3, 4].map(() => ({ inkColourId: IDS.ink, percent: 100 })),
  finish1FrontId: IDS.finish,
  diecutTypeId: IDS.diecut,
  assemblies: [{ assemblyId: TAG_SLEEVE_IDS.hole }, { assemblyId: TAG_SLEEVE_IDS.cornerCut }],
  design: { graphic: false, structure: false },
};
