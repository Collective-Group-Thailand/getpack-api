import { PageQuery } from '@common/pagination/pagination.dto';
import { EnumField, IntField, RefField, TextField } from '@modules/catalog/crud/dto-fields';
import { MONEY, POSTCODE, RATE } from '@modules/shipping/rates/customer-rates.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Requests for quote (D-100, D-043, D-102, schema-design §3.5). */

export const RFQ_STATUSES = [
  'submitted',
  'in_review',
  'need_info',
  'quoted',
  'accepted',
  'declined',
  'expired',
] as const;
export const RFQ_QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'superseded', 'expired'] as const;
export const CONSULTATION_STATUSES = ['requested', 'responded', 'declined', 'expired'] as const;
export const MESSAGE_VISIBILITIES = ['customer', 'internal'] as const;

const IDS = {
  rfq: '0192f3a0-7c1e-7d2a-9b1f-00000000e701',
  quote: '0192f3a0-7c1e-7d2a-9b1f-00000000e702',
  message: '0192f3a0-7c1e-7d2a-9b1f-00000000e703',
  consultation: '0192f3a0-7c1e-7d2a-9b1f-00000000e704',
  factory: '0192f3a0-7c1e-7d2a-9b1f-00000000a201',
  file: '0192f3a0-7c1e-7d2a-9b1f-00000000f003',
  user: '0192f3a0-7c1e-7d2a-9b1f-00000000e705',
};
const SPEC_EXAMPLE = {
  material: 'kraft 150 gsm (fake)',
  handles: 'twisted paper',
  print: '1 colour one side',
};

// --- requests ------------------------------------------------------------------------------------

export class SubmitRfqDto {
  @ApiProperty({ example: 'paper_bag', pattern: '^[a-z][a-z0-9_]*$' })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/)
  productTypeCode!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: SPEC_EXAMPLE,
    description: 'Spec fields of the category, validated against its `rfqSpecSchema` (B2.1)',
  })
  @IsObject()
  spec!: Record<string, unknown>;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 250, description: 'Unit: mm.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99_999)
  lengthMm?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 120, description: 'Unit: mm.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99_999)
  widthMm?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 320, description: 'Unit: mm.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99_999)
  heightMm?: number | null;

  @ApiProperty({ type: [Number], example: [500, 1000, 3000], description: '1–10 quantity tiers' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(100_000_000, { each: true })
  quantities!: number[];

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true, example: '2026-11-15' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  targetDate?: string | null;

  @ApiProperty({ example: '10110', pattern: POSTCODE.source })
  @Matches(POSTCODE)
  deliveryPostcode!: string;

  @ApiPropertyOptional({ example: 'Logo on both sides (fake)', maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional({
    type: [String],
    example: [IDS.file],
    description: 'Uploaded files (purpose `artwork`)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  fileIds?: string[];
}

export class StaffSubmitRfqDto extends SubmitRfqDto {
  @RefField({ example: IDS.user, description: 'The customer the RFQ is for (CS on behalf)' })
  customerUserId!: string;
}

export class RfqMessageInputDto {
  @TextField({ example: 'Can the handles be flat? (fake)', max: 4000 })
  body!: string;
}

export class StaffRfqMessageInputDto extends RfqMessageInputDto {
  @EnumField(MESSAGE_VISIBILITIES, 'MessageVisibility', {
    example: 'customer',
    description: '`internal` is never shown to the customer',
  })
  visibility!: (typeof MESSAGE_VISIBILITIES)[number];
}

export class AcceptRfqQuoteDto {
  @RefField({ example: IDS.quote })
  rfqQuoteId!: string;

  @ApiPropertyOptional({
    type: [Number],
    example: [1000],
    description: 'Accept these tiers only; default all',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  quantities?: number[];
}

export class DeclineRfqDto {
  @ApiPropertyOptional({ example: 'Found another supplier (fake)', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class StaffDeclineRfqDto extends DeclineRfqDto {
  @ApiProperty({
    example: 'capability_missing',
    pattern: '^[a-z][a-z0-9_]*$',
    description: 'Unmet-demand reason code (D-102)',
  })
  @Matches(/^[a-z][a-z0-9_]*$/)
  reasonCode!: string;
}

export class AssignRfqDto {
  @RefField({ example: IDS.user, description: 'Staff member' })
  userId!: string;
}

export class RequestConsultationDto {
  @RefField({ example: IDS.factory })
  factoryId!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T17:00:00+07:00' })
  @IsDateString()
  dueAt!: string;

  @ApiPropertyOptional({ example: 'Please quote the three tiers (fake)', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class RfqQuoteLineInputDto {
  @IntField({ example: 1000, min: 1 })
  quantity!: number;

  @ApiProperty({ example: '12.500000', pattern: RATE.source, description: 'Per piece before VAT (THB)' })
  @IsString()
  @Matches(RATE)
  unitPrice!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '300.00',
    pattern: MONEY.source,
    description: 'Shipping before VAT',
  })
  @IsOptional()
  @IsString()
  @Matches(MONEY)
  shippingNetAmount?: string | null;

  @IntField({ example: 14, min: 0, max: 365 })
  leadTimeDays!: number;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, example: IDS.factory })
  @IsOptional()
  @IsUUID()
  factoryId?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '9.800000',
    pattern: RATE.source,
    description: 'Buy price per piece (staff only)',
  })
  @IsOptional()
  @IsString()
  @Matches(RATE)
  buyUnitPrice?: string | null;
}

export class DraftRfqQuoteDto {
  @ApiProperty({ type: [RfqQuoteLineInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RfqQuoteLineInputDto)
  lines!: RfqQuoteLineInputDto[];

  @ApiPropertyOptional({ example: 'Price includes delivery to Bangkok (fake)', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class ConsultationLineDto {
  @IntField({ example: 1000, min: 1 })
  quantity!: number;

  @ApiProperty({
    example: '9.800000',
    pattern: RATE.source,
    description: 'Buy price per piece before VAT (THB)',
  })
  @IsString()
  @Matches(RATE)
  buyUnitPrice!: string;

  @IntField({ example: 12, min: 0, max: 365 })
  leadTimeDays!: number;
}

export class RespondConsultationDto {
  @ApiProperty({ type: [ConsultationLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ConsultationLineDto)
  lines!: ConsultationLineDto[];

  @ApiPropertyOptional({ example: 'Price valid 30 days (fake)', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class DeclineConsultationDto {
  @ApiPropertyOptional({ example: 'Cannot make this material (fake)', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class RfqListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: RFQ_STATUSES, enumName: 'RfqStatus' })
  @IsOptional()
  @IsIn(RFQ_STATUSES)
  status?: (typeof RFQ_STATUSES)[number];
}

export class AdminRfqListQuery extends RfqListQuery {
  @ApiPropertyOptional({
    example: true,
    description: 'Only open requests past their first-response due time',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  overdue?: boolean;

  @ApiPropertyOptional({ format: 'uuid', description: 'Only requests assigned to this staff member' })
  @IsOptional()
  @IsUUID()
  assignedToId?: string;
}

export class ConsultationListQuery {
  @ApiPropertyOptional({ enum: CONSULTATION_STATUSES, enumName: 'ConsultationStatus' })
  @IsOptional()
  @IsIn(CONSULTATION_STATUSES)
  status?: (typeof CONSULTATION_STATUSES)[number];
}

// --- responses -----------------------------------------------------------------------------------

export class RfqMessageDto {
  @ApiProperty({ format: 'uuid', example: IDS.message })
  id!: string;

  @ApiProperty({ enum: ['customer', 'packio'], enumName: 'RfqMessageAuthor', example: 'packio' })
  author!: string;

  @ApiProperty({ example: 'Can the handles be flat? (fake)' })
  body!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T10:00:00+07:00' })
  createdAt!: string;
}

export class StaffRfqMessageDto extends RfqMessageDto {
  @ApiProperty({ enum: MESSAGE_VISIBILITIES, enumName: 'MessageVisibility', example: 'customer' })
  visibility!: string;

  @ApiProperty({ type: UserRefDto })
  authorUser!: UserRefDto;
}

export class RfqQuoteLineDto {
  @ApiProperty({ type: 'integer', example: 1000 })
  quantity!: number;

  @ApiProperty({ example: '12.500000', description: 'Per piece before VAT' })
  unitPrice!: string;

  @ApiProperty({ example: '12800.00', description: 'Pieces + shipping before VAT' })
  netAmount!: string;

  @ApiProperty({ example: '896.00' })
  vatAmount!: string;

  @ApiProperty({ example: '13696.00' })
  grossAmount!: string;

  @ApiProperty({ example: '300.00' })
  shippingNetAmount!: string;

  @ApiProperty({ type: 'integer', example: 14 })
  leadTimeDays!: number;
}

export class StaffRfqQuoteLineDto extends RfqQuoteLineDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: IDS.factory })
  factoryId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '9.800000',
    description: 'Needs `factory_cost.read` (D-141)',
  })
  buyUnitPrice!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '21.6000',
    description: 'Needs `margin.read` (D-141)',
  })
  marginPct!: string | null;

  @ApiProperty({ example: false, description: 'Below the margin floor (D-012)' })
  belowMarginFloor!: boolean;
}

export class RfqQuotationDto {
  @ApiProperty({ format: 'uuid', example: IDS.quote })
  id!: string;

  @ApiProperty({ type: 'integer', example: 1 })
  versionNo!: number;

  @ApiProperty({ enum: RFQ_QUOTE_STATUSES, enumName: 'RfqQuoteStatus', example: 'sent' })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-16T09:00:00+07:00' })
  validUntil!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-01T09:00:00+07:00' })
  sentAt!: string | null;

  @ApiProperty({ example: 'Price includes delivery to Bangkok (fake)' })
  note!: string;

  @ApiProperty({ type: [RfqQuoteLineDto] })
  lines!: RfqQuoteLineDto[];
}

export class StaffRfqQuotationDto extends RfqQuotationDto {
  @ApiProperty({ type: [StaffRfqQuoteLineDto] })
  override lines: StaffRfqQuoteLineDto[] = [];
}

export class RfqConsultationDto {
  @ApiProperty({ format: 'uuid', example: IDS.consultation })
  id!: string;

  @ApiProperty({ format: 'uuid', example: IDS.factory })
  factoryId!: string;

  @ApiProperty({ example: 'F9001' })
  factoryCode!: string;

  @ApiProperty({ enum: CONSULTATION_STATUSES, enumName: 'ConsultationStatus', example: 'responded' })
  status!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T17:00:00+07:00' })
  dueAt!: string;

  @ApiProperty({ example: 'Please quote the three tiers (fake)' })
  note!: string;

  @ApiProperty({
    type: [ConsultationLineDto],
    nullable: true,
    description: 'The factory’s buy prices; needs `factory_cost.read` (D-141)',
  })
  lines!: ConsultationLineDto[] | null;

  @ApiProperty({ type: String, nullable: true, example: 'Price valid 30 days (fake)' })
  responseNote!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-02T11:00:00+07:00' })
  respondedAt!: string | null;
}

export class RfqDto {
  @ApiProperty({ format: 'uuid', example: IDS.rfq })
  id!: string;

  @ApiProperty({ example: 'RFQ-2610-00001' })
  rfqCode!: string;

  @ApiProperty({ enum: RFQ_STATUSES, enumName: 'RfqStatus', example: 'quoted' })
  status!: string;

  @ApiProperty({ example: 'paper_bag' })
  productTypeCode!: string;

  @ApiProperty({ example: 'ถุงกระดาษ' })
  productTypeName!: string;

  @ApiProperty({ type: 'object', additionalProperties: true, example: SPEC_EXAMPLE })
  spec!: Record<string, unknown>;

  @ApiProperty({ type: Number, nullable: true, example: 250 })
  lengthMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 120 })
  widthMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 320 })
  heightMm!: number | null;

  @ApiProperty({ type: [Number], example: [500, 1000, 3000] })
  quantities!: number[];

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-11-15' })
  targetDate!: string | null;

  @ApiProperty({ example: '10110' })
  deliveryPostcode!: string;

  @ApiProperty({ example: 'Logo on both sides (fake)' })
  notes!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-02T09:00:00+07:00',
    description: 'First-response due time (null while no SLA is set)',
  })
  slaDueAt!: string | null;

  @ApiProperty({ type: [RfqMessageDto] })
  messages!: RfqMessageDto[];

  @ApiProperty({ type: [RfqQuotationDto], description: 'Quotations sent to the customer (never drafts)' })
  quotations!: RfqQuotationDto[];

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'The saved quotation after acceptance',
  })
  acceptedQuoteId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  declineReasonCode!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T09:00:00+07:00' })
  submittedAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  closedAt!: string | null;
}

export class StaffRfqDto extends RfqDto {
  @ApiProperty({ enum: ['web', 'cs', 'line', 'b2b'], enumName: 'SalesChannel', example: 'web' })
  channel!: string;

  @ApiProperty({ type: UserRefDto })
  customer!: UserRefDto;

  @ApiProperty({ type: UserRefDto, nullable: true })
  assignedTo!: UserRefDto | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-01T11:00:00+07:00' })
  firstResponseAt!: string | null;

  @ApiProperty({ example: false, description: 'Open and past its first-response due time' })
  overdue!: boolean;

  @ApiProperty({ type: [StaffRfqMessageDto] })
  override messages: StaffRfqMessageDto[] = [];

  @ApiProperty({ type: [StaffRfqQuotationDto], description: 'Every version, drafts included' })
  override quotations: StaffRfqQuotationDto[] = [];

  @ApiProperty({ type: [RfqConsultationDto] })
  consultations!: RfqConsultationDto[];
}

export class FactoryConsultationDto {
  @ApiProperty({ format: 'uuid', example: IDS.consultation })
  id!: string;

  @ApiProperty({ enum: CONSULTATION_STATUSES, enumName: 'ConsultationStatus', example: 'requested' })
  status!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T17:00:00+07:00' })
  dueAt!: string;

  @ApiProperty({ example: 'Please quote the three tiers (fake)' })
  note!: string;

  @ApiProperty({ example: 'RFQ-2610-00001' })
  rfqCode!: string;

  @ApiProperty({ example: 'paper_bag' })
  productTypeCode!: string;

  @ApiProperty({ example: 'ถุงกระดาษ' })
  productTypeName!: string;

  @ApiProperty({ type: 'object', additionalProperties: true, example: SPEC_EXAMPLE })
  spec!: Record<string, unknown>;

  @ApiProperty({ type: Number, nullable: true, example: 250 })
  lengthMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 120 })
  widthMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 320 })
  heightMm!: number | null;

  @ApiProperty({ type: [Number], example: [500, 1000, 3000] })
  quantities!: number[];

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-11-15' })
  targetDate!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'กรุงเทพมหานคร',
    description: 'Delivery province only (D-142)',
  })
  deliveryProvince!: string | null;

  @ApiProperty({ type: [ConsultationLineDto], nullable: true, description: 'The factory’s own answer' })
  lines!: ConsultationLineDto[] | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  respondedAt!: string | null;
}

export const UNMET_EXAMPLE = SPEC_EXAMPLE;
export const RFQ_IDS = IDS;
