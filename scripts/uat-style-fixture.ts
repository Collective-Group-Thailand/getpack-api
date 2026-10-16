/**
 * `pnpm uat:styles [--confirm]` — **UAT only**: imports the style master and the engine recipes, passes the people
 * gates with the UAT fixture accounts and publishes the library (`prisma/seed/uat/uat-styles.ts`, D-407). `uat:populate`
 * runs the same step. Refuses a database whose name does not contain `uat`, and writes nothing without `--confirm`.
 */
import { NestFactory } from '@nestjs/core';
import { config } from 'dotenv';

import { publishUatStyles } from '../prisma/seed/uat/uat-styles';
import { AppModule } from '../src/app.module';
import { databaseName, isUatDatabase } from './uat-guard';

config({ quiet: true });

async function main(): Promise<void> {
  if (!isUatDatabase(process.env.DATABASE_URL)) {
    console.error(
      `uat:styles: refused — not a UAT database (${databaseName(process.env.DATABASE_URL) ?? 'none'})`,
    );
    process.exit(2);
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const result = await publishUatStyles(app, { confirm: process.argv.includes('--confirm') });
    for (const line of result.log) console.log(line);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
