import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, Matches } from 'class-validator';

import { IMPORT_KIND_KEYS } from './import-kinds';

export const IMPORT_FILE_ID = '0192f3a0-7c1e-7d2a-9b1f-00000000f001';
export const PREVIEW_SHA = 'a3f1c2d4e5b60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

export class ImportFileDto {
  @ApiProperty({
    format: 'uuid',
    example: IMPORT_FILE_ID,
    description: 'Uploaded `.xlsx` file (purpose `import`), scanned clean',
  })
  @IsUUID()
  fileId!: string;
}

export class ConfirmImportDto extends ImportFileDto {
  @ApiProperty({ example: PREVIEW_SHA, description: '`previewSha256` of the preview being confirmed' })
  @Matches(/^[0-9a-f]{64}$/)
  previewSha256!: string;
}

export class ImportCountsDto {
  @ApiProperty({ type: 'integer', example: 120 })
  create!: number;

  @ApiProperty({ type: 'integer', example: 8 })
  update!: number;

  @ApiProperty({ type: 'integer', example: 7_280 })
  unchanged!: number;

  @ApiProperty({ type: 'integer', example: 0, description: 'Rows with at least one error' })
  invalid!: number;
}

export class ImportSheetDto {
  @ApiProperty({ example: 'subdistricts' })
  name!: string;

  @ApiProperty({ type: 'integer', example: 120 })
  create!: number;

  @ApiProperty({ type: 'integer', example: 8 })
  update!: number;

  @ApiProperty({ type: 'integer', example: 7_280 })
  unchanged!: number;

  @ApiProperty({ type: 'integer', example: 0 })
  invalid!: number;
}

export class ImportRowErrorDto {
  @ApiProperty({ example: 'subdistricts' })
  sheet!: string;

  @ApiProperty({ type: 'integer', example: 17, description: 'Excel row number (1 = header)' })
  row!: number;

  @ApiProperty({ type: String, nullable: true, example: 'postcode' })
  column!: string | null;

  @ApiProperty({
    example: 'pattern',
    description:
      '`required`, `max`, `pattern`, `enum`, `int`, `decimal`, `bool`, `json`, `ref`, `duplicate`, `header`, `sheet`',
  })
  code!: string;

  @ApiProperty({ example: 'postcode has an invalid format' })
  message!: string;
}

export class ImportPreviewDto {
  @ApiProperty({ enum: IMPORT_KIND_KEYS, enumName: 'CatalogImportKind', example: 'geography' })
  kind!: string;

  @ApiProperty({ format: 'uuid', example: IMPORT_FILE_ID })
  fileId!: string;

  @ApiProperty({ example: PREVIEW_SHA, description: 'Send back to confirm exactly this plan' })
  previewSha256!: string;

  @ApiProperty({ example: true, description: 'No invalid rows and at least one create or update' })
  canConfirm!: boolean;

  @ApiProperty({ type: ImportCountsDto })
  totals!: ImportCountsDto;

  @ApiProperty({ type: [ImportSheetDto] })
  sheets!: ImportSheetDto[];

  @ApiProperty({ type: [ImportRowErrorDto], description: 'First 200 row errors' })
  errors!: ImportRowErrorDto[];

  @ApiProperty({ example: false })
  errorsTruncated!: boolean;
}

export class CatalogExportDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000f002' })
  fileId!: string;

  @ApiProperty({ example: 'https://packio-files.s3.example.com/…&X-Amz-Expires=300' })
  url!: string;

  @ApiProperty({ type: 'integer', example: 7_408 })
  rows!: number;

  @ApiProperty({ format: 'date-time', example: '2026-09-25T10:05:00+07:00' })
  expiresAt!: string;
}

export class ImportColumnDto {
  @ApiProperty({ example: 'postcode' })
  header!: string;

  @ApiProperty({ example: 'text', description: '`text`, `int`, `decimal`, `bool`, `enum`, `json`, `ref`' })
  type!: string;

  @ApiProperty({ example: true })
  required!: boolean;

  @ApiProperty({
    type: [String],
    nullable: true,
    example: null,
    description: 'Allowed values of an `enum` column',
  })
  values!: string[] | null;
}

export class ImportKindSheetDto {
  @ApiProperty({ example: 'subdistricts' })
  name!: string;

  @ApiProperty({ type: [String], example: ['code'], description: 'Headers forming the natural key' })
  key!: string[];

  @ApiProperty({ type: [ImportColumnDto] })
  columns!: ImportColumnDto[];
}

export class ImportKindDto {
  @ApiProperty({ enum: IMPORT_KIND_KEYS, enumName: 'CatalogImportKind', example: 'geography' })
  kind!: string;

  @ApiProperty({ example: 'Provinces, districts and subdistricts with postcodes' })
  label!: string;

  @ApiProperty({ type: [ImportKindSheetDto] })
  sheets!: ImportKindSheetDto[];
}
