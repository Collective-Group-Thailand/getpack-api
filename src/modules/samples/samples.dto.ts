import { ApiStatusLabelAdminTh, ApiStatusLabelTh } from '@common/labels/status-label.decorators';
import { statusLabels } from '@common/labels/status-labels';
import { PageQuery } from '@common/pagination/pagination.dto';
import { DecimalField, EnumField, IntField, RefField, TextField } from '@modules/catalog/crud/dto-fields';
import { SERVICE_AMOUNT_BASES, UNIT_AMOUNT_PATTERN } from '@modules/pricing/quotes/service-amount';
import { MEASUREMENT_BASES } from '@modules/specs/dimension-conversion';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export const SAMPLE_KINDS = ['attached', 'standalone'] as const;
export const SAMPLE_STATUSES = [
  'requested',
  'quoted',
  'paid',
  'in_production',
  'shipped',
  'delivered',
  'approved',
  'changes_requested',
  'rejected',
  'cancelled',
  'expired',
] as const;
export const SAMPLE_PRINT = ['with_print', 'without_print'] as const;

const IDS = {
  sample: '0192f3a0-7c1e-7d2a-9b1f-00000000f101',
  order: '0192f3a0-7c1e-7d2a-9b1f-00000000f102',
  quote: '0192f3a0-7c1e-7d2a-9b1f-00000000f103',
  option: '0192f3a0-7c1e-7d2a-9b1f-00000000f104',
  item: '0192f3a0-7c1e-7d2a-9b1f-00000000f105',
  file: '0192f3a0-7c1e-7d2a-9b1f-00000000f106',
  job: '0192f3a0-7c1e-7d2a-9b1f-00000000f107',
  factory: '0192f3a0-7c1e-7d2a-9b1f-00000000f108',
};

// --- requests ------------------------------------------------------------------------------------------

class SamplePriceFields {
  @RefField({
    example: IDS.item,
    description: 'The service item whose sell table prices the amount (e.g. the mockup item, D-194)',
  })
  serviceItemId!: string;

  @EnumField(SERVICE_AMOUNT_BASES, 'ServiceAmountBasis', {
    example: 'buy_price_net',
    description:
      'What CS entered: the factory’s net buy price or the VAT-inclusive sell price (D-194, D-254); ' +
      '`buy_cost_net` is the deprecated spelling of `buy_price_net` (D-042)',
  })
  basis!: (typeof SERVICE_AMOUNT_BASES)[number];

  @ApiPropertyOptional({
    type: String,
    pattern: UNIT_AMOUNT_PATTERN.source,
    example: '800.00',
    description: 'The amount per unit (THB, money string). Required unless the deprecated `amount` is sent',
  })
  @IsOptional()
  @Matches(UNIT_AMOUNT_PATTERN)
  unitAmount?: string;

  @DecimalField({
    example: 800,
    positive: true,
    optional: true,
    deprecated: true,
    unit: 'THB',
    description: 'Deprecated: the same amount as a JSON number — send `unitAmount`',
  })
  amount?: number;
}

export class CreateAttachedSampleDto extends SamplePriceFields {
  @EnumField(SAMPLE_PRINT, 'MockupKind', { example: 'with_print' })
  mockupOption!: (typeof SAMPLE_PRINT)[number];

  @IntField({ example: 1, optional: true, min: 1, max: 100, description: 'Sets (default 1)' })
  quantity?: number;

  @TextField({ example: 'ลูกค้าขอตัวอย่างจริงก่อนผลิต 1 ชิ้น', max: 800 })
  reason!: string;

  @RefField({
    example: IDS.sample,
    optional: true,
    description: 'The earlier sample of this order the customer asked to change or rejected (D-253)',
  })
  previousSampleId?: string;
}

export class RequestSampleDto {
  @RefField({ example: IDS.quote, optional: true, description: 'One of my saved quotations (or `draftId`)' })
  quoteId?: string;

  @RefField({
    example: IDS.quote,
    optional: true,
    description: 'One of my draft configurations (or `quoteId`)',
  })
  draftId?: string;

  @EnumField(SAMPLE_PRINT, 'MockupKind', { example: 'with_print' })
  mockupOption!: (typeof SAMPLE_PRINT)[number];

  @IntField({ example: 1, optional: true, min: 1, max: 100, description: 'Sets (default 1)' })
  quantity?: number;

  @ApiPropertyOptional({ example: '10110', pattern: '^[0-9]{5}$', description: 'Default: the quotation’s' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{5}$/)
  deliveryPostcode?: string;

  @TextField({ example: 'อยากเห็นสีจริงก่อนสั่งผลิต', optional: true, max: 2000 })
  note?: string;
}

export class QuoteSampleDto extends SamplePriceFields {
  @IntField({ example: 7, min: 1, max: 120, description: 'Working days to make the sample' })
  leadTimeDays!: number;

  @IntField({ example: 800, min: 1, max: 100_000, description: 'Parcel weight (g) for the freight (D-195)' })
  parcelWeightG!: number;

  @RefField({
    example: IDS.factory,
    optional: true,
    description: 'The factory that makes it; default the factory of the customer’s quotation',
  })
  factoryId?: string;

  @ApiPropertyOptional({ example: '10110', pattern: '^[0-9]{5}$' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{5}$/)
  deliveryPostcode?: string;
}

export class SampleEvidenceDto {
  @DecimalField({ example: 300, positive: true, unit: 'mm' })
  lengthMm!: number;

  @DecimalField({ example: 200, positive: true, unit: 'mm' })
  widthMm!: number;

  @DecimalField({
    example: 50,
    positive: true,
    optional: true,
    unit: 'mm',
    description: 'Absent for a flat item',
  })
  depthMm?: number;

  @EnumField(MEASUREMENT_BASES, 'MeasurementBasis', { example: 'internal', description: 'D-182' })
  basis!: (typeof MEASUREMENT_BASES)[number];

  @TextField({ example: 'อาร์ตการ์ด 350 แกรม (fake)', max: 200, description: 'The material actually used' })
  materialUsed!: string;

  @ApiProperty({
    type: [String],
    example: [IDS.file],
    description: 'Clean photo uploads of the actor (at least one, D-255)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @IsUUID('all', { each: true })
  photoFileIds!: string[];
}

export class SampleDecisionDto {
  @TextField({
    example: 'สีเข้มไปเล็กน้อย',
    optional: true,
    max: 2000,
    description: 'Required to ask for changes or reject',
  })
  note?: string;
}

/** Cancelling a sample takes a reason (audited) — the shared `ReasonBodyDto`. */
export { ReasonBodyDto as CancelSampleDto } from '@modules/partners/factories/factories.dto';

export class OrderBulkDto {
  @IntField({ example: 3000, min: 1, max: 10_000_000, description: 'Bulk quantity' })
  quantity!: number;

  @ApiPropertyOptional({ example: '10110', pattern: '^[0-9]{5}$' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{5}$/)
  deliveryPostcode?: string;
}

export class SampleListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: SAMPLE_STATUSES, enumName: 'SampleStatus' })
  @IsOptional()
  @IsIn(SAMPLE_STATUSES)
  status?: (typeof SAMPLE_STATUSES)[number];

  @ApiPropertyOptional({ enum: SAMPLE_KINDS, enumName: 'SampleKind' })
  @IsOptional()
  @IsIn(SAMPLE_KINDS)
  kind?: (typeof SAMPLE_KINDS)[number];

  @ApiPropertyOptional({ format: 'uuid', description: 'Samples of this order' })
  @IsOptional()
  @IsUUID()
  orderId?: string;
}

// --- responses -----------------------------------------------------------------------------------------

export class SamplePhotoDto {
  @ApiProperty({ format: 'uuid', example: IDS.file })
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'a3f1…', description: 'Hex sha256 of the file' })
  sha256!: string | null;
}

export class SampleEvidenceViewDto {
  @ApiProperty({ type: String, nullable: true, example: '300.00' })
  lengthMm!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '200.00' })
  widthMm!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '50.00' })
  depthMm!: string | null;

  @ApiProperty({ enum: MEASUREMENT_BASES, enumName: 'MeasurementBasis', nullable: true, example: 'internal' })
  basis!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'อาร์ตการ์ด 350 แกรม (fake)' })
  materialUsed!: string | null;

  @ApiProperty({ type: [SamplePhotoDto] })
  photos!: SamplePhotoDto[];

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-08T15:00:00+07:00' })
  recordedAt!: string | null;
}

export class SampleDecisionViewDto {
  @ApiProperty({ type: String, format: 'date-time', example: '2026-10-11T10:00:00+07:00' })
  decidedAt!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({
    type: [String],
    example: ['a3f1…'],
    description: 'Hex sha256 of the evidence photos seen (D-255)',
  })
  evidencePhotoSha256!: string[];
}

export class SampleCreditDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'The bulk quotation',
  })
  bulkQuoteId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'The order credited',
  })
  creditOrderId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  creditAmount!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-11-10T10:00:00+07:00',
    description: 'A bulk order placed until this gets the credit (`samples.credit_window_days`, D-257)',
  })
  availableUntil!: string | null;
}

export class SampleQuotationRefDto {
  @ApiProperty({ format: 'uuid', example: IDS.quote })
  quoteId!: string;

  @ApiProperty({ format: 'uuid', example: IDS.option, description: 'Add this option to the cart' })
  optionId!: string;

  @ApiProperty({ example: 'saved' })
  status!: string;
}

export class SampleDto {
  @ApiProperty({ format: 'uuid', example: IDS.sample })
  id!: string;

  @ApiProperty({ enum: SAMPLE_KINDS, enumName: 'SampleKind', example: 'attached' })
  kind!: (typeof SAMPLE_KINDS)[number];

  @ApiProperty({ enum: SAMPLE_STATUSES, enumName: 'SampleStatus', example: 'delivered' })
  status!: (typeof SAMPLE_STATUSES)[number];

  @ApiStatusLabelTh('SampleStatus')
  statusLabelTh!: string;

  @ApiStatusLabelAdminTh('SampleStatus')
  statusLabelAdminTh!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-10T10:00:00+07:00' })
  statusChangedAt!: string;

  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { patternId: IDS.quote, quantities: [1000] },
  })
  configuration!: Record<string, unknown>;

  @ApiProperty({ enum: SAMPLE_PRINT, enumName: 'MockupKind', example: 'with_print' })
  mockupOption!: (typeof SAMPLE_PRINT)[number];

  @ApiProperty({ example: 1 })
  quantity!: number;

  @ApiProperty({ type: String, nullable: true, example: '10110' })
  deliveryPostcode!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  customerNote!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: IDS.order,
    description: 'Bulk order (attached) or sample order (standalone)',
  })
  orderId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'PK-2610-00012' })
  orderCode!: string | null;

  @ApiProperty({
    type: SampleQuotationRefDto,
    nullable: true,
    description: 'Standalone: the sample quotation to buy',
  })
  quotation!: SampleQuotationRefDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '800.00',
    description: 'Product price excl. VAT (freight apart)',
  })
  sellNetAmount!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '856.00', description: 'Product price incl. VAT' })
  sellGrossAmount!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 7 })
  leadTimeDays!: number | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  validUntil!: string | null;

  @ApiProperty({ type: SampleEvidenceViewDto })
  evidence!: SampleEvidenceViewDto;

  @ApiProperty({ type: SampleDecisionViewDto, nullable: true })
  decision!: SampleDecisionViewDto | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'The proof locked by the approval (D-255)',
  })
  approvedProofId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  previousSampleId!: string | null;

  @ApiProperty({ type: SampleCreditDto, nullable: true, description: 'Standalone samples only (D-257)' })
  credit!: SampleCreditDto | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  shippedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  deliveredAt!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T10:00:00+07:00' })
  createdAt!: string;
}

export class AdminSampleDto extends SampleDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '600.00',
    description: 'Factory buy amount (D-141 `factory_buy_prices.read`)',
  })
  buyNetAmount!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 800 })
  parcelWeightG!: number | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: IDS.job })
  productionJobId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', example: IDS.order, description: 'The customer' })
  customerId!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Fake Customer' })
  customerName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  decisionIp!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  decisionUserAgent!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  cancelReason!: string | null;
}

/** What a factory sees: what to make and its evidence — never the customer or a price (D-142, D-050). */
export class PartnerSampleDto {
  @ApiProperty({ format: 'uuid', example: IDS.sample })
  id!: string;

  @ApiProperty({ enum: SAMPLE_STATUSES, enumName: 'SampleStatus', example: 'in_production' })
  status!: (typeof SAMPLE_STATUSES)[number];

  @ApiStatusLabelTh('SampleStatus')
  statusLabelTh!: string;

  @ApiStatusLabelAdminTh('SampleStatus')
  statusLabelAdminTh!: string;

  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({ type: 'object', additionalProperties: true, example: { patternId: IDS.quote } })
  configuration!: Record<string, unknown>;

  @ApiProperty({ enum: SAMPLE_PRINT, enumName: 'MockupKind', example: 'with_print' })
  mockupOption!: (typeof SAMPLE_PRINT)[number];

  @ApiProperty({ example: 1 })
  quantity!: number;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: IDS.job })
  productionJobId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'JOB-2610-00007' })
  jobNo!: string | null;

  @ApiProperty({ type: SampleEvidenceViewDto })
  evidence!: SampleEvidenceViewDto;
}

export class OrderBulkResultDto {
  @ApiProperty({ format: 'uuid', example: IDS.quote })
  quoteId!: string;

  @ApiProperty({ format: 'uuid', example: IDS.order, description: 'The cart' })
  cartId!: string;

  @ApiProperty({
    example: true,
    description: 'The credit still applies to a checkout within the window (D-257)',
  })
  creditAvailable!: boolean;
}

const EVIDENCE_EXAMPLE: SampleEvidenceViewDto = {
  lengthMm: '300.00',
  widthMm: '200.00',
  depthMm: '50.00',
  basis: 'internal',
  materialUsed: 'อาร์ตการ์ด 350 แกรม (fake)',
  photos: [{ id: IDS.file, sha256: 'a3f1c9…' }],
  recordedAt: '2026-10-08T15:00:00+07:00',
};

export const SAMPLE_EXAMPLE: SampleDto = {
  id: IDS.sample,
  kind: 'attached',
  status: 'delivered',
  ...statusLabels('SampleStatus', 'delivered'),
  statusChangedAt: '2026-10-10T10:00:00+07:00',
  productTypeCode: 'folding_carton',
  configuration: { patternId: IDS.quote, quantities: [1000] },
  mockupOption: 'with_print',
  quantity: 1,
  deliveryPostcode: null,
  customerNote: null,
  orderId: IDS.order,
  orderCode: 'PK-2610-00012',
  quotation: null,
  sellNetAmount: '800.00',
  sellGrossAmount: '856.00',
  leadTimeDays: null,
  validUntil: null,
  evidence: EVIDENCE_EXAMPLE,
  decision: null,
  approvedProofId: null,
  previousSampleId: null,
  credit: null,
  shippedAt: '2026-10-09T09:00:00+07:00',
  deliveredAt: '2026-10-10T10:00:00+07:00',
  createdAt: '2026-10-03T10:00:00+07:00',
};

export const ADMIN_SAMPLE_EXAMPLE: AdminSampleDto = {
  ...SAMPLE_EXAMPLE,
  buyNetAmount: '600.00',
  parcelWeightG: null,
  productionJobId: IDS.job,
  customerId: IDS.order,
  customerName: 'Fake Customer',
  decisionIp: null,
  decisionUserAgent: null,
  cancelReason: null,
};

export const PARTNER_SAMPLE_EXAMPLE: PartnerSampleDto = {
  id: IDS.sample,
  status: 'in_production',
  ...statusLabels('SampleStatus', 'in_production'),
  productTypeCode: 'folding_carton',
  configuration: { patternId: IDS.quote },
  mockupOption: 'with_print',
  quantity: 1,
  productionJobId: IDS.job,
  jobNo: 'JOB-2610-00007',
  evidence: { ...EVIDENCE_EXAMPLE, recordedAt: null, photos: [] },
};
