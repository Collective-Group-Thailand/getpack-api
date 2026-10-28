import { createHash } from 'node:crypto';

import { PrismaService } from '@database/prisma.service';
import { type Prisma, type StyleAssetKind } from '@generated/prisma/client';
import {
  DIELINE_ENGINE,
  type DielineEngine,
  type StoredRecipe,
} from '@integrations/dieline/dieline-engine.port';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { StyleDielinesService } from './style-dielines.service';

/** Thumbnail edge, px (gap §U3.B4 assumption 4). */
export const THUMBNAIL_PX = 512;
const BATCH = 10;
const ASSET_URL_TTL_SECONDS = 15 * 60;

interface Rendered {
  kind: StyleAssetKind;
  body: Buffer;
  contentType: string;
  ext: string;
}

/**
 * D-270 style assets: per publishable variant, a 2D thumbnail, a 3D thumbnail when the structure folds and the dieline
 * SVG, drawn by the vendored engine's own rasteriser (ADR-0010) at the recipe's default sizes on the reference
 * material of the base's material class (else the recipe's first class). Stored in object storage with their sha256;
 * a new recipe version or engine bundle re-renders and replaces the variant's rows. Best effort, a batch at a time.
 */
@Injectable()
export class StyleAssetsService {
  private readonly logger = new Logger(StyleAssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dielines: StyleDielinesService,
    @Inject(DIELINE_ENGINE) private readonly engine: DielineEngine,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  @ScheduledJob({ name: 'styles.render_assets', every: 300_000 })
  async renderDue(limit = BATCH): Promise<number> {
    if (!(await this.dielines.ready())) return 0;
    const engineVersion = await this.engine.version();
    const styles = await this.renderStyleDielines(limit, engineVersion);
    const variants = await this.prisma.styleVariant.findMany({
      where: {
        publishable: true,
        status: 'active',
        base: { recipes: { some: { approvedAt: { not: null } } } },
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        code: true,
        options: true,
        baseId: true,
        assets: { where: { kind: 'thumbnail_2d' }, select: { recipeVersion: true, engineVersion: true } },
        base: {
          select: {
            code: true,
            materialClass: true,
            recipes: {
              where: { approvedAt: { not: null } },
              orderBy: { version: 'desc' },
              take: 1,
              select: { version: true, recipe: true, sizeRanges: true },
            },
          },
        },
      },
    });
    const due = variants.filter((v) => {
      const version = v.base.recipes[0]!.version;
      return !v.assets.some((a) => a.recipeVersion === version && a.engineVersion === engineVersion);
    });
    let rendered = styles;
    for (const v of due.slice(0, Math.max(0, limit - styles))) {
      const recipe = v.base.recipes[0]!;
      const classes = Object.keys((recipe.sizeRanges ?? {}) as Record<string, unknown>).sort();
      const cls =
        classes.length === 0 || classes.includes(v.base.materialClass) ? v.base.materialClass : classes[0]!;
      try {
        const material = await this.engine.referenceMaterial(cls);
        if (!material) throw new Error(`no reference material for ${cls}`);
        const thumbs = await this.engine.thumbnails(
          {
            recipe: recipe.recipe as unknown as StoredRecipe,
            options: v.options as Record<string, unknown>,
            sizes: {},
            material,
          },
          THUMBNAIL_PX,
        );
        const files: Rendered[] = [
          { kind: 'thumbnail_2d', body: thumbs.png2d, contentType: 'image/png', ext: 'png' },
          ...(thumbs.png3d
            ? [{ kind: 'thumbnail_3d' as const, body: thumbs.png3d, contentType: 'image/png', ext: 'png' }]
            : []),
          {
            kind: 'dieline_svg',
            body: Buffer.from(thumbs.svg, 'utf8'),
            contentType: 'image/svg+xml',
            ext: 'svg',
          },
        ];
        const rows: Prisma.StyleAssetCreateManyInput[] = [];
        for (const f of files) {
          const sha256 = createHash('sha256').update(f.body).digest();
          const storageKey = `style-assets/${v.base.code}/${v.code}/r${recipe.version}/${sha256.toString('hex').slice(0, 16)}-${f.kind}.${f.ext}`;
          await this.storage.put(storageKey, f.body, f.contentType);
          rows.push({
            baseId: v.baseId,
            variantId: v.id,
            kind: f.kind,
            storageKey,
            sha256: Uint8Array.from(sha256),
            contentType: f.contentType,
            recipeVersion: recipe.version,
            engineVersion: thumbs.engineVersion,
          });
        }
        await this.prisma.withTx(async (tx) => {
          await tx.styleAsset.deleteMany({ where: { variantId: v.id } });
          await tx.styleAsset.createMany({ data: rows });
        });
        rendered += 1;
      } catch (error) {
        this.logger.warn(`style assets of ${v.code}: ${(error as Error).message}`);
      }
    }
    return rendered;
  }

  /**
   * C0b (owner decision 2026-10-28, DECISIONS-STAGE-A §9.4a): the style's own flat dieline — the card's hover view and
   * the quick view's "แบบคลี่" (`dielineUrl`, the base's `dieline_svg` with no variant) — drawn by the vendored
   * `@getpack/dieline` engine (ADR-0010) from the approved recipe at its default size (the recipe's first variant,
   * `sizes: {}`) on the reference material of the base's material class (else the recipe's first class). A style the
   * engine cannot draw gets none (no hover); it is tried again with the next recipe version or engine bundle.
   */
  async renderStyleDielines(limit: number, engineVersion: string): Promise<number> {
    const bases = await this.prisma.styleBase.findMany({
      where: {
        status: 'active',
        hidden: false,
        variants: { some: { publishable: true, status: 'active' } },
        recipes: { some: { approvedAt: { not: null } } },
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        code: true,
        materialClass: true,
        assets: {
          where: { variantId: null, kind: 'dieline_svg' },
          select: { recipeVersion: true, engineVersion: true },
        },
        recipes: {
          where: { approvedAt: { not: null } },
          orderBy: { version: 'desc' },
          take: 1,
          select: { version: true, recipe: true, sizeRanges: true },
        },
      },
    });
    const due = bases.filter((b) => {
      const version = b.recipes[0]!.version;
      if (this.undrawable.get(b.code) === `${version}|${engineVersion}`) return false;
      return !b.assets.some((a) => a.recipeVersion === version && a.engineVersion === engineVersion);
    });
    let rendered = 0;
    for (const b of due.slice(0, limit)) {
      const recipe = b.recipes[0]!;
      const classes = Object.keys((recipe.sizeRanges ?? {}) as Record<string, unknown>).sort();
      const cls = classes.length === 0 || classes.includes(b.materialClass) ? b.materialClass : classes[0]!;
      try {
        const material = await this.engine.referenceMaterial(cls);
        if (!material) throw new Error(`no reference material for ${cls}`);
        const drawn = await this.engine.thumbnails(
          { recipe: recipe.recipe as unknown as StoredRecipe, options: {}, sizes: {}, material },
          THUMBNAIL_PX,
        );
        const body = Buffer.from(drawn.svg, 'utf8');
        const sha256 = createHash('sha256').update(body).digest();
        const storageKey = `style-assets/${b.code}/_style/r${recipe.version}/${sha256.toString('hex').slice(0, 16)}-dieline_svg.svg`;
        await this.storage.put(storageKey, body, 'image/svg+xml');
        await this.prisma.withTx(async (tx) => {
          await tx.styleAsset.deleteMany({ where: { baseId: b.id, variantId: null, kind: 'dieline_svg' } });
          await tx.styleAsset.create({
            data: {
              baseId: b.id,
              variantId: null,
              kind: 'dieline_svg',
              storageKey,
              sha256: Uint8Array.from(sha256),
              contentType: 'image/svg+xml',
              recipeVersion: recipe.version,
              engineVersion: drawn.engineVersion,
            },
          });
        });
        rendered += 1;
      } catch (error) {
        // Not drawable at its default size: no hover dieline; not retried until the recipe or the engine changes.
        this.undrawable.set(b.code, `${recipe.version}|${engineVersion}`);
        this.logger.warn(`style dieline of ${b.code}: ${(error as Error).message}`);
      }
    }
    return rendered;
  }

  /** Base code → `recipeVersion|engineVersion` the engine could not draw (kept in memory: a restart retries once). */
  private readonly undrawable = new Map<string, string>();

  /** A short-lived signed URL of a stored asset (the store shows thumbnails, D-245). */
  async url(asset: { storageKey: string; contentType: string; kind: string }): Promise<string> {
    return this.storage.presignGet(asset.storageKey, {
      expiresInSeconds: ASSET_URL_TTL_SECONDS,
      fileName: `${asset.kind}.${asset.contentType === 'image/svg+xml' ? 'svg' : 'png'}`,
      contentType: asset.contentType,
    });
  }
}
