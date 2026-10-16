import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import {
  BoolField,
  CodeField,
  CONTENT_STATUSES,
  ContentStatusField,
  EnumField,
  IdField,
  RefField,
  SlugField,
  SNAKE_CODE,
  SortField,
  TextField,
  TimestampField,
  UrlField,
} from '../crud/dto-fields';

type Content = (typeof CONTENT_STATUSES)[number];
const TS = '2026-09-25T10:00:00+07:00';

export const BANNER_POSITIONS = ['home_hero', 'home_strip', 'category', 'popup'] as const;
export const HOME_SECTION_KINDS = [
  'product_types',
  'catalog_products',
  'showcase',
  'articles',
  'banner',
  'custom',
] as const;
export const VIDEO_PROVIDERS = ['youtube', 'vimeo', 'file'] as const;
export const VIDEO_SUBJECTS = ['catalog_product', 'showcase_product', 'stock_product', 'article'] as const;

export const CMS_IDS = {
  banner: '0192f3a0-7c1e-7d2a-9b1f-00000000a101',
  section: '0192f3a0-7c1e-7d2a-9b1f-00000000a102',
  articleCategory: '0192f3a0-7c1e-7d2a-9b1f-00000000a103',
  article: '0192f3a0-7c1e-7d2a-9b1f-00000000a104',
  faqCategory: '0192f3a0-7c1e-7d2a-9b1f-00000000a105',
  faq: '0192f3a0-7c1e-7d2a-9b1f-00000000a106',
  seoPage: '0192f3a0-7c1e-7d2a-9b1f-00000000a107',
  video: '0192f3a0-7c1e-7d2a-9b1f-00000000a108',
  file: '0192f3a0-7c1e-7d2a-9b1f-00000000a109',
  file2: '0192f3a0-7c1e-7d2a-9b1f-00000000a110',
  catalogProduct: '0192f3a0-7c1e-7d2a-9b1f-00000000c004',
} as const;

class ContentStatusQuery extends PageQuery {
  @EnumField(CONTENT_STATUSES, 'ContentStatus', { example: 'published', optional: true })
  status?: Content;
}

// ------------------------------------------------------------------------------------------------
// Banners
// ------------------------------------------------------------------------------------------------

export class BannerDto {
  @IdField(CMS_IDS.banner)
  id!: string;

  @ApiProperty({ enum: BANNER_POSITIONS, enumName: 'BannerPosition', example: 'home_hero' })
  position!: (typeof BANNER_POSITIONS)[number];

  @ApiProperty({ example: 'แคมเปญกล่องไปรษณีย์ ตุลาคม', description: 'Staff label and alt text' })
  title!: string;

  @ApiProperty({ format: 'uuid', example: CMS_IDS.file })
  desktopFileId!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: CMS_IDS.file2 })
  mobileFileId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '/th/products/mailer-box' })
  targetUrl!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  videoUrl!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-01T00:00:00+07:00' })
  validFrom!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-31T23:59:59+07:00' })
  validTo!: string | null;

  @ApiProperty({ type: 'integer', example: 10 })
  sort!: number;

  @ApiProperty({ enum: CONTENT_STATUSES, enumName: 'ContentStatus', example: 'published' })
  status!: Content;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateBannerDto {
  @EnumField(BANNER_POSITIONS, 'BannerPosition', { example: 'home_hero' })
  position!: (typeof BANNER_POSITIONS)[number];

  @TextField({ example: 'แคมเปญกล่องไปรษณีย์ ตุลาคม' })
  title!: string;

  @RefField({ example: CMS_IDS.file, description: 'Uploaded desktop image' })
  desktopFileId!: string;

  @RefField({ example: CMS_IDS.file2, nullable: true })
  mobileFileId?: string | null;

  @UrlField({ example: '/th/products/mailer-box', nullable: true })
  targetUrl?: string | null;

  @UrlField({ example: null, nullable: true })
  videoUrl?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-01T00:00:00+07:00',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validFrom?: Date | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-31T23:59:59+07:00',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validTo?: Date | null;

  @SortField()
  sort?: number;

  @ContentStatusField()
  status?: Content;
}

export class UpdateBannerDto extends PartialType(CreateBannerDto) {}

export class BannerListQuery extends ContentStatusQuery {
  @EnumField(BANNER_POSITIONS, 'BannerPosition', { example: 'home_hero', optional: true })
  position?: (typeof BANNER_POSITIONS)[number];
}

// ------------------------------------------------------------------------------------------------
// Home sections
// ------------------------------------------------------------------------------------------------

export class HomeSectionDto {
  @IdField(CMS_IDS.section)
  id!: string;

  @ApiProperty({ example: 'best-sellers' })
  slug!: string;

  @ApiProperty({ type: String, nullable: true, example: 'สินค้าขายดี' })
  titleTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Best sellers' })
  titleEn!: string | null;

  @ApiProperty({ enum: HOME_SECTION_KINDS, enumName: 'HomeSectionKind', example: 'catalog_products' })
  kind!: (typeof HOME_SECTION_KINDS)[number];

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { catalogProductIds: [CMS_IDS.catalogProduct] },
    description: 'What the section shows (ids, limits, layout) — interpreted by the storefront',
  })
  config!: Record<string, unknown>;

  @ApiProperty({ type: 'integer', example: 10 })
  sort!: number;

  @ApiProperty({ enum: CONTENT_STATUSES, enumName: 'ContentStatus', example: 'published' })
  status!: Content;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateHomeSectionDto {
  @SlugField({ example: 'best-sellers' })
  slug!: string;

  @TextField({ example: 'สินค้าขายดี', nullable: true })
  titleTh?: string | null;

  @TextField({ example: 'Best sellers', nullable: true })
  titleEn?: string | null;

  @EnumField(HOME_SECTION_KINDS, 'HomeSectionKind', { example: 'catalog_products' })
  kind!: (typeof HOME_SECTION_KINDS)[number];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { catalogProductIds: [CMS_IDS.catalogProduct] },
  })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @SortField()
  sort?: number;

  @ContentStatusField()
  status?: Content;
}

export class UpdateHomeSectionDto extends PartialType(CreateHomeSectionDto) {}

export class ReorderDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    example: [CMS_IDS.section],
    description: 'Every section id in the new order',
  })
  @IsUUID('all', { each: true })
  ids!: string[];
}

// ------------------------------------------------------------------------------------------------
// Articles & categories
// ------------------------------------------------------------------------------------------------

export const ARTICLE_AUDIENCES = ['public', 'partner'] as const;

export class ArticleCategoryDto {
  @IdField(CMS_IDS.articleCategory)
  id!: string;

  @ApiProperty({ example: 'packaging-tips' })
  slug!: string;

  @ApiProperty({ example: 'เคล็ดลับบรรจุภัณฑ์' })
  nameTh!: string;

  @ApiProperty({ example: 'Packaging tips' })
  nameEn!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  seoPageId!: string | null;

  @ApiProperty({ type: 'integer', example: 10 })
  sort!: number;

  @ApiProperty({ enum: CONTENT_STATUSES, enumName: 'ContentStatus', example: 'published' })
  status!: Content;

  @ApiProperty({
    enum: ARTICLE_AUDIENCES,
    enumName: 'ArticleAudience',
    example: 'public',
    description: '`partner`: the partner knowledge base only, never the store (D-295)',
  })
  audience!: (typeof ARTICLE_AUDIENCES)[number];

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateArticleCategoryDto {
  @SlugField({ example: 'packaging-tips' })
  slug!: string;

  @TextField({ example: 'เคล็ดลับบรรจุภัณฑ์' })
  nameTh!: string;

  @TextField({ example: 'Packaging tips' })
  nameEn!: string;

  @RefField({ example: null, nullable: true })
  seoPageId?: string | null;

  @SortField()
  sort?: number;

  @ContentStatusField()
  status?: Content;

  @EnumField(ARTICLE_AUDIENCES, 'ArticleAudience', {
    example: 'public',
    optional: true,
    description: 'Default `public`; `partner`: the partner knowledge base only, never the store (D-295)',
  })
  audience?: (typeof ARTICLE_AUDIENCES)[number];
}

export class UpdateArticleCategoryDto extends PartialType(CreateArticleCategoryDto) {}

export class ArticleCategoryListQuery extends ContentStatusQuery {
  @EnumField(ARTICLE_AUDIENCES, 'ArticleAudience', { example: 'partner', optional: true })
  audience?: (typeof ARTICLE_AUDIENCES)[number];
}

export class HomeSectionListQuery extends ContentStatusQuery {}

export class ArticleDto {
  @IdField(CMS_IDS.article)
  id!: string;

  @ApiProperty({ example: 'how-to-choose-a-mailer-box' })
  slug!: string;

  @ApiProperty({ example: 'เลือกกล่องไปรษณีย์อย่างไรให้เหมาะกับสินค้า' })
  titleTh!: string;

  @ApiProperty({ type: String, nullable: true, example: 'How to choose a mailer box' })
  titleEn!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'ขนาด ลอน และการพิมพ์ที่ควรรู้' })
  excerptTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  excerptEn!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: CMS_IDS.file })
  coverFileId!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { th: { type: 'doc', content: [] } },
    description: 'Rich text per language (versioned schema, `bodySchemaVersion`)',
  })
  body!: Record<string, unknown>;

  @ApiProperty({ type: 'integer', example: 1 })
  bodySchemaVersion!: number;

  @ApiProperty({ enum: CONTENT_STATUSES, enumName: 'ContentStatus', example: 'published' })
  status!: Content;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-09-25T09:00:00+07:00' })
  publishedAt!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  seoPageId!: string | null;

  @ApiProperty({ type: [String], format: 'uuid', example: [CMS_IDS.articleCategory] })
  categoryIds!: string[];

  @ApiProperty({
    enum: ARTICLE_AUDIENCES,
    enumName: 'ArticleAudience',
    example: 'public',
    description: '`partner`: the partner knowledge base only, never the store (D-295)',
  })
  audience!: (typeof ARTICLE_AUDIENCES)[number];

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateArticleDto {
  @SlugField({ example: 'how-to-choose-a-mailer-box' })
  slug!: string;

  @TextField({ example: 'เลือกกล่องไปรษณีย์อย่างไรให้เหมาะกับสินค้า', max: 300 })
  titleTh!: string;

  @TextField({ example: 'How to choose a mailer box', nullable: true, max: 300 })
  titleEn?: string | null;

  @TextField({ example: 'ขนาด ลอน และการพิมพ์ที่ควรรู้', nullable: true, max: 1000 })
  excerptTh?: string | null;

  @TextField({ example: null, nullable: true, max: 1000 })
  excerptEn?: string | null;

  @RefField({ example: CMS_IDS.file, nullable: true })
  coverFileId?: string | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { th: { type: 'doc', content: [] } },
  })
  @IsOptional()
  @IsObject()
  body?: Record<string, unknown>;

  @ContentStatusField({
    example: 'draft',
    optional: true,
    description: 'Publishing sets `publishedAt` the first time',
  })
  status?: Content;

  @RefField({ example: null, nullable: true })
  seoPageId?: string | null;

  @EnumField(ARTICLE_AUDIENCES, 'ArticleAudience', {
    example: 'public',
    optional: true,
    description: 'Default `public`; `partner`: the partner knowledge base only, never the store (D-295)',
  })
  audience?: (typeof ARTICLE_AUDIENCES)[number];
}

export class UpdateArticleDto extends PartialType(CreateArticleDto) {}

export class ArticleListQuery extends ContentStatusQuery {
  @RefField({ example: CMS_IDS.articleCategory, optional: true })
  categoryId?: string;

  @EnumField(ARTICLE_AUDIENCES, 'ArticleAudience', { example: 'partner', optional: true })
  audience?: (typeof ARTICLE_AUDIENCES)[number];
}

export class ReplaceArticleCategoriesDto {
  @ApiProperty({ type: [String], format: 'uuid', example: [CMS_IDS.articleCategory] })
  @IsUUID('all', { each: true })
  categoryIds!: string[];
}

// ------------------------------------------------------------------------------------------------
// FAQs
// ------------------------------------------------------------------------------------------------

export class FaqCategoryDto {
  @IdField(CMS_IDS.faqCategory)
  id!: string;

  @ApiProperty({ example: 'ordering' })
  code!: string;

  @ApiProperty({ example: 'การสั่งซื้อ' })
  nameTh!: string;

  @ApiProperty({ example: 'Ordering' })
  nameEn!: string;

  @ApiProperty({ type: 'integer', example: 10 })
  sort!: number;

  @ApiProperty({ enum: CONTENT_STATUSES, enumName: 'ContentStatus', example: 'published' })
  status!: Content;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateFaqCategoryDto {
  @CodeField({ example: 'ordering', pattern: SNAKE_CODE })
  code!: string;

  @TextField({ example: 'การสั่งซื้อ' })
  nameTh!: string;

  @TextField({ example: 'Ordering' })
  nameEn!: string;

  @SortField()
  sort?: number;

  @ContentStatusField()
  status?: Content;
}

export class UpdateFaqCategoryDto extends PartialType(CreateFaqCategoryDto) {}

export class FaqCategoryListQuery extends ContentStatusQuery {}

export class FaqDto {
  @IdField(CMS_IDS.faq)
  id!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: CMS_IDS.faqCategory })
  categoryId!: string | null;

  @ApiProperty({ example: 'สั่งขั้นต่ำกี่ชิ้น' })
  questionTh!: string;

  @ApiProperty({ type: String, nullable: true, example: 'What is the minimum order?' })
  questionEn!: string | null;

  @ApiProperty({ example: 'ขึ้นอยู่กับประเภทสินค้า ดูได้ในหน้าสินค้าแต่ละรายการ' })
  answerTh!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'It depends on the product type; see each product page.',
  })
  answerEn!: string | null;

  @ApiProperty({ type: 'integer', example: 10 })
  sort!: number;

  @ApiProperty({ enum: CONTENT_STATUSES, enumName: 'ContentStatus', example: 'published' })
  status!: Content;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    example: [CMS_IDS.catalogProduct],
    description: 'Catalogue products whose page shows this FAQ (set through `PUT …/catalog-products`)',
  })
  catalogProductIds!: string[];

  @TimestampField(TS)
  updatedAt!: string;
}

export class ReplaceFaqCatalogProductsDto {
  @ApiProperty({ type: [String], format: 'uuid', example: [CMS_IDS.catalogProduct] })
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  catalogProductIds!: string[];
}

export class CreateFaqDto {
  @RefField({ example: CMS_IDS.faqCategory, nullable: true })
  categoryId?: string | null;

  @TextField({ example: 'สั่งขั้นต่ำกี่ชิ้น', max: 500 })
  questionTh!: string;

  @TextField({ example: 'What is the minimum order?', nullable: true, max: 500 })
  questionEn?: string | null;

  @TextField({ example: 'ขึ้นอยู่กับประเภทสินค้า ดูได้ในหน้าสินค้าแต่ละรายการ', max: 5000 })
  answerTh!: string;

  @TextField({ example: 'It depends on the product type; see each product page.', nullable: true, max: 5000 })
  answerEn?: string | null;

  @SortField()
  sort?: number;

  @ContentStatusField()
  status?: Content;
}

export class UpdateFaqDto extends PartialType(CreateFaqDto) {}

export class FaqListQuery extends ContentStatusQuery {
  @RefField({ example: CMS_IDS.faqCategory, optional: true })
  categoryId?: string;
}

// ------------------------------------------------------------------------------------------------
// SEO pages
// ------------------------------------------------------------------------------------------------

export class SeoPageDto {
  @IdField(CMS_IDS.seoPage)
  id!: string;

  @ApiProperty({ example: '/th/products/mailer-box', description: 'Route or slug the meta applies to' })
  pageKey!: string;

  @ApiProperty({ example: 'กล่องไปรษณีย์พิมพ์ลาย สั่งผลิตออนไลน์ | getpack' })
  titleTh!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Printed mailer boxes online | getpack' })
  titleEn!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'ออกแบบและสั่งผลิตกล่องไปรษณีย์ได้ในไม่กี่คลิก' })
  descriptionTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  descriptionEn!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'กล่องไปรษณีย์, กล่องพิมพ์ลาย' })
  keywords!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'กล่องไปรษณีย์พิมพ์ลาย' })
  h1!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  h2!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  canonicalUrl!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  ogImageFileId!: string | null;

  @ApiProperty({ example: false })
  noindex!: boolean;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateSeoPageDto {
  @TextField({ example: '/th/products/mailer-box', max: 300 })
  pageKey!: string;

  @TextField({ example: 'กล่องไปรษณีย์พิมพ์ลาย สั่งผลิตออนไลน์ | getpack', max: 300 })
  titleTh!: string;

  @TextField({ example: 'Printed mailer boxes online | getpack', nullable: true, max: 300 })
  titleEn?: string | null;

  @TextField({ example: 'ออกแบบและสั่งผลิตกล่องไปรษณีย์ได้ในไม่กี่คลิก', nullable: true, max: 1000 })
  descriptionTh?: string | null;

  @TextField({ example: null, nullable: true, max: 1000 })
  descriptionEn?: string | null;

  @TextField({ example: 'กล่องไปรษณีย์, กล่องพิมพ์ลาย', nullable: true, max: 500 })
  keywords?: string | null;

  @TextField({ example: 'กล่องไปรษณีย์พิมพ์ลาย', nullable: true, max: 300 })
  h1?: string | null;

  @TextField({ example: null, nullable: true, max: 300 })
  h2?: string | null;

  @UrlField({ example: null, nullable: true })
  canonicalUrl?: string | null;

  @RefField({ example: null, nullable: true })
  ogImageFileId?: string | null;

  @BoolField({ example: false, optional: true })
  noindex?: boolean;
}

export class UpdateSeoPageDto extends PartialType(CreateSeoPageDto) {}

export class SeoPageListQuery extends PageQuery {}

// ------------------------------------------------------------------------------------------------
// Videos
// ------------------------------------------------------------------------------------------------

export class VideoDto {
  @IdField(CMS_IDS.video)
  id!: string;

  @ApiProperty({ enum: VIDEO_PROVIDERS, enumName: 'VideoProvider', example: 'youtube' })
  provider!: (typeof VIDEO_PROVIDERS)[number];

  @ApiProperty({ example: 'https://www.youtube.com/watch?v=example' })
  url!: string;

  @ApiProperty({ type: String, nullable: true, example: 'วิธีประกอบกล่องฝาเสียบ' })
  title!: string | null;

  @ApiProperty({ enum: VIDEO_SUBJECTS, enumName: 'VideoSubject', example: 'catalog_product' })
  subjectType!: (typeof VIDEO_SUBJECTS)[number];

  @ApiProperty({ format: 'uuid', example: CMS_IDS.catalogProduct })
  subjectId!: string;

  @ApiProperty({ type: 'integer', example: 10 })
  sort!: number;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateVideoDto {
  @EnumField(VIDEO_PROVIDERS, 'VideoProvider', { example: 'youtube' })
  provider!: (typeof VIDEO_PROVIDERS)[number];

  @UrlField({ example: 'https://www.youtube.com/watch?v=example' })
  url!: string;

  @TextField({ example: 'วิธีประกอบกล่องฝาเสียบ', nullable: true })
  title?: string | null;

  @EnumField(VIDEO_SUBJECTS, 'VideoSubject', { example: 'catalog_product' })
  subjectType!: (typeof VIDEO_SUBJECTS)[number];

  @RefField({ example: CMS_IDS.catalogProduct })
  subjectId!: string;

  @SortField()
  sort?: number;
}

/** A video stays with its subject. */
export class UpdateVideoDto extends PartialType(
  OmitType(CreateVideoDto, ['subjectType', 'subjectId'] as const),
) {}

export class VideoListQuery extends PageQuery {
  @EnumField(VIDEO_SUBJECTS, 'VideoSubject', { example: 'catalog_product', optional: true })
  subjectType?: (typeof VIDEO_SUBJECTS)[number];

  @RefField({ example: CMS_IDS.catalogProduct, optional: true })
  subjectId?: string;
}

// --- glossary (U5.B5, D-304) -----------------------------------------------------------------------------

const GLOSSARY_ID = '0192f3a0-7c1e-7d2a-9b1f-00000000a1f1';

export class GlossaryTermDto {
  @IdField(GLOSSARY_ID)
  id!: string;

  @ApiProperty({ example: 'ลอนอี' })
  termTh!: string;

  @ApiProperty({ type: String, nullable: true, example: 'E-flute' })
  termEn!: string | null;

  @ApiProperty({ type: [String], example: ['ลอน E', 'e flute'], description: 'Other spellings people type' })
  aliases!: string[];

  @ApiProperty({ example: 'ลอนกระดาษลูกฟูกแบบบาง เหมาะกับกล่องขนาดเล็กที่ต้องการพิมพ์สวย' })
  definitionTh!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'A thin corrugated flute for small, well-printed boxes.',
  })
  definitionEn!: string | null;

  @ApiProperty({ type: 'integer', example: 10 })
  sort!: number;

  @ApiProperty({ enum: CONTENT_STATUSES, enumName: 'ContentStatus', example: 'published' })
  status!: Content;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateGlossaryTermDto {
  @TextField({ example: 'ลอนอี', max: 120 })
  termTh!: string;

  @TextField({ example: 'E-flute', nullable: true, max: 120 })
  termEn?: string | null;

  @ApiPropertyOptional({ type: [String], example: ['ลอน E'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  aliases?: string[];

  @TextField({ example: 'ลอนกระดาษลูกฟูกแบบบาง เหมาะกับกล่องขนาดเล็กที่ต้องการพิมพ์สวย', max: 2000 })
  definitionTh!: string;

  @TextField({ example: 'A thin corrugated flute for small, well-printed boxes.', nullable: true, max: 2000 })
  definitionEn?: string | null;

  @SortField()
  sort?: number;

  @ContentStatusField()
  status?: Content;
}

export class UpdateGlossaryTermDto extends PartialType(CreateGlossaryTermDto) {}

export class GlossaryTermListQuery extends ContentStatusQuery {}
