import { createHash } from 'node:crypto';

import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { addCalendarDays, bangkokDate, startOfBangkokDay } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type DrawingFormat,
  type FileObject,
  type MeasurementBasis,
  type Prisma,
} from '@generated/prisma/client';
import { DESIGNER_PDF_WRITER } from '@integrations/dieline/designer-pdf';
import {
  type DesignerPdfOptions,
  DIELINE_ENGINE,
  DielineBuildError,
  type DielineEngine,
  type DielineMaterial,
  type StoredRecipe,
} from '@integrations/dieline/dieline-engine.port';
import { profileOf, rulesFor } from '@modules/artwork/preflight/rules';
import { canonical } from '@modules/catalog/imports/import-engine';
import { sizeText, sizeValue } from '@modules/quotes/spec-label';
import { BasisError, constructionFamily, convertSize } from '@modules/specs/dimension-conversion';
import { Inject, Injectable } from '@nestjs/common';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { FilesService } from '@platform/files/files.service';
import { SettingsService } from '@platform/settings/settings.service';

import { type DielineDownloadFormat } from './dieline-downloads.dto';
import { StyleDielinesService } from './style-dielines.service';

export interface DownloadInput {
  variantCode: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  measurementBasis?: MeasurementBasis;
  materialClass: string;
  format: DielineDownloadFormat;
}

export interface DownloadResult {
  download: { publicId: string; createdAt: Date };
  render: Prisma.DielineRenderGetPayload<{ include: { file: true } }>;
  /** The format asked for — `ai` is a `pdf` render under another name, so the render row cannot say. */
  format: DielineDownloadFormat;
  variantCode: string;
  measurementBasis: MeasurementBasis;
  entered: { lengthMm: number; widthMm: number; heightMm: number };
  cached: boolean;
  url: string;
  expiresAt: Date;
  /** Downloads left today for a customer, null for staff (not limited). */
  remainingToday: number | null;
}

const MIME: Record<DielineDownloadFormat, string> = {
  svg: 'image/svg+xml',
  dxf: 'application/dxf',
  pdf: 'application/pdf',
  ai: 'application/illustrator',
};

/** The engine format behind a download format: `.ai` is the designer PDF under Illustrator's name. */
const ENGINE_FORMAT: Record<DielineDownloadFormat, DrawingFormat> = {
  svg: 'svg',
  dxf: 'dxf',
  pdf: 'pdf',
  ai: 'pdf',
};

const VARIANT_INCLUDE = {
  base: {
    select: {
      code: true,
      nameEn: true,
      status: true,
      hidden: true,
      pattern: { select: { geometryFormula: true, corrugateFormula: true } },
      recipes: {
        where: { approvedAt: { not: null } },
        orderBy: { version: 'desc' },
        take: 1,
        select: { id: true, version: true, recipe: true, checksum: true, sizeRanges: true },
      },
    },
  },
} satisfies Prisma.StyleVariantInclude;
type VariantRow = Prisma.StyleVariantGetPayload<{ include: typeof VARIANT_INCLUDE }>;

/**
 * Drawing service v2 and the free dieline download (D-270, D-271, D-203). A published variant is drawn by the vendored
 * engine (ADR-0010) at inside sizes (another basis is converted first, D-182) on the reference material of the chosen
 * material class; the file is cached by sha256 of (engine version, recipe checksum, options, sizes, material, format),
 * so a new recipe version or engine bundle draws afresh. Customers: publishable variants within the recipe's size
 * ranges, `dielines.downloads_per_minute` / `dielines.downloads_per_day` (Bangkok day). Staff (`drawings.generate`):
 * any variant with an approved recipe, unlimited. Every download is logged (`dieline_downloads`) with an event.
 */
@Injectable()
export class DielineDownloadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
    private readonly events: DomainEvents,
    private readonly dielines: StyleDielinesService,
    @Inject(DIELINE_ENGINE) private readonly engine: DielineEngine,
  ) {}

  async download(actor: UserActor, input: DownloadInput, now: Date = new Date()): Promise<DownloadResult> {
    const staff = actor.audience === 'staff';
    if (!(await this.dielines.ready())) throw new DomainException('drawing.engine_unavailable');
    const variant = await this.prisma.styleVariant.findUnique({
      where: { code: input.variantCode },
      include: VARIANT_INCLUDE,
    });
    const published =
      variant?.publishable &&
      variant.status === 'active' &&
      variant.base.status === 'active' &&
      !variant.base.hidden;
    if (!variant || (!staff && !published)) throw new DomainException('styles.variant_not_found');
    const recipe = variant.base.recipes[0];
    if (!recipe) throw new DomainException('dielines.not_drawable');

    const ranges = (recipe.sizeRanges ?? {}) as Record<string, Record<string, number | null>>;
    const range = ranges[input.materialClass];
    const material = await this.engine.referenceMaterial(input.materialClass);
    // A customer downloads only within a size range the recipe publishes for the class (D-203).
    if (!material || (!staff && !range)) throw this.classNotOffered(Object.keys(ranges));

    const basis = input.measurementBasis ?? 'internal';
    const inside = this.insideSizes(variant, input, basis, material);
    if (!staff) this.checkRange(inside, range!);
    if (!staff) await this.checkLimits(this.prisma, actor.userId, now);

    const { render, cached } = await this.render(
      variant,
      recipe,
      inside,
      input.materialClass,
      material,
      input.format,
      now,
    );
    const entered = { lengthMm: input.lengthMm, widthMm: input.widthMm, heightMm: input.heightMm };
    const download = await this.prisma.withTx(async (tx) => {
      if (!staff) {
        // One customer's downloads are counted one at a time, so parallel requests cannot pass the limit.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('dieline_downloads'), (${actor.userId} % 2147483647)::int)`;
        await this.checkLimits(tx, actor.userId, now);
      }
      const row = await tx.dielineDownload.create({
        data: {
          userId: actor.userId,
          renderId: render.id,
          staff,
          measurementBasis: basis,
          enteredLengthMm: entered.lengthMm,
          enteredWidthMm: entered.widthMm,
          enteredHeightMm: entered.heightMm,
        },
      });
      await this.events.record(tx, {
        type: 'dielines.downloaded',
        aggregateType: 'style_variant',
        aggregateId: variant.publicId,
        payload: {
          downloadId: row.publicId,
          variantCode: variant.code,
          baseCode: variant.base.code,
          format: input.format,
          materialClass: input.materialClass,
          staff,
          cached,
        },
      });
      return row;
    });
    const signed = await this.files.signedUrl(render.file);
    if (!signed) throw new DomainException('file.not_ready');
    return {
      download,
      render,
      format: input.format,
      variantCode: variant.code,
      measurementBasis: basis,
      entered,
      cached,
      url: signed.url,
      expiresAt: signed.expiresAt,
      remainingToday: staff ? null : await this.remainingToday(actor.userId, now),
    };
  }

  // --- drawing v2 (D-270) ------------------------------------------------------------------------------------

  /** The cached render of the key, else a fresh one (a concurrent identical render keeps the first row). */
  private async render(
    variant: VariantRow,
    recipe: VariantRow['base']['recipes'][number],
    sizes: { length: number; width: number; height: number },
    materialClass: string,
    material: DielineMaterial,
    delivery: DielineDownloadFormat,
    now: Date,
  ) {
    const format = ENGINE_FORMAT[delivery];
    const engineVersion = await this.engine.version();
    const designer =
      format === 'pdf' ? await this.designerPdf(variant, sizes, now, materialClass) : undefined;
    const cacheKey = createHash('sha256')
      .update(
        JSON.stringify(
          canonical({
            engineVersion,
            recipe: Buffer.from(recipe.checksum).toString('hex'),
            options: variant.options,
            sizes,
            material,
            format,
            // The same drawing under another name and type is another file (and another cache row).
            ...(delivery !== format && { delivery }),
            // D-302: the designer PDF's writer and its bleed / safe distances draw a new file when they change.
            ...(designer && {
              writer: DESIGNER_PDF_WRITER,
              bleedMm: designer.bleedMm,
              safeMm: designer.safeMm,
            }),
          }),
        ),
      )
      .digest();
    const hit = await this.prisma.dielineRender.findUnique({ where: { cacheKey }, include: { file: true } });
    if (hit) return { render: hit, cached: true };

    let built;
    try {
      built = await this.engine.build(
        {
          recipe: recipe.recipe as unknown as StoredRecipe,
          options: variant.options as Record<string, unknown>,
          sizes,
          material,
        },
        [format],
        designer,
      );
    } catch (error) {
      if (error instanceof DielineBuildError) throw new DomainException('dielines.not_drawable');
      throw error;
    }
    const body = built.files[format]?.body;
    if (!body) throw new DomainException('dielines.not_drawable');
    const file: FileObject = await this.files.storeSystem({
      body,
      fileName: `${variant.code}-${sizes.length}x${sizes.width}x${sizes.height}-${materialClass}.${delivery}`,
      mimeType: MIME[delivery],
      retentionClass: 'standard',
      ownerUserId: null,
    });
    await this.prisma.dielineRender.createMany({
      data: [
        {
          cacheKey,
          variantId: variant.id,
          recipeId: recipe.id,
          engineVersion: built.engineVersion,
          materialClass,
          lengthMm: sizes.length,
          widthMm: sizes.width,
          heightMm: sizes.height,
          format,
          fileId: file.id,
          quantities: built.quantities as unknown as Prisma.InputJsonValue,
          violations: built.violations.map((v) => v.code),
        },
      ],
      skipDuplicates: true,
    });
    const render = await this.prisma.dielineRender.findUniqueOrThrow({
      where: { cacheKey },
      include: { file: true },
    });
    return { render, cached: false };
  }

  // --- helpers -----------------------------------------------------------------------------------------------

  /**
   * D-302 the designer PDF of a variant: layers named for Illustrator, bleed and safe distances of the preflight rules
   * (ADR-0009), the style code and inside size in the title and metadata.
   */
  private async designerPdf(
    variant: VariantRow,
    sizes: { length: number; width: number; height: number },
    at: Date,
    materialClass: string,
  ): Promise<DesignerPdfOptions> {
    // C12 (D-460): corrugated board has its own safe distance (print profile `corrugated`).
    const rules = rulesFor(
      (await this.settings.at('artwork.preflight_rules', { at })).value,
      profileOf({ materialClass }),
    );
    // The one size string (D-441, B-API-3): ยาว × กว้าง × สูง, mm, inner dimensions.
    const inside = sizeValue({ l: sizes.length, w: sizes.width, d: sizes.height }, 'internal').en;
    const size = `${sizeText({ l: sizes.length, w: sizes.width, d: sizes.height })} mm`;
    return {
      title: `${variant.code} ${variant.base.nameEn} ${inside}`,
      styleCode: variant.code,
      bleedMm: Number(rules.bleedMm),
      safeMm: Number(rules.safeZoneMm),
      keywords: [variant.base.code, `inside ${size}`],
    };
  }

  /** Inside sizes (D-182): as entered, or converted from the outside / over-crease sizes with the reference caliper. */
  private insideSizes(
    variant: VariantRow,
    input: DownloadInput,
    basis: MeasurementBasis,
    material: DielineMaterial,
  ): { length: number; width: number; height: number } {
    if (basis === 'internal') return { length: input.lengthMm, width: input.widthMm, height: input.heightMm };
    const family = constructionFamily(null, variant.base.pattern, input.heightMm);
    try {
      const converted = convertSize(
        { l: input.lengthMm, w: input.widthMm, d: input.heightMm },
        basis,
        family,
        material.caliperMm,
      ).sizes.internal;
      if (!converted) throw new BasisError('specs.basis_not_accepted');
      return { length: converted.l, width: converted.w, height: converted.d };
    } catch (error) {
      if (error instanceof BasisError)
        throw new DomainException('specs.basis_not_accepted', {
          errors: [
            { path: 'measurementBasis', code: 'basis_not_accepted', message: `basis ${basis} (${family})` },
          ],
        });
      throw error;
    }
  }

  private checkRange(
    sizes: { length: number; width: number; height: number },
    r: Record<string, number | null>,
  ) {
    const errors: { path: string; code: string; message: string }[] = [];
    const check = (
      path: string,
      v: number,
      min: number | null | undefined,
      max: number | null | undefined,
    ) => {
      if ((min !== null && min !== undefined && v < min) || (max !== null && max !== undefined && v > max))
        errors.push({
          path,
          code: 'out_of_range',
          message: `inside ${v} mm, range ${min ?? '–'}–${max ?? '–'} mm`,
        });
    };
    check('lengthMm', sizes.length, r['minL'], r['maxL']);
    check('widthMm', sizes.width, r['minW'], r['maxW']);
    check('heightMm', sizes.height, r['minH'], r['maxH']);
    if (errors.length > 0) throw new DomainException('dielines.size_out_of_range', { errors });
  }

  private classNotOffered(offered: string[]): DomainException {
    return new DomainException('dielines.material_class_not_offered', {
      errors: [
        {
          path: 'materialClass',
          code: 'not_offered',
          message: offered.length > 0 ? `offered: ${offered.sort().join(', ')}` : 'no size ranges published',
        },
      ],
    });
  }

  /** D-203: refuses with 429 and `Retry-After` once a limit is reached (customer downloads only). */
  private async checkLimits(db: Tx, userId: bigint, now: Date): Promise<void> {
    const [perMinute, perDay] = await Promise.all([
      this.settings.at('dielines.downloads_per_minute', { at: now }),
      this.settings.at('dielines.downloads_per_day', { at: now }),
    ]);
    const minuteAgo = new Date(now.getTime() - 60_000);
    const recent = await db.dielineDownload.findMany({
      where: { userId, staff: false, createdAt: { gt: minuteAgo } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    if (recent.length >= perMinute.value) {
      const wait = Math.ceil((recent[0]!.createdAt.getTime() + 60_000 - now.getTime()) / 1000);
      throw this.limited('minute', perMinute.value, Math.max(wait, 1));
    }
    const today = bangkokDate(now);
    const count = await db.dielineDownload.count({
      where: { userId, staff: false, createdAt: { gte: startOfBangkokDay(today) } },
    });
    if (count >= perDay.value) {
      const wait = Math.ceil((startOfBangkokDay(addCalendarDays(today, 1)).getTime() - now.getTime()) / 1000);
      throw this.limited('day', perDay.value, Math.max(wait, 1));
    }
  }

  private limited(window: 'minute' | 'day', limit: number, retryAfter: number): DomainException {
    return new DomainException('dielines.rate_limited', {
      headers: { 'Retry-After': String(retryAfter) },
      params: { window, limit },
    });
  }

  private async remainingToday(userId: bigint, now: Date): Promise<number> {
    const perDay = (await this.settings.at('dielines.downloads_per_day', { at: now })).value;
    const count = await this.prisma.dielineDownload.count({
      where: { userId, staff: false, createdAt: { gte: startOfBangkokDay(bangkokDate(now)) } },
    });
    return Math.max(perDay - count, 0);
  }
}
