import { EnumField, IntField, RefField, TextField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { MAX_RATES, MONEY, POSTCODE, RATE, SHIPPING_IDS, VERSION_STATUSES } from './customer-rates.dto';

/**
 * Factory shipping payout cards (D-013): what Packio pays a factory for delivering with its own
 * fleet. Packio drafts, the factory accepts or counters per line (D-042 rate-card flow, chosen at
 * B2.4 planning). Buy prices: staff need `factory_cost.read` (D-141); a factory sees only its own.
 */

export const RATE_LINE_ACCEPTANCES = ['pending', 'accepted', 'countered'] as const;
export const FACTORY_ANSWERS = ['accept', 'counter'] as const;
export const COUNTER_ANSWERS = ['accept_counter', 'keep'] as const;

const IDS = {
  card: '0192f3a0-7c1e-7d2a-9b1f-00000000d411',
  version: '0192f3a0-7c1e-7d2a-9b1f-00000000d412',
  rate: '0192f3a0-7c1e-7d2a-9b1f-00000000d413',
  factory: '0192f3a0-7c1e-7d2a-9b1f-00000000a201',
};

export class FactoryRateInputDto {
  @RefField({ example: SHIPPING_IDS.zone, description: 'Zone of the `customer_default` scheme' })
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

  @IntField({ example: null, min: 1, nullable: true, description: 'Volume to (exclusive). Unit: cm³.' })
  volumeMaxCm3!: number | null;

  @ApiProperty({ example: '95.00', pattern: MONEY.source, description: 'Payout, VAT-exclusive (THB)' })
  @IsString()
  @Matches(MONEY)
  payoutAmount!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    pattern: RATE.source,
    description: 'Paid per started kg above `weightMinG`, VAT-exclusive (THB)',
  })
  @IsOptional()
  @IsString()
  @Matches(RATE)
  perExtraKg!: string | null;
}

export class FactoryRateDto extends FactoryRateInputDto {
  @ApiProperty({ format: 'uuid', example: IDS.rate })
  id!: string;

  @ApiProperty({ example: 'bkk' })
  zoneCode!: string;

  @ApiProperty({ enum: RATE_LINE_ACCEPTANCES, enumName: 'RateLineAcceptance', example: 'accepted' })
  acceptance!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Factory counter (THB, VAT-exclusive)',
  })
  counterAmount!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  counterPerExtraKg!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  counterNote!: string | null;
}

export class CreateFactoryRateVersionDto {
  @ApiProperty({
    format: 'date-time',
    example: '2026-10-15T00:00:00+07:00',
    description: 'Applies from this instant once the factory has accepted every line; never back-dated',
  })
  @IsDateString()
  effectiveFrom!: string;

  @TextField({ example: 'Initial payout card (fake)', max: 500 })
  reason!: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'Copy the rates of this version of the same card; ignored when `rates` is given',
  })
  @IsOptional()
  @IsUUID()
  copyFromVersionId?: string | null;

  @ApiPropertyOptional({ type: [FactoryRateInputDto], description: `At most ${MAX_RATES} rates` })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RATES)
  @ValidateNested({ each: true })
  @Type(() => FactoryRateInputDto)
  rates?: FactoryRateInputDto[];
}

export class ReplaceFactoryRatesDto {
  @ApiProperty({ type: [FactoryRateInputDto], description: `The complete set, at most ${MAX_RATES}` })
  @IsArray()
  @ArrayMaxSize(MAX_RATES)
  @ValidateNested({ each: true })
  @Type(() => FactoryRateInputDto)
  rates!: FactoryRateInputDto[];
}

export class FactoryRateVersionSummaryDto {
  @ApiProperty({ format: 'uuid', example: IDS.version })
  id!: string;

  @ApiProperty({ type: 'integer', example: 1 })
  versionNo!: number;

  @ApiProperty({ enum: VERSION_STATUSES, enumName: 'ConfigVersionStatus', example: 'approved' })
  status!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-15T00:00:00+07:00' })
  effectiveFrom!: string;

  @ApiProperty({ example: 'Initial payout card (fake)' })
  reason!: string;

  @ApiProperty({ type: 'integer', example: 3 })
  rateCount!: number;

  @ApiProperty({ type: 'integer', example: 0, description: 'Lines not yet accepted (pending or countered)' })
  openLines!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-02T09:00:00+07:00' })
  sentAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-03T11:00:00+07:00' })
  factoryAcceptedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-03T11:00:00+07:00' })
  decidedAt!: string | null;
}

export class FactoryRateVersionDto extends FactoryRateVersionSummaryDto {
  @ApiProperty({ type: [FactoryRateDto] })
  rates!: FactoryRateDto[];
}

export class FactoryRateCardDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: IDS.card,
    description: 'Null until a first draft',
  })
  id!: string | null;

  @ApiProperty({ format: 'uuid', example: IDS.factory })
  factoryId!: string;

  @ApiProperty({
    type: FactoryRateVersionSummaryDto,
    nullable: true,
    description: 'The version in force now',
  })
  current!: FactoryRateVersionSummaryDto | null;

  @ApiProperty({
    type: FactoryRateVersionSummaryDto,
    nullable: true,
    description: 'Accepted, applying later',
  })
  scheduled!: FactoryRateVersionSummaryDto | null;

  @ApiProperty({
    type: FactoryRateVersionSummaryDto,
    nullable: true,
    description: 'The draft or the version awaiting the factory (a factory never sees Packio’s drafts)',
  })
  open!: FactoryRateVersionSummaryDto | null;
}

export class ShippingCardAnswerDto {
  @RefField({ example: IDS.rate })
  rateId!: string;

  @EnumField(FACTORY_ANSWERS, 'CardLineAnswer', { example: 'counter' })
  decision!: (typeof FACTORY_ANSWERS)[number];

  @ApiPropertyOptional({ type: String, nullable: true, example: '105.00', pattern: MONEY.source })
  @IsOptional()
  @IsString()
  @Matches(MONEY)
  counterAmount?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, pattern: RATE.source })
  @IsOptional()
  @IsString()
  @Matches(RATE)
  counterPerExtraKg?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Fuel costs (fake)', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class RespondToShippingCardDto {
  @ApiPropertyOptional({
    type: [ShippingCardAnswerDto],
    description: 'Omit to accept every pending line (the whole card)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RATES)
  @ValidateNested({ each: true })
  @Type(() => ShippingCardAnswerDto)
  lines?: ShippingCardAnswerDto[];
}

export class ShippingCounterAnswerDto {
  @RefField({ example: IDS.rate })
  rateId!: string;

  @ApiProperty({
    enum: COUNTER_ANSWERS,
    enumName: 'ShippingCounterAnswer',
    example: 'accept_counter',
    description:
      '`accept_counter` takes the factory’s values; `keep` sends Packio’s value back for an answer',
  })
  @IsIn(COUNTER_ANSWERS)
  decision!: (typeof COUNTER_ANSWERS)[number];
}

export class AnswerShippingCountersDto {
  @ApiProperty({ type: [ShippingCounterAnswerDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RATES)
  @ValidateNested({ each: true })
  @Type(() => ShippingCounterAnswerDto)
  lines!: ShippingCounterAnswerDto[];
}

export const SUGGESTION_BASES = [
  'customer_rate_less_target_margin',
  'target_margin_not_set',
  'no_customer_rate',
] as const;

export class ShippingPayoutSuggestionDto {
  @ApiProperty({ format: 'uuid', example: IDS.rate })
  rateId!: string;

  @ApiProperty({ example: '95.00', description: 'Proposed payout (THB)' })
  payoutAmount!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '120.00',
    description: 'Customer rate for the band minimum',
  })
  customerNetAmount!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '96.00',
    description: 'Customer rate × (1 − target margin)',
  })
  suggestedAmount!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '-1.04',
    description: '(proposed − suggested) / suggested, %',
  })
  deviationPct!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '100.00',
    description: 'Median payout of peers serving the zone',
  })
  peerMedianAmount!: string | null;

  @ApiProperty({
    type: 'integer',
    example: 1,
    description: 'Peers counted; the median needs the benchmark minimum (D-101)',
  })
  peerCount!: number;

  @ApiProperty({
    enum: SUGGESTION_BASES,
    enumName: 'ShippingSuggestionBasis',
    example: 'customer_rate_less_target_margin',
  })
  basis!: string;
}

// --- examples ---------------------------------------------------------------------------------------

export const FACTORY_RATE_INPUT_EXAMPLE: FactoryRateInputDto = {
  zoneId: SHIPPING_IDS.zone,
  postcode: null,
  weightMinG: 0,
  weightMaxG: 5000,
  volumeMinCm3: null,
  volumeMaxCm3: null,
  payoutAmount: '95.00',
  perExtraKg: null,
};

export const FACTORY_SUMMARY_EXAMPLE: FactoryRateVersionSummaryDto = {
  id: IDS.version,
  versionNo: 1,
  status: 'approved',
  effectiveFrom: '2026-10-15T00:00:00+07:00',
  reason: 'Initial payout card (fake)',
  rateCount: 1,
  openLines: 0,
  sentAt: '2026-10-02T09:00:00+07:00',
  factoryAcceptedAt: '2026-10-03T11:00:00+07:00',
  decidedAt: '2026-10-03T11:00:00+07:00',
};

export const FACTORY_VERSION_EXAMPLE: FactoryRateVersionDto = {
  ...FACTORY_SUMMARY_EXAMPLE,
  rates: [
    {
      ...FACTORY_RATE_INPUT_EXAMPLE,
      id: IDS.rate,
      zoneCode: 'bkk',
      acceptance: 'accepted',
      counterAmount: null,
      counterPerExtraKg: null,
      counterNote: null,
    },
  ],
};

export const FACTORY_DRAFT_EXAMPLE: FactoryRateVersionDto = {
  ...FACTORY_VERSION_EXAMPLE,
  status: 'draft',
  openLines: 1,
  sentAt: null,
  factoryAcceptedAt: null,
  decidedAt: null,
  rates: FACTORY_VERSION_EXAMPLE.rates.map((r) => ({ ...r, acceptance: 'pending' })),
};

export const FACTORY_PENDING_EXAMPLE: FactoryRateVersionDto = {
  ...FACTORY_DRAFT_EXAMPLE,
  status: 'pending_acceptance',
  sentAt: '2026-10-02T09:00:00+07:00',
};

export const FACTORY_CARD_EXAMPLE: FactoryRateCardDto = {
  id: IDS.card,
  factoryId: IDS.factory,
  current: FACTORY_SUMMARY_EXAMPLE,
  scheduled: null,
  open: null,
};

export const SUGGESTION_EXAMPLE: ShippingPayoutSuggestionDto = {
  rateId: IDS.rate,
  payoutAmount: '95.00',
  customerNetAmount: '120.00',
  suggestedAmount: '96.00',
  deviationPct: '-1.04',
  peerMedianAmount: null,
  peerCount: 1,
  basis: 'customer_rate_less_target_margin',
};
