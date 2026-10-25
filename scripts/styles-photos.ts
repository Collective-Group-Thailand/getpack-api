/**
 * `pnpm styles:photos <manifest.json> [--replace] [--confirm --as <staff e-mail>]` — gives the style library's bases
 * their photos (`public/media/styles/manifest.json`, D-426): uploads each file as the staff member (scanned like any
 * upload; the same bytes twice reuse the clean file) and sets `style_bases.photo_file_id` + `photo_meta`
 * `{ source, alt }`. The store shows the photo on the style's cards and every variant's before the engine's
 * thumbnails. A base that already has a photo is skipped unless `--replace`, which replaces only a photo of the
 * manifest's own `source` — a photograph the catalogue owner uploaded is never replaced by a render. Prints the plan
 * and writes nothing unless `--confirm`. `--as` needs `catalog.manage`.
 *
 * Manifest entry: `{ "code", "file", "altTh", "altEn"?, "source", "prompt"? }`.
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
import { PermissionResolver } from '../src/modules/iam/permission-resolver.service';
import { FileProcessingJobs } from '../src/platform/files/file-processing.jobs';
import { FilesService } from '../src/platform/files/files.service';

config({ quiet: true });

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export interface StylePhotoAsset {
  code: string;
  file: string;
  altTh: string;
  altEn?: string;
  source: string;
  prompt?: string;
}

interface Planned {
  asset: StylePhotoAsset;
  baseId: bigint;
  mimeType: string;
  body: Buffer;
  sha256: string;
  replacing: boolean;
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

async function main(): Promise<void> {
  const opts = options(process.argv.slice(2));
  if (!opts.manifest || (opts.confirm && !opts.as)) {
    console.error('usage: styles:photos <manifest.json> [--replace] [--confirm --as <staff e-mail>]');
    process.exit(2);
  }
  const manifestPath = resolve(opts.manifest);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { assets?: StylePhotoAsset[] };
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const planned: Planned[] = [];
    const skipped: string[] = [];
    for (const asset of manifest.assets ?? []) {
      if (!asset.code || !asset.file || !asset.altTh || !asset.source)
        throw new Error(`${asset.code ?? asset.file}: code, file, altTh and source are required`);
      const base = await prisma.styleBase.findUnique({ where: { code: asset.code } });
      if (!base) {
        skipped.push(`${asset.code}: not in the style library`);
        continue;
      }
      const current = (base.photoMeta ?? null) as { source?: unknown } | null;
      if (base.photoFileId && !opts.replace) {
        skipped.push(`${asset.code}: already has a photo (add --replace)`);
        continue;
      }
      if (base.photoFileId && current?.source !== asset.source) {
        skipped.push(`${asset.code}: its photo is not ${asset.source} — left alone`);
        continue;
      }
      const path = resolve(dirname(manifestPath), asset.file);
      const mimeType = MIME[extname(path).toLowerCase()];
      if (!mimeType) throw new Error(`${asset.code}: ${asset.file} is not an image`);
      if (!existsSync(path)) {
        skipped.push(`${asset.code}: ${asset.file} not generated yet`);
        continue;
      }
      const body = readFileSync(path);
      planned.push({
        asset,
        baseId: base.id,
        mimeType,
        body,
        sha256: createHash('sha256').update(body).digest('hex'),
        replacing: Boolean(base.photoFileId),
      });
    }
    for (const p of planned)
      console.log(`${p.asset.code.padEnd(12)} ← ${p.asset.file}${p.replacing ? ' (replaces)' : ''}`);
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

    for (const p of planned) {
      await prisma.styleBase.update({
        where: { id: p.baseId },
        data: {
          photoFileId: fileIds.get(p.sha256)!,
          photoMeta: {
            source: p.asset.source,
            alt: { th: p.asset.altTh, ...(p.asset.altEn ? { en: p.asset.altEn } : {}) },
            ...(p.asset.prompt ? { prompt: p.asset.prompt } : {}),
          },
          updatedById: actor.userId,
        },
      });
    }
    console.log(`placed ${planned.length} photo(s), ${fileIds.size} file(s)`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
