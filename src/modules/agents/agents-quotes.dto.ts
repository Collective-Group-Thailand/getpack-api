import { PageQuery } from '@common/pagination/pagination.dto';
import { IdField, TimestampField } from '@modules/catalog/crud/dto-fields';
import { CalculateQuoteDto } from '@modules/pricing/quotes/quote.dto';
import { QUOTE_EXAMPLE, SavedQuoteDto } from '@modules/quotes/quotes.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { AGENT_IDS } from './agents.dto';
import { P3_IDS } from './agents-pipeline.dto';

/** D-468 item 2: quotes an agent sends on behalf of getpack. Sell prices and the quote document only. */

export const AGENT_QUOTE_STATUSES = ['sent', 'opened', 'accepted', 'expired', 'withdrawn'] as const;

export class CreateAgentQuoteDto extends CalculateQuoteDto {
  @ApiProperty({ format: 'uuid', example: AGENT_IDS.lead, description: 'One of my leads (open)' })
  @IsUUID()
  leadId!: string;
}

export class AgentQuoteListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  leadId?: string;

  @ApiPropertyOptional({ enum: AGENT_QUOTE_STATUSES, enumName: 'AgentQuoteStatus' })
  @IsOptional()
  @IsIn(AGENT_QUOTE_STATUSES)
  status?: (typeof AGENT_QUOTE_STATUSES)[number];
}

export class WithdrawAgentQuoteDto {
  @ApiPropertyOptional({ example: 'ลูกค้าขอเปลี่ยนขนาด จะส่งใบใหม่', maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class AgentQuoteLeadRefDto {
  @ApiProperty({ format: 'uuid', example: AGENT_IDS.lead })
  id!: string;

  @ApiProperty({ example: 'คุณมานี ใจดี' })
  contactName!: string;

  @ApiProperty({ type: String, nullable: true, example: 'ร้านกาแฟบ้านสวน' })
  organisationName!: string | null;
}

export class AgentQuoteDto {
  @IdField(P3_IDS.agentQuote)
  id!: string;

  @ApiProperty({ type: AgentQuoteLeadRefDto })
  lead!: AgentQuoteLeadRefDto;

  @ApiProperty({
    enum: AGENT_QUOTE_STATUSES,
    enumName: 'AgentQuoteStatus',
    example: 'opened',
    description:
      '`sent` · `opened` the customer opened the link · `accepted` put in a cart · `expired` past its validity · ' +
      '`withdrawn` by me',
  })
  status!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://www.getpack.co/q/bX2kQ9…',
    description: 'The link to send (LINE, share sheet, copy); null once withdrawn, expired or accepted',
  })
  shareUrl!: string | null;

  @TimestampField('2026-10-18T10:00:00+07:00')
  sentAt!: string;

  @ApiProperty({ type: 'integer', example: 1 })
  sendCount!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-18T13:20:00+07:00' })
  openedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  acceptedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  withdrawnAt!: string | null;

  @ApiProperty({ type: SavedQuoteDto, description: 'The quotation the customer sees (sell prices only)' })
  quote!: SavedQuoteDto;
}

export const AGENT_QUOTE_EXAMPLE: AgentQuoteDto = {
  id: P3_IDS.agentQuote,
  lead: { id: AGENT_IDS.lead, contactName: 'คุณมานี ใจดี', organisationName: 'ร้านกาแฟบ้านสวน' },
  status: 'opened',
  shareUrl: 'https://www.getpack.co/q/bX2kQ9',
  sentAt: '2026-10-18T10:00:00+07:00',
  sendCount: 1,
  openedAt: '2026-10-18T13:20:00+07:00',
  acceptedAt: null,
  withdrawnAt: null,
  quote: { ...QUOTE_EXAMPLE, status: 'shared', quoteCode: 'QT-2026-000042' },
};

/** `store.quotes.getShared` + the agent who sent it (D-468): the web keeps the code like `/a/{code}`. */
export class SharedQuoteDto extends SavedQuoteDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'K7QX2MAP',
    description:
      'The code of the agent who sent this quotation (set the agent cookie as `/a/{code}` does); else null',
  })
  agentCode!: string | null;
}
