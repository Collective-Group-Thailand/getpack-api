import { PageQuery } from '@common/pagination/pagination.dto';
import { LocalisedLabelDto } from '@modules/studio/studio.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { PRICE_REASONS, PUBLISH_REASONS } from './publishability';
import { SIZE_CLASSES } from './size-classes';

/** Style library staff DTOs (U3.B1, D-241–D-243). */

export const STYLE_IDS = {
  base: '0192f3a0-7c1e-7d2a-9b1f-0000000ae001',
  variant: '0192f3a0-7c1e-7d2a-9b1f-0000000ae002',
  recipe: '0192f3a0-7c1e-7d2a-9b1f-0000000ae003',
  run: '0192f3a0-7c1e-7d2a-9b1f-0000000ae004',
  user: '0192f3a0-7c1e-7d2a-9b1f-0000000ae005',
  approval: '0192f3a0-7c1e-7d2a-9b1f-0000000ae006',
  pattern: '0192f3a0-7c1e-7d2a-9b1f-0000000ae007',
};
const TS = '2026-10-03T10:00:00+07:00';
export const STYLE_STATUSES = ['active', 'retired'] as const;
export const IMPORT_KINDS = ['master', 'recipes'] as const;
export const NOOP_REASONS = ['same_checksum', 'no_changes'] as const;
export const IMPORT_STATUSES = ['applied', 'pending_approval', 'rejected'] as const;
export const NAME_APPROVER_ROLES = ['marketing', 'prepress'] as const;

export class StyleVariantCountsDto {
  @ApiProperty({ type: 'integer', example: 228 })
  total!: number;

  @ApiProperty({ type: 'integer', example: 228 })
  active!: number;

  @ApiProperty({ type: 'integer', example: 0 })
  publishable!: number;
}

/** The base's photo as curation sees it (D-426): the file, where it came from, its alt text. */
export class AdminStylePhotoDto {
  @ApiProperty({ format: 'uuid', example: STYLE_IDS.base })
  fileId!: string;

  @ApiProperty({
    example: 'getpack',
    description: '`getpack`: a photograph uploaded here; `ai-render`: an AI-rendered reference',
  })
  source!: string;

  @ApiProperty({ type: LocalisedLabelDto })
  alt!: LocalisedLabelDto;
}

export class SetStylePhotoDto {
  @ApiProperty({
    format: 'uuid',
    example: STYLE_IDS.base,
    description: 'Uploaded image file (purpose `image`)',
  })
  @IsUUID()
  fileId!: string;

  @ApiPropertyOptional({
    example: 'กล่องฝาเสียบ ตัวอย่างจริง',
    description: "Alt text; the base's Thai name without it",
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  altTh?: string;

  @ApiPropertyOptional({ example: 'Tuck-end carton, photographed sample' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  altEn?: string;
}

export class StyleNamesApprovalDto {
  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  marketingAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  prepressAt!: string | null;
}

export class AdminStyleBaseDto {
  @ApiProperty({ format: 'uuid', example: STYLE_IDS.base })
  id!: string;

  @ApiProperty({ example: 'PK-TE-01' })
  code!: string;

  @ApiProperty({ example: 'tuck_end' })
  family!: string;

  @ApiProperty({ example: 'folding_carton' })
  category!: string;

  @ApiProperty({ example: 'folding', description: 'As in the master file' })
  sourceProductType!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'folding_carton',
    description: 'Null: no pricing path yet',
  })
  productTypeCode!: string | null;

  @ApiProperty({ example: 'กล่องฝาเสียบ (ปรับฝาบน-ล่างได้)' })
  nameTh!: string;

  @ApiProperty({ example: 'Tuck-end carton (configurable ends)' })
  nameEn!: string;

  @ApiProperty({ example: 'paperboard' })
  materialClass!: string;

  @ApiProperty({ type: 'integer', example: 1 })
  wave!: number;

  @ApiProperty({ enum: STYLE_STATUSES, enumName: 'StyleStatus', example: 'active' })
  status!: (typeof STYLE_STATUSES)[number];

  @ApiProperty({ example: false })
  featured!: boolean;

  @ApiProperty({ example: false })
  hidden!: boolean;

  @ApiProperty({ type: 'integer', example: 0 })
  sort!: number;

  @ApiProperty({ type: StyleVariantCountsDto })
  variants!: StyleVariantCountsDto;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  publishedAt!: string | null;

  @ApiProperty({ type: StyleNamesApprovalDto })
  namesApproval!: StyleNamesApprovalDto;

  @ApiProperty({
    type: AdminStylePhotoDto,
    nullable: true,
    description: "The photo customers see on the style's card (D-426); null: the rendered thumbnail",
  })
  photo!: AdminStylePhotoDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'FEFCO 0201',
    description: 'Shown to customers only once verified (D-211)',
  })
  referenceCode!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  referenceVerifiedAt!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 1, description: 'Latest recipe version' })
  recipeVersion!: number | null;

  @ApiProperty({ example: false, description: 'A recipe version is approved by Prepress' })
  recipeApproved!: boolean;

  @ApiProperty({ type: 'integer', example: 1, description: 'Row version (the ETag / If-Match of curation)' })
  version!: number;
}

export class StyleRecipeDto {
  @ApiProperty({ format: 'uuid', example: STYLE_IDS.recipe })
  id!: string;

  @ApiProperty({ type: 'integer', example: 1 })
  version!: number;

  @ApiProperty({ example: '1.0' })
  schemaVersion!: string;

  @ApiProperty({ example: '9f2c…', description: 'sha256 of the canonical recipe JSON (hex)' })
  checksum!: string;

  @ApiProperty({ type: [String], example: ['die_cut_flatbed', 'folder_gluer_straight_line'] })
  processes!: string[];

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  approvedAt!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  approvedById!: string | null;

  @ApiProperty({ format: 'date-time', example: TS })
  createdAt!: string;
}

export class StyleReasonCountDto {
  @ApiProperty({ enum: PUBLISH_REASONS, enumName: 'StylePublishReason', example: 'no_recipe' })
  reason!: (typeof PUBLISH_REASONS)[number];

  @ApiProperty({ type: 'integer', example: 228, description: 'Active variants with this reason' })
  count!: number;
}

export class StyleSynonymDto {
  @ApiProperty({ enum: ['th', 'en'], enumName: 'LocaleCode', example: 'th' })
  locale!: 'th' | 'en';

  @ApiProperty({ example: 'กล่องครีม' })
  term!: string;
}

/**
 * Styles redesign C0: the per-style commercial data the /styles page shows (size search range, MOQ, sustainability
 * facts). Business data only — every field nullable, nothing derived; the later CSV import writes the same fields.
 */
export class StyleCommercialDto {
  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: null,
    description: 'Inside length, minimum. Unit: mm.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  fitMinLMm!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: null, description: 'Unit: mm.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  fitMaxLMm!: number | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: null,
    description: 'Inside width, minimum. Unit: mm.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  fitMinWMm!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: null, description: 'Unit: mm.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  fitMaxWMm!: number | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: null,
    description: 'Inside height, minimum. Unit: mm.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  fitMinHMm!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: null, description: 'Unit: mm.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  fitMaxHMm!: number | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: null,
    description: 'Minimum order quantity (pieces)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  moqUnits!: number | null;

  @ApiProperty({ type: Boolean, nullable: true, example: null })
  @IsOptional()
  @IsBoolean()
  recyclable!: boolean | null;

  @ApiProperty({ type: Boolean, nullable: true, example: null })
  @IsOptional()
  @IsBoolean()
  plasticFree!: boolean | null;

  @ApiProperty({ type: [String], example: [], description: 'Certification codes (snake_case), e.g. `fsc`' })
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(/^[a-z][a-z0-9_]*$/, { each: true })
  certifications!: string[];
}

/** C1e (DECISIONS-STAGE-A §13.2): how the size search reads a style. */
const SIZE_CLASS_DESCRIPTION =
  'C1e (DECISIONS-STAGE-A §13.2): how the size search reads the style — `box` (inside L × W × H as stated), `bag` ' +
  '(paper / plastic bags: width × gusset (depth) × height), `cylinder` (cups, bowls, tubes: diameter × diameter ' +
  "bounding square × height; the product's L × W is fitted inside the square) or `not_applicable` (labels, shrink " +
  'sleeves, tags, sleeves, inserts, flat folders: no fit range, left out of the size search, not counted as missing). ' +
  'Set by the fit-range backfill from the documented rule. Read-only.';

/** C0b/C1c: `style_bases.fit_range_source` values. */
export const FIT_RANGE_SOURCES = [
  'recipe',
  'standard_sizes',
  'production_envelope',
  'combined',
  'business',
] as const;
/** C1c: the backfill sources, in the fallback order (DECISIONS-STAGE-A §11.1). */
export const FIT_BACKFILL_SOURCE_VALUES = ['recipe', 'standard_sizes', 'production_envelope'] as const;
/** C1c: the data a backfill source read. */
export const FIT_BASIS_VALUES = [
  'recipe_size_range',
  'catalogue_standard_sizes',
  'recipe_presets',
  'calculator_size_rules',
  'engine_limits',
] as const;

/** C1c: where one bound of a backfilled fit range came from. */
export class FitRangeBoundSourceDto {
  @ApiProperty({ enum: FIT_BACKFILL_SOURCE_VALUES, enumName: 'StyleFitBackfillSource', example: 'recipe' })
  source!: (typeof FIT_BACKFILL_SOURCE_VALUES)[number];

  @ApiProperty({
    enum: FIT_BASIS_VALUES,
    enumName: 'StyleFitBasis',
    isArray: true,
    example: ['recipe_size_range'],
    description:
      'The data read: `recipe_size_range` (approved recipe solver range), `catalogue_standard_sizes` (standard sizes ' +
      "of the catalogue products of its pattern), `recipe_presets` (the approved recipe's preset sizes), " +
      "`calculator_size_rules` (its pattern's size rules), `engine_limits` (the dieline engine's limits)",
  })
  basis!: (typeof FIT_BASIS_VALUES)[number][];
}

/** C1c: the source of each bound (`style_bases.fit_range_bounds`). */
export class FitRangeBoundSourcesDto {
  @ApiProperty({ type: FitRangeBoundSourceDto })
  fitMinLMm!: FitRangeBoundSourceDto;

  @ApiProperty({ type: FitRangeBoundSourceDto })
  fitMaxLMm!: FitRangeBoundSourceDto;

  @ApiProperty({ type: FitRangeBoundSourceDto })
  fitMinWMm!: FitRangeBoundSourceDto;

  @ApiProperty({ type: FitRangeBoundSourceDto })
  fitMaxWMm!: FitRangeBoundSourceDto;

  @ApiProperty({ type: FitRangeBoundSourceDto })
  fitMinHMm!: FitRangeBoundSourceDto;

  @ApiProperty({ type: FitRangeBoundSourceDto })
  fitMaxHMm!: FitRangeBoundSourceDto;
}

export class AdminStyleBaseDetailDto extends AdminStyleBaseDto {
  @ApiProperty({ example: 'Four side panels + glue flap; …' })
  construction!: string;

  @ApiProperty({ type: [String], example: ['tuck_top', 'tuck_bottom', 'hang', 'window'] })
  variantAxes!: string[];

  @ApiProperty({ type: String, nullable: true, example: 'M' })
  complexity!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'instant_after_signoff' })
  pricingPathAtLaunch!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: STYLE_IDS.pattern,
    description: 'Linked pattern (same style code)',
  })
  patternId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  descriptionTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  descriptionEn!: string | null;

  @ApiProperty({ type: [StyleSynonymDto] })
  synonyms!: StyleSynonymDto[];

  @ApiProperty({ type: [String], example: ['cosmetics'] })
  useCases!: string[];

  @ApiProperty({ type: [StyleRecipeDto], description: 'Newest first' })
  recipes!: StyleRecipeDto[];

  @ApiProperty({
    type: [StyleReasonCountDto],
    description: 'Why active variants are not publishable (D-243)',
  })
  reasonCounts!: StyleReasonCountDto[];

  @ApiProperty({
    type: StyleCommercialDto,
    description: 'Commercial data shown on /styles (styles redesign C0)',
  })
  commercial!: StyleCommercialDto;

  @ApiProperty({
    enum: FIT_RANGE_SOURCES,
    enumName: 'StyleFitRangeSource',
    nullable: true,
    example: null,
    description:
      'Where the fit range in `commercial` came from (C0b/C1c, DECISIONS-STAGE-A §9.1, §11.1): a backfill source — ' +
      "`recipe` (approved recipe range), `standard_sizes` (the style's standard sizes), `production_envelope` " +
      '(calculator size rules ∩ dieline engine limits) or `combined` (bounds from several; see `fitRangeBounds`) — ' +
      'replaced by any value curation saves; `business` = entered by curation / the CSV, never overwritten by the ' +
      'backfill; null = no range. Read-only.',
  })
  fitRangeSource!: (typeof FIT_RANGE_SOURCES)[number] | null;

  @ApiProperty({
    type: FitRangeBoundSourcesDto,
    nullable: true,
    description:
      'C1c: for a backfilled range, the source and basis of each of the six bounds; null for a business range or none. ' +
      'Read-only.',
  })
  fitRangeBounds!: FitRangeBoundSourcesDto | null;

  @ApiProperty({
    enum: SIZE_CLASSES,
    enumName: 'StyleSizeClass',
    example: 'box',
    description: SIZE_CLASS_DESCRIPTION,
  })
  sizeClass!: (typeof SIZE_CLASSES)[number];
}

/** C0b: `POST /v1/admin/styles/actions/backfill-fit-ranges`. */
export class FitRangeBackfillDto {
  @ApiPropertyOptional({
    type: Boolean,
    default: false,
    example: true,
    description: 'Report what would change without writing',
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

/** C1c: the fit range a backfill run sets (inside mm, all six bounds). */
export class FitRangeValuesDto {
  @ApiProperty({ type: 'integer', example: 60 })
  fitMinLMm!: number;

  @ApiProperty({ type: 'integer', example: 400 })
  fitMaxLMm!: number;

  @ApiProperty({ type: 'integer', example: 50 })
  fitMinWMm!: number;

  @ApiProperty({ type: 'integer', example: 300 })
  fitMaxWMm!: number;

  @ApiProperty({ type: 'integer', example: 25 })
  fitMinHMm!: number;

  @ApiProperty({ type: 'integer', example: 35 })
  fitMaxHMm!: number;
}

/** C1c: one style the run fills or refreshes (the dry-run preview); C1e: or clears / classifies. */
export class FitRangeChangeDto {
  @ApiProperty({ type: String, format: 'uuid', example: STYLE_IDS.base })
  styleId!: string;

  @ApiProperty({ example: 'PK-SP-01' })
  code!: string;

  @ApiProperty({
    enum: ['filled', 'refreshed', 'cleared', 'classified'],
    enumName: 'StyleFitRangeChangeAction',
    example: 'filled',
    description:
      '`filled` (empty → range), `refreshed` (a backfilled range follows newer data), `cleared` (C1e: a backfilled ' +
      'range removed because size search does not apply), `classified` (C1e: only the size class changes)',
  })
  action!: 'filled' | 'refreshed' | 'cleared' | 'classified';

  @ApiProperty({ type: FitRangeValuesDto, nullable: true, description: 'The range before (null = empty)' })
  before!: FitRangeValuesDto | null;

  @ApiProperty({ type: FitRangeValuesDto, nullable: true, description: 'The range after (null = empty)' })
  after!: FitRangeValuesDto | null;

  @ApiProperty({
    enum: FIT_RANGE_SOURCES,
    enumName: 'StyleFitRangeSource',
    nullable: true,
    example: 'combined',
    description: 'Source of the range after (null = no range)',
  })
  source!: (typeof FIT_RANGE_SOURCES)[number] | null;

  @ApiProperty({
    type: FitRangeBoundSourcesDto,
    nullable: true,
    description: "Each bound's source when the run writes a range; null otherwise",
  })
  bounds!: FitRangeBoundSourcesDto | null;

  @ApiProperty({
    enum: SIZE_CLASSES,
    enumName: 'StyleSizeClass',
    example: 'box',
    description: 'C1e: size class before',
  })
  sizeClassBefore!: (typeof SIZE_CLASSES)[number];

  @ApiProperty({
    enum: SIZE_CLASSES,
    enumName: 'StyleSizeClass',
    example: 'bag',
    description: 'C1e: size class after',
  })
  sizeClass!: (typeof SIZE_CLASSES)[number];
}

/** C1c: a style the run cannot fill, and why. */
export class FitRangeIncompleteDto {
  @ApiProperty({ example: 'PK-LA-01' })
  code!: string;

  @ApiProperty({
    type: [String],
    example: ['fitMinHMm', 'fitMaxHMm'],
    description: 'Bounds no source gives (`fitMinLMm` … `fitMaxHMm`)',
  })
  missing!: string[];

  @ApiProperty({
    type: [String],
    example: [],
    description:
      'Dimensions (`length`, `width`, `height`) whose bounds, as the sources give them, leave no size',
  })
  conflicting!: string[];
}

export class FitRangeSourceCountsDto {
  @ApiProperty({ type: 'integer', example: 81 })
  recipe!: number;

  @ApiProperty({ type: 'integer', example: 0 })
  standard_sizes!: number;

  @ApiProperty({ type: 'integer', example: 0 })
  production_envelope!: number;
}

export class FitRangeSummaryCountsDto extends FitRangeSourceCountsDto {
  @ApiProperty({ type: 'integer', example: 9 })
  combined!: number;
}

/** C1e: styles per size class. */
export class FitRangeSizeClassCountsDto {
  @ApiProperty({ type: 'integer', example: 103 })
  box!: number;

  @ApiProperty({ type: 'integer', example: 10 })
  bag!: number;

  @ApiProperty({ type: 'integer', example: 3 })
  cylinder!: number;

  @ApiProperty({ type: 'integer', example: 6 })
  not_applicable!: number;
}

/** C1e: the size search's coverage — styles it applies to, and how many of them have a complete range. */
export class FitRangeCoverageDto {
  @ApiProperty({ type: 'integer', example: 101, description: 'Active styles whose size search applies' })
  applicable!: number;

  @ApiProperty({
    type: 'integer',
    example: 93,
    description: 'Of those, styles with all six bounds after the run (backfilled or business)',
  })
  withRange!: number;
}

export class FitRangeBackfillResult {
  @ApiProperty({ example: false })
  dryRun!: boolean;

  @ApiProperty({ type: 'integer', example: 122, description: 'Active styles' })
  considered!: number;

  @ApiProperty({
    type: [String],
    example: ['PK-CB-01'],
    description: 'Codes whose empty range was filled',
  })
  filled!: string[];

  @ApiProperty({
    type: [String],
    example: [],
    description: 'Codes whose backfilled range followed newer data (or gained its per-bound sources)',
  })
  refreshed!: string[];

  @ApiProperty({
    type: [String],
    example: ['PK-SP-12'],
    description: 'C1e: codes whose backfilled range is removed because size search does not apply to them',
  })
  cleared!: string[];

  @ApiProperty({
    type: [String],
    example: [],
    description: 'C1e: codes whose size class changes while their range stays as it is',
  })
  classified!: string[];

  @ApiProperty({ type: 'integer', example: 0, description: 'Backfilled ranges already in place' })
  unchanged!: number;

  @ApiProperty({
    type: [String],
    example: [],
    description: 'Codes left alone because the business entered their range',
  })
  keptBusiness!: string[];

  @ApiProperty({
    type: [String],
    example: ['PK-LA-01'],
    deprecated: true,
    description:
      'Codes no source gives a complete range (stay out of the size search) — same as `incomplete[].code`',
  })
  noRecipeRange!: string[];

  @ApiProperty({
    type: [FitRangeIncompleteDto],
    description:
      'C1c: styles left empty, with what is missing (C1e: never a style whose size search does not apply)',
  })
  incomplete!: FitRangeIncompleteDto[];

  @ApiProperty({
    type: [String],
    example: ['PK-LA-01', 'PK-SP-12'],
    description: 'C1e: codes whose size search does not apply (no range; not counted as missing)',
  })
  notApplicable!: string[];

  @ApiProperty({ type: FitRangeSizeClassCountsDto, description: 'C1e: active styles per size class' })
  bySizeClass!: FitRangeSizeClassCountsDto;

  @ApiProperty({
    type: FitRangeCoverageDto,
    description: 'C1e: applicable styles with a range / applicable styles',
  })
  coverage!: FitRangeCoverageDto;

  @ApiProperty({
    type: FitRangeSummaryCountsDto,
    description: 'C1c: backfilled styles (filled, refreshed or unchanged) per summary source',
  })
  bySource!: FitRangeSummaryCountsDto;

  @ApiProperty({ type: FitRangeSourceCountsDto, description: 'C1c: backfilled bounds per source' })
  boundsBySource!: FitRangeSourceCountsDto;

  @ApiProperty({
    type: [FitRangeChangeDto],
    description: 'C1c: what the run writes (or, with `dryRun`, would write)',
  })
  changes!: FitRangeChangeDto[];
}

export class AdminStyleVariantDto {
  @ApiProperty({ format: 'uuid', example: STYLE_IDS.variant })
  id!: string;

  @ApiProperty({ example: 'PK-TE-01-K7QD' })
  code!: string;

  @ApiProperty({ example: 'tuck_top=reverse_tuck;tuck_bottom=crash_lock;hang=none;window=none' })
  optionKey!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { tuck_top: 'reverse_tuck', tuck_bottom: 'crash_lock', hang: 'none', window: 'none' },
  })
  options!: Record<string, unknown>;

  @ApiProperty({ example: false })
  publishable!: boolean;

  @ApiProperty({
    enum: PUBLISH_REASONS,
    enumName: 'StylePublishReason',
    isArray: true,
    example: ['no_recipe'],
  })
  reasons!: (typeof PUBLISH_REASONS)[number][];

  @ApiProperty({ enum: ['instant', 'rfq'], enumName: 'QuoteMode', example: 'rfq', description: 'D-266' })
  pricePath!: 'instant' | 'rfq';

  @ApiProperty({
    enum: PRICE_REASONS,
    enumName: 'StylePriceReason',
    isArray: true,
    example: ['calculator_not_signed'],
  })
  priceReasons!: (typeof PRICE_REASONS)[number][];

  @ApiProperty({ enum: STYLE_STATUSES, enumName: 'StyleStatus', example: 'active' })
  status!: (typeof STYLE_STATUSES)[number];

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  publishedAt!: string | null;
}

export class StyleImportRunDto {
  @ApiProperty({ format: 'uuid', example: STYLE_IDS.run })
  id!: string;

  @ApiProperty({ enum: IMPORT_KINDS, enumName: 'StyleImportKind', example: 'master' })
  kind!: (typeof IMPORT_KINDS)[number];

  @ApiProperty({ example: 'style-library-master.json' })
  fileName!: string;

  @ApiProperty({ example: 'b1946ac9…', description: 'sha256 of the file (hex)' })
  checksum!: string;

  @ApiProperty({ enum: IMPORT_STATUSES, enumName: 'StyleImportStatus', example: 'applied' })
  status!: (typeof IMPORT_STATUSES)[number];

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Counts and the changes applied / held for approval',
    example: { summary: { basesCreated: 105, variantsCreated: 960 } },
  })
  diff!: Record<string, unknown>;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  approvalRequestId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: STYLE_IDS.user })
  createdById!: string | null;

  @ApiProperty({ format: 'date-time', example: TS })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: TS })
  decidedAt!: string | null;
}

export class AdminStyleQuery extends PageQuery {
  @ApiPropertyOptional({ example: 'folding_carton' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

  @ApiPropertyOptional({ enum: STYLE_STATUSES, enumName: 'StyleStatus', example: 'active' })
  @IsOptional()
  @IsIn(STYLE_STATUSES)
  status?: (typeof STYLE_STATUSES)[number];

  @ApiPropertyOptional({
    example: true,
    description: 'Only bases with (true) or without (false) a publishable variant',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  published?: boolean;
}

export class AdminStyleVariantQuery extends PageQuery {
  @ApiPropertyOptional({ enum: PUBLISH_REASONS, enumName: 'StylePublishReason', example: 'no_recipe' })
  @IsOptional()
  @IsIn(PUBLISH_REASONS)
  reason?: (typeof PUBLISH_REASONS)[number];
}

export class ApproveNamesDto {
  @ApiProperty({
    enum: NAME_APPROVER_ROLES,
    enumName: 'StyleNameApproverRole',
    example: 'marketing',
    description: 'Which approval this is (D-212): Marketing for the wording, Prepress for technical terms',
  })
  @IsIn(NAME_APPROVER_ROLES)
  as!: (typeof NAME_APPROVER_ROLES)[number];
}

export class VerifyReferenceDto {
  @ApiProperty({ example: 'FEFCO 0201', description: 'Must equal the base’s current reference code' })
  @IsString()
  @MaxLength(64)
  @Matches(/\S/)
  referenceCode!: string;
}

export const ADMIN_STYLE_EXAMPLE: AdminStyleBaseDto = {
  id: STYLE_IDS.base,
  code: 'PK-TE-01',
  family: 'tuck_end',
  category: 'folding_carton',
  sourceProductType: 'folding',
  productTypeCode: 'folding_carton',
  nameTh: 'กล่องฝาเสียบ (ปรับฝาบน-ล่างได้)',
  nameEn: 'Tuck-end carton (configurable ends)',
  materialClass: 'paperboard',
  wave: 1,
  status: 'active',
  featured: false,
  hidden: false,
  sort: 0,
  variants: { total: 228, active: 228, publishable: 0 },
  publishedAt: null,
  namesApproval: { marketingAt: null, prepressAt: null },
  photo: null,
  referenceCode: null,
  referenceVerifiedAt: null,
  recipeVersion: null,
  recipeApproved: false,
  version: 1,
};

export const ADMIN_STYLE_DETAIL_EXAMPLE: AdminStyleBaseDetailDto = {
  ...ADMIN_STYLE_EXAMPLE,
  construction: 'Four side panels + glue flap; top and bottom closures chosen from the tuck/lock/seal set.',
  variantAxes: ['tuck_top', 'tuck_bottom', 'hang', 'window'],
  complexity: 'M',
  pricingPathAtLaunch: 'instant_after_signoff',
  patternId: null,
  descriptionTh: null,
  descriptionEn: null,
  synonyms: [],
  useCases: [],
  recipes: [],
  reasonCounts: [
    { reason: 'no_recipe', count: 228 },
    { reason: 'names_not_approved', count: 228 },
    { reason: 'not_makeable', count: 228 },
  ],
  commercial: {
    fitMinLMm: null,
    fitMaxLMm: null,
    fitMinWMm: null,
    fitMaxWMm: null,
    fitMinHMm: null,
    fitMaxHMm: null,
    moqUnits: null,
    recyclable: null,
    plasticFree: null,
    certifications: [],
  },
  fitRangeSource: null,
  fitRangeBounds: null,
  sizeClass: 'box',
};

export const ADMIN_VARIANT_EXAMPLE: AdminStyleVariantDto = {
  id: STYLE_IDS.variant,
  code: 'PK-TE-01-K7QD',
  optionKey: 'tuck_top=reverse_tuck;tuck_bottom=crash_lock;hang=none;window=none',
  options: { tuck_top: 'reverse_tuck', tuck_bottom: 'crash_lock', hang: 'none', window: 'none' },
  publishable: false,
  reasons: ['no_recipe', 'names_not_approved', 'not_makeable'],
  pricePath: 'rfq',
  priceReasons: ['calculator_not_signed', 'option_not_priced'],
  status: 'active',
  publishedAt: null,
};

export const IMPORT_RUN_EXAMPLE: StyleImportRunDto = {
  id: STYLE_IDS.run,
  kind: 'master',
  fileName: 'style-library-master.json',
  checksum: 'b1946ac92492d2347c6235b4d2611184',
  status: 'applied',
  diff: { summary: { basesCreated: 105, variantsCreated: 960 } },
  approvalRequestId: null,
  createdById: STYLE_IDS.user,
  createdAt: TS,
  decidedAt: TS,
};

export class StyleSynonymInputDto {
  @ApiProperty({ enum: ['th', 'en'], enumName: 'LocaleCode', example: 'th' })
  @IsIn(['th', 'en'])
  locale!: 'th' | 'en';

  @ApiProperty({ example: 'กล่องครีม' })
  @IsString()
  @MaxLength(80)
  @Matches(/\S/)
  term!: string;
}

/** D-246 curation; a name change clears both name approvals (D-212). */
export class UpdateStyleDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @ApiPropertyOptional({ example: false, description: 'Hidden styles are never published (D-243)' })
  @IsOptional()
  @IsBoolean()
  hidden?: boolean;

  @ApiPropertyOptional({ type: 'integer', example: 10, minimum: 0, maximum: 100000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  sort?: number;

  @ApiPropertyOptional({ example: 'กล่องฝาเสียบ' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/\S/)
  nameTh?: string;

  @ApiPropertyOptional({ example: 'Tuck-end carton' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/\S/)
  nameEn?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'กล่องกระดาษพับสำหรับเครื่องสำอาง' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  descriptionTh?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'A folding carton for cosmetics' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  descriptionEn?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'other',
    description: 'The getpack product type it is sold as (null: none — not publishable)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/)
  productTypeCode?: string | null;

  @ApiPropertyOptional({ type: [StyleSynonymInputDto], description: 'Replaces the search synonyms' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => StyleSynonymInputDto)
  synonyms?: StyleSynonymInputDto[];

  @ApiPropertyOptional({
    type: [String],
    example: ['cosmetics'],
    description: 'Replaces the use cases (snake_case)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @Matches(/^[a-z][a-z0-9_]*$/, { each: true })
  useCases?: string[];

  @ApiPropertyOptional({
    type: StyleCommercialDto,
    description:
      'Replaces the commercial data shown on /styles (styles redesign C0): every field, null = unknown. Each min ' +
      'must not exceed its max.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => StyleCommercialDto)
  commercial?: StyleCommercialDto;
}

/** D-411: a style library file uploaded through the admin (purpose `import`, JSON), previewed or confirmed. */
export class StyleImportFileDto {
  @ApiProperty({ enum: IMPORT_KINDS, enumName: 'StyleImportKind', example: 'master' })
  @IsIn(IMPORT_KINDS)
  kind!: (typeof IMPORT_KINDS)[number];

  @ApiProperty({
    format: 'uuid',
    example: STYLE_IDS.run,
    description: 'An uploaded file (`purpose: import`, JSON)',
  })
  @IsUUID()
  fileId!: string;
}

export class ConfirmStyleImportDto extends StyleImportFileDto {
  @ApiProperty({
    example: 'b1946ac92492d2347c6235b4d26111840a4c8e12f0e3a1d6c5b2e9f7a8d4c3b2',
    description:
      'The `checksum` of the preview being confirmed: a file or library that changed since is refused',
  })
  @Matches(/^[0-9a-f]{64}$/)
  checksum!: string;
}

export class StyleImportPreviewDto {
  @ApiProperty({ enum: IMPORT_KINDS, enumName: 'StyleImportKind', example: 'master' })
  kind!: (typeof IMPORT_KINDS)[number];

  @ApiProperty({ example: 'style-library-master.json' })
  fileName!: string;

  @ApiProperty({ example: 'b1946ac9…', description: 'sha256 of the file (hex) — confirm with it' })
  checksum!: string;

  @ApiProperty({ example: false, description: 'Nothing would change (the same file, or no differences)' })
  noop!: boolean;

  @ApiProperty({
    enum: NOOP_REASONS,
    enumName: 'StyleImportNoopReason',
    nullable: true,
    example: null,
  })
  noopReason!: 'same_checksum' | 'no_changes' | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'integer' },
    example: { basesCreated: 0, basesUpdated: 122, basesRetired: 1, variantsCreated: 0 },
  })
  summary!: Record<string, number>;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Changes applied at once (unpublished rows)',
    example: [{ op: 'base.create', code: 'PK-SP-26', variants: 1 }],
  })
  direct!: Record<string, unknown>[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description:
      'Changes to published rows, held for the `style_library_change` approval (Prepress, then Marketing)',
    example: [{ op: 'base.retire', code: 'PK-SP-25' }],
  })
  pending!: Record<string, unknown>[];
}

export class StyleImportResultDto {
  @ApiProperty({ type: StyleImportRunDto, nullable: true, description: 'The run; null when nothing changed' })
  run!: StyleImportRunDto | null;

  @ApiProperty({
    enum: NOOP_REASONS,
    enumName: 'StyleImportNoopReason',
    nullable: true,
    example: null,
  })
  noopReason!: 'same_checksum' | 'no_changes' | null;
}

export const IMPORT_PREVIEW_EXAMPLE: StyleImportPreviewDto = {
  kind: 'master',
  fileName: 'style-library-master.json',
  checksum: 'b1946ac92492d2347c6235b4d26111840a4c8e12f0e3a1d6c5b2e9f7a8d4c3b2',
  noop: false,
  noopReason: null,
  summary: { basesCreated: 0, basesUpdated: 122, basesRetired: 1, variantsCreated: 0 },
  direct: [],
  pending: [{ op: 'base.retire', code: 'PK-SP-25' }],
};
