import { CursorQuery, PageQuery } from '@common/pagination/pagination.dto';
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

/** Chat with CS and the LINE official account (D-143, D-151; B4.6). */

export const CONVERSATION_STATUSES = ['open', 'pending', 'closed'] as const;
export const CONVERSATION_IDS = {
  conversation: '0192f3a0-7c1e-7d2a-9b1f-0000000f4001',
  message: '0192f3a0-7c1e-7d2a-9b1f-0000000f4002',
  customer: '0192f3a0-7c1e-7d2a-9b1f-0000000f4003',
  staff: '0192f3a0-7c1e-7d2a-9b1f-0000000f4004',
};

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
  @ApiProperty({ enum: ['line', 'web'], enumName: 'ConversationChannel', example: 'line' })
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
}

export const MESSAGE_EXAMPLE = {
  id: CONVERSATION_IDS.message,
  direction: 'inbound',
  kind: 'text',
  body: 'สอบถามสถานะคำสั่งซื้อค่ะ',
  sender: null,
  sentAt: '2026-10-20T10:00:00+07:00',
  readAt: null,
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
};
export const RICH_MENU_EXAMPLE = {
  key: 'member_2026',
  audience: 'member',
  providerMenuId: 'richmenu-0000000000000000000000000000fake',
  active: true,
};
