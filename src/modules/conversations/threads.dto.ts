import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { SUBJECT_TYPES } from './conversation-subjects';
import {
  ContextCardInputDto,
  CONVERSATION_IDS,
  MESSAGE_EXAMPLE,
  MessageDto,
  REPLY_CHANNELS,
  SubjectRefDto,
} from './conversations.dto';

/** Technical limit of one send (D-300): files ride as one message each. */
const MAX_FILES = 10;

export class PostMessageDto {
  @ApiPropertyOptional({ example: 'ขอแก้ไขสีโลโก้ค่ะ', maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  body?: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    example: [CONVERSATION_IDS.file],
    description: 'My uploaded, scanned files (`*.files.presign`, purpose `evidence` or `artwork`)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILES)
  @IsUUID('all', { each: true })
  fileIds?: string[];

  @ApiPropertyOptional({ type: ContextCardInputDto, description: 'A card to one of the customer’s records' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContextCardInputDto)
  contextCard?: ContextCardInputDto;
}

export class OpenThreadDto extends PostMessageDto {
  @ApiProperty({ enum: ['support', 'order', 'design', 'rfq'], enumName: 'OpenableSubject', example: 'order' })
  @IsIn(['support', 'order', 'design', 'rfq'])
  subjectType!: 'support' | 'order' | 'design' | 'rfq';

  @ApiPropertyOptional({
    format: 'uuid',
    example: CONVERSATION_IDS.order,
    description: 'Required unless `support`',
  })
  @ValidateIf((o: OpenThreadDto) => o.subjectType !== 'support')
  @IsUUID()
  subjectId?: string;
}

export class StaffReplyDto extends PostMessageDto {
  @ApiPropertyOptional({
    format: 'uuid',
    example: CONVERSATION_IDS.canned,
    description: 'The canned response the text started from (analytics)',
  })
  @IsOptional()
  @IsUUID()
  cannedResponseId?: string;
}

export class ConversationNoteDto {
  @ApiProperty({ example: 'ลูกค้าโทรมาแจ้งเพิ่ม: ต้องการส่งก่อนวันศุกร์', minLength: 1, maxLength: 5000 })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;

  @ApiPropertyOptional({ type: [String], format: 'uuid', example: [] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILES)
  @IsUUID('all', { each: true })
  fileIds?: string[];
}

export class ReplyChannelDto {
  @ApiProperty({ enum: REPLY_CHANNELS, enumName: 'ReplyChannel', example: 'line' })
  @IsIn(REPLY_CHANNELS)
  replyChannel!: (typeof REPLY_CHANNELS)[number];
}

export class StoreThreadDto {
  @ApiProperty({ format: 'uuid', example: CONVERSATION_IDS.conversation })
  id!: string;

  @ApiProperty({ enum: ['open', 'pending', 'closed'], enumName: 'ConversationStatus', example: 'pending' })
  status!: string;

  @ApiProperty({ enum: SUBJECT_TYPES, enumName: 'ConversationSubject', example: 'order' })
  subjectType!: string;

  @ApiProperty({ type: SubjectRefDto, nullable: true, description: 'Null for the support chat' })
  subject!: SubjectRefDto | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-20T10:05:00+07:00' })
  lastMessageAt!: string;

  @ApiProperty({ type: String, nullable: true, example: 'คำสั่งซื้อของคุณกำลังผลิตค่ะ' })
  lastMessage!: string | null;

  @ApiProperty({ type: 'integer', example: 1, description: 'Packio’s messages I have not read' })
  unread!: number;

  @ApiProperty({
    enum: REPLY_CHANNELS,
    enumName: 'ReplyChannel',
    example: 'web',
    description: 'Where replies go',
  })
  replyChannel!: string;

  @ApiProperty({ example: false, description: 'I chose it (else it follows my last message)' })
  replyChannelChosen!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-20T10:06:00+07:00',
    description: 'When Packio last read the thread (read receipt)',
  })
  readByPackioAt!: string | null;
}

export const STORE_THREAD_EXAMPLE: StoreThreadDto = {
  id: CONVERSATION_IDS.conversation,
  status: 'pending',
  subjectType: 'order',
  subject: { type: 'order', id: CONVERSATION_IDS.order, label: 'PK-2610-0001-01' },
  lastMessageAt: '2026-10-20T10:05:00+07:00',
  lastMessage: 'คำสั่งซื้อของคุณกำลังผลิตค่ะ',
  unread: 1,
  replyChannel: 'web',
  replyChannelChosen: false,
  readByPackioAt: '2026-10-20T10:06:00+07:00',
};

export class SentDto {
  @ApiProperty({
    format: 'uuid',
    example: CONVERSATION_IDS.conversation,
    description: 'The thread it went into',
  })
  conversationId!: string;

  @ApiProperty({ type: [MessageDto], description: 'The text (with its card) first, then one per file' })
  messages!: MessageDto[];
}

export const SENT_EXAMPLE: SentDto = {
  conversationId: CONVERSATION_IDS.conversation,
  messages: [MESSAGE_EXAMPLE as MessageDto],
};

// --- canned responses ----------------------------------------------------------------------------------------

export class CannedResponseDto {
  @ApiProperty({ format: 'uuid', example: CONVERSATION_IDS.canned })
  id!: string;

  @ApiProperty({ example: 'แจ้งระยะเวลาผลิต' })
  title!: string;

  @ApiProperty({ example: 'งานของคุณใช้เวลาผลิตประมาณ 10 วันทำการหลังอนุมัติไฟล์ค่ะ' })
  bodyTh!: string;

  @ApiProperty({
    example: 'Your order takes about 10 business days to produce after the artwork is approved.',
  })
  bodyEn!: string;

  @ApiProperty({ type: [String], example: ['production'] })
  tags!: string[];

  @ApiProperty({ example: false })
  archived!: boolean;

  @ApiProperty({ type: UserRefDto })
  updatedBy!: UserRefDto;

  @ApiProperty({ format: 'date-time', example: '2026-10-20T09:00:00+07:00' })
  updatedAt!: string;
}

export const CANNED_EXAMPLE: CannedResponseDto = {
  id: CONVERSATION_IDS.canned,
  title: 'แจ้งระยะเวลาผลิต',
  bodyTh: 'งานของคุณใช้เวลาผลิตประมาณ 10 วันทำการหลังอนุมัติไฟล์ค่ะ',
  bodyEn: 'Your order takes about 10 business days to produce after the artwork is approved.',
  tags: ['production'],
  archived: false,
  updatedBy: { id: CONVERSATION_IDS.staff, displayName: 'CS Lead ทดสอบ' },
  updatedAt: '2026-10-20T09:00:00+07:00',
};

export class SaveCannedResponseDto {
  @ApiProperty({ example: 'แจ้งระยะเวลาผลิต', minLength: 1, maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @ApiProperty({ example: CANNED_EXAMPLE.bodyTh, minLength: 1, maxLength: 5000 })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  bodyTh!: string;

  @ApiProperty({ example: CANNED_EXAMPLE.bodyEn, minLength: 1, maxLength: 5000 })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  bodyEn!: string;

  @ApiPropertyOptional({ type: [String], example: ['production'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @Matches(/^[a-z0-9_]{1,30}$/, { each: true })
  tags?: string[];
}

/** `q` (the page query's free text) searches the title and both texts. */
export class CannedListQuery extends PageQuery {
  @ApiPropertyOptional({ example: 'production' })
  @IsOptional()
  @Matches(/^[a-z0-9_]{1,30}$/)
  tag?: string;

  @ApiPropertyOptional({ example: false, description: 'Include archived ones' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  archived?: boolean;
}

// --- stats ---------------------------------------------------------------------------------------------------

export class ConversationStatsQuery {
  @ApiProperty({ example: '2026-10-01', description: 'First Bangkok day' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;

  @ApiProperty({ example: '2026-10-31', description: 'Last Bangkok day' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;
}

export class DurationStatsDto {
  @ApiProperty({ type: 'integer', example: 42, description: 'How many it was measured over' })
  count!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '35.0',
    description: 'Median minutes; null without data',
  })
  medianMinutes!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '180.0' })
  p90Minutes!: string | null;
}

export class FirstResponseStatsDto extends DurationStatsDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '92.86',
    description: '% answered by their due time (D-221)',
  })
  withinTargetPct!: string | null;
}

export class ConversationStatsDto {
  @ApiProperty({ format: 'date', example: '2026-10-01' })
  from!: string;

  @ApiProperty({ format: 'date', example: '2026-10-31' })
  to!: string;

  @ApiProperty({ type: 'integer', example: 51, description: 'Threads opened in the period' })
  opened!: number;

  @ApiProperty({ type: 'integer', example: 44, description: 'Threads closed in the period' })
  closed!: number;

  @ApiProperty({ type: FirstResponseStatsDto, description: 'First customer message → first answer' })
  firstResponse!: FirstResponseStatsDto;

  @ApiProperty({
    type: DurationStatsDto,
    description: 'Opened → closed, of the threads closed in the period',
  })
  resolution!: DurationStatsDto;

  @ApiProperty({
    type: 'integer',
    example: 2,
    description: 'Live threads past their first-response due time now',
  })
  overdueNow!: number;
}

export const STATS_EXAMPLE = {
  from: '2026-10-01',
  to: '2026-10-31',
  opened: 51,
  closed: 44,
  firstResponse: { count: 42, medianMinutes: '35.0', p90Minutes: '180.0', withinTargetPct: '92.86' },
  resolution: { count: 44, medianMinutes: '1440.0', p90Minutes: '4320.0' },
  overdueNow: 2,
};
