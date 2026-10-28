/**
 * `pnpm styles:fit-ranges [--confirm]` (C0b/C1c, owner decisions 2026-10-28, DECISIONS-STAGE-A §9.1, §11.1) — fills
 * every style's empty inside fit range, each bound from (a) its approved recipe's size range, (b) its standard sizes,
 * (c) the production envelope, through the curation service path
 * (`StylesAdminService.backfillFitRanges`, the same as `POST /v1/admin/styles/actions/backfill-fit-ranges`): audited per
 * style, each bound's source recorded, never over a business-entered range, idempotent. Without `--confirm` it only
 * reports (with the list of styles it would change).
 */
import { NestFactory } from '@nestjs/core';
import { config } from 'dotenv';

import { AppModule } from '../src/app.module';
import { systemActor } from '../src/common/context/actor';
import { StylesAdminService } from '../src/modules/styles/styles-admin.service';

config({ quiet: true });

async function main(): Promise<void> {
  const confirm = process.argv.includes('--confirm');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const result = await app
      .get(StylesAdminService)
      .backfillFitRanges(systemActor('styles:fit-ranges'), { dryRun: !confirm });
    console.log(
      `${confirm ? '' : '(dry run) '}${result.considered} active styles: ` +
        `${result.filled.length} filled, ${result.refreshed.length} refreshed, ${result.unchanged} unchanged, ` +
        `${result.keptBusiness.length} kept (business), ${result.incomplete.length} without a complete range`,
    );
    console.log(`styles by source: ${JSON.stringify(result.bySource)}; bounds by source: ${JSON.stringify(result.boundsBySource)}`);
    for (const c of result.changes)
      console.log(`  ${c.action} ${c.code} [${c.source}] ${JSON.stringify(c.after)}`);
    for (const i of result.incomplete)
      console.log(`  empty ${i.code}: missing ${i.missing.join(' ') || '—'}${i.conflicting.length ? `; no size in ${i.conflicting.join(' ')}` : ''}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
