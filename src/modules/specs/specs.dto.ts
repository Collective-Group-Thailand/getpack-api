import { DecimalField, EnumField, RefField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

import { MEASUREMENT_BASES } from './dimension-conversion';

/** Sizes on a measurement basis (D-182); always millimetres (D-183). */

const MM = { unit: 'mm', scale: 2 } as const;
export const CONSTRUCTION_FAMILIES = ['box', 'tray', 'sleeve', 'flat'] as const;

export class ConvertDimensionsDto {
  @ApiProperty({ example: 'folding_carton', pattern: '^[a-z][a-z0-9_]*$', description: 'The product type' })
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z][a-z0-9_]*$/)
  productTypeCode!: string;

  @RefField({
    example: '0192f3a0-7c1e-7d2a-9b1f-00000000a101',
    optional: true,
    description:
      'The style; it decides how the box closes (box, tray, sleeve or flat). Without one: a closed box',
  })
  patternId?: string;

  @RefField({
    example: '0192f3a0-7c1e-7d2a-9b1f-00000000a201',
    optional: true,
    description:
      'The material, whose caliper converts between bases; without one only the given basis is known',
  })
  materialId?: string;

  @EnumField(MEASUREMENT_BASES, 'MeasurementBasis', {
    example: 'internal',
    description: 'The basis the sizes are given on (D-182)',
  })
  basis!: (typeof MEASUREMENT_BASES)[number];

  @DecimalField({ example: 100, positive: true, ...MM, description: 'Width' })
  w!: number;

  @DecimalField({ example: 150, positive: true, ...MM, description: 'Length' })
  l!: number;

  @DecimalField({ example: 50, optional: true, ...MM, description: 'Depth; 0 or absent for a flat product' })
  d?: number;
}

export class SizeDto {
  @ApiProperty({ type: Number, example: 100, description: 'Width, mm' })
  w!: number;

  @ApiProperty({ type: Number, example: 150, description: 'Length, mm' })
  l!: number;

  @ApiProperty({ type: Number, example: 50, description: 'Depth, mm' })
  d!: number;
}

export class BasisSizesDto {
  @ApiProperty({
    type: SizeDto,
    nullable: true,
    example: { w: 100, l: 150, d: 50 },
    description: 'Inside size',
  })
  internal!: SizeDto | null;

  @ApiProperty({
    type: SizeDto,
    nullable: true,
    example: { w: 101, l: 151, d: 51 },
    description: 'Outside size',
  })
  external!: SizeDto | null;

  @ApiProperty({
    type: SizeDto,
    nullable: true,
    example: { w: 100.5, l: 150.5, d: 51 },
    description: 'Score-to-score size of the blank',
  })
  overCrease!: SizeDto | null;

  @ApiProperty({
    type: SizeDto,
    nullable: true,
    example: null,
    description: 'Finished size of a flat product',
  })
  product!: SizeDto | null;
}

export class ConvertedDimensionsDto {
  @ApiProperty({ enum: CONSTRUCTION_FAMILIES, enumName: 'ConstructionFamily', example: 'box' })
  family!: (typeof CONSTRUCTION_FAMILIES)[number];

  @ApiProperty({
    enum: MEASUREMENT_BASES,
    enumName: 'MeasurementBasis',
    isArray: true,
    example: ['internal', 'external', 'over_crease'],
  })
  bases!: (typeof MEASUREMENT_BASES)[number][];

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 0.5,
    description: 'Caliper used, mm; null when unknown',
  })
  caliperMm!: number | null;

  @ApiProperty({ example: '1.0.0', description: 'Conversion rules version (frozen on quotes)' })
  conversionVersion!: string;

  @ApiProperty({ type: BasisSizesDto, description: 'Each basis; null where a caliper is needed and unknown' })
  sizes!: BasisSizesDto;
}

export const CONVERTED_EXAMPLE: ConvertedDimensionsDto = {
  family: 'box',
  bases: ['internal', 'external', 'over_crease'],
  caliperMm: 0.5,
  conversionVersion: '1.0.0',
  sizes: {
    internal: { w: 100, l: 150, d: 50 },
    external: { w: 101, l: 151, d: 51 },
    overCrease: { w: 100.5, l: 150.5, d: 51 },
    product: null,
  },
};
