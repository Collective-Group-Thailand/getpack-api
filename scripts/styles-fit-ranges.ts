/**
 * `pnpm styles:fit-ranges [--confirm]` (C0b/C1c, owner decisions 2026-10-28, DECISIONS-STAGE-A §9.1, §11.1) — fills
 * every style's empty inside fit range, each bound from (a) its approved recipe's size range, (b) its standard sizes,
 * (c) the production envelope — C1e: read by each style's size class (bags width × gusset × height, cylinders diameter
 * square × height; labels, tags, sleeves, inserts and flat folders not applicable) — through the curation service path
 * (`StylesAdminService.backfillFitRanges`, the same as `POST /v1/admin/styles/actions/backfill-fit-ranges`): audited per
 * style, each bound's source recorded, never over a business-entered range, idempotent. Without `--confirm` it only
 * reports (with the list of styles it would change).
 *
 * C13 (D-461): the worker now runs this backfill by itself (job `styles.fit_ranges_sync`: worker start, hourly bundle
 * check, after imports / curation). With the fake engine (`INTEGRATIONS_MODE=fake`) or an unavailable one the ranges
 * come out partial (81/102 instead of 94/102): the script warns and refuses `--confirm` unless `--allow-fake`.
 */
import { NestFactory } from '@nestjs/core';
import { config } from 'dotenv';

import { AppModule } from '../src/app.module';
import { systemActor } from '../src/common/context/actor';
import { DIELINE_ENGINE, type DielineEngine } from '../src/integrations/dieline/dieline-engine.port';
import { checkFitRangeEngine, cliEngineGate } from '../src/modules/styles/fit-range-sync';
import { StylesAdminService } from '../src/modules/styles/styles-admin.service';

config({ quiet: true });

async function main(): Promise<void> {
  const confirm = process.argv.includes('--confirm');
  const allowFake = process.argv.includes('--allow-fake');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const engine = app.get<DielineEngine>(DIELINE_ENGINE);
    const gate = cliEngineGate(checkFitRangeEngine(await engine.identity()), { confirm, allowFake });
    if (gate.warning) console.warn(gate.warning);
    if (!gate.proceed) {
      process.exitCode = 2;
      return;
    }
    const result = await app
      .get(StylesAdminService)
      .backfillFitRanges(systemActor('styles:fit-ranges'), { dryRun: !confirm });
    console.log(
      `${confirm ? '' : '(dry run) '}${result.considered} active styles: ` +
        `${result.filled.length} filled, ${result.refreshed.length} refreshed, ${result.unchanged} unchanged, ` +
        `${result.cleared.length} cleared, ${result.classified.length} classified, ` +
        `${result.keptBusiness.length} kept (business), ${result.incomplete.length} without a complete range`,
    );
    // C1e (§13.2): the size search's coverage, without the styles it does not apply to.
    console.log(
      `coverage: ${result.coverage.withRange} of ${result.coverage.applicable} applicable styles have a range; ` +
        `size classes ${JSON.stringify(result.bySizeClass)}; not applicable (${result.notApplicable.length}): ` +
        result.notApplicable.join(' '),
    );
    console.log(
      `styles by source: ${JSON.stringify(result.bySource)}; bounds by source: ${JSON.stringify(result.boundsBySource)}`,
    );
    for (const c of result.changes)
      console.log(
        `  ${c.action} ${c.code} [${c.sizeClass}${c.source ? `, ${c.source}` : ''}] ${JSON.stringify(c.after)}`,
      );
    for (const i of result.incomplete)
      console.log(
        `  empty ${i.code}: missing ${i.missing.join(' ') || '—'}${i.conflicting.length ? `; no size in ${i.conflicting.join(' ')}` : ''}`,
      );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
