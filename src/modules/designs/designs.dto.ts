import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Online designs and dieline drawings (B4.1). */

export const DESIGN_ASSET_KINDS = ['image', 'font', 'logo', 'svg'] as const;
export const DRAWING_FORMATS = ['svg', 'dxf', 'pdf'] as const;
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

  @ApiProperty({ example: '2026-09-27T10:00:00+07:00' })
  updatedAt!: string;
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

  @ApiProperty({ example: '2026-09-27T10:00:00+07:00' })
  createdAt!: string;
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

  @ApiProperty({ type: String, nullable: true, example: null })
  engineVersion!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  error!: string | null;

  @ApiProperty({ example: '2026-09-27T10:00:00+07:00' })
  createdAt!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  completedAt!: string | null;
}

export const DESIGN_EXAMPLE: DesignDocumentDto = {
  id: DESIGN_IDS.design,
  title: 'กล่องกาแฟของฉัน',
  catalogProductId: DESIGN_IDS.product,
  patternId: DESIGN_IDS.pattern,
  lengthMm: 100,
  widthMm: 60,
  heightMm: 40,
  materialId: null,
  semiDesignTemplateId: null,
  thumbnailFileId: null,
  versionNo: 3,
  schemaVersion: 1,
  document: DOCUMENT_EXAMPLE,
  assets: [{ id: DESIGN_IDS.asset, fileId: DESIGN_IDS.file, kind: 'logo' }],
  updatedAt: '2026-09-27T10:00:00+07:00',
};

export const DRAWING_EXAMPLE: DrawingJobDto = {
  id: DESIGN_IDS.drawing,
  status: 'queued',
  format: 'pdf',
  patternId: DESIGN_IDS.pattern,
  lengthMm: 100,
  widthMm: 60,
  heightMm: 40,
  orderId: null,
  outputFileId: null,
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
  title: 'กล่องกาแฟของฉัน',
  schemaVersion: 1,
  document: DOCUMENT_EXAMPLE,
};
