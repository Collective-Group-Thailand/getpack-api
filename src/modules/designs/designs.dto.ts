import { PageQuery } from '@common/pagination/pagination.dto';
import { OrderRefDto } from '@modules/carts/carts.dto';
import { EnumField } from '@modules/catalog/crud/dto-fields';
import { MEASUREMENT_BASES } from '@modules/specs/dimension-conversion';
import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AttachedFileDto } from '@platform/files/files.dto';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Online designs and dieline drawings (B4.1). */

export const DESIGN_ASSET_KINDS = ['image', 'font', 'logo', 'svg'] as const;
export const DESIGN_VERSION_KINDS = ['manual', 'autosave', 'restore', 'import'] as const;
export const DESIGN_SAVE_KINDS = ['manual', 'autosave'] as const;
export const DESIGN_LINK_FILTERS = ['any', 'linked', 'unlinked'] as const;
export const DESIGN_IMPORT_SKIP_REASONS = ['product_not_found', 'document_too_large', 'deleted'] as const;
/** Guest designs one import call takes (technical bound: each row is up to 2 MB). */
export const MAX_IMPORT_DESIGNS = 20;
/** Versions one page of the history returns at most. */
export const MAX_VERSION_PAGE = 100;
export const DRAWING_FORMATS = ['svg', 'dxf', 'pdf'] as const;
export const PRINT_METHODS = ['digital', 'offset', 'flexo', 'none'] as const;
export const PRINT_SIDES = ['outside', 'inside', 'both', 'none'] as const;
export const JSON_PATCH_OPS = ['add', 'remove', 'replace', 'move', 'copy', 'test'] as const;
/** Operations one autosave takes (technical bound; the patch is also ≤ 256 KiB, D-276). */
export const MAX_PATCH_OPERATIONS = 2000;
const STYLE_VARIANT_CODE = /^PK-[A-Z0-9]{2,8}-[0-9]{2,3}-[A-Z2-7]{4,8}$/;

function StyleVariantCodeField() {
  return applyDecorators(
    ApiPropertyOptional({
      example: 'PK-TE-01-K7QD',
      pattern: STYLE_VARIANT_CODE.source,
      description: 'D-275 the style-library variant the box is (its base must be the design’s pattern)',
    }),
    IsOptional(),
    IsString(),
    Matches(STYLE_VARIANT_CODE),
  );
}

function FinishesField() {
  return applyDecorators(
    ApiPropertyOptional({
      type: [String],
      example: ['dev-matt'],
      description: 'D-275 finish codes (`store.catalog` finishes); replaces the list',
    }),
    IsOptional(),
    IsString({ each: true }),
    ArrayMaxSize(20),
    Matches(/^[a-z0-9][a-z0-9_-]{0,63}$/, { each: true }),
  );
}

function SpecField() {
  return applyDecorators(
    ApiPropertyOptional({
      type: 'object',
      additionalProperties: true,
      example: {
        patternId: '0192f3a0-7c1e-7d2a-9b1f-00000000d001',
        materialId: '0192f3a0-7c1e-7d2a-9b1f-00000000d002',
      },
      description:
        'D-275 the calculator configuration the configurator built (no quantities), priced by the studio quote; ' +
        'absent = the previous version’s',
    }),
    IsOptional(),
    IsObject(),
  );
}
export const DRAWING_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'engine_unavailable'] as const;

export const DESIGN_IDS = {
  design: '0192f3a0-7c1e-7d2a-9b1f-0000000e5001',
  product: '0192f3a0-7c1e-7d2a-9b1f-0000000e5002',
  pattern: '0192f3a0-7c1e-7d2a-9b1f-0000000e5003',
  material: '0192f3a0-7c1e-7d2a-9b1f-0000000e5004',
  template: '0192f3a0-7c1e-7d2a-9b1f-0000000e5005',
  file: '0192f3a0-7c1e-7d2a-9b1f-0000000e5006',
  asset: '0192f3a0-7c1e-7d2a-9b1f-0000000e5007',
  drawing: '0192f3a0-7c1e-7d2a-9b1f-0000000e5008',
  order: '0192f3a0-7c1e-7d2a-9b1f-0000000e5009',
};
const DOCUMENT_EXAMPLE = {
  pages: [{ side: 'front', objects: [{ type: 'text', text: 'Packio', x: 10, y: 20 }] }],
};

function Dimension(description: string, optional = false) {
  return applyDecorators(
    (optional ? ApiPropertyOptional : ApiProperty)({ example: 100, minimum: 1, maximum: 5000, description }),
    ...(optional ? [IsOptional()] : []),
    Type(() => Number),
    IsNumber({ maxDecimalPlaces: 2 }),
    Min(1),
    Max(5000),
  );
}

export class CreateDesignDto {
  @ApiProperty({ format: 'uuid', example: DESIGN_IDS.product })
  @IsUUID()
  catalogProductId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: null,
    nullable: true,
    description:
      'D-285: a design of my company — its members comment, edit through edit links and are mentioned',
  })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional({ format: 'uuid', example: DESIGN_IDS.pattern })
  @IsOptional()
  @IsUUID()
  patternId?: string;

  @Dimension('Length, mm', true)
  lengthMm?: number;

  @Dimension('Width, mm', true)
  widthMm?: number;

  @Dimension('Height, mm', true)
  heightMm?: number;

  @EnumField(MEASUREMENT_BASES, 'MeasurementBasis', {
    example: 'internal',
    optional: true,
    description: 'Basis of the sizes (D-182). Absent: internal (assumed, deprecated)',
  })
  measurementBasis?: (typeof MEASUREMENT_BASES)[number];

  @ApiPropertyOptional({ format: 'uuid', example: DESIGN_IDS.material })
  @IsOptional()
  @IsUUID()
  materialId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: null,
    nullable: true,
    description: 'Start from a semi-design template: its design becomes version 1',
  })
  @IsOptional()
  @IsUUID()
  semiDesignTemplateId?: string;

  @ApiProperty({ example: 'กล่องกาแฟของฉัน', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({
    type: 'integer',
    example: 1,
    minimum: 1,
    description: 'Version of the document format',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schemaVersion?: number;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: DOCUMENT_EXAMPLE,
    description: 'The editor document (JSON, ≤ 2 MB); omitted when starting from a template',
  })
  @IsOptional()
  @IsObject()
  document?: Record<string, unknown>;

  @StyleVariantCodeField()
  styleVariantCode?: string;

  @EnumField(PRINT_METHODS, 'PrintMethod', {
    example: 'digital',
    optional: true,
    description: 'D-275 how it is printed',
  })
  printMethod?: (typeof PRINT_METHODS)[number];

  @EnumField(PRINT_SIDES, 'PrintSides', {
    example: 'outside',
    optional: true,
    description: 'D-275 which sides carry print',
  })
  printSides?: (typeof PRINT_SIDES)[number];

  @FinishesField()
  finishes?: string[];

  @SpecField()
  spec?: Record<string, unknown>;
}

export class SaveDesignDto {
  @ApiPropertyOptional({ example: 'กล่องกาแฟของฉัน v2', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiProperty({ type: 'integer', example: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schemaVersion!: number;

  @ApiProperty({ type: 'object', additionalProperties: true, example: DOCUMENT_EXAMPLE })
  @IsObject()
  document!: Record<string, unknown>;

  @ApiPropertyOptional({
    format: 'uuid',
    example: DESIGN_IDS.file,
    description: 'A preview image you uploaded',
  })
  @IsOptional()
  @IsUUID()
  thumbnailFileId?: string;

  @ApiPropertyOptional({
    enum: DESIGN_SAVE_KINDS,
    enumName: 'DesignSaveKind',
    default: 'manual',
    example: 'manual',
    description: 'The editor’s periodic autosave or a save the customer made; the history can hide autosaves',
  })
  @IsOptional()
  @IsIn(DESIGN_SAVE_KINDS)
  kind?: (typeof DESIGN_SAVE_KINDS)[number];

  @ApiPropertyOptional({
    example: 'ก่อนเปลี่ยนสีพื้น',
    maxLength: 100,
    description: 'A name for this version',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label?: string;

  @ApiPropertyOptional({ format: 'uuid', example: DESIGN_IDS.pattern, description: 'Change the box style' })
  @IsOptional()
  @IsUUID()
  patternId?: string;

  @ApiPropertyOptional({ format: 'uuid', example: DESIGN_IDS.material, description: 'Change the material' })
  @IsOptional()
  @IsUUID()
  materialId?: string;

  @Dimension('Length, mm', true)
  lengthMm?: number;

  @Dimension('Width, mm', true)
  widthMm?: number;

  @Dimension('Height, mm', true)
  heightMm?: number;

  @EnumField(MEASUREMENT_BASES, 'MeasurementBasis', {
    example: 'internal',
    optional: true,
    description: 'Basis of the sizes (D-182). Absent: internal (assumed, deprecated)',
  })
  measurementBasis?: (typeof MEASUREMENT_BASES)[number];

  @StyleVariantCodeField()
  styleVariantCode?: string;

  @EnumField(PRINT_METHODS, 'PrintMethod', {
    example: 'digital',
    optional: true,
    description: 'D-275 how it is printed',
  })
  printMethod?: (typeof PRINT_METHODS)[number];

  @EnumField(PRINT_SIDES, 'PrintSides', {
    example: 'outside',
    optional: true,
    description: 'D-275 which sides carry print',
  })
  printSides?: (typeof PRINT_SIDES)[number];

  @FinishesField()
  finishes?: string[];

  @SpecField()
  spec?: Record<string, unknown>;
}

export class JsonPatchOperationDto {
  @ApiProperty({ enum: JSON_PATCH_OPS, enumName: 'JsonPatchOp', example: 'replace' })
  @IsIn(JSON_PATCH_OPS)
  op!: (typeof JSON_PATCH_OPS)[number];

  @ApiProperty({ example: '/faces/front/objects/0/text', description: 'JSON Pointer (RFC 6901)' })
  @IsString()
  @MaxLength(1000)
  path!: string;

  @ApiPropertyOptional({ example: '/faces/front/objects/1', description: 'For move / copy (JSON Pointer)' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  from?: string;

  @ApiPropertyOptional({
    nullable: true,
    oneOf: [
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'object', additionalProperties: true },
      { type: 'array', items: {} },
    ],
    example: 'กาแฟคั่วเข้ม',
    description: 'For add / replace / test: any JSON value',
  })
  @IsOptional()
  value?: unknown;
}

export class PatchDesignDocumentDto {
  @ApiProperty({
    type: [JsonPatchOperationDto],
    description: `JSON Patch (RFC 6902) on the current version's document, applied in order, all or nothing; ≤ ${MAX_PATCH_OPERATIONS} operations, ≤ 256 KiB`,
  })
  @ValidateNested({ each: true })
  @Type(() => JsonPatchOperationDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PATCH_OPERATIONS)
  operations!: JsonPatchOperationDto[];

  @ApiPropertyOptional({
    type: 'integer',
    example: 1,
    minimum: 1,
    description: 'Absent: the current version’s',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schemaVersion?: number;

  @ApiPropertyOptional({
    enum: DESIGN_SAVE_KINDS,
    enumName: 'DesignSaveKind',
    default: 'autosave',
    example: 'autosave',
  })
  @IsOptional()
  @IsIn(DESIGN_SAVE_KINDS)
  kind?: (typeof DESIGN_SAVE_KINDS)[number];

  @ApiPropertyOptional({ example: 'ก่อนเปลี่ยนสีพื้น', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label?: string;

  @SpecField()
  spec?: Record<string, unknown>;
}

export class DesignListQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: DESIGN_LINK_FILTERS,
    enumName: 'DesignLinkFilter',
    default: 'any',
    description: '`linked`: used by at least one order (placed with it, or its artwork submitted from it)',
  })
  @IsOptional()
  @IsIn(DESIGN_LINK_FILTERS)
  linked?: (typeof DESIGN_LINK_FILTERS)[number];
}

export class DesignVersionListQuery {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 2,
    example: 40,
    description: 'Only versions before this number (the last `versionNo` of the previous page)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  before?: number;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: MAX_VERSION_PAGE,
    example: 20,
    description: 'At most this many versions; all when omitted',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_VERSION_PAGE)
  limit?: number;

  @ApiPropertyOptional({ enum: DESIGN_VERSION_KINDS, enumName: 'DesignVersionKind', example: 'manual' })
  @IsOptional()
  @IsIn(DESIGN_VERSION_KINDS)
  kind?: (typeof DESIGN_VERSION_KINDS)[number];
}

export class DuplicateDesignDto {
  @ApiProperty({ example: 'กล่องกาแฟของฉัน (สำเนา)', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;
}

export class ImportDesignRowDto {
  @ApiProperty({
    example: 'guest-a1b2c3',
    maxLength: 100,
    pattern: '^[A-Za-z0-9._:-]{1,100}$',
    description: 'The id the browser kept the design under; importing it again is a no-op',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{1,100}$/)
  localId!: string;

  @ApiProperty({ example: 'กล่องกาแฟของฉัน', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: DESIGN_IDS.product,
    description: 'Required to import: a row without an active catalogue product is skipped',
  })
  @IsOptional()
  @IsUUID()
  catalogProductId?: string;

  @ApiPropertyOptional({ format: 'uuid', example: DESIGN_IDS.pattern })
  @IsOptional()
  @IsUUID()
  patternId?: string;

  @ApiPropertyOptional({ format: 'uuid', example: DESIGN_IDS.material })
  @IsOptional()
  @IsUUID()
  materialId?: string;

  @Dimension('Length, mm', true)
  lengthMm?: number;

  @Dimension('Width, mm', true)
  widthMm?: number;

  @Dimension('Height, mm', true)
  heightMm?: number;

  @EnumField(MEASUREMENT_BASES, 'MeasurementBasis', {
    example: 'internal',
    optional: true,
    description: 'Basis of the sizes (D-182). Absent: internal (assumed, deprecated)',
  })
  measurementBasis?: (typeof MEASUREMENT_BASES)[number];

  @ApiProperty({ type: 'integer', example: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  schemaVersion!: number;

  @ApiProperty({ type: 'object', additionalProperties: true, example: DOCUMENT_EXAMPLE })
  @IsObject()
  document!: Record<string, unknown>;
}

export class ImportDesignsDto {
  @ApiProperty({ type: [ImportDesignRowDto], minItems: 1, maxItems: MAX_IMPORT_DESIGNS })
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_IMPORT_DESIGNS)
  @ValidateNested({ each: true })
  @Type(() => ImportDesignRowDto)
  designs!: ImportDesignRowDto[];
}

export class ImportedDesignDto {
  @ApiProperty({ example: 'guest-a1b2c3' })
  localId!: string;

  @ApiProperty({ format: 'uuid', example: DESIGN_IDS.design })
  designId!: string;
}

export class SkippedDesignDto {
  @ApiProperty({ example: 'guest-d4e5f6' })
  localId!: string;

  @ApiProperty({
    enum: DESIGN_IMPORT_SKIP_REASONS,
    enumName: 'DesignImportSkipReason',
    example: 'product_not_found',
    description:
      '`product_not_found`: no active catalogue product given; `document_too_large`: over 2 MB; `deleted`: imported ' +
      'before and since deleted',
  })
  reason!: string;
}

export class ImportDesignsResultDto {
  @ApiProperty({
    type: [ImportedDesignDto],
    description: 'Imported now, or by an earlier call with the same local id',
  })
  imported!: ImportedDesignDto[];

  @ApiProperty({ type: [SkippedDesignDto] })
  skipped!: SkippedDesignDto[];
}

export class ShareDesignResultDto {
  @ApiProperty({ example: 'bX2kQ9…', description: 'Shown once; only its hash is kept' })
  shareToken!: string;

  @ApiProperty({ example: '/v1/store/shared-designs/bX2kQ9…' })
  sharePath!: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-30T10:00:00+07:00' })
  sharedAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-15T10:00:00+07:00' })
  expiresAt!: string;
}

export class AddDesignAssetDto {
  @ApiProperty({ format: 'uuid', example: DESIGN_IDS.file })
  @IsUUID()
  fileId!: string;

  @ApiProperty({ enum: DESIGN_ASSET_KINDS, enumName: 'DesignAssetKind', example: 'logo' })
  @IsIn(DESIGN_ASSET_KINDS)
  kind!: (typeof DESIGN_ASSET_KINDS)[number];
}

export class RequestDrawingDto {
  @ApiProperty({ format: 'uuid', example: DESIGN_IDS.pattern, description: 'A box style with a dieline key' })
  @IsUUID()
  patternId!: string;

  @Dimension('Length, mm')
  lengthMm!: number;

  @Dimension('Width, mm')
  widthMm!: number;

  @Dimension('Height, mm')
  heightMm!: number;

  @EnumField(MEASUREMENT_BASES, 'MeasurementBasis', {
    example: 'internal',
    optional: true,
    description: 'Basis of the sizes (D-182). A dieline is drawn from inside sizes: only internal',
  })
  measurementBasis?: (typeof MEASUREMENT_BASES)[number];

  @ApiProperty({ enum: DRAWING_FORMATS, enumName: 'DrawingFormat', example: 'pdf' })
  @IsIn(DRAWING_FORMATS)
  format!: (typeof DRAWING_FORMATS)[number];

  @ApiPropertyOptional({
    format: 'uuid',
    example: DESIGN_IDS.design,
    description: 'The design this drawing is for',
  })
  @IsOptional()
  @IsUUID()
  designId?: string;
}

export class OrderDrawingDto {
  @ApiPropertyOptional({ enum: DRAWING_FORMATS, enumName: 'DrawingFormat', default: 'pdf', example: 'pdf' })
  @IsOptional()
  @IsIn(DRAWING_FORMATS)
  format?: (typeof DRAWING_FORMATS)[number];
}

export class SubmitFromDesignDto {
  @ApiPropertyOptional({
    format: 'uuid',
    example: DESIGN_IDS.design,
    description: 'Defaults to the design the order was placed with',
  })
  @IsOptional()
  @IsUUID()
  designId?: string;

  @ApiPropertyOptional({ example: 'ใช้แบบที่ออกแบบออนไลน์', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class SetTemplateDesignDto {
  @ApiProperty({
    format: 'uuid',
    example: DESIGN_IDS.design,
    description: 'A design staff authored; its current version is used',
  })
  @IsUUID()
  designId!: string;
}

export class DesignAssetDto {
  @ApiProperty({ format: 'uuid', example: DESIGN_IDS.asset })
  id!: string;

  @ApiProperty({ format: 'uuid', example: DESIGN_IDS.file })
  fileId!: string;

  @ApiProperty({ enum: DESIGN_ASSET_KINDS, enumName: 'DesignAssetKind', example: 'logo' })
  kind!: string;

  @ApiProperty({ example: 'image/png' })
  mimeType!: string;

  @ApiProperty({ type: 'integer', example: 48213 })
  sizeBytes!: number;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 1200,
    description: 'Read from the file once scanned',
  })
  widthPx!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 800 })
  heightPx!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://files.example.test/customer_content/2026/09/0192f3a0?X-Amz-Signature=fake',
    description: 'Signed download URL (5 minutes); null until the file is scanned clean',
  })
  url!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-09-27T10:05:00+07:00' })
  urlExpiresAt!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-09-27T10:00:00+07:00' })
  createdAt!: string;
}

export class DesignProductRefDto {
  @ApiProperty({ format: 'uuid', example: DESIGN_IDS.product })
  id!: string;

  @ApiProperty({ example: 'tuck-end-box' })
  slug!: string;

  @ApiProperty({ example: 'กล่องฝาเสียบ' })
  nameTh!: string;

  @ApiProperty({ example: 'Tuck-end box' })
  nameEn!: string;

  @ApiProperty({ example: 'folding_box' })
  productTypeCode!: string;
}

export class DesignShareStateDto {
  @ApiProperty({ format: 'date-time', example: '2026-09-30T10:00:00+07:00' })
  sharedAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-15T10:00:00+07:00' })
  expiresAt!: string;
}

export class DesignLockDto {
  @ApiProperty({ type: 'integer', example: 3 })
  versionNo!: number;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000a301' })
  orderId!: string;

  @ApiProperty({ example: 'PK-2610-0001-01' })
  orderCode!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T10:00:00+07:00' })
  lockedAt!: string;
}

export class DesignDocumentDto {
  @ApiProperty({ format: 'uuid', example: DESIGN_IDS.design })
  id!: string;

  @ApiProperty({ example: 'กล่องกาแฟของฉัน' })
  title!: string;

  @ApiProperty({ format: 'uuid', example: DESIGN_IDS.product })
  catalogProductId!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: DESIGN_IDS.pattern })
  patternId!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 100, description: 'mm' })
  lengthMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 60, description: 'mm' })
  widthMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 40, description: 'mm' })
  heightMm!: number | null;

  @ApiProperty({
    enum: MEASUREMENT_BASES,
    enumName: 'MeasurementBasis',
    example: 'internal',
    description: 'Basis of the sizes (D-182)',
  })
  measurementBasis!: (typeof MEASUREMENT_BASES)[number];

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  materialId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  semiDesignTemplateId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  thumbnailFileId!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 3 })
  versionNo!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 1 })
  schemaVersion!: number | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: DOCUMENT_EXAMPLE,
    description: 'The current version (null in lists)',
  })
  document!: Record<string, unknown> | null;

  @ApiProperty({ type: [DesignAssetDto] })
  assets!: DesignAssetDto[];

  @ApiProperty({ type: DesignProductRefDto })
  product!: DesignProductRefDto;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Signed URL of the preview image (5 minutes)',
  })
  thumbnailUrl!: string | null;

  @ApiProperty({
    type: [OrderRefDto],
    description: 'Orders placed with this design or whose artwork was submitted from it, newest first',
  })
  orders!: OrderRefDto[];

  @ApiProperty({ type: DesignShareStateDto, nullable: true, description: 'The live view-only link (D-226)' })
  share!: DesignShareStateDto | null;

  @ApiProperty({ type: String, nullable: true, example: 'PK-TE-01-K7QD' })
  styleVariantCode!: string | null;

  @ApiProperty({ enum: PRINT_METHODS, enumName: 'PrintMethod', nullable: true, example: 'digital' })
  printMethod!: string | null;

  @ApiProperty({ enum: PRINT_SIDES, enumName: 'PrintSides', nullable: true, example: 'outside' })
  printSides!: string | null;

  @ApiProperty({ type: [String], example: ['dev-matt'] })
  finishes!: string[];

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: null,
    description: 'D-275 the current version’s calculator spec (null in lists)',
  })
  spec!: Record<string, unknown> | null;

  @ApiProperty({
    type: DesignLockDto,
    nullable: true,
    description: 'D-276 the version the latest order locked; editing always makes a new version',
  })
  lock!: DesignLockDto | null;

  @ApiProperty({ format: 'date-time', example: '2026-09-20T10:00:00+07:00' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-27T10:00:00+07:00' })
  updatedAt!: string;
}

export class DesignOwnerDto {
  @ApiProperty({ format: 'uuid', example: DESIGN_IDS.design })
  id!: string;

  @ApiProperty({ example: 'สมชาย ทดสอบ' })
  displayName!: string;

  @ApiProperty({ enum: ['customer', 'staff'], enumName: 'AnnotationAuthorKind', example: 'customer' })
  kind!: string;
}

/** The staff view of a design: whose it is and whether I may save it (my own copies only). */
export class AdminDesignDocumentDto extends DesignDocumentDto {
  @ApiProperty({ type: DesignOwnerDto })
  owner!: DesignOwnerDto;

  @ApiProperty({
    example: false,
    description: 'True only for my own designs (a customer’s design is copied first)',
  })
  editable!: boolean;
}

export class DesignVersionDto {
  @ApiProperty({ type: 'integer', example: 2 })
  versionNo!: number;

  @ApiProperty({ type: 'integer', example: 1 })
  schemaVersion!: number;

  @ApiProperty({
    example: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    description: 'SHA-256 (hex) of the document',
  })
  contentSha256!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: null,
    description: 'Only when one version is read',
  })
  document!: Record<string, unknown> | null;

  @ApiProperty({ enum: DESIGN_VERSION_KINDS, enumName: 'DesignVersionKind', example: 'manual' })
  kind!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  label!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  thumbnailFileId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Signed URL (5 minutes)' })
  thumbnailUrl!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: null,
    description:
      'D-275 the box at this version (style variant, sizes + basis, material, print method / sides, finishes)',
  })
  box!: Record<string, unknown> | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: null,
    description: 'D-275 the calculator spec at this version (only when one version is read)',
  })
  spec!: Record<string, unknown> | null;

  @ApiProperty({ format: 'date-time', example: '2026-09-27T10:00:00+07:00' })
  createdAt!: string;
}

export class SharedDesignDto {
  @ApiProperty({ example: 'กล่องกาแฟของฉัน' })
  title!: string;

  @ApiProperty({ type: DesignProductRefDto })
  product!: DesignProductRefDto;

  @ApiProperty({ type: String, nullable: true, example: 'rte', description: 'Dieline of the box style' })
  dielineKey!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 100, description: 'mm' })
  lengthMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 60, description: 'mm' })
  widthMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 40, description: 'mm' })
  heightMm!: number | null;

  @ApiProperty({
    enum: MEASUREMENT_BASES,
    enumName: 'MeasurementBasis',
    example: 'internal',
    description: 'Basis of the sizes (D-182)',
  })
  measurementBasis!: (typeof MEASUREMENT_BASES)[number];

  @ApiProperty({ type: 'integer', nullable: true, example: 3 })
  versionNo!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 1 })
  schemaVersion!: number | null;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true, example: DOCUMENT_EXAMPLE })
  document!: Record<string, unknown> | null;

  @ApiProperty({ type: [DesignAssetDto] })
  assets!: DesignAssetDto[];

  @ApiProperty({ type: String, nullable: true, example: null })
  thumbnailUrl!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-09-30T10:00:00+07:00' })
  sharedAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-15T10:00:00+07:00' })
  expiresAt!: string;

  @ApiProperty({
    enum: ['view', 'comment', 'edit'],
    enumName: 'ShareScope',
    example: 'view',
    description: 'What the link allows (D-285); the single link of D-226 is view',
  })
  scope!: string;
}

export class DrawingJobDto {
  @ApiProperty({ format: 'uuid', example: DESIGN_IDS.drawing })
  id!: string;

  @ApiProperty({ enum: DRAWING_STATUSES, enumName: 'DrawingStatus', example: 'queued' })
  status!: string;

  @ApiProperty({ enum: DRAWING_FORMATS, enumName: 'DrawingFormat', example: 'pdf' })
  format!: string;

  @ApiProperty({ format: 'uuid', example: DESIGN_IDS.pattern })
  patternId!: string;

  @ApiProperty({ example: 100, description: 'mm' })
  lengthMm!: number;

  @ApiProperty({ example: 60, description: 'mm' })
  widthMm!: number;

  @ApiProperty({ example: 40, description: 'mm' })
  heightMm!: number;

  @ApiProperty({
    enum: MEASUREMENT_BASES,
    enumName: 'MeasurementBasis',
    example: 'internal',
    description: 'Basis of the sizes (D-182)',
  })
  measurementBasis!: (typeof MEASUREMENT_BASES)[number];

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'The order it was drawn for',
  })
  orderId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'The drawing; download via files',
  })
  outputFileId!: string | null;

  @ApiProperty({ type: AttachedFileDto, nullable: true, description: 'The drawing file (name, type, size)' })
  outputFile!: AttachedFileDto | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  engineVersion!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  error!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-09-27T10:00:00+07:00' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', type: String, nullable: true, example: null })
  completedAt!: string | null;
}

const ASSET_EXAMPLE: DesignAssetDto = {
  id: DESIGN_IDS.asset,
  fileId: DESIGN_IDS.file,
  kind: 'logo',
  mimeType: 'image/png',
  sizeBytes: 48213,
  widthPx: 1200,
  heightPx: 800,
  url: 'https://files.example.test/customer_content/2026/09/0192f3a0?X-Amz-Signature=fake',
  urlExpiresAt: '2026-09-27T10:05:00+07:00',
  createdAt: '2026-09-27T10:00:00+07:00',
};

const PRODUCT_REF_EXAMPLE: DesignProductRefDto = {
  id: DESIGN_IDS.product,
  slug: 'tuck-end-box',
  nameTh: 'กล่องฝาเสียบ',
  nameEn: 'Tuck-end box',
  productTypeCode: 'folding_box',
};

export const DESIGN_EXAMPLE: DesignDocumentDto = {
  id: DESIGN_IDS.design,
  title: 'กล่องกาแฟของฉัน',
  catalogProductId: DESIGN_IDS.product,
  patternId: DESIGN_IDS.pattern,
  lengthMm: 100,
  widthMm: 60,
  heightMm: 40,
  measurementBasis: 'internal',
  materialId: null,
  semiDesignTemplateId: null,
  thumbnailFileId: null,
  versionNo: 3,
  schemaVersion: 1,
  document: DOCUMENT_EXAMPLE,
  assets: [ASSET_EXAMPLE],
  product: PRODUCT_REF_EXAMPLE,
  thumbnailUrl: null,
  orders: [{ orderId: DESIGN_IDS.order, orderCode: 'PK-2610-0001-01' }],
  share: null,
  styleVariantCode: 'PK-TE-01-K7QD',
  printMethod: 'digital',
  printSides: 'outside',
  finishes: ['dev-matt'],
  spec: null,
  lock: {
    versionNo: 3,
    orderId: DESIGN_IDS.order,
    orderCode: 'PK-2610-0001-01',
    lockedAt: '2026-09-27T11:00:00+07:00',
  },
  createdAt: '2026-09-20T10:00:00+07:00',
  updatedAt: '2026-09-27T10:00:00+07:00',
};

export const ADMIN_DESIGN_EXAMPLE: AdminDesignDocumentDto = {
  ...DESIGN_EXAMPLE,
  owner: { id: '0192f3a0-7c1e-7d2a-9b1f-0000000e5010', displayName: 'สมชาย ทดสอบ', kind: 'customer' },
  editable: false,
};

export const SHARED_DESIGN_EXAMPLE: SharedDesignDto = {
  title: DESIGN_EXAMPLE.title,
  product: PRODUCT_REF_EXAMPLE,
  dielineKey: 'rte',
  lengthMm: 100,
  widthMm: 60,
  heightMm: 40,
  measurementBasis: 'internal',
  versionNo: 3,
  schemaVersion: 1,
  document: DOCUMENT_EXAMPLE,
  assets: [ASSET_EXAMPLE],
  thumbnailUrl: null,
  sharedAt: '2026-09-30T10:00:00+07:00',
  expiresAt: '2026-10-15T10:00:00+07:00',
  scope: 'view',
};

export const DRAWING_EXAMPLE: DrawingJobDto = {
  id: DESIGN_IDS.drawing,
  status: 'queued',
  format: 'pdf',
  patternId: DESIGN_IDS.pattern,
  lengthMm: 100,
  widthMm: 60,
  heightMm: 40,
  measurementBasis: 'internal',
  orderId: null,
  outputFileId: null,
  outputFile: null,
  engineVersion: null,
  error: null,
  createdAt: '2026-09-27T10:00:00+07:00',
  completedAt: null,
};

export const CREATE_DESIGN_EXAMPLE = {
  catalogProductId: DESIGN_IDS.product,
  patternId: DESIGN_IDS.pattern,
  lengthMm: 100,
  widthMm: 60,
  heightMm: 40,
  measurementBasis: 'internal',
  title: 'กล่องกาแฟของฉัน',
  schemaVersion: 1,
  document: DOCUMENT_EXAMPLE,
};
