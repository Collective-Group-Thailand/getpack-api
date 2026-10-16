import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { FILE_PURPOSE_KEYS, type FilePurpose } from './file-purposes';

export const UPLOAD_STATUSES = ['pending', 'uploaded', 'failed'] as const;
export const SCAN_STATUSES = ['pending', 'clean', 'infected', 'failed', 'skipped'] as const;
export const RETENTION_CLASSES = ['transient', 'standard', 'customer_content', 'financial_record'] as const;

const FILE_ID = '0192f3a0-7c1e-7d2a-9b1f-00000000f11e';

export class PresignFileDto {
  @ApiProperty({
    enum: FILE_PURPOSE_KEYS,
    enumName: 'FilePurpose',
    example: 'artwork',
    description: 'Decides retention, accepted types and size limit',
  })
  @IsIn(FILE_PURPOSE_KEYS)
  purpose!: FilePurpose;

  @ApiProperty({ example: 'box-front.pdf', maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({ example: 'application/pdf', maxLength: 127 })
  @IsString()
  @MaxLength(127)
  mimeType!: string;

  @ApiProperty({ type: 'integer', example: 2_457_600, description: 'Bytes; must match the uploaded object' })
  @IsInt()
  @Min(1)
  @Max(5 * 1024 * 1024 * 1024)
  sizeBytes!: number;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-000000000f01',
    description: 'Factory of the upload when the principal has several',
  })
  @IsOptional()
  @IsUUID()
  factoryId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-000000000c01',
    description: 'Company of the upload when the member has several',
  })
  @IsOptional()
  @IsUUID()
  companyId?: string;
}

export class UploadPartDto {
  @ApiProperty({ type: 'integer', example: 1 })
  partNumber!: number;

  @ApiProperty({ example: 'https://getpack-files.s3.example.com/…&partNumber=1' })
  url!: string;
}

export class MultipartUploadDto {
  @ApiProperty({ example: 'VXBsb2FkSWRFeGFtcGxl' })
  uploadId!: string;

  @ApiProperty({ type: 'integer', example: 8_388_608, description: 'Bytes per part (last part smaller)' })
  partSize!: number;

  @ApiProperty({ type: [UploadPartDto] })
  parts!: UploadPartDto[];
}

export class PresignedUploadDto {
  @ApiProperty({ format: 'uuid', example: FILE_ID })
  fileId!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://getpack-files.s3.example.com/…',
    description: 'Single PUT; null for multipart',
  })
  uploadUrl!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { 'Content-Type': 'application/pdf' },
  })
  headers!: Record<string, string>;

  @ApiProperty({
    type: MultipartUploadDto,
    nullable: true,
    description: 'Large files: PUT each part, then complete with the ETags',
  })
  multipart!: MultipartUploadDto | null;

  @ApiProperty({ format: 'date-time', example: '2026-09-23T14:20:00+07:00' })
  expiresAt!: string;
}

export class StoredPartDto {
  @ApiProperty({ type: 'integer', example: 1 })
  partNumber!: number;

  @ApiProperty({ example: '"etag-1"', description: 'Send it back with `complete`' })
  etag!: string;

  @ApiProperty({ type: 'integer', example: 8_388_608 })
  sizeBytes!: number;
}

/** Resuming a multipart upload (U4.B1): what is stored and fresh URLs for every part. */
export class ResumedUploadDto {
  @ApiProperty({ format: 'uuid', example: FILE_ID })
  fileId!: string;

  @ApiProperty({ type: 'integer', example: 8_388_608, description: 'Bytes per part (last part smaller)' })
  partSize!: number;

  @ApiProperty({ type: [StoredPartDto], description: 'Parts already stored; skip them' })
  uploaded!: StoredPartDto[];

  @ApiProperty({ type: [UploadPartDto], description: 'Fresh signed URLs for every part' })
  parts!: UploadPartDto[];

  @ApiProperty({ format: 'date-time', example: '2026-09-23T14:20:00+07:00' })
  expiresAt!: string;
}

export class CompletedPartDto {
  @ApiProperty({ type: 'integer', example: 1 })
  @IsInt()
  @Min(1)
  @Max(10_000)
  partNumber!: number;

  @ApiProperty({ example: '"etag-1"' })
  @IsString()
  @MaxLength(128)
  etag!: string;
}

export class CompleteUploadDto {
  @ApiPropertyOptional({ type: [CompletedPartDto], description: 'Multipart uploads only' })
  @IsOptional()
  @ArrayMaxSize(10_000)
  @ValidateNested({ each: true })
  @Type(() => CompletedPartDto)
  parts?: CompletedPartDto[];
}

export class FileDto {
  @ApiProperty({ format: 'uuid', example: FILE_ID })
  id!: string;

  @ApiProperty({ example: 'box-front.pdf' })
  originalName!: string;

  @ApiProperty({ example: 'application/pdf' })
  mimeType!: string;

  @ApiProperty({ type: 'integer', example: 2_457_600 })
  sizeBytes!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Hex SHA-256, set after the scan',
  })
  sha256!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, example: null })
  widthPx!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: null })
  heightPx!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 2 })
  pageCount!: number | null;

  @ApiProperty({ enum: UPLOAD_STATUSES, enumName: 'FileUploadStatus', example: 'uploaded' })
  uploadStatus!: (typeof UPLOAD_STATUSES)[number];

  @ApiProperty({
    enum: SCAN_STATUSES,
    enumName: 'FileScanStatus',
    example: 'clean',
    description: 'Downloads need `clean`',
  })
  scanStatus!: (typeof SCAN_STATUSES)[number];

  @ApiProperty({ enum: RETENTION_CLASSES, enumName: 'FileRetentionClass', example: 'customer_content' })
  retentionClass!: (typeof RETENTION_CLASSES)[number];

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'Thumbnail file (images)',
  })
  thumbnailId!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-09-23T14:05:00+07:00' })
  createdAt!: string;
}

export class DownloadUrlDto {
  @ApiProperty({ example: 'https://getpack-files.s3.example.com/…&X-Amz-Expires=300' })
  url!: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-23T14:10:00+07:00' })
  expiresAt!: string;
}

export const FILE_EXAMPLE: FileDto = {
  id: FILE_ID,
  originalName: 'box-front.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2_457_600,
  sha256: null,
  widthPx: null,
  heightPx: null,
  pageCount: 2,
  uploadStatus: 'uploaded',
  scanStatus: 'clean',
  retentionClass: 'customer_content',
  thumbnailId: null,
  createdAt: '2026-09-23T14:05:00+07:00',
};

/** A file attached to something the reader may see (download it with `…/files/{id}/download`). */
export class AttachedFileDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000f001' })
  id!: string;

  @ApiProperty({ example: 'brief.pdf' })
  originalName!: string;

  @ApiProperty({ example: 'application/pdf' })
  mimeType!: string;

  @ApiProperty({ type: 'integer', example: 245760 })
  sizeBytes!: number;
}
