import { OptionalNoteDto } from '@common/dto/optional-note.dto';
import { NextActionDto } from '@common/next-actions/next-action.dto';
import { PageQuery } from '@common/pagination/pagination.dto';
import { EnumField, IntField, RefField, TextField } from '@modules/catalog/crud/dto-fields';
import { TargetPriceField } from '@modules/pricing/quotes/target-price';
import { SpecLineDto } from '@modules/quotes/line-summary.dto';
import { MONEY, POSTCODE, RATE } from '@modules/shipping/rates/customer-rates.dto';
import { MEASUREMENT_BASES } from '@modules/specs/dimension-conversion';
import { StyleVariantField } from '@modules/styles/style-variant-field';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { AttachedFileDto } from '@platform/files/files.dto';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { MAX_RFQ_FILES, MAX_RFQ_TIERS, RFQ_FIELD_TYPES } from './rfq-form';

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

export class RfqRoutedFromDto {
  @ApiProperty({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000c1001',
    description: '`calculationId` of `store.quotes.calculate`',
  })
  @IsUUID()
  calculationId!: string;
}

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

  @EnumField(MEASUREMENT_BASES, 'MeasurementBasis', {
    example: 'internal',
    optional: true,
    description:
      'Basis of length / width / height (D-182): internal, external, over_crease or product. Absent: internal ' +
      '(assumed, deprecated — becomes required)',
  })
  measurementBasis?: (typeof MEASUREMENT_BASES)[number];

  @ApiProperty({ type: [Number], example: [500, 1000, 3000], description: '1–10 quantity tiers' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RFQ_TIERS)
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
  @ArrayMaxSize(MAX_RFQ_FILES)
  @IsUUID('all', { each: true })
  fileIds?: string[];

  @IntField({
    example: 1,
    optional: true,
    min: 1,
    max: 32767,
    description:
      'The form version it was filled in (`store.rfqs.getForm`); refused (422) when the form changed since',
  })
  specSchemaVersion?: number;

  @ApiPropertyOptional({
    type: () => RfqRoutedFromDto,
    description: 'The calculation that routed this configuration to RFQ (D-102 unmet demand)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => RfqRoutedFromDto)
  routedFrom?: RfqRoutedFromDto;

  @TargetPriceField('Staff see it; a factory never does (D-190)')
  targetPricePerUnit?: string;

  @StyleVariantField()
  styleVariantCode?: string;
}

export class RfqStyleDto {
  @ApiProperty({ example: 'PK-TE-01-K7QD' })
  variantCode!: string;

  @ApiProperty({ example: 'PK-TE-01' })
  baseCode!: string;

  @ApiProperty({ example: 'กล่องฝาเสียบ' })
  nameTh!: string;

  @ApiProperty({ example: 'Tuck end box' })
  nameEn!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { tuck_top: 'reverse_tuck', tuck_bottom: 'crash_lock', hang: 'none', window: 'none' },
  })
  options!: Record<string, unknown>;
}

export class StaffSubmitRfqDto extends SubmitRfqDto {
  @RefField({ example: IDS.user, description: 'The customer the RFQ is for (CS on behalf)' })
  customerUserId!: string;
}

export class RfqMessageInputDto {
  @TextField({ example: 'Can the handles be flat? (fake)', max: 4000 })
  body!: string;
}

export class StoreRfqMessageInputDto extends RfqMessageInputDto {
  @ApiPropertyOptional({
    type: [String],
    example: [IDS.file],
    description: 'My uploaded files (purpose `artwork`), ≤ 10',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  fileIds?: string[];
}

export class StaffRfqMessageInputDto extends RfqMessageInputDto {
  @ApiPropertyOptional({
    type: [String],
    example: [IDS.file],
    description: 'Files I uploaded (purpose `artwork`), ≤ 10',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  fileIds?: string[];

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

/** The customer's decline: an optional note (shared shape). */
export const DeclineRfqDto = OptionalNoteDto;
export type DeclineRfqDto = OptionalNoteDto;

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
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: IDS.user,
    description: 'Staff member; null unassigns',
  })
  @ValidateIf((o: { userId: unknown }) => o.userId !== null)
  @IsUUID()
  userId!: string | null;
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

  @ApiPropertyOptional({ example: 'paper_bag' })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_]{0,59}$/)
  productTypeCode?: string;

  @ApiPropertyOptional({ enum: ['web', 'cs', 'line', 'b2b'], enumName: 'SalesChannel' })
  @IsOptional()
  @IsIn(['web', 'cs', 'line', 'b2b'])
  channel?: 'web' | 'cs' | 'line' | 'b2b';

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-01',
    description: 'Submitted on or after (Bangkok)',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  submittedFrom?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-31',
    description: 'Submitted on or before (Bangkok)',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  submittedTo?: string;

  @ApiPropertyOptional({ example: true, description: 'Only requests with a factory consultation still open' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  awaitingFactory?: boolean;
}

export class UnmetDemandReasonDto {
  @ApiProperty({ example: 'price_too_high' })
  code!: string;

  @ApiProperty({ example: 'ราคาสูงเกินไป' })
  nameTh!: string;

  @ApiProperty({ example: 'Price too high' })
  nameEn!: string;
}

export class RfqContactDto {
  @ApiProperty({ type: String, nullable: true, example: 'someone@example.test' })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '+66800000001' })
  phone!: string | null;
}

export class RfqQuoteDefaultsDto {
  @ApiProperty({
    format: 'date-time',
    example: '2026-10-16T10:00:00+07:00',
    description: 'Validity of a quotation sent now (`quotes.validity_days`, D-051)',
  })
  validUntil!: string;
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

  @ApiProperty({ type: [AttachedFileDto], description: 'Files attached to the message' })
  files!: AttachedFileDto[];

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

  @ApiProperty({ type: UserRefDto, description: 'Who asked the factory' })
  requestedBy!: UserRefDto;
}

export class RfqDesignRefDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000d101' })
  designId!: string;

  @ApiProperty({ type: 'integer', example: 3 })
  versionNo!: number;
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

  @ApiProperty({
    enum: MEASUREMENT_BASES,
    enumName: 'MeasurementBasis',
    example: 'internal',
    description: 'Basis of length / width / height (D-182)',
  })
  measurementBasis!: (typeof MEASUREMENT_BASES)[number];

  @ApiProperty({ type: [Number], example: [500, 1000, 3000] })
  quantities!: number[];

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-11-15' })
  targetDate!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '11.50',
    description:
      'The customer’s target per unit (THB incl. VAT, excl. shipping, D-247); never sent to a factory consultation (D-190)',
  })
  targetPricePerUnit!: string | null;

  @ApiProperty({
    type: () => RfqStyleDto,
    nullable: true,
    description: 'The style variant asked for (D-269)',
  })
  style!: RfqStyleDto | null;

  @ApiProperty({
    type: () => RfqDesignRefDto,
    nullable: true,
    description: 'D-277 the studio design version the RFQ was asked from',
  })
  design!: RfqDesignRefDto | null;

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

  @ApiProperty({ type: [AttachedFileDto], description: 'Files sent with the request (purpose `artwork`)' })
  files!: AttachedFileDto[];

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

  @ApiProperty({
    type: [NextActionDto],
    description: 'What the signed-in user may do on the RFQ now (U-B0.3)',
  })
  nextActions!: NextActionDto[];
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

  @ApiProperty({ type: String, nullable: true, example: 'CU-000042' })
  customerCode!: string | null;

  @ApiProperty({ type: RfqContactDto, description: 'How to reach the customer (staff only)' })
  contact!: RfqContactDto;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 8,
    description:
      'First-response target of the category in business hours (`rfq.sla_business_hours`); null while not set',
  })
  slaTargetHours!: number | null;

  @ApiProperty({ example: false, description: 'Routed here from an instant calculation (D-102)' })
  routedFromCalculator!: boolean;

  @ApiProperty({ type: [SpecLineDto], description: 'The specification rendered from the category form' })
  specLines!: SpecLineDto[];

  @ApiProperty({ type: RfqQuoteDefaultsDto })
  quoteDefaults!: RfqQuoteDefaultsDto;
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

  @ApiProperty({
    enum: MEASUREMENT_BASES,
    enumName: 'MeasurementBasis',
    example: 'internal',
    description: 'Basis of length / width / height (D-182)',
  })
  measurementBasis!: (typeof MEASUREMENT_BASES)[number];

  @ApiProperty({ type: [Number], example: [500, 1000, 3000] })
  quantities!: number[];

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-11-15' })
  targetDate!: string | null;

  @ApiProperty({
    type: () => RfqStyleDto,
    nullable: true,
    description: 'The style variant asked for (D-269)',
  })
  style!: RfqStyleDto | null;

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

// --- store: RFQ form (U-B0.1) -------------------------------------------------------------------------------

export class RfqFieldOptionDto {
  @ApiProperty({ example: 'kraft' })
  value!: string;

  @ApiProperty({ example: 'คราฟท์' })
  labelTh!: string;

  @ApiProperty({ example: 'Kraft' })
  labelEn!: string;
}

export class RfqFormFieldDto {
  @ApiProperty({ example: 'material', description: 'Key to send in `spec`' })
  key!: string;

  @ApiProperty({ enum: RFQ_FIELD_TYPES, enumName: 'RfqFieldType', example: 'select' })
  type!: (typeof RFQ_FIELD_TYPES)[number];

  @ApiProperty({ example: 'วัสดุ' })
  labelTh!: string;

  @ApiProperty({ example: 'Material' })
  labelEn!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  helpTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  helpEn!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Unit shown next to a number' })
  unit!: string | null;

  @ApiProperty({ example: true })
  required!: boolean;

  @ApiProperty({ type: Number, nullable: true, example: null })
  min!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: null })
  max!: number | null;

  @ApiProperty({ type: [RfqFieldOptionDto], description: '`select` / `multiselect` only' })
  options!: RfqFieldOptionDto[];
}

export class RfqFormDimensionsDto {
  @ApiProperty({ example: true, description: 'Ask for length × width (× height)' })
  asked!: boolean;

  @ApiProperty({ example: false })
  required!: boolean;

  @ApiProperty({ example: true, description: 'Ask for a height as well' })
  height!: boolean;
}

export class RfqFormQuantityDto {
  @ApiProperty({ type: 'integer', example: 1 })
  min!: number;

  @ApiProperty({ type: 'integer', example: 10, description: 'Quantities one request may ask prices for' })
  maxTiers!: number;
}

export class RfqFormFilesDto {
  @ApiProperty({ example: 'artwork', description: 'File purpose to presign the uploads with' })
  purpose!: string;

  @ApiProperty({ type: [String], example: ['application/pdf', 'image/png'] })
  accept!: string[];

  @ApiProperty({ type: 'integer', example: 2147483648 })
  maxBytes!: number;

  @ApiProperty({ type: 'integer', example: 20 })
  maxFiles!: number;
}

/** The form a customer fills in for a request for quote of one product type (D-100, D-043). */
export class StoreRfqFormDto {
  @ApiProperty({ example: 'paper_bag' })
  productTypeCode!: string;

  @ApiProperty({ example: 'ถุงกระดาษ' })
  nameTh!: string;

  @ApiProperty({ example: 'Paper bags' })
  nameEn!: string;

  @ApiProperty({
    type: 'integer',
    example: 1,
    description: 'Send it back as `specSchemaVersion`; a submit filled in an older form is refused',
  })
  specSchemaVersion!: number;

  @ApiProperty({ type: [RfqFormFieldDto] })
  fields!: RfqFormFieldDto[];

  @ApiProperty({ type: RfqFormDimensionsDto })
  dimensions!: RfqFormDimensionsDto;

  @ApiProperty({ type: RfqFormQuantityDto })
  quantity!: RfqFormQuantityDto;

  @ApiProperty({ type: RfqFormFilesDto })
  files!: RfqFormFilesDto;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: null,
    description: 'First-response target in business hours (`rfq.sla_business_hours`); null while not set',
  })
  slaTargetHours!: number | null;
}

export const RFQ_FORM_EXAMPLE: StoreRfqFormDto = {
  productTypeCode: 'paper_bag',
  nameTh: 'ถุงกระดาษ',
  nameEn: 'Paper bags',
  specSchemaVersion: 1,
  fields: [
    {
      key: 'material',
      type: 'select',
      labelTh: 'วัสดุ',
      labelEn: 'Material',
      helpTh: null,
      helpEn: null,
      unit: null,
      required: true,
      min: null,
      max: null,
      options: [{ value: 'kraft', labelTh: 'คราฟท์', labelEn: 'Kraft' }],
    },
  ],
  dimensions: { asked: true, required: false, height: true },
  quantity: { min: 1, maxTiers: 10 },
  files: { purpose: 'artwork', accept: ['application/pdf', 'image/png'], maxBytes: 2147483648, maxFiles: 20 },
  slaTargetHours: null,
};

// --- RFQ desk actions (U-B0.2) -----------------------------------------------------------------------

export const ACCEPTANCE_CHANNELS = ['phone', 'line', 'email', 'other'] as const;

export class RecordRfqAcceptanceDto {
  @ApiPropertyOptional({
    type: [Number],
    example: [1000],
    description: 'The quoted quantities the customer took; all when omitted',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RFQ_TIERS)
  @IsInt({ each: true })
  quantities?: number[];

  @EnumField(ACCEPTANCE_CHANNELS, 'RfqAcceptanceChannel', {
    example: 'phone',
    description: 'How the customer accepted',
  })
  via!: (typeof ACCEPTANCE_CHANNELS)[number];

  @ApiPropertyOptional({ example: 'ลูกค้ายืนยันทางโทรศัพท์ (fake)', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class CandidateFactoryDto {
  @ApiProperty({ format: 'uuid', example: IDS.factory })
  factoryId!: string;

  @ApiProperty({ example: 'F9001' })
  code!: string;

  @ApiProperty({ example: 'โรงพิมพ์ ทดสอบ' })
  name!: string;

  @ApiProperty({ enum: ['active', 'trial'], enumName: 'CandidateFactoryStatus', example: 'active' })
  status!: string;

  @ApiProperty({
    enum: ['A', 'B', 'C'],
    enumName: 'ParticipationTier',
    nullable: true,
    example: 'A',
    description: 'Participation tier in force for the category (D-043); null without one',
  })
  tier!: string | null;

  @ApiProperty({ example: true, description: 'The requested quantities fit its capability' })
  capable!: boolean;

  @ApiProperty({
    enum: ['quantity_below_minimum', 'quantity_above_maximum'],
    enumName: 'CandidateFactoryReason',
    nullable: true,
    example: null,
  })
  reason!: string | null;

  @ApiProperty({ example: false })
  alreadyConsulted!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '96.50',
    description: 'On-time shipping % of its latest monthly scorecard (D-155)',
  })
  onTimeShippingPct!: string | null;
}
