import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

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

export const MATERIAL_KINDS = [
  'paper',
  'board',
  'corrugated_board',
  'film',
  'foil',
  'label_stock',
  'other',
] as const;
export const FINISH_KINDS = [
  'coating',
  'lamination',
  'foil',
  'emboss',
  'deboss',
  'spot_uv',
  'window',
  'other',
] as const;
export const INK_COLOUR_KINDS = ['process', 'spot', 'white', 'metallic'] as const;

export const MATERIAL_IDS = {
  family: '0192f3a0-7c1e-7d2a-9b1f-00000000d001',
  flute: '0192f3a0-7c1e-7d2a-9b1f-00000000d002',
  material: '0192f3a0-7c1e-7d2a-9b1f-00000000d003',
  group: '0192f3a0-7c1e-7d2a-9b1f-00000000d004',
  finish: '0192f3a0-7c1e-7d2a-9b1f-00000000d005',
  foil: '0192f3a0-7c1e-7d2a-9b1f-00000000d006',
  ink: '0192f3a0-7c1e-7d2a-9b1f-00000000d007',
  diecut: '0192f3a0-7c1e-7d2a-9b1f-00000000d008',
  assembly: '0192f3a0-7c1e-7d2a-9b1f-00000000d009',
  difficulty: '0192f3a0-7c1e-7d2a-9b1f-00000000d010',
  packing: '0192f3a0-7c1e-7d2a-9b1f-00000000d011',
  specTitle: '0192f3a0-7c1e-7d2a-9b1f-00000000d012',
  productType: '0192f3a0-7c1e-7d2a-9b1f-00000000c002',
} as const;

class StatusQuery extends PageQuery {
  @EnumField(CATALOG_STATUSES, 'CatalogStatus', { example: 'active', optional: true })
  status?: Status;
}

/** Lists filtered by status only. */
export class CatalogStatusListQuery extends StatusQuery {}

/** Lists of grouped definitions: `groupId` filter. */
export class GroupedListQuery extends StatusQuery {
  @RefField({ example: MATERIAL_IDS.group, optional: true })
  groupId?: string;
}

// ------------------------------------------------------------------------------------------------
// Groups (finish, ink colour, diecut, assembly, difficulty level) — one shape for all five
// ------------------------------------------------------------------------------------------------

export class CatalogGroupDto {
  @IdField(MATERIAL_IDS.group)
  id!: string;

  @ApiProperty({ example: 'coating' })
  code!: string;

  @ApiProperty({ example: 'เคลือบ' })
  nameTh!: string;

  @ApiProperty({ example: 'Coatings' })
  nameEn!: string;

  @ApiProperty({ type: 'integer', example: 10 })
  sort!: number;

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: Status;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateCatalogGroupDto {
  @CodeField({ example: 'coating' })
  code!: string;

  @TextField({ example: 'เคลือบ' })
  nameTh!: string;

  @TextField({ example: 'Coatings' })
  nameEn!: string;

  @SortField()
  sort?: number;

  @StatusField()
  status?: Status;
}

export class UpdateCatalogGroupDto extends PartialType(CreateCatalogGroupDto) {}

// ------------------------------------------------------------------------------------------------
// Material families (D-040 group 1 index)
// ------------------------------------------------------------------------------------------------

export class MaterialFamilyDto {
  @IdField(MATERIAL_IDS.family)
  id!: string;

  @ApiProperty({ example: 'art_card' })
  code!: string;

  @ApiProperty({ example: 'กระดาษอาร์ตการ์ด' })
  nameTh!: string;

  @ApiProperty({ example: 'Art card' })
  nameEn!: string;

  @ApiProperty({ example: 'THB/kg', description: 'Unit of the material price index (D-040 group 1)' })
  indexUnit!: string;

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: Status;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateMaterialFamilyDto {
  @CodeField({ example: 'art_card' })
  code!: string;

  @TextField({ example: 'กระดาษอาร์ตการ์ด' })
  nameTh!: string;

  @TextField({ example: 'Art card' })
  nameEn!: string;

  @TextField({ example: 'THB/kg', max: 32 })
  indexUnit!: string;

  @StatusField()
  status?: Status;
}

export class UpdateMaterialFamilyDto extends PartialType(CreateMaterialFamilyDto) {}

// ------------------------------------------------------------------------------------------------
// Flute types (take-up factors indicative, fixed by the corrugate port)
// ------------------------------------------------------------------------------------------------

export class FluteTypeDto {
  @IdField(MATERIAL_IDS.flute)
  id!: string;

  @ApiProperty({ example: 'BC' })
  code!: string;

  @ApiProperty({ example: 'ลอน BC (5 ชั้น)' })
  name!: string;

  @ApiProperty({ type: 'integer', example: 5 })
  layers!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 1.36,
    description: 'Legacy take-up factor A (indicative)',
  })
  colA!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 1.46 })
  colC!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: null })
  colDd!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: null })
  colG!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: null })
  colFh!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: null })
  z!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: null,
    description: 'Board caliper allowance of a telescope lid (legacy `flute_type.ct`, corrugate calculator)',
  })
  ct!: number | null;

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: Status;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateFluteTypeDto {
  @CodeField({ example: 'BC' })
  code!: string;

  @TextField({ example: 'ลอน BC (5 ชั้น)' })
  name!: string;

  @IntField({ example: 5, min: 1, max: 15 })
  layers!: number;

  @DecimalField({ example: 1.36, nullable: true, scale: 4 })
  colA?: number | null;

  @DecimalField({ example: 1.46, nullable: true, scale: 4 })
  colC?: number | null;

  @DecimalField({ example: null, nullable: true, scale: 4 })
  colDd?: number | null;

  @DecimalField({ example: null, nullable: true, scale: 4 })
  colG?: number | null;

  @DecimalField({ example: null, nullable: true, scale: 4 })
  colFh?: number | null;

  @DecimalField({ example: null, nullable: true, scale: 4 })
  z?: number | null;

  @DecimalField({ example: null, nullable: true, scale: 4 })
  ct?: number | null;

  @StatusField()
  status?: Status;
}

export class UpdateFluteTypeDto extends PartialType(CreateFluteTypeDto) {}

// ------------------------------------------------------------------------------------------------
// Materials
// ------------------------------------------------------------------------------------------------

export class MaterialDto {
  @IdField(MATERIAL_IDS.material)
  id!: string;

  @ApiProperty({ example: 'art-card-350' })
  code!: string;

  @ApiProperty({ enum: MATERIAL_KINDS, enumName: 'MaterialKind', example: 'paper' })
  kind!: (typeof MATERIAL_KINDS)[number];

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: MATERIAL_IDS.family })
  familyId!: string | null;

  @ApiProperty({ example: 'อาร์ตการ์ด 350 แกรม' })
  nameTh!: string;

  @ApiProperty({ example: 'Art card 350 gsm' })
  nameEn!: string;

  @ApiProperty({ type: Number, nullable: true, example: 350, description: 'Grammage (g/m²)' })
  gsm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: null, description: 'Thickness (µm), films' })
  micron!: number | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  fluteTypeId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'art' })
  paperGroup!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'ขาว' })
  insideColour!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'ขาว' })
  outsideColour!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  strength!: string | null;

  @ApiProperty({ example: false })
  isFoodGrade!: boolean;

  @ApiProperty({
    example: false,
    description:
      'The board takes a coating (legacy `paper_grade.can_finish`; the corrugate calculator refuses coating otherwise)',
  })
  coatable!: boolean;

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: Status;

  @TimestampField(TS)
  updatedAt!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Storefront description (Thai), shown in the configurator',
  })
  descriptionTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Storefront description (English)' })
  descriptionEn!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'Storefront image (an image file; served once scanned clean)',
  })
  imageFileId!: string | null;
}

export class CreateMaterialDto {
  @CodeField({ example: 'art-card-350', description: 'Natural key used by Excel import' })
  code!: string;

  @EnumField(MATERIAL_KINDS, 'MaterialKind', { example: 'paper' })
  kind!: (typeof MATERIAL_KINDS)[number];

  @RefField({ example: MATERIAL_IDS.family, nullable: true })
  familyId?: string | null;

  @TextField({ example: 'อาร์ตการ์ด 350 แกรม' })
  nameTh!: string;

  @TextField({ example: 'Art card 350 gsm' })
  nameEn!: string;

  @DecimalField({ example: 350, nullable: true, positive: true, unit: 'g/m²' })
  gsm?: number | null;

  @DecimalField({ example: null, nullable: true, positive: true, unit: 'µm' })
  micron?: number | null;

  @RefField({ example: null, nullable: true })
  fluteTypeId?: string | null;

  @TextField({ example: 'art', nullable: true, max: 64 })
  paperGroup?: string | null;

  @TextField({ example: 'ขาว', nullable: true, max: 64 })
  insideColour?: string | null;

  @TextField({ example: 'ขาว', nullable: true, max: 64 })
  outsideColour?: string | null;

  @TextField({ example: null, nullable: true, max: 64 })
  strength?: string | null;

  @BoolField({ example: false, optional: true })
  isFoodGrade?: boolean;

  @BoolField({ example: false, optional: true })
  coatable?: boolean;

  @StatusField()
  status?: Status;

  @TextField({ example: 'ผิวเรียบ พิมพ์สีสด', nullable: true, max: 1000 })
  descriptionTh?: string | null;

  @TextField({ example: 'Smooth surface, vivid print', nullable: true, max: 1000 })
  descriptionEn?: string | null;

  @RefField({ example: '0192f3a0-7c1e-7d2a-9b1f-00000000c009', nullable: true })
  imageFileId?: string | null;
}

export class UpdateMaterialDto extends PartialType(CreateMaterialDto) {}

export class MaterialListQuery extends StatusQuery {
  @EnumField(MATERIAL_KINDS, 'MaterialKind', { example: 'paper', optional: true })
  kind?: (typeof MATERIAL_KINDS)[number];

  @RefField({ example: MATERIAL_IDS.family, optional: true })
  familyId?: string;
}

// ------------------------------------------------------------------------------------------------
// Finishes, foil types, ink colours
// ------------------------------------------------------------------------------------------------

export class FinishDto {
  @IdField(MATERIAL_IDS.finish)
  id!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: MATERIAL_IDS.group })
  groupId!: string | null;

  @ApiProperty({ example: 'matt-lamination' })
  code!: string;

  @ApiProperty({ example: 'เคลือบด้าน' })
  nameTh!: string;

  @ApiProperty({ example: 'Matt lamination' })
  nameEn!: string;

  @ApiProperty({ enum: FINISH_KINDS, enumName: 'FinishKind', example: 'lamination' })
  finishKind!: (typeof FINISH_KINDS)[number];

  @ApiProperty({ example: false, description: 'Foil / emboss / window → +20 pp inspection (D-076)' })
  isSpecial!: boolean;

  @ApiProperty({ example: false })
  requiresAmount!: boolean;

  @ApiProperty({ example: false })
  requiresWidth!: boolean;

  @ApiProperty({ example: false })
  requiresLength!: boolean;

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: Status;

  @TimestampField(TS)
  updatedAt!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Storefront description (Thai), shown in the configurator',
  })
  descriptionTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Storefront description (English)' })
  descriptionEn!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'Storefront image (an image file; served once scanned clean)',
  })
  imageFileId!: string | null;
}

export class CreateFinishDto {
  @RefField({ example: MATERIAL_IDS.group, nullable: true })
  groupId?: string | null;

  @CodeField({ example: 'matt-lamination' })
  code!: string;

  @TextField({ example: 'เคลือบด้าน' })
  nameTh!: string;

  @TextField({ example: 'Matt lamination' })
  nameEn!: string;

  @EnumField(FINISH_KINDS, 'FinishKind', { example: 'lamination' })
  finishKind!: (typeof FINISH_KINDS)[number];

  @BoolField({ example: false, optional: true, description: 'Foil / emboss / window (D-076)' })
  isSpecial?: boolean;

  @BoolField({ example: false, optional: true })
  requiresAmount?: boolean;

  @BoolField({ example: false, optional: true })
  requiresWidth?: boolean;

  @BoolField({ example: false, optional: true })
  requiresLength?: boolean;

  @StatusField()
  status?: Status;

  @TextField({ example: 'ผิวเรียบ พิมพ์สีสด', nullable: true, max: 1000 })
  descriptionTh?: string | null;

  @TextField({ example: 'Smooth surface, vivid print', nullable: true, max: 1000 })
  descriptionEn?: string | null;

  @RefField({ example: '0192f3a0-7c1e-7d2a-9b1f-00000000c009', nullable: true })
  imageFileId?: string | null;
}

export class UpdateFinishDto extends PartialType(CreateFinishDto) {}

export class FinishListQuery extends GroupedListQuery {
  @EnumField(FINISH_KINDS, 'FinishKind', { example: 'lamination', optional: true })
  finishKind?: (typeof FINISH_KINDS)[number];
}

export class FoilTypeDto {
  @IdField(MATERIAL_IDS.foil)
  id!: string;

  @ApiProperty({ example: 'gold' })
  code!: string;

  @ApiProperty({ example: 'ฟอยล์ทอง' })
  name!: string;

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: Status;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateFoilTypeDto {
  @CodeField({ example: 'gold' })
  code!: string;

  @TextField({ example: 'ฟอยล์ทอง' })
  name!: string;

  @StatusField()
  status?: Status;
}

export class UpdateFoilTypeDto extends PartialType(CreateFoilTypeDto) {}

export class InkColourDto {
  @IdField(MATERIAL_IDS.ink)
  id!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: MATERIAL_IDS.group })
  groupId!: string | null;

  @ApiProperty({ example: 'cmyk-c' })
  code!: string;

  @ApiProperty({ example: 'Cyan' })
  name!: string;

  @ApiProperty({ enum: INK_COLOUR_KINDS, enumName: 'InkColourKind', example: 'process' })
  colourKind!: (typeof INK_COLOUR_KINDS)[number];

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: Status;

  @TimestampField(TS)
  updatedAt!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Storefront description (Thai), shown in the configurator',
  })
  descriptionTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Storefront description (English)' })
  descriptionEn!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'Storefront image (an image file; served once scanned clean)',
  })
  imageFileId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '#00A0E9',
    description: 'Swatch shown in the configurator (upper-case hex)',
  })
  swatchHex!: string | null;
}

export class CreateInkColourDto {
  @RefField({ example: MATERIAL_IDS.group, nullable: true })
  groupId?: string | null;

  @CodeField({ example: 'cmyk-c' })
  code!: string;

  @TextField({ example: 'Cyan' })
  name!: string;

  @EnumField(INK_COLOUR_KINDS, 'InkColourKind', { example: 'process' })
  colourKind!: (typeof INK_COLOUR_KINDS)[number];

  @StatusField()
  status?: Status;

  @TextField({ example: 'ผิวเรียบ พิมพ์สีสด', nullable: true, max: 1000 })
  descriptionTh?: string | null;

  @TextField({ example: 'Smooth surface, vivid print', nullable: true, max: 1000 })
  descriptionEn?: string | null;

  @RefField({ example: '0192f3a0-7c1e-7d2a-9b1f-00000000c009', nullable: true })
  imageFileId?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '#00A0E9',
    pattern: '^#[0-9A-F]{6}$',
    description: 'Swatch shown in the configurator (upper-case hex)',
  })
  @IsOptional()
  @Matches(/^#[0-9A-F]{6}$/)
  swatchHex?: string | null;
}

export class UpdateInkColourDto extends PartialType(CreateInkColourDto) {}

// ------------------------------------------------------------------------------------------------
// Diecut types, assemblies, difficulty levels, packing types, spec titles
// ------------------------------------------------------------------------------------------------

export class DiecutTypeDto {
  @IdField(MATERIAL_IDS.diecut)
  id!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: MATERIAL_IDS.group })
  groupId!: string | null;

  @ApiProperty({ example: 'standard-diecut' })
  code!: string;

  @ApiProperty({ example: 'ไดคัทมาตรฐาน' })
  nameTh!: string;

  @ApiProperty({ example: 'Standard die-cut' })
  nameEn!: string;

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: Status;

  @TimestampField(TS)
  updatedAt!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Storefront description (Thai), shown in the configurator',
  })
  descriptionTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Storefront description (English)' })
  descriptionEn!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'Storefront image (an image file; served once scanned clean)',
  })
  imageFileId!: string | null;
}

export class CreateDiecutTypeDto {
  @RefField({ example: MATERIAL_IDS.group, nullable: true })
  groupId?: string | null;

  @CodeField({ example: 'standard-diecut' })
  code!: string;

  @TextField({ example: 'ไดคัทมาตรฐาน' })
  nameTh!: string;

  @TextField({ example: 'Standard die-cut' })
  nameEn!: string;

  @StatusField()
  status?: Status;

  @TextField({ example: 'ผิวเรียบ พิมพ์สีสด', nullable: true, max: 1000 })
  descriptionTh?: string | null;

  @TextField({ example: 'Smooth surface, vivid print', nullable: true, max: 1000 })
  descriptionEn?: string | null;

  @RefField({ example: '0192f3a0-7c1e-7d2a-9b1f-00000000c009', nullable: true })
  imageFileId?: string | null;
}

export class UpdateDiecutTypeDto extends PartialType(CreateDiecutTypeDto) {}

export class AssemblyDto {
  @IdField(MATERIAL_IDS.assembly)
  id!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: MATERIAL_IDS.group })
  groupId!: string | null;

  @ApiProperty({ example: 'side-glue' })
  code!: string;

  @ApiProperty({ example: 'ปะกาวข้าง' })
  nameTh!: string;

  @ApiProperty({ example: 'Side gluing' })
  nameEn!: string;

  @ApiProperty({ example: false })
  requiresAmount!: boolean;

  @ApiProperty({ example: false })
  requiresWidth!: boolean;

  @ApiProperty({ example: false })
  requiresLength!: boolean;

  @ApiProperty({ example: false, description: 'Indicative (calculator port)' })
  isDoubleItem!: boolean;

  @ApiProperty({ example: false, description: 'Indicative (calculator port)' })
  skipWaste!: boolean;

  @ApiProperty({
    example: false,
    description: 'Added to every corrugate part, e.g. packing (legacy assembly group 22, U-B6 quirk C8)',
  })
  autoAdd!: boolean;

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: Status;

  @TimestampField(TS)
  updatedAt!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Storefront description (Thai), shown in the configurator',
  })
  descriptionTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Storefront description (English)' })
  descriptionEn!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'Storefront image (an image file; served once scanned clean)',
  })
  imageFileId!: string | null;
}

export class CreateAssemblyDto {
  @RefField({ example: MATERIAL_IDS.group, nullable: true })
  groupId?: string | null;

  @CodeField({ example: 'side-glue' })
  code!: string;

  @TextField({ example: 'ปะกาวข้าง' })
  nameTh!: string;

  @TextField({ example: 'Side gluing' })
  nameEn!: string;

  @BoolField({ example: false, optional: true })
  requiresAmount?: boolean;

  @BoolField({ example: false, optional: true })
  requiresWidth?: boolean;

  @BoolField({ example: false, optional: true })
  requiresLength?: boolean;

  @BoolField({ example: false, optional: true })
  isDoubleItem?: boolean;

  @BoolField({ example: false, optional: true })
  skipWaste?: boolean;

  @BoolField({ example: false, optional: true })
  autoAdd?: boolean;

  @StatusField()
  status?: Status;

  @TextField({ example: 'ผิวเรียบ พิมพ์สีสด', nullable: true, max: 1000 })
  descriptionTh?: string | null;

  @TextField({ example: 'Smooth surface, vivid print', nullable: true, max: 1000 })
  descriptionEn?: string | null;

  @RefField({ example: '0192f3a0-7c1e-7d2a-9b1f-00000000c009', nullable: true })
  imageFileId?: string | null;
}

export class UpdateAssemblyDto extends PartialType(CreateAssemblyDto) {}

export class DifficultyLevelDto {
  @IdField(MATERIAL_IDS.difficulty)
  id!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: MATERIAL_IDS.group })
  groupId!: string | null;

  @ApiProperty({ example: 'level-2' })
  code!: string;

  @ApiProperty({ example: 'ระดับ 2' })
  nameTh!: string;

  @ApiProperty({ example: 'Level 2' })
  nameEn!: string;

  @ApiProperty({ type: 'integer', example: 20 })
  sort!: number;

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: Status;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateDifficultyLevelDto {
  @RefField({ example: MATERIAL_IDS.group, nullable: true })
  groupId?: string | null;

  @CodeField({ example: 'level-2' })
  code!: string;

  @TextField({ example: 'ระดับ 2' })
  nameTh!: string;

  @TextField({ example: 'Level 2' })
  nameEn!: string;

  @SortField()
  sort?: number;

  @StatusField()
  status?: Status;
}

export class UpdateDifficultyLevelDto extends PartialType(CreateDifficultyLevelDto) {}

export class PackingTypeDto {
  @IdField(MATERIAL_IDS.packing)
  id!: string;

  @ApiProperty({ example: 'carton' })
  code!: string;

  @ApiProperty({ example: 'บรรจุลังกระดาษ' })
  nameTh!: string;

  @ApiProperty({ example: 'Carton' })
  nameEn!: string;

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: Status;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreatePackingTypeDto {
  @CodeField({ example: 'carton' })
  code!: string;

  @TextField({ example: 'บรรจุลังกระดาษ' })
  nameTh!: string;

  @TextField({ example: 'Carton' })
  nameEn!: string;

  @StatusField()
  status?: Status;
}

export class UpdatePackingTypeDto extends PartialType(CreatePackingTypeDto) {}

export class SpecTitleDto {
  @IdField(MATERIAL_IDS.specTitle)
  id!: string;

  @ApiProperty({ example: 'paper' })
  code!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: MATERIAL_IDS.productType })
  productTypeId!: string | null;

  @ApiProperty({ example: 'กระดาษ' })
  nameTh!: string;

  @ApiProperty({ example: 'Paper' })
  nameEn!: string;

  @ApiProperty({ type: 'integer', example: 10 })
  sort!: number;

  @ApiProperty({ enum: CATALOG_STATUSES, enumName: 'CatalogStatus', example: 'active' })
  status!: Status;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateSpecTitleDto {
  @CodeField({ example: 'paper' })
  code!: string;

  @RefField({ example: MATERIAL_IDS.productType, nullable: true })
  productTypeId?: string | null;

  @TextField({ example: 'กระดาษ' })
  nameTh!: string;

  @TextField({ example: 'Paper' })
  nameEn!: string;

  @SortField()
  sort?: number;

  @StatusField()
  status?: Status;
}

export class UpdateSpecTitleDto extends PartialType(CreateSpecTitleDto) {}

export class SpecTitleListQuery extends StatusQuery {
  @RefField({ example: MATERIAL_IDS.productType, optional: true })
  productTypeId?: string;
}
