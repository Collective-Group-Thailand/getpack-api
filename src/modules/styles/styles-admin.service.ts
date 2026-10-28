import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Prisma } from '@generated/prisma/client';
import {
  DIELINE_ENGINE,
  type DielineEngine,
  type RecipeInsideSizes,
  type StoredRecipe,
} from '@integrations/dieline/dieline-engine.port';
import { sizeRulesOf } from '@modules/catalog/store/size-rules';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import {
  classSpan,
  FIT_BOUNDS,
  type FitBoundSources,
  mergeFitRange,
  productionEnvelopeBounds,
  recipeBounds,
  sameBoundSources,
  standardSizeBounds,
  summarySource,
  withSizeClassSources,
} from './fit-range-sources';
import { PUBLISH_REASONS } from './publishability';
import { insideRuleOf, isSizeClass, type SizeClass, sizeClassOf } from './size-classes';
import { type FitRange, type FitRangeSource, hasFitRange, isFitRangeEmpty, sameFitRange } from './style-fit';
import { StylePublishingService } from './style-publishing.service';
import {
  type AdminStyleBaseDetailDto,
  type AdminStyleBaseDto,
  type AdminStylePhotoDto,
  type AdminStyleVariantDto,
  type FitRangeBackfillResult,
  type FitRangeChangeDto,
  type FitRangeValuesDto,
  type SetStylePhotoDto,
  type StyleCommercialDto,
  type StyleImportRunDto,
  type UpdateStyleDto,
} from './styles-admin.dto';

export const BASE_INCLUDE = {
  productType: { select: { code: true, status: true } },
  pattern: { select: { publicId: true } },
  photoFile: { select: { publicId: true } },
  recipes: {
    orderBy: { version: 'desc' },
    include: { approvedBy: { select: { publicId: true } } },
  },
  synonyms: { orderBy: [{ locale: 'asc' }, { term: 'asc' }] },
  useCases: { orderBy: { code: 'asc' } },
} satisfies Prisma.StyleBaseInclude;
export type BaseRow = Prisma.StyleBaseGetPayload<{ include: typeof BASE_INCLUDE }>;

const iso = (d: Date | null) => (d ? toBangkokIso(d) : null);

/** `style_bases.photo_file_id` + `photo_meta` as curation sees them. */
function photoDto(row: BaseRow): AdminStylePhotoDto | null {
  if (!row.photoFile) return null;
  const meta = (row.photoMeta ?? {}) as { source?: unknown; alt?: { th?: unknown; en?: unknown } };
  return {
    fileId: row.photoFile.publicId,
    source: typeof meta.source === 'string' ? meta.source : 'getpack',
    alt: {
      th: typeof meta.alt?.th === 'string' ? meta.alt.th : row.nameTh,
      en: typeof meta.alt?.en === 'string' ? meta.alt.en : row.nameEn,
    },
  };
}

/**
 * Staff reads and Prepress / Marketing sign-offs of the style library (U3.B1): bases with their variant counts and
 * reasons, recipe approval (Prepress, never the person who imported it), name approval per role (D-212),
 * reference verification (D-211). Every sign-off is audited, evented and recomputes publishability (D-243).
 */
@Injectable()
export class StylesAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionResolver,
    private readonly publishing: StylePublishingService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    @Inject(DIELINE_ENGINE) private readonly engine: DielineEngine,
  ) {}

  async list(query: {
    category?: string;
    status?: 'active' | 'retired';
    published?: boolean;
    q?: string;
    page: number;
    perPage: number;
  }): Promise<{ rows: AdminStyleBaseDto[]; total: number }> {
    const where: Prisma.StyleBaseWhereInput = {
      ...(query.category ? { category: query.category } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.published === true ? { variants: { some: { publishable: true } } } : {}),
      ...(query.published === false ? { variants: { none: { publishable: true } } } : {}),
      ...(query.q
        ? {
            OR: [
              { code: { contains: query.q, mode: 'insensitive' } },
              { nameTh: { contains: query.q, mode: 'insensitive' } },
              { nameEn: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.styleBase.findMany({
        where,
        include: BASE_INCLUDE,
        orderBy: [{ category: 'asc' }, { sort: 'asc' }, { code: 'asc' }],
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.styleBase.count({ where }),
    ]);
    const counts = await this.variantCounts(rows.map((r) => r.id));
    return { rows: rows.map((r) => this.dto(r, counts.get(r.id))), total };
  }

  async get(publicId: string): Promise<AdminStyleBaseDetailDto> {
    const row = await this.row(this.prisma, publicId);
    const counts = await this.variantCounts([row.id]);
    const reasons = await this.prisma.$queryRaw<{ reason: string; count: bigint }[]>`
      SELECT r AS reason, count(*) AS count
      FROM style_variants v, unnest(v.reasons) AS r
      WHERE v.base_id = ${row.id} AND v.status = 'active'
      GROUP BY r`;
    return {
      ...this.dto(row, counts.get(row.id)),
      construction: row.construction,
      variantAxes: row.variantAxes,
      complexity: row.complexity,
      pricingPathAtLaunch: row.pricingPathAtLaunch,
      patternId: row.pattern?.publicId ?? null,
      descriptionTh: row.descriptionTh,
      descriptionEn: row.descriptionEn,
      synonyms: row.synonyms.map((s) => ({ locale: s.locale as 'th' | 'en', term: s.term })),
      useCases: row.useCases.map((u) => u.code),
      recipes: row.recipes.map((r) => ({
        id: r.publicId,
        version: r.version,
        schemaVersion: r.schemaVersion,
        checksum: Buffer.from(r.checksum).toString('hex'),
        processes: r.processes,
        approvedAt: iso(r.approvedAt),
        approvedById: r.approvedBy?.publicId ?? null,
        createdAt: toBangkokIso(r.createdAt),
      })),
      reasonCounts: PUBLISH_REASONS.flatMap((reason) => {
        const hit = reasons.find((r) => r.reason === reason);
        return hit ? [{ reason, count: Number(hit.count) }] : [];
      }),
      commercial: {
        fitMinLMm: row.fitMinLMm,
        fitMaxLMm: row.fitMaxLMm,
        fitMinWMm: row.fitMinWMm,
        fitMaxWMm: row.fitMaxWMm,
        fitMinHMm: row.fitMinHMm,
        fitMaxHMm: row.fitMaxHMm,
        moqUnits: row.moqUnits,
        recyclable: row.recyclable,
        plasticFree: row.plasticFree,
        certifications: row.certifications,
      },
      fitRangeSource: (row.fitRangeSource as FitRangeSource | null) ?? null,
      fitRangeBounds: fitRangeBoundsDto(row.fitRangeBounds),
      sizeClass: sizeClassDto(row.sizeClass),
    };
  }

  async variants(
    publicId: string,
    query: { reason?: string; page: number; perPage: number },
  ): Promise<{ rows: AdminStyleVariantDto[]; total: number }> {
    const base = await this.row(this.prisma, publicId);
    const where: Prisma.StyleVariantWhereInput = {
      baseId: base.id,
      ...(query.reason ? { reasons: { has: query.reason } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.styleVariant.findMany({
        where,
        orderBy: { optionKey: 'asc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.styleVariant.count({ where }),
    ]);
    return {
      rows: rows.map((v) => ({
        id: v.publicId,
        code: v.code,
        optionKey: v.optionKey,
        options: v.options as Record<string, unknown>,
        publishable: v.publishable,
        reasons: v.reasons as AdminStyleVariantDto['reasons'],
        pricePath: v.pricePath,
        priceReasons: v.priceReasons as AdminStyleVariantDto['priceReasons'],
        status: v.status,
        publishedAt: iso(v.publishedAt),
      })),
      total,
    };
  }

  /** D-243: Prepress approves a recipe version — never the person who imported it (maker ≠ checker). */
  async approveRecipe(
    actor: UserActor,
    basePublicId: string,
    recipePublicId: string,
  ): Promise<AdminStyleBaseDetailDto> {
    await this.prisma.withTx(async (tx) => {
      const base = await this.row(tx, basePublicId);
      const recipe = await tx.styleRecipe.findFirst({
        where: { publicId: recipePublicId, baseId: base.id },
        include: { importRun: { select: { createdById: true } } },
      });
      if (!recipe) throw new DomainException('http.not_found');
      if (recipe.approvedAt) throw new DomainException('styles.recipe_approved');
      if (recipe.importRun?.createdById === actor.userId) throw new DomainException('styles.maker_checker');
      await tx.styleRecipe.update({
        where: { id: recipe.id },
        data: { approvedAt: new Date(), approvedById: actor.userId },
      });
      await this.record(tx, base, 'style_base.recipe_approved', {
        recipeId: recipe.publicId,
        version: recipe.version,
      });
      await this.publishing.recompute(tx, [base.id]);
    });
    return this.get(basePublicId);
  }

  /** D-212: Marketing (wording) and Prepress (technical terms) each approve the Thai / English names. */
  async approveNames(
    actor: UserActor,
    publicId: string,
    as: 'marketing' | 'prepress',
  ): Promise<AdminStyleBaseDetailDto> {
    const roles = (await this.permissions.forUser(actor.userId)).roles.map((r) => r.key);
    if (!roles.includes(as)) throw new DomainException('styles.role_required', { params: { role: as } });
    await this.prisma.withTx(async (tx) => {
      const base = await this.row(tx, publicId);
      const now = new Date();
      await tx.styleBase.update({
        where: { id: base.id },
        data:
          as === 'marketing'
            ? {
                namesApprovedMarketingAt: now,
                namesApprovedMarketingBy: actor.userId,
                rowVersion: { increment: 1 },
              }
            : {
                namesApprovedPrepressAt: now,
                namesApprovedPrepressBy: actor.userId,
                rowVersion: { increment: 1 },
              },
      });
      await this.record(tx, base, 'style_base.names_approved', {
        as,
        nameTh: base.nameTh,
        nameEn: base.nameEn,
      });
      await this.publishing.recompute(tx, [base.id]);
    });
    return this.get(publicId);
  }

  /** D-211: Prepress verifies the reference code against the edition getpack holds; only then is it shown. */
  async verifyReference(
    actor: UserActor,
    publicId: string,
    referenceCode: string,
  ): Promise<AdminStyleBaseDetailDto> {
    await this.prisma.withTx(async (tx) => {
      const base = await this.row(tx, publicId);
      if (!base.referenceCode || base.referenceCode !== referenceCode.trim())
        throw new DomainException('styles.reference_mismatch');
      await tx.styleBase.update({
        where: { id: base.id },
        data: {
          referenceVerifiedAt: new Date(),
          referenceVerifiedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.record(tx, base, 'style_base.reference_verified', { referenceCode: base.referenceCode });
    });
    return this.get(publicId);
  }

  /** D-246 curation with If-Match; a name change clears both name approvals (D-212). Audited, evented, recomputed. */
  async update(actor: UserActor, publicId: string, ifMatch: string | undefined, input: UpdateStyleDto) {
    await this.prisma.withTx(async (tx) => {
      const base = await this.row(tx, publicId);
      assertIfMatch(ifMatch, etagOf(base.publicId, base.rowVersion));
      await this.curate(tx, actor, base, input);
    });
    return this.get(publicId);
  }

  /**
   * The one write path of curation (`admin.styles.update` and the C0b fit-range backfill): validated, audited
   * (`style_base.curated`), evented and publishability recomputed in the caller's transaction. A changed fit range is
   * marked `business` unless the caller is the recipe backfill (`fitRangeSource: 'recipe'`); a curation save that
   * resends an unchanged range keeps its source, so saving the MOQ does not turn a recipe range into business data.
   */
  private async curate(
    tx: Tx,
    actor: Actor,
    base: BaseRow,
    input: UpdateStyleDto,
    options: {
      fitRangeSource?: FitRangeSource;
      fitRangeBounds?: FitBoundSources;
      sizeClass?: SizeClass;
    } = {},
  ): Promise<void> {
    let productTypeId: bigint | null | undefined;
    if (input.productTypeCode !== undefined) {
      if (input.productTypeCode === null) productTypeId = null;
      else {
        const type = await tx.productType.findUnique({
          where: { code: input.productTypeCode },
          select: { id: true },
        });
        if (!type)
          throw new DomainException('validation.failed', {
            errors: [{ path: 'productTypeCode', code: 'exists', message: 'no such product type' }],
          });
        productTypeId = type.id;
      }
    }
    if (input.commercial) assertCommercial(input.commercial);
    const renamed =
      (input.nameTh !== undefined && input.nameTh.trim() !== base.nameTh) ||
      (input.nameEn !== undefined && input.nameEn.trim() !== base.nameEn);
    const fit: FitRange | null = input.commercial
      ? {
          fitMinLMm: input.commercial.fitMinLMm ?? null,
          fitMaxLMm: input.commercial.fitMaxLMm ?? null,
          fitMinWMm: input.commercial.fitMinWMm ?? null,
          fitMaxWMm: input.commercial.fitMaxWMm ?? null,
          fitMinHMm: input.commercial.fitMinHMm ?? null,
          fitMaxHMm: input.commercial.fitMaxHMm ?? null,
        }
      : null;
    const fitChanged = fit !== null && !sameFitRange(fit, base);
    const backfill = options.fitRangeSource !== undefined && options.fitRangeSource !== 'business';
    const fitRangeSource: FitRangeSource | null | undefined =
      fit === null
        ? undefined
        : isFitRangeEmpty(fit)
          ? null
          : fitChanged || backfill
            ? (options.fitRangeSource ?? 'business')
            : ((base.fitRangeSource as FitRangeSource | null) ?? 'business');
    // C1c: a backfill writes each bound's source; a business range has none; a resent unchanged range keeps its own.
    const fitRangeBounds: Prisma.InputJsonValue | typeof Prisma.DbNull | undefined =
      fit === null
        ? undefined
        : backfill && options.fitRangeBounds
          ? options.fitRangeBounds
          : fitRangeSource === null || fitRangeSource === 'business'
            ? Prisma.DbNull
            : undefined;
    const sourceChanged = fitRangeSource !== undefined && fitRangeSource !== (base.fitRangeSource ?? null);
    // C1e (§13.2): a style whose size search does not apply takes no new range from curation.
    const sizeClass = options.sizeClass ?? sizeClassDto(base.sizeClass);
    const classChanged =
      options.sizeClass !== undefined && options.sizeClass !== sizeClassDto(base.sizeClass);
    if (sizeClass === 'not_applicable' && fit !== null && fitChanged && !isFitRangeEmpty(fit) && !backfill)
      throw new DomainException('validation.failed', {
        errors: [
          {
            path: 'commercial.fitMinLMm',
            code: 'sizeSearchNotApplicable',
            message:
              'size search does not apply to this style (DECISIONS-STAGE-A §13.2): leave the fit range empty',
          },
        ],
      });
    await tx.styleBase.update({
      where: { id: base.id },
      data: {
        ...(input.featured !== undefined && { featured: input.featured }),
        ...(input.hidden !== undefined && { hidden: input.hidden }),
        ...(input.sort !== undefined && { sort: input.sort }),
        ...(input.nameTh !== undefined && { nameTh: input.nameTh.trim() }),
        ...(input.nameEn !== undefined && { nameEn: input.nameEn.trim() }),
        ...(input.descriptionTh !== undefined && { descriptionTh: input.descriptionTh?.trim() || null }),
        ...(input.descriptionEn !== undefined && { descriptionEn: input.descriptionEn?.trim() || null }),
        ...(productTypeId !== undefined && { productTypeId }),
        ...(classChanged && { sizeClass }),
        ...(input.commercial && {
          ...fit,
          fitRangeSource,
          ...(fitRangeBounds !== undefined && { fitRangeBounds }),
          moqUnits: input.commercial.moqUnits ?? null,
          recyclable: input.commercial.recyclable ?? null,
          plasticFree: input.commercial.plasticFree ?? null,
          certifications: [...new Set(input.commercial.certifications)],
        }),
        ...(renamed && {
          namesApprovedMarketingAt: null,
          namesApprovedMarketingBy: null,
          namesApprovedPrepressAt: null,
          namesApprovedPrepressBy: null,
        }),
        updatedById: actor.type === 'user' ? actor.userId : null,
        rowVersion: { increment: 1 },
      },
    });
    if (input.synonyms) {
      await tx.styleSynonym.deleteMany({ where: { baseId: base.id } });
      const unique = new Map(input.synonyms.map((x) => [`${x.locale}:${x.term.trim().toLowerCase()}`, x]));
      await tx.styleSynonym.createMany({
        data: [...unique.values()].map((x) => ({ baseId: base.id, locale: x.locale, term: x.term.trim() })),
      });
    }
    if (input.useCases) {
      await tx.styleUseCase.deleteMany({ where: { baseId: base.id } });
      await tx.styleUseCase.createMany({
        data: [...new Set(input.useCases)].map((code) => ({ baseId: base.id, code })),
      });
    }
    await this.record(
      tx,
      base,
      'style_base.curated',
      {
        fields: Object.keys(input).filter((k) => input[k as keyof UpdateStyleDto] !== undefined),
        namesApprovalCleared: renamed,
        ...((fitChanged || sourceChanged) && {
          fitRange: {
            before: fitRangeOf(base),
            after: fit,
            sourceBefore: base.fitRangeSource ?? null,
            source: fitRangeSource ?? null,
            ...(backfill && options.fitRangeBounds && { bounds: options.fitRangeBounds }),
          },
        }),
        ...(classChanged && { sizeClass: { before: base.sizeClass, after: sizeClass } }),
      },
      actor,
    );
    await this.publishing.recompute(tx, [base.id]);
  }

  /**
   * C0b / C1c / C1e (owner decisions 2026-10-28, DECISIONS-STAGE-A §9.1, §11.1, §13.2): fills each style's empty inside
   * fit range through the curation path above — audited per style — taking each bound from the first source that gives
   * it: (a) the approved recipe's range, (b) the style's own standard sizes (its catalogue products' standard sizes and
   * the recipe's presets), (c) the production envelope (its pattern's calculator size rules ∩ the dieline engine's
   * limits) ({@link mergeFitRange}). C1e: each style's size class is set from the documented rule
   * ({@link sizeClassOf}) and read by it — bags width × gusset × height, cylinders diameter square × height; a style
   * whose size search does not apply gets no range (a backfilled one is cleared) and is not counted as missing. Each
   * bound's source is stored (`fit_range_bounds`), the summary in `fit_range_source`. Never touches a business-entered
   * range (source `business`, or any bound entered before sources existed); a range it filled earlier follows newer
   * data. A style whose six bounds are not all given stays empty and is listed with what is missing. Idempotent (a
   * second run changes nothing); `dryRun` reports without writing.
   */
  async backfillFitRanges(actor: Actor, options: { dryRun?: boolean } = {}): Promise<FitRangeBackfillResult> {
    const bases = await this.prisma.styleBase.findMany({
      where: { status: 'active' },
      orderBy: { code: 'asc' },
      select: {
        publicId: true,
        code: true,
        materialClass: true,
        sizeClass: true,
        fitMinLMm: true,
        fitMaxLMm: true,
        fitMinWMm: true,
        fitMaxWMm: true,
        fitMinHMm: true,
        fitMaxHMm: true,
        fitRangeSource: true,
        fitRangeBounds: true,
        recipes: {
          where: { approvedAt: { not: null } },
          orderBy: { version: 'desc' },
          take: 1,
          select: { recipe: true, sizeRanges: true },
        },
        pattern: {
          select: {
            constraints: true,
            catalogProducts: {
              where: { catalogProduct: { status: 'active' } },
              select: {
                catalogProduct: {
                  select: {
                    standardSizes: {
                      where: { status: 'active' },
                      select: { lengthMm: true, widthMm: true, heightMm: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const result: FitRangeBackfillResult = {
      dryRun: options.dryRun === true,
      considered: bases.length,
      filled: [],
      refreshed: [],
      cleared: [],
      classified: [],
      unchanged: 0,
      keptBusiness: [],
      noRecipeRange: [],
      incomplete: [],
      notApplicable: [],
      bySource: { recipe: 0, standard_sizes: 0, production_envelope: 0, combined: 0 },
      boundsBySource: { recipe: 0, standard_sizes: 0, production_envelope: 0 },
      bySizeClass: { box: 0, bag: 0, cylinder: 0, not_applicable: 0 },
      coverage: { applicable: 0, withRange: 0 },
      changes: [],
    };
    const write = (
      b: (typeof bases)[number],
      range: FitRange | null,
      sizeClass: SizeClass,
      fit: { source: FitRangeSource; bounds: FitBoundSources } | null,
    ) =>
      this.prisma.withTx(async (tx) => {
        const base = await this.row(tx, b.publicId);
        const business =
          base.fitRangeSource === 'business' || (base.fitRangeSource === null && !isFitRangeEmpty(base));
        // Re-checked inside the transaction: a business value entered meanwhile wins (its class still follows the rule).
        const commercial =
          range === null || business
            ? undefined
            : {
                ...range,
                moqUnits: base.moqUnits,
                recyclable: base.recyclable,
                plasticFree: base.plasticFree,
                certifications: base.certifications,
              };
        if (!commercial && sizeClassDto(base.sizeClass) === sizeClass) return;
        await this.curate(
          tx,
          actor,
          base,
          commercial ? { commercial } : {},
          fit && commercial
            ? { fitRangeSource: fit.source, fitRangeBounds: fit.bounds, sizeClass }
            : { sizeClass },
        );
      });
    const EMPTY: FitRange = {
      fitMinLMm: null,
      fitMaxLMm: null,
      fitMinWMm: null,
      fitMaxWMm: null,
      fitMinHMm: null,
      fitMaxHMm: null,
    };
    for (const b of bases) {
      const recipe = b.recipes[0] ?? null;
      const sizeClass = sizeClassOf(b.code, recipe?.recipe ?? null);
      const sizeClassBefore = sizeClassDto(b.sizeClass);
      const classChanged = sizeClassBefore !== sizeClass;
      result.bySizeClass[sizeClass] += 1;
      const business = b.fitRangeSource === 'business' || (b.fitRangeSource === null && !isFitRangeEmpty(b));
      const change = (
        action: FitRangeChangeDto['action'],
        after: FitRange | null,
        fit: { source: FitRangeSource; bounds: FitBoundSources } | null,
      ) => {
        result[action].push(b.code);
        result.changes.push({
          styleId: b.publicId,
          code: b.code,
          action,
          before: isFitRangeEmpty(b) ? null : (fitRangeOf(b) as FitRangeValuesDto),
          after: after && !isFitRangeEmpty(after) ? (after as FitRangeValuesDto) : null,
          source:
            fit?.source ??
            (after && !isFitRangeEmpty(after) ? ((b.fitRangeSource as FitRangeSource | null) ?? null) : null),
          bounds: fit?.bounds ?? null,
          sizeClassBefore,
          sizeClass,
        });
      };

      if (sizeClass === 'not_applicable') {
        result.notApplicable.push(b.code);
        if (business) {
          result.keptBusiness.push(b.code);
          if (classChanged) change('classified', fitRangeOf(b), null);
          if (classChanged && !result.dryRun) await write(b, null, sizeClass, null);
          continue;
        }
        if (!isFitRangeEmpty(b)) change('cleared', null, null);
        else if (classChanged) change('classified', null, null);
        else continue;
        if (!result.dryRun) await write(b, isFitRangeEmpty(b) ? null : EMPTY, sizeClass, null);
        continue;
      }

      result.coverage.applicable += 1;
      if (business) {
        result.keptBusiness.push(b.code);
        if (hasFitRange(b)) result.coverage.withRange += 1;
        if (!classChanged) continue;
        change('classified', fitRangeOf(b), null);
        if (!result.dryRun) await write(b, null, sizeClass, null);
        continue;
      }
      const inside = recipe ? await this.insideSizes(recipe.recipe, sizeClass) : {};
      const rules = b.pattern ? sizeRulesOf(b.pattern.constraints) : null;
      // C1f (§14.2): a cylinder's diameter comes from the production envelope, not its presets.
      const merged = mergeFitRange(
        withSizeClassSources(sizeClass, {
          recipe: recipeBounds(b.materialClass, recipe?.sizeRanges ?? null, sizeClass),
          standard_sizes: standardSizeBounds(
            (b.pattern?.catalogProducts ?? []).flatMap((p) =>
              p.catalogProduct.standardSizes.map((z) => ({
                lengthMm: Number(z.lengthMm),
                widthMm: Number(z.widthMm),
                heightMm: Number(z.heightMm),
              })),
            ),
            classSpan(
              b.materialClass,
              Object.fromEntries(Object.entries(inside).map(([k, v]) => [k, v.standard])),
            ),
          ),
          production_envelope: productionEnvelopeBounds(
            rules,
            classSpan(
              b.materialClass,
              Object.fromEntries(Object.entries(inside).map(([k, v]) => [k, v.limits])),
            ),
          ),
        }),
      );
      if (!merged.range || !merged.bounds) {
        result.noRecipeRange.push(b.code);
        result.incomplete.push({ code: b.code, missing: merged.missing, conflicting: merged.conflicting });
        // A range this backfill set earlier that the sources no longer give is left as it is (as before C1e).
        if (hasFitRange(b)) result.coverage.withRange += 1;
        if (classChanged) {
          change('classified', isFitRangeEmpty(b) ? null : fitRangeOf(b), null);
          if (!result.dryRun) await write(b, null, sizeClass, null);
        }
        continue;
      }
      result.coverage.withRange += 1;
      const source = summarySource(merged.bounds);
      result.bySource[source] += 1;
      for (const k of FIT_BOUNDS) result.boundsBySource[merged.bounds[k].source] += 1;
      if (
        b.fitRangeSource === source &&
        sameFitRange(merged.range, b) &&
        (sameBoundSources(b.fitRangeBounds, merged.bounds) ||
          (source === 'recipe' && b.fitRangeBounds === null))
      ) {
        if (classChanged) {
          change('classified', merged.range, null);
          if (!result.dryRun) await write(b, null, sizeClass, null);
        } else result.unchanged += 1;
        continue;
      }
      const fit = { source, bounds: merged.bounds };
      change(b.fitRangeSource === null ? 'filled' : 'refreshed', merged.range, fit);
      if (!result.dryRun) await write(b, merged.range, sizeClass, fit);
    }
    return result;
  }

  /** C1c: the engine's inside spans of an approved recipe; none when the engine cannot read it (never fails a run). */
  private async insideSizes(recipe: unknown, sizeClass: SizeClass): Promise<RecipeInsideSizes> {
    try {
      return await this.engine.insideSizes(recipe as StoredRecipe, insideRuleOf(sizeClass));
    } catch {
      return {};
    }
  }

  /**
   * The photo on the style's card (D-426): a photograph uploaded by curation (`source: getpack`) replaces an
   * AI render; the file must be an uploaded image that is not infected (served once the scan is clean).
   */
  async setPhoto(actor: UserActor, publicId: string, ifMatch: string | undefined, input: SetStylePhotoDto) {
    await this.prisma.withTx(async (tx) => {
      const base = await this.row(tx, publicId);
      assertIfMatch(ifMatch, etagOf(base.publicId, base.rowVersion));
      const file = await tx.fileObject.findFirst({
        where: { publicId: input.fileId },
        select: { id: true, uploadStatus: true, scanStatus: true, mimeType: true },
      });
      if (
        !file ||
        file.uploadStatus !== 'uploaded' ||
        file.scanStatus === 'infected' ||
        !file.mimeType.startsWith('image/')
      )
        throw new DomainException('validation.failed', {
          errors: [{ path: 'fileId', code: 'fileReady', message: 'fileId is not an uploaded image' }],
        });
      await tx.styleBase.update({
        where: { id: base.id },
        data: {
          photoFileId: file.id,
          photoMeta: {
            source: 'getpack',
            alt: { th: input.altTh?.trim() || base.nameTh, en: input.altEn?.trim() || base.nameEn },
          },
          updatedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.record(tx, base, 'style_base.photo_set', { fileId: input.fileId, source: 'getpack' });
    });
    return this.get(publicId);
  }

  async clearPhoto(actor: UserActor, publicId: string, ifMatch: string | undefined) {
    await this.prisma.withTx(async (tx) => {
      const base = await this.row(tx, publicId);
      assertIfMatch(ifMatch, etagOf(base.publicId, base.rowVersion));
      await tx.styleBase.update({
        where: { id: base.id },
        data: {
          photoFileId: null,
          photoMeta: Prisma.DbNull,
          updatedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.record(tx, base, 'style_base.photo_cleared', {});
    });
    return this.get(publicId);
  }

  async runs(query: {
    page: number;
    perPage: number;
  }): Promise<{ rows: StyleImportRunDto[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.prisma.styleImportRun.findMany({
        include: RUN_INCLUDE,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.styleImportRun.count(),
    ]);
    return { rows: rows.map(runDto), total };
  }

  async run(publicId: string): Promise<StyleImportRunDto> {
    const row = await this.prisma.styleImportRun.findUnique({ where: { publicId }, include: RUN_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return runDto(row);
  }

  async row(db: Tx | PrismaService, publicId: string): Promise<BaseRow> {
    const row = await db.styleBase.findUnique({ where: { publicId }, include: BASE_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async variantCounts(baseIds: bigint[]) {
    const counts = new Map<bigint, { total: number; active: number; publishable: number }>();
    if (baseIds.length === 0) return counts;
    const rows = await this.prisma.$queryRaw<
      { base_id: bigint; total: bigint; active: bigint; publishable: bigint }[]
    >`
      SELECT base_id, count(*) AS total, count(*) FILTER (WHERE status = 'active') AS active,
             count(*) FILTER (WHERE publishable) AS publishable
      FROM style_variants WHERE base_id = ANY(${baseIds}) GROUP BY base_id`;
    for (const r of rows)
      counts.set(r.base_id, {
        total: Number(r.total),
        active: Number(r.active),
        publishable: Number(r.publishable),
      });
    return counts;
  }

  dto(row: BaseRow, counts?: { total: number; active: number; publishable: number }): AdminStyleBaseDto {
    const latest = row.recipes[0];
    return {
      id: row.publicId,
      code: row.code,
      family: row.family,
      category: row.category,
      sourceProductType: row.sourceProductType,
      productTypeCode: row.productType?.code ?? null,
      nameTh: row.nameTh,
      nameEn: row.nameEn,
      materialClass: row.materialClass,
      wave: row.wave,
      status: row.status,
      featured: row.featured,
      hidden: row.hidden,
      sort: row.sort,
      variants: counts ?? { total: 0, active: 0, publishable: 0 },
      publishedAt: iso(row.publishedAt),
      namesApproval: {
        marketingAt: iso(row.namesApprovedMarketingAt),
        prepressAt: iso(row.namesApprovedPrepressAt),
      },
      photo: photoDto(row),
      referenceCode: row.referenceCode,
      referenceVerifiedAt: iso(row.referenceVerifiedAt),
      recipeVersion: latest?.version ?? null,
      recipeApproved: row.recipes.some((r) => r.approvedAt !== null),
      version: row.rowVersion,
    };
  }

  async record(
    tx: Tx,
    base: { publicId: string; code: string },
    type: string,
    data: Record<string, unknown>,
    actor?: Actor,
  ) {
    await this.audit.record(tx, {
      category: 'config',
      action: type,
      resourceType: 'style_base',
      resourcePublicId: base.publicId,
      data: { code: base.code, ...data },
      ...(actor && { actor }),
    });
    await this.events.record(
      tx,
      {
        type,
        aggregateType: 'style_base',
        aggregateId: base.publicId,
        payload: { baseId: base.publicId, code: base.code, ...data },
      },
      actor,
    );
  }
}

const RUN_INCLUDE = {
  approvalRequest: { select: { publicId: true } },
  createdBy: { select: { publicId: true } },
} satisfies Prisma.StyleImportRunInclude;

function runDto(r: Prisma.StyleImportRunGetPayload<{ include: typeof RUN_INCLUDE }>): StyleImportRunDto {
  return {
    id: r.publicId,
    kind: r.kind,
    fileName: r.fileName,
    checksum: Buffer.from(r.checksum).toString('hex'),
    status: r.status,
    diff: r.diff as Record<string, unknown>,
    approvalRequestId: r.approvalRequest?.publicId ?? null,
    createdById: r.createdBy?.publicId ?? null,
    createdAt: toBangkokIso(r.createdAt),
    decidedAt: iso(r.decidedAt),
  };
}

/** Each entered minimum must not exceed its maximum (the database checks it too). */
export function assertCommercial(c: StyleCommercialDto): void {
  const pairs = [
    ['fitMinLMm', c.fitMinLMm, c.fitMaxLMm],
    ['fitMinWMm', c.fitMinWMm, c.fitMaxWMm],
    ['fitMinHMm', c.fitMinHMm, c.fitMaxHMm],
  ] as const;
  const errors = pairs
    .filter(([, min, max]) => typeof min === 'number' && typeof max === 'number' && min > max)
    .map(([path]) => ({
      path: `commercial.${path}`,
      code: 'max',
      message: 'the minimum is above the maximum',
    }));
  if (errors.length > 0) throw new DomainException('validation.failed', { errors });
}

const fitRangeOf = (r: FitRange): FitRange => ({
  fitMinLMm: r.fitMinLMm,
  fitMaxLMm: r.fitMaxLMm,
  fitMinWMm: r.fitMinWMm,
  fitMaxWMm: r.fitMaxWMm,
  fitMinHMm: r.fitMinHMm,
  fitMaxHMm: r.fitMaxHMm,
});

/** C1e: `style_bases.size_class` (anything unknown reads as `box`, the C1c behaviour). */
function sizeClassDto(value: string): SizeClass {
  return isSizeClass(value) ? value : 'box';
}

/** C1c: `style_bases.fit_range_bounds` as the admin reads it (null for a business range or none). */
function fitRangeBoundsDto(value: unknown): FitBoundSources | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, { source?: unknown; basis?: unknown }>;
  return FIT_BOUNDS.every((k) => typeof v[k]?.source === 'string') ? (v as unknown as FitBoundSources) : null;
}
