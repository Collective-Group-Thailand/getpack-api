import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';

import {
  BoolField,
  CATALOG_STATUSES,
  CodeField,
  DecimalField,
  EnumField,
  IdField,
  IntField,
  RefField,
  SortField,
  StatusField,
  TextField,
  TimestampField,
} from '../crud/dto-fields';

type Status = (typeof CATALOG_STATUSES)[number];
const TS = '2026-09-25T10:00:00+07:00';

export const STOCK_ATTRIBUTES = [
  'material',
  'type',
  'sub_type',
  'shape',
  'shoulder',
  'neck',
  'colour',
  'size_text',
  'cap_type',
] as const;
export type StockAttributeValueKey = (typeof STOCK_ATTRIBUTES)[number];
export const PRODUCT_UNITS = ['piece', 'box', 'pouch', 'tube', 'set', 'job', 'round', 'trip'] as const;

export const STOCK_IDS = {
  value: '0192f3a0-7c1e-7d2a-9b1f-00000000e001',
  product: '0192f3a0-7c1e-7d2a-9b1f-00000000e002',
  image: '0192f3a0-7c1e-7d2a-9b1f-00000000e003',
  file: '0192f3a0-7c1e-7d2a-9b1f-00000000e004',
  productType: '0192f3a0-7c1e-7d2a-9b1f-00000000c002',
} as const;

// ------------------------------------------------------------------------------------------------
// Attribute values (material / shape / neck / colour …)
// ------------------------------------------------------------------------------------------------

export class StockAttributeValueDto {
  @IdField(STOCK_IDS.value)
  id!: string;

  @ApiProperty({ enum: STOCK_ATTRIBUTES, enumName: 'StockAttribute', example: 'colour' })
  attribute!: StockAttributeValueKey;

  @ApiProperty({ example: 'clear' })
  code!: string;

  @ApiProperty({ example: 'ใส' })
  nameTh!: string;

  @ApiProperty({ example: 'Clear' })
  nameEn!: string;

  @ApiProperty({ type: 'integer', example: 10 })
  sort!: number;

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: Status;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateStockAttributeValueDto {
  @EnumField(STOCK_ATTRIBUTES, 'StockAttribute', { example: 'colour' })
  attribute!: StockAttributeValueKey;

  @CodeField({ example: 'clear' })
  code!: string;

  @TextField({ example: 'ใส' })
  nameTh!: string;

  @TextField({ example: 'Clear' })
  nameEn!: string;

  @SortField()
  sort?: number;

  @StatusField()
  status?: Status;
}

export class UpdateStockAttributeValueDto extends PartialType(CreateStockAttributeValueDto) {}

export class StockAttributeValueListQuery extends PageQuery {
  @EnumField(STOCK_ATTRIBUTES, 'StockAttribute', { example: 'colour', optional: true })
  attribute?: StockAttributeValueKey;

  @EnumField(CATALOG_STATUSES, 'CatalogStatus', { example: 'active', optional: true })
  status?: Status;
}

// ------------------------------------------------------------------------------------------------
// Stock products
// ------------------------------------------------------------------------------------------------

export class StockProductAttributeDto {
  @ApiProperty({ enum: STOCK_ATTRIBUTES, enumName: 'StockAttribute', example: 'colour' })
  attribute!: StockAttributeValueKey;

  @ApiProperty({ format: 'uuid', example: STOCK_IDS.value })
  valueId!: string;

  @ApiProperty({ example: 'clear' })
  valueCode!: string;
}

export class StockProductImageDto {
  @ApiProperty({ format: 'uuid', example: STOCK_IDS.image })
  id!: string;

  @ApiProperty({ format: 'uuid', example: STOCK_IDS.file })
  fileId!: string;

  @ApiProperty({ type: 'integer', example: 0 })
  sort!: number;
}

export class StockProductDto {
  @IdField(STOCK_IDS.product)
  id!: string;

  @ApiProperty({ format: 'uuid', example: STOCK_IDS.productType })
  productTypeId!: string;

  @ApiProperty({ example: 'PKO-BTL-0250' })
  sku!: string;

  @ApiProperty({ example: 'ขวด PET 250 มล.' })
  nameTh!: string;

  @ApiProperty({ example: 'PET bottle 250 ml' })
  nameEn!: string;

  @ApiProperty({ type: String, nullable: true, example: 'ขวดใส ฝาเกลียว 28 มม.' })
  description!: string | null;

  @ApiProperty({ enum: PRODUCT_UNITS, enumName: 'ProductUnit', example: 'piece' })
  unit!: (typeof PRODUCT_UNITS)[number];

  @ApiProperty({ type: Number, nullable: true, example: 250, description: 'Unit: ml.' })
  capacityMl!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 60, description: 'Unit: mm.' })
  lengthMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 60, description: 'Unit: mm.' })
  widthMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 150, description: 'Unit: mm.' })
  heightMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 22.5, description: 'Unit: g.' })
  weightG!: number | null;

  @ApiProperty({ type: 'integer', example: 100 })
  minOrderQty!: number;

  @ApiProperty({ example: true })
  isFoodGrade!: boolean;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  seoPageId!: string | null;

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: Status;

  @ApiProperty({ type: [StockProductAttributeDto] })
  attributes!: StockProductAttributeDto[];

  @ApiProperty({ type: [StockProductImageDto] })
  images!: StockProductImageDto[];

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateStockProductDto {
  @RefField({ example: STOCK_IDS.productType, description: 'Normally the `standard_product` type' })
  productTypeId!: string;

  @CodeField({ example: 'PKO-BTL-0250', description: 'Packio SKU (natural key for Excel import)' })
  sku!: string;

  @TextField({ example: 'ขวด PET 250 มล.' })
  nameTh!: string;

  @TextField({ example: 'PET bottle 250 ml' })
  nameEn!: string;

  @TextField({ example: 'ขวดใส ฝาเกลียว 28 มม.', nullable: true, max: 5000 })
  description?: string | null;

  @EnumField(PRODUCT_UNITS, 'ProductUnit', { example: 'piece' })
  unit!: (typeof PRODUCT_UNITS)[number];

  @DecimalField({ example: 250, nullable: true, unit: 'ml' })
  capacityMl?: number | null;

  @DecimalField({ example: 60, nullable: true, positive: true, unit: 'mm' })
  lengthMm?: number | null;

  @DecimalField({ example: 60, nullable: true, positive: true, unit: 'mm' })
  widthMm?: number | null;

  @DecimalField({ example: 150, nullable: true, unit: 'mm' })
  heightMm?: number | null;

  @DecimalField({ example: 22.5, nullable: true, unit: 'g' })
  weightG?: number | null;

  @IntField({ example: 100, optional: true, min: 1, max: 10_000_000 })
  minOrderQty?: number;

  @BoolField({ example: true, optional: true })
  isFoodGrade?: boolean;

  @RefField({ example: null, nullable: true })
  seoPageId?: string | null;

  @StatusField()
  status?: Status;
}

export class UpdateStockProductDto extends PartialType(CreateStockProductDto) {}

export class StockProductListQuery extends PageQuery {
  @RefField({ example: STOCK_IDS.productType, optional: true })
  productTypeId?: string;

  @EnumField(CATALOG_STATUSES, 'CatalogStatus', { example: 'active', optional: true })
  status?: Status;

  @RefField({ example: STOCK_IDS.value, optional: true, description: 'Has this attribute value' })
  attributeValueId?: string;
}

export class StockAttributeInput {
  @EnumField(STOCK_ATTRIBUTES, 'StockAttribute', { example: 'colour' })
  attribute!: StockAttributeValueKey;

  @RefField({ example: STOCK_IDS.value })
  valueId!: string;
}

export class ReplaceStockAttributesDto {
  @ApiProperty({ type: [StockAttributeInput] })
  @ValidateNested({ each: true })
  @Type(() => StockAttributeInput)
  attributes!: StockAttributeInput[];
}

export class AddStockImageDto {
  @RefField({ example: STOCK_IDS.file, description: 'Uploaded file' })
  fileId!: string;

  @SortField()
  sort?: number;
}
