import {
  DecimalField,
  EnumField,
  IdField,
  IntField,
  RefField,
  TextField,
} from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsObject, IsOptional, IsUUID, Matches } from 'class-validator';

const PRODUCT_TYPE = '0192f3a0-7c1e-7d2a-9b1f-00000000c002';
const FILE = '0192f3a0-7c1e-7d2a-9b1f-00000000f501';
const USER = '0192f3a0-7c1e-7d2a-9b1f-00000000f502';

// --- agreements -------------------------------------------------------------------------------------

export class AgreementStatusDto {
  @ApiProperty({ example: 'partner_agreement' })
  key!: string;

  @ApiProperty({ example: 'Partner agreement' })
  name!: string;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 1,
    description: 'Version in force; null = not published yet',
  })
  versionNo!: number | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-09-26T10:00:00+07:00' })
  effectiveFrom!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'ข้อตกลงการเป็นพันธมิตร …' })
  textTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  textEn!: string | null;

  @ApiProperty({ example: false })
  accepted!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  acceptedAt!: string | null;

  @ApiProperty({
    enum: ['e_acceptance', 'signed_upload'],
    enumName: 'AcceptanceMethod',
    nullable: true,
    example: null,
  })
  method!: 'e_acceptance' | 'signed_upload' | null;
}

export const AGREEMENT_STATUS_EXAMPLE: AgreementStatusDto = {
  key: 'partner_agreement',
  name: 'Partner agreement',
  versionNo: 1,
  effectiveFrom: '2026-09-26T10:00:00+07:00',
  textTh: 'ข้อตกลงการเป็นพันธมิตร …',
  textEn: null,
  accepted: false,
  acceptedAt: null,
  method: null,
};

export class AgreementVersionDto {
  @ApiProperty({ type: 'integer', example: 1 })
  versionNo!: number;

  @ApiProperty({ format: 'date-time', example: '2026-09-26T10:00:00+07:00' })
  effectiveFrom!: string;

  @ApiProperty({ example: 'ข้อตกลงการเป็นพันธมิตร …' })
  textTh!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  textEn!: string | null;

  @ApiProperty({
    example: '4f1c…',
    description: 'SHA-256 (hex) of the text, the evidence acceptances refer to',
  })
  textSha256!: string;

  @ApiProperty({ example: 'First publication by legal counsel' })
  reason!: string;
}

export class AgreementTemplateDto {
  @ApiProperty({ example: 'partner_agreement' })
  key!: string;

  @ApiProperty({ example: 'Partner agreement' })
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: 'D-011 partner agreement' })
  description!: string | null;

  @ApiProperty({ type: [AgreementVersionDto] })
  versions!: AgreementVersionDto[];
}

export class PublishAgreementVersionDto {
  @TextField({ example: 'ข้อตกลงการเป็นพันธมิตร …', max: 200_000 })
  textTh!: string;

  @TextField({ example: null, nullable: true, max: 200_000 })
  textEn?: string | null;

  @RefField({ example: null, nullable: true, description: 'Signed-off PDF of the text' })
  pdfFileId?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', example: '2026-10-01T00:00:00+07:00' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  effectiveFrom?: Date;

  @TextField({ example: 'First publication by legal counsel', max: 1000 })
  reason!: string;
}

export class RecordSignedAgreementDto {
  @RefField({ example: FILE, description: 'Scan of the signed agreement' })
  signedFileId!: string;
}

// --- site visits (D-041) ------------------------------------------------------------------------------

export class SiteVisitDto {
  @IdField('0192f3a0-7c1e-7d2a-9b1f-00000000f503')
  id!: string;

  @ApiProperty({ format: 'date', example: '2026-09-25' })
  visitedOn!: string;

  @ApiProperty({ example: 'v1' })
  checklistVersion!: string;

  @ApiProperty({ type: 'object', additionalProperties: true, example: { machinesOk: true, qcArea: 'ok' } })
  checklist!: Record<string, unknown>;

  @ApiProperty({ enum: ['pass', 'conditional', 'fail'], enumName: 'SiteVisitResult', example: 'pass' })
  result!: 'pass' | 'conditional' | 'fail';

  @ApiProperty({ type: String, nullable: true, example: 'สายการผลิตพร้อม' })
  notes!: string | null;

  @ApiProperty({ type: [String], format: 'uuid', example: [USER] })
  inspectorIds!: string[];

  @ApiProperty({ type: [String], format: 'uuid', example: [FILE] })
  photoFileIds!: string[];

  @ApiProperty({ format: 'date-time', example: '2026-09-26T10:00:00+07:00' })
  createdAt!: string;
}

export class RecordSiteVisitDto {
  @ApiProperty({ type: String, format: 'date', example: '2026-09-25' })
  @Type(() => Date)
  @IsDate()
  visitedOn!: Date;

  @TextField({ example: 'v1', max: 32 })
  checklistVersion!: string;

  @ApiProperty({ type: 'object', additionalProperties: true, example: { machinesOk: true, qcArea: 'ok' } })
  @IsObject()
  checklist!: Record<string, unknown>;

  @EnumField(['pass', 'conditional', 'fail'] as const, 'SiteVisitResult', { example: 'pass' })
  result!: 'pass' | 'conditional' | 'fail';

  @TextField({ example: 'สายการผลิตพร้อม', nullable: true, max: 5000 })
  notes?: string | null;

  @ApiProperty({ type: [String], format: 'uuid', example: [USER], description: 'Packio staff who visited' })
  @IsUUID('all', { each: true })
  inspectorIds!: string[];

  @ApiPropertyOptional({ type: [String], format: 'uuid', example: [FILE], description: 'Uploaded photos' })
  @IsOptional()
  @IsUUID('all', { each: true })
  photoFileIds?: string[];
}

// --- capacity (D-101) ---------------------------------------------------------------------------------

export class CapacityWeekDto {
  @ApiProperty({ format: 'date', example: '2026-09-28', description: 'Monday of the week (Bangkok)' })
  weekStart!: string;

  @ApiProperty({ example: '12000.000' })
  capacity!: string;

  @ApiProperty({ example: '4500.000', description: 'Booked by accepted jobs' })
  booked!: string;

  @ApiProperty({ example: '7500.000' })
  free!: string;

  @ApiProperty({ enum: ['version', 'override'], enumName: 'CapacitySource', example: 'version' })
  source!: 'version' | 'override';
}

export class CapacityQuery {
  @RefField({ example: PRODUCT_TYPE })
  productTypeId!: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    example: '2026-09-28',
    description: 'Defaults to today',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IntField({ example: 8, optional: true, min: 1, max: 52, description: 'Number of weeks (default 8)' })
  weeks?: number;
}

export class SetCapacityOverrideDto {
  @RefField({ example: PRODUCT_TYPE })
  productTypeId!: string;

  @ApiProperty({ format: 'date', example: '2026-10-12', description: 'A Monday' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  weekStart!: string;

  @DecimalField({ example: 6000, scale: 3, unit: 'capacity unit' })
  capacity!: number;

  @TextField({ example: 'Machine maintenance', max: 1000 })
  reason!: string;
}

export class VersionWriteResultDto {
  @ApiProperty({ type: 'integer', example: 2 })
  versionNo!: number;

  @ApiProperty({
    enum: ['draft', 'proposed', 'pending_acceptance', 'approved', 'rejected', 'withdrawn'],
    enumName: 'ConfigVersionStatus',
    example: 'proposed',
  })
  status!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: '0192f3a0-7c1e-7d2a-9b1f-00000000f301',
  })
  approvalRequestId!: string | null;
}
