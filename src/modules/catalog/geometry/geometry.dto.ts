import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNumber, Max, Min, ValidateNested } from 'class-validator';

import {
  CATALOG_STATUSES,
  CodeField,
  DecimalField,
  EnumField,
  IdField,
  IntField,
  RefField,
  SNAKE_CODE,
  StatusField,
  TextField,
  TimestampField,
} from '../crud/dto-fields';

/** Geometry data of the ported calculators (legacy `conditions`, `calculate_conditions`, `pattern.condition_*`, `pattern_rel_standard_sizes`; schema-design A-25, A-49). */

type Status = (typeof CATALOG_STATUSES)[number];
const TS = '2026-09-29T10:00:00+07:00';

export const GEOMETRY_DETERMINANTS = ['w', 'l', 'd', 'x', 'c', 'w_over_l'] as const;
export const GEOMETRY_SLOTS = ['dw', 'dl', 'nd', 'nl', 'nw', 'aux_f', 'aux_f10', 'i', 'j', 'k', 'm'] as const;
export type GeometryDeterminantValue = (typeof GEOMETRY_DETERMINANTS)[number];
export type GeometrySlotValue = (typeof GEOMETRY_SLOTS)[number];

export const GEOMETRY_IDS = {
  bandTable: '0192f3a0-7c1e-7d2a-9b1f-00000000e001',
  condition: '0192f3a0-7c1e-7d2a-9b1f-00000000e002',
  pattern: '0192f3a0-7c1e-7d2a-9b1f-00000000e003',
  subPattern: '0192f3a0-7c1e-7d2a-9b1f-00000000e004',
  standardSize: '0192f3a0-7c1e-7d2a-9b1f-00000000e005',
} as const;

const DETERMINANT_DESCRIPTION =
  'The box dimension the band table is read by: `w`, `l`, `d`, `x`, `c` (folding), `w_over_l` (W ÷ L, corrugate `j`)';
const SLOT_DESCRIPTION =
  'Folding slots `dw dl nd nl nw aux_f aux_f10`; corrugate slots `i j k m` (read by W, W ÷ L, W, W)';

class StatusQuery extends PageQuery {
  @EnumField(CATALOG_STATUSES, 'CatalogStatus', { example: 'active', optional: true })
  status?: Status;
}

// ------------------------------------------------------------------------------------------------
// Band tables
// ------------------------------------------------------------------------------------------------

export class GeometryBandDto {
  @ApiProperty({ type: Number, example: 0, description: 'Lower bound, inclusive' })
  lower!: number;

  @ApiProperty({ type: Number, example: 100, description: 'Upper bound, inclusive' })
  upper!: number;

  @ApiProperty({ type: Number, example: 12.5, description: 'The allowance read for a dimension in the band' })
  value!: number;
}

export class GeometryBandInputDto {
  @DecimalField({ example: 0, scale: 4, description: 'Lower bound, inclusive' })
  lower!: number;

  @DecimalField({ example: 100, scale: 4, description: 'Upper bound, inclusive; at least `lower`' })
  upper!: number;

  @ApiProperty({
    type: Number,
    example: 12.5,
    description: 'The allowance read for a dimension in the band (may be negative; 4 decimals)',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4, allowNaN: false, allowInfinity: false })
  @Min(-99_999_999)
  @Max(99_999_999)
  value!: number;
}

export class GeometryBandTableDto {
  @IdField(GEOMETRY_IDS.bandTable)
  id!: string;

  @ApiProperty({ example: 'rte_dw' })
  code!: string;

  @ApiProperty({ example: 'ฝาเสียบ — ระยะเผื่อ DW' })
  name!: string;

  @ApiProperty({
    type: [GeometryBandDto],
    description: 'Bands in evaluation order; bounds inclusive, never overlapping (legacy `conditions`)',
  })
  bands!: GeometryBandDto[];

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: Status;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateGeometryBandTableDto {
  @CodeField({ example: 'rte_dw', pattern: SNAKE_CODE })
  code!: string;

  @TextField({ example: 'ฝาเสียบ — ระยะเผื่อ DW' })
  name!: string;

  @StatusField()
  status?: Status;
}

export class UpdateGeometryBandTableDto extends PartialType(CreateGeometryBandTableDto) {}

export class ReplaceGeometryBandsDto {
  @ApiProperty({
    type: [GeometryBandInputDto],
    description: 'Every band of the table, in evaluation order (the whole set is replaced)',
  })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => GeometryBandInputDto)
  bands!: GeometryBandInputDto[];
}

export class GeometryBandTableListQuery extends StatusQuery {}

// ------------------------------------------------------------------------------------------------
// Conditions
// ------------------------------------------------------------------------------------------------

export class GeometryConditionDto {
  @IdField(GEOMETRY_IDS.condition)
  id!: string;

  @ApiProperty({ example: 'rte_dw_by_w' })
  code!: string;

  @ApiProperty({ type: String, format: 'uuid', example: GEOMETRY_IDS.bandTable })
  bandTableId!: string;

  @ApiProperty({ example: 'a', description: 'Legacy variable name (only the lock-bottom formula reads `b`)' })
  variable!: string;

  @ApiProperty({
    enum: GEOMETRY_DETERMINANTS,
    enumName: 'GeometryDeterminant',
    example: 'w',
    description: DETERMINANT_DESCRIPTION,
  })
  determinant!: GeometryDeterminantValue;

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: Status;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateGeometryConditionDto {
  @CodeField({ example: 'rte_dw_by_w', pattern: SNAKE_CODE })
  code!: string;

  @RefField({ example: GEOMETRY_IDS.bandTable })
  bandTableId!: string;

  @CodeField({
    example: 'a',
    pattern: SNAKE_CODE,
    description: 'Legacy variable name (only the lock-bottom formula reads `b`)',
  })
  variable!: string;

  @EnumField(GEOMETRY_DETERMINANTS, 'GeometryDeterminant', {
    example: 'w',
    description: DETERMINANT_DESCRIPTION,
  })
  determinant!: GeometryDeterminantValue;

  @StatusField()
  status?: Status;
}

export class UpdateGeometryConditionDto extends PartialType(CreateGeometryConditionDto) {}

export class GeometryConditionListQuery extends StatusQuery {
  @RefField({ example: GEOMETRY_IDS.bandTable, optional: true })
  bandTableId?: string;

  @EnumField(GEOMETRY_DETERMINANTS, 'GeometryDeterminant', { example: 'w', optional: true })
  determinant?: GeometryDeterminantValue;
}

// ------------------------------------------------------------------------------------------------
// Pattern geometry: condition slots and standard blanks
// ------------------------------------------------------------------------------------------------

export class PatternConditionSlotDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'The part the slot belongs to; null for the pattern itself',
  })
  subPatternId!: string | null;

  @ApiProperty({
    enum: GEOMETRY_SLOTS,
    enumName: 'GeometrySlot',
    example: 'dw',
    description: SLOT_DESCRIPTION,
  })
  slot!: GeometrySlotValue;

  @ApiProperty({ type: 'integer', example: 1, description: 'Order of the conditions in one slot' })
  seq!: number;

  @ApiProperty({ type: String, format: 'uuid', example: GEOMETRY_IDS.condition })
  conditionId!: string;
}

export class PatternConditionSlotInputDto {
  @RefField({
    example: GEOMETRY_IDS.subPattern,
    nullable: true,
    description: 'A part of this pattern (folding only); omit or null for the pattern itself',
  })
  subPatternId?: string | null;

  @EnumField(GEOMETRY_SLOTS, 'GeometrySlot', { example: 'dw', description: SLOT_DESCRIPTION })
  slot!: GeometrySlotValue;

  @IntField({ example: 1, optional: true, min: 1, max: 20, description: 'Order in the slot (default 1)' })
  seq?: number;

  @RefField({ example: GEOMETRY_IDS.condition })
  conditionId!: string;
}

export class PatternStandardBlankDto {
  @ApiProperty({ type: String, format: 'uuid', example: GEOMETRY_IDS.standardSize })
  standardSizeId!: string;

  @ApiProperty({ type: Number, example: 210, description: 'Blank width. Unit: mm.' })
  dwMm!: number;

  @ApiProperty({ type: Number, example: 320, description: 'Blank length. Unit: mm.' })
  dlMm!: number;
}

export class PatternStandardBlankInputDto {
  @RefField({ example: GEOMETRY_IDS.standardSize })
  standardSizeId!: string;

  @DecimalField({ example: 210, positive: true, unit: 'mm', description: 'Blank width' })
  dwMm!: number;

  @DecimalField({ example: 320, positive: true, unit: 'mm', description: 'Blank length' })
  dlMm!: number;
}

export class PatternGeometryDto {
  @IdField(GEOMETRY_IDS.pattern)
  patternId!: string;

  @ApiProperty({ type: [PatternConditionSlotDto] })
  conditions!: PatternConditionSlotDto[];

  @ApiProperty({
    type: [PatternStandardBlankDto],
    description: 'The die-cut blank at a standard size (folding formula `standard_blank`)',
  })
  standardBlanks!: PatternStandardBlankDto[];
}

export class ReplacePatternConditionsDto {
  @ApiProperty({
    type: [PatternConditionSlotInputDto],
    description: 'Every slot of the pattern and its parts',
  })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PatternConditionSlotInputDto)
  conditions!: PatternConditionSlotInputDto[];
}

export class ReplaceStandardBlanksDto {
  @ApiProperty({ type: [PatternStandardBlankInputDto], description: 'One blank per standard size' })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PatternStandardBlankInputDto)
  standardBlanks!: PatternStandardBlankInputDto[];
}

export const PATTERN_GEOMETRY_EXAMPLE: PatternGeometryDto = {
  patternId: GEOMETRY_IDS.pattern,
  conditions: [{ subPatternId: null, slot: 'dw', seq: 1, conditionId: GEOMETRY_IDS.condition }],
  standardBlanks: [{ standardSizeId: GEOMETRY_IDS.standardSize, dwMm: 210, dlMm: 320 }],
};
