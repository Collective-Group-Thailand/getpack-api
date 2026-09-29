import { DecimalField, EnumField, IntField, RefField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { DesignOptionsDto, IDS } from './quote.dto';

/** Corrugate configuration DTOs (U-B6): catalogue public ids, millimetres. */

export const PRINT_AREAS = ['top', 'side', 'top_side', 'all_round'] as const;

export const CORRUGATE_IDS = {
  pattern: '0192f3a0-7c1e-7d2a-9b1f-00000000b101',
  board: '0192f3a0-7c1e-7d2a-9b1f-00000000b102',
  subPattern: '0192f3a0-7c1e-7d2a-9b1f-00000000b103',
  coating: '0192f3a0-7c1e-7d2a-9b1f-00000000b104',
  assembly: '0192f3a0-7c1e-7d2a-9b1f-00000000b105',
};

const MM = { unit: 'mm', scale: 2 };

export class CorrugatePrintColourDto {
  @RefField({ example: IDS.ink })
  inkColourId!: string;

  @EnumField(PRINT_AREAS, 'CorrugatePrintArea', {
    example: 'top',
    optional: true,
    description:
      'Where the colour prints (legacy pattern areas top, side, top + side, all round); the % of the blank follows ' +
      'from the box. Give this or `percent`.',
  })
  area?: (typeof PRINT_AREAS)[number];

  @ApiPropertyOptional({
    example: 30,
    minimum: 0,
    maximum: 100,
    description: 'The % of the blank the colour covers, when no area is given',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  percent?: number;
}

export class CorrugateAssemblyDto {
  @RefField({
    example: CORRUGATE_IDS.assembly,
    description: 'Window film, handle, insert… (not packing: automatic)',
  })
  assemblyId!: string;

  @IntField({
    example: 1,
    optional: true,
    min: 1,
    max: 100,
    description: 'Pieces per box, when the assembly takes sizes',
  })
  amount?: number;

  @DecimalField({ example: 80, optional: true, ...MM, description: 'Width of a piece' })
  w?: number;

  @DecimalField({ example: 100, optional: true, ...MM, description: 'Length of a piece' })
  l?: number;
}

export class CorrugatePartDto {
  @RefField({
    example: CORRUGATE_IDS.subPattern,
    optional: true,
    description: 'The part of a combination (Tele body / lid, slide tray / sleeve)',
  })
  subPatternId?: string;

  @ApiPropertyOptional({ type: [CorrugatePrintColourDto], description: 'Colours printed outside' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => CorrugatePrintColourDto)
  printFront?: CorrugatePrintColourDto[];

  @ApiPropertyOptional({ type: [CorrugatePrintColourDto], description: 'Colours printed inside' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => CorrugatePrintColourDto)
  printBack?: CorrugatePrintColourDto[];

  @RefField({
    example: CORRUGATE_IDS.coating,
    optional: true,
    description: 'Coating outside (digital, coatable board)',
  })
  coatingFrontId?: string;

  @RefField({
    example: CORRUGATE_IDS.coating,
    optional: true,
    description: 'Coating inside (digital, coatable board)',
  })
  coatingBackId?: string;

  @ApiPropertyOptional({ type: [CorrugateAssemblyDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => CorrugateAssemblyDto)
  assemblies?: CorrugateAssemblyDto[];
}

export class CorrugateConfigurationDto {
  @RefField({ example: CORRUGATE_IDS.pattern })
  patternId!: string;

  @RefField({
    example: IDS.pattern,
    optional: true,
    description:
      'The catalogue product: its standard sizes carry no die block (legacy `recheckStandardSize`)',
  })
  catalogProductId?: string;

  @DecimalField({ example: 300, positive: true, ...MM, description: 'Box width' })
  w!: number;

  @DecimalField({ example: 400, positive: true, ...MM, description: 'Box length' })
  l!: number;

  @DecimalField({ example: 250, ...MM, description: 'Box height (0 for a flat sheet)' })
  d!: number;

  @RefField({
    example: CORRUGATE_IDS.board,
    description: 'The corrugated board; its flute is the box’s flute',
  })
  materialId!: string;

  @RefField({ example: IDS.difficulty })
  difficultyLevelId!: string;

  @ApiProperty({ type: [Number], example: [500, 1000, 3000], description: 'Quantities to price, 1 to 10' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(10_000_000, { each: true })
  quantities!: number[];

  @ApiProperty({ type: [CorrugatePartDto], description: 'One entry per part (one for single-part patterns)' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => CorrugatePartDto)
  parts!: CorrugatePartDto[];

  @ApiPropertyOptional({ type: DesignOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DesignOptionsDto)
  design?: DesignOptionsDto;
}

/** CS may price digital print on the colours' coverage (legacy `printing_calculate_type` 2). */
export class CsCorrugateConfigurationDto extends CorrugateConfigurationDto {
  @DecimalField({
    example: 60,
    optional: true,
    scale: 2,
    description:
      'Digital only: the outside print covers this % of the blank (legacy CS option `printing_calculate_type` 2); ' +
      'omit for the whole blank',
  })
  @Max(100)
  digitalFrontCoveragePct?: number;
}

export const CORRUGATE_CONFIGURATION_EXAMPLE = {
  patternId: CORRUGATE_IDS.pattern,
  w: 300,
  l: 400,
  d: 250,
  materialId: CORRUGATE_IDS.board,
  difficultyLevelId: IDS.difficulty,
  quantities: [1000],
  parts: [{ printFront: [{ inkColourId: IDS.ink, area: 'top' }] }],
  design: { graphic: false, structure: false },
};
