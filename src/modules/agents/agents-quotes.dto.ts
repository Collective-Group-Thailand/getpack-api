import { PageQuery } from '@common/pagination/pagination.dto';
import { IdField, TimestampField } from '@modules/catalog/crud/dto-fields';
import { CalculateQuoteDto } from '@modules/pricing/quotes/quote.dto';
import { QUOTE_EXAMPLE, SavedQuoteDto } from '@modules/quotes/quotes.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

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

export const DEAL_STATUSES = ['registered', 'won', 'lost', 'expired'] as const;
export const DEAL_SCOPES = ['quote', 'call_off_agreement'] as const;
export const DEAL_ORIGINS = ['automatic', 'requested'] as const;

/** D-468 (PLAN A-11): protection + rate lock of a deal — never a rate cut. */
export class AgentDealRegistrationDto {
  @IdField(P3_IDS.dealRegistration)
  id!: string;

  @ApiProperty({ enum: DEAL_STATUSES, enumName: 'AgentDealStatus', example: 'registered' })
  status!: string;

  @ApiProperty({ enum: DEAL_SCOPES, enumName: 'AgentDealScope', example: 'quote' })
  scope!: string;

  @ApiProperty({
    enum: DEAL_ORIGINS,
    enumName: 'AgentDealOrigin',
    example: 'automatic',
    description: '`automatic` a big quote or a call-off agreement · `requested` by me',
  })
  origin!: string;

  @TimestampField('2027-01-16T10:00:00+07:00')
  protectedUntil!: string;

  @ApiProperty({ example: '5.0000', description: 'My locked first-order rate, %' })
  lockedFirstRatePct!: string;

  @ApiProperty({ example: '3.0000', description: 'My locked repeat-order rate, %' })
  lockedRepeatRatePct!: string;

  @TimestampField('2026-10-18T10:00:00+07:00')
  registeredAt!: string;
}

export const DEAL_EXAMPLE: AgentDealRegistrationDto = {
  id: P3_IDS.dealRegistration,
  status: 'registered',
  scope: 'quote',
  origin: 'automatic',
  protectedUntil: '2027-01-16T10:00:00+07:00',
  lockedFirstRatePct: '5.0000',
  lockedRepeatRatePct: '3.0000',
  registeredAt: '2026-10-18T10:00:00+07:00',
};

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

  @ApiProperty({
    type: AgentDealRegistrationDto,
    nullable: true,
    description: 'The deal registration protecting this quotation (D-468), if any',
  })
  dealRegistration!: AgentDealRegistrationDto | null;

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
  dealRegistration: DEAL_EXAMPLE,
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

// --- discount requests (D-468 item 3) ---------------------------------------------------------------------------

export const DISCOUNT_REASON_VALUES = [
  'competitor_price',
  'budget',
  'volume',
  'strategic_account',
  'other',
] as const;
export const COMMITMENT_VALUES = ['one_off', 'call_off'] as const;
export const DISCOUNT_REQUEST_STATUSES = ['open', 'offered', 'accepted', 'rejected', 'closed'] as const;
export const DISCOUNT_OPTION_KINDS = ['standard', 'co_fund', 'spiff'] as const;
export const DISCOUNT_OPTION_STATUSES = ['offered', 'accepted', 'lapsed'] as const;
const PCT = /^\d{1,2}(\.\d{1,4})?$/;
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

/** Like-for-like spec of a competitor's offer (PLAYBOOK "like-for-like"). Every field optional. */
export class CompetitorSpecDto {
  @ApiPropertyOptional({ example: 'KA125/CA125', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  boardGrade?: string;

  @ApiPropertyOptional({ example: 'B', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  flute?: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 0, maximum: 2, example: 1, description: 'Printed sides' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2)
  printSides?: number;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    maximum: 12,
    example: 2,
    description: 'Colours per side',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(12)
  printColours?: number;

  @ApiPropertyOptional({ example: 'เคลือบด้าน', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  finish?: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, example: 5000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({ type: 'integer', minimum: 0, maximum: 365, example: 14 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  leadTimeDays?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  shippingIncluded?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  vatIncluded?: boolean;

  @ApiPropertyOptional({ example: '42500.00', pattern: MONEY.source, description: 'Their total price, THB' })
  @IsOptional()
  @Matches(MONEY)
  price?: string;

  @ApiPropertyOptional({ example: 'ไม่รวมการตรวจไฟล์และ proof', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class RequestAgentDiscountDto {
  @ApiPropertyOptional({
    format: 'uuid',
    example: P3_IDS.quoteOption,
    description: 'The quantity (quote option); default the largest',
  })
  @IsOptional()
  @IsUUID()
  quoteOptionId?: string;

  @ApiProperty({ example: '6.00', pattern: PCT.source, description: 'Discount asked, % of the price' })
  @Matches(PCT)
  requestedPct!: string;

  @ApiProperty({ enum: DISCOUNT_REASON_VALUES, enumName: 'AgentDiscountReason', example: 'competitor_price' })
  @IsIn(DISCOUNT_REASON_VALUES)
  reason!: (typeof DISCOUNT_REASON_VALUES)[number];

  @ApiPropertyOptional({ example: 'ลูกค้าได้ใบเสนอราคาจากเจ้าอื่นถูกกว่า', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reasonNote?: string;

  // give-get: what the customer gives in return (at least one) --------------------------------------------------

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    example: 8000,
    description: 'The quantity they would order',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantityChange?: number;

  @ApiPropertyOptional({ enum: COMMITMENT_VALUES, enumName: 'AgentCommitment', default: 'one_off' })
  @IsOptional()
  @IsIn(COMMITMENT_VALUES)
  commitment?: (typeof COMMITMENT_VALUES)[number];

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 2,
    maximum: 24,
    example: 6,
    description: 'With `call_off`',
  })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(24)
  commitmentMonths?: number;

  @ApiPropertyOptional({ example: '50.00', pattern: PCT.source, description: 'Deposit they would pay, %' })
  @IsOptional()
  @Matches(PCT)
  depositPct?: string;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    maximum: 60,
    example: 7,
    description: 'Cash within N days',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  cashWithinDays?: number;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: 90,
    example: 7,
    description: 'Days later delivery is fine',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  leadTimeFlexDays?: number;

  @ApiPropertyOptional({ example: 'ลดจาก 4 สีเป็น 2 สี', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  specChange?: string;

  // competitor evidence -----------------------------------------------------------------------------------------

  @ApiPropertyOptional({
    format: 'uuid',
    example: P3_IDS.file,
    description: 'Their quotation, uploaded with `store.files.presign` (purpose `evidence`)',
  })
  @IsOptional()
  @IsUUID()
  competitorFileId?: string;

  @ApiPropertyOptional({ type: CompetitorSpecDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CompetitorSpecDto)
  competitorSpec?: CompetitorSpecDto;
}

export class AgentDiscountOptionDto {
  @IdField(P3_IDS.discountOption)
  id!: string;

  @ApiProperty({ type: 'integer', example: 1 })
  position!: number;

  @ApiProperty({
    enum: DISCOUNT_OPTION_KINDS,
    enumName: 'AgentDiscountOptionKind',
    example: 'standard',
    description:
      '`standard` my full rate (always first) · `co_fund` a lower rate I may accept to give a bigger discount · ' +
      '`spiff` a higher rate',
  })
  kind!: string;

  @ApiProperty({ enum: DISCOUNT_OPTION_STATUSES, enumName: 'AgentDiscountOptionStatus', example: 'offered' })
  status!: string;

  @ApiProperty({ example: '6.0000', description: 'The customer’s discount, %' })
  discountPct!: string;

  @ApiProperty({ example: '940000.00', description: 'Price before VAT, excl. shipping, after the discount' })
  netAmount!: string;

  @ApiProperty({ example: '6.0000', description: 'My commission rate with this option' })
  ratePct!: string;

  @ApiProperty({ example: '6.0000', description: 'My standard rate' })
  standardRatePct!: string;

  @ApiProperty({ example: '56400.00', description: 'My commission at this price' })
  commissionAmount!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'ราคานี้สำหรับ 8,000 ชิ้น · มัดจำ 50% · สั่งภายใน 25/10/2569',
  })
  conditionsTh!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'This price is for 8,000 pieces · a 50% deposit · order by 2026-10-25',
  })
  conditionsEn!: string | null;

  @TimestampField('2026-10-25T23:59:00+07:00')
  validUntil!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  acceptedAt!: string | null;
}

export class AgentDiscountFileDto {
  @ApiProperty({ format: 'uuid', example: P3_IDS.file })
  id!: string;

  @ApiProperty({ example: 'quotation-other.pdf' })
  fileName!: string;
}

export class AgentDiscountRequestDto {
  @IdField(P3_IDS.discountRequest)
  id!: string;

  @ApiProperty({ type: 'integer', example: 1, description: 'Negotiation round on this quotation' })
  round!: number;

  @ApiProperty({
    enum: DISCOUNT_REQUEST_STATUSES,
    enumName: 'AgentDiscountRequestStatus',
    example: 'offered',
    description:
      '`open` waiting for getpack · `offered` choose an option · `accepted` · `rejected` · `closed`',
  })
  status!: string;

  @ApiProperty({ format: 'uuid', example: P3_IDS.quoteOption })
  quoteOptionId!: string;

  @ApiProperty({ type: 'integer', example: 5000 })
  quantity!: number;

  @ApiProperty({ example: '6.0000' })
  requestedPct!: string;

  @ApiProperty({ enum: DISCOUNT_REASON_VALUES, enumName: 'AgentDiscountReason', example: 'competitor_price' })
  reason!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  reasonNote!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 8000 })
  quantityChange!: number | null;

  @ApiProperty({ enum: COMMITMENT_VALUES, enumName: 'AgentCommitment', example: 'one_off' })
  commitment!: string;

  @ApiProperty({ type: 'integer', nullable: true, example: null })
  commitmentMonths!: number | null;

  @ApiProperty({ type: String, nullable: true, example: '50.0000' })
  depositPct!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, example: null })
  cashWithinDays!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: null })
  leadTimeFlexDays!: number | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  specChange!: string | null;

  @ApiProperty({ type: AgentDiscountFileDto, nullable: true })
  competitorFile!: AgentDiscountFileDto | null;

  @ApiProperty({ type: CompetitorSpecDto, nullable: true })
  competitorSpec!: CompetitorSpecDto | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'getpack’s note with the answer' })
  decisionNote!: string | null;

  @TimestampField('2026-10-18T15:00:00+07:00')
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-18T17:00:00+07:00' })
  decidedAt!: string | null;

  @ApiProperty({
    type: [AgentDiscountOptionDto],
    description: '1–3 options once offered; the standard one first',
  })
  options!: AgentDiscountOptionDto[];
}

export const DISCOUNT_OPTION_EXAMPLE: AgentDiscountOptionDto = {
  id: P3_IDS.discountOption,
  position: 1,
  kind: 'standard',
  status: 'offered',
  discountPct: '6.0000',
  netAmount: '940000.00',
  ratePct: '6.0000',
  standardRatePct: '6.0000',
  commissionAmount: '56400.00',
  conditionsTh: 'ราคานี้สำหรับ 8,000 ชิ้น · มัดจำ 50% · สั่งภายใน 25/10/2569',
  conditionsEn: 'This price is for 8,000 pieces · a 50% deposit · order by 2026-10-25',
  validUntil: '2026-10-25T17:00:00+07:00',
  acceptedAt: null,
};

export const DISCOUNT_REQUEST_EXAMPLE: AgentDiscountRequestDto = {
  id: P3_IDS.discountRequest,
  round: 1,
  status: 'offered',
  quoteOptionId: P3_IDS.quoteOption,
  quantity: 5000,
  requestedPct: '6.0000',
  reason: 'competitor_price',
  reasonNote: null,
  quantityChange: 8000,
  commitment: 'one_off',
  commitmentMonths: null,
  depositPct: '50.0000',
  cashWithinDays: null,
  leadTimeFlexDays: null,
  specChange: null,
  competitorFile: { id: P3_IDS.file, fileName: 'quotation-other.pdf' },
  competitorSpec: {
    boardGrade: 'KA125/CA125',
    flute: 'B',
    quantity: 5000,
    vatIncluded: true,
    price: '42500.00',
  },
  decisionNote: null,
  createdAt: '2026-10-18T15:00:00+07:00',
  decidedAt: '2026-10-18T17:00:00+07:00',
  options: [DISCOUNT_OPTION_EXAMPLE],
};
