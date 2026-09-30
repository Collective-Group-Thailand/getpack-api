import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { PREFLIGHT_CHECKS } from './preflight/rules';

/** Artwork submissions and preflight (D-070, ADR-0009). */

/** Files and links one submission may carry (the upload page reads them from `store.artwork.getRules`). */
export const MAX_ARTWORK_FILES = 20;
export const MAX_ARTWORK_LINKS = 5;

export const ARTWORK_SOURCES = ['upload', 'designer', 'design_service'] as const;
export const ARTWORK_FILE_ROLES = ['artwork', 'font', 'link', 'reference'] as const;
export const SUBMISSION_STATUSES = ['submitted', 'superseded', 'accepted_for_proof', 'rejected'] as const;
export const PREFLIGHT_STATUSES = [
  'pending',
  'running',
  'passed',
  'passed_with_warnings',
  'blocked',
  'error',
] as const;
export const PREFLIGHT_SEVERITIES = ['block', 'warn', 'info'] as const;
export const PREFLIGHT_OUTCOMES = ['pass', 'fail', 'not_evaluated'] as const;
export const UPLOAD_CHANNELS = ['web', 'line_liff', 'cs'] as const;

export const ARTWORK_IDS = {
  order: '0192f3a0-7c1e-7d2a-9b1f-0000000e1001',
  submission: '0192f3a0-7c1e-7d2a-9b1f-0000000e1002',
  file: '0192f3a0-7c1e-7d2a-9b1f-0000000e1003',
  submissionFile: '0192f3a0-7c1e-7d2a-9b1f-0000000e1004',
  user: '0192f3a0-7c1e-7d2a-9b1f-0000000e1005',
  thumbnail: '0192f3a0-7c1e-7d2a-9b1f-0000000e1006',
};

export class ArtworkFileInputDto {
  @ApiProperty({ format: 'uuid', example: ARTWORK_IDS.file, description: 'An upload with purpose `artwork`' })
  @IsUUID()
  fileId!: string;

  @ApiPropertyOptional({
    enum: ['artwork', 'font', 'reference'],
    enumName: 'ArtworkUploadRole',
    default: 'artwork',
    example: 'artwork',
  })
  @IsOptional()
  @IsIn(['artwork', 'font', 'reference'])
  role?: 'artwork' | 'font' | 'reference';
}

export class SubmitArtworkDto {
  @ApiPropertyOptional({
    type: [ArtworkFileInputDto],
    description: 'Uploaded files (presign → PUT → complete first)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ARTWORK_FILES)
  @ValidateNested({ each: true })
  @Type(() => ArtworkFileInputDto)
  files?: ArtworkFileInputDto[];

  @ApiPropertyOptional({
    type: [String],
    example: ['https://drive.example.invalid/artwork'],
    description: 'Shared-drive links (https) for files too large to upload',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ARTWORK_LINKS)
  @IsString({ each: true })
  @Matches(/^https:\/\/\S{3,500}$/, { each: true })
  links?: string[];

  @ApiPropertyOptional({ example: 'ใช้โลโก้สีทอง', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class RejectSubmissionDto {
  @ApiProperty({
    example: 'ขนาดไฟล์ไม่ตรงกับแบบแปลน กรุณาจัดหน้าใหม่ตามเทมเพลต',
    minLength: 3,
    maxLength: 2000,
    description: 'Shown to the customer: what to change in the next version',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;
}

export class PrepressQueueQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: ['submissions', 'proofs_waiting', 'changes_requested'],
    enumName: 'PrepressQueueKind',
    default: 'submissions',
    description:
      '`submissions` (files to review, oldest first), `proofs_waiting` (proofs sent, waiting for the customer), ' +
      '`changes_requested` (proofs the customer sent back)',
  })
  @IsOptional()
  @IsIn(['submissions', 'proofs_waiting', 'changes_requested'])
  kind: 'submissions' | 'proofs_waiting' | 'changes_requested' = 'submissions';
}

export class ArtworkFileDto {
  @ApiProperty({ format: 'uuid', example: ARTWORK_IDS.submissionFile })
  id!: string;

  @ApiProperty({ enum: ARTWORK_FILE_ROLES, enumName: 'ArtworkFileRole', example: 'artwork' })
  role!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: ARTWORK_IDS.file })
  fileId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  linkUrl!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'box-artwork.pdf' })
  originalName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'application/pdf' })
  mimeType!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 2_400_000, description: 'Bytes' })
  sizeBytes!: number | null;
}

export class PreflightCheckResultDto {
  @ApiProperty({ enum: PREFLIGHT_CHECKS, enumName: 'PreflightCheck', example: 'missing_bleed' })
  check!: string;

  @ApiProperty({ enum: PREFLIGHT_OUTCOMES, enumName: 'PreflightOutcome', example: 'fail' })
  outcome!: string;

  @ApiProperty({ enum: PREFLIGHT_SEVERITIES, enumName: 'PreflightSeverity', example: 'block' })
  severity!: string;

  @ApiProperty({ type: 'integer', nullable: true, example: 1 })
  page!: number | null;

  @ApiProperty({ example: 'ระยะตัดตก (bleed) 1 มม. ไม่ถึง 3 มม. ทุกด้าน' })
  messageTh!: string;

  @ApiProperty({ example: 'Bleed 1 mm is less than 3 mm on some side' })
  messageEn!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { leastBleedMm: 1, requiredMm: 3 },
    description: 'Measurements of the check (mm, pt, ppi as named)',
  })
  measurements!: Record<string, unknown>;
}

export class PreflightFileReportDto {
  @ApiProperty({ format: 'uuid', example: ARTWORK_IDS.submissionFile })
  submissionFileId!: string;

  @ApiProperty({ type: String, nullable: true, example: 'box-artwork.pdf' })
  name!: string | null;

  @ApiProperty({
    enum: ['pdf', 'raster', 'unsupported', 'error'],
    enumName: 'PreflightFileKind',
    example: 'pdf',
  })
  kind!: string;

  @ApiProperty({ type: 'integer', nullable: true, example: 1 })
  pageCount!: number | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: ARTWORK_IDS.thumbnail })
  thumbnailFileId!: string | null;

  @ApiProperty({ type: [PreflightCheckResultDto] })
  checks!: PreflightCheckResultDto[];
}

export class PreflightSizeDto {
  @ApiProperty({ example: 100, description: 'mm' })
  widthMm!: number;

  @ApiProperty({ example: 100, description: 'mm' })
  heightMm!: number;
}

export class PreflightReportDto {
  @ApiProperty({ type: 'integer', example: 1 })
  run!: number;

  @ApiProperty({
    type: PreflightSizeDto,
    nullable: true,
    description: 'Finished size from the dieline template sent to the customer; null when none was sent',
  })
  expectedSize!: PreflightSizeDto | null;

  @ApiProperty({ type: [PreflightFileReportDto] })
  files!: PreflightFileReportDto[];

  @ApiProperty({ type: 'integer', example: 1, description: 'Failing checks that block' })
  blockCount!: number;

  @ApiProperty({ type: 'integer', example: 0, description: 'Failing checks that warn' })
  warnCount!: number;
}

export class ArtworkSubmissionDto {
  @ApiProperty({ format: 'uuid', example: ARTWORK_IDS.submission })
  id!: string;

  @ApiProperty({ format: 'uuid', example: ARTWORK_IDS.order })
  orderId!: string;

  @ApiProperty({ example: 'OR2609270001' })
  orderCode!: string;

  @ApiProperty({ type: 'integer', example: 2 })
  versionNo!: number;

  @ApiProperty({ enum: ARTWORK_SOURCES, enumName: 'ArtworkSource', example: 'upload' })
  source!: string;

  @ApiProperty({ enum: UPLOAD_CHANNELS, enumName: 'UploadChannel', example: 'web' })
  channel!: string;

  @ApiProperty({ enum: SUBMISSION_STATUSES, enumName: 'SubmissionStatus', example: 'submitted' })
  status!: string;

  @ApiProperty({ type: String, nullable: true, example: 'ใช้โลโก้สีทอง' })
  note!: string | null;

  @ApiProperty({ example: '2026-09-27T10:00:00+07:00' })
  submittedAt!: string;

  @ApiProperty({ type: [ArtworkFileDto] })
  files!: ArtworkFileDto[];

  @ApiProperty({ enum: PREFLIGHT_STATUSES, enumName: 'PreflightStatus', example: 'blocked' })
  preflightStatus!: string;

  @ApiProperty({ type: String, nullable: true, example: '2026-09-27T10:01:00+07:00' })
  preflightCompletedAt!: string | null;

  @ApiProperty({ type: PreflightReportDto, nullable: true })
  preflightReport!: PreflightReportDto | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  rejectReason!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  reviewedAt!: string | null;
}

export class PrepressQueueItemDto {
  @ApiProperty({ format: 'uuid', example: ARTWORK_IDS.order })
  orderId!: string;

  @ApiProperty({ example: 'OR2609270001' })
  orderCode!: string;

  @ApiProperty({
    enum: ['submissions', 'proofs_waiting', 'changes_requested'],
    enumName: 'PrepressQueueKind',
    example: 'submissions',
  })
  kind!: string;

  @ApiProperty({
    format: 'uuid',
    example: ARTWORK_IDS.submission,
    description: 'The submission or proof waiting',
  })
  itemId!: string;

  @ApiProperty({ type: 'integer', example: 2 })
  versionNo!: number;

  @ApiProperty({
    enum: PREFLIGHT_STATUSES,
    enumName: 'PreflightStatus',
    nullable: true,
    example: 'passed_with_warnings',
  })
  preflightStatus!: string | null;

  @ApiProperty({ example: '2026-09-27T10:00:00+07:00', description: 'When it entered the queue' })
  since!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'SLA due time (`artwork.prepress_sla_business_hours`); null while no SLA is set',
  })
  dueAt!: string | null;

  @ApiProperty({ example: false })
  overdue!: boolean;
}

export const SUBMISSION_EXAMPLE: ArtworkSubmissionDto = {
  id: ARTWORK_IDS.submission,
  orderId: ARTWORK_IDS.order,
  orderCode: 'OR2609270001',
  versionNo: 2,
  source: 'upload',
  channel: 'web',
  status: 'submitted',
  note: 'ใช้โลโก้สีทอง',
  submittedAt: '2026-09-27T10:00:00+07:00',
  files: [
    {
      id: ARTWORK_IDS.submissionFile,
      role: 'artwork',
      fileId: ARTWORK_IDS.file,
      linkUrl: null,
      originalName: 'box-artwork.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2_400_000,
    },
  ],
  preflightStatus: 'blocked',
  preflightCompletedAt: '2026-09-27T10:01:00+07:00',
  preflightReport: {
    run: 1,
    expectedSize: { widthMm: 100, heightMm: 100 },
    blockCount: 1,
    warnCount: 0,
    files: [
      {
        submissionFileId: ARTWORK_IDS.submissionFile,
        name: 'box-artwork.pdf',
        kind: 'pdf',
        pageCount: 1,
        thumbnailFileId: null,
        checks: [
          {
            check: 'missing_bleed',
            outcome: 'fail',
            severity: 'block',
            page: 1,
            messageTh: 'ระยะตัดตก (bleed) 1 มม. ไม่ถึง 3 มม. ทุกด้าน',
            messageEn: 'Bleed 1 mm is less than 3 mm on some side',
            measurements: { leastBleedMm: 1, requiredMm: 3 },
          },
        ],
      },
    ],
  },
  rejectReason: null,
  reviewedAt: null,
};

export const QUEUE_EXAMPLE: PrepressQueueItemDto = {
  orderId: ARTWORK_IDS.order,
  orderCode: 'OR2609270001',
  kind: 'submissions',
  itemId: ARTWORK_IDS.submission,
  versionNo: 2,
  preflightStatus: 'passed_with_warnings',
  since: '2026-09-27T10:00:00+07:00',
  dueAt: null,
  overdue: false,
};

export const SUBMIT_EXAMPLE = {
  files: [{ fileId: ARTWORK_IDS.file, role: 'artwork' }],
  note: 'ใช้โลโก้สีทอง',
};

// --- store: the rules of the upload page (U-B0.1) ----------------------------------------------------------

export class ArtworkCheckRuleDto {
  @ApiProperty({ example: 'missing_bleed' })
  check!: string;

  @ApiProperty({ enum: PREFLIGHT_SEVERITIES, enumName: 'PreflightSeverity', example: 'block' })
  severity!: string;
}

export class ArtworkChecklistItemDto {
  @ApiProperty({ example: 'spelling_checked' })
  key!: string;

  @ApiProperty({ example: 'ตรวจคำสะกดแล้ว' })
  labelTh!: string;

  @ApiProperty({ example: 'Spelling checked' })
  labelEn!: string;
}

export class ArtworkDielineDto {
  @ApiProperty({ example: 'RTE-01' })
  patternCode!: string;

  @ApiProperty({ type: String, nullable: true, example: 'rte', description: 'Dieline drawing key (designer / drawing service)' })
  dielineKey!: string | null;

  @ApiProperty({ example: 60 })
  widthMm!: number;

  @ApiProperty({ example: 60 })
  lengthMm!: number;

  @ApiProperty({ example: 150 })
  depthMm!: number;
}

/** What an artwork upload for this order must meet (D-070) and what the customer confirms on approval. */
export class ArtworkRulesDto {
  @ApiProperty({ example: 'artwork', description: 'File purpose to presign uploads with' })
  purpose!: string;

  @ApiProperty({ type: [String], example: ['application/pdf', 'image/png'] })
  accept!: string[];

  @ApiProperty({ type: 'integer', example: 2147483648 })
  maxBytes!: number;

  @ApiProperty({ type: 'integer', example: 20 })
  maxFiles!: number;

  @ApiProperty({ type: 'integer', example: 5 })
  maxLinks!: number;

  @ApiProperty({ example: '3', description: 'Bleed each side, mm (D-070 blocks without it)' })
  bleedMm!: string;

  @ApiProperty({ example: '3', description: 'Keep text this far inside the cut line, mm' })
  safeZoneMm!: string;

  @ApiProperty({ type: 'integer', example: 300, description: 'Lowest effective resolution before a warning' })
  minEffectivePpi!: number;

  @ApiProperty({ example: 'cmyk', description: 'RGB artwork is warned about (D-070)' })
  colourMode!: string;

  @ApiProperty({ type: [ArtworkCheckRuleDto], description: 'What each preflight check does: block, warn or inform' })
  checks!: ArtworkCheckRuleDto[];

  @ApiProperty({
    type: [ArtworkChecklistItemDto],
    description: 'Items confirmed when approving the proof (`artwork.approval_checklist`); empty until set',
  })
  approvalChecklist!: ArtworkChecklistItemDto[];

  @ApiProperty({ type: ArtworkDielineDto, nullable: true, description: 'Null for RFQ orders (no calculator configuration)' })
  dieline!: ArtworkDielineDto | null;
}

export const ARTWORK_RULES_EXAMPLE: ArtworkRulesDto = {
  purpose: 'artwork',
  accept: ['application/pdf', 'image/png'],
  maxBytes: 2147483648,
  maxFiles: 20,
  maxLinks: 5,
  bleedMm: '3',
  safeZoneMm: '3',
  minEffectivePpi: 300,
  colourMode: 'cmyk',
  checks: [
    { check: 'missing_bleed', severity: 'block' },
    { check: 'rgb_colour', severity: 'warn' },
  ],
  approvalChecklist: [],
  dieline: { patternCode: 'RTE-01', dielineKey: 'rte', widthMm: 60, lengthMm: 60, depthMm: 150 },
};
