import { IntField, RefField, TextField } from '@modules/catalog/crud/dto-fields';
import { ImportRowErrorDto, PREVIEW_SHA } from '@modules/catalog/imports/imports.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

/** Customer shipping rate card (D-013, schema-design §3.5): what Packio charges for delivery. */

export const VERSION_STATUSES = [
  'draft',
  'proposed',
  'approved',
  'rejected',
  'withdrawn',
  'pending_acceptance',
] as const;
export const RATE_MISS_REASONS = ['no_postcode', 'no_rate_card', 'zone_unknown', 'no_band'] as const;
export type RateMissReason = (typeof RATE_MISS_REASONS)[number];

export const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
export const RATE = /^\d{1,12}(\.\d{1,6})?$/;
export const POSTCODE = /^[0-9]{5}$/;
export const MAX_RATES = 5000;

export const SHIPPING_IDS = {
  card: '0192f3a0-7c1e-7d2a-9b1f-00000000d401',
  version: '0192f3a0-7c1e-7d2a-9b1f-00000000d402',
  zone: '0192f3a0-7c1e-7d2a-9b1f-00000000d403',
  approval: '0192f3a0-7c1e-7d2a-9b1f-00000000d404',
};

export class CustomerRateInputDto {
  @RefField({ example: SHIPPING_IDS.zone, description: 'Zone of the version’s scheme (`customer_default`)' })
  zoneId!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    pattern: POSTCODE.source,
    description: 'Postcode override inside the zone; null = the whole zone',
  })
  @IsOptional()
  @Matches(POSTCODE)
  postcode!: string | null;

  @IntField({ example: 0, min: 0, description: 'Weight from (inclusive). Unit: g.' })
  weightMinG!: number;

  @IntField({
    example: 5000,
    min: 1,
    nullable: true,
    description: 'Weight to (exclusive); null = open. Unit: g.',
  })
  weightMaxG!: number | null;

  @IntField({ example: null, min: 0, nullable: true, description: 'Volume from (inclusive). Unit: cm³.' })
  volumeMinCm3!: number | null;

  @IntField({
    example: null,
    min: 1,
    nullable: true,
    description: 'Volume to (exclusive); null bounds = any volume. Unit: cm³.',
  })
  volumeMaxCm3!: number | null;

  @ApiProperty({ example: '120.00', pattern: MONEY.source, description: 'Price, VAT-exclusive (THB)' })
  @IsString()
  @Matches(MONEY)
  priceAmount!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    pattern: RATE.source,
    description: 'Charged per started kg above `weightMinG`, VAT-exclusive (THB)',
  })
  @IsOptional()
  @IsString()
  @Matches(RATE)
  perExtraKg!: string | null;
}

export class CustomerRateDto extends CustomerRateInputDto {
  @ApiProperty({ example: 'bkk' })
  zoneCode!: string;
}

export class CreateCustomerRateVersionDto {
  @ApiProperty({
    format: 'date-time',
    example: '2026-10-15T00:00:00+07:00',
    description: 'Applies from this instant once approved; never before the approval (not back-dated)',
  })
  @IsDateString()
  effectiveFrom!: string;

  @TextField({ example: 'Q4 rates (fake)', max: 500 })
  reason!: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'Copy the rates of this version (copy-on-write); ignored when `rates` is given',
  })
  @IsOptional()
  @IsUUID()
  copyFromVersionId?: string | null;

  @ApiPropertyOptional({ type: [CustomerRateInputDto], description: `At most ${MAX_RATES} rates` })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RATES)
  @ValidateNested({ each: true })
  @Type(() => CustomerRateInputDto)
  rates?: CustomerRateInputDto[];
}

export class ReplaceCustomerRatesDto {
  @ApiProperty({ type: [CustomerRateInputDto], description: `The complete set, at most ${MAX_RATES}` })
  @IsArray()
  @ArrayMaxSize(MAX_RATES)
  @ValidateNested({ each: true })
  @Type(() => CustomerRateInputDto)
  rates!: CustomerRateInputDto[];
}

export class CustomerRateVersionSummaryDto {
  @ApiProperty({ format: 'uuid', example: SHIPPING_IDS.version })
  id!: string;

  @ApiProperty({ type: 'integer', example: 2 })
  versionNo!: number;

  @ApiProperty({ enum: VERSION_STATUSES, enumName: 'ConfigVersionStatus', example: 'approved' })
  status!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-15T00:00:00+07:00' })
  effectiveFrom!: string;

  @ApiProperty({ example: 'Q4 rates (fake)' })
  reason!: string;

  @ApiProperty({ example: 'customer_default', description: 'Zone scheme of every rate' })
  schemeCode!: string;

  @ApiProperty({ type: 'integer', example: 12 })
  rateCount!: number;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: SHIPPING_IDS.approval,
    description: 'Open or decided C-Level approval request',
  })
  approvalRequestId!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T09:00:00+07:00' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-02T10:00:00+07:00' })
  decidedAt!: string | null;
}

export class CustomerRateVersionDto extends CustomerRateVersionSummaryDto {
  @ApiProperty({ type: [CustomerRateDto] })
  rates!: CustomerRateDto[];
}

export class CustomerRateCardDto {
  @ApiProperty({ format: 'uuid', example: SHIPPING_IDS.card })
  id!: string;

  @ApiProperty({ example: 'default' })
  key!: string;

  @ApiProperty({ example: 'D-013 customer shipping rate card (zone/postcode × weight/volume)' })
  description!: string;

  @ApiProperty({
    type: CustomerRateVersionSummaryDto,
    nullable: true,
    description: 'The version in force now',
  })
  current!: CustomerRateVersionSummaryDto | null;

  @ApiProperty({
    type: CustomerRateVersionSummaryDto,
    nullable: true,
    description: 'The approved version scheduled next, if any',
  })
  scheduled!: CustomerRateVersionSummaryDto | null;

  @ApiProperty({ type: [CustomerRateVersionSummaryDto], description: 'Drafts and versions in approval' })
  open!: CustomerRateVersionSummaryDto[];
}

export class RateImportPreviewDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000f001' })
  fileId!: string;

  @ApiProperty({ example: PREVIEW_SHA, description: 'Send back to confirm exactly these rates' })
  previewSha256!: string;

  @ApiProperty({ type: 'integer', example: 12 })
  rows!: number;

  @ApiProperty({ type: 'integer', example: 0, description: 'Rows with at least one error' })
  invalid!: number;

  @ApiProperty({ example: true, description: 'At least one row and no errors' })
  canConfirm!: boolean;

  @ApiProperty({ type: [ImportRowErrorDto], description: 'First 200 row errors' })
  errors!: ImportRowErrorDto[];

  @ApiProperty({ example: false })
  errorsTruncated!: boolean;
}

export class ShippingRateQuoteRequestDto {
  @ApiProperty({ example: '10110', pattern: POSTCODE.source })
  @Matches(POSTCODE)
  postcode!: string;

  @ApiProperty({ type: 'integer', example: 3200, minimum: 0, description: 'Unit: g.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  weightG!: number;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: true,
    example: 48000,
    minimum: 0,
    description: 'Unit: cm³.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  volumeCm3?: number | null;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-10-20T10:00:00+07:00',
    description: 'Instant to resolve the card at; default now',
  })
  @IsOptional()
  @IsDateString()
  at?: string;
}

export class ShippingRateQuoteDto {
  @ApiProperty({ example: true })
  priced!: boolean;

  @ApiProperty({
    enum: RATE_MISS_REASONS,
    enumName: 'ShippingRateMissReason',
    nullable: true,
    example: null,
    description: 'Why no rate applies',
  })
  reason!: RateMissReason | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: SHIPPING_IDS.version })
  versionId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'bkk' })
  zoneCode!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '120.00', description: 'VAT-exclusive (THB)' })
  netAmount!: string | null;

  @ApiProperty({
    enum: ['THB'],
    enumName: 'Currency',
    example: 'THB',
    description: 'Always THB (one currency)',
  })
  currency!: 'THB';
}

// --- examples ---------------------------------------------------------------------------------------

export const RATE_INPUT_EXAMPLE: CustomerRateInputDto = {
  zoneId: SHIPPING_IDS.zone,
  postcode: null,
  weightMinG: 0,
  weightMaxG: 5000,
  volumeMinCm3: null,
  volumeMaxCm3: null,
  priceAmount: '120.00',
  perExtraKg: null,
};

export const VERSION_SUMMARY_EXAMPLE: CustomerRateVersionSummaryDto = {
  id: SHIPPING_IDS.version,
  versionNo: 2,
  status: 'approved',
  effectiveFrom: '2026-10-15T00:00:00+07:00',
  reason: 'Q4 rates (fake)',
  schemeCode: 'customer_default',
  rateCount: 1,
  approvalRequestId: SHIPPING_IDS.approval,
  createdAt: '2026-10-01T09:00:00+07:00',
  decidedAt: '2026-10-02T10:00:00+07:00',
};

export const VERSION_EXAMPLE: CustomerRateVersionDto = {
  ...VERSION_SUMMARY_EXAMPLE,
  rates: [{ ...RATE_INPUT_EXAMPLE, zoneCode: 'bkk' }],
};

export const DRAFT_EXAMPLE: CustomerRateVersionDto = {
  ...VERSION_EXAMPLE,
  status: 'draft',
  approvalRequestId: null,
  decidedAt: null,
};

export const CARD_EXAMPLE: CustomerRateCardDto = {
  id: SHIPPING_IDS.card,
  key: 'default',
  description: 'D-013 customer shipping rate card (zone/postcode × weight/volume)',
  current: VERSION_SUMMARY_EXAMPLE,
  scheduled: null,
  open: [],
};

export const PREVIEW_EXAMPLE: RateImportPreviewDto = {
  fileId: '0192f3a0-7c1e-7d2a-9b1f-00000000f001',
  previewSha256: PREVIEW_SHA,
  rows: 12,
  invalid: 0,
  canConfirm: true,
  errors: [],
  errorsTruncated: false,
};

export const RATE_QUOTE_EXAMPLE: ShippingRateQuoteDto = {
  priced: true,
  reason: null,
  versionId: SHIPPING_IDS.version,
  zoneCode: 'bkk',
  netAmount: '120.00',
  currency: 'THB',
};
