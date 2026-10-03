import { CursorQuery, PageQuery } from '@common/pagination/pagination.dto';
import { PersonRefDto } from '@modules/financial-reports/financial-reports.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { CONTEXT_CARD_TYPES, RECORD_SUBJECTS, SUBJECT_TYPES } from './conversation-subjects';
import { ConversationTicketDto } from './support.dto';

/** Chat with CS and the LINE official account (D-143, D-151; B4.6). */

export const CONVERSATION_STATUSES = ['open', 'pending', 'closed'] as const;
export const CONVERSATION_IDS = {
  conversation: '0192f3a0-7c1e-7d2a-9b1f-0000000f4001',
  message: '0192f3a0-7c1e-7d2a-9b1f-0000000f4002',
  customer: '0192f3a0-7c1e-7d2a-9b1f-0000000f4003',
  staff: '0192f3a0-7c1e-7d2a-9b1f-0000000f4004',
  order: '0192f3a0-7c1e-7d2a-9b1f-0000000f4005',
  file: '0192f3a0-7c1e-7d2a-9b1f-0000000f4006',
  canned: '0192f3a0-7c1e-7d2a-9b1f-0000000f4007',
  company: '0192f3a0-7c1e-7d2a-9b1f-0000000f4008',
};
export const REPLY_CHANNELS = ['web', 'line'] as const;
export const SLA_STATES = ['waiting', 'overdue', 'answered'] as const;

/** D-300 a card pointing to one of the customer's records. */
export class ContextCardInputDto {
  @ApiProperty({ enum: CONTEXT_CARD_TYPES, enumName: 'ContextCardType', example: 'order' })
  @IsIn(CONTEXT_CARD_TYPES)
  type!: (typeof CONTEXT_CARD_TYPES)[number];

  @ApiProperty({ format: 'uuid', example: CONVERSATION_IDS.order })
  @IsUUID()
  id!: string;
}

export class ContextCardDto extends ContextCardInputDto {
  @ApiProperty({ example: 'PK-2610-0001-01', description: 'Order / RFQ / quotation code, design title' })
  label!: string;

  @ApiProperty({ type: String, nullable: true, example: 'in_production', description: 'Its status now' })
  status!: string | null;
}

export class MessageFileDto {
  @ApiProperty({ format: 'uuid', example: CONVERSATION_IDS.file, description: 'Download with `*.files.get`' })
  id!: string;

  @ApiProperty({ example: 'logo.png' })
  name!: string;

  @ApiProperty({ example: 'image/png' })
  mimeType!: string;
}

export class SendMessageDto {
  @ApiProperty({ example: 'สอบถามสถานะคำสั่งซื้อค่ะ', minLength: 1, maxLength: 5000 })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;
}

export class AssignConversationDto {
  @ApiPropertyOptional({ format: 'uuid', example: CONVERSATION_IDS.staff, description: 'Default: me' })
  @IsOptional()
  @IsUUID()
  userId?: string;
}

export class ConversationListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: CONVERSATION_STATUSES, enumName: 'ConversationStatus' })
  @IsOptional()
  @IsIn(CONVERSATION_STATUSES)
  status?: (typeof CONVERSATION_STATUSES)[number];

  @ApiPropertyOptional({ enum: ['me', 'unassigned'], enumName: 'ConversationAssignee' })
  @IsOptional()
  @IsIn(['me', 'unassigned'])
  assigned?: 'me' | 'unassigned';

  @ApiPropertyOptional({ enum: SUBJECT_TYPES, enumName: 'ConversationSubject' })
  @IsOptional()
  @IsIn(SUBJECT_TYPES)
  subjectType?: (typeof SUBJECT_TYPES)[number];

  @ApiPropertyOptional({ enum: ['line', 'web', 'contact'], enumName: 'ConversationChannel' })
  @IsOptional()
  @IsIn(['line', 'web', 'contact'])
  channel?: 'line' | 'web' | 'contact';

  @ApiPropertyOptional({ format: 'uuid', description: 'Threads about records of this company' })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional({
    enum: SLA_STATES,
    enumName: 'ConversationSlaState',
    description: 'First response: waiting (in time), overdue, answered',
  })
  @IsOptional()
  @IsIn(SLA_STATES)
  sla?: (typeof SLA_STATES)[number];
}

export class MessagesQuery extends CursorQuery {}

export class RichMenuDto {
  @ApiProperty({ example: 'member_2026' })
  key!: string;

  @ApiProperty({ enum: ['guest', 'member'], enumName: 'RichMenuAudience', example: 'member' })
  audience!: string;

  @ApiProperty({ example: 'richmenu-0000000000000000000000000000fake' })
  providerMenuId!: string;

  @ApiProperty({ example: true })
  active!: boolean;
}

export class SaveRichMenuDto {
  @ApiProperty({ enum: ['guest', 'member'], enumName: 'RichMenuAudience', example: 'member' })
  @IsIn(['guest', 'member'])
  audience!: 'guest' | 'member';

  @ApiProperty({ example: 'richmenu-0000000000000000000000000000fake', maxLength: 100 })
  @IsString()
  @Matches(/^richmenu-[A-Za-z0-9]+$/)
  @MaxLength(100)
  providerMenuId!: string;

  @ApiProperty({
    example: true,
    description: 'One active menu per audience; activating one deactivates the other',
  })
  @IsBoolean()
  active!: boolean;
}

export class LineWebhookAckDto {
  @ApiProperty({ example: true })
  ok!: boolean;
}

export class MessageDto {
  @ApiProperty({ format: 'uuid', example: CONVERSATION_IDS.message })
  id!: string;

  @ApiProperty({
    enum: ['inbound', 'outbound'],
    enumName: 'MessageDirection',
    example: 'inbound',
    description: 'Inbound = from the customer',
  })
  direction!: string;

  @ApiProperty({
    enum: ['text', 'image', 'file', 'sticker', 'system'],
    enumName: 'MessageKind',
    example: 'text',
  })
  kind!: string;

  @ApiProperty({ nullable: true, example: 'สอบถามสถานะคำสั่งซื้อค่ะ' })
  body!: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true, description: 'Staff who replied (outbound)' })
  sender!: UserRefDto | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-20T10:00:00+07:00' })
  sentAt!: string;

  @ApiProperty({ format: 'date-time', nullable: true, example: null })
  readAt!: string | null;

  @ApiProperty({
    enum: ['customer', 'internal'],
    enumName: 'MessageVisibility',
    example: 'customer',
    description: '`internal`: a staff note (D-300) — never on the store surface',
  })
  visibility!: string;

  @ApiProperty({
    enum: REPLY_CHANNELS,
    enumName: 'ReplyChannel',
    nullable: true,
    example: 'web',
    description: 'The channel it came in or went out through',
  })
  via!: string | null;

  @ApiProperty({
    type: ContextCardDto,
    nullable: true,
    description: 'D-300 card to a record of the customer',
  })
  contextCard!: ContextCardDto | null;

  @ApiProperty({ type: MessageFileDto, nullable: true, description: '`image` / `file` messages' })
  file!: MessageFileDto | null;
}

export class SubjectRefDto {
  @ApiProperty({ enum: RECORD_SUBJECTS, enumName: 'ConversationRecordSubject', example: 'order' })
  type!: string;

  @ApiProperty({ format: 'uuid', example: CONVERSATION_IDS.order })
  id!: string;

  @ApiProperty({ example: 'PK-2610-0001-01' })
  label!: string;
}

export class ConversationSlaDto {
  @ApiProperty({
    enum: SLA_STATES,
    enumName: 'ConversationSlaState',
    nullable: true,
    example: 'waiting',
    description: 'First response: waiting (in time), overdue, answered; null before any customer message',
  })
  state!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-21T10:00:00+07:00' })
  firstResponseDueAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  firstRespondedAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: '`conversations.resolution_business_days`; null while unset',
  })
  resolutionDueAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null, description: 'Closed at' })
  resolvedAt!: string | null;
}

export class ParticipantDto {
  @ApiProperty({ type: UserRefDto })
  user!: UserRefDto;

  @ApiProperty({
    enum: ['customer', 'staff'],
    enumName: 'AnnotationAuthorKind',
    example: 'staff',
    description: 'The participant is the customer or Packio staff (shared customer / staff enum)',
  })
  role!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-20T10:05:00+07:00' })
  lastReadAt!: string | null;
}

export class StoreConversationDto {
  @ApiProperty({ format: 'uuid', example: CONVERSATION_IDS.conversation })
  id!: string;

  @ApiProperty({ enum: CONVERSATION_STATUSES, enumName: 'ConversationStatus', example: 'open' })
  status!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-20T10:00:00+07:00' })
  lastMessageAt!: string;
}

export class ConversationDto extends StoreConversationDto {
  @ApiProperty({
    enum: ['line', 'web', 'contact'],
    enumName: 'ConversationChannel',
    example: 'line',
    description: '`contact`: a guest’s support ticket, answered by phone or e-mail (D-221)',
  })
  channel!: string;

  @ApiProperty({
    type: UserRefDto,
    nullable: true,
    description: 'The customer, when known (linked LINE or web)',
  })
  customer!: UserRefDto | null;

  @ApiProperty({ nullable: true, example: 'สมหญิง', description: 'LINE display name (PII)' })
  lineDisplayName!: string | null;

  @ApiProperty({
    enum: ['followed', 'blocked', 'unknown'],
    enumName: 'LineFriendStatus',
    nullable: true,
    example: 'followed',
  })
  lineFriendStatus!: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  assignee!: UserRefDto | null;

  @ApiProperty({ nullable: true, example: 'สอบถามสถานะคำสั่งซื้อค่ะ' })
  lastMessage!: string | null;

  @ApiProperty({
    type: ConversationTicketDto,
    nullable: true,
    description: 'The latest support ticket opened on it (contact form / hand-off, D-221)',
  })
  ticket!: ConversationTicketDto | null;
  @ApiProperty({ enum: SUBJECT_TYPES, enumName: 'ConversationSubject', example: 'support' })
  subjectType!: string;

  @ApiProperty({ type: SubjectRefDto, nullable: true, description: 'Null for the support chat' })
  subject!: SubjectRefDto | null;

  @ApiProperty({
    type: PersonRefDto,
    nullable: true,
    description: 'The company of the subject (id + legal name)',
  })
  company!: PersonRefDto | null;

  @ApiProperty({
    enum: REPLY_CHANNELS,
    enumName: 'ReplyChannel',
    example: 'line',
    description: 'Where a reply goes now (D-300)',
  })
  replyChannel!: string;

  @ApiProperty({ type: ConversationSlaDto })
  sla!: ConversationSlaDto;

  @ApiProperty({ type: [ParticipantDto] })
  participants!: ParticipantDto[];

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'A LINE thread merged into the customer’s support thread',
  })
  mergedIntoId!: string | null;
}

export const MESSAGE_EXAMPLE = {
  id: CONVERSATION_IDS.message,
  direction: 'inbound',
  kind: 'text',
  body: 'สอบถามสถานะคำสั่งซื้อค่ะ',
  sender: null,
  sentAt: '2026-10-20T10:00:00+07:00',
  readAt: null,
  visibility: 'customer',
  via: 'web',
  contextCard: {
    type: 'order',
    id: CONVERSATION_IDS.order,
    label: 'PK-2610-0001-01',
    status: 'in_production',
  },
  file: null,
};
export const STORE_CONVERSATION_EXAMPLE = {
  id: CONVERSATION_IDS.conversation,
  status: 'open',
  lastMessageAt: '2026-10-20T10:00:00+07:00',
};
export const CONVERSATION_EXAMPLE = {
  ...STORE_CONVERSATION_EXAMPLE,
  channel: 'line',
  customer: { id: CONVERSATION_IDS.customer, displayName: 'ลูกค้า ทดสอบ' },
  lineDisplayName: 'ลูกค้า',
  lineFriendStatus: 'followed',
  assignee: null,
  lastMessage: 'สอบถามสถานะคำสั่งซื้อค่ะ',
  ticket: null,
  subjectType: 'support',
  subject: null,
  company: null,
  replyChannel: 'line',
  sla: {
    state: 'waiting',
    firstResponseDueAt: '2026-10-21T10:00:00+07:00',
    firstRespondedAt: null,
    resolutionDueAt: null,
    resolvedAt: null,
  },
  participants: [
    {
      user: { id: CONVERSATION_IDS.customer, displayName: 'ลูกค้า ทดสอบ' },
      role: 'customer',
      lastReadAt: '2026-10-20T10:00:00+07:00',
    },
  ],
  mergedIntoId: null,
};
export const RICH_MENU_EXAMPLE = {
  key: 'member_2026',
  audience: 'member',
  providerMenuId: 'richmenu-0000000000000000000000000000fake',
  active: true,
};
