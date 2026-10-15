import { PageQuery } from '@common/pagination/pagination.dto';
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
    description: 'The Packio product type it is sold as (null: none — not publishable)',
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
