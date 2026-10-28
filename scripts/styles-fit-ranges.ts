/**
 * `pnpm styles:fit-ranges [--confirm]` (C0b, owner decision 2026-10-28, DECISIONS-STAGE-A §9.1) — fills every style's
 * empty inside fit range from its approved recipe's size range, through the curation service path
 * (`StylesAdminService.backfillFitRanges`, the same as `POST /v1/admin/styles/actions/backfill-fit-ranges`): audited per
 * style, source `recipe`, never over a business-entered range, idempotent. Without `--confirm` it only reports.
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
      `${confirm ? '' : '(dry run) '}${result.considered} styles with an approved recipe: ` +
        `${result.filled.length} filled, ${result.refreshed.length} refreshed, ${result.unchanged} unchanged, ` +
        `${result.keptBusiness.length} kept (business), ${result.noRecipeRange.length} without a complete recipe range`,
    );
    if (result.noRecipeRange.length > 0) console.log(`no complete range: ${result.noRecipeRange.join(' ')}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
