import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { ADMIN_FILE_SOURCES, FILE_SOURCES, PARTNER_FILE_SOURCES } from './file-search.sources';

export const FILE_SEARCH_MODES = ['hybrid', 'keyword', 'meaning'] as const;
export const FILE_TEXT_STATUSES = [
  'pending',
  'indexed',
  'empty',
  'unsupported',
  'too_large',
  'failed',
] as const;

const list = ({ value }: { value: unknown }): unknown =>
  value === undefined
    ? undefined
    : Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(',').filter(Boolean)
        : value;
const bool = ({ value }: { value: unknown }) => value === true || value === 'true';

class FileSearchQueryBase extends PageQuery {
  @ApiProperty({
    description:
      'Words or a phrase as typed: matched inside the text read from each file (spaces and case ignored, close OCR ' +
      'misreadings allowed) and, with search by meaning on, by meaning (D-427).',
    example: 'สัญญาเช่าเครื่องจักร',
    minLength: 2,
    maxLength: 200,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  override q: string = undefined as unknown as string;

  @ApiPropertyOptional({
    enum: FILE_SEARCH_MODES,
    enumName: 'FileSearchMode',
    default: 'hybrid',
    description: '`keyword` only, `meaning` only, or both (`hybrid`, ranked together)',
  })
  @IsOptional()
  @IsIn(FILE_SEARCH_MODES)
  mode?: (typeof FILE_SEARCH_MODES)[number];

  @ApiPropertyOptional({ description: 'Also older versions of a document (default: the current one only)' })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  allVersions?: boolean;

  @ApiPropertyOptional({ description: 'Also archived documents and cancelled records' })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  archived?: boolean;
}

export class PartnerFileSearchQuery extends FileSearchQueryBase {
  @ApiPropertyOptional({
    type: [String],
    enum: PARTNER_FILE_SOURCES,
    enumName: 'PartnerFileSource',
    description: 'Only files used here (comma-separated); every source the person may see by default',
    example: ['erp_doc'],
  })
  @IsOptional()
  @Transform(list)
  @IsArray()
  @ArrayMaxSize(PARTNER_FILE_SOURCES.length)
  @IsIn(PARTNER_FILE_SOURCES, { each: true })
  sources?: string[];
}

export class AdminFileSearchQuery extends FileSearchQueryBase {
  @ApiPropertyOptional({
    type: [String],
    enum: ADMIN_FILE_SOURCES,
    enumName: 'AdminFileSource',
    description: 'Only files used here (comma-separated); every source the person may see by default',
    example: ['vendor_invoice', 'claim_attachment'],
  })
  @IsOptional()
  @Transform(list)
  @IsArray()
  @ArrayMaxSize(ADMIN_FILE_SOURCES.length)
  @IsIn(ADMIN_FILE_SOURCES, { each: true })
  sources?: string[];
}

export class FileSearchFileDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000f101' })
  id!: string;

  @ApiProperty({ example: 'สัญญาเช่าเครื่องพิมพ์ SM74.pdf' })
  name!: string;

  @ApiProperty({ example: 'application/pdf' })
  mimeType!: string;

  @ApiProperty({ example: 143190 })
  sizeBytes!: number;
}

export class FileSearchUsageDto {
  @ApiProperty({ enum: FILE_SOURCES, enumName: 'FileSource', example: 'erp_doc' })
  source!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The record the file belongs to (its page is the source’s page for this id)',
    example: '0192f3a0-7c1e-7d2a-9b1f-00000000d001',
  })
  subjectId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The record above it, where the source has one (a job attachment: the job’s order)',
    example: null,
  })
  parentId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The record’s number or code',
    example: 'IV-2610-0012',
  })
  code!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Its title or counterparty',
    example: 'สัญญาเช่าเครื่องพิมพ์',
  })
  title!: string | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Document or PDF version', example: 2 })
  version!: number | null;

  @ApiProperty({ description: 'False for an older version', example: true })
  current!: boolean;

  @ApiProperty({ format: 'date-time', example: '2026-10-20T10:15:00+07:00' })
  usedAt!: string;
}

export class FileSearchMatchDto {
  @ApiProperty({ type: Number, nullable: true, description: 'Page, sheet or slide number', example: 1 })
  page!: number | null;

  @ApiProperty({ type: String, nullable: true, description: 'Excel sheet name', example: null })
  sheet!: string | null;

  @ApiProperty({ description: 'Read by OCR (expect misreadings)', example: true })
  ocr!: boolean;

  @ApiProperty({ example: '… สัญญาเช่าเครื่องจักร เลขที่ CT-2569-0142 ทำที่ บริษัท กระดาษไทยการพิมพ์ …' })
  snippet!: string;

  @ApiProperty({
    type: 'array',
    items: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 },
    description: 'Highlighted spans of the snippet, `[start, end)` in UTF-16 code units',
    example: [[2, 22]],
  })
  highlights!: [number, number][];

  @ApiProperty({ enum: ['keyword', 'meaning'], enumName: 'FileSearchMatchKind', example: 'keyword' })
  by!: 'keyword' | 'meaning';
}

export class FileSearchTextDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'pdf_text, pdf_ocr, pdf_mixed, image_ocr, docx, xlsx, pptx or plain',
    example: 'pdf_ocr',
  })
  method!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 2 })
  pageCount!: number | null;

  @ApiProperty({ example: 2 })
  ocrPages!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Mean OCR word confidence, 0–100',
    example: 91.4,
  })
  ocrConfidence!: number | null;
}

export class FileSearchHitDto {
  @ApiProperty({ type: FileSearchFileDto })
  file!: FileSearchFileDto;

  @ApiProperty({
    type: [FileSearchUsageDto],
    description: 'Where the file is used (the ones the person may see)',
  })
  usages!: FileSearchUsageDto[];

  @ApiProperty({ type: [FileSearchMatchDto], description: 'Up to three best passages' })
  matches!: FileSearchMatchDto[];

  @ApiProperty({ description: 'The words were found as typed (not only close or by meaning)', example: true })
  exact!: boolean;

  @ApiProperty({ type: FileSearchTextDto })
  text!: FileSearchTextDto;
}

export class FileSearchIndexingDto {
  @ApiProperty({ description: 'Files of this scope still being read', example: 3 })
  pending!: number;

  @ApiProperty({ description: 'Files that could not be read', example: 0 })
  failed!: number;
}

export class FileSearchMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 25 })
  perPage!: number;

  @ApiProperty({ description: 'Files found (at most 200)', example: 1 })
  total!: number;

  @ApiProperty({ description: 'Search by meaning is on in this deployment', example: true })
  meaning!: boolean;

  @ApiProperty({ type: FileSearchIndexingDto })
  indexing!: FileSearchIndexingDto;
}

export class FileSearchResponseDto {
  @ApiProperty({ type: [FileSearchHitDto] })
  data!: FileSearchHitDto[];

  @ApiProperty({ type: FileSearchMetaDto })
  meta!: FileSearchMetaDto;
}

export class FileTextStateDto {
  @ApiProperty({ enum: FILE_TEXT_STATUSES, enumName: 'FileTextStatus', example: 'indexed' })
  status!: string;

  @ApiProperty({ type: String, nullable: true, example: 'pdf_ocr' })
  method!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 2 })
  pageCount!: number | null;

  @ApiProperty({ example: 2 })
  ocrPages!: number;

  @ApiProperty({ description: 'Pages over the OCR limit, left unread', example: 0 })
  skippedPages!: number;

  @ApiProperty({ type: Number, nullable: true, example: 91.4 })
  ocrConfidence!: number | null;

  @ApiProperty({ example: 2140 })
  charCount!: number;

  @ApiProperty({ description: 'Embedded for search by meaning', example: true })
  meaning!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-20T10:16:02+07:00' })
  readAt!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Why it was not read', example: null })
  error!: string | null;
}

export class AdminReindexFilesDto {
  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'These files (public ids); without, every file in `statuses`',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  fileIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    enum: FILE_TEXT_STATUSES,
    enumName: 'FileTextStatus',
    default: ['failed'],
    example: ['failed', 'unsupported'],
  })
  @IsOptional()
  @IsArray()
  @IsIn(FILE_TEXT_STATUSES, { each: true })
  statuses?: string[];
}

export class AdminReindexFilesResultDto {
  @ApiProperty({ description: 'Files queued to be read again', example: 4 })
  queued!: number;
}
