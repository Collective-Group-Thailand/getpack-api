import { OptionalActor, Public } from '@common/auth/auth.decorators';
import { type Actor } from '@common/context/actor';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { paginated } from '@common/pagination/pagination';
import { type Page } from '@common/pagination/pagination.dto';
import { Controller, Get, Header, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { ApiParam, ApiProduces, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { type Response } from 'express';

import {
  IMAGE_URL_EXAMPLE,
  StoreArticleCardDto,
  StoreArticleCategoryDto,
  StoreArticleDto,
  StoreArticleListQuery,
  StoreBannerDto,
  StoreBannerQuery,
  StoreFaqDto,
  StoreFaqGroupDto,
  StoreGeoAreaDto,
  StoreGeoSubdistrictDto,
  StoreHomeSectionDto,
  StorePostcodeAreaDto,
  StoreProductCardDto,
  StoreProductCategoryDto,
  StoreProductDetailDto,
  StoreProductListQuery,
  StoreProductTypeDto,
  StoreSearchQuery,
  StoreSearchResultDto,
  StoreSemiDesignDto,
  StoreSeoDto,
  StoreSeoQuery,
  StoreShowcaseListQuery,
  StoreShowcaseProductDto,
  StoreStockProductDto,
  StoreStockProductListQuery,
} from './store-catalog.dto';
import { StoreCatalogService } from './store-catalog.service';
import { CONFIGURATOR_EXAMPLE, StoreConfiguratorDto } from './store-configurator.dto';
import { StoreConfiguratorService } from './store-configurator.service';
import { StoreMediaService } from './store-media.service';

/** Catalogue reads change rarely: short shared caching; CMS in-window checks keep it short. */
const CACHE = 'public, max-age=60';
const CATALOG = ['D-100', 'D-050'];
const CMS = ['D-005'];

const TYPE_ID = '0192f3a0-7c1e-7d2a-9b1f-0000000c0004';
/** D-307: real starting prices and their basis; no promotion, so no reference price. */
const FACTS = {
  startingPricePerPiece: '4.50',
  startingPriceAssumes: {
    quantity: 1000,
    specs: [
      {
        key: 'material',
        labelTh: 'วัสดุ',
        labelEn: 'Material',
        valueTh: 'อาร์ตการ์ด 350',
        valueEn: 'Art card 350',
      },
    ],
    label: { th: 'อาร์ตการ์ด 350', en: 'Art card 350' },
  },
  moq: 500,
  leadTimeDays: { min: 7, max: 10 },
  availability: 'instant' as const,
  campaignBadge: null,
  cacheTags: [`catalog:type:${TYPE_ID}`, 'catalog:product:tuck-end-box'],
};
const CARD: StoreProductCardDto = {
  ...FACTS,
  slug: 'tuck-end-box',
  productTypeCode: 'folding_carton',
  nameTh: 'กล่องฝาเสียบ',
  nameEn: 'Tuck-end box',
  imageUrl: IMAGE_URL_EXAMPLE,
  templateAvailability: 'drawing',
};
const SEO: StoreSeoDto = {
  title: 'กล่องฝาเสียบพิมพ์ลาย | getpack',
  description: 'สั่งผลิตกล่องฝาเสียบออนไลน์',
  keywords: 'กล่องฝาเสียบ',
  h1: 'กล่องฝาเสียบ',
  h2: null,
  canonicalUrl: null,
  ogImageUrl: null,
  noindex: false,
};
const STOCK: StoreStockProductDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-00000000c001',
  sku: 'PKO-BTL-0250',
  nameTh: 'ขวด PET 250 มล.',
  nameEn: 'PET bottle 250 ml',
  description: 'ขวดใส ฝาเกลียว 28 มม.',
  unit: 'piece',
  capacityMl: 250,
  lengthMm: 60,
  widthMm: 60,
  heightMm: 150,
  minOrderQty: 100,
  isFoodGrade: true,
  inStock: true,
  attributes: [{ attribute: 'colour', code: 'clear', nameTh: 'ใส', nameEn: 'Clear' }],
  imageUrls: [IMAGE_URL_EXAMPLE],
  images: [{ url: IMAGE_URL_EXAMPLE, variant: null }],
  campaignBadge: null,
  cacheTags: [`catalog:type:${TYPE_ID}`],
};
const SHOWCASE: StoreShowcaseProductDto = {
  slug: 'serum-box-30ml',
  categorySlug: 'cosmetics',
  productSlug: 'tuck-end-box',
  nameTh: 'กล่องเซรั่ม 30 มล.',
  nameEn: 'Serum box 30 ml',
  descriptionTh: 'กล่องฝาเสียบ อาร์ตการ์ด 350 แกรม เคลือบด้าน',
  imageUrl: IMAGE_URL_EXAMPLE,
  preset: { lengthMm: 40, widthMm: 40, heightMm: 120 },
};
const ARTICLE: StoreArticleCardDto = {
  slug: 'how-to-choose-a-mailer-box',
  titleTh: 'เลือกกล่องไปรษณีย์อย่างไรให้เหมาะกับสินค้า',
  titleEn: 'How to choose a mailer box',
  excerptTh: 'ขนาด ลอน และการพิมพ์ที่ควรรู้',
  coverUrl: IMAGE_URL_EXAMPLE,
  publishedAt: '2026-09-25T09:00:00+07:00',
  categorySlugs: ['packaging-tips'],
};
const AREA: StoreGeoAreaDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-0000000c0004',
  code: '10',
  nameTh: 'กรุงเทพมหานคร',
  nameEn: 'Bangkok',
};

/** Sizes `store.catalog.getImage` serves: the original, or the worker's 400 px WebP thumbnail. */
export const IMAGE_SIZES = ['full', 'thumb'] as const;

@ApiTags('store.catalog')
@Controller('catalog')
export class StoreCatalogController {
  constructor(
    private readonly catalog: StoreCatalogService,
    private readonly media: StoreMediaService,
    private readonly configurator: StoreConfiguratorService,
  ) {}

  // --- catalogue ------------------------------------------------------------------------------

  @Get('product-types')
  @Public()
  @Header('Cache-Control', CACHE)
  @ApiEndpoint({
    id: 'store.catalog.listProductTypes',
    summary: 'List the product types on sale',
    description:
      'Active types with their quote mode (D-100). A configuration may still route to RFQ when no factory price path covers it (D-043).',
    implements: ['D-100', 'D-043'],
  })
  @ApiSuccess(200, {
    description: 'Product types',
    type: [StoreProductTypeDto],
    example: [
      {
        code: 'folding_carton',
        nameTh: 'กล่องกระดาษแข็ง',
        nameEn: 'Folding carton',
        categoryCode: 'folding_carton',
        quoteMode: 'instant',
        ...FACTS,
        cacheTags: [`catalog:type:${TYPE_ID}`],
      },
    ],
  })
  @ApiStandardErrors('validation.failed')
  productTypes(): Promise<StoreProductTypeDto[]> {
    return this.catalog.productTypes();
  }

  @Get('product-categories')
  @Public()
  @Header('Cache-Control', CACHE)
  @ApiEndpoint({
    id: 'store.catalog.listProductCategories',
    summary: 'List the product categories to browse',
    description:
      'Active categories that hold at least one active product type, directly or through a sub-category, in ' +
      'admin sort order; `parentCode` builds the menu tree. Filter products by `category` (includes ' +
      'sub-categories, D-228).',
    implements: ['D-100', 'D-228'],
  })
  @ApiSuccess(200, {
    description: 'Categories',
    type: [StoreProductCategoryDto],
    example: [
      { code: 'boxes', nameTh: 'กล่อง', nameEn: 'Boxes', parentCode: null, sort: 10 },
      {
        code: 'folding_carton',
        nameTh: 'กล่องกระดาษแข็ง',
        nameEn: 'Folding cartons',
        parentCode: 'boxes',
        sort: 20,
      },
    ],
  })
  @ApiStandardErrors('validation.failed')
  productCategories(): Promise<StoreProductCategoryDto[]> {
    return this.catalog.productCategories();
  }

  @Get('products')
  @Public()
  @Header('Cache-Control', CACHE)
  @ApiEndpoint({
    id: 'store.catalog.listProducts',
    summary: 'List catalogue products',
    description:
      'Active products of active types; filter by type code or product category (with its sub-categories, ' +
      'D-228), `q` searches the names. No prices here.',
    implements: CATALOG,
  })
  @ApiPaginated(StoreProductCardDto, { example: CARD })
  @ApiStandardErrors('validation.failed')
  async products(@Query() query: StoreProductListQuery): Promise<Page<StoreProductCardDto>> {
    const { rows, total } = await this.catalog.products(query);
    return paginated(rows, total, query);
  }

  @Get('products/:slug')
  @Public()
  @Header('Cache-Control', CACHE)
  @ApiParam({ name: 'slug', example: 'tuck-end-box' })
  @ApiEndpoint({
    id: 'store.catalog.getProduct',
    summary: 'Get a catalogue product for the configurator',
    description:
      'Patterns with their size constraints, the options it offers grouped by kind, standard sizes, images, videos and SEO meta. ' +
      'The starting price and `startingPriceAssumes` (lines and one-string `label`) are the default spec priced through ' +
      'the configurator’s own path; with a default spec, `isDefault` marks the options it selects (D-441).',
    implements: [...CATALOG, 'D-441'],
  })
  @ApiSuccess(200, {
    description: 'The product',
    type: StoreProductDetailDto,
    example: {
      ...CARD,
      descriptionTh: 'กล่องพับฝาเสียบบน-ล่าง',
      descriptionEn: 'Reverse tuck-end folding box',
      isCombination: false,
      patterns: [
        {
          code: 'RTE-01',
          styleCode: 'PK-RTE-01',
          internationalName: null,
          name: 'ฝาเสียบกลับด้าน',
          constraints: { minW: 30, maxW: 500 },
          dielineKey: 'rte',
        },
      ],
      styles: [
        { code: 'PK-TE-01', nameTh: 'กล่องฝาเสียบ', nameEn: 'Tuck end box', category: 'folding_carton' },
      ],
      optionGroups: [
        {
          kind: 'material',
          options: [
            {
              id: '0192f3a0-7c1e-7d2a-9b1f-00000000c010',
              code: 'art-card-350',
              nameTh: 'อาร์ตการ์ด 350 แกรม',
              nameEn: 'Art card 350 gsm',
              isDefault: true,
              descriptionTh: 'ผิวเรียบ พิมพ์สีสด',
              descriptionEn: 'Smooth surface, vivid print',
              imageUrl: IMAGE_URL_EXAMPLE,
              swatchHex: null,
              attributes: { kind: 'paper', gsm: 350 },
            },
          ],
        },
      ],
      standardSizes: [{ code: 'S', name: 'ขนาดเล็ก 10×10×5 ซม.', lengthMm: 100, widthMm: 100, heightMm: 50 }],
      images: [{ url: IMAGE_URL_EXAMPLE, variant: null }],
      videos: [
        { provider: 'youtube', url: 'https://www.youtube.com/watch?v=example', title: 'วิธีประกอบกล่อง' },
      ],
      seo: SEO,
    },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  product(@Param('slug') slug: string): Promise<StoreProductDetailDto> {
    return this.catalog.product(slug);
  }

  @Get('products/:slug/configurator')
  @Public()
  @Header('Cache-Control', CACHE)
  @ApiParam({ name: 'slug', example: 'rsc-carton' })
  @ApiEndpoint({
    id: 'store.catalog.getConfigurator',
    summary: 'Get the configurator of a calculator-priced product',
    description:
      'What the configurator needs to build the quote configuration of the product’s calculator (folding, corrugate): ' +
      'patterns with their parts, flutes and typed size rules, standard sizes, the options offered with the ids the ' +
      'configuration takes, the product’s difficulty level, print areas and the D-051 validity; `instant` says whether ' +
      'it is priced online now (D-043, D-100). A product of a type priced by RFQ only is not found. No prices or ' +
      'factory data (D-050). `defaultSpec` is the spec to open on — the admin reference configuration (D-220) the ' +
      '"starting from" price is priced at — and the option, size and quantity defaults follow it, so the configurator ' +
      'opens on the price the product page showed (D-441). `dielineVariantCodes` give the style variants whose ' +
      'dieline the product page can offer for download (D-271).',
    implements: ['D-100', 'D-043', 'D-050', 'D-051', 'D-441'],
  })
  @ApiSuccess(200, {
    description: 'The configurator',
    type: StoreConfiguratorDto,
    example: CONFIGURATOR_EXAMPLE,
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  configuratorOf(@Param('slug') slug: string): Promise<StoreConfiguratorDto> {
    return this.configurator.get(slug);
  }

  @Get('products/:slug/semi-designs')
  @Public()
  @Header('Cache-Control', CACHE)
  @ApiParam({ name: 'slug', example: 'tuck-end-box' })
  @ApiEndpoint({
    id: 'store.catalog.listSemiDesigns',
    summary: 'List the semi-designs of a catalogue product',
    description: 'Active semi-custom designs with their palette and the sizes that have a template.',
    implements: ['D-005'],
  })
  @ApiSuccess(200, {
    description: 'Semi-designs',
    type: [StoreSemiDesignDto],
    example: [
      {
        id: '0192f3a0-7c1e-7d2a-9b1f-00000000b003',
        name: 'มินิมอล ขาว-ดำ',
        thumbnailUrl: IMAGE_URL_EXAMPLE,
        colours: ['#000000', '#FFFFFF'],
        sizeCodes: ['S'],
      },
    ],
  })
  @ApiStandardErrors('validation.failed')
  semiDesigns(@Param('slug') slug: string): Promise<StoreSemiDesignDto[]> {
    return this.catalog.semiDesigns(slug);
  }

  @Get('stock-products')
  @Public()
  @Header('Cache-Control', CACHE)
  @ApiEndpoint({
    id: 'store.catalog.listStockProducts',
    summary: 'List ready-made stock products',
    description:
      'Active stock products with attribute filters (`attributes=colour:clear,shape:round`), the product ' +
      'category (with its sub-categories, D-228) and `q`. `inStock` aggregates the supplying factories without ' +
      'naming them (D-050); prices come from quotes.',
    implements: ['D-100', 'D-050', 'D-228'],
  })
  @ApiPaginated(StoreStockProductDto, { example: STOCK })
  @ApiStandardErrors('validation.failed')
  async stockProducts(@Query() query: StoreStockProductListQuery): Promise<Page<StoreStockProductDto>> {
    const { rows, total } = await this.catalog.stockProducts(query);
    return paginated(rows, total, query);
  }

  @Get('stock-products/:sku')
  @Public()
  @Header('Cache-Control', CACHE)
  @ApiParam({ name: 'sku', example: 'PKO-BTL-0250' })
  @ApiEndpoint({
    id: 'store.catalog.getStockProduct',
    summary: 'Get a stock product',
    description:
      'One active stock product with attributes, photos and availability (D-050: no factory named).',
    implements: ['D-100', 'D-050'],
  })
  @ApiSuccess(200, { description: 'The stock product', type: StoreStockProductDto, example: STOCK })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  stockProduct(@Param('sku') sku: string): Promise<StoreStockProductDto> {
    return this.catalog.stockProduct(sku);
  }

  @Get('showcase')
  @Public()
  @Header('Cache-Control', CACHE)
  @ApiEndpoint({
    id: 'store.catalog.listShowcase',
    summary: 'List showcase products',
    description: 'Pre-configured products ("Product Groups") by category.',
    implements: CATALOG,
  })
  @ApiPaginated(StoreShowcaseProductDto, { example: SHOWCASE })
  @ApiStandardErrors('validation.failed')
  async showcase(@Query() query: StoreShowcaseListQuery): Promise<Page<StoreShowcaseProductDto>> {
    const { rows, total } = await this.catalog.showcase(query);
    return paginated(rows, total, query);
  }

  @Get('showcase/:slug')
  @Public()
  @Header('Cache-Control', CACHE)
  @ApiParam({ name: 'slug', example: 'serum-box-30ml' })
  @ApiEndpoint({
    id: 'store.catalog.getShowcaseProduct',
    summary: 'Get a showcase product',
    description: 'The product to configure and its pre-filled configuration.',
    implements: CATALOG,
  })
  @ApiSuccess(200, { description: 'The showcase product', type: StoreShowcaseProductDto, example: SHOWCASE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  showcaseProduct(@Param('slug') slug: string): Promise<StoreShowcaseProductDto> {
    return this.catalog.showcaseProduct(slug);
  }

  @Get('search')
  @Public()
  @Header('Cache-Control', CACHE)
  @ApiEndpoint({
    id: 'store.catalog.search',
    summary: 'Search products, articles and FAQs',
    description:
      'Trigram search (`pg_trgm`) over catalogue products, stock products, showcase products, published style-library bases (`style`, key = base code; their names, codes and search synonyms), articles and published FAQ questions (`faq`, key = FAQ id), ranked by similarity (the best 8 of each kind, 40 in all).',
    implements: ['D-100', 'D-102'],
  })
  @ApiSuccess(200, {
    description: 'Hits',
    type: StoreSearchResultDto,
    example: {
      q: 'กล่องไปรษณีย์',
      hits: [
        {
          kind: 'catalog_product',
          key: 'mailer-box',
          titleTh: 'กล่องไปรษณีย์',
          titleEn: 'Mailer box',
          imageUrl: IMAGE_URL_EXAMPLE,
          score: 0.62,
        },
      ],
    },
  })
  @ApiStandardErrors('validation.failed')
  async search(
    @OptionalActor() actor: Actor | undefined,
    @Query() query: StoreSearchQuery,
  ): Promise<StoreSearchResultDto> {
    const hits = await this.catalog.search(query.q);
    // Analytics (B6): written on each request that reaches the API (cached responses are not counted).
    await this.catalog.logSearch(query.q, hits.length, actor?.type === 'user' ? actor.userId : undefined);
    return { q: query.q, hits };
  }

  // --- CMS ------------------------------------------------------------------------------------

  @Get('banners')
  @Public()
  @Header('Cache-Control', CACHE)
  @ApiEndpoint({
    id: 'store.catalog.listBanners',
    summary: 'List the banners shown now',
    description: 'Published banners inside their validity window, by position and order.',
    implements: CMS,
  })
  @ApiSuccess(200, {
    description: 'Banners',
    type: [StoreBannerDto],
    example: [
      {
        position: 'home_hero',
        title: 'แคมเปญกล่องไปรษณีย์ ตุลาคม',
        desktopImageUrl: IMAGE_URL_EXAMPLE,
        mobileImageUrl: null,
        targetUrl: '/th/products/mailer-box',
        videoUrl: null,
      },
    ],
  })
  @ApiStandardErrors('validation.failed')
  banners(@Query() query: StoreBannerQuery): Promise<StoreBannerDto[]> {
    return this.catalog.banners(query.position);
  }

  @Get('home-sections')
  @Public()
  @Header('Cache-Control', CACHE)
  @ApiEndpoint({
    id: 'store.catalog.listHomeSections',
    summary: 'List the home-page sections',
    description: 'Published sections in display order.',
    implements: CMS,
  })
  @ApiSuccess(200, {
    description: 'Sections',
    type: [StoreHomeSectionDto],
    example: [
      {
        slug: 'best-sellers',
        titleTh: 'สินค้าขายดี',
        titleEn: 'Best sellers',
        kind: 'catalog_products',
        config: { limit: 8 },
      },
    ],
  })
  @ApiStandardErrors('validation.failed')
  homeSections(): Promise<StoreHomeSectionDto[]> {
    return this.catalog.homeSections();
  }

  @Get('articles')
  @Public()
  @Header('Cache-Control', CACHE)
  @ApiEndpoint({
    id: 'store.catalog.listArticles',
    summary: 'List published articles',
    description: 'Newest first; filter by category slug.',
    implements: CMS,
  })
  @ApiPaginated(StoreArticleCardDto, { example: ARTICLE })
  @ApiStandardErrors('validation.failed')
  async articles(@Query() query: StoreArticleListQuery): Promise<Page<StoreArticleCardDto>> {
    const { rows, total } = await this.catalog.articles(query);
    return paginated(rows, total, query);
  }

  @Get('articles/:slug')
  @Public()
  @Header('Cache-Control', CACHE)
  @ApiParam({ name: 'slug', example: 'how-to-choose-a-mailer-box' })
  @ApiEndpoint({
    id: 'store.catalog.getArticle',
    summary: 'Get a published article',
    description: 'Rich-text body per language and SEO meta.',
    implements: CMS,
  })
  @ApiSuccess(200, {
    description: 'The article',
    type: StoreArticleDto,
    example: { ...ARTICLE, body: { th: { type: 'doc', content: [] } }, bodySchemaVersion: 1, seo: SEO },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  article(@Param('slug') slug: string): Promise<StoreArticleDto> {
    return this.catalog.article(slug);
  }

  @Get('article-categories')
  @Public()
  @Header('Cache-Control', CACHE)
  @ApiEndpoint({
    id: 'store.catalog.listArticleCategories',
    summary: 'List article categories',
    description: 'Published categories in display order.',
    implements: CMS,
  })
  @ApiSuccess(200, {
    description: 'Categories',
    type: [StoreArticleCategoryDto],
    example: [{ slug: 'packaging-tips', nameTh: 'เคล็ดลับบรรจุภัณฑ์', nameEn: 'Packaging tips' }],
  })
  @ApiStandardErrors('validation.failed')
  articleCategories(): Promise<StoreArticleCategoryDto[]> {
    return this.catalog.articleCategories();
  }

  @Get('faqs')
  @Public()
  @Header('Cache-Control', CACHE)
  @ApiEndpoint({
    id: 'store.catalog.listFaqs',
    summary: 'List the FAQs by category',
    description: 'Published questions grouped by their (published) category; uncategorised questions last.',
    implements: CMS,
  })
  @ApiSuccess(200, {
    description: 'FAQ groups',
    type: [StoreFaqGroupDto],
    example: [
      {
        categoryCode: 'ordering',
        categoryNameTh: 'การสั่งซื้อ',
        categoryNameEn: 'Ordering',
        faqs: [
          {
            questionTh: 'สั่งขั้นต่ำกี่ชิ้น',
            questionEn: 'What is the minimum order?',
            answerTh: 'ขึ้นอยู่กับประเภทสินค้า',
            answerEn: 'It depends on the product type.',
          },
        ],
      },
    ],
  })
  @ApiStandardErrors('validation.failed')
  faqs(): Promise<StoreFaqGroupDto[]> {
    return this.catalog.faqs();
  }

  @Get('products/:slug/faqs')
  @Public()
  @Header('Cache-Control', CACHE)
  @ApiEndpoint({
    id: 'store.catalog.listProductFaqs',
    summary: 'List the FAQs of a catalogue product',
    description:
      'Published FAQs that the CMS links to this product (`PUT /v1/admin/cms/faqs/{id}/catalog-products`), in ' +
      'admin sort order; empty when none is linked.',
    implements: CMS,
  })
  @ApiParam({ name: 'slug', example: 'tuck-end-box' })
  @ApiSuccess(200, {
    description: 'FAQs',
    type: [StoreFaqDto],
    example: [
      {
        questionTh: 'สั่งขั้นต่ำกี่ชิ้น',
        questionEn: 'What is the minimum order?',
        answerTh: 'ขึ้นอยู่กับประเภทสินค้า',
        answerEn: 'It depends on the product type.',
      },
    ],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  productFaqs(@Param('slug') slug: string): Promise<StoreFaqDto[]> {
    return this.catalog.productFaqs(slug);
  }

  @Get('seo')
  @Public()
  @Header('Cache-Control', CACHE)
  @ApiEndpoint({
    id: 'store.catalog.getSeo',
    summary: 'Get the SEO meta of a page',
    description: 'By route or slug (`pageKey`), for server-side rendering of the storefront.',
    implements: CMS,
  })
  @ApiSuccess(200, { description: 'SEO meta', type: StoreSeoDto, example: SEO })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  seo(@Query() query: StoreSeoQuery): Promise<StoreSeoDto> {
    return this.catalog.seo(query.pageKey);
  }

  // --- geography ------------------------------------------------------------------------------

  @Get('geo/provinces')
  @Public()
  @Header('Cache-Control', 'public, max-age=3600')
  @ApiEndpoint({
    id: 'store.catalog.listProvinces',
    summary: 'List provinces',
    description: 'Admin-maintained geography for address forms (D-161).',
    implements: ['D-161'],
  })
  @ApiSuccess(200, { description: 'Provinces', type: [StoreGeoAreaDto], example: [AREA] })
  @ApiStandardErrors('validation.failed')
  provinces(): Promise<StoreGeoAreaDto[]> {
    return this.catalog.provinces();
  }

  @Get('geo/provinces/:code/districts')
  @Public()
  @Header('Cache-Control', 'public, max-age=3600')
  @ApiParam({ name: 'code', example: '10' })
  @ApiEndpoint({
    id: 'store.catalog.listDistricts',
    summary: 'List the districts of a province',
    description: 'By province code (D-161).',
    implements: ['D-161'],
  })
  @ApiSuccess(200, {
    description: 'Districts',
    type: [StoreGeoAreaDto],
    example: [
      { id: '0192f3a0-7c1e-7d2a-9b1f-0000000c0005', code: '1001', nameTh: 'พระนคร', nameEn: 'Phra Nakhon' },
    ],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  districts(@Param('code') code: string): Promise<StoreGeoAreaDto[]> {
    return this.catalog.districts(code);
  }

  @Get('geo/districts/:code/subdistricts')
  @Public()
  @Header('Cache-Control', 'public, max-age=3600')
  @ApiParam({ name: 'code', example: '1001' })
  @ApiEndpoint({
    id: 'store.catalog.listSubdistricts',
    summary: 'List the subdistricts of a district',
    description: 'By district code, with postcodes (D-161).',
    implements: ['D-161'],
  })
  @ApiSuccess(200, {
    description: 'Subdistricts',
    type: [StoreGeoSubdistrictDto],
    example: [
      {
        id: '0192f3a0-7c1e-7d2a-9b1f-0000000c0006',
        code: '100101',
        nameTh: 'พระบรมมหาราชวัง',
        nameEn: 'Phra Borom Maha Ratchawang',
        postcode: '10200',
      },
    ],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  subdistricts(@Param('code') code: string): Promise<StoreGeoSubdistrictDto[]> {
    return this.catalog.subdistricts(code);
  }

  @Get('geo/postcodes/:postcode')
  @Public()
  @Header('Cache-Control', 'public, max-age=3600')
  @ApiParam({ name: 'postcode', example: '10200', description: '5 digits' })
  @ApiEndpoint({
    id: 'store.catalog.lookupPostcode',
    summary: 'Look up the areas of a postcode',
    description:
      'Every subdistrict with this postcode and its district and province, with the ids an address takes ' +
      '(D-161); empty when unknown.',
    implements: ['D-161'],
  })
  @ApiSuccess(200, {
    description: 'Areas',
    type: [StorePostcodeAreaDto],
    example: [
      {
        subdistrict: {
          id: '0192f3a0-7c1e-7d2a-9b1f-0000000c0006',
          code: '100101',
          nameTh: 'พระบรมมหาราชวัง',
          nameEn: 'Phra Borom Maha Ratchawang',
          postcode: '10200',
        },
        district: {
          id: '0192f3a0-7c1e-7d2a-9b1f-0000000c0005',
          code: '1001',
          nameTh: 'พระนคร',
          nameEn: 'Phra Nakhon',
        },
        province: AREA,
      },
    ],
  })
  @ApiStandardErrors('validation.failed')
  postcode(@Param('postcode') postcode: string): Promise<StorePostcodeAreaDto[]> {
    return /^[0-9]{5}$/.test(postcode) ? this.catalog.postcode(postcode) : Promise.resolve([]);
  }

  // --- media ----------------------------------------------------------------------------------

  @Get('images/:fileId')
  @Public()
  @ApiParam({
    name: 'fileId',
    format: 'uuid',
    description: 'Image file referenced by visible catalogue content',
  })
  @ApiEndpoint({
    id: 'store.catalog.getImage',
    summary: 'Get a catalogue image',
    description:
      'Served only while an active catalogue row or published CMS content references the file and its malware ' +
      'scan is clean (contract §3 "Files"); anything else is 404. `size=thumb` serves the 640 px WebP thumbnail ' +
      '(the original when there is none) — for cards and lists. Cacheable for a day.',
    implements: ['D-005'],
  })
  @ApiQuery({
    name: 'size',
    required: false,
    enum: IMAGE_SIZES,
    enumName: 'StoreImageSize',
    description: '`thumb`: the WebP thumbnail (640 px wide) for cards; default the original',
  })
  @ApiProduces('image/png', 'image/jpeg', 'image/webp')
  @ApiResponse({
    status: 200,
    description: 'The image bytes',
    content: {
      'image/png': { schema: { type: 'string', format: 'binary' }, example: '(binary image)' },
      'image/jpeg': { schema: { type: 'string', format: 'binary' }, example: '(binary image)' },
      'image/webp': { schema: { type: 'string', format: 'binary' }, example: '(binary image)' },
    },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async image(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Query('size') size: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const image = await this.media.image(fileId, size === 'thumb' ? 'thumb' : 'full');
    res.setHeader('Content-Type', image.mimeType);
    res.setHeader('Content-Length', image.sizeBytes.toString());
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('ETag', image.etag);
    image.stream.pipe(res);
  }

  @Get('merchant-feed.xml')
  @Public()
  @Header('Cache-Control', 'public, max-age=3600')
  @ApiEndpoint({
    id: 'store.catalog.merchantFeed',
    summary: 'Google Merchant feed',
    description:
      'RSS 2.0 with the `g:` namespace: active stock products with a nationwide price summary and a photo; ' +
      'brand getpack (D-001), no factory data (D-050). Items appear once the standard-product calculator fills the price summaries (B2.3).',
    implements: ['D-001', 'D-050'],
  })
  @ApiProduces('application/xml')
  @ApiResponse({
    status: 200,
    description: 'The feed',
    content: {
      'application/xml': {
        schema: { type: 'string' },
        example:
          '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>getpack</title>' +
          '<item><g:id>PKO-BTL-0250</g:id><g:price>3.50 THB</g:price></item></channel></rss>',
      },
    },
  })
  @ApiStandardErrors('validation.failed')
  async merchantFeed(@Res() res: Response): Promise<void> {
    res.type('application/xml').send(await this.media.merchantFeed());
  }
}
