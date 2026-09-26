import { EnumField, IntField, RefField, TextField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

/** Packio's sell margins, fix costs and design fees (D-063, schema-design §3.5, A-23). */

export const SELL_MARGIN_KINDS = [
  'margin',
  'design_fee',
  'structure_design_fee',
  'fix_cost',
  'target_margin',
] as const;
export type SellMarginKind = (typeof SELL_MARGIN_KINDS)[number];
export const VERSION_STATUSES = [
  'draft',
  'proposed',
  'approved',
  'rejected',
  'withdrawn',
  'pending_acceptance',
] as const;

const DECIMAL = /^\d{1,12}(\.\d{1,6})?$/;
const PCT = /^\d{1,2}(\.\d{1,4})?$/;

const IDS = {
  table: '0192f3a0-7c1e-7d2a-9b1f-00000000b001',
  version: '0192f3a0-7c1e-7d2a-9b1f-00000000b002',
  productType: '0192f3a0-7c1e-7d2a-9b1f-00000000c002',
  printType: '0192f3a0-7c1e-7d2a-9b1f-00000000a107',
  difficulty: '0192f3a0-7c1e-7d2a-9b1f-00000000a103',
};

export class SellMarginLineDto {
  @IntField({ example: 1, nullable: true, min: 0, description: 'Run from (inclusive); null = open' })
  qtyMin!: number | null;

  @IntField({ example: 999, nullable: true, min: 0, description: 'Run to (inclusive); null = open' })
  qtyMax!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '0',
    pattern: DECIMAL.source,
    description: 'Buy price from (inclusive)',
  })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL)
  priceMin!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    pattern: DECIMAL.source,
    description: 'Buy price to (exclusive)',
  })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL)
  priceMax!: string | null;

  @IntField({ example: null, nullable: true, min: 0 })
  colourCount!: number | null;

  @RefField({ example: IDS.difficulty, nullable: true })
  difficultyLevelId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '25',
    pattern: PCT.source,
    description: 'Margin % (below 100); or an amount',
  })
  @IsOptional()
  @IsString()
  @Matches(PCT)
  valuePct!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null, pattern: DECIMAL.source })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL)
  valueAmount!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null, pattern: DECIMAL.source })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL)
  minAmount!: string | null;
}

export class CreateSellMarginTableDto {
  @RefField({ example: IDS.productType })
  productTypeId!: string;

  @RefField({
    example: IDS.printType,
    nullable: true,
    description: 'Null = every print type of the product type',
  })
  printTypeId!: string | null;

  @EnumField(SELL_MARGIN_KINDS, 'SellMarginKind', { example: 'margin' })
  kind!: SellMarginKind;

  @TextField({ example: 'Folding sell margin by run', max: 500 })
  description!: string;
}

export class CreateSellMarginVersionDto {
  @ApiProperty({
    format: 'date-time',
    example: '2026-10-01T00:00:00+07:00',
    description: 'Never before the approval (not back-dated)',
  })
  @IsDateString()
  effectiveFrom!: string;

  @TextField({ example: 'Q4 margins (fake)', max: 500 })
  reason!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '30',
    pattern: PCT.source,
    description: 'Used when no line matches',
  })
  @IsOptional()
  @IsString()
  @Matches(PCT)
  fallbackPct?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, pattern: DECIMAL.source })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL)
  fallbackAmount?: string | null;

  @ApiProperty({ type: [SellMarginLineDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SellMarginLineDto)
  lines!: SellMarginLineDto[];
}

export class SellMarginVersionDto {
  @ApiProperty({ format: 'uuid', example: IDS.version })
  id!: string;

  @ApiProperty({ example: 2 })
  versionNo!: number;

  @ApiProperty({ enum: VERSION_STATUSES, enumName: 'ConfigVersionStatus', example: 'approved' })
  status!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T00:00:00+07:00' })
  effectiveFrom!: string;

  @ApiProperty({ type: String, nullable: true, example: '30' })
  fallbackPct!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  fallbackAmount!: string | null;

  @ApiProperty({ example: 'Q4 margins (fake)' })
  reason!: string;

  @ApiProperty({ type: [SellMarginLineDto] })
  lines!: SellMarginLineDto[];
}

export class SellMarginTableDto {
  @ApiProperty({ format: 'uuid', example: IDS.table })
  id!: string;

  @ApiProperty({ format: 'uuid', example: IDS.productType })
  productTypeId!: string;

  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  printTypeId!: string | null;

  @ApiProperty({ enum: SELL_MARGIN_KINDS, enumName: 'SellMarginKind', example: 'margin' })
  kind!: string;

  @ApiProperty({ example: 'Folding sell margin by run' })
  description!: string;

  @ApiProperty({ type: SellMarginVersionDto, nullable: true, description: 'The version in force now' })
  current!: SellMarginVersionDto | null;
}

const LINE_EXAMPLE: SellMarginLineDto = {
  qtyMin: 1,
  qtyMax: 999,
  priceMin: '0',
  priceMax: null,
  colourCount: null,
  difficultyLevelId: null,
  valuePct: '25',
  valueAmount: null,
  minAmount: null,
};

export const VERSION_EXAMPLE: SellMarginVersionDto = {
  id: IDS.version,
  versionNo: 1,
  status: 'approved',
  effectiveFrom: '2026-10-01T00:00:00+07:00',
  fallbackPct: '30',
  fallbackAmount: null,
  reason: 'Q4 margins (fake)',
  lines: [LINE_EXAMPLE],
};

export const TABLE_EXAMPLE: SellMarginTableDto = {
  id: IDS.table,
  productTypeId: IDS.productType,
  productTypeCode: 'folding_carton',
  printTypeId: null,
  kind: 'margin',
  description: 'Folding sell margin by run',
  current: VERSION_EXAMPLE,
};

export const CREATE_VERSION_EXAMPLE: CreateSellMarginVersionDto = {
  effectiveFrom: '2026-10-01T00:00:00+07:00',
  reason: 'Q4 margins (fake)',
  fallbackPct: '30',
  fallbackAmount: null,
  lines: [LINE_EXAMPLE],
};
