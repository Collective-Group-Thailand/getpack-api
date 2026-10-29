import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** The storefront's contact form and guided-help hand-off (D-221), opened as CS tickets on conversations. */

export const SUPPORT_TICKET_SOURCES = ['contact_form', 'handoff'] as const;
const TOPIC = /^[a-z][a-z0-9_]{0,39}$/;
/** D-458 how the requester wants the answer; `callback` needs a mobile number and a slot. */
export const SUPPORT_REPLY_CHANNELS = ['line', 'email', 'callback'] as const;
export type SupportReplyChannel = (typeof SUPPORT_REPLY_CHANNELS)[number];
export const SUPPORT_TICKET_STAGES = ['received', 'in_progress', 'answered'] as const;
const KEY = /^[a-z0-9][a-z0-9_-]{0,59}$/;
/** A ticket number as issued by the `support_ticket` series (D-440: `CS-YYMM-NNNNN`). */
const TICKET_NO = /^[A-Z]{2,8}-[0-9]{4}-[0-9]{3,8}$/;
/** Technical bound of the hand-off context (answers of the guided help). */
export const MAX_HANDOFF_CONTEXT_BYTES = 16 * 1024;

export class SupportContactPersonDto {
  @ApiProperty({ example: 'สมชาย ทดสอบ', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: '0000000000', maxLength: 40, description: 'Phone or e-mail is required' })
  @IsOptional()
  @Matches(/^\+?[0-9 -]{6,40}$/)
  phone?: string;

  @ApiPropertyOptional({ example: 'someone@example.test', maxLength: 254 })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;
}

/**
 * D-458 the intent's own fields (contact page, sales form on /business, factory application on /partner-with-us);
 * every field optional, bounded, stored with the ticket for the queue that handles it.
 */
export class SupportContactDetailsDto {
  @ApiPropertyOptional({
    example: 'บริษัท ตัวอย่าง จำกัด',
    maxLength: 200,
    description: 'Company / factory name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  company?: string;

  @ApiPropertyOptional({
    example: '1000_5000',
    pattern: KEY.source,
    description: 'Monthly volume bucket the storefront offers (e.g. `under_1000`, `1000_5000`)',
  })
  @IsOptional()
  @Matches(KEY)
  monthlyVolume?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['credit', 'branches'],
    description: 'Sales form: what the company is interested in (storefront keys)',
  })
  @IsOptional()
  @ArrayMaxSize(12)
  @Matches(KEY, { each: true })
  interests?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['corrugated_box'],
    description: 'Factory application: what the factory produces (product type codes or storefront keys)',
  })
  @IsOptional()
  @ArrayMaxSize(30)
  @Matches(KEY, { each: true })
  capabilities?: string[];

  @ApiPropertyOptional({ example: 'กรุงเทพมหานคร', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  province?: string;

  @ApiPropertyOptional({
    example: 'spreadsheet',
    pattern: KEY.source,
    description: 'Factory application: the system the factory runs today (storefront key)',
  })
  @IsOptional()
  @Matches(KEY)
  currentSystem?: string;

  @ApiPropertyOptional({
    example: 'กล่องไปรษณีย์',
    maxLength: 200,
    description: 'Quotation: the product asked about',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  product?: string;

  @ApiPropertyOptional({ type: 'integer', example: 1000, minimum: 1, maximum: 10000000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  quantity?: number;

  @ApiPropertyOptional({
    example: '200 × 150 × 80 มม.',
    maxLength: 100,
    description: 'Quotation: inside size as typed',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  insideSize?: string;

  @ApiPropertyOptional({
    example: '10110',
    pattern: '^[0-9]{5}$',
    description: 'Shipping: destination postcode',
  })
  @IsOptional()
  @Matches(/^[0-9]{5}$/)
  postcode?: string;
}

export class SupportCallbackDto {
  @ApiProperty({
    format: 'date',
    example: '2026-10-21',
    description: 'One of `store.support.contactOptions` `callback.days`',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @ApiProperty({
    example: 'morning',
    description: 'One of `store.support.contactOptions` `callback.slots[].key`',
  })
  @Matches(/^[a-z0-9_]{1,20}$/)
  slot!: string;
}

export class SupportContactDto {
  @ApiPropertyOptional({
    type: SupportContactPersonDto,
    description: 'Required for a guest; a signed-in customer is reached through the account',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SupportContactPersonDto)
  contact?: SupportContactPersonDto;

  @ApiProperty({
    example: 'order_status',
    pattern: TOPIC.source,
    description: 'The storefront’s topic key (e.g. order_status, quotation, artwork, other)',
  })
  @Matches(TOPIC)
  topic!: string;

  @ApiPropertyOptional({
    example: 'PK-2610-0001-01',
    maxLength: 40,
    description: 'An order code, if it is about one',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  orderCode?: string;

  @ApiProperty({ example: 'สอบถามกำหนดส่งค่ะ', minLength: 1, maxLength: 5000 })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message!: string;

  @ApiPropertyOptional({ type: SupportContactDetailsDto, description: 'D-458 the intent’s own fields' })
  @IsOptional()
  @ValidateNested()
  @Type(() => SupportContactDetailsDto)
  details?: SupportContactDetailsDto;

  @ApiPropertyOptional({
    enum: SUPPORT_REPLY_CHANNELS,
    enumName: 'SupportReplyChannel',
    example: 'line',
    description:
      'D-458 how to answer; `callback` needs a phone and `callback`, and only while call-back slots are set',
  })
  @IsOptional()
  @IsIn(SUPPORT_REPLY_CHANNELS)
  replyChannel?: SupportReplyChannel;

  @ApiPropertyOptional({
    type: SupportCallbackDto,
    description: 'D-458 required with `replyChannel: callback`',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SupportCallbackDto)
  callback?: SupportCallbackDto;
}

export class SupportHandoffDto {
  @ApiPropertyOptional({ type: SupportContactPersonDto, description: 'Required for a guest' })
  @IsOptional()
  @ValidateNested()
  @Type(() => SupportContactPersonDto)
  contact?: SupportContactPersonDto;

  @ApiProperty({ example: '/guided-help', maxLength: 300, description: 'The page the hand-off started from' })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  page!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { use: 'food', size: 'small' },
    description: 'The guided-help answers (≤ 16 KB)',
  })
  @IsOptional()
  @IsObject()
  answers?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String], example: ['tuck-end-box'], description: 'What was recommended' })
  @IsOptional()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  recommended?: string[];

  @ApiPropertyOptional({ example: 'อยากได้กล่องใส่คุกกี้', maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  note?: string;

  @ApiPropertyOptional({
    example: false,
    default: false,
    description: 'CS calls back instead of answering in chat',
  })
  @IsOptional()
  @IsBoolean()
  callback?: boolean;
}

export class SupportTicketDto {
  @ApiProperty({ example: 'CS-2610-00001' })
  ticketNo!: string;

  @ApiProperty({ enum: SUPPORT_TICKET_SOURCES, enumName: 'SupportTicketSource', example: 'contact_form' })
  source!: string;

  @ApiProperty({
    example: 'order_status',
    description:
      'The topic as sent (`guided_help` for a hand-off), its own field next to the reference (D-440): the reference ' +
      'stays `CS-YYMM-NNNNN` for every topic',
  })
  topic!: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-10-21T10:00:00+07:00',
    description: 'First-response target: `support.first_response_business_days` business days (D-221, D-175)',
  })
  respondBy!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://line.me/R/oaMessage/%40getpack-fake/?CS-2610-00001',
    description:
      'Opens a LINE chat with the official account carrying only the ticket number; null until set',
  })
  lineUrl!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000f4001',
    description: 'My CS conversation (signed in); null for a guest',
  })
  conversationId!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-20T10:00:00+07:00' })
  createdAt!: string;
}

/** A ticket as CS sees it on the conversation (contact details are PII: CS only). */
export class ConversationTicketDto {
  @ApiProperty({ example: 'CS-2610-00001' })
  ticketNo!: string;

  @ApiProperty({ enum: SUPPORT_TICKET_SOURCES, enumName: 'SupportTicketSource', example: 'contact_form' })
  source!: string;

  @ApiProperty({ example: 'order_status' })
  topic!: string;

  @ApiProperty({
    example: 'cs',
    description: 'D-458 the team queue the topic was routed to (`support.topic_queues`)',
  })
  queue!: string;

  @ApiProperty({ type: String, nullable: true, example: 'สมชาย ทดสอบ' })
  contactName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '0000000000' })
  contactPhone!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  contactEmail!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'PK-2610-0001-01',
    description: 'As typed; not verified',
  })
  orderRef!: string | null;

  @ApiProperty({ example: false })
  callbackRequested!: boolean;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true, example: null })
  context!: Record<string, unknown> | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-21T10:00:00+07:00' })
  respondBy!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  firstRespondedAt!: string | null;

  @ApiProperty({ example: false, description: 'Not answered and past `respondBy`' })
  overdue!: boolean;
}

export const SUPPORT_TICKET_EXAMPLE: SupportTicketDto = {
  ticketNo: 'CS-2610-00001',
  source: 'contact_form',
  topic: 'order_status',
  respondBy: '2026-10-21T10:00:00+07:00',
  lineUrl: 'https://line.me/R/oaMessage/%40getpack-fake/?CS-2610-00001',
  conversationId: null,
  createdAt: '2026-10-20T10:00:00+07:00',
};

export const CONVERSATION_TICKET_EXAMPLE: ConversationTicketDto = {
  ticketNo: 'CS-2610-00001',
  source: 'contact_form',
  topic: 'order_status',
  queue: 'cs',
  contactName: 'สมชาย ทดสอบ',
  contactPhone: '0000000000',
  contactEmail: null,
  orderRef: 'PK-2610-0001-01',
  callbackRequested: false,
  context: null,
  respondBy: '2026-10-21T10:00:00+07:00',
  firstRespondedAt: null,
  overdue: false,
};

// --- D-458 (C10): contact page options, ticket status, more information --------------------------------------------

export class SupportTeamStatusDto {
  @ApiProperty({
    example: true,
    description: 'CS answers right now (`storefront.support_hours`, Asia/Bangkok)',
  })
  openNow!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'When CS answers next; null while open (or no open day within two weeks)',
  })
  nextOpenAt!: string | null;
}

export class SupportCallbackSlotDto {
  @ApiProperty({ example: 'morning' })
  key!: string;

  @ApiProperty({ example: '09:00', pattern: '^\\d{2}:\\d{2}$' })
  from!: string;

  @ApiProperty({ example: '12:00', pattern: '^\\d{2}:\\d{2}$' })
  to!: string;
}

export class SupportCallbackOptionsDto {
  @ApiProperty({
    type: [String],
    example: ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27'],
    description: 'The next 5 business days of the national calendar (D-161), Asia/Bangkok dates',
  })
  days!: string[];

  @ApiProperty({ type: [SupportCallbackSlotDto], description: '`support.callback_slots` (CS Lead)' })
  slots!: SupportCallbackSlotDto[];
}

export class SupportContactOptionsDto {
  @ApiProperty({
    type: 'integer',
    example: 1,
    description: 'First-response target in business days — `support.first_response_business_days` (D-221)',
  })
  replyBusinessDays!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'integer' },
    example: {},
    description:
      'Per-topic first-response targets (`support.reply_business_days_by_topic`); a topic not listed uses `replyBusinessDays`',
  })
  replyBusinessDaysByTopic!: Record<string, number>;

  @ApiProperty({
    type: SupportTeamStatusDto,
    nullable: true,
    description: 'Null while `storefront.support_hours` is not set',
  })
  teamStatus!: SupportTeamStatusDto | null;

  @ApiProperty({
    type: SupportCallbackOptionsDto,
    nullable: true,
    description: 'Null while `support.callback_slots` is not set: the form offers no call back',
  })
  callback!: SupportCallbackOptionsDto | null;
}

export class SupportTicketLookupDto {
  @ApiProperty({ example: 'CS-2610-00001', pattern: TICKET_NO.source })
  @Matches(TICKET_NO)
  ticketNo!: string;

  @ApiPropertyOptional({
    type: SupportContactPersonDto,
    description:
      'A guest proves the ticket is theirs with the phone or e-mail they left (`name` is ignored); a signed-in ' +
      'customer reads their own tickets without it',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SupportContactPersonDto)
  contact?: SupportContactPersonDto;
}

export class SupportAddInfoDto extends SupportTicketLookupDto {
  @ApiProperty({ example: 'แนบเลขพัสดุเพิ่มค่ะ', minLength: 1, maxLength: 5000 })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message!: string;
}

export class SupportTicketStatusDto {
  @ApiProperty({ example: 'CS-2610-00001' })
  ticketNo!: string;

  @ApiProperty({ example: 'order' })
  topic!: string;

  @ApiProperty({
    enum: SUPPORT_TICKET_STAGES,
    enumName: 'SupportTicketStage',
    example: 'received',
    description:
      '`answered` once getpack replied (or closed the conversation), `in_progress` once someone took it, else `received`',
  })
  stage!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-20T10:00:00+07:00' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-21T10:00:00+07:00' })
  respondBy!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  answeredAt!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://line.me/R/oaMessage/%40getpack-fake/?CS-2610-00001',
    description: 'Continue on LINE with the ticket number; null until the OA is set',
  })
  lineUrl!: string | null;
}

export const SUPPORT_CONTACT_OPTIONS_EXAMPLE: SupportContactOptionsDto = {
  replyBusinessDays: 1,
  replyBusinessDaysByTopic: {},
  teamStatus: { openNow: false, nextOpenAt: '2026-10-21T09:00:00+07:00' },
  callback: null,
};

export const SUPPORT_TICKET_STATUS_EXAMPLE: SupportTicketStatusDto = {
  ticketNo: 'CS-2610-00001',
  topic: 'order',
  stage: 'received',
  createdAt: '2026-10-20T10:00:00+07:00',
  respondBy: '2026-10-21T10:00:00+07:00',
  answeredAt: null,
  lineUrl: 'https://line.me/R/oaMessage/%40getpack-fake/?CS-2610-00001',
};
