import { type PrismaClient } from '../../src/generated/prisma/client';
import { seedDevAdvisory } from './dev-advisory';
import { seedDevCorrugate } from './dev-corrugate';
import { seedDevFolding } from './dev-folding';
import { seedDevFoldingB } from './dev-folding-b';
import { seedDevLabel } from './dev-label';
import { seedDevPouch } from './dev-pouch';
import { seedDevService } from './dev-service';
import { seedDevStandardProduct } from './dev-standard-product';
import { seedDevTagSleeve } from './dev-tag-sleeve';
import { type SeedReport } from './reference-seed';

/** The dev factories and their fake price lists for every calculator (run after `seedDev`). Idempotent. */
export async function seedDevPriceLists(prisma: PrismaClient, report: SeedReport): Promise<void> {
  const steps: [
    string,
    (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<{ created: boolean }>,
  ][] = [
    // A fake folding factory so `pnpm dev` can price a folding box (B2.3).
    ['dev_folding_factory', seedDevFolding],
    // A fake type-B folding factory, priced by engine B once `pricing.folding_engine_b` is on (U-B6 tail, D-233).
    ['dev_folding_b_factory', seedDevFoldingB],
    // Its corrugate, label, tag & sleeve, pouch, standard-product and service price lists (U-B6).
    ['dev_corrugate_price_list', seedDevCorrugate],
    ['dev_label_price_list', seedDevLabel],
    ['dev_tag_sleeve_price_list', seedDevTagSleeve],
    ['dev_pouch_price_list', seedDevPouch],
    ['dev_standard_product_price_list', seedDevStandardProduct],
    ['dev_service_price_list', seedDevService],
    // Structure Advisor rule-set proposal and fake board sheets (U2.2; the flag stays off).
    ['dev_advisory', seedDevAdvisory],
  ];
  for (const [what, seed] of steps) {
    const result = await prisma.$transaction((tx) => seed(tx), { timeout: 60_000 });
    if (result.created) report[what] = 1;
  }
}
