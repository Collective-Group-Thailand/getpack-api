import { DecimalField, EnumField, IntField, RefField, TextField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional, ValidateNested } from 'class-validator';

import { ENVELOPE_EXAMPLE, TierBEnvelopeDto } from './tier-b-envelope.dto';

export const PARTICIPATION_TIERS = ['A', 'B', 'C'] as const;
export const OWNERSHIP_MODES = ['platform_rate_card', 'factory_price_list'] as const;
export const CAPACITY_UNITS = ['pieces', 'sheets', 'sqm', 'jobs'] as const;
export const PAYOUT_TRIGGERS = [
  'job_accepted',
  'immediate',
  'none',
  'after_pod',
  'after_pod_and_claim_window',
] as const;
export const VERSION_STATUSES = [
  'draft',
  'proposed',
  'pending_acceptance',
  'approved',
  'rejected',
  'withdrawn',
] as const;

const PRODUCT_TYPE = '0192f3a0-7c1e-7d2a-9b1f-00000000c002';
const APPROVAL = '0192f3a0-7c1e-7d2a-9b1f-00000000f301';
const TS = '2026-09-26T10:00:00+07:00';

/** Fields every versioned change carries (ADR-0005): when it applies and why. */
class VersionInput {
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    example: '2026-10-01T00:00:00+07:00',
    description: 'Defaults to now; never in the past (history is not rewritten, ADR-0005)',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  effectiveFrom?: Date;

  @TextField({ example: 'Agreed with the factory at onboarding', max: 1000 })
  reason!: string;
}

export class VersionMetaDto {
  @ApiProperty({ type: 'integer', example: 2 })
  versionNo!: number;

  @ApiProperty({ enum: VERSION_STATUSES, enumName: 'ConfigVersionStatus', example: 'approved' })
  status!: (typeof VERSION_STATUSES)[number];

  @ApiProperty({ format: 'date-time', example: TS })
  effectiveFrom!: string;

  @ApiProperty({ example: 'Agreed with the factory at onboarding' })
  reason!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  approvalRequestId!: string | null;
}

// --- participation (D-043) -------------------------------------------------------------------------

export class ParticipationVersionDto extends VersionMetaDto {
  @ApiProperty({ enum: PARTICIPATION_TIERS, enumName: 'ParticipationTier', example: 'A' })
  tier!: (typeof PARTICIPATION_TIERS)[number];

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Tier B: a human summary of what the path covers',
  })
  envelopeNote!: string | null;

  @ApiProperty({
    type: TierBEnvelopeDto,
    nullable: true,
    example: null,
    description: 'Tier B: what the path covers (D-234); null for tiers A and C',
  })
  envelope!: TierBEnvelopeDto | null;
}

export class SetParticipationDto extends VersionInput {
  @RefField({ example: PRODUCT_TYPE })
  productTypeId!: string;

  @EnumField(PARTICIPATION_TIERS, 'ParticipationTier', {
    example: 'A',
    description:
      'A full price list · B common specs / standard sizes / stock only · C quote on request (D-043)',
  })
  tier!: (typeof PARTICIPATION_TIERS)[number];

  @TextField({ example: null, nullable: true, max: 1000 })
  envelopeNote?: string | null;

  @ApiPropertyOptional({
    type: TierBEnvelopeDto,
    nullable: true,
    example: ENVELOPE_EXAMPLE,
    description:
      'Required for tier B, refused otherwise (D-234): the configurations the path covers — quantity, print types, sizes ' +
      '(ranges or standard sizes), patterns, materials, stock products or service items, as the type’s calculator carries',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TierBEnvelopeDto)
  envelope?: TierBEnvelopeDto | null;
}

// --- pricing arrangement (D-042) -------------------------------------------------------------------

export class PricingArrangementVersionDto extends VersionMetaDto {
  @ApiProperty({ enum: OWNERSHIP_MODES, enumName: 'PriceOwnershipMode', example: 'factory_price_list' })
  ownershipMode!: (typeof OWNERSHIP_MODES)[number];
}

export class SetPricingArrangementDto extends VersionInput {
  @EnumField(OWNERSHIP_MODES, 'PriceOwnershipMode', {
    example: 'factory_price_list',
    description: 'Chosen at onboarding; a later change needs the Partner Manager’s approval (D-042, D-167)',
  })
  ownershipMode!: (typeof OWNERSHIP_MODES)[number];
}

// --- capacity (D-101) ------------------------------------------------------------------------------

export class CapacityVersionDto extends VersionMetaDto {
  @ApiProperty({ enum: CAPACITY_UNITS, enumName: 'CapacityUnit', example: 'sheets' })
  capacityUnit!: (typeof CAPACITY_UNITS)[number];

  @ApiProperty({ example: '12000.000', description: 'Per week, in `capacityUnit`' })
  weeklyCapacity!: string;
}

export class SetCapacityDto extends VersionInput {
  @RefField({ example: PRODUCT_TYPE })
  productTypeId!: string;

  @EnumField(CAPACITY_UNITS, 'CapacityUnit', { example: 'sheets' })
  capacityUnit!: (typeof CAPACITY_UNITS)[number];

  @DecimalField({ example: 12000, scale: 3, unit: 'capacity unit per week' })
  weeklyCapacity!: number;
}

// --- tolerance (D-021, D-163, D-173) ---------------------------------------------------------------

export class ToleranceVersionDto extends VersionMetaDto {
  @ApiProperty({ example: '5.0000', description: 'Percent' })
  shortagePct!: string;

  @ApiProperty({ example: '5.0000', description: 'Percent' })
  overagePct!: string;
}

export class SetToleranceDto extends VersionInput {
  @RefField({
    example: null,
    nullable: true,
    description: 'Product type of the override; null = the factory default',
  })
  productTypeId?: string | null;

  @DecimalField({ example: 5, scale: 4, unit: '%' })
  shortagePct!: number;

  @DecimalField({ example: 5, scale: 4, unit: '%' })
  overagePct!: number;
}

// --- payout policy (D-022, D-164, D-173) -----------------------------------------------------------

export class PayoutPolicyVersionDto extends VersionMetaDto {
  @ApiProperty({ example: '30.0000' })
  advancePct!: string;

  @ApiProperty({ enum: PAYOUT_TRIGGERS, enumName: 'PayoutTrigger', example: 'job_accepted' })
  advanceTrigger!: (typeof PAYOUT_TRIGGERS)[number];

  @ApiProperty({ enum: PAYOUT_TRIGGERS, enumName: 'PayoutTrigger', example: 'after_pod_and_claim_window' })
  balanceTrigger!: (typeof PAYOUT_TRIGGERS)[number];

  @ApiProperty({ type: 'integer', example: 7 })
  claimWindowDays!: number;

  @ApiProperty({ example: '5.0000' })
  retentionPct!: string;

  @ApiProperty({ type: 'integer', example: 30 })
  retentionReleaseDays!: number;

  @ApiProperty({ type: 'integer', example: 0 })
  paymentTermsDays!: number;
}

export class SetPayoutPolicyDto extends VersionInput {
  @DecimalField({ example: 30, scale: 4, unit: '%' })
  advancePct!: number;

  @EnumField(PAYOUT_TRIGGERS, 'PayoutTrigger', { example: 'job_accepted' })
  advanceTrigger!: (typeof PAYOUT_TRIGGERS)[number];

  @EnumField(PAYOUT_TRIGGERS, 'PayoutTrigger', { example: 'after_pod_and_claim_window' })
  balanceTrigger!: (typeof PAYOUT_TRIGGERS)[number];

  @IntField({ example: 7, min: 0, max: 365 })
  claimWindowDays!: number;

  @DecimalField({ example: 5, scale: 4, unit: '%' })
  retentionPct!: number;

  @IntField({ example: 30, min: 0, max: 3650 })
  retentionReleaseDays!: number;

  @IntField({ example: 0, optional: true, min: 0, max: 365 })
  paymentTermsDays?: number;
}

// --- read model ------------------------------------------------------------------------------------

export class ParticipationDto {
  @ApiProperty({ format: 'uuid', example: PRODUCT_TYPE })
  productTypeId!: string;

  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({ type: ParticipationVersionDto, nullable: true })
  current!: ParticipationVersionDto | null;

  @ApiProperty({ type: [ParticipationVersionDto], description: 'Scheduled (future) and pending versions' })
  upcoming!: ParticipationVersionDto[];
}

export class CapacityDto {
  @ApiProperty({ format: 'uuid', example: PRODUCT_TYPE })
  productTypeId!: string;

  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({ type: CapacityVersionDto, nullable: true })
  current!: CapacityVersionDto | null;

  @ApiProperty({ type: [CapacityVersionDto] })
  upcoming!: CapacityVersionDto[];
}

export class TolerancePolicyDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'null = factory default',
  })
  productTypeId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  productTypeCode!: string | null;

  @ApiProperty({ type: ToleranceVersionDto, nullable: true })
  current!: ToleranceVersionDto | null;

  @ApiProperty({ type: [ToleranceVersionDto] })
  upcoming!: ToleranceVersionDto[];
}

export class PricingArrangementDto {
  @ApiProperty({ type: PricingArrangementVersionDto, nullable: true })
  current!: PricingArrangementVersionDto | null;

  @ApiProperty({ type: [PricingArrangementVersionDto] })
  upcoming!: PricingArrangementVersionDto[];
}

export class PayoutPolicyDto {
  @ApiProperty({
    type: PayoutPolicyVersionDto,
    nullable: true,
    description: 'null = the platform defaults apply',
  })
  current!: PayoutPolicyVersionDto | null;

  @ApiProperty({ type: [PayoutPolicyVersionDto] })
  upcoming!: PayoutPolicyVersionDto[];
}

export class FactoryConfigurationDto {
  @ApiProperty({ type: PricingArrangementDto })
  pricingArrangement!: PricingArrangementDto;

  @ApiProperty({ type: [ParticipationDto] })
  participations!: ParticipationDto[];

  @ApiProperty({ type: [CapacityDto] })
  capacities!: CapacityDto[];

  @ApiProperty({ type: [TolerancePolicyDto] })
  tolerances!: TolerancePolicyDto[];

  @ApiProperty({ type: PayoutPolicyDto })
  payoutPolicy!: PayoutPolicyDto;
}

export const VERSION_EXAMPLE = {
  versionNo: 1,
  status: 'approved' as const,
  effectiveFrom: TS,
  reason: 'Agreed with the factory at onboarding',
  approvalRequestId: null,
};

export const CONFIGURATION_EXAMPLE: FactoryConfigurationDto = {
  pricingArrangement: { current: { ...VERSION_EXAMPLE, ownershipMode: 'factory_price_list' }, upcoming: [] },
  participations: [
    {
      productTypeId: PRODUCT_TYPE,
      productTypeCode: 'folding_carton',
      current: { ...VERSION_EXAMPLE, tier: 'A', envelopeNote: null, envelope: null },
      upcoming: [],
    },
  ],
  capacities: [
    {
      productTypeId: PRODUCT_TYPE,
      productTypeCode: 'folding_carton',
      current: { ...VERSION_EXAMPLE, capacityUnit: 'sheets', weeklyCapacity: '12000.000' },
      upcoming: [],
    },
  ],
  tolerances: [
    {
      productTypeId: null,
      productTypeCode: null,
      current: null,
      upcoming: [
        {
          ...VERSION_EXAMPLE,
          status: 'proposed',
          shortagePct: '3.0000',
          overagePct: '5.0000',
          approvalRequestId: APPROVAL,
        },
      ],
    },
  ],
  payoutPolicy: { current: null, upcoming: [] },
};
