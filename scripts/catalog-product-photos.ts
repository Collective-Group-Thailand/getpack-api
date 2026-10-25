/**
 * `pnpm catalog:product-photos <manifest.json> [--replace] [--confirm --as <staff e-mail>]` — places the photos of a
 * media manifest (`public/media/products/manifest.json`, `public/media/stock/manifest.json`) on the catalogue: uploads
 * each file as the staff member (scanned like any upload; the same bytes twice reuse the clean file) and adds it as the
 * first image of the product it names (`slug` → `catalog_product_images`) or of each stock product it names (`skus` →
 * `stock_product_images`; sizes of one look share a photo), D-426. One that already has an image is skipped unless `--replace`, which
 * drops the images the manifest's `source` matches (`ai-render`, say) and leaves photos of other sources alone — a
 * real photograph uploaded by the catalogue owner is never replaced by a render. Prints the plan and writes nothing
 * unless `--confirm`. `--as` needs `catalog.manage`.
 *
 * Manifest entry: `{ "slug" | "skus", "file", "altTh", "altEn"?, "source", "prompt"? }` — `source` is `ai-render` for an
 * AI-rendered reference photo (the storefront says so), `getpack` for getpack's own photograph; `prompt` keeps the
 * render prompt with the image so the same look can be regenerated. Idempotent: run again after adding a product.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { config } from 'dotenv';

import { AppModule } from '../src/app.module';
import { type UserActor } from '../src/common/context/actor';
import { bytes } from '../src/common/crypto/hashing';
import { PrismaService } from '../src/database/prisma.service';
import { jsonField } from '../src/modules/catalog/crud/compact';
import { PermissionResolver } from '../src/modules/iam/permission-resolver.service';
import { AuditService } from '../src/platform/audit/audit.service';
import { DomainEvents } from '../src/platform/domain-events/domain-events.service';
import { FileProcessingJobs } from '../src/platform/files/file-processing.jobs';
import { FilesService } from '../src/platform/files/files.service';

config({ quiet: true });

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/** What the storefront reads from `catalog_product_images.variant` for a photo placed by this script. */
export interface ProductPhotoVariant {
  kind: 'photo';
  source: string;
  alt: { th: string; en?: string };
  prompt?: string;
}

export interface ProductPhotoAsset {
  /** A catalogue product's slug… */
  slug?: string;
  /** …or the stock products (SKUs) the photo shows. */
  skus?: string[];
  file: string;
  altTh: string;
  altEn?: string;
  source: string;
  prompt?: string;
}

interface Planned {
  asset: ProductPhotoAsset;
  /** What gets the photo: `slug` or `SKU`. */
  label: string;
  kind: 'product' | 'stock';
  productId: bigint;
  path: string;
  mimeType: string;
  body: Buffer;
  sha256: string;
  /** Images of the same source already on the product (replaced with `--replace`). */
  replacing: { id: bigint }[];
}

function options(args: string[]) {
  const at = args.indexOf('--as');
  return {
    manifest: args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--as'),
    as: at >= 0 ? args[at + 1] : undefined,
    confirm: args.includes('--confirm'),
    replace: args.includes('--replace'),
  };
}

const variantOf = (asset: ProductPhotoAsset): ProductPhotoVariant => ({
  kind: 'photo',
  source: asset.source,
  alt: { th: asset.altTh, ...(asset.altEn ? { en: asset.altEn } : {}) },
  ...(asset.prompt ? { prompt: asset.prompt } : {}),
});

async function main(): Promise<void> {
  const opts = options(process.argv.slice(2));
  if (!opts.manifest || (opts.confirm && !opts.as)) {
    console.error(
      'usage: catalog:product-photos <manifest.json> [--replace] [--confirm --as <staff e-mail>]',
    );
    process.exit(2);
  }
  const manifestPath = resolve(opts.manifest);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { assets?: ProductPhotoAsset[] };
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const planned: Planned[] = [];
    const skipped: string[] = [];
    for (const asset of manifest.assets ?? []) {
      const name = asset.slug ?? asset.skus?.join(',') ?? asset.file;
      if ((!asset.slug && !asset.skus?.length) || !asset.file || !asset.altTh || !asset.source)
        throw new Error(`${name}: slug or skus, file, altTh and source are required`);
      const path = resolve(dirname(manifestPath), asset.file);
      const mimeType = MIME[extname(path).toLowerCase()];
      if (!existsSync(path) || !mimeType)
        throw new Error(`${name}: ${asset.file} is missing or not an image`);
      const body = readFileSync(path);
      const sha256 = createHash('sha256').update(body).digest('hex');

      const targets: {
        label: string;
        kind: Planned['kind'];
        id: bigint;
        images: { id: bigint; variant: unknown }[];
      }[] = [];
      if (asset.slug) {
        const product = await prisma.catalogProduct.findUnique({
          where: { slug: asset.slug },
          include: { images: true },
        });
        if (product)
          targets.push({ label: asset.slug, kind: 'product', id: product.id, images: product.images });
        else skipped.push(`${asset.slug}: not in the catalogue`);
      }
      for (const sku of asset.skus ?? []) {
        const stock = await prisma.stockProduct.findUnique({ where: { sku }, include: { images: true } });
        if (stock) targets.push({ label: sku, kind: 'stock', id: stock.id, images: stock.images });
        else skipped.push(`${sku}: no such stock product`);
      }
      for (const target of targets) {
        const sameSource = target.images.filter(
          (image) => (image.variant as Partial<ProductPhotoVariant> | null)?.source === asset.source,
        );
        if (target.images.length > 0 && !opts.replace) {
          skipped.push(`${target.label}: already has ${target.images.length} image(s) (add --replace)`);
          continue;
        }
        if (target.images.length > 0 && sameSource.length === 0) {
          skipped.push(`${target.label}: its images are not ${asset.source} — left alone`);
          continue;
        }
        planned.push({
          asset,
          label: target.label,
          kind: target.kind,
          productId: target.id,
          path,
          mimeType,
          body,
          sha256,
          replacing: sameSource.map((image) => ({ id: image.id })),
        });
      }
    }
    for (const p of planned)
      console.log(
        `${p.label.padEnd(30)} ← ${p.asset.file}${p.replacing.length ? ` (replaces ${p.replacing.length})` : ''}`,
      );
    for (const s of skipped) console.log(`skipped: ${s}`);
    if (!opts.confirm) {
      console.log(`dry run: ${planned.length} photo(s), nothing written (add --confirm --as <e-mail>)`);
      return;
    }

    const user = await prisma.user.findFirst({ where: { email: opts.as, kind: 'staff', status: 'active' } });
    if (!user) throw new Error(`no active staff user ${opts.as}`);
    if (!(await app.get(PermissionResolver).forUser(user.id)).permissions.has('catalog.manage'))
      throw new Error(`${opts.as} lacks catalog.manage`);
    const actor: UserActor = {
      type: 'user',
      userId: user.id,
      publicId: user.publicId,
      audience: 'staff',
      scopes: [],
    };

    // One file per distinct photo: the same bytes already uploaded and clean are reused.
    const files = app.get(FilesService);
    const scans = app.get(FileProcessingJobs);
    const fileIds = new Map<string, bigint>();
    for (const p of planned) {
      if (fileIds.has(p.sha256)) continue;
      const existing = await prisma.fileObject.findFirst({
        where: {
          sha256: bytes(Buffer.from(p.sha256, 'hex')),
          mimeType: p.mimeType,
          uploadStatus: 'uploaded',
          scanStatus: 'clean',
          purgedAt: null,
        },
      });
      if (existing) {
        fileIds.set(p.sha256, existing.id);
        continue;
      }
      const stored = await files.storeImported(actor, {
        body: p.body,
        fileName: p.asset.file,
        mimeType: p.mimeType,
        retentionClass: 'standard',
        purpose: 'image',
      });
      await scans.processOne(stored);
      const scanned = await prisma.fileObject.findUniqueOrThrow({ where: { id: stored.id } });
      if (scanned.scanStatus === 'infected') throw new Error(`${p.asset.file} failed the malware scan`);
      if (scanned.scanStatus !== 'clean')
        console.log(`${p.asset.file}: scan ${scanned.scanStatus} — served once clean`);
      fileIds.set(p.sha256, stored.id);
    }

    const audit = app.get(AuditService);
    const events = app.get(DomainEvents);
    let placed = 0;
    for (const p of planned) {
      const image = {
        fileObjectId: fileIds.get(p.sha256)!,
        variant: jsonField(variantOf(p.asset) as unknown as Record<string, unknown>),
        sort: 0,
        createdById: actor.userId,
      };
      const replacing = { id: { in: p.replacing.map((r) => r.id) } };
      // The photo leads; whatever else the product shows follows it.
      await prisma.withTx(async (tx) => {
        if (p.kind === 'product') {
          if (p.replacing.length) await tx.catalogProductImage.deleteMany({ where: replacing });
          await tx.catalogProductImage.updateMany({
            where: { catalogProductId: p.productId },
            data: { sort: { increment: 1 } },
          });
          await tx.catalogProductImage.create({ data: { ...image, catalogProductId: p.productId } });
        } else {
          if (p.replacing.length) await tx.stockProductImage.deleteMany({ where: replacing });
          await tx.stockProductImage.updateMany({
            where: { stockProductId: p.productId },
            data: { sort: { increment: 1 } },
          });
          await tx.stockProductImage.create({ data: { ...image, stockProductId: p.productId } });
          // As an admin upload does: the ETag moves, the change is audited and announced (store caches drop it).
          const stock = await tx.stockProduct.update({
            where: { id: p.productId },
            data: { updatedById: actor.userId, rowVersion: { increment: 1 } },
          });
          await audit.record(tx, {
            category: 'config',
            action: 'catalog.stock_product_updated',
            resourceType: 'stock_product',
            resourcePublicId: stock.publicId,
            data: { fields: ['images'] },
          });
          await events.record(tx, {
            type: 'catalog.stock_product.updated',
            aggregateType: 'stock_product',
            aggregateId: stock.publicId,
            payload: { id: stock.publicId, fields: ['images'] },
          });
        }
      });
      placed += 1;
    }
    console.log(`placed ${placed} photo(s), ${fileIds.size} file(s)`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
