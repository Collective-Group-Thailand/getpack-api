import { CursorQuery, SortOrder } from '@common/pagination/pagination.dto';
import { IdField, TimestampField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import {
  ACTIVITY_KINDS,
  AGENT_ACTIVITY_KINDS,
  AGENT_STAGE_TARGETS,
  IMPORT_ERROR_CODES,
  LEAD_SOURCES,
  LEAD_STAGES,
  LOST_REASONS,
} from './agent-lead-rules';
import { AGENT_IDS, LEAD_EXAMPLE } from './agents.dto';

/** D-468: the agent's lead pipeline (agent zone). Money: decimal strings, THB; times Asia/Bangkok. */

const POSITIVE_MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const TAX_ID = /^\d{13}$/;
const E164 = /^\+[1-9]\d{7,14}$/;

export const P3_IDS = {
  activity: '0192f3a0-7c1e-7d2a-9b1f-0000000a6021',
  import: '0192f3a0-7c1e-7d2a-9b1f-0000000a6022',
  agentQuote: '0192f3a0-7c1e-7d2a-9b1f-0000000a6023',
  quote: '0192f3a0-7c1e-7d2a-9b1f-0000000a6024',
  discountRequest: '0192f3a0-7c1e-7d2a-9b1f-0000000a6025',
  discountOption: '0192f3a0-7c1e-7d2a-9b1f-0000000a6026',
  dealRegistration: '0192f3a0-7c1e-7d2a-9b1f-0000000a6027',
  playbookCard: '0192f3a0-7c1e-7d2a-9b1f-0000000a6028',
  file: '0192f3a0-7c1e-7d2a-9b1f-0000000a6029',
  quoteOption: '0192f3a0-7c1e-7d2a-9b1f-0000000a6030',
};

// --- duplicate check ------------------------------------------------------------------------------------------------

export class CheckAgentLeadDto {
  @ApiPropertyOptional({ type: String, nullable: true, example: '+66890001234', pattern: E164.source })
  @IsOptional()
  @Matches(E164)
  phone?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null })
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, pattern: TAX_ID.source })
  @IsOptional()
  @Matches(TAX_ID)
  taxId?: string | null;
}

export const AVAILABILITY_REASONS = ['own_lead', 'unavailable'] as const;

export class AgentLeadAvailabilityDto {
  @ApiProperty({ example: false })
  available!: boolean;

  @ApiProperty({
    enum: AVAILABILITY_REASONS,
    enumName: 'AgentLeadAvailabilityReason',
    nullable: true,
    example: 'unavailable',
    description:
      '`own_lead`: already your protected lead (see `leadId`); `unavailable`: cannot be registered — one neutral ' +
      'reason, never who holds it (D-440)',
  })
  reason!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  leadId!: string | null;
}

// --- list -------------------------------------------------------------------------------------------------------------

export const LEAD_VIEWS = ['open', 'follow_up_today', 'protection_ending', 'closed'] as const;
export const LEAD_DUE = ['today', 'overdue'] as const;
export const LEAD_SORTS = [
  'createdAt',
  'updatedAt',
  'nextFollowUpAt',
  'protectedUntil',
  'expectedValue',
  // D-471: the lead score (no score last).
  'score',
] as const;

const csvList = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.split(',').map((v) => v.trim()) : value;

export class AgentLeadListQuery extends CursorQuery {
  @ApiPropertyOptional({
    enum: LEAD_VIEWS,
    enumName: 'AgentLeadView',
    description:
      '`open` registered or converted and not won / lost · `follow_up_today` open with a follow-up due by the end of ' +
      'today (overdue included) · `protection_ending` registered, protection ends within 7 days · `closed` won, lost, ' +
      'expired, withdrawn or released',
  })
  @IsOptional()
  @IsIn(LEAD_VIEWS)
  view?: (typeof LEAD_VIEWS)[number];

  @ApiPropertyOptional({
    type: [String],
    enum: LEAD_STAGES,
    enumName: 'AgentLeadStage',
    isArray: true,
    description: 'One or more stages, comma-separated',
  })
  @IsOptional()
  @Transform(csvList)
  @IsArray()
  @IsIn(LEAD_STAGES, { each: true })
  stage?: (typeof LEAD_STAGES)[number][];

  @ApiPropertyOptional({ enum: LEAD_SOURCES, enumName: 'AgentLeadSource' })
  @IsOptional()
  @IsIn(LEAD_SOURCES)
  source?: (typeof LEAD_SOURCES)[number];

  @ApiPropertyOptional({
    enum: LEAD_DUE,
    enumName: 'AgentLeadDue',
    description:
      '`today`: follow-up due by the end of today (Bangkok, overdue included) · `overdue`: before now',
  })
  @IsOptional()
  @IsIn(LEAD_DUE)
  due?: (typeof LEAD_DUE)[number];

  @ApiPropertyOptional({
    description: 'Name, organisation, phone, e-mail, tax id or LINE id',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    maximum: 100,
    description: 'D-471: leads scored at least this (0–100); unscored leads are left out',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minScore?: number;

  @ApiPropertyOptional({ enum: LEAD_SORTS, enumName: 'AgentLeadSort', default: 'createdAt' })
  @IsOptional()
  @IsIn(LEAD_SORTS)
  sort: (typeof LEAD_SORTS)[number] = 'createdAt';

  @ApiPropertyOptional({ enum: SortOrder, enumName: 'SortOrder', default: SortOrder.Desc })
  @IsOptional()
  @IsEnum(SortOrder)
  order: SortOrder = SortOrder.Desc;
}

// --- update / stage / activity -----------------------------------------------------------------------------------

export class UpdateAgentLeadDto {
  @ApiPropertyOptional({ example: 'คุณมานี ใจดี' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  contactName?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'ร้านกาแฟบ้านสวน' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  organisationName?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '+66890001234',
    pattern: E164.source,
    description:
      'Contact keys change only while the lead is registered, through the same check as a new lead',
  })
  @IsOptional()
  @Matches(E164)
  phone?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null })
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, pattern: TAX_ID.source })
  @IsOptional()
  @Matches(TAX_ID)
  taxId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '60000.00', pattern: POSITIVE_MONEY.source })
  @IsOptional()
  @Matches(POSITIVE_MONEY)
  expectedValue?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-21T10:00:00+07:00',
    description: 'A new time re-arms the reminder (sent outside the quiet hours 21:00–08:00)',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  nextFollowUpAt?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'ร้านกาแฟ / เบเกอรี่' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  industry?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'manee.cafe' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  lineId?: string | null;

  @ApiPropertyOptional({ type: [String], example: ['เบเกอรี่', 'รายเดือน'], maxItems: 10 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  tags?: string[];
}

export class ChangeAgentLeadStageDto {
  @ApiProperty({
    enum: AGENT_STAGE_TARGETS,
    enumName: 'AgentLeadStageTarget',
    example: 'lost',
    description: '`won` is never set by an agent (the first payment sets it)',
  })
  @IsIn(AGENT_STAGE_TARGETS)
  stage!: (typeof AGENT_STAGE_TARGETS)[number];

  @ApiPropertyOptional({
    enum: LOST_REASONS,
    enumName: 'AgentLeadLostReason',
    example: 'price',
    description: 'Required with `lost`',
  })
  @IsOptional()
  @IsIn(LOST_REASONS)
  lostReason?: (typeof LOST_REASONS)[number];

  @ApiPropertyOptional({ type: String, example: 'ได้ราคาจากที่อื่นถูกกว่า 8%' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class AddAgentLeadActivityDto {
  @ApiProperty({ enum: AGENT_ACTIVITY_KINDS, enumName: 'AgentLeadActivityEntryKind', example: 'call' })
  @IsIn(AGENT_ACTIVITY_KINDS)
  kind!: (typeof AGENT_ACTIVITY_KINDS)[number];

  @ApiProperty({ example: 'โทรคุยเรื่องขนาดกล่อง ขอดูตัวอย่างก่อนสั่ง' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    example: '2026-10-18T09:30:00+07:00',
    description: 'When it happened (default now; not in the future)',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  occurredAt?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-21T10:00:00+07:00',
    description: 'Also set the next follow-up',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  nextFollowUpAt?: string | null;
}

export const ACTIVITY_AUTHORS = ['agent', 'system', 'getpack'] as const;
export const SYSTEM_EVENTS = [
  'converted',
  'won',
  'quote_opened',
  'quote_accepted',
  'quote_withdrawn',
  'discount_requested',
  'discount_options',
  'discount_option_accepted',
  'deal_registered',
  'deal_ended',
  'lost',
] as const;

export class AgentLeadActivityDto {
  @IdField(P3_IDS.activity)
  id!: string;

  @ApiProperty({ enum: ACTIVITY_KINDS, enumName: 'AgentLeadActivityKind', example: 'call' })
  kind!: string;

  @ApiProperty({ type: String, nullable: true, example: 'โทรคุยเรื่องขนาดกล่อง ขอดูตัวอย่างก่อนสั่ง' })
  body!: string | null;

  @ApiProperty({ enum: ACTIVITY_AUTHORS, enumName: 'AgentLeadActivityAuthor', example: 'agent' })
  author!: string;

  @ApiProperty({
    enum: SYSTEM_EVENTS,
    enumName: 'AgentLeadSystemEvent',
    nullable: true,
    example: null,
    description: 'What a `system` entry records',
  })
  event!: string | null;

  @ApiProperty({ enum: LEAD_STAGES, enumName: 'AgentLeadStage', nullable: true, example: null })
  fromStage!: string | null;

  @ApiProperty({ enum: LEAD_STAGES, enumName: 'AgentLeadStage', nullable: true, example: null })
  toStage!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null, description: 'Agent quote' })
  agentQuoteId!: string | null;

  @TimestampField('2026-10-18T09:30:00+07:00')
  occurredAt!: string;
}

export const ACTIVITY_EXAMPLE: AgentLeadActivityDto = {
  id: P3_IDS.activity,
  kind: 'call',
  body: 'โทรคุยเรื่องขนาดกล่อง ขอดูตัวอย่างก่อนสั่ง',
  author: 'agent',
  event: null,
  fromStage: null,
  toStage: null,
  agentQuoteId: null,
  occurredAt: '2026-10-18T09:30:00+07:00',
};

// --- import / export -------------------------------------------------------------------------------------------

export class PreviewAgentLeadImportDto {
  @ApiProperty({
    description:
      'The CSV text (UTF-8, header row; columns contact_name, organisation_name, phone, email, tax_id, line_id, ' +
      'industry, tags, expected_value, next_follow_up_at, note); at most 500 rows',
    example: 'contact_name,phone,organisation_name\nคุณมานี ใจดี,0890001234,ร้านกาแฟบ้านสวน\n',
    maxLength: 400_000,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(400_000)
  csv!: string;

  @ApiProperty({
    example: true,
    description: 'Every person in the file agreed to be contacted by getpack (PDPA); required',
  })
  @IsBoolean()
  consentConfirmed!: boolean;
}

export class AgentLeadImportErrorDto {
  @ApiProperty({ example: 'phone' })
  field!: string;

  @ApiProperty({ enum: IMPORT_ERROR_CODES, enumName: 'AgentLeadImportErrorCode', example: 'unavailable' })
  code!: string;
}

export class AgentLeadImportRowDto {
  @ApiProperty({ type: 'integer', example: 2, description: 'Line number in the file (the header is line 1)' })
  rowNo!: number;

  @ApiProperty({ type: String, nullable: true, example: 'คุณมานี ใจดี' })
  contactName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'ร้านกาแฟบ้านสวน' })
  organisationName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '+66890001234' })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  taxId!: string | null;

  @ApiProperty({ type: [AgentLeadImportErrorDto], example: [] })
  errors!: AgentLeadImportErrorDto[];

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'Set after commit',
  })
  leadId!: string | null;
}

export const IMPORT_STATUSES = ['previewed', 'committed', 'expired'] as const;

export class AgentLeadImportDto {
  @IdField(P3_IDS.import)
  id!: string;

  @ApiProperty({ enum: IMPORT_STATUSES, enumName: 'AgentLeadImportStatus', example: 'previewed' })
  status!: string;

  @ApiProperty({ type: 'integer', example: 2 })
  rowCount!: number;

  @ApiProperty({ type: 'integer', example: 1, description: 'Rows without errors (created at commit)' })
  validCount!: number;

  @ApiProperty({ type: 'integer', nullable: true, example: null, description: 'Leads created by the commit' })
  createdCount!: number | null;

  @ApiProperty({ type: [AgentLeadImportRowDto] })
  rows!: AgentLeadImportRowDto[];

  @TimestampField('2026-10-19T10:00:00+07:00')
  expiresAt!: string;
}

export const IMPORT_EXAMPLE: AgentLeadImportDto = {
  id: P3_IDS.import,
  status: 'previewed',
  rowCount: 2,
  validCount: 1,
  createdCount: null,
  rows: [
    {
      rowNo: 2,
      contactName: 'คุณมานี ใจดี',
      organisationName: 'ร้านกาแฟบ้านสวน',
      phone: '+66890001234',
      email: null,
      taxId: null,
      errors: [],
      leadId: null,
    },
    {
      rowNo: 3,
      contactName: 'คุณสมศรี ตัวอย่าง',
      organisationName: null,
      phone: '+66890005678',
      email: null,
      taxId: null,
      errors: [{ field: 'phone', code: 'unavailable' }],
      leadId: null,
    },
  ],
  expiresAt: '2026-10-19T10:00:00+07:00',
};

export class AgentLeadImportParam {
  @IsUUID()
  importId!: string;
}

export const LEAD_DETAIL_EXAMPLE = { ...LEAD_EXAMPLE, id: AGENT_IDS.lead };

// --- card scan (D-468 item 6) ------------------------------------------------------------------------------------

export const OCR_LANGUAGES = ['tha', 'eng'] as const;

export class ScanAgentCardDto {
  @ApiProperty({
    format: 'uuid',
    example: P3_IDS.file,
    description: 'The photo uploaded with `store.files.presign` (purpose `agent_card_scan`) and completed',
  })
  @IsUUID()
  fileId!: string;

  @ApiPropertyOptional({
    type: [String],
    enum: OCR_LANGUAGES,
    enumName: 'AgentCardScanLanguage',
    default: ['tha', 'eng'],
    description: 'Languages on the card; `eng` alone reads an English-only card better',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsIn(OCR_LANGUAGES, { each: true })
  languages?: (typeof OCR_LANGUAGES)[number][];
}

export class ScannedFieldDto {
  @ApiProperty({ example: 'คุณมานี ใจดี' })
  value!: string;

  @ApiProperty({ example: 0.86, minimum: 0, maximum: 1, description: '0–1; review anything below ~0.7' })
  confidence!: number;
}

export class ScannedLineDto {
  @ApiProperty({ example: 'คุณมานี ใจดี' })
  text!: string;

  @ApiProperty({ type: 'integer', example: 90, minimum: 0, maximum: 100 })
  confidence!: number;
}

export const OCR_ENGINES = ['tesseract_cli', 'fake'] as const;

export class ScannedCardDto {
  @ApiProperty({ format: 'uuid', example: P3_IDS.file })
  fileId!: string;

  @ApiProperty({ enum: OCR_ENGINES, enumName: 'AgentCardScanEngine', example: 'tesseract_cli' })
  engine!: string;

  @ApiProperty({ type: ScannedFieldDto, nullable: true })
  contactName!: ScannedFieldDto | null;

  @ApiProperty({ type: ScannedFieldDto, nullable: true })
  organisationName!: ScannedFieldDto | null;

  @ApiProperty({ type: ScannedFieldDto, nullable: true, description: 'E.164; a mobile first' })
  phone!: ScannedFieldDto | null;

  @ApiProperty({ type: [ScannedFieldDto], description: 'Other numbers on the card (office)' })
  otherPhones!: ScannedFieldDto[];

  @ApiProperty({ type: ScannedFieldDto, nullable: true })
  email!: ScannedFieldDto | null;

  @ApiProperty({ type: ScannedFieldDto, nullable: true })
  taxId!: ScannedFieldDto | null;

  @ApiProperty({ type: ScannedFieldDto, nullable: true })
  lineId!: ScannedFieldDto | null;

  @ApiProperty({ type: ScannedFieldDto, nullable: true })
  website!: ScannedFieldDto | null;

  @ApiProperty({ type: [ScannedLineDto], description: 'Every line read, to copy from' })
  lines!: ScannedLineDto[];

  @TimestampField('2026-10-25T10:00:00+07:00')
  deleteAfter!: string;
}

export const SCANNED_CARD_EXAMPLE: ScannedCardDto = {
  fileId: P3_IDS.file,
  engine: 'tesseract_cli',
  contactName: { value: 'คุณมานี ใจดี', confidence: 0.86 },
  organisationName: { value: 'บริษัท ตัวอย่างบรรจุภัณฑ์ จำกัด', confidence: 0.81 },
  phone: { value: '+66890001234', confidence: 0.86 },
  otherPhones: [],
  email: { value: 'manee@example.invalid', confidence: 0.9 },
  taxId: null,
  lineId: { value: 'manee.cafe', confidence: 0.86 },
  website: null,
  lines: [
    { text: 'คุณมานี ใจดี', confidence: 90 },
    { text: 'บริษัท ตัวอย่างบรรจุภัณฑ์ จำกัด', confidence: 90 },
    { text: 'โทร 089-000-1234', confidence: 90 },
    { text: 'manee@example.invalid', confidence: 90 },
    { text: 'LINE: manee.cafe', confidence: 90 },
  ],
  deleteAfter: '2026-10-25T10:00:00+07:00',
};
