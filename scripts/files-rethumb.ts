/**
 * `pnpm files:rethumb [--confirm]` — re-makes the WebP thumbnail of every clean image the catalogue shows (catalogue
 * product, stock product and style photos; D-005 media) at the current `THUMBNAIL_WIDTH`, replacing the old one.
 * Run after the width changes; the storefront's cards (`store.catalog.getImage?size=thumb`) pick the new file up at
 * once. Prints the plan and writes nothing unless `--confirm`.
 */
import { NestFactory } from '@nestjs/core';
import { config } from 'dotenv';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { FileProcessingJobs, THUMBNAIL_WIDTH } from '../src/platform/files/file-processing.jobs';

config({ quiet: true });

async function main(): Promise<void> {
  const confirm = process.argv.includes('--confirm');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const files = await prisma.$queryRaw<{ id: bigint; width: number | null }[]>`
      SELECT fo.id, t.width_px AS width
        FROM file_objects fo
        LEFT JOIN file_objects t ON t.thumbnail_of_file_id = fo.id
       WHERE fo.upload_status = 'uploaded' AND fo.scan_status = 'clean' AND fo.purged_at IS NULL
         AND fo.mime_type LIKE 'image/%' AND fo.thumbnail_of_file_id IS NULL
         AND (EXISTS (SELECT 1 FROM catalog_product_images i WHERE i.file_object_id = fo.id)
           OR EXISTS (SELECT 1 FROM stock_product_images i WHERE i.file_object_id = fo.id)
           OR EXISTS (SELECT 1 FROM style_bases s WHERE s.photo_file_id = fo.id))
       ORDER BY fo.id`;
    const stale = files.filter((f) => f.width !== THUMBNAIL_WIDTH);
    console.log(
      `${files.length} catalogue image(s); ${stale.length} without a ${THUMBNAIL_WIDTH} px thumbnail`,
    );
    if (!confirm) {
      console.log('dry run: nothing written (add --confirm)');
      return;
    }
    const jobs = app.get(FileProcessingJobs);
    let done = 0;
    for (const f of stale) {
      const file = await prisma.fileObject.findUniqueOrThrow({ where: { id: f.id } });
      await jobs.rethumbnail(file);
      done += 1;
      if (done % 25 === 0) console.log(`${done}/${stale.length}`);
    }
    console.log(`re-made ${done} thumbnail(s) at ${THUMBNAIL_WIDTH} px`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
