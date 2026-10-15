/**
 * `pnpm cms:home-photos <manifest.json> [--template <name>=<style code> …] [--publish] [--confirm --as <staff e-mail>]`
 * — places the photos of a media manifest (`public/media/home/manifest.json`) on the storefront home page: uploads
 * each file as the staff member (scanned like any upload; the same bytes twice reuse the clean file) and upserts the
 * `home-photos` home section, writing each photo to the slot its `position` names and keeping every other slot
 * (`src/modules/catalog/cms/home-photos.ts`). `template-<name>` positions need a style code: give it with
 * `styleCode` in the manifest or `--template <name>=PK-…`; one without is skipped, never guessed. Prints the plan and writes nothing unless
 * `--confirm`. A new section is created as a draft unless `--publish`; an existing one keeps its status unless
 * `--publish`. `--as` needs `cms.manage`.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { type UserActor } from '../src/common/context/actor';
import { bytes } from '../src/common/crypto/hashing';
import { PrismaService } from '../src/database/prisma.service';
import { homeSections } from '../src/modules/catalog/cms/cms.resources';
import {
  HOME_PHOTOS_SLUG,
  type HomePhotoSlot,
  type ManifestAsset,
  mergeHomePhotos,
  photoEntry,
  slotOf,
} from '../src/modules/catalog/cms/home-photos';
import { CatalogCrudService, rowEtag } from '../src/modules/catalog/crud/catalog-crud.service';
import { type CrudRow } from '../src/modules/catalog/crud/catalog-resource';
import { imageUrl } from '../src/modules/catalog/store/store-catalog.service';
import { PermissionResolver } from '../src/modules/iam/permission-resolver.service';
import { FileProcessingJobs } from '../src/platform/files/file-processing.jobs';
import { FilesService } from '../src/platform/files/files.service';

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

interface Planned {
  asset: ManifestAsset;
  slot: HomePhotoSlot;
  path: string;
  mimeType: string;
  body: Buffer;
  sha256: string;
}

const label = (slot: HomePhotoSlot): string =>
  slot.kind === 'mosaic'
    ? `mosaic[${slot.index}]`
    : slot.kind === 'process'
      ? `process.${slot.step}`
      : slot.kind === 'template'
        ? `templates.${slot.code}`
        : slot.kind === 'category'
          ? `categories.${slot.code}`
          : slot.kind;

function options(args: string[]) {
  const value = (flag: string) => {
    const at = args.indexOf(flag);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const templates: Record<string, string> = {};
  args.forEach((arg, i) => {
    if (arg !== '--template') return;
    const [name, code] = (args[i + 1] ?? '').split('=');
    if (name && code) templates[name] = code;
  });
  const flagged = new Set(['--as', '--template']);
  const manifest = args.find((a, i) => !a.startsWith('--') && !flagged.has(args[i - 1] ?? ''));
  return {
    manifest,
    templates,
    as: value('--as'),
    confirm: args.includes('--confirm'),
    publish: args.includes('--publish'),
  };
}

async function main(): Promise<void> {
  const opts = options(process.argv.slice(2));
  if (!opts.manifest || (opts.confirm && !opts.as)) {
    console.error(
      'usage: cms:home-photos <manifest.json> [--template <name>=<style code> …] [--publish] [--confirm --as <staff e-mail>]',
    );
    process.exit(2);
  }
  const manifestPath = resolve(opts.manifest);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { assets?: ManifestAsset[] };
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const planned: Planned[] = [];
    const skipped: string[] = [];
    for (const asset of manifest.assets ?? []) {
      // A template's style code: `--template` wins over the manifest's `styleCode`.
      const name = asset.position.replace(/^template-/, '');
      const slot = slotOf(asset.position, {
        ...(asset.styleCode ? { [name]: asset.styleCode } : {}),
        ...opts.templates,
      });
      if (!slot) {
        skipped.push(
          asset.position.startsWith('template-')
            ? `${asset.position}: no style code (add --template ${asset.position.slice(9)}=PK-…)`
            : `${asset.position}: not a place on the home page`,
        );
        continue;
      }
      if (
        slot.kind === 'category' &&
        !(await prisma.productCategory.findUnique({ where: { code: slot.code } }))
      ) {
        skipped.push(`${asset.position}: category ${slot.code} is not in the catalogue`);
        continue;
      }
      if (slot.kind === 'template' && !(await prisma.styleBase.findUnique({ where: { code: slot.code } }))) {
        skipped.push(`${asset.position}: style ${slot.code} is not in the style library`);
        continue;
      }
      const path = resolve(dirname(manifestPath), asset.file);
      const mimeType = MIME[extname(path).toLowerCase()];
      if (!existsSync(path) || !mimeType)
        throw new Error(`${asset.position}: ${asset.file} is missing or not an image`);
      photoEntry(asset, 'check'); // alt text is required — fail before anything is written
      const body = readFileSync(path);
      planned.push({
        asset,
        slot,
        path,
        mimeType,
        body,
        sha256: createHash('sha256').update(body).digest('hex'),
      });
    }
    for (const p of planned)
      console.log(`${p.asset.position.padEnd(18)} → ${label(p.slot).padEnd(20)} ${p.asset.file}`);
    for (const s of skipped) console.log(`skipped: ${s}`);
    if (!opts.confirm) {
      console.log('dry run: nothing written (add --confirm --as <e-mail>)');
      return;
    }

    const user = await prisma.user.findFirst({ where: { email: opts.as, kind: 'staff', status: 'active' } });
    if (!user) throw new Error(`no active staff user ${opts.as}`);
    if (!(await app.get(PermissionResolver).forUser(user.id)).permissions.has('cms.manage'))
      throw new Error(`${opts.as} lacks cms.manage`);
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
    const fileIds = new Map<string, string>();
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
        fileIds.set(p.sha256, existing.publicId);
        continue;
      }
      const stored = await files.storeImported(actor, {
        body: p.body,
        fileName: p.asset.file,
        mimeType: p.mimeType,
        retentionClass: 'standard',
      });
      await scans.processOne(stored);
      const scanned = await prisma.fileObject.findUniqueOrThrow({ where: { id: stored.id } });
      if (scanned.scanStatus === 'infected') throw new Error(`${p.asset.file} failed the malware scan`);
      if (scanned.scanStatus !== 'clean')
        console.log(`${p.asset.file}: scan ${scanned.scanStatus} — served once clean`);
      fileIds.set(p.sha256, stored.publicId);
    }

    const placed = planned.map((p) => ({
      slot: p.slot,
      photo: photoEntry(p.asset, imageUrl(fileIds.get(p.sha256))!),
    }));
    const crud = app.get(CatalogCrudService);
    const current = await prisma.homeSection.findFirst({
      where: { slug: HOME_PHOTOS_SLUG, deletedAt: null },
    });
    if (current && current.kind !== 'custom')
      throw new Error(`home section ${HOME_PHOTOS_SLUG} is not custom`);
    const row = current
      ? await (async () => {
          const before = (await crud.get(homeSections, current.publicId)) as CrudRow & { config: unknown };
          return crud.update(homeSections, actor, current.publicId, rowEtag(before), {
            config: mergeHomePhotos(before.config as Record<string, unknown>, placed),
            ...(opts.publish && { status: 'published' }),
          });
        })()
      : await crud.create(homeSections, actor, {
          slug: HOME_PHOTOS_SLUG,
          kind: 'custom',
          config: mergeHomePhotos({}, placed),
          status: opts.publish ? 'published' : 'draft',
        });
    const saved = row as CrudRow & { status: string };
    console.log(
      `home section ${HOME_PHOTOS_SLUG} ${current ? 'updated' : 'created'} (${saved.publicId}, ${saved.status}): ` +
        `${placed.length} photos, ${fileIds.size} files`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
