import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsObject, IsOptional, IsUUID, ValidateNested } from 'class-validator';

import {
  BoolField,
  CATALOG_STATUSES,
  CodeField,
  DecimalField,
  EnumField,
  IdField,
  IntField,
  RefField,
  SlugField,
  SNAKE_CODE,
  SortField,
  StatusField,
  TextField,
  TimestampField,
  UrlField,
} from '../crud/dto-fields';

export const QUOTE_MODES = ['instant', 'rfq'] as const;
export const CALCULATOR_KEYS = [
  'folding',
  'corrugate',
  'label',
  'tag_sleeve',
  'pouch',
  'standard_product',
  'service',
] as const;
export const TEMPLATE_AVAILABILITIES = ['none', 'online_template', 'drawing'] as const;

const TS = '2026-09-25T10:00:00+07:00';
export const EXAMPLE_IDS = {
  category: '0192f3a0-7c1e-7d2a-9b1f-00000000c001',
  productType: '0192f3a0-7c1e-7d2a-9b1f-00000000c002',
  printType: '0192f3a0-7c1e-7d2a-9b1f-00000000c003',
  catalogProduct: '0192f3a0-7c1e-7d2a-9b1f-00000000c004',
  standardSize: '0192f3a0-7c1e-7d2a-9b1f-00000000c005',
  pattern: '0192f3a0-7c1e-7d2a-9b1f-00000000c006',
  subPattern: '0192f3a0-7c1e-7d2a-9b1f-00000000c007',
  seoPage: '0192f3a0-7c1e-7d2a-9b1f-00000000c008',
  file: '0192f3a0-7c1e-7d2a-9b1f-00000000c009',
  material: '0192f3a0-7c1e-7d2a-9b1f-00000000c010',
  fluteType: '0192f3a0-7c1e-7d2a-9b1f-00000000c011',
  image: '0192f3a0-7c1e-7d2a-9b1f-00000000c012',
} as const;

// ------------------------------------------------------------------------------------------------
// Product categories (reporting categories, D-030)
// ------------------------------------------------------------------------------------------------

export class ProductCategoryDto {
  @IdField(EXAMPLE_IDS.category)
  id!: string;

  @ApiProperty({ example: 'folding_carton' })
  code!: string;

  @ApiProperty({ example: 'กล่องกระดาษแข็ง' })
  nameTh!: string;

  @ApiProperty({ example: 'Folding cartons' })
  nameEn!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  parentId!: string | null;

  @ApiProperty({ type: 'integer', example: 10 })
  sort!: number;

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: (typeof CATALOG_STATUSES)[number];

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateProductCategoryDto {
  @CodeField({ example: 'folding_carton', pattern: SNAKE_CODE })
  code!: string;

  @TextField({ example: 'กล่องกระดาษแข็ง' })
  nameTh!: string;

  @TextField({ example: 'Folding cartons' })
  nameEn!: string;

  @RefField({ example: null, nullable: true, description: 'Parent category' })
  parentId?: string | null;

  @SortField()
  sort?: number;

  @StatusField()
  status?: (typeof CATALOG_STATUSES)[number];
}

export class UpdateProductCategoryDto extends PartialType(CreateProductCategoryDto) {}

export class ProductCategoryListQuery extends PageQuery {
  @EnumField(CATALOG_STATUSES, 'CatalogStatus', { example: 'active', optional: true })
  status?: (typeof CATALOG_STATUSES)[number];
}

// ------------------------------------------------------------------------------------------------
// Product types (D-100) — quote mode changes through its own action
// ------------------------------------------------------------------------------------------------

export class ProductTypeDto {
  @IdField(EXAMPLE_IDS.productType)
  id!: string;

  @ApiProperty({ example: 'folding_carton' })
  code!: string;

  @ApiProperty({ format: 'uuid', example: EXAMPLE_IDS.category })
  categoryId!: string;

  @ApiProperty({ example: 'กล่องกระดาษแข็ง' })
  nameTh!: string;

  @ApiProperty({ example: 'Folding carton' })
  nameEn!: string;

  @ApiProperty({
    enum: QUOTE_MODES,
    enumName: 'QuoteMode',
    example: 'rfq',
    description:
      '`instant` only once the calculator ships (D-100); whether a configuration is actually instant is resolved from factory participations (D-043).',
  })
  quoteMode!: (typeof QUOTE_MODES)[number];

  @ApiProperty({ enum: CALCULATOR_KEYS, enumName: 'CalculatorKey', nullable: true, example: 'folding' })
  calculatorKey!: (typeof CALCULATOR_KEYS)[number] | null;

  @ApiProperty({ example: false, description: 'Food-contact packaging by default (D-076 inspection uplift)' })
  isFoodContactDefault!: boolean;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: null,
    description: 'JSON schema of the RFQ spec fields for this category (B2.5)',
  })
  rfqSpecSchema!: Record<string, unknown> | null;

  @ApiProperty({ type: 'integer', example: 10 })
  sort!: number;

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: (typeof CATALOG_STATUSES)[number];

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateProductTypeDto {
  @CodeField({ example: 'paper_bag', pattern: SNAKE_CODE })
  code!: string;

  @RefField({ example: EXAMPLE_IDS.category })
  categoryId!: string;

  @TextField({ example: 'ถุงกระดาษ' })
  nameTh!: string;

  @TextField({ example: 'Paper bag' })
  nameEn!: string;

  @EnumField(CALCULATOR_KEYS, 'CalculatorKey', {
    example: null,
    nullable: true,
    description: 'Calculator that will price this type once it ships (B2.3)',
  })
  calculatorKey?: (typeof CALCULATOR_KEYS)[number] | null;

  @BoolField({ example: false, optional: true })
  isFoodContactDefault?: boolean;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true, example: null })
  @IsOptional()
  @IsObject()
  rfqSpecSchema?: Record<string, unknown> | null;

  @SortField()
  sort?: number;

  @StatusField()
  status?: (typeof CATALOG_STATUSES)[number];
}

/** The code is a stable key (seeds, calculators, analytics): not editable. */
export class UpdateProductTypeDto extends PartialType(OmitType(CreateProductTypeDto, ['code'] as const)) {}

export class ProductTypeListQuery extends PageQuery {
  @EnumField(CATALOG_STATUSES, 'CatalogStatus', { example: 'active', optional: true })
  status?: (typeof CATALOG_STATUSES)[number];

  @EnumField(QUOTE_MODES, 'QuoteMode', { example: 'rfq', optional: true })
  quoteMode?: (typeof QUOTE_MODES)[number];
}

export class ChangeQuoteModeDto {
  @EnumField(QUOTE_MODES, 'QuoteMode', { example: 'instant' })
  quoteMode!: (typeof QUOTE_MODES)[number];

  @TextField({ example: 'Folding calculator shipped with golden tests (B2.3)', max: 500 })
  reason!: string;
}

// ------------------------------------------------------------------------------------------------
// Print types
// ------------------------------------------------------------------------------------------------

export class PrintTypeDto {
  @IdField(EXAMPLE_IDS.printType)
  id!: string;

  @ApiProperty({ example: 'folding_offset' })
  code!: string;

  @ApiProperty({ format: 'uuid', example: EXAMPLE_IDS.productType })
  productTypeId!: string;

  @ApiProperty({ example: 'ออฟเซ็ท' })
  nameTh!: string;

  @ApiProperty({ example: 'Offset' })
  nameEn!: string;

  @ApiProperty({ example: false, description: 'May charge plate and die-cut block (legacy flag)' })
  canChargePlateAndDie!: boolean;

  @ApiProperty({ type: 'integer', example: 10 })
  sort!: number;

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: (typeof CATALOG_STATUSES)[number];

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreatePrintTypeDto {
  @CodeField({ example: 'folding_offset', pattern: SNAKE_CODE })
  code!: string;

  @RefField({ example: EXAMPLE_IDS.productType })
  productTypeId!: string;

  @TextField({ example: 'ออฟเซ็ท' })
  nameTh!: string;

  @TextField({ example: 'Offset' })
  nameEn!: string;

  @BoolField({ example: false, optional: true })
  canChargePlateAndDie?: boolean;

  @SortField()
  sort?: number;

  @StatusField()
  status?: (typeof CATALOG_STATUSES)[number];
}

export class UpdatePrintTypeDto extends PartialType(CreatePrintTypeDto) {}

export class PrintTypeListQuery extends PageQuery {
  @RefField({ example: EXAMPLE_IDS.productType, optional: true })
  productTypeId?: string;

  @EnumField(CATALOG_STATUSES, 'CatalogStatus', { example: 'active', optional: true })
  status?: (typeof CATALOG_STATUSES)[number];
}

// ------------------------------------------------------------------------------------------------
// Catalogue products (legacy mapping_inputs) + patterns / options / images
// ------------------------------------------------------------------------------------------------

export const OPTION_KINDS = [
  'material',
  'finish',
  'coating',
  'ink_colour',
  'diecut',
  'assembly',
  'print_type',
  'print_side',
  'pattern',
  'process',
] as const;
/** Kinds with a definition table (the others are refused by the database trigger, §7 A-19). */
export const OFFERABLE_OPTION_KINDS = [
  'material',
  'finish',
  'coating',
  'ink_colour',
  'diecut',
  'assembly',
  'print_type',
  'pattern',
] as const;

export class CatalogProductPatternDto {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_IDS.pattern })
  patternId!: string;

  @ApiProperty({ example: 'RTE-01' })
  patternCode!: string;

  @ApiProperty({ type: Number, nullable: true, example: 1, description: 'Legacy factor nw (indicative)' })
  factorNw!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 1 })
  factorNl!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 1 })
  factorNd!: number | null;

  @ApiProperty({ type: 'integer', example: 0 })
  sort!: number;
}

export class CatalogProductOptionDto {
  @ApiProperty({ enum: OPTION_KINDS, enumName: 'CatalogOptionKind', example: 'material' })
  kind!: (typeof OPTION_KINDS)[number];

  @ApiProperty({ format: 'uuid', example: EXAMPLE_IDS.material, description: 'Public id of the offered row' })
  optionId!: string;

  @ApiProperty({ example: true })
  isDefault!: boolean;

  @ApiProperty({ type: 'integer', example: 0 })
  sort!: number;
}

export class CatalogProductImageDto {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_IDS.image })
  id!: string;

  @ApiProperty({ format: 'uuid', example: EXAMPLE_IDS.file })
  fileId!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: { material: 'art-card-350' },
    description: 'Which material / colour / combination the image shows (legacy imagesets)',
  })
  variant!: Record<string, unknown> | null;

  @ApiProperty({ type: 'integer', example: 0 })
  sort!: number;
}

export class CatalogProductDto {
  @IdField(EXAMPLE_IDS.catalogProduct)
  id!: string;

  @ApiProperty({ format: 'uuid', example: EXAMPLE_IDS.productType })
  productTypeId!: string;

  @ApiProperty({ example: 'tuck-end-box' })
  slug!: string;

  @ApiProperty({ example: 'กล่องฝาเสียบ' })
  nameTh!: string;

  @ApiProperty({ example: 'Tuck-end box' })
  nameEn!: string;

  @ApiProperty({ type: String, nullable: true, example: 'กล่องพับฝาเสียบบน-ล่าง' })
  descriptionTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Reverse tuck-end folding box' })
  descriptionEn!: string | null;

  @ApiProperty({ example: false })
  isCombination!: boolean;

  @ApiProperty({ enum: TEMPLATE_AVAILABILITIES, enumName: 'TemplateAvailability', example: 'drawing' })
  templateAvailability!: (typeof TEMPLATE_AVAILABILITIES)[number];

  @ApiProperty({ type: String, nullable: true, example: null })
  videoUrl!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  seoPageId!: string | null;

  @ApiProperty({ type: 'integer', example: 10 })
  sort!: number;

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: (typeof CATALOG_STATUSES)[number];

  @ApiProperty({ type: [CatalogProductPatternDto] })
  patterns!: CatalogProductPatternDto[];

  @ApiProperty({ type: [CatalogProductOptionDto] })
  options!: CatalogProductOptionDto[];

  @ApiProperty({ type: [CatalogProductImageDto] })
  images!: CatalogProductImageDto[];

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateCatalogProductDto {
  @RefField({ example: EXAMPLE_IDS.productType })
  productTypeId!: string;

  @SlugField({ example: 'tuck-end-box' })
  slug!: string;

  @TextField({ example: 'กล่องฝาเสียบ' })
  nameTh!: string;

  @TextField({ example: 'Tuck-end box' })
  nameEn!: string;

  @TextField({ example: 'กล่องพับฝาเสียบบน-ล่าง', nullable: true, max: 5000 })
  descriptionTh?: string | null;

  @TextField({ example: 'Reverse tuck-end folding box', nullable: true, max: 5000 })
  descriptionEn?: string | null;

  @BoolField({ example: false, optional: true })
  isCombination?: boolean;

  @EnumField(TEMPLATE_AVAILABILITIES, 'TemplateAvailability', { example: 'drawing', optional: true })
  templateAvailability?: (typeof TEMPLATE_AVAILABILITIES)[number];

  @UrlField({ example: null, nullable: true })
  videoUrl?: string | null;

  @RefField({ example: null, nullable: true })
  seoPageId?: string | null;

  @SortField()
  sort?: number;

  @StatusField()
  status?: (typeof CATALOG_STATUSES)[number];
}

export class UpdateCatalogProductDto extends PartialType(CreateCatalogProductDto) {}

export class CatalogProductListQuery extends PageQuery {
  @RefField({ example: EXAMPLE_IDS.productType, optional: true })
  productTypeId?: string;

  @EnumField(CATALOG_STATUSES, 'CatalogStatus', { example: 'active', optional: true })
  status?: (typeof CATALOG_STATUSES)[number];
}

export class PatternLinkInput {
  @RefField({ example: EXAMPLE_IDS.pattern })
  patternId!: string;

  @DecimalField({ example: 1, nullable: true, scale: 4 })
  factorNw?: number | null;

  @DecimalField({ example: 1, nullable: true, scale: 4 })
  factorNl?: number | null;

  @DecimalField({ example: 1, nullable: true, scale: 4 })
  factorNd?: number | null;

  @SortField()
  sort?: number;
}

export class ReplacePatternsDto {
  @ApiProperty({ type: [PatternLinkInput] })
  @ValidateNested({ each: true })
  @Type(() => PatternLinkInput)
  patterns!: PatternLinkInput[];
}

export class OptionInput {
  @EnumField(OFFERABLE_OPTION_KINDS, 'OfferableOptionKind', { example: 'material' })
  kind!: (typeof OFFERABLE_OPTION_KINDS)[number];

  @RefField({ example: EXAMPLE_IDS.material })
  optionId!: string;

  @BoolField({ example: true, optional: true })
  isDefault?: boolean;

  @SortField()
  sort?: number;
}

export class ReplaceOptionsDto {
  @ApiProperty({ type: [OptionInput] })
  @ValidateNested({ each: true })
  @Type(() => OptionInput)
  options!: OptionInput[];
}

export class AddImageDto {
  @RefField({ example: EXAMPLE_IDS.file, description: 'Uploaded file (purpose `evidence` or `document`)' })
  fileId!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: { material: 'art-card-350' },
  })
  @IsOptional()
  @IsObject()
  variant?: Record<string, unknown> | null;

  @SortField()
  sort?: number;
}

// ------------------------------------------------------------------------------------------------
// Standard sizes
// ------------------------------------------------------------------------------------------------

export class StandardSizeDto {
  @IdField(EXAMPLE_IDS.standardSize)
  id!: string;

  @ApiProperty({ format: 'uuid', example: EXAMPLE_IDS.catalogProduct })
  catalogProductId!: string;

  @ApiProperty({ example: 'S' })
  code!: string;

  @ApiProperty({ example: 'ขนาดเล็ก 10×10×5 ซม.' })
  name!: string;

  @ApiProperty({ example: 100, description: 'Unit: mm.' })
  lengthMm!: number;

  @ApiProperty({ example: 100, description: 'Unit: mm.' })
  widthMm!: number;

  @ApiProperty({ example: 50, description: 'Unit: mm.' })
  heightMm!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: null,
    description: 'Dimension used by the calculator (mm)',
  })
  calcLengthMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: null })
  calcWidthMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: null })
  calcHeightMm!: number | null;

  @ApiProperty({ type: 'integer', example: 10 })
  sort!: number;

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: (typeof CATALOG_STATUSES)[number];

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateStandardSizeDto {
  @RefField({ example: EXAMPLE_IDS.catalogProduct })
  catalogProductId!: string;

  @CodeField({ example: 'S' })
  code!: string;

  @TextField({ example: 'ขนาดเล็ก 10×10×5 ซม.' })
  name!: string;

  @DecimalField({ example: 100, positive: true, unit: 'mm' })
  lengthMm!: number;

  @DecimalField({ example: 100, positive: true, unit: 'mm' })
  widthMm!: number;

  @DecimalField({ example: 50, unit: 'mm' })
  heightMm!: number;

  @DecimalField({ example: null, nullable: true, positive: true, unit: 'mm' })
  calcLengthMm?: number | null;

  @DecimalField({ example: null, nullable: true, positive: true, unit: 'mm' })
  calcWidthMm?: number | null;

  @DecimalField({ example: null, nullable: true, unit: 'mm' })
  calcHeightMm?: number | null;

  @SortField()
  sort?: number;

  @StatusField()
  status?: (typeof CATALOG_STATUSES)[number];
}

/** A size stays with its product. */
export class UpdateStandardSizeDto extends PartialType(
  OmitType(CreateStandardSizeDto, ['catalogProductId'] as const),
) {}

export class StandardSizeListQuery extends PageQuery {
  @RefField({ example: EXAMPLE_IDS.catalogProduct, optional: true })
  catalogProductId?: string;

  @EnumField(CATALOG_STATUSES, 'CatalogStatus', { example: 'active', optional: true })
  status?: (typeof CATALOG_STATUSES)[number];
}

// ------------------------------------------------------------------------------------------------
// Patterns + sub-patterns (geometry indicative, fixed by the B2.3 ports)
// ------------------------------------------------------------------------------------------------

export class PatternDto {
  @IdField(EXAMPLE_IDS.pattern)
  id!: string;

  @ApiProperty({ format: 'uuid', example: EXAMPLE_IDS.productType })
  productTypeId!: string;

  @ApiProperty({ example: 'RTE-01' })
  code!: string;

  @ApiProperty({ example: 'ฝาเสียบกลับด้าน' })
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Reverse tuck end' })
  technicalName!: string | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: null,
    description: 'Legacy pattern type (indicative)',
  })
  patternKind!: number | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { minW: 30, maxW: 500 },
    description:
      'Size constraints (min/max w/l/h/b/s/cs/dl/dw, required_x/c — indicative, validated by the calculator port)',
  })
  constraints!: Record<string, unknown>;

  @ApiProperty({ type: String, nullable: true, example: 'rte' })
  dielineKey!: string | null;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    example: [EXAMPLE_IDS.fluteType],
    description: 'Matching flute types',
  })
  fluteTypeIds!: string[];

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: (typeof CATALOG_STATUSES)[number];

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreatePatternDto {
  @RefField({ example: EXAMPLE_IDS.productType })
  productTypeId!: string;

  @CodeField({ example: 'RTE-01' })
  code!: string;

  @TextField({ example: 'ฝาเสียบกลับด้าน' })
  name!: string;

  @TextField({ example: 'Reverse tuck end', nullable: true })
  technicalName?: string | null;

  @IntField({ example: null, nullable: true, min: 0, max: 32_767 })
  patternKind?: number | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, example: { minW: 30, maxW: 500 } })
  @IsOptional()
  @IsObject()
  constraints?: Record<string, unknown>;

  @TextField({ example: 'rte', nullable: true, max: 64 })
  dielineKey?: string | null;

  @StatusField()
  status?: (typeof CATALOG_STATUSES)[number];
}

export class UpdatePatternDto extends PartialType(CreatePatternDto) {}

export class PatternListQuery extends PageQuery {
  @RefField({ example: EXAMPLE_IDS.productType, optional: true })
  productTypeId?: string;

  @EnumField(CATALOG_STATUSES, 'CatalogStatus', { example: 'active', optional: true })
  status?: (typeof CATALOG_STATUSES)[number];
}

export class ReplaceFluteTypesDto {
  @ApiProperty({ type: [String], format: 'uuid', example: [EXAMPLE_IDS.fluteType] })
  @IsUUID('all', { each: true })
  fluteTypeIds!: string[];
}

export class SubPatternDto {
  @IdField(EXAMPLE_IDS.subPattern)
  id!: string;

  @ApiProperty({ format: 'uuid', example: EXAMPLE_IDS.pattern })
  patternId!: string;

  @ApiProperty({ type: 'integer', example: 1 })
  seq!: number;

  @ApiProperty({ example: 'ตัวกล่อง' })
  name!: string;

  @ApiProperty({ type: Number, nullable: true, example: 1 })
  dl!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 1 })
  dw!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 1 })
  dh!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 2 })
  nl!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 2 })
  nw!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 1 })
  nh!: number | null;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true, example: null })
  conditions!: Record<string, unknown> | null;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateSubPatternDto {
  @RefField({ example: EXAMPLE_IDS.pattern })
  patternId!: string;

  @IntField({ example: 1, min: 1, max: 32_767 })
  seq!: number;

  @TextField({ example: 'ตัวกล่อง' })
  name!: string;

  @DecimalField({ example: 1, nullable: true, scale: 4 })
  dl?: number | null;

  @DecimalField({ example: 1, nullable: true, scale: 4 })
  dw?: number | null;

  @DecimalField({ example: 1, nullable: true, scale: 4 })
  dh?: number | null;

  @DecimalField({ example: 2, nullable: true, scale: 4 })
  nl?: number | null;

  @DecimalField({ example: 2, nullable: true, scale: 4 })
  nw?: number | null;

  @DecimalField({ example: 1, nullable: true, scale: 4 })
  nh?: number | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true, example: null })
  @IsOptional()
  @IsObject()
  conditions?: Record<string, unknown> | null;
}

export class UpdateSubPatternDto extends PartialType(OmitType(CreateSubPatternDto, ['patternId'] as const)) {}

export class SubPatternListQuery extends PageQuery {
  @RefField({ example: EXAMPLE_IDS.pattern, optional: true })
  patternId?: string;
}
