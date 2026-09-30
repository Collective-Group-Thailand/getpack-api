import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const CHANNELS = ['email', 'sms', 'line', 'web_push', 'in_app', 'teams'] as const;
export const CATEGORIES = ['transactional', 'marketing', 'security'] as const;
export const AUDIENCES = ['customer', 'company_member', 'staff_team', 'factory', 'assignee'] as const;
export const TEMPLATE_STATUSES = ['draft', 'published', 'retired'] as const;
export const LOCALES = ['th', 'en'] as const;
export const CONSENT_SOURCES = ['web', 'line_liff', 'cs', 'partner_zone'] as const;

const TEMPLATE_ID = '0192f3a0-7c1e-7d2a-9b1f-00000000f00d';

// --- templates --------------------------------------------------------------------------------
export class TemplateVersionDto {
  @ApiProperty({ type: 'integer', example: 1 })
  versionNo!: number;

  @ApiProperty({ enum: LOCALES, enumName: 'LocaleCode', example: 'th' })
  locale!: (typeof LOCALES)[number];

  @ApiProperty({ type: String, nullable: true, example: 'มีคำขออนุมัติรอคุณ' })
  subject!: string | null;

  @ApiProperty({
    example: 'คำขอ {{payload.policyKey}} รอการอนุมัติของคุณ',
    description: 'Handlebars; MJML allowed for e-mail',
  })
  body!: string;

  @ApiProperty({ enum: TEMPLATE_STATUSES, enumName: 'TemplateVersionStatus', example: 'published' })
  status!: (typeof TEMPLATE_STATUSES)[number];

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-09-23T14:05:00+07:00' })
  publishedAt!: string | null;
}

export class NotificationTemplateDto {
  @ApiProperty({ format: 'uuid', example: TEMPLATE_ID })
  id!: string;

  @ApiProperty({ example: 'approval.requested:assignee' })
  key!: string;

  @ApiProperty({ enum: CHANNELS, enumName: 'NotificationChannel', example: 'in_app' })
  channel!: (typeof CHANNELS)[number];

  @ApiProperty({ enum: CATEGORIES, enumName: 'NotificationCategory', example: 'transactional' })
  category!: (typeof CATEGORIES)[number];

  @ApiProperty({ example: 'Approvers: a request waits for your decision' })
  description!: string;

  @ApiProperty({ type: [TemplateVersionDto] })
  versions!: TemplateVersionDto[];
}

export const TEMPLATE_EXAMPLE: NotificationTemplateDto = {
  id: TEMPLATE_ID,
  key: 'approval.requested:assignee',
  channel: 'in_app',
  category: 'transactional',
  description: 'Approvers: a request waits for your decision',
  versions: [
    {
      versionNo: 1,
      locale: 'th',
      subject: 'มีคำขออนุมัติรอคุณ',
      body: 'คำขอ {{payload.policyKey}} รอการอนุมัติของคุณ',
      status: 'published',
      publishedAt: '2026-09-23T14:05:00+07:00',
    },
  ],
};

export class CreateTemplateDto {
  @ApiProperty({ example: 'approval.requested:assignee', pattern: '^[a-z][a-z0-9_.]*(:[a-z_]+)?$' })
  @Matches(/^[a-z][a-z0-9_.]*(:[a-z_]+)?$/)
  @MaxLength(120)
  key!: string;

  @ApiProperty({ enum: CHANNELS, enumName: 'NotificationChannel', example: 'in_app' })
  @IsIn(CHANNELS)
  channel!: (typeof CHANNELS)[number];

  @ApiProperty({ enum: CATEGORIES, enumName: 'NotificationCategory', example: 'transactional' })
  @IsIn(CATEGORIES)
  category!: (typeof CATEGORIES)[number];

  @ApiProperty({ example: 'Approvers: a request waits for your decision', maxLength: 300 })
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  description!: string;
}

export class AddTemplateVersionDto {
  @ApiProperty({ enum: LOCALES, enumName: 'LocaleCode', example: 'th' })
  @IsIn(LOCALES)
  locale!: (typeof LOCALES)[number];

  @ApiPropertyOptional({ example: 'มีคำขออนุมัติรอคุณ', maxLength: 200, description: 'Required for e-mail' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @ApiProperty({ example: 'คำขอ {{payload.policyKey}} รอการอนุมัติของคุณ', maxLength: 100_000 })
  @IsString()
  @MinLength(1)
  @MaxLength(100_000)
  body!: string;
}

export class PreviewTemplateDto {
  @ApiProperty({ enum: LOCALES, enumName: 'LocaleCode', example: 'th' })
  @IsIn(LOCALES)
  locale!: (typeof LOCALES)[number];

  @ApiPropertyOptional({
    type: 'integer',
    example: 2,
    description: 'A draft to preview; default = published',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  versionNo?: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { policyKey: 'discount_memo' },
    description: 'Sample event payload',
  })
  @IsObject()
  payload!: Record<string, unknown>;
}

export class RenderedMessageDto {
  @ApiProperty({ type: String, nullable: true, example: 'มีคำขออนุมัติรอคุณ' })
  subject!: string | null;

  @ApiProperty({
    example: 'คำขอ discount_memo รอการอนุมัติของคุณ',
    description: 'HTML for e-mail, text otherwise',
  })
  body!: string;
}

export class TestSendResultDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'f***@example.com',
    description: 'Where it went (masked)',
  })
  sentTo!: string | null;
}

// --- routes -----------------------------------------------------------------------------------
export class NotificationRouteDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000f0f0' })
  id!: string;

  @ApiProperty({ example: 'approval.requested' })
  eventType!: string;

  @ApiProperty({ enum: AUDIENCES, enumName: 'NotificationAudience', example: 'assignee' })
  audience!: (typeof AUDIENCES)[number];

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Team code for staff_team routes',
  })
  staffTeam!: string | null;

  @ApiProperty({ enum: CHANNELS, enumName: 'NotificationChannel', example: 'in_app' })
  channel!: (typeof CHANNELS)[number];

  @ApiProperty({ example: 'approval.requested:assignee' })
  template!: string;

  @ApiProperty({ example: false, description: 'SMS is sent only for critical events (D-143)' })
  isCritical!: boolean;

  @ApiProperty({ example: false, description: 'Consent + 09:00–20:00 window apply (D-144)' })
  isMarketing!: boolean;

  @ApiProperty({ example: true })
  enabled!: boolean;
}

export const ROUTE_EXAMPLE: NotificationRouteDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-00000000f0f0',
  eventType: 'approval.requested',
  audience: 'assignee',
  staffTeam: null,
  channel: 'in_app',
  template: 'approval.requested:assignee',
  isCritical: false,
  isMarketing: false,
  enabled: true,
};

export class CreateRouteDto {
  @ApiProperty({ example: 'approval.requested', pattern: '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$' })
  @Matches(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/)
  eventType!: string;

  @ApiProperty({ enum: AUDIENCES, enumName: 'NotificationAudience', example: 'assignee' })
  @IsIn(AUDIENCES)
  audience!: (typeof AUDIENCES)[number];

  @ApiPropertyOptional({ example: 'finance', description: 'Team code, only for staff_team' })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_]*$/)
  staffTeam?: string;

  @ApiProperty({
    format: 'uuid',
    example: TEMPLATE_ID,
    description: 'Template (its channel is the route channel)',
  })
  @IsUUID()
  templateId!: string;

  @ApiProperty({ example: false })
  @IsBoolean()
  isCritical!: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  isMarketing!: boolean;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { 'payload.policyKey': 'discount_memo' },
    description: 'Equality filters on the event payload',
  })
  @IsOptional()
  @IsObject()
  conditions?: Record<string, unknown>;
}

export class SetRouteEnabledDto {
  @ApiProperty({ example: false })
  @IsBoolean()
  enabled!: boolean;
}

// --- self-service -----------------------------------------------------------------------------
export class NotificationPreferenceDto {
  @ApiProperty({ enum: CHANNELS, enumName: 'NotificationChannel', example: 'line' })
  @IsIn(CHANNELS)
  channel!: (typeof CHANNELS)[number];

  @ApiProperty({ enum: CATEGORIES, enumName: 'NotificationCategory', example: 'marketing' })
  @IsIn(CATEGORIES)
  category!: (typeof CATEGORIES)[number];

  @ApiProperty({ example: false })
  @IsBoolean()
  enabled!: boolean;
}

export class SetPreferencesDto {
  @ApiProperty({ type: [NotificationPreferenceDto] })
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceDto)
  items!: NotificationPreferenceDto[];
}

export class ConsentDto {
  @ApiProperty({ example: 'marketing_line' })
  purpose!: string;

  @ApiProperty({
    example: false,
    description: 'Required purposes (terms, privacy notice) are needed to use Packio',
  })
  required!: boolean;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 1,
    description: 'Text version in force; null = not published yet',
  })
  versionNo!: number | null;

  @ApiProperty({ type: String, nullable: true, example: 'รับข่าวสารและโปรโมชันทาง LINE' })
  summary!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'ข้าพเจ้ายินยอมรับข่าวสาร…' })
  text!: string | null;

  @ApiProperty({
    type: Boolean,
    nullable: true,
    example: true,
    description: 'Latest decision; null = never asked',
  })
  granted!: boolean | null;

  @ApiProperty({
    type: Boolean,
    example: false,
    description: 'The latest decision was for an older text version',
  })
  outdated!: boolean;
}

/** A customer's consent as staff see it (U-B0.2): the latest decision per purpose and how it was given. */
export class AdminConsentDto {
  @ApiProperty({ example: 'marketing_line' })
  purpose!: string;

  @ApiProperty({ example: false })
  required!: boolean;

  @ApiProperty({ type: 'integer', nullable: true, example: 2, description: 'Text version in force' })
  versionNo!: number | null;

  @ApiProperty({ type: Boolean, nullable: true, example: true, description: 'Latest decision; null = never asked' })
  granted!: boolean | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 1, description: 'Text version the decision was for' })
  decidedVersionNo!: number | null;

  @ApiProperty({ example: true, description: 'The latest decision was for an older text version' })
  outdated!: boolean;

  @ApiProperty({ enum: CONSENT_SOURCES, enumName: 'ConsentSource', nullable: true, example: 'web' })
  source!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-01T10:00:00+07:00' })
  recordedAt!: string | null;
}

export class RecordConsentDto {
  @ApiProperty({ example: 'marketing_line', pattern: '^[a-z][a-z0-9_]*$' })
  @Matches(/^[a-z][a-z0-9_]*$/)
  purpose!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  granted!: boolean;

  @ApiPropertyOptional({ enum: CONSENT_SOURCES, enumName: 'ConsentSource', default: 'web', example: 'web' })
  @IsOptional()
  @IsIn(CONSENT_SOURCES)
  source?: (typeof CONSENT_SOURCES)[number];
}

export class InboxItemDto {
  @ApiProperty({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-00000000e001',
    description: 'Event id; also the item id',
  })
  id!: string;

  @ApiProperty({ example: 'approval.requested' })
  eventType!: string;

  @ApiProperty({ type: String, nullable: true, example: 'มีคำขออนุมัติรอคุณ' })
  title!: string | null;

  @ApiProperty({ example: 'คำขอ discount_memo รอการอนุมัติของคุณ' })
  body!: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-23T14:05:00+07:00' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  readAt!: string | null;
}

export const INBOX_EXAMPLE: InboxItemDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-00000000e001',
  eventType: 'approval.requested',
  title: 'มีคำขออนุมัติรอคุณ',
  body: 'คำขอ discount_memo รอการอนุมัติของคุณ',
  createdAt: '2026-09-23T14:05:00+07:00',
  readAt: null,
};

// --- consent purposes (admin) -----------------------------------------------------------------
export class ConsentPurposeVersionDto {
  @ApiProperty({ type: 'integer', example: 1 })
  versionNo!: number;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T00:00:00+07:00' })
  effectiveFrom!: string;

  @ApiProperty({ example: 'ข้าพเจ้ายินยอมรับข่าวสาร…' })
  textTh!: string;

  @ApiProperty({ example: 'I agree to receive news…' })
  textEn!: string;
}

export class ConsentPurposeDto {
  @ApiProperty({ example: 'marketing_line' })
  key!: string;

  @ApiProperty({ example: false })
  required!: boolean;

  @ApiProperty({ type: [ConsentPurposeVersionDto] })
  versions!: ConsentPurposeVersionDto[];
}

export class PublishConsentTextDto {
  @ApiProperty({ example: 'ข้าพเจ้ายินยอมรับข่าวสาร…', maxLength: 20_000 })
  @IsString()
  @MinLength(10)
  @MaxLength(20_000)
  textTh!: string;

  @ApiProperty({ example: 'I agree to receive news…', maxLength: 20_000 })
  @IsString()
  @MinLength(10)
  @MaxLength(20_000)
  textEn!: string;

  @ApiPropertyOptional({ example: 'รับข่าวสารทาง LINE', maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  summaryTh?: string;

  @ApiPropertyOptional({ example: 'News on LINE', maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  summaryEn?: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T00:00:00+07:00' })
  @Type(() => Date)
  @IsDate()
  effectiveFrom!: Date;

  @ApiProperty({ example: 'Text approved by legal counsel', minLength: 3, maxLength: 500 })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
