import { ProblemFieldError } from '@common/errors/problem-details.dto';
import { PageQuery } from '@common/pagination/pagination.dto';
import { RefField, TextField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { SavedQuoteDto } from './quotes.dto';

/** Draft configurations (D-185): kept 90 days after the last change, shared by a link that expires, converted once. */

const IDS = {
  draft: '0192f3a0-7c1e-7d2a-9b1f-00000000cd01',
  product: '0192f3a0-7c1e-7d2a-9b1f-00000000cd02',
  quote: '0192f3a0-7c1e-7d2a-9b1f-00000000cd03',
  rfq: '0192f3a0-7c1e-7d2a-9b1f-00000000cd04',
};
const EXAMPLE_CONFIGURATION = {
  patternId: '0192f3a0-7c1e-7d2a-9b1f-00000000a101',
  basis: 'internal',
  w: 100,
  l: 150,
  d: 50,
};

export class CreateConfigurationDraftDto {
  @ApiProperty({ example: 'folding_carton', pattern: '^[a-z][a-z0-9_]*$' })
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z][a-z0-9_]*$/)
  productTypeCode!: string;

  @RefField({ example: IDS.product, optional: true, description: 'The catalogue product being configured' })
  catalogProductId?: string;

  @TextField({ example: 'กล่องครีม 50 มล.', optional: true, max: 120 })
  title?: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: EXAMPLE_CONFIGURATION,
    description:
      'The configurator state so far, in the shape of the type’s calculator configuration (`store.quotes.calculate`); ' +
      'incomplete is fine. Millimetres only (D-183)',
  })
  @IsObject()
  configuration!: Record<string, unknown>;
}

export class UpdateConfigurationDraftDto {
  @TextField({ example: 'กล่องครีม 50 มล.', optional: true, max: 120 })
  title?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: EXAMPLE_CONFIGURATION,
    description:
      'Replaces the configuration; the completeness is re-assessed and the 90-day retention restarts',
  })
  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;
}

export class ConvertDraftToQuoteDto {
  @ApiPropertyOptional({
    example: '10110',
    pattern: '^[0-9]{5}$',
    description: 'Delivery postcode for the shipping line',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{5}$/)
  deliveryPostcode?: string;
}

export class ConvertDraftToRfqDto {
  @ApiProperty({ example: '10110', pattern: '^[0-9]{5}$' })
  @IsString()
  @Matches(/^[0-9]{5}$/)
  deliveryPostcode!: string;

  @ApiPropertyOptional({
    type: [Number],
    example: [500, 1000],
    description: 'Quantity tiers; default: the draft’s quantities',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(10_000_000, { each: true })
  quantities?: number[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { material: 'อาร์ตการ์ด 350 แกรม' },
    description: 'The type’s RFQ spec fields (`store.rfqs.submit`); default: none',
  })
  @IsOptional()
  @IsObject()
  spec?: Record<string, unknown>;

  @TextField({ example: 'ต้องการพิมพ์ทองด้านหน้า', optional: true, max: 2000 })
  notes?: string;
}

export class ConfigurationDraftDto {
  @ApiProperty({ format: 'uuid', example: IDS.draft })
  id!: string;

  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: IDS.product })
  catalogProductId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'กล่องครีม 50 มล.' })
  title!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true, example: EXAMPLE_CONFIGURATION })
  configuration!: Record<string, unknown>;

  @ApiProperty({
    type: Number,
    example: 62.5,
    description: 'Share of the required fields given, 0–100 (D-185)',
  })
  completenessPct!: number;

  @ApiProperty({
    type: [String],
    example: ['materialId', 'quantities'],
    description: 'Required fields not given yet',
  })
  missingFields!: string[];

  @ApiProperty({
    type: [ProblemFieldError],
    example: [],
    description: 'Values given that the calculator refuses',
  })
  invalidFields!: ProblemFieldError[];

  @ApiProperty({ example: false, description: 'Ready to be priced or sent as an RFQ' })
  complete!: boolean;

  @ApiProperty({ enum: ['open', 'converted'], enumName: 'ConfigurationDraftStatus', example: 'open' })
  status!: 'open' | 'converted';

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  convertedQuoteId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  convertedRfqId!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  sharedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  shareExpiresAt!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-02T10:00:00+07:00' })
  lastChangedAt!: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-12-31T10:00:00+07:00',
    description: 'Deleted after this unless changed again (`configurations.draft_retention_days`, D-185)',
  })
  expiresAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-02T10:00:00+07:00' })
  createdAt!: string;
}

/** What a draft share link shows: the configuration, never its owner (D-185). */
export class SharedConfigurationDraftDto {
  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: IDS.product })
  catalogProductId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'กล่องครีม 50 มล.' })
  title!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true, example: EXAMPLE_CONFIGURATION })
  configuration!: Record<string, unknown>;

  @ApiProperty({ type: Number, example: 62.5 })
  completenessPct!: number;

  @ApiProperty({ type: [String], example: ['materialId'] })
  missingFields!: string[];

  @ApiProperty({ format: 'date-time', example: '2026-10-17T10:00:00+07:00' })
  expiresAt!: string;
}

export class ShareConfigurationDraftResultDto {
  @ApiProperty({ type: ConfigurationDraftDto })
  draft!: ConfigurationDraftDto;

  @ApiProperty({ example: 'bX2k…', description: 'Shown once; only its hash is kept' })
  shareToken!: string;

  @ApiProperty({ example: '/v1/store/shared-configurations/bX2k…' })
  sharePath!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-17T10:00:00+07:00' })
  expiresAt!: string;
}

export class DraftQuoteResultDto {
  @ApiProperty({ type: ConfigurationDraftDto })
  draft!: ConfigurationDraftDto;

  @ApiProperty({ type: SavedQuoteDto })
  quote!: SavedQuoteDto;
}

export class DraftRfqResultDto {
  @ApiProperty({ type: ConfigurationDraftDto })
  draft!: ConfigurationDraftDto;

  @ApiProperty({ format: 'uuid', example: IDS.rfq })
  rfqId!: string;

  @ApiProperty({ example: 'RFQ-2026-000101' })
  rfqCode!: string;
}

export class DraftListQuery extends PageQuery {}

export const DRAFT_EXAMPLE: ConfigurationDraftDto = {
  id: IDS.draft,
  productTypeCode: 'folding_carton',
  catalogProductId: IDS.product,
  title: 'กล่องครีม 50 มล.',
  configuration: EXAMPLE_CONFIGURATION,
  completenessPct: 62.5,
  missingFields: ['materialId', 'quantities'],
  invalidFields: [],
  complete: false,
  status: 'open',
  convertedQuoteId: null,
  convertedRfqId: null,
  sharedAt: null,
  shareExpiresAt: null,
  lastChangedAt: '2026-10-02T10:00:00+07:00',
  expiresAt: '2026-12-31T10:00:00+07:00',
  createdAt: '2026-10-02T10:00:00+07:00',
};

export const SHARED_DRAFT_EXAMPLE: SharedConfigurationDraftDto = {
  productTypeCode: 'folding_carton',
  catalogProductId: IDS.product,
  title: 'กล่องครีม 50 มล.',
  configuration: EXAMPLE_CONFIGURATION,
  completenessPct: 62.5,
  missingFields: ['materialId', 'quantities'],
  expiresAt: '2026-10-17T10:00:00+07:00',
};
