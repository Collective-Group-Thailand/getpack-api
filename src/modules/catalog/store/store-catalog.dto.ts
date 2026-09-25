import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { SLUG, SNAKE_CODE } from '../crud/dto-fields';
import { STOCK_ATTRIBUTES } from '../stock/stock.dto';

/** Public image URL: resolves to a short-lived signed URL once the file is scanned clean. */
export const IMAGE_URL_EXAMPLE = '/v1/store/catalog/images/0192f3a0-7c1e-7d2a-9b1f-00000000c009';

export class StoreProductTypeDto {
  @ApiProperty({ example: 'folding_carton' })
  code!: string;

  @ApiProperty({ example: 'กล่องกระดาษแข็ง' })
  nameTh!: string;

  @ApiProperty({ example: 'Folding carton' })
  nameEn!: string;

  @ApiProperty({ example: 'folding_carton', description: 'Reporting category code' })
  categoryCode!: string;

  @ApiProperty({
    enum: ['instant', 'rfq'],
    enumName: 'QuoteMode',
    example: 'rfq',
    description: 'How the type is quoted today (D-100); a given configuration may still route to RFQ (D-043)',
  })
  quoteMode!: 'instant' | 'rfq';
}

export class StoreImageDto {
  @ApiProperty({ example: IMAGE_URL_EXAMPLE })
  url!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: { material: 'art-card-350' },
  })
  variant!: Record<string, unknown> | null;
}

export class StoreProductCardDto {
  @ApiProperty({ example: 'tuck-end-box' })
  slug!: string;

  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({ example: 'กล่องฝาเสียบ' })
  nameTh!: string;

  @ApiProperty({ example: 'Tuck-end box' })
  nameEn!: string;

  @ApiProperty({ type: String, nullable: true, example: IMAGE_URL_EXAMPLE })
  imageUrl!: string | null;

  @ApiProperty({
    enum: ['none', 'online_template', 'drawing'],
    enumName: 'TemplateAvailability',
    example: 'drawing',
  })
  templateAvailability!: 'none' | 'online_template' | 'drawing';
}

export class StorePatternDto {
  @ApiProperty({ example: 'RTE-01' })
  code!: string;

  @ApiProperty({ example: 'ฝาเสียบกลับด้าน' })
  name!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { minW: 30, maxW: 500 },
    description: 'Size constraints the configurator enforces',
  })
  constraints!: Record<string, unknown>;

  @ApiProperty({ type: String, nullable: true, example: 'rte', description: 'Key for `@packio/dieline`' })
  dielineKey!: string | null;
}

export class StoreOptionDto {
  @ApiProperty({ example: 'art-card-350', description: 'Code of the offered row' })
  code!: string;

  @ApiProperty({ example: 'อาร์ตการ์ด 350 แกรม' })
  nameTh!: string;

  @ApiProperty({ example: 'Art card 350 gsm' })
  nameEn!: string;

  @ApiProperty({ example: true })
  isDefault!: boolean;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { gsm: 350, kind: 'paper' },
    description: 'Kind-specific attributes (gsm, micron, finish kind, colour kind …)',
  })
  attributes!: Record<string, unknown>;
}

export class StoreOptionGroupDto {
  @ApiProperty({
    enum: ['material', 'finish', 'coating', 'ink_colour', 'diecut', 'assembly', 'print_type', 'pattern'],
    enumName: 'OfferableOptionKind',
    example: 'material',
  })
  kind!: string;

  @ApiProperty({ type: [StoreOptionDto] })
  options!: StoreOptionDto[];
}

export class StoreStandardSizeDto {
  @ApiProperty({ example: 'S' })
  code!: string;

  @ApiProperty({ example: 'ขนาดเล็ก 10×10×5 ซม.' })
  name!: string;

  @ApiProperty({ example: 100, description: 'Unit: mm.' })
  lengthMm!: number;

  @ApiProperty({ example: 100, description: 'Unit: mm.' })
  widthMm!: number;

  @ApiProperty({ example: 50, description: 'Unit: mm.' })
  heightMm!: number;
}

export class StoreVideoDto {
  @ApiProperty({ enum: ['youtube', 'vimeo', 'file'], enumName: 'VideoProvider', example: 'youtube' })
  provider!: 'youtube' | 'vimeo' | 'file';

  @ApiProperty({ example: 'https://www.youtube.com/watch?v=example' })
  url!: string;

  @ApiProperty({ type: String, nullable: true, example: 'วิธีประกอบกล่องฝาเสียบ' })
  title!: string | null;
}

export class StoreSeoDto {
  @ApiProperty({ example: 'กล่องไปรษณีย์พิมพ์ลาย สั่งผลิตออนไลน์ | Packio' })
  title!: string;

  @ApiProperty({ type: String, nullable: true, example: 'ออกแบบและสั่งผลิตกล่องไปรษณีย์ได้ในไม่กี่คลิก' })
  description!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'กล่องไปรษณีย์, กล่องพิมพ์ลาย' })
  keywords!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'กล่องไปรษณีย์พิมพ์ลาย' })
  h1!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  h2!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  canonicalUrl!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  ogImageUrl!: string | null;

  @ApiProperty({ example: false })
  noindex!: boolean;
}

export class StoreProductDetailDto extends StoreProductCardDto {
  @ApiProperty({ type: String, nullable: true, example: 'กล่องพับฝาเสียบบน-ล่าง' })
  descriptionTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Reverse tuck-end folding box' })
  descriptionEn!: string | null;

  @ApiProperty({ example: false })
  isCombination!: boolean;

  @ApiProperty({ type: [StorePatternDto] })
  patterns!: StorePatternDto[];

  @ApiProperty({ type: [StoreOptionGroupDto] })
  optionGroups!: StoreOptionGroupDto[];

  @ApiProperty({ type: [StoreStandardSizeDto] })
  standardSizes!: StoreStandardSizeDto[];

  @ApiProperty({ type: [StoreImageDto] })
  images!: StoreImageDto[];

  @ApiProperty({ type: [StoreVideoDto] })
  videos!: StoreVideoDto[];

  @ApiProperty({ type: StoreSeoDto, nullable: true })
  seo!: StoreSeoDto | null;
}

export class StoreProductListQuery extends PageQuery {
  @ApiPropertyOptional({ example: 'folding_carton', description: 'Product type code' })
  @IsOptional()
  @Matches(SNAKE_CODE)
  productType?: string;
}

// ------------------------------------------------------------------------------------------------
// Stock products
// ------------------------------------------------------------------------------------------------

export class StoreStockAttributeDto {
  @ApiProperty({ enum: STOCK_ATTRIBUTES, enumName: 'StockAttribute', example: 'colour' })
  attribute!: string;

  @ApiProperty({ example: 'clear' })
  code!: string;

  @ApiProperty({ example: 'ใส' })
  nameTh!: string;

  @ApiProperty({ example: 'Clear' })
  nameEn!: string;
}

export class StoreStockProductDto {
  @ApiProperty({ example: 'PKO-BTL-0250' })
  sku!: string;

  @ApiProperty({ example: 'ขวด PET 250 มล.' })
  nameTh!: string;

  @ApiProperty({ example: 'PET bottle 250 ml' })
  nameEn!: string;

  @ApiProperty({ type: String, nullable: true, example: 'ขวดใส ฝาเกลียว 28 มม.' })
  description!: string | null;

  @ApiProperty({
    enum: ['piece', 'box', 'pouch', 'tube', 'set', 'job', 'round', 'trip'],
    enumName: 'ProductUnit',
    example: 'piece',
  })
  unit!: string;

  @ApiProperty({ type: Number, nullable: true, example: 250, description: 'Unit: ml.' })
  capacityMl!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 60, description: 'Unit: mm.' })
  lengthMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 60, description: 'Unit: mm.' })
  widthMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 150, description: 'Unit: mm.' })
  heightMm!: number | null;

  @ApiProperty({ type: 'integer', example: 100 })
  minOrderQty!: number;

  @ApiProperty({ example: true })
  isFoodGrade!: boolean;

  @ApiProperty({
    example: true,
    description: 'Some supplying factory has stock (no factory is ever named, D-050)',
  })
  inStock!: boolean;

  @ApiProperty({ type: [StoreStockAttributeDto] })
  attributes!: StoreStockAttributeDto[];

  @ApiProperty({ type: [String], example: [IMAGE_URL_EXAMPLE] })
  imageUrls!: string[];
}

export class StoreStockProductListQuery extends PageQuery {
  @ApiPropertyOptional({ example: 'standard_product', description: 'Product type code' })
  @IsOptional()
  @Matches(SNAKE_CODE)
  productType?: string;

  @ApiPropertyOptional({
    example: 'colour:clear,shape:round',
    description: 'Attribute filters `attribute:code`, comma-separated (all must match)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/^[a-z_]+:[A-Za-z0-9_.-]+(,[a-z_]+:[A-Za-z0-9_.-]+)*$/)
  attributes?: string;
}

// ------------------------------------------------------------------------------------------------
// Showcase, semi-designs
// ------------------------------------------------------------------------------------------------

export class StoreShowcaseProductDto {
  @ApiProperty({ example: 'serum-box-30ml' })
  slug!: string;

  @ApiProperty({ type: String, nullable: true, example: 'cosmetics' })
  categorySlug!: string | null;

  @ApiProperty({ example: 'tuck-end-box', description: 'Catalogue product to configure' })
  productSlug!: string;

  @ApiProperty({ example: 'กล่องเซรั่ม 30 มล.' })
  nameTh!: string;

  @ApiProperty({ example: 'Serum box 30 ml' })
  nameEn!: string;

  @ApiProperty({ type: String, nullable: true, example: 'กล่องฝาเสียบ อาร์ตการ์ด 350 แกรม เคลือบด้าน' })
  descriptionTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: IMAGE_URL_EXAMPLE })
  imageUrl!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { lengthMm: 40, widthMm: 40, heightMm: 120 },
    description: 'Pre-filled configurator input',
  })
  preset!: Record<string, unknown>;
}

export class StoreShowcaseListQuery extends PageQuery {
  @ApiPropertyOptional({ example: 'cosmetics', description: 'Showcase category slug' })
  @IsOptional()
  @Matches(SLUG)
  category?: string;
}

export class StoreSemiDesignDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000b003' })
  id!: string;

  @ApiProperty({ example: 'มินิมอล ขาว-ดำ' })
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: IMAGE_URL_EXAMPLE })
  thumbnailUrl!: string | null;

  @ApiProperty({ type: [String], example: ['#000000', '#FFFFFF'] })
  colours!: string[];

  @ApiProperty({ type: [String], example: ['S', 'M'], description: 'Standard sizes with a template' })
  sizeCodes!: string[];
}

// ------------------------------------------------------------------------------------------------
// CMS
// ------------------------------------------------------------------------------------------------

export class StoreBannerDto {
  @ApiProperty({
    enum: ['home_hero', 'home_strip', 'category', 'popup'],
    enumName: 'BannerPosition',
    example: 'home_hero',
  })
  position!: string;

  @ApiProperty({ example: 'แคมเปญกล่องไปรษณีย์ ตุลาคม', description: 'Alt text' })
  title!: string;

  @ApiProperty({ example: IMAGE_URL_EXAMPLE })
  desktopImageUrl!: string;

  @ApiProperty({ type: String, nullable: true, example: IMAGE_URL_EXAMPLE })
  mobileImageUrl!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '/th/products/mailer-box' })
  targetUrl!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  videoUrl!: string | null;
}

export class StoreBannerQuery {
  @ApiPropertyOptional({
    enum: ['home_hero', 'home_strip', 'category', 'popup'],
    enumName: 'BannerPosition',
    example: 'home_hero',
  })
  @IsOptional()
  @IsIn(['home_hero', 'home_strip', 'category', 'popup'])
  position?: string;
}

export class StoreHomeSectionDto {
  @ApiProperty({ example: 'best-sellers' })
  slug!: string;

  @ApiProperty({ type: String, nullable: true, example: 'สินค้าขายดี' })
  titleTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Best sellers' })
  titleEn!: string | null;

  @ApiProperty({
    enum: ['product_types', 'catalog_products', 'showcase', 'articles', 'banner', 'custom'],
    enumName: 'HomeSectionKind',
    example: 'catalog_products',
  })
  kind!: string;

  @ApiProperty({ type: 'object', additionalProperties: true, example: { limit: 8 } })
  config!: Record<string, unknown>;
}

export class StoreArticleCardDto {
  @ApiProperty({ example: 'how-to-choose-a-mailer-box' })
  slug!: string;

  @ApiProperty({ example: 'เลือกกล่องไปรษณีย์อย่างไรให้เหมาะกับสินค้า' })
  titleTh!: string;

  @ApiProperty({ type: String, nullable: true, example: 'How to choose a mailer box' })
  titleEn!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'ขนาด ลอน และการพิมพ์ที่ควรรู้' })
  excerptTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: IMAGE_URL_EXAMPLE })
  coverUrl!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-09-25T09:00:00+07:00' })
  publishedAt!: string;

  @ApiProperty({ type: [String], example: ['packaging-tips'] })
  categorySlugs!: string[];
}

export class StoreArticleDto extends StoreArticleCardDto {
  @ApiProperty({ type: 'object', additionalProperties: true, example: { th: { type: 'doc', content: [] } } })
  body!: Record<string, unknown>;

  @ApiProperty({ type: 'integer', example: 1 })
  bodySchemaVersion!: number;

  @ApiProperty({ type: StoreSeoDto, nullable: true })
  seo!: StoreSeoDto | null;
}

export class StoreArticleListQuery extends PageQuery {
  @ApiPropertyOptional({ example: 'packaging-tips', description: 'Article category slug' })
  @IsOptional()
  @Matches(SLUG)
  category?: string;
}

export class StoreArticleCategoryDto {
  @ApiProperty({ example: 'packaging-tips' })
  slug!: string;

  @ApiProperty({ example: 'เคล็ดลับบรรจุภัณฑ์' })
  nameTh!: string;

  @ApiProperty({ example: 'Packaging tips' })
  nameEn!: string;
}

export class StoreFaqDto {
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
}

export class StoreFaqGroupDto {
  @ApiProperty({ type: String, nullable: true, example: 'ordering' })
  categoryCode!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'การสั่งซื้อ' })
  categoryNameTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Ordering' })
  categoryNameEn!: string | null;

  @ApiProperty({ type: [StoreFaqDto] })
  faqs!: StoreFaqDto[];
}

export class StoreSeoQuery {
  @ApiProperty({ example: '/th/products/mailer-box', description: 'Route or slug' })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  pageKey!: string;
}

// ------------------------------------------------------------------------------------------------
// Geography & search
// ------------------------------------------------------------------------------------------------

export class StoreGeoAreaDto {
  @ApiProperty({ example: '10' })
  code!: string;

  @ApiProperty({ example: 'กรุงเทพมหานคร' })
  nameTh!: string;

  @ApiProperty({ example: 'Bangkok' })
  nameEn!: string;
}

export class StoreGeoSubdistrictDto extends StoreGeoAreaDto {
  @ApiProperty({ example: '10200' })
  postcode!: string;
}

export class StorePostcodeAreaDto {
  @ApiProperty({ type: StoreGeoSubdistrictDto })
  subdistrict!: StoreGeoSubdistrictDto;

  @ApiProperty({ type: StoreGeoAreaDto })
  district!: StoreGeoAreaDto;

  @ApiProperty({ type: StoreGeoAreaDto })
  province!: StoreGeoAreaDto;
}

export class StoreSearchQuery {
  @ApiProperty({ example: 'กล่องไปรษณีย์', description: 'Free text (Thai or English), ≥ 2 characters' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q!: string;
}

export class StoreSearchHitDto {
  @ApiProperty({
    enum: ['catalog_product', 'stock_product', 'showcase_product', 'article'],
    enumName: 'StoreSearchHitKind',
    example: 'catalog_product',
  })
  kind!: string;

  @ApiProperty({ example: 'mailer-box', description: 'Slug (or SKU for stock products) to open' })
  key!: string;

  @ApiProperty({ example: 'กล่องไปรษณีย์' })
  titleTh!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Mailer box' })
  titleEn!: string | null;

  @ApiProperty({ type: String, nullable: true, example: IMAGE_URL_EXAMPLE })
  imageUrl!: string | null;

  @ApiProperty({ example: 0.62, description: 'Trigram similarity (0–1), higher is better' })
  score!: number;
}

export class StoreSearchResultDto {
  @ApiProperty({ example: 'กล่องไปรษณีย์' })
  q!: string;

  @ApiProperty({ type: [StoreSearchHitDto] })
  hits!: StoreSearchHitDto[];
}
