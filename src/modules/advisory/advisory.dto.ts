import { PageQuery } from '@common/pagination/pagination.dto';
import { DecimalField, EnumField, IntField, RefField } from '@modules/catalog/crud/dto-fields';
import { CORRUGATE_CONFIGURATION_EXAMPLE } from '@modules/pricing/quotes/corrugate.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { FRAGILITY_BANDS, HUMIDITY_BANDS, PALLET_PATTERNS, STORAGE_BANDS, TRANSPORT_MODES } from './rule-set';

/** Structure Advisor DTOs (U2.2, D-188, D-189, D-235–D-240): reason codes and numbers only, no prose. */

export const ADVISORY_IDS = {
  recommendation: '0192f3a0-7c1e-7d2a-9b1f-0000000ad101',
  board: '0192f3a0-7c1e-7d2a-9b1f-0000000ad102',
  strongerBoard: '0192f3a0-7c1e-7d2a-9b1f-0000000ad103',
  anonymous: '0192f3a0-7c1e-7d2a-9b1f-0000000ad104',
  choice: '0192f3a0-7c1e-7d2a-9b1f-0000000ad105',
  quote: '0192f3a0-7c1e-7d2a-9b1f-0000000ad106',
  user: '0192f3a0-7c1e-7d2a-9b1f-0000000ad107',
  factory: '0192f3a0-7c1e-7d2a-9b1f-0000000ad108',
  sheet: '0192f3a0-7c1e-7d2a-9b1f-0000000ad109',
};

export const OUTCOMES = ['recommended', 'no_board_meets_load'] as const;
export const OPTION_ROLES = ['recommended', 'cheapest', 'strongest', 'fastest', 'closest'] as const;
export const WARNING_CODES = ['no_board_meets_load', 'thin_margin', 'below_requirement'] as const;
export const FACTOR_NAMES = [
  'humidity',
  'storage',
  'palletPattern',
  'palletOverhang',
  'transport',
  'fragility',
] as const;
/** The fixed notice every recommendation carries (D-189): the figures are indicative, never a promise. */
export const NOTICE_CODE = 'advisory.indicative';

export class AdvisoryPalletDto {
  @EnumField(PALLET_PATTERNS, 'AdvisoryPalletPattern', { example: 'column' })
  pattern!: (typeof PALLET_PATTERNS)[number];

  @ApiProperty({ example: false, description: 'Boxes overhang the pallet edge' })
  @IsBoolean()
  overhang!: boolean;
}

export class AdvisoryLoadDto {
  @DecimalField({ example: 500, positive: true, scale: 2, unit: 'g', description: 'Product weight per unit' })
  @Max(100_000)
  productWeightG!: number;

  @IntField({ example: 10, min: 1, max: 10_000, description: 'Units packed in one box' })
  unitsPerBox!: number;

  @IntField({
    example: 4,
    min: 1,
    max: 100,
    description: 'Boxes in the tallest column, the bottom box included (across stacked pallets)',
  })
  stackLayers!: number;

  @ApiPropertyOptional({
    type: AdvisoryPalletDto,
    nullable: true,
    description: 'Omit or null: not palletised',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AdvisoryPalletDto)
  pallet?: AdvisoryPalletDto | null;

  @EnumField(FRAGILITY_BANDS, 'AdvisoryFragility', { example: 'low' })
  fragility!: (typeof FRAGILITY_BANDS)[number];

  @EnumField(TRANSPORT_MODES, 'AdvisoryTransportMode', { example: 'pallet_domestic' })
  transportMode!: (typeof TRANSPORT_MODES)[number];

  @EnumField(HUMIDITY_BANDS, 'AdvisoryHumidityBand', {
    example: 'normal',
    description: 'Storage humidity: dry ≤ 50 % RH, normal ≤ 70 %, humid ≤ 85 %, very_humid > 85 % (D-238)',
  })
  humidity!: (typeof HUMIDITY_BANDS)[number];

  @EnumField(STORAGE_BANDS, 'AdvisoryStorageBand', { example: 'up_to_30_days' })
  storage!: (typeof STORAGE_BANDS)[number];
}

export class RecommendDto {
  @ApiProperty({ example: 'corrugated', pattern: '^[a-z][a-z0-9_]*$' })
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z][a-z0-9_]*$/)
  productTypeCode!: string;

  @ApiProperty({
    description:
      'The corrugate configuration (`CorrugateConfigurationDto`, paths under `configuration`): style, basis, size, ' +
      'board, quantities. Every compatible board is priced with the same configuration.',
    example: CORRUGATE_CONFIGURATION_EXAMPLE,
  })
  @IsObject()
  configuration!: Record<string, unknown>;

  @ApiProperty({ type: AdvisoryLoadDto })
  @ValidateNested()
  @Type(() => AdvisoryLoadDto)
  load!: AdvisoryLoadDto;

  @ApiPropertyOptional({ example: '10110', pattern: '^[0-9]{5}$', description: 'Prices shipping (D-013)' })
  @IsOptional()
  @Matches(/^[0-9]{5}$/)
  deliveryPostcode?: string;
}

export class StoreRecommendDto extends RecommendDto {
  @ApiPropertyOptional({
    format: 'uuid',
    example: ADVISORY_IDS.anonymous,
    description: 'Configurator session id when not signed in',
  })
  @IsOptional()
  @IsUUID()
  anonymousId?: string;
}

export class ChooseBoardDto {
  @RefField({ example: ADVISORY_IDS.board, description: 'A board the recommendation lists' })
  materialId!: string;

  @ApiProperty({
    type: [String],
    enum: WARNING_CODES,
    enumName: 'AdvisoryWarningCode',
    example: [],
    description: 'Every warning code of the chosen board, acknowledged on record (D-189)',
  })
  @IsArray()
  @ArrayMaxSize(10)
  @IsIn(WARNING_CODES, { each: true })
  acknowledgedWarnings!: (typeof WARNING_CODES)[number][];

  @ApiPropertyOptional({ format: 'uuid', example: ADVISORY_IDS.anonymous })
  @IsOptional()
  @IsUUID()
  anonymousId?: string;
}

export class AnonymousQuery {
  @ApiPropertyOptional({ format: 'uuid', example: ADVISORY_IDS.anonymous })
  @IsOptional()
  @IsUUID()
  anonymousId?: string;
}

export class AdvisoryListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: OUTCOMES, enumName: 'AdvisoryOutcome', example: 'recommended' })
  @IsOptional()
  @IsIn(OUTCOMES)
  outcome?: (typeof OUTCOMES)[number];

  @ApiPropertyOptional({ format: 'uuid', example: ADVISORY_IDS.user, description: 'The customer' })
  @IsOptional()
  @IsUUID()
  customerId?: string;
}

// --- Views

export class AdvisoryBoardDto {
  @ApiProperty({ format: 'uuid', example: ADVISORY_IDS.board })
  id!: string;

  @ApiProperty({ example: 'ka125-b' })
  code!: string;

  @ApiProperty({ example: 'กระดาษลัง KA125 ลอน B' })
  nameTh!: string;

  @ApiProperty({ example: 'Kraft board KA125 B-flute' })
  nameEn!: string;

  @ApiProperty({ type: String, nullable: true, example: 'B' })
  fluteCode!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 3, description: '3 single wall, 5 double wall' })
  layers!: number | null;
}

export class BctRangeDto {
  @ApiProperty({ example: 1902.1, description: 'McKee estimate. Unit: N.' })
  estimate!: number;

  @ApiProperty({ example: 1616.8, description: 'Low end (decides). Unit: N.' })
  low!: number;

  @ApiProperty({ example: 2187.4, description: 'High end. Unit: N.' })
  high!: number;
}

export class AdvisoryOptionDto {
  @ApiProperty({ type: AdvisoryBoardDto })
  board!: AdvisoryBoardDto;

  @ApiProperty({ example: 5, description: 'From the partner’s signed sheet. Unit: kN/m.' })
  ectKnPerM!: number;

  @ApiProperty({ example: 3, description: 'Unit: mm.' })
  caliperMm!: number;

  @ApiProperty({ example: 450, description: 'Unit: g/m².' })
  grammageGsm!: number;

  @ApiProperty({ type: BctRangeDto })
  bct!: BctRangeDto;

  @ApiProperty({
    example: 1.42,
    description: 'ECT the low end would need to meet the requirement. Unit: kN/m.',
  })
  requiredEctKnPerM!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 252.2,
    description: 'Low end over the requirement, %; null with no top load',
  })
  marginPct!: number | null;

  @ApiProperty({ example: true })
  passes!: boolean;

  @ApiProperty({
    example: true,
    description: 'Priced instantly at the first quantity; false routes to CS (RFQ)',
  })
  instant!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '10.00',
    description: 'Per piece, incl. VAT, first quantity',
  })
  unitPrice!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '10700.00' })
  grossAmount!: string | null;

  @ApiProperty({
    enum: ['THB'],
    enumName: 'Currency',
    example: 'THB',
    description: 'Always THB (one currency)',
  })
  currency!: 'THB';

  @ApiProperty({ type: 'integer', nullable: true, example: 10 })
  leadTimeDays!: number | null;

  @ApiProperty({
    enum: OPTION_ROLES,
    enumName: 'AdvisoryOptionRole',
    isArray: true,
    example: ['recommended'],
  })
  roles!: (typeof OPTION_ROLES)[number][];

  @ApiProperty({ enum: WARNING_CODES, enumName: 'AdvisoryWarningCode', isArray: true, example: [] })
  warnings!: (typeof WARNING_CODES)[number][];
}

export class AdvisoryAlternativeDto {
  @ApiProperty({ format: 'uuid', example: ADVISORY_IDS.strongerBoard })
  boardId!: string;

  @ApiProperty({ enum: OPTION_ROLES, enumName: 'AdvisoryOptionRole', isArray: true, example: ['strongest'] })
  roles!: (typeof OPTION_ROLES)[number][];

  @ApiProperty({
    type: String,
    nullable: true,
    example: '5.20',
    description: 'Unit price minus the recommended',
  })
  unitPriceDelta!: string | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 2,
    description: 'Lead days minus the recommended',
  })
  leadTimeDeltaDays!: number | null;
}

export class AdvisoryFactorDto {
  @ApiProperty({ enum: FACTOR_NAMES, enumName: 'AdvisoryFactor', example: 'humidity' })
  factor!: (typeof FACTOR_NAMES)[number];

  @ApiProperty({ example: 'normal' })
  band!: string;

  @ApiProperty({ example: 0.8, description: 'Retained strength (0 < f ≤ 1)' })
  value!: number;
}

export class AdvisoryRequirementDto {
  @ApiProperty({ example: 1400, description: 'Inside perimeter. Unit: mm.' })
  perimeterMm!: number;

  @ApiProperty({ example: 0.711, description: 'Box weight (heaviest candidate board). Unit: kg.' })
  tareKg!: number;

  @ApiProperty({ example: 5.711, description: 'Unit: kg.' })
  boxWeightKg!: number;

  @ApiProperty({ type: 'integer', example: 4 })
  layers!: number;

  @ApiProperty({ example: 168.0, description: 'Load on the bottom box. Unit: N.' })
  loadN!: number;

  @ApiProperty({ type: [AdvisoryFactorDto] })
  factors!: AdvisoryFactorDto[];

  @ApiProperty({ example: 0.3672 })
  combinedFactor!: number;

  @ApiProperty({ example: 459.0, description: 'Unit: N.' })
  requiredBctN!: number;
}

export class AdvisoryReasonDto {
  @ApiProperty({
    example: 'factor',
    description:
      'Reason code: box_weight, top_load, factor, combined_factor, required_bct, no_top_load, cheapest_passing, ' +
      'no_instant_price, estimated_bct_low, estimated_bct_high, margin',
  })
  code!: string;

  @ApiPropertyOptional({ enum: FACTOR_NAMES, enumName: 'AdvisoryFactor', example: 'humidity' })
  factor?: (typeof FACTOR_NAMES)[number];

  @ApiPropertyOptional({ example: 'normal' })
  band?: string;

  @ApiPropertyOptional({ example: 0.8 })
  value?: number;

  @ApiPropertyOptional({ example: 'N' })
  unit?: string;
}

export class AdvisoryChoiceDto {
  @ApiProperty({ format: 'uuid', example: ADVISORY_IDS.choice })
  id!: string;

  @ApiProperty({ format: 'uuid', example: ADVISORY_IDS.board })
  boardId!: string;

  @ApiProperty({ enum: WARNING_CODES, enumName: 'AdvisoryWarningCode', isArray: true, example: [] })
  acknowledgedWarnings!: (typeof WARNING_CODES)[number][];

  @ApiProperty({ format: 'date-time', example: '2026-10-03T10:05:00+07:00' })
  chosenAt!: string;
}

export class RuleSetVersionRefDto {
  @ApiProperty({ type: 'integer', example: 1 })
  versionNo!: number;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T00:00:00+07:00' })
  effectiveFrom!: string;
}

export class AdvisoryRecommendationDto {
  @ApiProperty({ format: 'uuid', example: ADVISORY_IDS.recommendation })
  id!: string;

  @ApiProperty({ enum: OUTCOMES, enumName: 'AdvisoryOutcome', example: 'recommended' })
  outcome!: (typeof OUTCOMES)[number];

  @ApiProperty({ example: NOTICE_CODE, description: 'Fixed notice: the figures are indicative (D-189)' })
  noticeCode!: string;

  @ApiProperty({ example: '1.0.0' })
  engineVersion!: string;

  @ApiProperty({ type: RuleSetVersionRefDto })
  ruleSetVersion!: RuleSetVersionRefDto;

  @ApiProperty({ type: AdvisoryRequirementDto })
  requirement!: AdvisoryRequirementDto;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: ADVISORY_IDS.board })
  recommendedBoardId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  closestBoardId!: string | null;

  @ApiProperty({ type: [AdvisoryOptionDto], description: 'Every board evaluated, strongest first' })
  options!: AdvisoryOptionDto[];

  @ApiProperty({ type: [AdvisoryAlternativeDto] })
  alternatives!: AdvisoryAlternativeDto[];

  @ApiProperty({ enum: WARNING_CODES, enumName: 'AdvisoryWarningCode', isArray: true, example: [] })
  warnings!: (typeof WARNING_CODES)[number][];

  @ApiProperty({ type: [AdvisoryReasonDto] })
  reasons!: AdvisoryReasonDto[];

  @ApiProperty({ type: AdvisoryChoiceDto, nullable: true })
  choice!: AdvisoryChoiceDto | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T10:00:00+07:00' })
  createdAt!: string;
}

export class AdvisoryExcludedDto {
  @ApiProperty({ type: AdvisoryBoardDto })
  board!: AdvisoryBoardDto;

  @ApiProperty({
    example: 'no_board_data',
    description: 'No signed sheet in force for the producing factory',
  })
  reason!: string;
}

export class AdvisoryBoardDataDto {
  @ApiProperty({ format: 'uuid', example: ADVISORY_IDS.board })
  boardId!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: ADVISORY_IDS.sheet })
  sheetId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: ADVISORY_IDS.factory })
  factoryId!: string | null;

  @ApiProperty({
    example: 'priced_factory',
    description: 'Whose sheet: the factory that prices the option, the lowest sheet (unpriced) or none',
  })
  sheetSource!: string;
}

export class AdminAdvisoryRecommendationDto extends AdvisoryRecommendationDto {
  @ApiProperty({ example: 'web' })
  channel!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: ADVISORY_IDS.user })
  customerId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Anonymous configurator session' })
  anonymousId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'Staff evaluation',
  })
  createdById!: string | null;

  @ApiProperty({ type: [AdvisoryExcludedDto], description: 'Boards without board data (D-188), staff only' })
  excluded!: AdvisoryExcludedDto[];

  @ApiProperty({
    type: [AdvisoryBoardDataDto],
    description: 'Whose sheet each board used (D-236), staff only',
  })
  boardData!: AdvisoryBoardDataDto[];

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'The logged request and load inputs',
  })
  inputs!: Record<string, unknown>;

  @ApiProperty({ type: 'object', additionalProperties: true, description: 'The rule set value used' })
  ruleSet!: Record<string, unknown>;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    example: [ADVISORY_IDS.quote],
    description: 'Quotes saved from it',
  })
  quoteIds!: string[];

  @ApiProperty({ type: [AdvisoryChoiceDto], description: 'Every choice, newest first' })
  choices!: AdvisoryChoiceDto[];
}

export class ReplayResultDto {
  @ApiProperty({ example: true, description: 'The replay reproduced the logged output exactly (D-240)' })
  identical!: boolean;

  @ApiProperty({ type: [String], example: [], description: 'JSON paths that differ' })
  differences!: string[];

  @ApiProperty({ example: '1.0.0', description: 'Engine version of this replay' })
  engineVersion!: string;
}

export class AdvisoryMethodDto {
  @ApiProperty({ example: true, description: 'The advisor is open to customers and a rule set is in force' })
  available!: boolean;

  @ApiProperty({ example: NOTICE_CODE })
  noticeCode!: string;

  @ApiProperty({ example: '1.0.0' })
  engineVersion!: string;

  @ApiProperty({ type: RuleSetVersionRefDto, nullable: true })
  ruleSetVersion!: RuleSetVersionRefDto | null;

  @ApiProperty({
    example: { mckeeConstant: '5.87', uncertaintyPct: '15' },
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description:
      'The rule set in force (D-237): `mckeeConstant`, `uncertaintyPct`, `formulas`, `thinMarginPct` and ' +
      '`factors` per band — the same row the engine reads',
  })
  ruleSet!: Record<string, unknown> | null;
}

// --- Examples

const OPTION_EXAMPLE: AdvisoryOptionDto = {
  board: {
    id: ADVISORY_IDS.board,
    code: 'ka125-b',
    nameTh: 'กระดาษลัง KA125 ลอน B',
    nameEn: 'Kraft board KA125 B-flute',
    fluteCode: 'B',
    layers: 3,
  },
  ectKnPerM: 5,
  caliperMm: 3,
  grammageGsm: 450,
  bct: { estimate: 1902.1, low: 1616.8, high: 2187.4 },
  requiredEctKnPerM: 1.42,
  marginPct: 252.2,
  passes: true,
  instant: true,
  unitPrice: '10.00',
  grossAmount: '10700.00',
  currency: 'THB',
  leadTimeDays: 10,
  roles: ['recommended', 'cheapest'],
  warnings: [],
};

export const RECOMMENDATION_EXAMPLE: AdvisoryRecommendationDto = {
  id: ADVISORY_IDS.recommendation,
  outcome: 'recommended',
  noticeCode: NOTICE_CODE,
  engineVersion: '1.0.0',
  ruleSetVersion: { versionNo: 1, effectiveFrom: '2026-10-03T00:00:00+07:00' },
  requirement: {
    perimeterMm: 1400,
    tareKg: 0.711,
    boxWeightKg: 5.711,
    layers: 4,
    loadN: 168,
    factors: [
      { factor: 'humidity', band: 'normal', value: 0.8 },
      { factor: 'storage', band: 'up_to_30_days', value: 0.6 },
      { factor: 'palletPattern', band: 'column', value: 0.9 },
      { factor: 'palletOverhang', band: 'none', value: 1 },
      { factor: 'transport', band: 'pallet_domestic', value: 0.85 },
      { factor: 'fragility', band: 'low', value: 1 },
    ],
    combinedFactor: 0.3672,
    requiredBctN: 459,
  },
  recommendedBoardId: ADVISORY_IDS.board,
  closestBoardId: null,
  options: [OPTION_EXAMPLE],
  alternatives: [
    {
      boardId: ADVISORY_IDS.strongerBoard,
      roles: ['strongest'],
      unitPriceDelta: '5.20',
      leadTimeDeltaDays: 2,
    },
  ],
  warnings: [],
  reasons: [
    { code: 'top_load', value: 168, unit: 'N' },
    { code: 'factor', factor: 'humidity', band: 'normal', value: 0.8 },
    { code: 'required_bct', value: 459, unit: 'N' },
    { code: 'cheapest_passing' },
  ],
  choice: null,
  createdAt: '2026-10-03T10:00:00+07:00',
};

export const ADMIN_RECOMMENDATION_EXAMPLE: AdminAdvisoryRecommendationDto = {
  ...RECOMMENDATION_EXAMPLE,
  channel: 'web',
  customerId: ADVISORY_IDS.user,
  anonymousId: null,
  createdById: null,
  excluded: [],
  boardData: [
    {
      boardId: ADVISORY_IDS.board,
      sheetId: ADVISORY_IDS.sheet,
      factoryId: ADVISORY_IDS.factory,
      sheetSource: 'priced_factory',
    },
  ],
  inputs: { productTypeCode: 'corrugated' },
  ruleSet: { mckeeConstant: '5.87' },
  quoteIds: [ADVISORY_IDS.quote],
  choices: [],
};

export const CHOOSE_EXAMPLE = { materialId: ADVISORY_IDS.board, acknowledgedWarnings: [] };

export const RECOMMEND_EXAMPLE = {
  productTypeCode: 'corrugated',
  configuration: CORRUGATE_CONFIGURATION_EXAMPLE,
  load: {
    productWeightG: 500,
    unitsPerBox: 10,
    stackLayers: 4,
    pallet: { pattern: 'column', overhang: false },
    fragility: 'low',
    transportMode: 'pallet_domestic',
    humidity: 'normal',
    storage: 'up_to_30_days',
  },
};

export const METHOD_EXAMPLE: AdvisoryMethodDto = {
  available: true,
  noticeCode: NOTICE_CODE,
  engineVersion: '1.0.0',
  ruleSetVersion: { versionNo: 1, effectiveFrom: '2026-10-03T00:00:00+07:00' },
  ruleSet: {
    mckeeConstant: '5.87',
    uncertaintyPct: '15',
    formulas: ['rsc', 'full_overlap'],
    thinMarginPct: '10',
    factors: { humidity: { dry: '1', normal: '0.8', humid: '0.6', very_humid: '0.5' } },
  },
};
