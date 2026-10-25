import { createHash } from 'node:crypto';

import { OBJECT_STORAGE, type ObjectStorage } from '@collective/integrations/storage';
import { PrismaService } from '@database/prisma.service';
import { type Prisma, type StyleAssetKind } from '@generated/prisma/client';
import {
  DIELINE_ENGINE,
  type DielineEngine,
  type StoredRecipe,
} from '@integrations/dieline/dieline-engine.port';
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
    let rendered = 0;
    for (const v of due.slice(0, limit)) {
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

  /** A short-lived signed URL of a stored asset (the store shows thumbnails, D-245). */
  async url(asset: { storageKey: string; contentType: string; kind: string }): Promise<string> {
    return this.storage.presignGet(asset.storageKey, {
      expiresInSeconds: ASSET_URL_TTL_SECONDS,
      fileName: `${asset.kind}.${asset.contentType === 'image/svg+xml' ? 'svg' : 'png'}`,
      contentType: asset.contentType,
    });
  }
}
