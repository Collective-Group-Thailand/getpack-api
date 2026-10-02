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
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { DesignOptionsDto, IDS, MAX_QUANTITY_TIERS } from './quote.dto';

/** Label configuration DTOs (U-B6 label): catalogue public ids, millimetres. */

export const LABEL_IDS = {
  catalogProduct: '0192f3a0-7c1e-7d2a-9b1f-00000000c101',
  labelStock: '0192f3a0-7c1e-7d2a-9b1f-00000000c102',
  coating: '0192f3a0-7c1e-7d2a-9b1f-00000000c103',
  diecut: '0192f3a0-7c1e-7d2a-9b1f-00000000c104',
};

const MM = { unit: 'mm', scale: 2 };

export class LabelPrintSideDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    example: [IDS.ink],
    description: 'Ink colours printed on this side (a process colour such as CMYK is one colour)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsUUID('all', { each: true })
  inkColourIds!: string[];
}

export class LabelConfigurationDto {
  @RefField({
    example: LABEL_IDS.catalogProduct,
    optional: true,
    description:
      'The catalogue product (required on the store, where the difficulty level must be the product’s own); staff ' +
      'may price without one',
  })
  catalogProductId?: string;

  @BasisField('flat')
  basis?: MeasurementBasis;

  @DecimalField({
    example: 50,
    positive: true,
    ...MM,
    description: 'Label width — the bounding box of any shape (legacy prices W × L only)',
  })
  w!: number;

  @DecimalField({ example: 70, positive: true, ...MM, description: 'Label length' })
  l!: number;

  @RefField({ example: LABEL_IDS.labelStock, description: 'The label stock (a `label_stock` material)' })
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
    type: LabelPrintSideDto,
    description: 'Print on the face; omit for an unprinted label',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => LabelPrintSideDto)
  printFront?: LabelPrintSideDto;

  @ApiPropertyOptional({ type: LabelPrintSideDto, description: 'Print on the back' })
  @IsOptional()
  @ValidateNested()
  @Type(() => LabelPrintSideDto)
  printBack?: LabelPrintSideDto;

  @RefField({ example: LABEL_IDS.coating, optional: true, description: 'Coating on the face' })
  finishFrontId?: string;

  @RefField({ example: LABEL_IDS.coating, optional: true, description: 'Coating on the back' })
  finishBackId?: string;

  @RefField({ example: LABEL_IDS.diecut, optional: true, description: 'Die-cut (kiss cut, through cut…)' })
  diecutTypeId?: string;

  @ApiPropertyOptional({
    type: DesignOptionsDto,
    description: 'Graphic design only (labels have no structure fee)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DesignOptionsDto)
  design?: DesignOptionsDto;
}

export const LABEL_CONFIGURATION_EXAMPLE = {
  catalogProductId: LABEL_IDS.catalogProduct,
  w: 50,
  l: 70,
  materialId: LABEL_IDS.labelStock,
  difficultyLevelId: IDS.difficulty,
  quantities: [1000],
  printFront: { inkColourIds: [IDS.ink] },
  diecutTypeId: LABEL_IDS.diecut,
  design: { graphic: false, structure: false },
};
