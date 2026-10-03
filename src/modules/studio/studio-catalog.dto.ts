import { EnumField, TextField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { QR_LEVELS, SYMBOLOGIES } from './barcodes';
import { LOGO_ROLES, USE_CASES } from './studio-catalog.service';

export const CATALOG_STATES = ['draft', 'pending_approval', 'published', 'retired'] as const;
export const ELEMENT_KINDS = ['shape', 'icon', 'mark'] as const;
const CODE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

// --- brand kits -----------------------------------------------------------------------------------------------

export class PaletteColourDto {
  @TextField({ example: 'แดงแบรนด์', max: 60 })
  name!: string;

  @ApiProperty({ example: '#c0392b', pattern: HEX.source })
  @IsString()
  @Matches(HEX)
  hex!: string;

  @ApiPropertyOptional({ example: '0/85/80/10', description: 'C/M/Y/K % as the brand guideline gives it' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,3}\/\d{1,3}\/\d{1,3}\/\d{1,3}$/)
  cmyk?: string;
}

export class FontPairDto {
  @ApiProperty({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-00000000f501',
    description: 'A studio font',
  })
  @IsUUID()
  heading!: string;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000f502' })
  @IsUUID()
  body!: string;
}

export class KitLogoInputDto {
  @ApiProperty({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-00000000f601',
    description: 'A company brand asset',
  })
  @IsUUID()
  brandAssetId!: string;

  @ApiProperty({ enum: LOGO_ROLES, enumName: 'BrandKitLogoRole', example: 'primary' })
  @IsIn(LOGO_ROLES)
  role!: (typeof LOGO_ROLES)[number];
}

export class BrandKitInputDto {
  @TextField({ example: 'แบรนด์หลัก', max: 100 })
  name!: string;

  @ApiProperty({ type: [PaletteColourDto] })
  @IsArray()
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => PaletteColourDto)
  palette!: PaletteColourDto[];

  @ApiProperty({ type: [FontPairDto] })
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => FontPairDto)
  fontPairs!: FontPairDto[];

  @ApiProperty({ type: [KitLogoInputDto] })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => KitLogoInputDto)
  logos!: KitLogoInputDto[];

  @TextField({ example: 'เว้นระยะรอบโลโก้อย่างน้อย 5 มม.', max: 2000, optional: true, nullable: true })
  usageNotes?: string | null;
}

export class BrandKitLogoDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000f601' })
  brandAssetId!: string;

  @ApiProperty({ example: 'โลโก้หลัก' })
  name!: string;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000f603' })
  fileId!: string;

  @ApiProperty({ enum: LOGO_ROLES, enumName: 'BrandKitLogoRole', example: 'primary' })
  role!: string;
}

export class BrandKitDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000f701' })
  id!: string;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000c001' })
  companyId!: string;

  @ApiProperty({ example: 'แบรนด์หลัก' })
  name!: string;

  @ApiProperty({ type: [PaletteColourDto] })
  palette!: PaletteColourDto[];

  @ApiProperty({ type: [FontPairDto] })
  fontPairs!: FontPairDto[];

  @ApiProperty({ type: [BrandKitLogoDto] })
  logos!: BrandKitLogoDto[];

  @ApiProperty({ type: String, nullable: true, example: null })
  usageNotes!: string | null;

  @ApiProperty({ enum: ['active', 'archived'], enumName: 'BrandKitStatus', example: 'active' })
  status!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T10:00:00+07:00' })
  updatedAt!: string;
}

// --- templates ------------------------------------------------------------------------------------------------

export class StudioTemplateInputDto {
  @ApiProperty({ example: 'coffee-kraft-01', pattern: CODE.source })
  @IsString()
  @Matches(CODE)
  code!: string;

  @TextField({ example: 'กาแฟคราฟต์ มินิมอล', max: 200 })
  nameTh!: string;

  @TextField({ example: 'Coffee kraft minimal', max: 200 })
  nameEn!: string;

  @ApiProperty({ enum: USE_CASES, enumName: 'StudioUseCase', isArray: true, example: ['coffee'] })
  @IsArray()
  @ArrayMaxSize(USE_CASES.length)
  @IsIn(USE_CASES, { each: true })
  useCases!: string[];

  @ApiProperty({ type: [String], example: ['tuck_end'], description: 'Style families it re-flows to' })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  styleFamilies!: string[];

  @ApiProperty({ type: 'integer', example: 1, description: 'Version of the web’s constraint-layout format' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  layoutSchemaVersion!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { zones: [{ id: 'logo', anchor: 'front.center', widthPct: 40 }] },
    description: 'The constraint layout (owned by the web; stored as given)',
  })
  @IsObject()
  layout!: Record<string, unknown>;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, example: null })
  @IsOptional()
  @IsUUID()
  thumbnailFileId?: string | null;
}

export class StudioTemplateQuery {
  @EnumField(CATALOG_STATES, 'StudioCatalogStatus', { example: 'published', optional: true })
  status?: (typeof CATALOG_STATES)[number];

  @EnumField(USE_CASES, 'StudioUseCase', { example: 'coffee', optional: true })
  useCase?: string;

  @ApiPropertyOptional({ example: 'tuck_end' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  styleFamily?: string;
}

export class StoreTemplateQuery {
  @EnumField(USE_CASES, 'StudioUseCase', { example: 'coffee', optional: true })
  useCase?: string;

  @ApiPropertyOptional({ example: 'tuck_end' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  styleFamily?: string;
}

export class StudioTemplateDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000f801' })
  id!: string;

  @ApiProperty({ example: 'coffee-kraft-01' })
  code!: string;

  @ApiProperty({ example: 'กาแฟคราฟต์ มินิมอล' })
  nameTh!: string;

  @ApiProperty({ example: 'Coffee kraft minimal' })
  nameEn!: string;

  @ApiProperty({ enum: USE_CASES, enumName: 'StudioUseCase', isArray: true, example: ['coffee'] })
  useCases!: string[];

  @ApiProperty({ type: [String], example: ['tuck_end'] })
  styleFamilies!: string[];

  @ApiProperty({ type: 'integer', example: 1 })
  layoutSchemaVersion!: number;

  @ApiProperty({ type: 'object', additionalProperties: true, example: { zones: [] } })
  layout!: Record<string, unknown>;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  thumbnailFileId!: string | null;

  @ApiProperty({ enum: CATALOG_STATES, enumName: 'StudioCatalogStatus', example: 'published' })
  status!: string;
}

export class AdminStudioTemplateDto extends StudioTemplateDto {
  @ApiProperty({ type: UserRefDto })
  createdBy!: UserRefDto;

  @ApiProperty({ type: UserRefDto, nullable: true })
  approvedBy!: UserRefDto | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  approvedAt!: string | null;
}

// --- elements -------------------------------------------------------------------------------------------------

export class StudioElementInputDto {
  @ApiProperty({ example: 'recycle-loop', pattern: CODE.source })
  @IsString()
  @Matches(CODE)
  code!: string;

  @ApiProperty({ enum: ELEMENT_KINDS, enumName: 'StudioElementKind', example: 'mark' })
  @IsIn(ELEMENT_KINDS)
  kind!: (typeof ELEMENT_KINDS)[number];

  @TextField({ example: 'สัญลักษณ์รีไซเคิล', max: 200 })
  nameTh!: string;

  @TextField({ example: 'Recycle loop', max: 200 })
  nameEn!: string;

  @ApiProperty({
    example: 'M50 5 L95 90 L5 90 Z',
    description: 'SVG path in a 100 × 100 box — our own drawing',
  })
  @IsString()
  @MaxLength(20000)
  path!: string;

  @ApiProperty({ type: [String], example: ['packaging'] })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags!: string[];

  @ApiProperty({
    example: false,
    description: 'A mark with legal meaning: placed only with a declared right',
  })
  @IsBoolean()
  requiresRight!: boolean;
}

export class StudioElementQuery {
  @EnumField(CATALOG_STATES, 'StudioCatalogStatus', { example: 'published', optional: true })
  status?: (typeof CATALOG_STATES)[number];

  @EnumField(ELEMENT_KINDS, 'StudioElementKind', { example: 'mark', optional: true })
  kind?: (typeof ELEMENT_KINDS)[number];
}

export class StoreElementQuery {
  @EnumField(ELEMENT_KINDS, 'StudioElementKind', { example: 'mark', optional: true })
  kind?: (typeof ELEMENT_KINDS)[number];
}

export class StudioElementDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000f901' })
  id!: string;

  @ApiProperty({ example: 'recycle-loop' })
  code!: string;

  @ApiProperty({ enum: ELEMENT_KINDS, enumName: 'StudioElementKind', example: 'mark' })
  kind!: string;

  @ApiProperty({ example: 'สัญลักษณ์รีไซเคิล' })
  nameTh!: string;

  @ApiProperty({ example: 'Recycle loop' })
  nameEn!: string;

  @ApiProperty({ example: 'M50 5 L95 90 L5 90 Z' })
  path!: string;

  @ApiProperty({ type: [String], example: ['packaging'] })
  tags!: string[];

  @ApiProperty({ example: false })
  requiresRight!: boolean;

  @ApiProperty({ enum: CATALOG_STATES, enumName: 'StudioCatalogStatus', example: 'published' })
  status!: string;
}

export class StoreStudioElementDto extends StudioElementDto {
  @ApiProperty({
    example: true,
    description: 'I may place it: no right needed, or declared by me or a company of mine',
  })
  usable!: boolean;
}

export class DeclareRightDto {
  @TextField({
    example: 'บริษัทได้รับอนุญาตใช้เครื่องหมายนี้ตามใบรับรองเลขที่ … (fake)',
    max: 2000,
    description: 'What entitles you to use the mark',
  })
  statement!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-00000000c001',
    description: 'Declare for my company (Company Admin); absent: for myself',
  })
  @IsOptional()
  @IsUUID()
  companyId?: string;
}

export class RightDeclarationDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000fa01' })
  id!: string;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000f901' })
  elementId!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  companyId!: string | null;

  @ApiProperty({ example: 'บริษัทได้รับอนุญาตใช้เครื่องหมายนี้ (fake)' })
  statement!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T10:00:00+07:00' })
  declaredAt!: string;
}

// --- barcodes -------------------------------------------------------------------------------------------------

export class ValidateBarcodeDto {
  @ApiProperty({ enum: SYMBOLOGIES, enumName: 'BarcodeSymbology', example: 'ean13' })
  @IsIn(SYMBOLOGIES)
  symbology!: (typeof SYMBOLOGIES)[number];

  @ApiProperty({ example: '000012345678', maxLength: 3000 })
  @IsString()
  @MaxLength(3000)
  value!: string;

  @ApiPropertyOptional({ enum: QR_LEVELS, enumName: 'QrErrorCorrection', example: 'M' })
  @IsOptional()
  @IsIn(QR_LEVELS)
  level?: (typeof QR_LEVELS)[number];
}

export class BarcodeCheckDto {
  @ApiProperty({ example: true })
  valid!: boolean;

  @ApiProperty({
    type: [String],
    example: [],
    description: '`digits_only`, `wrong_length`, `check_digit`, `not_ascii`, `empty`, `too_long_for_level`',
  })
  problems!: string[];

  @ApiProperty({ type: String, nullable: true, example: '0000123456784', description: 'The value to encode' })
  normalised!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 29.83,
    description: 'GS1: smallest printed width incl. quiet zones (80 % magnification), mm',
  })
  minWidthMm!: number | null;
}
