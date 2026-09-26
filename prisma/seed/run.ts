/**
 * Seed runner: `node dist/prisma/seed/run.js reference|dev` (package scripts `db:seed`, `db:seed:dev`).
 * The reference seed takes the issuing entity from SEED_ENTITY_* variables (D-092: company data is
 * never hard-coded); the dev seed uses an obviously fake entity and refuses to run in production.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';

import { PrismaClient } from '../../src/generated/prisma/client';
import { seedDevFolding } from './dev-folding';
import { seedDev } from './dev-seed';
import { type EntitySeedInput, seedReference } from './reference-seed';

config({ quiet: true });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required (see .env.example)`);
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function entityFromEnv(): EntitySeedInput {
  return {
    code: required('SEED_ENTITY_CODE'),
    displayName: required('SEED_ENTITY_DISPLAY_NAME'),
    legalNameTh: optional('SEED_ENTITY_LEGAL_NAME_TH'),
    legalNameEn: optional('SEED_ENTITY_LEGAL_NAME_EN'),
    taxId: optional('SEED_ENTITY_TAX_ID'),
    branchCode: optional('SEED_ENTITY_BRANCH_CODE'),
    addressTh: optional('SEED_ENTITY_ADDRESS_TH'),
    phone: optional('SEED_ENTITY_PHONE'),
  };
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== 'reference' && mode !== 'dev') throw new Error('usage: run.js reference|dev');
  if (mode === 'dev' && process.env.NODE_ENV === 'production') {
    throw new Error('the dev seed never runs in production');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: required('DATABASE_URL') }) });
  try {
    const report =
      mode === 'dev'
        ? await seedDev(prisma, optional('DEV_SEED_PASSWORD'))
        : await seedReference(prisma, entityFromEnv());
    if (mode === 'dev') {
      // A fake folding factory so `pnpm dev` can price a folding box (B2.3).
      const folding = await prisma.$transaction((tx) => seedDevFolding(tx), { timeout: 60_000 });
      if (folding.created) report['dev_folding_factory'] = 1;
    }
    const created = Object.entries(report)
      .map(([what, n]) => `${what}=${n}`)
      .join(' ');
    console.log(`seed ${mode}: ${created || 'nothing to create (already seeded)'}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`seed failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
