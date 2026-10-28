import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Prisma } from '@generated/prisma/client';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { PUBLISH_REASONS } from './publishability';
import {
  type FitRange,
  fitRangeFromRecipe,
  type FitRangeSource,
  isFitRangeEmpty,
  sameFitRange,
} from './style-fit';
import { StylePublishingService } from './style-publishing.service';
import {
  type AdminStyleBaseDetailDto,
  type AdminStyleBaseDto,
  type AdminStylePhotoDto,
  type AdminStyleVariantDto,
  type FitRangeBackfillResult,
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
    options: { fitRangeSource?: FitRangeSource } = {},
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
    const fitRangeSource: FitRangeSource | null | undefined =
      fit === null
        ? undefined
        : isFitRangeEmpty(fit)
          ? null
          : fitChanged
            ? (options.fitRangeSource ?? 'business')
            : ((base.fitRangeSource as FitRangeSource | null) ?? options.fitRangeSource ?? 'business');
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
        ...(input.commercial && {
          ...fit,
          fitRangeSource,
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
        ...(fitChanged && {
          fitRange: { before: fitRangeOf(base), after: fit, source: fitRangeSource ?? null },
        }),
      },
      actor,
    );
    await this.publishing.recompute(tx, [base.id]);
  }

  /**
   * C0b (owner decision 2026-10-28, DECISIONS-STAGE-A §9.1): fills each style's empty inside fit range from its approved
   * recipe's size range ({@link fitRangeFromRecipe}) through the curation path above — audited per style, source
   * `recipe`. Never touches a business-entered range (source `business`, or any bound entered before sources existed);
   * a range it filled earlier follows a newer approved recipe. Idempotent: a second run changes nothing. `dryRun`
   * reports without writing.
   */
  async backfillFitRanges(actor: Actor, options: { dryRun?: boolean } = {}): Promise<FitRangeBackfillResult> {
    const bases = await this.prisma.styleBase.findMany({
      where: { recipes: { some: { approvedAt: { not: null } } } },
      orderBy: { code: 'asc' },
      select: {
        publicId: true,
        code: true,
        materialClass: true,
        fitMinLMm: true,
        fitMaxLMm: true,
        fitMinWMm: true,
        fitMaxWMm: true,
        fitMinHMm: true,
        fitMaxHMm: true,
        fitRangeSource: true,
        recipes: {
          where: { approvedAt: { not: null } },
          orderBy: { version: 'desc' },
          take: 1,
          select: { sizeRanges: true },
        },
      },
    });
    const result: FitRangeBackfillResult = {
      dryRun: options.dryRun === true,
      considered: bases.length,
      filled: [],
      refreshed: [],
      unchanged: 0,
      keptBusiness: [],
      noRecipeRange: [],
    };
    for (const b of bases) {
      const business = b.fitRangeSource === 'business' || (b.fitRangeSource === null && !isFitRangeEmpty(b));
      if (business) {
        result.keptBusiness.push(b.code);
        continue;
      }
      const range = fitRangeFromRecipe(b.materialClass, b.recipes[0]?.sizeRanges ?? null);
      if (!range) {
        result.noRecipeRange.push(b.code);
        continue;
      }
      if (b.fitRangeSource === 'recipe' && sameFitRange(range, b)) {
        result.unchanged += 1;
        continue;
      }
      (b.fitRangeSource === 'recipe' ? result.refreshed : result.filled).push(b.code);
      if (result.dryRun) continue;
      await this.prisma.withTx(async (tx) => {
        const base = await this.row(tx, b.publicId);
        // Re-checked inside the transaction: a business value entered meanwhile wins.
        if (base.fitRangeSource === 'business' || (base.fitRangeSource === null && !isFitRangeEmpty(base)))
          return;
        await this.curate(
          tx,
          actor,
          base,
          {
            commercial: {
              ...range,
              moqUnits: base.moqUnits,
              recyclable: base.recyclable,
              plasticFree: base.plasticFree,
              certifications: base.certifications,
            },
          },
          { fitRangeSource: 'recipe' },
        );
      });
    }
    return result;
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
