import { CodeNameRefDto } from '@common/dto/code-name-ref.dto';
import { FactoryRefDto } from '@common/dto/factory-ref.dto';
import { DecimalField, IntField, TextField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID, Matches, Max, MaxLength } from 'class-validator';

/** Factory process capabilities (U3.B3, D-244). */

export const CAPABILITY_STATUSES = ['proposed', 'verified', 'rejected', 'withdrawn', 'superseded'] as const;
export const PROCESS_SCOPES = ['source_product_type', 'category', 'family', 'option'] as const;
const IDS = {
  capability: '0192f3a0-7c1e-7d2a-9b1f-0000000ae101',
  factory: '0192f3a0-7c1e-7d2a-9b1f-0000000ae102',
  user: '0192f3a0-7c1e-7d2a-9b1f-0000000ae103',
  visit: '0192f3a0-7c1e-7d2a-9b1f-0000000ae104',
  rule: '0192f3a0-7c1e-7d2a-9b1f-0000000ae105',
};
const TS = '2026-10-03T10:00:00+07:00';
const SNAKE = /^[a-z][a-z0-9_]*$/;

/** A process type (D-244): the shared code + names reference. */
export const ProcessTypeDto = CodeNameRefDto;
export type ProcessTypeDto = CodeNameRefDto;

export class ProcessCapabilityDto {
  @ApiProperty({ format: 'uuid', example: IDS.capability })
  id!: string;

  @ApiProperty({ type: FactoryRefDto })
  factory!: FactoryRefDto;

  @ApiProperty({ type: ProcessTypeDto })
  process!: ProcessTypeDto;

  @ApiProperty({ example: 'paperboard', description: 'The style material class it covers' })
  materialClass!: string;

  @ApiProperty({ type: Number, nullable: true, example: 100, description: 'Unit: mm.' })
  minBlankWMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 100, description: 'Unit: mm.' })
  minBlankLMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 720, description: 'Unit: mm.' })
  maxBlankWMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 1020, description: 'Unit: mm.' })
  maxBlankLMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 0.8, description: 'Unit: mm.' })
  maxCaliperMm!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 1000 })
  minRun!: number | null;

  @ApiProperty({ type: 'integer', example: 7 })
  leadTimeMinDays!: number;

  @ApiProperty({ type: 'integer', example: 12 })
  leadTimeMaxDays!: number;

  @ApiProperty({ enum: CAPABILITY_STATUSES, enumName: 'ProcessCapabilityStatus', example: 'verified' })
  status!: (typeof CAPABILITY_STATUSES)[number];

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ format: 'date-time', example: TS })
  proposedAt!: string;

  @ApiProperty({ format: 'uuid', example: IDS.user })
  proposedById!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: TS })
  verifiedAt!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: IDS.user })
  verifiedById!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: IDS.visit,
    description: 'The passing site visit (D-041)',
  })
  siteVisitId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  decisionNote!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: TS })
  decidedAt!: string | null;
}

export class ProposeProcessCapabilityDto {
  @ApiProperty({ example: 'folder_gluer_crash_lock', description: 'A process type code' })
  @Matches(SNAKE)
  @MaxLength(64)
  processCode!: string;

  @ApiProperty({ example: 'paperboard', description: 'A style material class (as in the style library)' })
  @Matches(SNAKE)
  @MaxLength(64)
  materialClass!: string;

  @DecimalField({
    example: 100,
    optional: true,
    positive: true,
    unit: 'mm',
    description: 'Minimum blank width',
  })
  @Max(10_000)
  minBlankWMm?: number;

  @DecimalField({
    example: 100,
    optional: true,
    positive: true,
    unit: 'mm',
    description: 'Minimum blank length',
  })
  @Max(10_000)
  minBlankLMm?: number;

  @DecimalField({
    example: 720,
    optional: true,
    positive: true,
    unit: 'mm',
    description: 'Maximum blank width',
  })
  @Max(10_000)
  maxBlankWMm?: number;

  @DecimalField({
    example: 1020,
    optional: true,
    positive: true,
    unit: 'mm',
    description: 'Maximum blank length',
  })
  @Max(10_000)
  maxBlankLMm?: number;

  @DecimalField({
    example: 0.8,
    optional: true,
    positive: true,
    scale: 3,
    unit: 'mm',
    description: 'Maximum caliper',
  })
  @Max(50)
  maxCaliperMm?: number;

  @IntField({ example: 1000, optional: true, min: 1, max: 10_000_000, description: 'Minimum run (pieces)' })
  minRun?: number;

  @IntField({ example: 7, min: 0, max: 365, description: 'Lead time band, from (days)' })
  leadTimeMinDays!: number;

  @IntField({ example: 12, min: 0, max: 365, description: 'Lead time band, to (days)' })
  leadTimeMaxDays!: number;

  @TextField({ example: 'เครื่อง Bobst 102 ใหม่', optional: true, max: 1000 })
  note?: string;
}

export class VerifyProcessCapabilityDto {
  @ApiProperty({
    format: 'uuid',
    example: IDS.visit,
    description: 'A passing site visit of the same factory (D-041)',
  })
  @IsUUID()
  siteVisitId!: string;
}

export class DecisionNoteDto {
  @TextField({ example: 'ไม่พบเครื่องจักรตามที่แจ้งระหว่างการตรวจโรงงาน', max: 1000 })
  note!: string;
}

export class ProcessCapabilityQuery {
  @ApiPropertyOptional({
    enum: CAPABILITY_STATUSES,
    enumName: 'ProcessCapabilityStatus',
    example: 'verified',
  })
  @IsOptional()
  @IsIn(CAPABILITY_STATUSES)
  status?: (typeof CAPABILITY_STATUSES)[number];
}

export class StyleProcessRuleDto {
  @ApiProperty({ format: 'uuid', example: IDS.rule })
  id!: string;

  @ApiProperty({ enum: PROCESS_SCOPES, enumName: 'StyleProcessScope', example: 'option' })
  scope!: (typeof PROCESS_SCOPES)[number];

  @ApiProperty({
    example: 'tuck_bottom:crash_lock',
    description: 'Product type, category, family, or `axis:value`',
  })
  scopeValue!: string;

  @ApiProperty({ type: ProcessTypeDto })
  process!: ProcessTypeDto;

  @ApiProperty({ format: 'date-time', example: TS })
  createdAt!: string;
}

export class CreateStyleProcessRuleDto {
  @ApiProperty({ enum: PROCESS_SCOPES, enumName: 'StyleProcessScope', example: 'option' })
  @IsIn(PROCESS_SCOPES)
  scope!: (typeof PROCESS_SCOPES)[number];

  @ApiProperty({ example: 'tuck_bottom:crash_lock' })
  @Matches(/^[a-z][a-z0-9_]*(:[a-z0-9][a-z0-9_]*)?$/)
  @MaxLength(128)
  scopeValue!: string;

  @ApiProperty({ example: 'folder_gluer_crash_lock' })
  @Matches(SNAKE)
  @MaxLength(64)
  processCode!: string;
}

export const PROCESS_TYPE_EXAMPLE: ProcessTypeDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-0000000ae106',
  code: 'folder_gluer_crash_lock',
  nameTh: 'เครื่องพับทากาว (ก้นล็อก)',
  nameEn: 'Folder-gluer (crash-lock)',
};

export const CAPABILITY_EXAMPLE: ProcessCapabilityDto = {
  id: IDS.capability,
  factory: { id: IDS.factory, code: 'F0001', name: 'โรงงานตัวอย่าง จำกัด' },
  process: PROCESS_TYPE_EXAMPLE,
  materialClass: 'paperboard',
  minBlankWMm: 100,
  minBlankLMm: 100,
  maxBlankWMm: 720,
  maxBlankLMm: 1020,
  maxCaliperMm: 0.8,
  minRun: 1000,
  leadTimeMinDays: 7,
  leadTimeMaxDays: 12,
  status: 'verified',
  note: null,
  proposedAt: TS,
  proposedById: IDS.user,
  verifiedAt: TS,
  verifiedById: IDS.user,
  siteVisitId: IDS.visit,
  decisionNote: null,
  decidedAt: TS,
};

export const PROPOSE_EXAMPLE = {
  processCode: 'folder_gluer_crash_lock',
  materialClass: 'paperboard',
  maxBlankWMm: 720,
  maxBlankLMm: 1020,
  maxCaliperMm: 0.8,
  minRun: 1000,
  leadTimeMinDays: 7,
  leadTimeMaxDays: 12,
};

export const RULE_EXAMPLE: StyleProcessRuleDto = {
  id: IDS.rule,
  scope: 'option',
  scopeValue: 'tuck_bottom:crash_lock',
  process: PROCESS_TYPE_EXAMPLE,
  createdAt: TS,
};
