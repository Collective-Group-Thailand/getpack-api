import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** The storefront's contact form and guided-help hand-off (D-221), opened as CS tickets on conversations. */

export const SUPPORT_TICKET_SOURCES = ['contact_form', 'handoff'] as const;
const TOPIC = /^[a-z][a-z0-9_]{0,39}$/;
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
  respondBy: '2026-10-21T10:00:00+07:00',
  lineUrl: 'https://line.me/R/oaMessage/%40getpack-fake/?CS-2610-00001',
  conversationId: null,
  createdAt: '2026-10-20T10:00:00+07:00',
};

export const CONVERSATION_TICKET_EXAMPLE: ConversationTicketDto = {
  ticketNo: 'CS-2610-00001',
  source: 'contact_form',
  topic: 'order_status',
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
