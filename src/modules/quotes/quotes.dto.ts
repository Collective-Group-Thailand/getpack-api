import { PageQuery } from '@common/pagination/pagination.dto';
import { RefField } from '@modules/catalog/crud/dto-fields';
import {
  ADMIN_CALCULATION_EXAMPLE,
  CalculateQuoteDto,
  CONFIGURATION_EXAMPLE,
  FoldingConfigurationDto,
  QuoteInternalDto,
  STORE_CALCULATION_EXAMPLE,
  ToolingWaiverDto,
} from '@modules/pricing/quotes/quote.dto';
import { TargetGapDto } from '@modules/pricing/quotes/target-price';
import { RATE_MISS_REASONS } from '@modules/shipping/rates/customer-rates.dto';
import { QuoteDimensionsDto } from '@modules/specs/specs.dto';
import { ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { QuoteOutcomeDto } from './levers/levers.dto';
import { LINE_SUMMARY_EXAMPLE, LineSummaryDto } from './line-summary.dto';

/** Saved quotations (D-051, schema-design §3.5). */

export const QUOTE_STATUSES = [
  'calculated',
  'saved',
  'shared',
  'converted',
  'expired',
  'superseded',
  'declined',
  'routed_to_rfq',
] as const;
export const QUOTE_SOURCES = ['instant', 'rfq'] as const;
export const PDF_STATUSES = ['none', 'pending', 'ready'] as const;

const IDS = {
  quote: '0192f3a0-7c1e-7d2a-9b1f-00000000e601',
  option: '0192f3a0-7c1e-7d2a-9b1f-00000000e602',
  customer: '0192f3a0-7c1e-7d2a-9b1f-00000000e603',
  anonymous: '0192f3a0-7c1e-7d2a-9b1f-00000000e604',
};

export class SaveQuoteDto extends CalculateQuoteDto {
  @ApiPropertyOptional({
    format: 'uuid',
    example: IDS.anonymous,
    description: 'Configurator session id when not signed in; claim the quote after login',
  })
  @IsOptional()
  @IsUUID()
  anonymousId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000ad101',
    description:
      'The Structure Advisor recommendation this quotation follows (D-240): the board chosen on it must be the ' +
      'configuration’s board; stored on the quotation',
  })
  @IsOptional()
  @IsUUID()
  advisoryRecommendationId?: string;
}

export class StaffSaveQuoteDto extends CalculateQuoteDto {
  @ApiPropertyOptional({
    format: 'uuid',
    example: IDS.customer,
    description: 'The customer the quote is for',
  })
  @IsOptional()
  @IsUUID()
  customerUserId?: string;

  @ApiPropertyOptional({
    example: 'ลูกค้าขอเทียบกับราคาเดิม',
    maxLength: 1000,
    description: 'Internal note of CS; never shown to the customer or on the PDF',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class QuoteRfqRefDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000ca010' })
  id!: string;

  @ApiProperty({ example: 'RFQ-2610-0001' })
  rfqCode!: string;
}

export class ClaimQuoteDto {
  @RefField({ example: IDS.anonymous, description: 'The configurator session that saved the quote' })
  anonymousId!: string;
}

export class QuoteListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: QUOTE_STATUSES, enumName: 'QuoteStatus' })
  @IsOptional()
  @IsIn(QUOTE_STATUSES)
  status?: (typeof QUOTE_STATUSES)[number];
}

export class SavedQuoteOptionDto {
  @ApiProperty({ format: 'uuid', example: IDS.option })
  id!: string;

  @ApiProperty({ type: 'integer', example: 1000 })
  quantity!: number;

  @ApiProperty({ example: '13.38', description: 'Per piece incl. VAT, excluding shipping' })
  unitPrice!: string;

  @ApiProperty({ example: '13380.00', description: 'Pieces incl. VAT' })
  productAmount!: string;

  @ApiProperty({ example: '0.00' })
  designFeeAmount!: string;

  @ApiProperty({ example: '0.00' })
  structureDesignFeeAmount!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '1200.00',
    description:
      'Plates and die blocks included in `productAmount` (one-off charges, incl. VAT); null when the calculator does not split them out or for RFQ quotes',
  })
  toolingAmount!: string | null;

  @ApiProperty({
    type: ToolingWaiverDto,
    nullable: true,
    description:
      'A reorder reusing the tooling the factory keeps: what is not charged again (D-289); null otherwise',
  })
  toolingWaiver!: ToolingWaiverDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '128.40',
    description: 'Shipping incl. VAT; null while not priced',
  })
  shippingAmount!: string | null;

  @ApiProperty({ example: '883.73', description: 'VAT included in the total' })
  vatAmount!: string;

  @ApiProperty({ example: '12624.67', description: 'Total before VAT' })
  netAmount!: string;

  @ApiProperty({ example: '13508.40', description: 'Total incl. VAT' })
  grossAmount!: string;

  @ApiProperty({ type: 'integer', nullable: true, example: 7 })
  leadTimeDays!: number | null;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-10-09' })
  earliestShipDate!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-10-10' })
  earliestDeliveryDate!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '5.0000',
    description: 'Frozen tolerance, shortage % (D-021)',
  })
  toleranceShortagePct!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '5.0000',
    description: 'Frozen tolerance, overage % (D-021)',
  })
  toleranceOveragePct!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '1.00',
    description: 'Frozen dimensional tolerance ± mm (D-186); null = none published for the product',
  })
  toleranceDimensionalMm!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '3.00',
    description: 'Frozen colour tolerance, ΔE2000 against the approved proof (D-186); null = not printed',
  })
  toleranceColourDeltaE!: string | null;

  @ApiProperty({ example: false })
  shippingPending!: boolean;

  @ApiProperty({ nullable: true, example: null, enum: RATE_MISS_REASONS, enumName: 'ShippingRateMissReason' })
  shippingPendingReason!: string | null;

  @ApiProperty({
    type: TargetGapDto,
    nullable: true,
    example: { gapPerUnit: '1.88', gapPct: '16.35', meetsTarget: false },
    description: 'This quantity against the quotation’s target (D-247); null without a target',
  })
  targetGap!: TargetGapDto | null;
}

export class AdminSavedQuoteOptionDto extends SavedQuoteOptionDto {
  @ApiProperty({
    type: QuoteInternalDto,
    nullable: true,
    description: 'Staff view; buy prices and margins per D-141',
  })
  internal!: QuoteInternalDto | null;
}

export class QuotePdfDto {
  @ApiProperty({ enum: PDF_STATUSES, enumName: 'QuotePdfStatus', example: 'ready' })
  status!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://packio-files.s3.example.com/…&X-Amz-Expires=300',
  })
  url!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-01T10:05:00+07:00' })
  expiresAt!: string | null;
}

export class QuoteAdvisoryDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000ad101' })
  recommendationId!: string;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000ad105' })
  choiceId!: string;
}

export class QuoteFromLeverDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000e701' })
  leverId!: string;

  @ApiProperty({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-00000000e600',
    description: 'The quotation it revised',
  })
  quoteId!: string;
}

export class SavedQuoteDto {
  @ApiProperty({ format: 'uuid', example: IDS.quote })
  id!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'QT-2026-000042',
    description: 'Issued at share or PDF',
  })
  quoteCode!: string | null;

  @ApiProperty({ enum: QUOTE_STATUSES, enumName: 'QuoteStatus', example: 'saved' })
  status!: string;

  @ApiProperty({
    enum: QUOTE_SOURCES,
    enumName: 'QuoteMode',
    example: 'instant',
    description: '`instant` (calculator) or `rfq` (manual quotation of a request for quote)',
  })
  source!: string;

  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({
    type: LineSummaryDto,
    description:
      'Product, product type, sales unit and spec lines to display (frozen when the quote was made)',
  })
  summary!: LineSummaryDto;

  @ApiProperty({
    anyOf: [
      { $ref: getSchemaPath(FoldingConfigurationDto) },
      { $ref: getSchemaPath('CorrugateConfigurationDto') },
      { $ref: getSchemaPath('LabelConfigurationDto') },
      { $ref: getSchemaPath('TagSleeveConfigurationDto') },
      { $ref: getSchemaPath('PouchConfigurationDto') },
      { $ref: getSchemaPath('StandardProductConfigurationDto') },
      { $ref: getSchemaPath('ServiceConfigurationDto') },
    ],
    nullable: true,
    description: "The configuration of the product type's calculator; null for RFQ quotes",
  })
  configuration!: Record<string, unknown> | null;

  @ApiProperty({ type: String, nullable: true, example: '10110' })
  deliveryPostcode!: string | null;

  @ApiProperty({
    format: 'date-time',
    example: '2026-10-16T09:00:00+07:00',
    description: 'Price lock ends (D-051)',
  })
  validUntil!: string;

  @ApiProperty({ example: true, description: 'Saved or shared and still within its validity' })
  priceLocked!: boolean;

  @ApiProperty({ type: [SavedQuoteOptionDto] })
  options!: SavedQuoteOptionDto[];

  @ApiProperty({ enum: PDF_STATUSES, enumName: 'QuotePdfStatus', example: 'none' })
  pdfStatus!: string;

  @ApiProperty({
    enum: ['THB'],
    enumName: 'Currency',
    example: 'THB',
    description: 'Always THB (one currency)',
  })
  currency!: 'THB';

  @ApiProperty({
    type: QuoteDimensionsDto,
    nullable: true,
    example: null,
    description:
      'The sizes frozen with the quote (D-182); null before measurement bases or for a product without a size',
  })
  dimensions!: QuoteDimensionsDto | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  sharedAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'The share link stops resolving after this (D-185)',
  })
  shareExpiresAt!: string | null;

  @ApiProperty({
    type: QuoteAdvisoryDto,
    nullable: true,
    description: 'The Structure Advisor recommendation and choice it was saved from (D-240)',
  })
  advisory!: QuoteAdvisoryDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '11.50',
    description:
      'The customer’s target per unit (THB incl. VAT, excl. shipping, D-247); never shown to a factory',
  })
  targetPricePerUnit!: string | null;

  @ApiProperty({
    type: QuoteOutcomeDto,
    nullable: true,
    example: null,
    description: 'How the quotation ended (D-250); null while it is open',
  })
  outcome!: QuoteOutcomeDto | null;

  @ApiProperty({
    type: QuoteFromLeverDto,
    nullable: true,
    example: null,
    description: 'The lever of an earlier quotation this one was saved from (D-249)',
  })
  fromLever!: QuoteFromLeverDto | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: null,
    description:
      'The style variant’s dieline quantities at the size priced — blank, cut / crease / perforation / glue lengths, ' +
      'cut-out area, pieces — frozen with the engine version; no price effect until signed (D-267)',
  })
  dielineQuantities!: Record<string, unknown> | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T09:00:00+07:00' })
  createdAt!: string;
}

export class AdminSavedQuoteDto extends SavedQuoteDto {
  @ApiProperty({ enum: ['web', 'cs', 'line', 'b2b'], enumName: 'SalesChannel', example: 'web' })
  channel!: string;

  @ApiProperty({ type: UserRefDto, nullable: true })
  customer!: UserRefDto | null;

  @ApiProperty({ type: UserRefDto, nullable: true, description: 'CS member who saved it' })
  createdBy!: UserRefDto | null;

  @ApiProperty({ type: String, nullable: true, example: 'CU-000042' })
  customerCode!: string | null;

  @ApiProperty({ type: QuoteRfqRefDto, nullable: true, description: 'The RFQ it answers (source `rfq`)' })
  rfq!: QuoteRfqRefDto | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'CS’s internal note' })
  note!: string | null;

  @ApiProperty({ type: [AdminSavedQuoteOptionDto] })
  override options: AdminSavedQuoteOptionDto[] = [];
}

export class ShareQuoteResultDto {
  @ApiProperty({ type: SavedQuoteDto })
  quote!: SavedQuoteDto;

  @ApiProperty({ example: 'bX2k…', description: 'Shown once; sharing again revokes the previous link' })
  shareToken!: string;

  @ApiProperty({ example: '/v1/store/quotes/shared/bX2k…' })
  sharePath!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-10-17T10:00:00+07:00',
    description: 'The link stops resolving after this (D-185)',
  })
  expiresAt!: string;
}

// --- examples ---------------------------------------------------------------------------------------

const {
  internal: _internal,
  instant: _instant,
  reason: _reason,
  ...step
} = ADMIN_CALCULATION_EXAMPLE.steps[0]!;
void STORE_CALCULATION_EXAMPLE;

export const OPTION_EXAMPLE: SavedQuoteOptionDto = {
  id: IDS.option,
  quantity: step.quantity,
  unitPrice: step.unitPrice!,
  productAmount: step.productAmount!,
  designFeeAmount: step.designFeeAmount!,
  structureDesignFeeAmount: step.structureDesignFeeAmount!,
  toolingAmount: step.toolingAmount,
  toolingWaiver: null,
  shippingAmount: step.shippingAmount,
  vatAmount: step.vatAmount!,
  netAmount: '12624.67',
  grossAmount: step.grossAmount!,
  leadTimeDays: step.leadTimeDays,
  earliestShipDate: step.earliestShipDate,
  earliestDeliveryDate: step.earliestDeliveryDate,
  toleranceShortagePct: step.toleranceShortagePct,
  toleranceOveragePct: step.toleranceOveragePct,
  toleranceDimensionalMm: step.toleranceDimensionalMm,
  toleranceColourDeltaE: step.toleranceColourDeltaE,
  shippingPending: false,
  shippingPendingReason: null,
  targetGap: { gapPerUnit: '1.88', gapPct: '16.35', meetsTarget: false },
};

export const QUOTE_EXAMPLE: SavedQuoteDto = {
  id: IDS.quote,
  quoteCode: null,
  status: 'saved',
  source: 'instant',
  productTypeCode: 'folding_carton',
  summary: LINE_SUMMARY_EXAMPLE,
  configuration: CONFIGURATION_EXAMPLE,
  deliveryPostcode: '10110',
  validUntil: '2026-10-16T09:00:00+07:00',
  priceLocked: true,
  options: [OPTION_EXAMPLE],
  pdfStatus: 'none',
  currency: 'THB',
  dimensions: null,
  shareExpiresAt: null,
  sharedAt: null,
  advisory: null,
  targetPricePerUnit: '11.50',
  outcome: null,
  fromLever: null,
  dielineQuantities: null,
  createdAt: '2026-10-01T09:00:00+07:00',
};

export const ADMIN_QUOTE_EXAMPLE: AdminSavedQuoteDto = {
  ...QUOTE_EXAMPLE,
  channel: 'cs',
  customer: { id: IDS.customer, displayName: 'Fake Customer' },
  createdBy: { id: '0192f3a0-7c1e-7d2a-9b1f-00000000e605', displayName: 'Dev CS' },
  customerCode: 'CU-000042',
  rfq: null,
  note: null,
  options: [{ ...OPTION_EXAMPLE, internal: ADMIN_CALCULATION_EXAMPLE.steps[0]!.internal }],
};

export const SAVE_EXAMPLE = {
  productTypeCode: 'folding_carton',
  configuration: CONFIGURATION_EXAMPLE,
  deliveryPostcode: '10110',
};
