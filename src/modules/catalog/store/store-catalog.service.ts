import { DomainException } from '@common/errors/domain.exception';
import { toSkipTake } from '@common/pagination/pagination';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type CatalogOptionKind, Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';

import { num } from '../crud/dto-fields';
import {
  type StoreArticleCardDto,
  type StoreArticleCategoryDto,
  type StoreArticleDto,
  type StoreArticleListQuery,
  type StoreBannerDto,
  type StoreFaqGroupDto,
  type StoreGeoAreaDto,
  type StoreGeoSubdistrictDto,
  type StoreHomeSectionDto,
  type StoreOptionDto,
  type StoreOptionGroupDto,
  type StorePostcodeAreaDto,
  type StoreProductCardDto,
  type StoreProductDetailDto,
  type StoreProductListQuery,
  type StoreProductTypeDto,
  type StoreSearchHitDto,
  type StoreSemiDesignDto,
  type StoreSeoDto,
  type StoreShowcaseListQuery,
  type StoreShowcaseProductDto,
  type StoreStockProductDto,
  type StoreStockProductListQuery,
} from './store-catalog.dto';

/** Public URL of a catalogue image; the file is served only while visible content references it. */
export const imageUrl = (filePublicId: string | null | undefined): string | null =>
  filePublicId ? `/v1/store/catalog/images/${filePublicId}` : null;

const OPTION_ORDER: CatalogOptionKind[] = [
  'pattern',
  'material',
  'print_type',
  'ink_colour',
  'coating',
  'finish',
  'diecut',
  'assembly',
];
const ACTIVE = 'active' as const;
const SEARCH_LIMIT = 20;

type SeoRow = Prisma.SeoPageGetPayload<{ include: { ogImageFile: { select: { publicId: true } } } }> | null;

const seoDto = (row: SeoRow, locale: 'th' | 'en' = 'th'): StoreSeoDto | null =>
  row
    ? {
        title: (locale === 'en' && row.titleEn) || row.titleTh,
        description: (locale === 'en' && row.descriptionEn) || row.descriptionTh,
        keywords: row.keywords,
        h1: row.h1,
        h2: row.h2,
        canonicalUrl: row.canonicalUrl,
        ogImageUrl: imageUrl(row.ogImageFile?.publicId),
        noindex: row.noindex,
      }
    : null;

const SEO_INCLUDE = { include: { ogImageFile: { select: { publicId: true } } } } as const;

/**
 * Public catalogue and CMS reads (`/v1/store/catalog/*`, B2.1). Only active catalogue rows and
 * published, in-window CMS content are visible; no factory, price or staff data ever appears (D-044,
 * D-050). Instant availability of a configuration is resolved at quote time (D-043), not here.
 */
@Injectable()
export class StoreCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  // --- product types & catalogue products ---------------------------------------------------

  async productTypes(): Promise<StoreProductTypeDto[]> {
    const rows = await this.prisma.productType.findMany({
      where: { status: ACTIVE },
      include: { category: { select: { code: true } } },
      orderBy: [{ sort: 'asc' }, { code: 'asc' }],
    });
    return rows.map((t) => ({
      code: t.code,
      nameTh: t.nameTh,
      nameEn: t.nameEn,
      categoryCode: t.category.code,
      quoteMode: t.quoteMode,
    }));
  }

  private productWhere(productType?: string): Prisma.CatalogProductWhereInput {
    return { status: ACTIVE, productType: { status: ACTIVE, ...(productType ? { code: productType } : {}) } };
  }

  async products(query: StoreProductListQuery): Promise<{ rows: StoreProductCardDto[]; total: number }> {
    const q = query.q?.trim();
    const where: Prisma.CatalogProductWhereInput = {
      ...this.productWhere(query.productType),
      ...(q
        ? {
            OR: [
              { nameTh: { contains: q, mode: 'insensitive' } },
              { nameEn: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.catalogProduct.findMany({
        where,
        include: {
          productType: { select: { code: true } },
          images: {
            include: { fileObject: { select: { publicId: true } } },
            orderBy: { sort: 'asc' },
            take: 1,
          },
        },
        orderBy: [{ sort: 'asc' }, { slug: 'asc' }],
        ...toSkipTake(query),
      }),
      this.prisma.catalogProduct.count({ where }),
    ]);
    return {
      rows: rows.map((p) => ({
        slug: p.slug,
        productTypeCode: p.productType.code,
        nameTh: p.nameTh,
        nameEn: p.nameEn,
        imageUrl: imageUrl(p.images[0]?.fileObject.publicId),
        templateAvailability: p.templateAvailability,
      })),
      total,
    };
  }

  async product(slug: string): Promise<StoreProductDetailDto> {
    const p = await this.prisma.catalogProduct.findFirst({
      where: { slug, ...this.productWhere() },
      include: {
        productType: { select: { code: true } },
        patterns: {
          where: { pattern: { status: ACTIVE } },
          include: { pattern: true },
          orderBy: { sort: 'asc' },
        },
        options: { orderBy: [{ sort: 'asc' }] },
        standardSizes: { where: { status: ACTIVE }, orderBy: [{ sort: 'asc' }, { code: 'asc' }] },
        images: { include: { fileObject: { select: { publicId: true } } }, orderBy: { sort: 'asc' } },
        seoPage: SEO_INCLUDE,
      },
    });
    if (!p) throw new DomainException('http.not_found');
    const videos = await this.prisma.video.findMany({
      where: { subjectType: 'catalog_product', subjectId: p.id, deletedAt: null },
      orderBy: { sort: 'asc' },
    });
    return {
      slug: p.slug,
      productTypeCode: p.productType.code,
      nameTh: p.nameTh,
      nameEn: p.nameEn,
      imageUrl: imageUrl(p.images[0]?.fileObject.publicId),
      templateAvailability: p.templateAvailability,
      descriptionTh: p.descriptionTh,
      descriptionEn: p.descriptionEn,
      isCombination: p.isCombination,
      patterns: p.patterns.map(({ pattern }) => ({
        code: pattern.code,
        name: pattern.name,
        constraints: pattern.constraints as Record<string, unknown>,
        dielineKey: pattern.dielineKey,
      })),
      optionGroups: await this.optionGroups(p.options),
      standardSizes: p.standardSizes.map((s) => ({
        code: s.code,
        name: s.name,
        lengthMm: s.lengthMm.toNumber(),
        widthMm: s.widthMm.toNumber(),
        heightMm: s.heightMm.toNumber(),
      })),
      images: p.images.map((i) => ({
        url: imageUrl(i.fileObject.publicId)!,
        variant: (i.variant as Record<string, unknown> | null) ?? null,
      })),
      videos: videos.map((v) => ({ provider: v.provider, url: v.url, title: v.title })),
      seo: seoDto(p.seoPage),
    };
  }

  /** Active definitions offered by a product, grouped by kind in configurator order. */
  async optionGroups(
    options: { optionKind: CatalogOptionKind; optionId: bigint; isDefault: boolean }[],
  ): Promise<StoreOptionGroupDto[]> {
    const ids = (kind: CatalogOptionKind) =>
      options.filter((o) => o.optionKind === kind).map((o) => o.optionId);
    const byId = new Map<string, Omit<StoreOptionDto, 'isDefault'>>();
    const put = (kind: string, id: bigint, value: Omit<StoreOptionDto, 'isDefault'>) =>
      byId.set(`${kind}:${id}`, value);

    for (const m of await this.prisma.material.findMany({
      where: { id: { in: ids('material') }, status: ACTIVE },
      include: { fluteType: { select: { code: true } } },
    })) {
      put('material', m.id, {
        id: m.publicId,
        code: m.code,
        nameTh: m.nameTh,
        nameEn: m.nameEn,
        attributes: {
          kind: m.kind,
          gsm: num(m.gsm),
          micron: num(m.micron),
          flute: m.fluteType?.code ?? null,
          isFoodGrade: m.isFoodGrade,
          coatable: m.coatable,
        },
      });
    }
    for (const kind of ['finish', 'coating'] as const) {
      for (const f of await this.prisma.finish.findMany({
        where: { id: { in: ids(kind) }, status: ACTIVE },
      })) {
        put(kind, f.id, {
          id: f.publicId,
          code: f.code,
          nameTh: f.nameTh,
          nameEn: f.nameEn,
          attributes: {
            finishKind: f.finishKind,
            requiresAmount: f.requiresAmount,
            requiresWidth: f.requiresWidth,
            requiresLength: f.requiresLength,
          },
        });
      }
    }
    for (const c of await this.prisma.inkColour.findMany({
      where: { id: { in: ids('ink_colour') }, status: ACTIVE },
    })) {
      put('ink_colour', c.id, {
        id: c.publicId,
        code: c.code,
        nameTh: c.name,
        nameEn: c.name,
        attributes: { colourKind: c.colourKind },
      });
    }
    for (const d of await this.prisma.diecutType.findMany({
      where: { id: { in: ids('diecut') }, status: ACTIVE },
    })) {
      put('diecut', d.id, {
        id: d.publicId,
        code: d.code,
        nameTh: d.nameTh,
        nameEn: d.nameEn,
        attributes: {},
      });
    }
    for (const a of await this.prisma.assembly.findMany({
      where: { id: { in: ids('assembly') }, status: ACTIVE },
    })) {
      put('assembly', a.id, {
        id: a.publicId,
        code: a.code,
        nameTh: a.nameTh,
        nameEn: a.nameEn,
        attributes: {
          requiresAmount: a.requiresAmount,
          requiresWidth: a.requiresWidth,
          requiresLength: a.requiresLength,
        },
      });
    }
    for (const t of await this.prisma.printType.findMany({
      where: { id: { in: ids('print_type') }, status: ACTIVE },
    })) {
      put('print_type', t.id, {
        id: t.publicId,
        code: t.code,
        nameTh: t.nameTh,
        nameEn: t.nameEn,
        attributes: {},
      });
    }
    for (const t of await this.prisma.pattern.findMany({
      where: { id: { in: ids('pattern') }, status: ACTIVE },
    })) {
      put('pattern', t.id, {
        id: t.publicId,
        code: t.code,
        nameTh: t.name,
        nameEn: t.technicalName ?? t.name,
        attributes: {},
      });
    }

    return OPTION_ORDER.map((kind) => ({
      kind,
      options: options
        .filter((o) => o.optionKind === kind)
        .flatMap((o) => {
          const found = byId.get(`${kind}:${o.optionId}`);
          return found ? [{ ...found, isDefault: o.isDefault }] : [];
        }),
    })).filter((group) => group.options.length > 0);
  }

  async semiDesigns(productSlug: string): Promise<StoreSemiDesignDto[]> {
    const rows = await this.prisma.semiDesign.findMany({
      where: { status: ACTIVE, catalogProduct: { slug: productSlug, ...this.productWhere() } },
      include: {
        thumbnailFile: { select: { publicId: true } },
        colours: { orderBy: { sort: 'asc' } },
        templates: { where: { status: ACTIVE }, include: { standardSize: { select: { code: true } } } },
      },
      orderBy: { name: 'asc' },
    });
    return rows.map((d) => ({
      id: d.publicId,
      name: d.name,
      thumbnailUrl: imageUrl(d.thumbnailFile?.publicId),
      colours: d.colours.map((c) => c.hex),
      sizeCodes: d.templates.map((t) => t.standardSize.code),
    }));
  }

  // --- stock products -------------------------------------------------------------------------

  private readonly stockInclude = {
    attributes: { include: { value: true }, orderBy: { attribute: 'asc' } },
    images: { include: { fileObject: { select: { publicId: true } } }, orderBy: { sort: 'asc' } },
    levels: { select: { onHand: true, reserved: true } },
  } satisfies Prisma.StockProductInclude;

  private stockDto(
    s: Prisma.StockProductGetPayload<{ include: StoreCatalogService['stockInclude'] }>,
  ): StoreStockProductDto {
    return {
      sku: s.sku,
      nameTh: s.nameTh,
      nameEn: s.nameEn,
      description: s.description,
      unit: s.unit,
      capacityMl: num(s.capacityMl),
      lengthMm: num(s.lengthMm),
      widthMm: num(s.widthMm),
      heightMm: num(s.heightMm),
      minOrderQty: s.minOrderQty,
      isFoodGrade: s.isFoodGrade,
      inStock: s.levels.some((l) => l.onHand > l.reserved),
      attributes: s.attributes
        .filter((a) => a.value.status === ACTIVE)
        .map((a) => ({
          attribute: a.attribute,
          code: a.value.code,
          nameTh: a.value.nameTh,
          nameEn: a.value.nameEn,
        })),
      imageUrls: s.images.map((i) => imageUrl(i.fileObject.publicId)!),
    };
  }

  async stockProducts(
    query: StoreStockProductListQuery,
  ): Promise<{ rows: StoreStockProductDto[]; total: number }> {
    const q = query.q?.trim();
    const filters = (query.attributes ?? '')
      .split(',')
      .filter(Boolean)
      .map((pair) => pair.split(':') as [string, string]);
    const where: Prisma.StockProductWhereInput = {
      status: ACTIVE,
      productType: { status: ACTIVE, ...(query.productType ? { code: query.productType } : {}) },
      AND: filters.map(([attribute, code]) => ({
        attributes: { some: { attribute: attribute as never, value: { code, status: ACTIVE } } },
      })),
      ...(q
        ? {
            OR: [
              { nameTh: { contains: q, mode: 'insensitive' } },
              { nameEn: { contains: q, mode: 'insensitive' } },
              { sku: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.stockProduct.findMany({
        where,
        include: this.stockInclude,
        orderBy: { sku: 'asc' },
        ...toSkipTake(query),
      }),
      this.prisma.stockProduct.count({ where }),
    ]);
    return { rows: rows.map((s) => this.stockDto(s)), total };
  }

  async stockProduct(sku: string): Promise<StoreStockProductDto> {
    const s = await this.prisma.stockProduct.findFirst({
      where: { sku, status: ACTIVE, productType: { status: ACTIVE } },
      include: this.stockInclude,
    });
    if (!s) throw new DomainException('http.not_found');
    return this.stockDto(s);
  }

  // --- showcase -------------------------------------------------------------------------------

  private readonly showcaseInclude = {
    category: { select: { slug: true, status: true } },
    catalogProduct: { select: { slug: true } },
    coverFile: { select: { publicId: true } },
  } satisfies Prisma.ShowcaseProductInclude;

  private showcaseWhere(): Prisma.ShowcaseProductWhereInput {
    return { status: ACTIVE, catalogProduct: this.productWhere() };
  }

  private showcaseDto(
    s: Prisma.ShowcaseProductGetPayload<{ include: StoreCatalogService['showcaseInclude'] }>,
  ): StoreShowcaseProductDto {
    return {
      slug: s.slug,
      categorySlug: s.category?.status === ACTIVE ? s.category.slug : null,
      productSlug: s.catalogProduct.slug,
      nameTh: s.nameTh,
      nameEn: s.nameEn,
      descriptionTh: s.descriptionTh,
      imageUrl: imageUrl(s.coverFile?.publicId),
      preset: s.preset as Record<string, unknown>,
    };
  }

  async showcase(query: StoreShowcaseListQuery): Promise<{ rows: StoreShowcaseProductDto[]; total: number }> {
    const where: Prisma.ShowcaseProductWhereInput = {
      ...this.showcaseWhere(),
      ...(query.category ? { category: { slug: query.category, status: ACTIVE } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.showcaseProduct.findMany({
        where,
        include: this.showcaseInclude,
        orderBy: [{ sort: 'asc' }, { slug: 'asc' }],
        ...toSkipTake(query),
      }),
      this.prisma.showcaseProduct.count({ where }),
    ]);
    return { rows: rows.map((s) => this.showcaseDto(s)), total };
  }

  async showcaseProduct(slug: string): Promise<StoreShowcaseProductDto> {
    const s = await this.prisma.showcaseProduct.findFirst({
      where: { slug, ...this.showcaseWhere() },
      include: this.showcaseInclude,
    });
    if (!s) throw new DomainException('http.not_found');
    return this.showcaseDto(s);
  }

  // --- CMS ------------------------------------------------------------------------------------

  async banners(position?: string, now = new Date()): Promise<StoreBannerDto[]> {
    const rows = await this.prisma.banner.findMany({
      where: {
        status: 'published',
        deletedAt: null,
        ...(position ? { position: position as never } : {}),
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validTo: null }, { validTo: { gt: now } }] },
        ],
      },
      include: { desktopFile: { select: { publicId: true } }, mobileFile: { select: { publicId: true } } },
      orderBy: [{ position: 'asc' }, { sort: 'asc' }],
    });
    return rows.map((b) => ({
      position: b.position,
      title: b.title,
      desktopImageUrl: imageUrl(b.desktopFile.publicId)!,
      mobileImageUrl: imageUrl(b.mobileFile?.publicId),
      targetUrl: b.targetUrl,
      videoUrl: b.videoUrl,
    }));
  }

  async homeSections(): Promise<StoreHomeSectionDto[]> {
    const rows = await this.prisma.homeSection.findMany({
      where: { status: 'published', deletedAt: null },
      orderBy: [{ sort: 'asc' }, { slug: 'asc' }],
    });
    return rows.map((s) => ({
      slug: s.slug,
      titleTh: s.titleTh,
      titleEn: s.titleEn,
      kind: s.kind,
      config: s.config as Record<string, unknown>,
    }));
  }

  private articleWhere(now = new Date()): Prisma.ArticleWhereInput {
    return { status: 'published', deletedAt: null, publishedAt: { lte: now } };
  }

  private readonly articleInclude = {
    coverFile: { select: { publicId: true } },
    categories: {
      where: { category: { status: 'published' } },
      include: { category: { select: { slug: true } } },
    },
  } satisfies Prisma.ArticleInclude;

  private articleCard(
    a: Prisma.ArticleGetPayload<{ include: StoreCatalogService['articleInclude'] }>,
  ): StoreArticleCardDto {
    return {
      slug: a.slug,
      titleTh: a.titleTh,
      titleEn: a.titleEn,
      excerptTh: a.excerptTh,
      coverUrl: imageUrl(a.coverFile?.publicId),
      publishedAt: toBangkokIso(a.publishedAt!),
      categorySlugs: a.categories.map((c) => c.category.slug),
    };
  }

  async articles(query: StoreArticleListQuery): Promise<{ rows: StoreArticleCardDto[]; total: number }> {
    const where: Prisma.ArticleWhereInput = {
      ...this.articleWhere(),
      ...(query.category
        ? { categories: { some: { category: { slug: query.category, status: 'published' } } } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.article.findMany({
        where,
        include: this.articleInclude,
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(query),
      }),
      this.prisma.article.count({ where }),
    ]);
    return { rows: rows.map((a) => this.articleCard(a)), total };
  }

  async article(slug: string): Promise<StoreArticleDto> {
    const a = await this.prisma.article.findFirst({
      where: { slug, ...this.articleWhere() },
      include: { ...this.articleInclude, seoPage: SEO_INCLUDE },
    });
    if (!a) throw new DomainException('http.not_found');
    return {
      ...this.articleCard(a),
      body: a.body as Record<string, unknown>,
      bodySchemaVersion: a.bodySchemaVersion,
      seo: seoDto(a.seoPage),
    };
  }

  async articleCategories(): Promise<StoreArticleCategoryDto[]> {
    const rows = await this.prisma.articleCategory.findMany({
      where: { status: 'published' },
      orderBy: [{ sort: 'asc' }, { slug: 'asc' }],
    });
    return rows.map((c) => ({ slug: c.slug, nameTh: c.nameTh, nameEn: c.nameEn }));
  }

  async faqs(): Promise<StoreFaqGroupDto[]> {
    const rows = await this.prisma.faq.findMany({
      where: {
        status: 'published',
        deletedAt: null,
        OR: [{ categoryId: null }, { category: { status: 'published' } }],
      },
      include: { category: true },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    });
    const groups = new Map<string, StoreFaqGroupDto & { sort: number }>();
    for (const f of rows) {
      const key = f.category?.code ?? '';
      const group = groups.get(key) ?? {
        categoryCode: f.category?.code ?? null,
        categoryNameTh: f.category?.nameTh ?? null,
        categoryNameEn: f.category?.nameEn ?? null,
        sort: f.category?.sort ?? Number.MAX_SAFE_INTEGER,
        faqs: [],
      };
      group.faqs.push({
        questionTh: f.questionTh,
        questionEn: f.questionEn,
        answerTh: f.answerTh,
        answerEn: f.answerEn,
      });
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => a.sort - b.sort).map(({ sort: _sort, ...group }) => group);
  }

  async seo(pageKey: string): Promise<StoreSeoDto> {
    const row = await this.prisma.seoPage.findUnique({ where: { pageKey }, ...SEO_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return seoDto(row)!;
  }

  // --- geography ------------------------------------------------------------------------------

  async provinces(): Promise<StoreGeoAreaDto[]> {
    const rows = await this.prisma.geoProvince.findMany({ orderBy: { code: 'asc' } });
    return rows.map((r) => ({ code: r.code, nameTh: r.nameTh, nameEn: r.nameEn }));
  }

  async districts(provinceCode: string): Promise<StoreGeoAreaDto[]> {
    const province = await this.prisma.geoProvince.findUnique({ where: { code: provinceCode } });
    if (!province) throw new DomainException('http.not_found');
    const rows = await this.prisma.geoDistrict.findMany({
      where: { provinceId: province.id },
      orderBy: { code: 'asc' },
    });
    return rows.map((r) => ({ code: r.code, nameTh: r.nameTh, nameEn: r.nameEn }));
  }

  async subdistricts(districtCode: string): Promise<StoreGeoSubdistrictDto[]> {
    const district = await this.prisma.geoDistrict.findUnique({ where: { code: districtCode } });
    if (!district) throw new DomainException('http.not_found');
    const rows = await this.prisma.geoSubdistrict.findMany({
      where: { districtId: district.id },
      orderBy: { code: 'asc' },
    });
    return rows.map((r) => ({ code: r.code, nameTh: r.nameTh, nameEn: r.nameEn, postcode: r.postcode }));
  }

  /** Every subdistrict with this postcode, with its district and province (address forms). */
  async postcode(postcode: string): Promise<StorePostcodeAreaDto[]> {
    const rows = await this.prisma.geoSubdistrict.findMany({
      where: { postcode },
      include: { district: { include: { province: true } } },
      orderBy: { code: 'asc' },
    });
    return rows.map((s) => ({
      subdistrict: { code: s.code, nameTh: s.nameTh, nameEn: s.nameEn, postcode: s.postcode },
      district: { code: s.district.code, nameTh: s.district.nameTh, nameEn: s.district.nameEn },
      province: {
        code: s.district.province.code,
        nameTh: s.district.province.nameTh,
        nameEn: s.district.province.nameEn,
      },
    }));
  }

  // --- search ---------------------------------------------------------------------------------

  /**
   * Trigram search (`pg_trgm`, GIN indexes of the catalogue migration) across catalogue products,
   * stock products, showcase products and articles: a row matches on trigram similarity or a
   * substring, and is ranked by the best similarity of its names.
   */
  /** One `search_logs` row per search (B6 analytics, schema-design §3.5); never fails the search. */
  async logSearch(keyword: string, resultsCount: number, actorUserId?: bigint): Promise<void> {
    try {
      await this.prisma.searchLog.create({
        data: {
          keyword: keyword.trim().slice(0, 200),
          resultsCount,
          channel: 'web',
          actorUserId: actorUserId ?? null,
        },
      });
    } catch {
      // Analytics must never fail a search.
    }
  }

  async search(query: string): Promise<StoreSearchHitDto[]> {
    const q = query.trim();
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await this.prisma.$queryRaw<
      {
        kind: string;
        key: string;
        title_th: string;
        title_en: string | null;
        image: string | null;
        score: number;
      }[]
    >(Prisma.sql`
      SELECT kind, key, title_th, title_en, image, score FROM (
        SELECT 'catalog_product' AS kind, cp.slug AS key, cp.name_th AS title_th, cp.name_en AS title_en,
               (SELECT fo.public_id::text FROM catalog_product_images i JOIN file_objects fo ON fo.id = i.file_object_id
                 WHERE i.catalog_product_id = cp.id ORDER BY i.sort LIMIT 1) AS image,
               GREATEST(similarity(cp.name_th, ${q}), similarity(cp.name_en, ${q}))::float8 AS score
          FROM catalog_products cp JOIN product_types pt ON pt.id = cp.product_type_id
         WHERE cp.status = 'active' AND pt.status = 'active'
           AND (cp.name_th % ${q} OR cp.name_en % ${q} OR cp.name_th ILIKE ${like} OR cp.name_en ILIKE ${like})
        UNION ALL
        SELECT 'stock_product', sp.sku, sp.name_th, sp.name_en,
               (SELECT fo.public_id::text FROM stock_product_images i JOIN file_objects fo ON fo.id = i.file_object_id
                 WHERE i.stock_product_id = sp.id ORDER BY i.sort LIMIT 1),
               GREATEST(similarity(sp.name_th, ${q}), similarity(sp.name_en, ${q}), similarity(sp.sku, ${q}))::float8
          FROM stock_products sp JOIN product_types pt ON pt.id = sp.product_type_id
         WHERE sp.status = 'active' AND pt.status = 'active'
           AND (sp.name_th % ${q} OR sp.name_en % ${q} OR sp.sku ILIKE ${like} OR sp.name_th ILIKE ${like} OR sp.name_en ILIKE ${like})
        UNION ALL
        SELECT 'showcase_product', sc.slug, sc.name_th, sc.name_en,
               (SELECT fo.public_id::text FROM file_objects fo WHERE fo.id = sc.cover_file_id),
               GREATEST(similarity(sc.name_th, ${q}), similarity(sc.name_en, ${q}))::float8
          FROM showcase_products sc JOIN catalog_products cp ON cp.id = sc.catalog_product_id
         WHERE sc.status = 'active' AND cp.status = 'active'
           AND (sc.name_th % ${q} OR sc.name_en % ${q} OR sc.name_th ILIKE ${like} OR sc.name_en ILIKE ${like})
        UNION ALL
        SELECT 'article', a.slug, a.title_th, a.title_en,
               (SELECT fo.public_id::text FROM file_objects fo WHERE fo.id = a.cover_file_id),
               GREATEST(similarity(a.title_th, ${q}), similarity(coalesce(a.title_en, ''), ${q}))::float8
          FROM articles a
         WHERE a.status = 'published' AND a.deleted_at IS NULL AND a.published_at <= now()
           AND (a.title_th % ${q} OR a.title_en % ${q} OR a.title_th ILIKE ${like} OR a.title_en ILIKE ${like})
      ) hits
      ORDER BY score DESC, key ASC
      LIMIT ${SEARCH_LIMIT}`);
    return rows.map((r) => ({
      kind: r.kind,
      key: r.key,
      titleTh: r.title_th,
      titleEn: r.title_en,
      imageUrl: imageUrl(r.image),
      score: Math.round(r.score * 1000) / 1000,
    }));
  }
}
