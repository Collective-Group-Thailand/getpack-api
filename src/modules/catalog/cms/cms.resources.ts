import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { type Tx } from '@database/prisma.service';
import { type Prisma, type VideoSubject } from '@generated/prisma/client';

import { defineResource } from '../crud/catalog-resource';
import { compact } from '../crud/compact';
import {
  ArticleCategoryDto,
  ArticleCategoryListQuery,
  ArticleDto,
  ArticleListQuery,
  BannerDto,
  BannerListQuery,
  CMS_IDS,
  CreateArticleCategoryDto,
  CreateArticleDto,
  CreateBannerDto,
  CreateFaqCategoryDto,
  CreateFaqDto,
  CreateHomeSectionDto,
  CreateSeoPageDto,
  CreateVideoDto,
  FaqCategoryDto,
  FaqCategoryListQuery,
  FaqDto,
  FaqListQuery,
  HomeSectionDto,
  HomeSectionListQuery,
  SeoPageDto,
  SeoPageListQuery,
  UpdateArticleCategoryDto,
  UpdateArticleDto,
  UpdateBannerDto,
  UpdateFaqCategoryDto,
  UpdateFaqDto,
  UpdateHomeSectionDto,
  UpdateSeoPageDto,
  UpdateVideoDto,
  VideoDto,
  VideoListQuery,
} from './cms.dto';

const TS = '2026-09-25T10:00:00+07:00';
const iso = (d: Date | null) => (d ? toBangkokIso(d) : null);
/** CMS content is created by admins and Marketing (D-005; no SEO role in D-140, schema-design C-6). */
const CMS = ['D-005'];
const NOT_DELETED = { deletedAt: null };

// ------------------------------------------------------------------------------------------------

const BANNER_INCLUDE = {
  desktopFile: { select: { publicId: true } },
  mobileFile: { select: { publicId: true } },
} satisfies Prisma.BannerInclude;
type BannerRow = Prisma.BannerGetPayload<{ include: typeof BANNER_INCLUDE }>;

export const banners = defineResource({
  key: 'banner',
  path: 'banners',
  operation: 'cmsBanners',
  area: 'cms',
  label: 'banner',
  labelPlural: 'banners',
  implements: CMS,
  note: 'Shown on the storefront while `published` and inside `validFrom…validTo`.',
  read: 'cms.manage',
  manage: 'cms.manage',
  delegate: (tx) => tx.banner,
  include: BANNER_INCLUDE,
  baseWhere: NOT_DELETED,
  softDelete: true,
  dto: BannerDto,
  createDto: CreateBannerDto,
  updateDto: UpdateBannerDto,
  queryDto: BannerListQuery,
  example: {
    id: CMS_IDS.banner,
    position: 'home_hero',
    title: 'แคมเปญกล่องไปรษณีย์ ตุลาคม',
    desktopFileId: CMS_IDS.file,
    mobileFileId: CMS_IDS.file2,
    targetUrl: '/th/products/mailer-box',
    videoUrl: null,
    validFrom: '2026-10-01T00:00:00+07:00',
    validTo: '2026-10-31T23:59:59+07:00',
    sort: 10,
    status: 'published',
    updatedAt: TS,
  },
  createExample: {
    position: 'home_hero',
    title: 'แคมเปญกล่องไปรษณีย์ ตุลาคม',
    desktopFileId: CMS_IDS.file,
    targetUrl: '/th/products/mailer-box',
  },
  updateExample: { status: 'published' },
  toDto: (row: BannerRow): BannerDto => ({
    id: row.publicId,
    position: row.position,
    title: row.title,
    desktopFileId: row.desktopFile.publicId,
    mobileFileId: row.mobileFile?.publicId ?? null,
    targetUrl: row.targetUrl,
    videoUrl: row.videoUrl,
    validFrom: iso(row.validFrom),
    validTo: iso(row.validTo),
    sort: row.sort,
    status: row.status,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: async (input: CreateBannerDto, refs) => ({
    ...input,
    desktopFileId: await refs.file(input.desktopFileId, 'desktopFileId'),
    mobileFileId: await refs.optionalFile(input.mobileFileId, 'mobileFileId'),
  }),
  updateData: async (input: UpdateBannerDto, refs) =>
    compact({
      ...input,
      desktopFileId:
        input.desktopFileId === undefined ? undefined : await refs.file(input.desktopFileId, 'desktopFileId'),
      mobileFileId: await refs.optionalFile(input.mobileFileId, 'mobileFileId'),
    }),
  where: (q: BannerListQuery) => compact({ status: q.status, position: q.position }),
  search: ['title'],
  sort: { sort: 'sort', updatedAt: 'updatedAt', validFrom: 'validFrom' },
  conflict: 'catalog.code_taken',
});

// ------------------------------------------------------------------------------------------------

type SectionRow = Prisma.HomeSectionGetPayload<object>;

export const homeSections = defineResource({
  key: 'home_section',
  path: 'home-sections',
  operation: 'cmsHomeSections',
  area: 'cms',
  label: 'home section',
  labelPlural: 'home sections',
  implements: CMS,
  note: 'Blocks of the storefront home page; order with `actions/reorder`.',
  read: 'cms.manage',
  manage: 'cms.manage',
  delegate: (tx) => tx.homeSection,
  baseWhere: NOT_DELETED,
  softDelete: true,
  dto: HomeSectionDto,
  createDto: CreateHomeSectionDto,
  updateDto: UpdateHomeSectionDto,
  queryDto: HomeSectionListQuery,
  example: {
    id: CMS_IDS.section,
    slug: 'best-sellers',
    titleTh: 'สินค้าขายดี',
    titleEn: 'Best sellers',
    kind: 'catalog_products',
    config: { catalogProductIds: [CMS_IDS.catalogProduct] },
    sort: 10,
    status: 'published',
    updatedAt: TS,
  },
  createExample: { slug: 'best-sellers', titleTh: 'สินค้าขายดี', kind: 'catalog_products', config: {} },
  updateExample: { titleEn: 'Best sellers' },
  toDto: (row: SectionRow): HomeSectionDto => ({
    id: row.publicId,
    slug: row.slug,
    titleTh: row.titleTh,
    titleEn: row.titleEn,
    kind: row.kind,
    config: row.config as Record<string, unknown>,
    sort: row.sort,
    status: row.status,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: (input: CreateHomeSectionDto) => ({
    ...input,
    config: (input.config ?? {}) as Prisma.InputJsonValue,
  }),
  updateData: (input: UpdateHomeSectionDto) =>
    compact({ ...input, config: input.config as Prisma.InputJsonValue | undefined }),
  where: (q: HomeSectionListQuery) => compact({ status: q.status }),
  search: ['slug', 'titleTh', 'titleEn'],
  sort: { sort: 'sort', updatedAt: 'updatedAt' },
  conflict: 'catalog.slug_taken',
});

// ------------------------------------------------------------------------------------------------

type ArticleCategoryRow = Prisma.ArticleCategoryGetPayload<{
  include: { seoPage: { select: { publicId: true } } };
}>;

export const articleCategories = defineResource({
  key: 'article_category',
  path: 'article-categories',
  operation: 'cmsArticleCategories',
  area: 'cms',
  label: 'article category',
  labelPlural: 'article categories',
  implements: CMS,
  read: 'cms.manage',
  manage: 'cms.manage',
  delegate: (tx) => tx.articleCategory,
  include: { seoPage: { select: { publicId: true } } },
  dto: ArticleCategoryDto,
  createDto: CreateArticleCategoryDto,
  updateDto: UpdateArticleCategoryDto,
  queryDto: ArticleCategoryListQuery,
  example: {
    id: CMS_IDS.articleCategory,
    slug: 'packaging-tips',
    nameTh: 'เคล็ดลับบรรจุภัณฑ์',
    nameEn: 'Packaging tips',
    seoPageId: null,
    sort: 10,
    status: 'published',
    audience: 'public',
    updatedAt: TS,
  },
  createExample: { slug: 'packaging-tips', nameTh: 'เคล็ดลับบรรจุภัณฑ์', nameEn: 'Packaging tips' },
  updateExample: { status: 'published' },
  toDto: (row: ArticleCategoryRow): ArticleCategoryDto => ({
    id: row.publicId,
    slug: row.slug,
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    seoPageId: row.seoPage?.publicId ?? null,
    sort: row.sort,
    status: row.status,
    audience: row.audience,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: async (input: CreateArticleCategoryDto, refs) => ({
    ...input,
    seoPageId: await refs.optional('seoPage', input.seoPageId, 'seoPageId'),
  }),
  updateData: async (input: UpdateArticleCategoryDto, refs) =>
    compact({ ...input, seoPageId: await refs.optional('seoPage', input.seoPageId, 'seoPageId') }),
  where: (q: ArticleCategoryListQuery) => compact({ status: q.status, audience: q.audience }),
  search: ['slug', 'nameTh', 'nameEn'],
  sort: { sort: 'sort', updatedAt: 'updatedAt' },
  conflict: 'catalog.slug_taken',
});

// ------------------------------------------------------------------------------------------------

export const ARTICLE_INCLUDE = {
  coverFile: { select: { publicId: true } },
  seoPage: { select: { publicId: true } },
  categories: { include: { category: { select: { publicId: true } } } },
} satisfies Prisma.ArticleInclude;
export type ArticleRow = Prisma.ArticleGetPayload<{ include: typeof ARTICLE_INCLUDE }>;

export const articleDto = (row: ArticleRow): ArticleDto => ({
  id: row.publicId,
  slug: row.slug,
  titleTh: row.titleTh,
  titleEn: row.titleEn,
  excerptTh: row.excerptTh,
  excerptEn: row.excerptEn,
  coverFileId: row.coverFile?.publicId ?? null,
  body: row.body as Record<string, unknown>,
  bodySchemaVersion: row.bodySchemaVersion,
  status: row.status,
  publishedAt: iso(row.publishedAt),
  seoPageId: row.seoPage?.publicId ?? null,
  categoryIds: row.categories.map((c) => c.category.publicId),
  audience: row.audience,
  updatedAt: toBangkokIso(row.updatedAt),
});

export const ARTICLE_EXAMPLE: ArticleDto = {
  id: CMS_IDS.article,
  slug: 'how-to-choose-a-mailer-box',
  titleTh: 'เลือกกล่องไปรษณีย์อย่างไรให้เหมาะกับสินค้า',
  titleEn: 'How to choose a mailer box',
  excerptTh: 'ขนาด ลอน และการพิมพ์ที่ควรรู้',
  excerptEn: null,
  coverFileId: CMS_IDS.file,
  body: { th: { type: 'doc', content: [] } },
  bodySchemaVersion: 1,
  status: 'published',
  publishedAt: '2026-09-25T09:00:00+07:00',
  seoPageId: null,
  categoryIds: [CMS_IDS.articleCategory],
  audience: 'public',
  updatedAt: TS,
};

/** The first publication stamps `publishedAt` (check `ck_articles__published`); later edits keep it. */
const publishedAt = (status: string | undefined, current: Date | null) =>
  status === 'published' && current === null ? new Date() : undefined;

export const articles = defineResource({
  key: 'article',
  path: 'articles',
  operation: 'cmsArticles',
  area: 'cms',
  label: 'article',
  labelPlural: 'articles',
  implements: CMS,
  note: 'Categories are set through `PUT …/categories`. Publishing stamps `publishedAt` once.',
  read: 'cms.manage',
  manage: 'cms.manage',
  delegate: (tx) => tx.article,
  include: ARTICLE_INCLUDE,
  baseWhere: NOT_DELETED,
  softDelete: true,
  dto: ArticleDto,
  createDto: CreateArticleDto,
  updateDto: UpdateArticleDto,
  queryDto: ArticleListQuery,
  example: ARTICLE_EXAMPLE,
  createExample: {
    slug: 'how-to-choose-a-mailer-box',
    titleTh: 'เลือกกล่องไปรษณีย์อย่างไรให้เหมาะกับสินค้า',
    body: { th: { type: 'doc', content: [] } },
  },
  updateExample: { status: 'published' },
  toDto: articleDto,
  createData: async (input: CreateArticleDto, refs) => ({
    ...input,
    body: (input.body ?? {}) as Prisma.InputJsonValue,
    coverFileId: await refs.optionalFile(input.coverFileId, 'coverFileId'),
    seoPageId: await refs.optional('seoPage', input.seoPageId, 'seoPageId'),
    publishedAt: publishedAt(input.status, null),
  }),
  updateData: async (input: UpdateArticleDto, refs, current: ArticleRow) =>
    compact({
      ...input,
      body: input.body as Prisma.InputJsonValue | undefined,
      coverFileId: await refs.optionalFile(input.coverFileId, 'coverFileId'),
      seoPageId: await refs.optional('seoPage', input.seoPageId, 'seoPageId'),
      publishedAt: publishedAt(input.status, current.publishedAt),
    }),
  where: (q: ArticleListQuery) =>
    compact({
      status: q.status,
      audience: q.audience,
      categories: q.categoryId ? { some: { category: { publicId: q.categoryId } } } : undefined,
    }),
  search: ['slug', 'titleTh', 'titleEn'],
  sort: { publishedAt: 'publishedAt', updatedAt: 'updatedAt', slug: 'slug' },
  conflict: 'catalog.slug_taken',
});

// ------------------------------------------------------------------------------------------------

type FaqCategoryRow = Prisma.FaqCategoryGetPayload<object>;

export const faqCategories = defineResource({
  key: 'faq_category',
  path: 'faq-categories',
  operation: 'cmsFaqCategories',
  area: 'cms',
  label: 'FAQ category',
  labelPlural: 'FAQ categories',
  implements: CMS,
  read: 'cms.manage',
  manage: 'cms.manage',
  delegate: (tx) => tx.faqCategory,
  dto: FaqCategoryDto,
  createDto: CreateFaqCategoryDto,
  updateDto: UpdateFaqCategoryDto,
  queryDto: FaqCategoryListQuery,
  example: {
    id: CMS_IDS.faqCategory,
    code: 'ordering',
    nameTh: 'การสั่งซื้อ',
    nameEn: 'Ordering',
    sort: 10,
    status: 'published',
    updatedAt: TS,
  },
  createExample: { code: 'ordering', nameTh: 'การสั่งซื้อ', nameEn: 'Ordering' },
  updateExample: { sort: 20 },
  toDto: (row: FaqCategoryRow): FaqCategoryDto => ({
    id: row.publicId,
    code: row.code,
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    sort: row.sort,
    status: row.status,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: (input: CreateFaqCategoryDto) => ({ ...input }),
  updateData: (input: UpdateFaqCategoryDto) => compact({ ...input }),
  where: (q: FaqCategoryListQuery) => compact({ status: q.status }),
  search: ['code', 'nameTh', 'nameEn'],
  sort: { sort: 'sort', code: 'code', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

const FAQ_INCLUDE = {
  category: { select: { publicId: true } },
  catalogProducts: {
    select: { catalogProduct: { select: { publicId: true } } },
    orderBy: { catalogProductId: 'asc' },
  },
} as const satisfies Prisma.FaqInclude;
type FaqRow = Prisma.FaqGetPayload<{ include: typeof FAQ_INCLUDE }>;

export const faqs = defineResource({
  key: 'faq',
  path: 'faqs',
  operation: 'cmsFaqs',
  area: 'cms',
  label: 'FAQ',
  labelPlural: 'FAQs',
  implements: CMS,
  read: 'cms.manage',
  manage: 'cms.manage',
  note: 'Linked catalogue products are set through `PUT …/catalog-products`.',
  delegate: (tx) => tx.faq,
  include: FAQ_INCLUDE,
  baseWhere: NOT_DELETED,
  softDelete: true,
  dto: FaqDto,
  createDto: CreateFaqDto,
  updateDto: UpdateFaqDto,
  queryDto: FaqListQuery,
  example: {
    id: CMS_IDS.faq,
    categoryId: CMS_IDS.faqCategory,
    questionTh: 'สั่งขั้นต่ำกี่ชิ้น',
    questionEn: 'What is the minimum order?',
    answerTh: 'ขึ้นอยู่กับประเภทสินค้า ดูได้ในหน้าสินค้าแต่ละรายการ',
    answerEn: 'It depends on the product type; see each product page.',
    sort: 10,
    status: 'published',
    catalogProductIds: [CMS_IDS.catalogProduct],
    updatedAt: TS,
  },
  createExample: {
    categoryId: CMS_IDS.faqCategory,
    questionTh: 'สั่งขั้นต่ำกี่ชิ้น',
    answerTh: 'ขึ้นอยู่กับประเภทสินค้า ดูได้ในหน้าสินค้าแต่ละรายการ',
  },
  updateExample: { status: 'published' },
  toDto: (row: FaqRow): FaqDto => ({
    id: row.publicId,
    categoryId: row.category?.publicId ?? null,
    questionTh: row.questionTh,
    questionEn: row.questionEn,
    answerTh: row.answerTh,
    answerEn: row.answerEn,
    sort: row.sort,
    status: row.status,
    catalogProductIds: row.catalogProducts.map((l) => l.catalogProduct.publicId),
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: async (input: CreateFaqDto, refs) => ({
    ...input,
    categoryId: await refs.optional('faqCategory', input.categoryId, 'categoryId'),
  }),
  updateData: async (input: UpdateFaqDto, refs) =>
    compact({ ...input, categoryId: await refs.optional('faqCategory', input.categoryId, 'categoryId') }),
  where: (q: FaqListQuery) =>
    compact({ status: q.status, category: q.categoryId ? { publicId: q.categoryId } : undefined }),
  search: ['questionTh', 'questionEn', 'answerTh'],
  sort: { sort: 'sort', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

// ------------------------------------------------------------------------------------------------

type SeoRow = Prisma.SeoPageGetPayload<{ include: { ogImageFile: { select: { publicId: true } } } }>;

export const seoPageDto = (row: SeoRow): SeoPageDto => ({
  id: row.publicId,
  pageKey: row.pageKey,
  titleTh: row.titleTh,
  titleEn: row.titleEn,
  descriptionTh: row.descriptionTh,
  descriptionEn: row.descriptionEn,
  keywords: row.keywords,
  h1: row.h1,
  h2: row.h2,
  canonicalUrl: row.canonicalUrl,
  ogImageFileId: row.ogImageFile?.publicId ?? null,
  noindex: row.noindex,
  updatedAt: toBangkokIso(row.updatedAt),
});

export const SEO_PAGE_EXAMPLE: SeoPageDto = {
  id: CMS_IDS.seoPage,
  pageKey: '/th/products/mailer-box',
  titleTh: 'กล่องไปรษณีย์พิมพ์ลาย สั่งผลิตออนไลน์ | Packio',
  titleEn: 'Printed mailer boxes online | Packio',
  descriptionTh: 'ออกแบบและสั่งผลิตกล่องไปรษณีย์ได้ในไม่กี่คลิก',
  descriptionEn: null,
  keywords: 'กล่องไปรษณีย์, กล่องพิมพ์ลาย',
  h1: 'กล่องไปรษณีย์พิมพ์ลาย',
  h2: null,
  canonicalUrl: null,
  ogImageFileId: null,
  noindex: false,
  updatedAt: TS,
};

export const seoPages = defineResource({
  key: 'seo_page',
  path: 'seo-pages',
  operation: 'cmsSeoPages',
  area: 'cms',
  label: 'SEO page',
  labelPlural: 'SEO pages',
  implements: CMS,
  note: 'SEO meta per route or slug (legacy `sitemaps`).',
  read: 'seo.manage',
  manage: 'seo.manage',
  delegate: (tx) => tx.seoPage,
  include: { ogImageFile: { select: { publicId: true } } },
  dto: SeoPageDto,
  createDto: CreateSeoPageDto,
  updateDto: UpdateSeoPageDto,
  queryDto: SeoPageListQuery,
  example: SEO_PAGE_EXAMPLE,
  createExample: {
    pageKey: '/th/products/mailer-box',
    titleTh: 'กล่องไปรษณีย์พิมพ์ลาย สั่งผลิตออนไลน์ | Packio',
  },
  updateExample: { noindex: false },
  toDto: seoPageDto,
  createData: async (input: CreateSeoPageDto, refs) => ({
    ...input,
    ogImageFileId: await refs.optionalFile(input.ogImageFileId, 'ogImageFileId'),
  }),
  updateData: async (input: UpdateSeoPageDto, refs) =>
    compact({ ...input, ogImageFileId: await refs.optionalFile(input.ogImageFileId, 'ogImageFileId') }),
  search: ['pageKey', 'titleTh', 'titleEn'],
  sort: { pageKey: 'pageKey', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

// ------------------------------------------------------------------------------------------------

type VideoRow = Prisma.VideoGetPayload<object>;

interface PublicIdTable {
  findMany(args: {
    where: { id?: { in: bigint[] }; publicId?: string };
    select: { id: true; publicId: true };
  }): Promise<{ id: bigint; publicId: string }[]>;
}

const subjectTable = (db: Tx, type: VideoSubject): PublicIdTable =>
  ({
    catalog_product: db.catalogProduct,
    showcase_product: db.showcaseProduct,
    stock_product: db.stockProduct,
    article: db.article,
  })[type];

async function subjectId(db: Tx, type: VideoSubject, publicId: string): Promise<bigint> {
  const [row] = await subjectTable(db, type).findMany({
    where: { publicId },
    select: { id: true, publicId: true },
  });
  if (!row) {
    throw new DomainException('validation.failed', {
      errors: [{ path: 'subjectId', code: 'exists', message: `no ${type} with this id` }],
    });
  }
  return row.id;
}

export const videos = defineResource({
  key: 'video',
  path: 'videos',
  operation: 'cmsVideos',
  area: 'cms',
  label: 'video',
  labelPlural: 'videos',
  implements: CMS,
  note: 'Videos attached to a catalogue product, showcase product, stock product or article.',
  read: 'cms.manage',
  manage: 'cms.manage',
  delegate: (tx) => tx.video,
  baseWhere: NOT_DELETED,
  softDelete: true,
  dto: VideoDto,
  createDto: CreateVideoDto,
  updateDto: UpdateVideoDto,
  queryDto: VideoListQuery,
  example: {
    id: CMS_IDS.video,
    provider: 'youtube',
    url: 'https://www.youtube.com/watch?v=example',
    title: 'วิธีประกอบกล่องฝาเสียบ',
    subjectType: 'catalog_product',
    subjectId: CMS_IDS.catalogProduct,
    sort: 10,
    updatedAt: TS,
  },
  createExample: {
    provider: 'youtube',
    url: 'https://www.youtube.com/watch?v=example',
    subjectType: 'catalog_product',
    subjectId: CMS_IDS.catalogProduct,
  },
  updateExample: { title: 'วิธีประกอบกล่อง' },
  context: async (rows: VideoRow[], db) => {
    const ids = new Map<string, string>();
    for (const type of new Set(rows.map((r) => r.subjectType))) {
      const found = await subjectTable(db, type).findMany({
        where: { id: { in: rows.filter((r) => r.subjectType === type).map((r) => r.subjectId) } },
        select: { id: true, publicId: true },
      });
      for (const f of found) ids.set(`${type}:${f.id}`, f.publicId);
    }
    return ids;
  },
  toDto: (row: VideoRow, subjects: Map<string, string>): VideoDto => ({
    id: row.publicId,
    provider: row.provider,
    url: row.url,
    title: row.title,
    subjectType: row.subjectType,
    subjectId: subjects.get(`${row.subjectType}:${row.subjectId}`) ?? '',
    sort: row.sort,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: async (input: CreateVideoDto, refs) => ({
    ...input,
    subjectId: await subjectId(refs.db, input.subjectType, input.subjectId),
  }),
  updateData: (input: UpdateVideoDto) => compact({ ...input }),
  where: async (q: VideoListQuery, db) => {
    if (!q.subjectId || !q.subjectType) return compact({ subjectType: q.subjectType });
    // The subject id is resolved within its type; an unknown subject simply matches nothing.
    const [row] = await subjectTable(db, q.subjectType).findMany({
      where: { publicId: q.subjectId },
      select: { id: true, publicId: true },
    });
    return { subjectType: q.subjectType, subjectId: row?.id ?? -1n };
  },
  search: ['title', 'url'],
  sort: { sort: 'sort', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});
