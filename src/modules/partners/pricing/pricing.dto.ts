import { PageQuery } from '@common/pagination/pagination.dto';
import { PriceComponent as PriceComponentEnum } from '@generated/prisma/enums';
import { EnumField, IdField, IntField, RefField, TextField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsDate,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';

import { VERSION_STATUSES } from '../configuration/configuration.dto';

export const PRICE_COMPONENTS = Object.values(PriceComponentEnum);
export const PRICE_GROUPS = [
  'materials',
  'process_rates',
  'waste',
  'commercial_terms',
  'shipping',
  'rules',
] as const;
export const VERSION_ORIGINS = [
  'factory_proposal',
  'platform_rate_card',
  'assisted_entry',
  'import',
] as const;
export const PROPOSAL_DIRECTIONS = ['factory_to_packio', 'packio_to_factory'] as const;
export const PROPOSAL_STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'countered',
  'approved',
  'partially_approved',
  'rejected',
  'withdrawn',
  'accepted_by_factory',
] as const;
export const LINE_ACTIONS = ['add', 'change', 'remove'] as const;
export const LINE_DECISIONS = ['pending', 'accepted', 'rejected', 'countered'] as const;
/** Lines one request may carry (a full tier-A table fits; larger loads go through the import). */
export const MAX_PROPOSAL_LINES = 5000;

const IDS = {
  priceList: '0192f3a0-7c1e-7d2a-9b1f-00000000f601',
  version: '0192f3a0-7c1e-7d2a-9b1f-00000000f602',
  proposal: '0192f3a0-7c1e-7d2a-9b1f-00000000f603',
  line: '0192f3a0-7c1e-7d2a-9b1f-00000000f604',
  factory: '0192f3a0-7c1e-7d2a-9b1f-00000000f001',
  productType: '0192f3a0-7c1e-7d2a-9b1f-00000000c002',
  material: '0192f3a0-7c1e-7d2a-9b1f-00000000c010',
  approval: '0192f3a0-7c1e-7d2a-9b1f-00000000f301',
};
export const PRICING_IDS = IDS;
const TS = '2026-09-26T10:00:00+07:00';
const LINE_KEY = '9f2c4e1ab0d7c3e5f6a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0';
const VALUES = { materialId: IDS.material, qtyFrom: 1000, qtyTo: 4999, rate: '12.500000' };

const valuesProperty = (description: string, example: unknown, nullable = false) =>
  ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable,
    description,
    example,
  });

// --- components --------------------------------------------------------------------------------------

export class PriceColumnDto {
  @ApiProperty({ example: 'rate' })
  key!: string;

  @ApiProperty({
    enum: ['decimal', 'integer', 'ref', 'text', 'boolean'],
    enumName: 'PriceColumnType',
    example: 'decimal',
  })
  type!: 'decimal' | 'integer' | 'ref' | 'text' | 'boolean';

  @ApiProperty({ example: false })
  nullable!: boolean;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 6,
    description: 'Decimal places (decimal columns)',
  })
  scale!: number | null;
}

export class PriceComponentDto {
  @ApiProperty({ enum: PRICE_COMPONENTS, enumName: 'PriceComponent', example: 'material_prices' })
  component!: string;

  @ApiProperty({ enum: PRICE_GROUPS, enumName: 'PriceGroup', example: 'materials' })
  group!: (typeof PRICE_GROUPS)[number];

  @ApiProperty({ type: [PriceColumnDto], description: 'Columns identifying a line (hashed into `lineKey`)' })
  dimensions!: PriceColumnDto[];

  @ApiProperty({ type: [PriceColumnDto], description: 'Columns a proposal changes' })
  values!: PriceColumnDto[];

  @ApiProperty({
    type: [String],
    example: ['folding_carton', 'label_sticker', 'tag_sleeve'],
    description:
      'Product types whose calculator reads this component (`product_types.calculator_key`); a price list ' +
      'for one of them offers it, others do not (partner UX, 2026-10-09). Empty: no calculator reads it yet.',
  })
  productTypeCodes!: string[];
}

// --- price lists ---------------------------------------------------------------------------------------

export class PriceListVersionDto {
  @IdField(IDS.version)
  id!: string;

  @ApiProperty({ type: 'integer', example: 2 })
  versionNo!: number;

  @ApiProperty({ enum: VERSION_STATUSES, enumName: 'ConfigVersionStatus', example: 'approved' })
  status!: (typeof VERSION_STATUSES)[number];

  @ApiProperty({ enum: VERSION_ORIGINS, enumName: 'PriceVersionOrigin', example: 'factory_proposal' })
  origin!: (typeof VERSION_ORIGINS)[number];

  @ApiProperty({ format: 'date-time', example: TS })
  effectiveFrom!: string;

  @ApiProperty({ type: 'integer', nullable: true, example: 1 })
  basedOnVersionNo!: number | null;

  @ApiProperty({ type: 'integer', example: 120 })
  lineCount!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'b1946ac92492d2347c6235b4d2611184b1946ac92492d2347c6235b4d2611184',
    description: 'SHA-256 (hex) over every component row — what quotes and jobs snapshot',
  })
  contentSha256!: string | null;

  @ApiProperty({ example: 'Paper prices from October' })
  reason!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: IDS.proposal })
  proposalId!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'Rate card accepted by the factory (D-042)',
  })
  factoryAcceptedAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'Assisted entry signed off by the factory (D-100 note)',
  })
  factorySignedOffAt!: string | null;

  @ApiProperty({ format: 'date-time', example: TS })
  createdAt!: string;
}

export class PriceListDto {
  @IdField(IDS.priceList)
  id!: string;

  @ApiProperty({ format: 'uuid', example: IDS.productType })
  productTypeId!: string;

  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({ type: PriceListVersionDto, nullable: true, description: 'Version in force now' })
  current!: PriceListVersionDto | null;

  @ApiProperty({
    type: [PriceListVersionDto],
    description: 'Approved versions scheduled for later, and versions awaiting the factory',
  })
  upcoming!: PriceListVersionDto[];
}

export class PriceRowDto {
  @ApiProperty({ enum: PRICE_COMPONENTS, enumName: 'PriceComponent', example: 'material_prices' })
  component!: string;

  @ApiProperty({ example: LINE_KEY })
  lineKey!: string;

  @valuesProperty('Dimension and value columns (decimals as strings, catalogue references as ids)', VALUES)
  values!: Record<string, unknown>;
}

export class PriceComponentCountDto {
  @ApiProperty({ enum: PRICE_COMPONENTS, enumName: 'PriceComponent', example: 'material_prices' })
  component!: string;

  @ApiProperty({ type: 'integer', example: 12, description: 'Lines of this component in the version' })
  lines!: number;
}

export class PriceRowsQuery {
  @EnumField(PRICE_COMPONENTS, 'PriceComponent', { example: 'material_prices' })
  component!: string;

  @IntField({ example: 1, optional: true, min: 1 })
  page: number = 1;

  @IntField({ example: 100, optional: true, min: 1, max: 500 })
  perPage: number = 100;
}

// --- proposals -----------------------------------------------------------------------------------------

export class CreatePriceProposalDto {
  @RefField({ example: IDS.productType })
  productTypeId!: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    example: '2026-10-01T00:00:00+07:00',
    description: 'When the new prices should apply; never before approval (no back-dating, ADR-0005)',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  proposedEffectiveFrom?: Date;

  @TextField({ example: 'Paper prices from October', nullable: true, max: 2000 })
  comment?: string | null;
}

export class PriceProposalLineInput {
  @EnumField(PRICE_COMPONENTS, 'PriceComponent', { example: 'material_prices' })
  component!: string;

  @EnumField(LINE_ACTIONS, 'ProposalLineAction', { example: 'change' })
  action!: (typeof LINE_ACTIONS)[number];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: VALUES,
    description:
      'Every dimension and value column (`add`, `change`); for `remove` the dimensions or `lineKey`',
  })
  @IsOptional()
  @IsObject()
  values?: Record<string, unknown>;

  @ApiPropertyOptional({ example: LINE_KEY, description: 'Identifies the line to remove' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  lineKey?: string;
}

export class ReplaceProposalLinesDto {
  @ApiProperty({ type: [PriceProposalLineInput], maxItems: MAX_PROPOSAL_LINES })
  @ArrayMaxSize(MAX_PROPOSAL_LINES)
  @ValidateNested({ each: true })
  @Type(() => PriceProposalLineInput)
  lines!: PriceProposalLineInput[];
}

export class LineDecisionInput {
  @RefField({ example: IDS.line })
  lineId!: string;

  @EnumField(['accept', 'reject', 'counter'] as const, 'PriceLineDecisionAction', { example: 'counter' })
  decision!: 'accept' | 'reject' | 'counter';

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { rate: '12.000000' },
    description: 'Value columns of the counter (`counter` only)',
  })
  @IsOptional()
  @IsObject()
  counterValues?: Record<string, unknown>;

  @TextField({ example: 'Market price is lower this quarter', nullable: true, max: 1000 })
  comment?: string | null;
}

export class DecideLinesDto {
  @ApiProperty({ type: [LineDecisionInput], maxItems: MAX_PROPOSAL_LINES })
  @ArrayMaxSize(MAX_PROPOSAL_LINES)
  @ValidateNested({ each: true })
  @Type(() => LineDecisionInput)
  lines!: LineDecisionInput[];
}

export class CounterAnswerInput {
  @RefField({ example: IDS.line })
  lineId!: string;

  @EnumField(['accept', 'withdraw'] as const, 'PriceCounterAnswer', { example: 'accept' })
  response!: 'accept' | 'withdraw';
}

export class AnswerCountersDto {
  @ApiProperty({ type: [CounterAnswerInput], maxItems: MAX_PROPOSAL_LINES })
  @ArrayMaxSize(MAX_PROPOSAL_LINES)
  @ValidateNested({ each: true })
  @Type(() => CounterAnswerInput)
  lines!: CounterAnswerInput[];
}

export class RateCardLineResponse {
  @RefField({ example: IDS.line })
  lineId!: string;

  @EnumField(['accept', 'counter'] as const, 'CardLineAnswer', { example: 'counter' })
  response!: 'accept' | 'counter';

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { rate: '13.000000' },
    description: 'Value columns the factory asks for instead (`counter` only)',
  })
  @IsOptional()
  @IsObject()
  counterValues?: Record<string, unknown>;

  @TextField({ example: 'Our paper cost rose in September', nullable: true, max: 1000 })
  comment?: string | null;
}

export class RespondToRateCardDto {
  @ApiPropertyOptional({
    type: [RateCardLineResponse],
    maxItems: MAX_PROPOSAL_LINES,
    description: 'Omit to accept the whole rate card; otherwise answer lines (the rest stay open)',
  })
  @IsOptional()
  @ArrayMaxSize(MAX_PROPOSAL_LINES)
  @ValidateNested({ each: true })
  @Type(() => RateCardLineResponse)
  lines?: RateCardLineResponse[];
}

export class PriceProposalLineDto {
  @IdField(IDS.line)
  id!: string;

  @ApiProperty({ enum: PRICE_COMPONENTS, enumName: 'PriceComponent', example: 'material_prices' })
  component!: string;

  @ApiProperty({ example: LINE_KEY })
  lineKey!: string;

  @ApiProperty({ enum: LINE_ACTIONS, enumName: 'ProposalLineAction', example: 'change' })
  action!: (typeof LINE_ACTIONS)[number];

  @valuesProperty('The line in the base version (null for `add`)', { ...VALUES, rate: '11.800000' }, true)
  currentValues!: Record<string, unknown> | null;

  @valuesProperty('Proposed line (null for `remove`)', VALUES, true)
  proposedValues!: Record<string, unknown> | null;

  @ApiProperty({ enum: LINE_DECISIONS, enumName: 'ProposalLineDecision', example: 'pending' })
  decision!: (typeof LINE_DECISIONS)[number];

  @valuesProperty('Counter offer; once accepted it is the final value', null, true)
  counterValues!: Record<string, unknown> | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  comment!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  decidedAt!: string | null;
}

export class ProposalLineCountsDto {
  @ApiProperty({ type: 'integer', example: 3 })
  total!: number;

  @ApiProperty({ type: 'integer', example: 1 })
  pending!: number;

  @ApiProperty({ type: 'integer', example: 1 })
  accepted!: number;

  @ApiProperty({ type: 'integer', example: 0 })
  rejected!: number;

  @ApiProperty({ type: 'integer', example: 1 })
  countered!: number;
}

export class ResultingVersionDto {
  @IdField(IDS.version)
  id!: string;

  @ApiProperty({ type: 'integer', example: 2 })
  versionNo!: number;

  @ApiProperty({ enum: VERSION_STATUSES, enumName: 'ConfigVersionStatus', example: 'pending_acceptance' })
  status!: (typeof VERSION_STATUSES)[number];
}

export class PriceProposalSummaryDto {
  @IdField(IDS.proposal)
  id!: string;

  @ApiProperty({ format: 'uuid', example: IDS.factory })
  factoryId!: string;

  @ApiProperty({ example: 'PRINTCO' })
  factoryCode!: string;

  @ApiProperty({ format: 'uuid', example: IDS.priceList })
  priceListId!: string;

  @ApiProperty({ format: 'uuid', example: IDS.productType })
  productTypeId!: string;

  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({
    enum: PROPOSAL_DIRECTIONS,
    enumName: 'ProposalDirection',
    example: 'factory_to_packio',
    description:
      '`factory_to_packio` = factory price list (mode b); `packio_to_factory` = rate card (mode a), D-042',
  })
  direction!: (typeof PROPOSAL_DIRECTIONS)[number];

  @ApiProperty({
    enum: VERSION_ORIGINS,
    enumName: 'PriceVersionOrigin',
    example: 'factory_proposal',
    description: '`assisted_entry` = entered by Packio staff for the factory, signed off by it (D-100 note)',
  })
  origin!: (typeof VERSION_ORIGINS)[number];

  @ApiProperty({ enum: PROPOSAL_STATUSES, enumName: 'ProposalStatus', example: 'under_review' })
  status!: (typeof PROPOSAL_STATUSES)[number];

  @ApiProperty({ format: 'date-time', example: '2026-10-01T00:00:00+07:00' })
  proposedEffectiveFrom!: string;

  @ApiProperty({ type: 'integer', nullable: true, example: 1, description: 'Version the lines apply to' })
  baseVersionNo!: number | null;

  @ApiProperty({ type: ResultingVersionDto, nullable: true })
  resultingVersion!: ResultingVersionDto | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: IDS.approval })
  approvalRequestId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Paper prices from October' })
  comment!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: TS })
  submittedAt!: string | null;

  @ApiProperty({ type: ProposalLineCountsDto })
  lineCounts!: ProposalLineCountsDto;

  @ApiProperty({ format: 'date-time', example: TS })
  createdAt!: string;
}

export class PriceProposalDto extends PriceProposalSummaryDto {
  @ApiProperty({ type: [PriceProposalLineDto] })
  lines!: PriceProposalLineDto[];
}

export class PriceProposalListQuery extends PageQuery {
  @EnumField(PROPOSAL_STATUSES, 'ProposalStatus', { example: 'submitted', optional: true })
  status?: (typeof PROPOSAL_STATUSES)[number];

  @EnumField(PROPOSAL_DIRECTIONS, 'ProposalDirection', { example: 'factory_to_packio', optional: true })
  direction?: (typeof PROPOSAL_DIRECTIONS)[number];

  @ApiPropertyOptional({ format: 'uuid', example: IDS.factory })
  @IsOptional()
  @IsUUID()
  factoryId?: string;
}

// --- examples ---------------------------------------------------------------------------------------

export const PRICE_LIST_VERSION_EXAMPLE: PriceListVersionDto = {
  id: IDS.version,
  versionNo: 2,
  status: 'approved',
  origin: 'factory_proposal',
  effectiveFrom: TS,
  basedOnVersionNo: 1,
  lineCount: 120,
  contentSha256: 'b1946ac92492d2347c6235b4d2611184b1946ac92492d2347c6235b4d2611184',
  reason: 'Paper prices from October',
  proposalId: IDS.proposal,
  factoryAcceptedAt: null,
  factorySignedOffAt: null,
  createdAt: TS,
};

export const PRICE_LIST_EXAMPLE: PriceListDto = {
  id: IDS.priceList,
  productTypeId: IDS.productType,
  productTypeCode: 'folding_carton',
  current: PRICE_LIST_VERSION_EXAMPLE,
  upcoming: [],
};

export const PRICE_ROW_EXAMPLE: PriceRowDto = {
  component: 'material_prices',
  lineKey: LINE_KEY,
  values: VALUES,
};

export const PROPOSAL_LINE_EXAMPLE: PriceProposalLineDto = {
  id: IDS.line,
  component: 'material_prices',
  lineKey: LINE_KEY,
  action: 'change',
  currentValues: { ...VALUES, rate: '11.800000' },
  proposedValues: VALUES,
  decision: 'pending',
  counterValues: null,
  comment: null,
  decidedAt: null,
};

export const PROPOSAL_SUMMARY_EXAMPLE: PriceProposalSummaryDto = {
  id: IDS.proposal,
  factoryId: IDS.factory,
  factoryCode: 'PRINTCO',
  priceListId: IDS.priceList,
  productTypeId: IDS.productType,
  productTypeCode: 'folding_carton',
  direction: 'factory_to_packio',
  origin: 'factory_proposal',
  status: 'submitted',
  proposedEffectiveFrom: '2026-10-01T00:00:00+07:00',
  baseVersionNo: 1,
  resultingVersion: null,
  approvalRequestId: IDS.approval,
  comment: 'Paper prices from October',
  submittedAt: TS,
  lineCounts: { total: 1, pending: 1, accepted: 0, rejected: 0, countered: 0 },
  createdAt: TS,
};

export const PROPOSAL_EXAMPLE: PriceProposalDto = {
  ...PROPOSAL_SUMMARY_EXAMPLE,
  lines: [PROPOSAL_LINE_EXAMPLE],
};

export const PRICE_COMPONENT_EXAMPLE: PriceComponentDto = {
  component: 'material_prices',
  group: 'materials',
  dimensions: [
    { key: 'materialId', type: 'ref', nullable: false, scale: null },
    { key: 'qtyFrom', type: 'integer', nullable: false, scale: null },
    { key: 'qtyTo', type: 'integer', nullable: true, scale: null },
  ],
  values: [{ key: 'rate', type: 'decimal', nullable: false, scale: 6 }],
  productTypeCodes: ['folding_carton', 'label_sticker', 'tag_sleeve'],
};

// --- suggestions & simulations (staff only, D-040 note, D-044) ------------------------------------

export const SUGGESTION_METHODS = [
  'material_index',
  'own_history_driver',
  'peer_benchmark',
  'waste_actuals',
  'shipping_margin',
  'none',
] as const;
export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;

export class PriceLineSuggestionDto {
  @ApiProperty({ format: 'uuid', example: IDS.line })
  lineId!: string;

  @ApiProperty({ enum: PRICE_COMPONENTS, enumName: 'PriceComponent', example: 'material_prices' })
  component!: string;

  @ApiProperty({ example: LINE_KEY })
  lineKey!: string;

  @ApiProperty({ enum: PRICE_GROUPS, enumName: 'PriceGroup', nullable: true, example: 'materials' })
  group!: (typeof PRICE_GROUPS)[number] | null;

  @ApiProperty({ enum: SUGGESTION_METHODS, enumName: 'SuggestionMethod', example: 'material_index' })
  method!: (typeof SUGGESTION_METHODS)[number];

  @valuesProperty('Suggested line (null when no method applies)', { ...VALUES, rate: '12.036000' }, true)
  suggestedValues!: Record<string, unknown> | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Series and points, ratios, peer count and percentiles — never another factory’s identity',
    example: {
      group: 'materials',
      primaryColumn: 'rate',
      index: {
        series: 'paper.art_card',
        then: { period: '2026-06', value: '100.000000' },
        now: { period: '2026-09', value: '102.000000' },
        ratio: '1.02',
      },
    },
  })
  basis!: Record<string, unknown>;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '3.8538',
    description: '(proposed − suggested) ÷ suggested × 100 on the primary value column',
  })
  deviationPct!: string | null;

  @ApiProperty({
    type: [String],
    example: [],
    description:
      'e.g. `above_band` (only once the band setting exists, D-172), `peers_below_minimum`, `driver_not_configured`, ' +
      '`index_not_configured`, `index_point_missing`, `no_approved_price`, `no_actuals`, `impact_only`',
  })
  flags!: string[];

  @ApiProperty({ format: 'date-time', example: TS })
  computedAt!: string;
}

export class PriceSuggestionsDto {
  @ApiProperty({ format: 'uuid', example: IDS.proposal })
  proposalId!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: TS })
  computedAt!: string | null;

  @ApiProperty({ type: [PriceLineSuggestionDto] })
  lines!: PriceLineSuggestionDto[];
}

/** What re-pricing the window's saved quotes with the proposed values gives (D-040 note); staff only (D-044). */
export class PriceSimulationResultDto {
  @ApiProperty({ type: 'integer', example: 0, description: 'Saved quotes re-priced' })
  quotesInWindow!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Change of the average quoted price, percent; null without quotes',
  })
  priceChangePct!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Change of Packio’s average margin, percentage points; null without quotes',
  })
  marginChangePct!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Change in how often this factory would have been selected, percentage points',
  })
  selectionShareChangePct!: string | null;
}

export class PriceSimulationDto {
  @IdField('0192f3a0-7c1e-7d2a-9b1f-00000000f605')
  id!: string;

  @ApiProperty({ format: 'uuid', example: IDS.proposal })
  proposalId!: string;

  @ApiProperty({ enum: JOB_STATUSES, enumName: 'JobStatus', example: 'succeeded' })
  status!: (typeof JOB_STATUSES)[number];

  @ApiProperty({ format: 'date-time', example: '2026-06-28T10:00:00+07:00' })
  windowFrom!: string;

  @ApiProperty({ format: 'date-time', example: TS })
  windowTo!: string;

  @ApiProperty({
    type: PriceSimulationResultDto,
    nullable: true,
    description:
      'Quotes re-priced, price and margin change, change in selection share (D-040 note); null until done',
  })
  result!: PriceSimulationResultDto | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  error!: string | null;

  @ApiProperty({ format: 'date-time', example: TS })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: TS })
  completedAt!: string | null;
}

export const SUGGESTIONS_EXAMPLE: PriceSuggestionsDto = {
  proposalId: IDS.proposal,
  computedAt: TS,
  lines: [
    {
      lineId: IDS.line,
      component: 'material_prices',
      lineKey: LINE_KEY,
      group: 'materials',
      method: 'material_index',
      suggestedValues: { ...VALUES, rate: '12.036000' },
      basis: {
        group: 'materials',
        primaryColumn: 'rate',
        index: {
          series: 'paper.art_card',
          then: { period: '2026-06', value: '100.000000' },
          now: { period: '2026-09', value: '102.000000' },
          ratio: '1.02',
        },
      },
      deviationPct: '3.8538',
      flags: [],
      computedAt: TS,
    },
  ],
};

export const SIMULATION_EXAMPLE: PriceSimulationDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-00000000f605',
  proposalId: IDS.proposal,
  status: 'succeeded',
  windowFrom: '2026-06-28T10:00:00+07:00',
  windowTo: TS,
  result: { quotesInWindow: 0, priceChangePct: null, marginChangePct: null, selectionShareChangePct: null },
  error: null,
  createdAt: TS,
  completedAt: TS,
};
