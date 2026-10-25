import { CursorMeta, CursorQuery } from '@common/pagination/pagination.dto';
import { SPEC_LABEL_EXAMPLE, SpecLabelDto } from '@modules/quotes/line-summary.dto';
import { LocalisedLabelDto } from '@modules/studio/studio.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { PRICE_REASONS } from './publishability';

/** Store style library DTOs (U3.B2, D-245, D-246): published styles only, never a factory identity (D-050). */

export const PRICE_PATHS = ['instant', 'rfq'] as const;
export const STYLE_SORTS = ['relevance', 'popular', 'new', 'instant_first', 'name'] as const;
const CODE = /^PK-[A-Z0-9]{2,8}-[0-9]{2,3}$/;
const FACET_VALUE = /^[a-z0-9_]+(:[a-z0-9_]+)?$/;
const TS = '2026-10-03T10:00:00+07:00';

export class StyleListQuery extends CursorQuery {
  @ApiPropertyOptional({
    example: 'กล่องครีม',
    description: 'Thai / English search over names, codes and synonyms (typos tolerated)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ example: 'folding_carton' })
  @IsOptional()
  @Matches(FACET_VALUE)
  category?: string;

  @ApiPropertyOptional({ example: 'tuck_end' })
  @IsOptional()
  @Matches(FACET_VALUE)
  family?: string;

  @ApiPropertyOptional({ example: 'tuck_bottom:crash_lock', description: 'A closure option `axis:value`' })
  @IsOptional()
  @Matches(FACET_VALUE)
  closure?: string;

  @ApiPropertyOptional({ example: 'window:front_window', description: 'A feature option `axis:value`' })
  @IsOptional()
  @Matches(FACET_VALUE)
  feature?: string;

  @ApiPropertyOptional({ example: 'cosmetics' })
  @IsOptional()
  @Matches(FACET_VALUE)
  useCase?: string;

  @ApiPropertyOptional({ example: 'paperboard' })
  @IsOptional()
  @Matches(FACET_VALUE)
  materialClass?: string;

  @ApiPropertyOptional({ enum: PRICE_PATHS, enumName: 'QuoteMode', example: 'instant' })
  @IsOptional()
  @IsIn(PRICE_PATHS)
  pricePath?: (typeof PRICE_PATHS)[number];

  @ApiPropertyOptional({
    enum: STYLE_SORTS,
    enumName: 'StyleSort',
    example: 'popular',
    description: 'Default: relevance with `q`, else popular',
  })
  @IsOptional()
  @IsIn(STYLE_SORTS)
  sort?: (typeof STYLE_SORTS)[number];
}

export class CompareQuery {
  @ApiProperty({
    type: String,
    example: 'PK-TE-01,PK-RSC-01',
    description: 'Up to 3 style codes, comma-separated (D-246)',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').map((v) => v.trim()) : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @Matches(CODE, { each: true })
  codes!: string[];
}

export class StylePriceDto {
  @ApiProperty({ example: '4.85', description: 'Per piece incl. VAT, excluding delivery and design (D-220)' })
  unitPrice!: string;

  @ApiProperty({
    enum: ['THB'],
    enumName: 'Currency',
    example: 'THB',
    description: 'Always THB (one currency)',
  })
  currency!: 'THB';

  @ApiProperty({ type: 'integer', example: 1000, description: 'The quantity this price assumes' })
  quantity!: number;

  @ApiProperty({
    example: 'dev-tuck-end-box',
    description: 'The catalogue product whose reference configuration was priced',
  })
  catalogProductSlug!: string;

  @ApiProperty({ format: 'date-time', example: TS })
  computedAt!: string;

  @ApiProperty({
    type: SpecLabelDto,
    example: SPEC_LABEL_EXAMPLE,
    description: 'The spec this price is for, as one string (D-441)',
  })
  label!: SpecLabelDto;
}

/** The style's photo (D-426): what the card shows, with its alt text. */
export class StylePhotoDto {
  @ApiProperty({ example: '/v1/store/catalog/images/0192f3a0-7c1e-7d2a-9b1f-00000000c009' })
  url!: string;

  @ApiProperty({ type: LocalisedLabelDto })
  alt!: LocalisedLabelDto;
}

export class StyleCardDto {
  @ApiProperty({ example: 'PK-TE-01' })
  code!: string;

  @ApiProperty({ example: 'กล่องฝาเสียบ (ปรับฝาบน-ล่างได้)' })
  nameTh!: string;

  @ApiProperty({ example: 'Tuck-end carton (configurable ends)' })
  nameEn!: string;

  @ApiProperty({ example: 'folding_carton' })
  category!: string;

  @ApiProperty({ example: 'tuck_end' })
  family!: string;

  @ApiProperty({ example: 'paperboard' })
  materialClass!: string;

  @ApiProperty({ enum: PRICE_PATHS, enumName: 'QuoteMode', example: 'instant' })
  pricePath!: (typeof PRICE_PATHS)[number];

  @ApiProperty({ type: 'integer', example: 228, description: 'Publishable variants' })
  variantCount!: number;

  @ApiProperty({ example: false })
  featured!: boolean;

  @ApiProperty({ type: StylePriceDto, nullable: true, description: 'Null without a price hint (D-220)' })
  startingPrice!: StylePriceDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Only once Prepress verified it (D-211)',
  })
  referenceCode!: string | null;

  @ApiProperty({ type: Boolean, nullable: true, example: null, description: 'Null when not signed in' })
  favourite!: boolean | null;

  @ApiProperty({
    type: [String],
    example: ['tuck_bottom:crash_lock', 'window:front_window', 'hang:euro_slot'],
    description:
      'The options its shown variants offer, `axis:value` (never `none`): closures first, then features — the chips on a card',
  })
  options!: string[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description:
      "The style's picture: its photo when it has one, else a rendered thumbnail (its first variant's); null before either exists",
  })
  thumbnailUrl!: string | null;

  @ApiProperty({ type: StylePhotoDto, nullable: true, example: null })
  photo!: StylePhotoDto | null;
}

export class StyleFacetValueDto {
  @ApiProperty({ example: 'folding_carton' })
  value!: string;

  @ApiProperty({ type: 'integer', example: 12 })
  count!: number;
}

export class StyleFacetsDto {
  @ApiProperty({ type: [StyleFacetValueDto] })
  category!: StyleFacetValueDto[];

  @ApiProperty({ type: [StyleFacetValueDto] })
  family!: StyleFacetValueDto[];

  @ApiProperty({ type: [StyleFacetValueDto], description: 'Closure options `axis:value`' })
  closure!: StyleFacetValueDto[];

  @ApiProperty({ type: [StyleFacetValueDto], description: 'Feature options `axis:value`' })
  feature!: StyleFacetValueDto[];

  @ApiProperty({ type: [StyleFacetValueDto] })
  useCase!: StyleFacetValueDto[];

  @ApiProperty({ type: [StyleFacetValueDto] })
  materialClass!: StyleFacetValueDto[];

  @ApiProperty({ type: [StyleFacetValueDto] })
  pricePath!: StyleFacetValueDto[];
}

export class StyleListDto {
  @ApiProperty({ type: [StyleCardDto] })
  data!: StyleCardDto[];

  @ApiProperty({ type: StyleFacetsDto, description: 'Counts over the styles matching the query and filters' })
  facets!: StyleFacetsDto;

  @ApiProperty({ type: CursorMeta })
  meta!: CursorMeta;
}

export class StyleAxisDto {
  @ApiProperty({ example: 'tuck_bottom' })
  axis!: string;

  @ApiProperty({
    type: [String],
    example: ['tuck', 'crash_lock'],
    description: 'Values with a publishable variant',
  })
  values!: string[];

  @ApiProperty({ example: false, description: 'Any combination of the values (pouch features)' })
  multiSelect!: boolean;
}

export class StyleOptionPatchDto {
  @ApiProperty({ example: 'window:front_window', description: '`axis:value`' })
  option!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { part: { assemblies: [{ assemblyId: '0192f3a0-7c1e-7d2a-9b1f-00000000a301' }] } },
    description: '`{ config?, part? }` merged into the configuration / each part',
  })
  patch!: Record<string, unknown>;
}

export class StyleVariantRefDto {
  @ApiProperty({ example: 'PK-TE-01-K7QD' })
  code!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { tuck_top: 'reverse_tuck', tuck_bottom: 'crash_lock', hang: 'none', window: 'none' },
  })
  options!: Record<string, unknown>;

  @ApiProperty({
    enum: ['instant', 'rfq'],
    enumName: 'QuoteMode',
    example: 'rfq',
    description: 'Instant only with a signed calculator and every option priced; otherwise RFQ (D-266)',
  })
  pricePath!: 'instant' | 'rfq';

  @ApiProperty({
    enum: PRICE_REASONS,
    enumName: 'StylePriceReason',
    isArray: true,
    example: ['option_not_priced'],
    description:
      'Why the variant is RFQ; never `not_makeable` on the storefront (D-435 — no factory coverage)',
  })
  priceReasons!: (typeof PRICE_REASONS)[number][];

  @ApiProperty({
    type: [StyleOptionPatchDto],
    description: 'What the configurator applies for the variant’s priced options (D-268)',
  })
  configurationPatches!: StyleOptionPatchDto[];
}

export class StyleSizeRangeDto {
  @ApiProperty({ example: 'paperboard' })
  materialClass!: string;

  @ApiProperty({
    enum: ['recipe', 'pattern_rules'],
    enumName: 'StyleSizeRangeSource',
    example: 'pattern_rules',
  })
  source!: 'recipe' | 'pattern_rules';

  @ApiProperty({ type: Number, nullable: true, example: 30, description: 'Inside size (D-182). Unit: mm.' })
  minWMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 300 })
  maxWMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 30 })
  minLMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 400 })
  maxLMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 20 })
  minHMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 300 })
  maxHMm!: number | null;
}

export class LeadTimeRangeDto {
  @ApiProperty({ type: 'integer', example: 7 })
  minDays!: number;

  @ApiProperty({ type: 'integer', example: 12 })
  maxDays!: number;
}

export class StyleAssetDto {
  @ApiProperty({
    enum: ['thumbnail_2d', 'thumbnail_3d', 'dieline_svg', 'manifest'],
    enumName: 'StyleAssetKind',
    example: 'thumbnail_2d',
  })
  kind!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Variant code, null for the base',
  })
  variantCode!: string | null;

  @ApiProperty({ example: 'b2f1…', description: 'sha256 of the asset (hex)' })
  sha256!: string;

  @ApiProperty({ example: 'image/png' })
  contentType!: string;

  @ApiProperty({
    example: 'https://files.example.invalid/signed',
    description: 'Short-lived signed URL of the rendered asset (D-270)',
  })
  url!: string;
}

export class StyleDetailDto extends StyleCardDto {
  @ApiProperty({ example: 'Four side panels + glue flap; …' })
  construction!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'folding_carton',
    description:
      'The product type the style is priced and quoted as (its RFQ form, `store.rfqs.getForm`); null while unmapped (D-407).',
  })
  productTypeCode!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  descriptionTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  descriptionEn!: string | null;

  @ApiProperty({ type: [StyleAxisDto] })
  axes!: StyleAxisDto[];

  @ApiProperty({ type: [StyleVariantRefDto], description: 'Publishable variants (valid combinations)' })
  variants!: StyleVariantRefDto[];

  @ApiProperty({ type: [StyleSizeRangeDto] })
  sizeRanges!: StyleSizeRangeDto[];

  @ApiProperty({ type: LeadTimeRangeDto, nullable: true })
  leadTime!: LeadTimeRangeDto | null;

  @ApiProperty({ type: [String], example: ['cosmetics'] })
  useCases!: string[];

  @ApiProperty({ type: [StyleAssetDto] })
  assets!: StyleAssetDto[];
}

export class StyleFavouriteDto {
  @ApiProperty({ type: StyleCardDto })
  style!: StyleCardDto;

  @ApiProperty({ format: 'date-time', example: TS })
  addedAt!: string;
}

export const CARD_EXAMPLE: StyleCardDto = {
  code: 'PK-TE-01',
  nameTh: 'กล่องฝาเสียบ (ปรับฝาบน-ล่างได้)',
  nameEn: 'Tuck-end carton (configurable ends)',
  category: 'folding_carton',
  family: 'tuck_end',
  materialClass: 'paperboard',
  pricePath: 'instant',
  variantCount: 183,
  featured: false,
  startingPrice: {
    unitPrice: '4.85',
    currency: 'THB',
    quantity: 1000,
    catalogProductSlug: 'dev-tuck-end-box',
    computedAt: TS,
    label: SPEC_LABEL_EXAMPLE,
  },
  referenceCode: null,
  favourite: null,
  options: ['tuck_bottom:crash_lock', 'window:front_window'],
  thumbnailUrl: null,
  photo: null,
};

export const LIST_EXAMPLE: StyleListDto = {
  data: [CARD_EXAMPLE],
  facets: {
    category: [{ value: 'folding_carton', count: 1 }],
    family: [{ value: 'tuck_end', count: 1 }],
    closure: [{ value: 'tuck_bottom:crash_lock', count: 1 }],
    feature: [{ value: 'window:front_window', count: 1 }],
    useCase: [],
    materialClass: [{ value: 'paperboard', count: 1 }],
    pricePath: [{ value: 'instant', count: 1 }],
  },
  meta: { nextCursor: null },
};

export const DETAIL_EXAMPLE: StyleDetailDto = {
  ...CARD_EXAMPLE,
  construction: 'Four side panels + glue flap; top and bottom closures chosen from the tuck/lock/seal set.',
  productTypeCode: 'folding_carton',
  descriptionTh: null,
  descriptionEn: null,
  axes: [{ axis: 'tuck_bottom', values: ['tuck', 'crash_lock'], multiSelect: false }],
  variants: [
    {
      code: 'PK-TE-01-K7QD',
      options: { tuck_top: 'reverse_tuck', tuck_bottom: 'crash_lock', hang: 'none', window: 'none' },
      pricePath: 'rfq',
      priceReasons: ['option_not_priced'],
      configurationPatches: [],
    },
  ],
  sizeRanges: [
    {
      materialClass: 'paperboard',
      source: 'pattern_rules',
      minWMm: 30,
      maxWMm: 300,
      minLMm: 30,
      maxLMm: 400,
      minHMm: 20,
      maxHMm: 300,
    },
  ],
  leadTime: null,
  useCases: [],
  assets: [],
};

export const VARIANT_SORTS = ['popular', 'instant_first', 'name'] as const;

/** The variants grid (D-410): every shown variant, filtered and paged — a grid, not one page per variant. */
export class StyleVariantListQuery extends CursorQuery {
  @ApiPropertyOptional({
    example: 'ฝาเสียบ',
    description: 'Search over the styles (as `store.styles.list`) and variant codes',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ example: 'PK-TE-01', description: "One style's variants only (its public code)" })
  @IsOptional()
  @Matches(/^[A-Z0-9-]{3,40}$/)
  style?: string;

  @ApiPropertyOptional({ example: 'folding_carton' })
  @IsOptional()
  @Matches(FACET_VALUE)
  category?: string;

  @ApiPropertyOptional({ example: 'tuck_end' })
  @IsOptional()
  @Matches(FACET_VALUE)
  family?: string;

  @ApiPropertyOptional({ example: 'cosmetics' })
  @IsOptional()
  @Matches(FACET_VALUE)
  useCase?: string;

  @ApiPropertyOptional({ example: 'paperboard' })
  @IsOptional()
  @Matches(FACET_VALUE)
  materialClass?: string;

  @ApiPropertyOptional({ enum: PRICE_PATHS, enumName: 'QuoteMode', example: 'instant' })
  @IsOptional()
  @IsIn(PRICE_PATHS)
  pricePath?: (typeof PRICE_PATHS)[number];

  @ApiPropertyOptional({
    type: [String],
    example: ['window:front_window', 'tuck_bottom:crash_lock'],
    description:
      'Options `axis:value`, repeated or comma-separated: values of one axis are alternatives, different axes all apply',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    (Array.isArray(value) ? value : [value])
      .flatMap((v) => String(v).split(','))
      .map((v) => v.trim())
      .filter(Boolean),
  )
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(/^[a-z0-9_]+:[a-z0-9_+]+$/, { each: true })
  option?: string[];

  @ApiPropertyOptional({ enum: VARIANT_SORTS, enumName: 'StyleVariantSort', example: 'popular' })
  @IsOptional()
  @IsIn(VARIANT_SORTS)
  sort?: (typeof VARIANT_SORTS)[number];
}

export class StyleVariantCardDto {
  @ApiProperty({ example: 'PK-TE-01-K7QD' })
  code!: string;

  @ApiProperty({ example: 'PK-TE-01' })
  baseCode!: string;

  @ApiProperty({ example: 'กล่องฝาเสียบ (ปรับฝาบน-ล่างได้)' })
  nameTh!: string;

  @ApiProperty({ example: 'Tuck-end carton (configurable ends)' })
  nameEn!: string;

  @ApiProperty({ example: 'folding_carton' })
  category!: string;

  @ApiProperty({ example: 'tuck_end' })
  family!: string;

  @ApiProperty({ example: 'paperboard' })
  materialClass!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { tuck_top: 'reverse_tuck', tuck_bottom: 'crash_lock', hang: 'none', window: 'front_window' },
  })
  options!: Record<string, unknown>;

  @ApiProperty({ enum: PRICE_PATHS, enumName: 'QuoteMode', example: 'rfq' })
  pricePath!: (typeof PRICE_PATHS)[number];

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description:
      "The variant's picture: its style's photo when it has one, else the variant's rendered thumbnail, else its style's; null before any exists",
  })
  thumbnailUrl!: string | null;

  @ApiProperty({ type: StylePhotoDto, nullable: true, example: null })
  photo!: StylePhotoDto | null;
}

export class StyleVariantFacetsDto {
  @ApiProperty({
    type: [StyleFacetValueDto],
    description:
      "Option values `axis:value` (`none` included: a variant without the axis counts, and filters, as `none`) with counts under every other filter — an axis's own filter is left out of its counts",
  })
  option!: StyleFacetValueDto[];

  @ApiProperty({ type: [StyleFacetValueDto] })
  category!: StyleFacetValueDto[];

  @ApiProperty({ type: [StyleFacetValueDto] })
  materialClass!: StyleFacetValueDto[];
}

export class StyleVariantListMeta extends CursorMeta {
  @ApiProperty({ type: 'integer', example: 986, description: 'Variants matching the query and filters' })
  total!: number;

  @ApiProperty({ type: 'integer', example: 986, description: 'Every shown variant of the library' })
  libraryTotal!: number;

  @ApiProperty({ type: 'integer', example: 122, description: 'Every shown style of the library' })
  libraryStyles!: number;
}

export class StyleVariantListDto {
  @ApiProperty({ type: [StyleVariantCardDto] })
  data!: StyleVariantCardDto[];

  @ApiProperty({ type: StyleVariantFacetsDto })
  facets!: StyleVariantFacetsDto;

  @ApiProperty({ type: StyleVariantListMeta })
  meta!: StyleVariantListMeta;
}

export const VARIANT_LIST_EXAMPLE: StyleVariantListDto = {
  data: [
    {
      code: 'PK-TE-01-K7QD',
      baseCode: 'PK-TE-01',
      nameTh: 'กล่องฝาเสียบ (ปรับฝาบน-ล่างได้)',
      nameEn: 'Tuck-end carton (configurable ends)',
      category: 'folding_carton',
      family: 'tuck_end',
      materialClass: 'paperboard',
      options: { tuck_top: 'reverse_tuck', tuck_bottom: 'crash_lock', hang: 'none', window: 'front_window' },
      pricePath: 'rfq',
      thumbnailUrl: null,
      photo: null,
    },
  ],
  facets: {
    option: [
      { value: 'window:front_window', count: 61 },
      { value: 'window:none', count: 61 },
    ],
    category: [{ value: 'folding_carton', count: 183 }],
    materialClass: [{ value: 'paperboard', count: 183 }],
  },
  meta: { nextCursor: null, total: 183, libraryTotal: 986, libraryStyles: 122 },
};
