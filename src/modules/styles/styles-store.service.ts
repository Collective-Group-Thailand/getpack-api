import { DomainException } from '@common/errors/domain.exception';
import { decodeCursor, encodeCursor } from '@common/pagination/pagination';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { sizeRulesOf } from '@modules/catalog/store/size-rules';
import { imageUrl } from '@modules/catalog/store/store-catalog.service';
import { type SpecLineDto } from '@modules/quotes/line-summary.dto';
import { specLabel } from '@modules/quotes/spec-label';
import { Injectable } from '@nestjs/common';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import { optionValues as priceOptions, PRICE_REASONS } from './publishability';
import { StyleAssetsService } from './style-assets.service';
import { fitOf, hasFitRange, parseProductSize } from './style-fit';
import { StyleMakeabilityService } from './style-makeability.service';
import { MULTI_SELECT_AXES } from './style-master';
import {
  type StyleCardDto,
  type StyleDetailDto,
  type StyleFacetsDto,
  type StyleFavouriteDto,
  type StyleListDto,
  type StyleListQuery,
  type StylePhotoDto,
  type StyleSizeRangeDto,
  type StyleVariantCardDto,
  type StyleVariantListDto,
  type StyleVariantListQuery,
} from './styles-store.dto';
import { matchesUseCaseGroups, useCaseGroupsOf } from './use-case-groups';

/** Option axes shown as the closure facet; every other axis is a feature (`none` values are never facets). */
const CLOSURE_AXES: ReadonlySet<string> = new Set([
  'tuck_top',
  'tuck_bottom',
  'lock',
  'closure_rigid',
  'mailer_front',
  'lid_depth',
]);
const POPULAR_WINDOW_DAYS = 90;

const LIBRARY_INCLUDE = {
  productType: { select: { code: true, calculatorKey: true, quoteMode: true, status: true } },
  variants: {
    where: { publishable: true, status: 'active' },
    select: { code: true, options: true, pricePath: true, priceReasons: true },
    orderBy: { code: 'asc' },
  },
  useCases: { select: { code: true }, orderBy: { code: 'asc' } },
  pattern: {
    select: {
      constraints: true,
      catalogProducts: {
        select: {
          catalogProduct: {
            select: {
              slug: true,
              status: true,
              priceHint: {
                select: {
                  unitPrice: true,
                  quantity: true,
                  computedAt: true,
                  leadTimeDays: true,
                  specSummary: true,
                },
              },
            },
          },
        },
      },
    },
  },
  recipes: {
    where: { approvedAt: { not: null } },
    orderBy: { version: 'desc' },
    take: 1,
    select: { sizeRanges: true },
  },
  photoFile: { select: { publicId: true, scanStatus: true, uploadStatus: true, purgedAt: true } },
  assets: {
    where: { OR: [{ variantId: null }, { variant: { publishable: true, status: 'active' } }] },
    select: {
      kind: true,
      sha256: true,
      storageKey: true,
      contentType: true,
      variant: { select: { code: true } },
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.StyleBaseInclude;
type LibraryRow = Prisma.StyleBaseGetPayload<{ include: typeof LIBRARY_INCLUDE }>;

/** Published = active, not hidden, with ≥ 1 publishable variant (D-243, D-245). */
const PUBLISHED: Prisma.StyleBaseWhereInput = {
  status: 'active',
  hidden: false,
  variants: { some: { publishable: true, status: 'active' } },
};

/**
 * The store style library (U3.B2, D-245, D-246): published styles only, faceted, searched (Thai / English with
 * synonyms; `simple` full text + trigram for typos), sorted, cursor-paged; detail with the publishable combinations,
 * size ranges, starting price (D-220) and lead time — never anything about who makes it (D-435); favourites and compare.
 * The library holds ~100 bases, so filtering and facets run in memory over one query.
 */
@Injectable()
export class StylesStoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly makeability: StyleMakeabilityService,
    private readonly assets: StyleAssetsService,
    private readonly settings: SettingsService,
  ) {}

  async list(query: StyleListQuery, userId: bigint | null): Promise<StyleListDto> {
    const rows = await this.prisma.styleBase.findMany({ where: PUBLISHED, include: LIBRARY_INCLUDE });
    const q = query.q?.trim().toLowerCase() ?? '';
    const scores = q
      ? await this.search(
          q,
          rows.map((r) => r.id),
        )
      : null;
    let matched = scores ? rows.filter((r) => scores.has(r.id)) : rows;
    // D-274: one search log per search (its first page), the zero-result ones feed the "next styles" report.
    if (q && !query.cursor) await this.logSearch(q, matched.length, userId);
    const facetsOf = (list: LibraryRow[]): StyleFacetsDto => facets(list);
    // C0 size search (DECISIONS-STAGE-A §4): the fit of each style for the product, when a size is asked.
    const product = query.size ? parseProductSize(query.size) : null;
    if (query.size && !product) {
      throw new DomainException('validation.failed', {
        errors: [
          { path: 'size', code: 'matches', message: 'size is length x width x height in mm, each above 0' },
        ],
      });
    }
    const useCaseGroups = useCaseGroupsOf(query.useCase);
    const fits = new Map<bigint, ReturnType<typeof fitOf>>();
    if (product) for (const r of matched) fits.set(r.id, fitOf(r, product));
    matched = matched.filter((r) => {
      const opts = optionValues(r);
      return (
        (!query.category || r.category === query.category) &&
        (!query.family || r.family === query.family) &&
        (!query.closure || opts.closure.has(query.closure)) &&
        (!query.feature || opts.feature.has(query.feature)) &&
        matchesUseCaseGroups(
          r.useCases.map((u) => u.code),
          useCaseGroups,
        ) &&
        (!query.materialClass || r.materialClass === query.materialClass) &&
        (!query.pricePath || pricePath(r) === query.pricePath) &&
        (!product || fits.get(r.id) !== null)
      );
    });
    const sort = query.sort ?? (q ? 'relevance' : 'popular');
    const popularity = sort === 'popular' ? await this.popularity(matched) : new Map<bigint, number>();
    const byName = (a: LibraryRow, b: LibraryRow) =>
      a.nameTh.localeCompare(b.nameTh, 'th') || a.code.localeCompare(b.code);
    const featuredFirst = (a: LibraryRow, b: LibraryRow) =>
      Number(b.featured) - Number(a.featured) || a.sort - b.sort;
    const comparators: Record<string, (a: LibraryRow, b: LibraryRow) => number> = {
      relevance: (a, b) =>
        (scores?.get(b.id) ?? 0) - (scores?.get(a.id) ?? 0) || featuredFirst(a, b) || byName(a, b),
      popular: (a, b) =>
        (popularity.get(b.id) ?? 0) - (popularity.get(a.id) ?? 0) || featuredFirst(a, b) || byName(a, b),
      new: (a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0) || byName(a, b),
      instant_first: (a, b) =>
        Number(pricePath(a) === 'rfq') - Number(pricePath(b) === 'rfq') ||
        featuredFirst(a, b) ||
        byName(a, b),
      name: byName,
    };
    matched.sort(comparators[sort]);

    const offset = query.cursor ? cursorOffset(query.cursor, sort) : 0;
    const page = matched.slice(offset, offset + query.limit);
    const favourites = await this.favouriteIds(
      userId,
      page.map((r) => r.id),
    );
    return {
      data: await Promise.all(
        page.map(async (r) => ({ ...(await this.card(r, favourites)), fit: fits.get(r.id) ?? null })),
      ),
      facets: facetsOf(matched),
      meta: {
        nextCursor:
          offset + query.limit < matched.length ? encodeCursor({ o: offset + query.limit, s: sort }) : null,
        sizeSearchStyles: rows.filter(hasFitRange).length,
      },
    };
  }

  /**
   * D-410: every shown variant as a card — the grid behind "every variant", filtered by the style's facets and by
   * options (`axis:value`; one axis's values are alternatives, different axes all apply), paged by offset. Option
   * facets are disjunctive: an axis's counts leave its own filter out, so a chosen value never hides its siblings.
   */
  async listVariants(query: StyleVariantListQuery, userId: bigint | null): Promise<StyleVariantListDto> {
    const rows = await this.prisma.styleBase.findMany({ where: PUBLISHED, include: LIBRARY_INCLUDE });
    const all = rows.flatMap((r) => r.variants.map((v) => ({ base: r, variant: v })));
    const q = query.q?.trim().toLowerCase() ?? '';
    const scores = q
      ? await this.search(
          q,
          rows.map((r) => r.id),
        )
      : null;
    const code = q.toUpperCase();
    const byBase = all.filter(
      ({ base, variant }) =>
        (!scores || scores.has(base.id) || variant.code.includes(code)) &&
        (!query.style || base.code === query.style) &&
        (!query.category || base.category === query.category) &&
        (!query.family || base.family === query.family) &&
        (!query.useCase || base.useCases.some((u) => u.code === query.useCase)) &&
        (!query.materialClass || base.materialClass === query.materialClass) &&
        (!query.pricePath || variant.pricePath === query.pricePath),
    );
    const wanted = new Map<string, Set<string>>();
    for (const option of query.option ?? []) {
      const [axis, value] = option.split(':') as [string, string];
      wanted.set(axis, (wanted.get(axis) ?? new Set()).add(value));
    }
    const valuesOf = (options: unknown, axis: string): string[] => {
      const value = (options as Record<string, string | string[]>)[axis];
      const list = Array.isArray(value) ? value : value ? [value] : [];
      return list.length > 0 ? list : ['none'];
    };
    const passes = (options: unknown, except?: string) =>
      [...wanted].every(
        ([axis, values]) => axis === except || valuesOf(options, axis).some((v) => values.has(v)),
      );
    const matched = byBase.filter(({ variant }) => passes(variant.options));
    if (q && !query.cursor) await this.logSearch(q, matched.length, userId);

    // Option facets: each axis counted under every filter but its own; a variant without the axis counts as `none`,
    // as the filter reads it.
    const optionCounts = new Map<string, number>();
    const axes = new Set([
      ...byBase.flatMap(({ variant }) => Object.keys(variant.options as object)),
      ...wanted.keys(),
    ]);
    for (const { variant } of byBase) {
      const options = variant.options as Record<string, string | string[]>;
      for (const axis of axes) {
        if (!passes(options, axis)) continue;
        for (const v of new Set(valuesOf(options, axis)))
          optionCounts.set(`${axis}:${v}`, (optionCounts.get(`${axis}:${v}`) ?? 0) + 1);
      }
    }
    const counted = (values: string[]) => {
      const counts = new Map<string, number>();
      for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
      return [...counts]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([value, count]) => ({ value, count }));
    };

    const sort = query.sort ?? 'popular';
    const popularity = sort === 'popular' ? await this.popularity(rows) : new Map<bigint, number>();
    type Entry = (typeof all)[number];
    const byName = (a: Entry, b: Entry) =>
      a.base.nameTh.localeCompare(b.base.nameTh, 'th') || a.variant.code.localeCompare(b.variant.code);
    const featuredFirst = (a: Entry, b: Entry) =>
      Number(b.base.featured) - Number(a.base.featured) || a.base.sort - b.base.sort;
    const comparators: Record<string, (a: Entry, b: Entry) => number> = {
      popular: (a, b) =>
        (scores ? (scores.get(b.base.id) ?? 0) - (scores.get(a.base.id) ?? 0) : 0) ||
        (popularity.get(b.base.id) ?? 0) - (popularity.get(a.base.id) ?? 0) ||
        featuredFirst(a, b) ||
        byName(a, b),
      instant_first: (a, b) =>
        Number(a.variant.pricePath === 'rfq') - Number(b.variant.pricePath === 'rfq') ||
        featuredFirst(a, b) ||
        byName(a, b),
      name: byName,
    };
    matched.sort(comparators[sort]);

    const offset = query.cursor ? cursorOffset(query.cursor, sort) : 0;
    const page = matched.slice(offset, offset + query.limit);
    const data: StyleVariantCardDto[] = await Promise.all(
      page.map(async ({ base, variant }) => {
        const thumb =
          thumbnailOf(base, variant.code, 'thumbnail_3d') ??
          thumbnailOf(base, variant.code, 'thumbnail_2d') ??
          thumbnailOf(base, null, 'thumbnail_3d') ??
          thumbnailOf(base, null, 'thumbnail_2d');
        const photo = photoOf(base);
        return {
          code: variant.code,
          baseCode: base.code,
          nameTh: base.nameTh,
          nameEn: base.nameEn,
          category: base.category,
          family: base.family,
          materialClass: base.materialClass,
          options: variant.options as Record<string, unknown>,
          pricePath: variant.pricePath,
          thumbnailUrl: photo?.url ?? (thumb ? await this.assets.url(thumb) : null),
          photo,
        };
      }),
    );
    return {
      data,
      facets: {
        option: [...optionCounts]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([value, count]) => ({ value, count })),
        category: counted(matched.map((e) => e.base.category)),
        materialClass: counted(matched.map((e) => e.base.materialClass)),
      },
      meta: {
        nextCursor:
          offset + query.limit < matched.length ? encodeCursor({ o: offset + query.limit, s: sort }) : null,
        total: matched.length,
        libraryTotal: all.length,
        libraryStyles: rows.length,
      },
    };
  }

  async get(code: string, userId: bigint | null): Promise<StyleDetailDto> {
    const row = await this.prisma.styleBase.findFirst({
      where: { ...PUBLISHED, code },
      include: LIBRARY_INCLUDE,
    });
    if (!row) throw new DomainException('styles.variant_not_found');
    return this.detail(row, await this.favouriteIds(userId, [row.id]));
  }

  async compare(codes: string[], userId: bigint | null): Promise<StyleDetailDto[]> {
    const unique = [...new Set(codes)];
    const rows = await this.prisma.styleBase.findMany({
      where: { ...PUBLISHED, code: { in: unique } },
      include: LIBRARY_INCLUDE,
    });
    if (rows.length !== unique.length) throw new DomainException('styles.variant_not_found');
    const favourites = await this.favouriteIds(
      userId,
      rows.map((r) => r.id),
    );
    const out: StyleDetailDto[] = [];
    for (const code of unique)
      out.push(
        await this.detail(
          rows.find((r) => r.code === code)!,
          favourites,
        ),
      );
    return out;
  }

  async favourites(userId: bigint): Promise<StyleFavouriteDto[]> {
    const rows = await this.prisma.styleFavourite.findMany({
      where: { userId, base: PUBLISHED },
      include: { base: { include: LIBRARY_INCLUDE } },
      orderBy: { createdAt: 'desc' },
    });
    const ids = new Set(rows.map((r) => r.baseId));
    return Promise.all(
      rows.map(async (r) => ({ style: await this.card(r.base, ids), addedAt: toBangkokIso(r.createdAt) })),
    );
  }

  async addFavourite(userId: bigint, code: string): Promise<void> {
    const base = await this.prisma.styleBase.findFirst({
      where: { ...PUBLISHED, code },
      select: { id: true },
    });
    if (!base) throw new DomainException('styles.variant_not_found');
    await this.prisma.styleFavourite.upsert({
      where: { userId_baseId: { userId, baseId: base.id } },
      create: { userId, baseId: base.id },
      update: {},
    });
  }

  async removeFavourite(userId: bigint, code: string): Promise<void> {
    await this.prisma.styleFavourite.deleteMany({ where: { userId, base: { code } } });
  }

  /** D-266 / D-268: each publishable variant with its price path and the configuration patches of its options. */
  private async variantViews(row: LibraryRow) {
    const key = row.productType?.calculatorKey ?? null;
    const rules = key
      ? await this.prisma.styleOptionPriceRule.findMany({
          where: { calculatorKey: key, status: 'active', effect: 'configuration' },
          select: { axis: true, value: true, patch: true },
        })
      : [];
    const patches = new Map(rules.map((r) => [`${r.axis}:${r.value}`, r.patch as Record<string, unknown>]));
    return row.variants.map((v) => {
      const options = v.options as Record<string, unknown>;
      return {
        code: v.code,
        options,
        pricePath: v.pricePath,
        // D-435: whether any factory can make a variant is coverage — the customer sees only the price path.
        priceReasons: (v.priceReasons as (typeof PRICE_REASONS)[number][]).filter(
          (r) => r !== 'not_makeable',
        ),
        configurationPatches: priceOptions(options).flatMap((option) =>
          patches.has(option) ? [{ option, patch: patches.get(option)! }] : [],
        ),
      };
    });
  }

  private async detail(row: LibraryRow, favourites: Set<bigint>): Promise<StyleDetailDto> {
    const factories = await this.makeability.factoriesFor(this.prisma, row.id);
    const hints = productHints(row);
    const bands = factories.flatMap((f) => (f.leadTime ? [f.leadTime] : []));
    const hintDays = hints.flatMap((h) => (h.leadTimeDays !== null ? [h.leadTimeDays] : []));
    const leadTime =
      bands.length > 0
        ? {
            minDays: Math.min(...bands.map((b) => b.minDays)),
            maxDays: Math.max(...bands.map((b) => b.maxDays)),
          }
        : hintDays.length > 0
          ? { minDays: Math.min(...hintDays), maxDays: Math.max(...hintDays) }
          : null;
    return {
      ...(await this.card(row, favourites)),
      construction: row.construction,
      productTypeCode: row.productType?.code ?? null,
      descriptionTh: row.descriptionTh,
      descriptionEn: row.descriptionEn,
      axes: axesOf(row),
      variants: await this.variantViews(row),
      sizeRanges: sizeRanges(row),
      leadTime,
      useCases: row.useCases.map((u) => u.code),
      recyclable: row.recyclable,
      plasticFree: row.plasticFree,
      certifications: row.certifications,
      assets: await Promise.all(
        row.assets.map(async (a) => ({
          kind: a.kind,
          variantCode: a.variant?.code ?? null,
          sha256: Buffer.from(a.sha256).toString('hex'),
          contentType: a.contentType,
          url: await this.assets.url(a),
        })),
      ),
    };
  }

  /**
   * A style's card with its picture: its photo (D-426, a public image URL) first, else a rendered
   * thumbnail (signed URL) — its own, else its first variant's that has one.
   */
  private async card(r: LibraryRow, favourites: Set<bigint>): Promise<StyleCardDto> {
    const photo = photoOf(r);
    const thumb =
      thumbnailOf(r, null, 'thumbnail_3d') ??
      thumbnailOf(r, null, 'thumbnail_2d') ??
      r.assets.find((a) => a.kind === 'thumbnail_3d') ??
      r.assets.find((a) => a.kind === 'thumbnail_2d') ??
      null;
    // The style's own flat dieline (not a variant's): the card's hover view, only when it was rendered (C0).
    const dieline = r.assets.find((a) => a.kind === 'dieline_svg' && a.variant === null) ?? null;
    return {
      ...card(r, favourites),
      thumbnailUrl: photo?.url ?? (thumb ? await this.assets.url(thumb) : null),
      photo,
      dielineUrl: dieline ? await this.assets.url(dieline) : null,
      quoteResponseBusinessDays: await this.quoteResponseDays(r.productTypeId),
    };
  }

  /** Product type id → working days, kept a minute (settings are effective-dated; a minute late is harmless). */
  private readonly responseDays = new Map<string, { days: number | null; until: number }>();

  /**
   * C0b (DECISIONS-STAGE-A §9.3): the quotation first-response time in working days — `rfq.sla_business_hours` at the
   * style's product type (platform fallback, D-100) over 24 h, rounded up: the RFQ due time counts every hour of a
   * working day (`WorkingDayCalendar.addWorkingMinutes`). Null without a product type or a setting value.
   */
  private async quoteResponseDays(productTypeId: bigint | null): Promise<number | null> {
    if (productTypeId === null) return null;
    const key = productTypeId.toString();
    const now = Date.now();
    const cached = this.responseDays.get(key);
    if (cached && cached.until > now) return cached.days;
    let days: number | null = null;
    try {
      const hours = Number(
        (
          await this.settings.at('rfq.sla_business_hours', {
            scope: { type: 'product_type', id: productTypeId },
          })
        ).value,
      );
      days = Number.isFinite(hours) && hours > 0 ? Math.ceil(hours / 24) : null;
    } catch (error) {
      if (!(error instanceof SettingNotFoundError)) throw error;
    }
    this.responseDays.set(key, { days, until: now + 60_000 });
    return days;
  }

  /** Never fails the search (analytics, D-274). */
  private async logSearch(keyword: string, resultsCount: number, userId: bigint | null): Promise<void> {
    try {
      await this.prisma.searchLog.create({
        data: {
          keyword: keyword.slice(0, 200),
          resultsCount,
          channel: 'web',
          surface: 'styles',
          actorUserId: userId,
        },
      });
    } catch {
      // Analytics must never fail a search.
    }
  }

  /** Bases matching the query with their score: `simple` full text, trigram word similarity, or a substring. */
  private async search(q: string, ids: bigint[]): Promise<Map<bigint, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<{ id: bigint; score: number }[]>`
      SELECT id, greatest(
               ts_rank(to_tsvector('simple', search_document), plainto_tsquery('simple', ${q})),
               word_similarity(${q}, search_document),
               CASE WHEN position(${q} IN search_document) > 0 THEN 1 ELSE 0 END)::float8 AS score
      FROM style_bases
      WHERE id = ANY(${ids})
        AND (to_tsvector('simple', search_document) @@ plainto_tsquery('simple', ${q})
             OR word_similarity(${q}, search_document) >= 0.3
             OR position(${q} IN search_document) > 0)`;
    return new Map(rows.map((r) => [r.id, Number(r.score)]));
  }

  /** Favourites + saved quotations of the linked style's catalogue products in the last 90 days (gap assumption 4). */
  private async popularity(rows: LibraryRow[]): Promise<Map<bigint, number>> {
    if (rows.length === 0) return new Map();
    const scores = await this.prisma.$queryRaw<{ id: bigint; score: bigint }[]>`
      SELECT b.id,
             (SELECT count(*) FROM style_favourites f WHERE f.base_id = b.id)
           + (SELECT count(*) FROM quotes q JOIN catalog_product_patterns cpp ON cpp.catalog_product_id = q.catalog_product_id
              WHERE b.pattern_id IS NOT NULL AND cpp.pattern_id = b.pattern_id
                AND q.created_at > now() - make_interval(days => ${POPULAR_WINDOW_DAYS})) AS score
      FROM style_bases b WHERE b.id = ANY(${rows.map((r) => r.id)})`;
    return new Map(scores.map((s) => [s.id, Number(s.score)]));
  }

  private async favouriteIds(userId: bigint | null, baseIds: bigint[]): Promise<Set<bigint>> {
    if (userId === null) return NOT_SIGNED_IN;
    if (baseIds.length === 0) return new Set();
    const rows = await this.prisma.styleFavourite.findMany({
      where: { userId, baseId: { in: baseIds } },
      select: { baseId: true },
    });
    return new Set(rows.map((r) => r.baseId));
  }
}

/** Marks "not signed in" so cards answer `favourite: null`. */
const NOT_SIGNED_IN: Set<bigint> = new Set();

/** D-407: a style prices instantly when one of its variants does (a factory makes it and the calculator covers it). */
function pricePath(r: LibraryRow): 'instant' | 'rfq' {
  return r.variants.some((v) => v.pricePath === 'instant') ? 'instant' : 'rfq';
}

function productHints(r: LibraryRow) {
  return (r.pattern?.catalogProducts ?? [])
    .map((p) => p.catalogProduct)
    .filter((p) => p.status === 'active' && p.priceHint)
    .map((p) => ({ slug: p.slug, ...p.priceHint! }))
    .sort((a, b) => a.unitPrice.comparedTo(b.unitPrice) || a.slug.localeCompare(b.slug));
}

function card(
  r: LibraryRow,
  favourites: Set<bigint>,
): Omit<StyleCardDto, 'thumbnailUrl' | 'photo' | 'dielineUrl' | 'quoteResponseBusinessDays'> {
  const hint = productHints(r)[0];
  return {
    code: r.code,
    nameTh: r.nameTh,
    nameEn: r.nameEn,
    category: r.category,
    family: r.family,
    materialClass: r.materialClass,
    pricePath: pricePath(r),
    variantCount: r.variants.length,
    featured: r.featured,
    startingPrice: hint
      ? {
          unitPrice: hint.unitPrice.toFixed(2),
          currency: 'THB',
          quantity: hint.quantity,
          catalogProductSlug: hint.slug,
          computedAt: toBangkokIso(hint.computedAt),
          // D-441: the spec this price is for, in the words of the configurator and the product page.
          label: specLabel(
            (Array.isArray(hint.specSummary) ? hint.specSummary : []) as unknown as SpecLineDto[],
            r.productType?.calculatorKey ?? null,
          ),
        }
      : null,
    referenceCode: r.referenceVerifiedAt ? r.referenceCode : null,
    favourite: favourites === NOT_SIGNED_IN ? null : favourites.has(r.id),
    fitRange: hasFitRange(r)
      ? {
          minLMm: r.fitMinLMm!,
          maxLMm: r.fitMaxLMm!,
          minWMm: r.fitMinWMm!,
          maxWMm: r.fitMaxWMm!,
          minHMm: r.fitMinHMm!,
          maxHMm: r.fitMaxHMm!,
        }
      : null,
    moqUnits: r.moqUnits,
    fit: null,
    options: (() => {
      const { closure, feature } = optionValues(r);
      return [...[...closure].sort(), ...[...feature].sort()];
    })(),
  };
}

/** A stored thumbnail of a variant (or, with `null`, of the style itself). */
/**
 * The style's photo (D-426) once its file is uploaded and clean: served by the public catalogue images route.
 * Where it came from (`photo_meta.source`, `prompt`) stays in the admin — the storefront says nothing about it.
 */
function photoOf(r: LibraryRow): StylePhotoDto | null {
  const file = r.photoFile;
  if (!file || file.uploadStatus !== 'uploaded' || file.scanStatus !== 'clean' || file.purgedAt) return null;
  const meta = (r.photoMeta ?? {}) as { alt?: { th?: unknown; en?: unknown } };
  const altTh = typeof meta.alt?.th === 'string' ? meta.alt.th : r.nameTh;
  return {
    url: imageUrl(file.publicId)!,
    alt: { th: altTh, en: typeof meta.alt?.en === 'string' ? meta.alt.en : r.nameEn },
  };
}

function thumbnailOf(r: LibraryRow, variantCode: string | null, kind: 'thumbnail_2d' | 'thumbnail_3d') {
  return r.assets.find((a) => a.kind === kind && (a.variant?.code ?? null) === variantCode) ?? null;
}

/** The closure / feature option values of a base's publishable variants (`axis:value`, never `none`). */
function optionValues(r: LibraryRow): { closure: Set<string>; feature: Set<string> } {
  const closure = new Set<string>();
  const feature = new Set<string>();
  for (const v of r.variants) {
    for (const [axis, value] of Object.entries(v.options as Record<string, string | string[]>)) {
      for (const one of Array.isArray(value) ? value : [value]) {
        if (one === 'none') continue;
        (CLOSURE_AXES.has(axis) ? closure : feature).add(`${axis}:${one}`);
      }
    }
  }
  return { closure, feature };
}

function facets(rows: LibraryRow[]): StyleFacetsDto {
  const count = (values: (r: LibraryRow) => Iterable<string>) => {
    const counts = new Map<string, number>();
    for (const r of rows) for (const v of new Set(values(r))) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value, n]) => ({ value, count: n }));
  };
  return {
    category: count((r) => [r.category]),
    family: count((r) => [r.family]),
    closure: count((r) => optionValues(r).closure),
    feature: count((r) => optionValues(r).feature),
    useCase: count((r) => r.useCases.map((u) => u.code)),
    materialClass: count((r) => [r.materialClass]),
    pricePath: count((r) => [pricePath(r)]),
  };
}

function axesOf(r: LibraryRow) {
  return r.variantAxes.map((axis) => {
    const values = new Set<string>();
    for (const v of r.variants) {
      const value = (v.options as Record<string, string | string[]>)[axis];
      for (const one of Array.isArray(value) ? value : [value ?? '']) if (one) values.add(one);
    }
    return { axis, values: [...values].sort(), multiSelect: MULTI_SELECT_AXES.has(axis) };
  });
}

/** Size ranges per material class from the approved recipe's solver, else the linked pattern's size rules. */
function sizeRanges(r: LibraryRow): StyleSizeRangeDto[] {
  const recipe = r.recipes[0]?.sizeRanges as Record<string, Record<string, unknown>> | null | undefined;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  if (recipe && Object.keys(recipe).length > 0) {
    return Object.entries(recipe)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([materialClass, s]) => ({
        materialClass,
        source: 'recipe' as const,
        minWMm: n(s['minW']),
        maxWMm: n(s['maxW']),
        minLMm: n(s['minL']),
        maxLMm: n(s['maxL']),
        minHMm: n(s['minH']),
        maxHMm: n(s['maxH']),
      }));
  }
  if (!r.pattern) return [];
  const rules = sizeRulesOf(r.pattern.constraints);
  return [
    {
      materialClass: r.materialClass,
      source: 'pattern_rules',
      minWMm: rules.minWMm,
      maxWMm: rules.maxWMm,
      minLMm: rules.minLMm,
      maxLMm: rules.maxLMm,
      minHMm: rules.minHMm,
      maxHMm: rules.maxHMm,
    },
  ];
}

function cursorOffset(cursor: string, sort: string): number {
  const position = decodeCursor(cursor);
  const offset = position['o'];
  if (typeof offset !== 'number' || offset < 0 || position['s'] !== sort) {
    throw new DomainException('validation.failed', {
      errors: [{ path: 'cursor', code: 'cursor', message: 'cursor does not belong to this sort' }],
    });
  }
  return offset;
}
