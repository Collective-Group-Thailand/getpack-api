import { DomainException } from '@common/errors/domain.exception';
import { decodeCursor, encodeCursor } from '@common/pagination/pagination';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { sizeRulesOf } from '@modules/catalog/store/size-rules';
import { Injectable } from '@nestjs/common';
import { SettingsService } from '@platform/settings/settings.service';

import { optionValues as priceOptions, PRICE_REASONS } from './publishability';
import { StyleMakeabilityService } from './style-makeability.service';
import { MULTI_SELECT_AXES } from './style-master';
import {
  type StyleCardDto,
  type StyleDetailDto,
  type StyleFacetsDto,
  type StyleFavouriteDto,
  type StyleListDto,
  type StyleListQuery,
  type StyleSizeRangeDto,
} from './styles-store.dto';

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
  productType: { select: { calculatorKey: true, quoteMode: true, status: true } },
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
                select: { unitPrice: true, quantity: true, computedAt: true, leadTimeDays: true },
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
  assets: { select: { kind: true, sha256: true, variant: { select: { code: true } } } },
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
 * size ranges, starting price (D-220), lead time and — only under D-201 — the partners count; favourites and compare.
 * The library holds ~100 bases, so filtering and facets run in memory over one query.
 */
@Injectable()
export class StylesStoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly makeability: StyleMakeabilityService,
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
    const facetsOf = (list: LibraryRow[]): StyleFacetsDto => facets(list);
    matched = matched.filter((r) => {
      const opts = optionValues(r);
      return (
        (!query.category || r.category === query.category) &&
        (!query.family || r.family === query.family) &&
        (!query.closure || opts.closure.has(query.closure)) &&
        (!query.feature || opts.feature.has(query.feature)) &&
        (!query.useCase || r.useCases.some((u) => u.code === query.useCase)) &&
        (!query.materialClass || r.materialClass === query.materialClass) &&
        (!query.pricePath || pricePath(r) === query.pricePath)
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
      data: page.map((r) => card(r, favourites)),
      facets: facetsOf(matched),
      meta: {
        nextCursor:
          offset + query.limit < matched.length ? encodeCursor({ o: offset + query.limit, s: sort }) : null,
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
    return rows.map((r) => ({ style: card(r.base, ids), addedAt: toBangkokIso(r.createdAt) }));
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
        priceReasons: v.priceReasons as (typeof PRICE_REASONS)[number][],
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
      ...card(row, favourites),
      construction: row.construction,
      descriptionTh: row.descriptionTh,
      descriptionEn: row.descriptionEn,
      axes: axesOf(row),
      variants: await this.variantViews(row),
      sizeRanges: sizeRanges(row),
      leadTime,
      // D-201 / D-264: shown only with the published network minimum of active factories.
      partnersCount:
        factories.length >= (await this.settings.at('trust.network_min_factories')).value
          ? factories.length
          : null,
      useCases: row.useCases.map((u) => u.code),
      assets: row.assets.map((a) => ({
        kind: a.kind,
        variantCode: a.variant?.code ?? null,
        sha256: Buffer.from(a.sha256).toString('hex'),
      })),
    };
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

function pricePath(r: LibraryRow): 'instant' | 'rfq' {
  return r.productType?.calculatorKey && r.productType.quoteMode === 'instant' ? 'instant' : 'rfq';
}

function productHints(r: LibraryRow) {
  return (r.pattern?.catalogProducts ?? [])
    .map((p) => p.catalogProduct)
    .filter((p) => p.status === 'active' && p.priceHint)
    .map((p) => ({ slug: p.slug, ...p.priceHint! }))
    .sort((a, b) => a.unitPrice.comparedTo(b.unitPrice) || a.slug.localeCompare(b.slug));
}

function card(r: LibraryRow, favourites: Set<bigint>): StyleCardDto {
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
        }
      : null,
    referenceCode: r.referenceVerifiedAt ? r.referenceCode : null,
    favourite: favourites === NOT_SIGNED_IN ? null : favourites.has(r.id),
  };
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
