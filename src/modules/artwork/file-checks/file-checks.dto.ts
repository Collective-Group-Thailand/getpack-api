import { DestinationInputDto } from '@modules/carts/carts.dto';
import { TimestampField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { PreflightSizeDto } from '../artwork.dto';
import { CHECK_LEVELS, UPLOAD_CHECKS } from './report';

/** C9 (D-457) the own-file check before ordering (`/v1/store/file-checks`). */

export const FILE_CHECK_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export const FILE_PRINT_METHODS = ['none', 'spot', 'cmyk'] as const;
const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;

// --- inputs -------------------------------------------------------------------------------------------------

export class CreateFileCheckDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    minItems: 1,
    maxItems: 20,
    example: ['0192f3a0-7c1e-7d2a-9b1f-0000000fc001'],
    description:
      'My uploaded files (`store.files.presign` purpose `artwork` → PUT → `complete`), in order: each is one variant ' +
      'of the same order',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  fileIds!: string[];

  @ApiPropertyOptional({
    example: 'uat-postal-box-b',
    description: 'The product I order, when I chose it first; absent → taken from the file’s die lines',
  })
  @IsOptional()
  @Matches(SLUG)
  productSlug?: string;

  @ApiPropertyOptional({ example: 'C', description: 'The product’s standard size code' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  sizeCode?: string;
}

export class AddFileCheckFileDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000fc002' })
  @IsUUID()
  fileId!: string;

  @ApiPropertyOptional({
    type: 'integer',
    example: 1,
    description: 'A corrected file for this variant (a new version, re-checked); absent → a new variant',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  variantNo?: number;
}

export class UpdateFileCheckSpecDto {
  @ApiPropertyOptional({ type: String, nullable: true, example: 'uat-postal-box-b' })
  @IsOptional()
  @Matches(SLUG)
  productSlug?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'C' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  sizeCode?: string | null;

  @ApiPropertyOptional({
    enum: FILE_PRINT_METHODS,
    enumName: 'PrintSideMethod',
    nullable: true,
    example: 'cmyk',
    description: 'The print method of the outside (D-443 vocabulary): none, spot colour(s) or CMYK',
  })
  @IsOptional()
  @IsIn([...FILE_PRINT_METHODS, null])
  printMethod?: (typeof FILE_PRINT_METHODS)[number] | null;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: true,
    example: 1,
    description: 'Spot colours the method prints',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(12)
  printSpotColours?: number | null;
}

export class FileCheckCartDto {
  @ApiProperty({ type: 'integer', example: 1, description: 'The variant (file) to order' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  variantNo!: number;

  @ApiProperty({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-00000000a201',
    description: 'My saved quotation of the check’s product (`store.quotes.save`, design `own_file`)',
  })
  @IsUUID()
  quoteId!: string;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000a202' })
  @IsUUID()
  quoteOptionId!: string;

  @ApiPropertyOptional({ type: [DestinationInputDto], description: 'As `store.cart.addItem`' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DestinationInputDto)
  destinations?: DestinationInputDto[];
}

// --- outputs ------------------------------------------------------------------------------------------------

export class FileCheckRuleItemDto {
  @ApiProperty({ enum: UPLOAD_CHECKS, enumName: 'UploadCheck', example: 'missing_bleed' })
  check!: string;

  @ApiProperty({
    example: true,
    description:
      'false: the check is not run automatically (Prepress has not set its rule) — the team checks it',
  })
  evaluated!: boolean;
}

export class FileCheckRulesDto {
  @ApiProperty({ example: '3', description: 'Bleed beyond the cut, mm (`artwork.preflight_rules`)' })
  bleedMm!: string;

  @ApiProperty({ example: '3', description: 'Safe distance inside the cut and folds, mm' })
  safeZoneMm!: string;

  @ApiProperty({ example: '1', description: 'Size tolerance of detection and the size check, mm' })
  sizeToleranceMm!: string;

  @ApiProperty({
    type: 'integer',
    example: 209715200,
    description: 'Largest file checked automatically, bytes',
  })
  maxBytes!: number;

  @ApiProperty({ type: [String], example: ['.pdf', '.ai'], description: 'Accepted file extensions' })
  extensions!: string[];

  @ApiProperty({ type: [FileCheckRuleItemDto], description: 'The 12 checks, in the page’s order' })
  checks!: FileCheckRuleItemDto[];
}

export class FileCheckSheetDto {
  @ApiProperty({ example: 1017.2 })
  widthMm!: number;

  @ApiProperty({ example: 527.5 })
  heightMm!: number;

  @ApiProperty({
    enum: ['die', 'trim'],
    enumName: 'FileCheckSheetSource',
    example: 'die',
    description: 'Die lines found, or the TrimBox',
  })
  source!: 'die' | 'trim';
}

export class FileCheckMatchDto {
  @ApiProperty({ example: 'uat-postal-box-b' })
  productSlug!: string;

  @ApiProperty({ example: 'กล่องไปรษณีย์ ฝาชน 3 ชั้น (ลอน B)' })
  productNameTh!: string;

  @ApiProperty({ example: 'Postal box RSC 3-ply (B-flute)' })
  productNameEn!: string;

  @ApiProperty({ example: 'C' })
  sizeCode!: string;

  @ApiProperty({ example: 'เบอร์ C' })
  sizeName!: string;

  @ApiProperty({
    type: [Number],
    example: [300, 200, 110],
    description: 'Inside length × width × height, mm',
  })
  insideMm!: number[];

  @ApiProperty({ example: 0.4, description: 'Largest side difference of the die to the blank, mm' })
  deltaMm!: number;
}

export class FileCheckDetectionDto {
  @ApiProperty({ type: FileCheckSheetDto, nullable: true })
  sheet!: FileCheckSheetDto | null;

  @ApiProperty({
    type: FileCheckMatchDto,
    nullable: true,
    description: 'null: no product and size within tolerance',
  })
  match!: FileCheckMatchDto | null;
}

export class FileCheckPointDto {
  @ApiProperty({ example: 312.4, description: 'Points, PDF page space (y up)' })
  x!: number;

  @ApiProperty({ example: 140.2 })
  y!: number;
}

export class FileCheckItemDto {
  @ApiProperty({ enum: UPLOAD_CHECKS, enumName: 'UploadCheck', example: 'missing_bleed' })
  check!: string;

  @ApiProperty({
    enum: CHECK_LEVELS,
    enumName: 'UploadCheckLevel',
    example: 'must_fix',
    description:
      '`must_fix` (a failing block check — the cart stays closed) · `review` · `pass` · `not_checked` (Prepress checks it)',
  })
  level!: string;

  @ApiProperty({ type: 'integer', nullable: true, example: 1 })
  page!: number | null;

  @ApiProperty({ example: 'ระยะตัดตก (bleed) 0 มม. ไม่ถึง 3 มม. ทุกด้าน' })
  messageTh!: string;

  @ApiProperty({ example: 'Bleed 0 mm is less than 3 mm on some side' })
  messageEn!: string;

  @ApiProperty({ type: 'object', additionalProperties: true, example: { leastBleedMm: 0, requiredMm: 3 } })
  measurements!: Record<string, unknown>;

  @ApiProperty({
    type: FileCheckPointDto,
    nullable: true,
    description: 'Marker position; null for the whole sheet',
  })
  at!: FileCheckPointDto | null;
}

export class FileCheckCountsDto {
  @ApiProperty({ type: 'integer', example: 1 })
  mustFix!: number;

  @ApiProperty({ type: 'integer', example: 1 })
  review!: number;

  @ApiProperty({ type: 'integer', example: 7 })
  pass!: number;

  @ApiProperty({ type: 'integer', example: 3 })
  notChecked!: number;
}

export class FileCheckPageDto {
  @ApiProperty({ type: [Number], example: [0, 0, 2900, 1510], description: 'Points' })
  mediaBox!: number[];

  @ApiProperty({ type: [Number], nullable: true, example: [8.5, 8.5, 2891.5, 1501.5] })
  trimBox!: number[] | null;

  @ApiProperty({ type: [Number], nullable: true, example: [8.5, 8.5, 2891.5, 1501.5] })
  dieBox!: number[] | null;
}

export class FileCheckInksDto {
  @ApiProperty({
    example: true,
    description: 'Process colour (CMYK with C/M/Y, RGB, colour images) is painted',
  })
  process!: boolean;

  @ApiProperty({
    type: [String],
    example: ['PANTONE 349 C'],
    description: 'Printed spot colours (die layers excluded)',
  })
  spotColours!: string[];

  @ApiProperty({
    enum: FILE_PRINT_METHODS,
    enumName: 'PrintSideMethod',
    example: 'cmyk',
    description:
      'The method that prints the file as it is: `cmyk` for process work, `spot` for spot or black-only work',
  })
  recommended!: string;
}

export class FileCheckReportDto {
  @ApiProperty({ type: [FileCheckItemDto], description: 'The 12 checks, in the page’s order' })
  items!: FileCheckItemDto[];

  @ApiProperty({ type: FileCheckCountsDto })
  counts!: FileCheckCountsDto;

  @ApiProperty({ example: true, description: 'Something must be fixed before the file can go in the cart' })
  blocking!: boolean;

  @ApiProperty({ type: FileCheckPageDto, nullable: true })
  page!: FileCheckPageDto | null;

  @ApiProperty({
    type: PreflightSizeDto,
    nullable: true,
    description:
      'The blank of the chosen product and size the checks compared with; null when none is chosen',
  })
  expected!: PreflightSizeDto | null;

  @ApiProperty({
    type: FileCheckInksDto,
    nullable: true,
    description: 'What the file prints with; null when unreadable',
  })
  inks!: FileCheckInksDto | null;
}

export class FileCheckVersionDto {
  @ApiProperty({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000fcf01',
    description: 'Also the report id',
  })
  id!: string;

  @ApiProperty({ type: 'integer', example: 1 })
  versionNo!: number;

  @ApiProperty({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000fc001',
    description: 'The original file',
  })
  fileId!: string;

  @ApiProperty({ example: 'baan_box_v1.pdf' })
  fileName!: string;

  @ApiProperty({ type: 'integer', example: 18_400_000 })
  sizeBytes!: number;

  @ApiProperty({ enum: FILE_CHECK_STATUSES, enumName: 'FileCheckStatus', example: 'done' })
  status!: string;

  @ApiProperty({ type: 'integer', example: 5, description: '0–5: read · die lines · match · checks · ready' })
  stage!: number;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Why a file could not be read' })
  error!: string | null;

  @ApiProperty({ type: FileCheckDetectionDto, nullable: true })
  detection!: FileCheckDetectionDto | null;

  @ApiProperty({ type: FileCheckReportDto, nullable: true })
  report!: FileCheckReportDto | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'The cart line this version is in',
  })
  cartItemId!: string | null;

  @TimestampField('2026-10-29T10:00:00+07:00')
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-29T10:00:12+07:00' })
  completedAt!: string | null;
}

export class FileCheckVariantDto {
  @ApiProperty({ type: 'integer', example: 1 })
  variantNo!: number;

  @ApiProperty({ type: FileCheckVersionDto, description: 'The latest version' })
  current!: FileCheckVersionDto;

  @ApiProperty({ type: [FileCheckVersionDto], description: 'Earlier versions, newest first' })
  history!: FileCheckVersionDto[];
}

export class FileCheckSpecDto {
  @ApiProperty({ type: String, nullable: true, example: 'uat-postal-box-b' })
  productSlug!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'กล่องไปรษณีย์ ฝาชน 3 ชั้น (ลอน B)' })
  productNameTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Postal box RSC 3-ply (B-flute)' })
  productNameEn!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'C' })
  sizeCode!: string | null;

  @ApiProperty({
    enum: FILE_PRINT_METHODS,
    enumName: 'PrintSideMethod',
    nullable: true,
    example: 'cmyk',
  })
  printMethod!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, example: null })
  printSpotColours!: number | null;
}

export class FileCheckDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000fcc01' })
  id!: string;

  @ApiProperty({ type: FileCheckSpecDto })
  spec!: FileCheckSpecDto;

  @ApiProperty({ type: [FileCheckVariantDto], description: 'Each file is one variant of the same order' })
  variants!: FileCheckVariantDto[];

  @ApiProperty({ example: false, description: 'Every current version is checked' })
  done!: boolean;

  @ApiProperty({ example: true, description: 'A current version is still checking or has something to fix' })
  blocking!: boolean;

  @ApiProperty({ type: 'integer', example: 3, description: 'Changes with every update (the ETag’s source)' })
  revision!: number;

  @TimestampField('2026-10-29T10:00:00+07:00')
  createdAt!: string;

  @ApiProperty({ example: '/v1/store/file-checks/0192f3a0-7c1e-7d2a-9b1f-0000000fcc01' })
  statusUrl!: string;
}

export class FileCheckCartResultDto {
  @ApiProperty({ type: FileCheckDto })
  check!: FileCheckDto;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000ca001' })
  cartItemId!: string;
}

export class FileVersionUrlDto {
  @ApiProperty({ example: 'https://files.getpack.co/…', description: 'Signed, 5 minutes' })
  url!: string;
}

export class ReorderableFileDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000a0001' })
  orderId!: string;

  @ApiProperty({ example: 'GP-2609-00012' })
  orderCode!: string;

  @TimestampField('2026-09-12T10:00:00+07:00')
  orderedAt!: string;

  @ApiProperty({ type: 'integer', example: 500 })
  quantity!: number;

  @ApiProperty({ example: 'piece' })
  unit!: string;

  @ApiProperty({ type: String, nullable: true, example: 'uat-postal-box-b' })
  productSlug!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'กล่องไปรษณีย์ ฝาชน 3 ชั้น (ลอน B)' })
  productNameTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Postal box RSC 3-ply (B-flute)' })
  productNameEn!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'baan_original_v2.pdf',
    description: 'The produced file',
  })
  fileName!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Signed thumbnail URL, 5 minutes',
  })
  thumbnailUrl!: string | null;
}

export class ReorderableFileListDto {
  @ApiProperty({ type: [ReorderableFileDto] })
  data!: ReorderableFileDto[];
}
