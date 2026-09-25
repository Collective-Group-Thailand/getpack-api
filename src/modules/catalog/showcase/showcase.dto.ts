import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsObject, IsOptional, IsUUID, Matches } from 'class-validator';

import {
  CATALOG_STATUSES,
  EnumField,
  IdField,
  RefField,
  SlugField,
  SortField,
  StatusField,
  TextField,
  TimestampField,
} from '../crud/dto-fields';

type Status = (typeof CATALOG_STATUSES)[number];
const TS = '2026-09-25T10:00:00+07:00';

export const SHOWCASE_IDS = {
  category: '0192f3a0-7c1e-7d2a-9b1f-00000000b001',
  product: '0192f3a0-7c1e-7d2a-9b1f-00000000b002',
  semiDesign: '0192f3a0-7c1e-7d2a-9b1f-00000000b003',
  template: '0192f3a0-7c1e-7d2a-9b1f-00000000b004',
  font: '0192f3a0-7c1e-7d2a-9b1f-00000000b005',
  file: '0192f3a0-7c1e-7d2a-9b1f-00000000b006',
  catalogProduct: '0192f3a0-7c1e-7d2a-9b1f-00000000c004',
  standardSize: '0192f3a0-7c1e-7d2a-9b1f-00000000c005',
} as const;

class StatusQuery extends PageQuery {
  @EnumField(CATALOG_STATUSES, 'CatalogStatus', { example: 'active', optional: true })
  status?: Status;
}

// ------------------------------------------------------------------------------------------------
// Showcase categories & products (legacy sample products / "Product Groups")
// ------------------------------------------------------------------------------------------------

export class ShowcaseCategoryDto {
  @IdField(SHOWCASE_IDS.category)
  id!: string;

  @ApiProperty({ example: 'cosmetics' })
  slug!: string;

  @ApiProperty({ example: 'บรรจุภัณฑ์เครื่องสำอาง' })
  nameTh!: string;

  @ApiProperty({ example: 'Cosmetics packaging' })
  nameEn!: string;

  @ApiProperty({ type: 'integer', example: 10 })
  sort!: number;

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: Status;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateShowcaseCategoryDto {
  @SlugField({ example: 'cosmetics' })
  slug!: string;

  @TextField({ example: 'บรรจุภัณฑ์เครื่องสำอาง' })
  nameTh!: string;

  @TextField({ example: 'Cosmetics packaging' })
  nameEn!: string;

  @SortField()
  sort?: number;

  @StatusField()
  status?: Status;
}

export class UpdateShowcaseCategoryDto extends PartialType(CreateShowcaseCategoryDto) {}

export class ShowcaseCategoryListQuery extends StatusQuery {}

export class ShowcaseProductDto {
  @IdField(SHOWCASE_IDS.product)
  id!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: SHOWCASE_IDS.category })
  categoryId!: string | null;

  @ApiProperty({ format: 'uuid', example: SHOWCASE_IDS.catalogProduct })
  catalogProductId!: string;

  @ApiProperty({ example: 'serum-box-30ml' })
  slug!: string;

  @ApiProperty({ example: 'กล่องเซรั่ม 30 มล.' })
  nameTh!: string;

  @ApiProperty({ example: 'Serum box 30 ml' })
  nameEn!: string;

  @ApiProperty({ type: String, nullable: true, example: 'กล่องฝาเสียบ อาร์ตการ์ด 350 แกรม เคลือบด้าน' })
  descriptionTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  descriptionEn!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: SHOWCASE_IDS.file })
  coverFileId!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { lengthMm: 40, widthMm: 40, heightMm: 120 },
    description: 'Pre-filled configurator input (validated by the calculator port, B2.3)',
  })
  preset!: Record<string, unknown>;

  @ApiProperty({ type: 'integer', example: 10 })
  sort!: number;

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: Status;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateShowcaseProductDto {
  @RefField({ example: SHOWCASE_IDS.category, nullable: true })
  categoryId?: string | null;

  @RefField({ example: SHOWCASE_IDS.catalogProduct })
  catalogProductId!: string;

  @SlugField({ example: 'serum-box-30ml' })
  slug!: string;

  @TextField({ example: 'กล่องเซรั่ม 30 มล.' })
  nameTh!: string;

  @TextField({ example: 'Serum box 30 ml' })
  nameEn!: string;

  @TextField({ example: 'กล่องฝาเสียบ อาร์ตการ์ด 350 แกรม เคลือบด้าน', nullable: true, max: 5000 })
  descriptionTh?: string | null;

  @TextField({ example: null, nullable: true, max: 5000 })
  descriptionEn?: string | null;

  @RefField({ example: SHOWCASE_IDS.file, nullable: true })
  coverFileId?: string | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { lengthMm: 40, widthMm: 40, heightMm: 120 },
  })
  @IsOptional()
  @IsObject()
  preset?: Record<string, unknown>;

  @SortField()
  sort?: number;

  @StatusField()
  status?: Status;
}

export class UpdateShowcaseProductDto extends PartialType(CreateShowcaseProductDto) {}

export class ShowcaseProductListQuery extends StatusQuery {
  @RefField({ example: SHOWCASE_IDS.category, optional: true })
  categoryId?: string;

  @RefField({ example: SHOWCASE_IDS.catalogProduct, optional: true })
  catalogProductId?: string;
}

// ------------------------------------------------------------------------------------------------
// Semi-designs, templates, fonts
// ------------------------------------------------------------------------------------------------

export class SemiDesignDto {
  @IdField(SHOWCASE_IDS.semiDesign)
  id!: string;

  @ApiProperty({ format: 'uuid', example: SHOWCASE_IDS.catalogProduct })
  catalogProductId!: string;

  @ApiProperty({ example: 'มินิมอล ขาว-ดำ' })
  name!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: SHOWCASE_IDS.file })
  thumbnailFileId!: string | null;

  @ApiProperty({ type: [String], example: ['#000000', '#FFFFFF'], description: 'Palette (`#RRGGBB`)' })
  colours!: string[];

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: Status;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateSemiDesignDto {
  @RefField({ example: SHOWCASE_IDS.catalogProduct })
  catalogProductId!: string;

  @TextField({ example: 'มินิมอล ขาว-ดำ' })
  name!: string;

  @RefField({ example: SHOWCASE_IDS.file, nullable: true })
  thumbnailFileId?: string | null;

  @StatusField()
  status?: Status;
}

export class UpdateSemiDesignDto extends PartialType(
  OmitType(CreateSemiDesignDto, ['catalogProductId'] as const),
) {}

export class SemiDesignListQuery extends StatusQuery {
  @RefField({ example: SHOWCASE_IDS.catalogProduct, optional: true })
  catalogProductId?: string;
}

export class ReplaceColoursDto {
  @ApiProperty({ type: [String], example: ['#000000', '#FFFFFF'] })
  @Matches(/^#[0-9A-Fa-f]{6}$/, { each: true })
  colours!: string[];
}

export class SemiDesignTemplateDto {
  @IdField(SHOWCASE_IDS.template)
  id!: string;

  @ApiProperty({ format: 'uuid', example: SHOWCASE_IDS.semiDesign })
  semiDesignId!: string;

  @ApiProperty({ format: 'uuid', example: SHOWCASE_IDS.standardSize })
  standardSizeId!: string;

  @ApiProperty({ format: 'uuid', example: SHOWCASE_IDS.file })
  thumbnailFileId!: string;

  @ApiProperty({ type: [String], format: 'uuid', example: [SHOWCASE_IDS.font] })
  fontIds!: string[];

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: Status;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateSemiDesignTemplateDto {
  @RefField({ example: SHOWCASE_IDS.semiDesign })
  semiDesignId!: string;

  @RefField({
    example: SHOWCASE_IDS.standardSize,
    description: 'A standard size of the same catalogue product',
  })
  standardSizeId!: string;

  @RefField({ example: SHOWCASE_IDS.file })
  thumbnailFileId!: string;

  @StatusField()
  status?: Status;
}

export class UpdateSemiDesignTemplateDto extends PartialType(
  OmitType(CreateSemiDesignTemplateDto, ['semiDesignId'] as const),
) {}

export class SemiDesignTemplateListQuery extends StatusQuery {
  @RefField({ example: SHOWCASE_IDS.semiDesign, optional: true })
  semiDesignId?: string;
}

export class ReplaceFontsDto {
  @ApiProperty({ type: [String], format: 'uuid', example: [SHOWCASE_IDS.font] })
  @IsUUID('all', { each: true })
  fontIds!: string[];
}

export class DesignFontDto {
  @IdField(SHOWCASE_IDS.font)
  id!: string;

  @ApiProperty({ example: 'Noto Sans Thai' })
  name!: string;

  @ApiProperty({ format: 'uuid', example: SHOWCASE_IDS.file })
  fileId!: string;

  @ApiProperty({ example: 'SIL Open Font License 1.1' })
  licenceNote!: string;

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: Status;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateDesignFontDto {
  @TextField({ example: 'Noto Sans Thai' })
  name!: string;

  @RefField({ example: SHOWCASE_IDS.file, description: 'Uploaded font file' })
  fileId!: string;

  @TextField({ example: 'SIL Open Font License 1.1', max: 1000 })
  licenceNote!: string;

  @StatusField()
  status?: Status;
}

export class UpdateDesignFontDto extends PartialType(CreateDesignFontDto) {}

export class DesignFontListQuery extends StatusQuery {}
