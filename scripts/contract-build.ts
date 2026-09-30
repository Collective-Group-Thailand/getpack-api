/**
 * `pnpm contract:build` — boots the HTTP app with fake integrations (no listening, no database or
 * Redis connection: both connect lazily) and writes a deterministic `contract/openapi.json`.
 * Fails when the document breaks a contract rule (unnamed enum, tag without surface prefix, two
 * DTO classes published under one component name).
 */
// Must stay the first import: it records DTO classes as their modules load.
import '../src/common/openapi/schema-classes.track';

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { APP_VERSION, configureApp } from '../src/bootstrap';
import { buildOpenApiDocument, contractViolations } from '../src/common/openapi/openapi.document';
import { duplicateSchemaClasses } from '../src/common/openapi/schema-classes';

const CONTRACT_ENV = {
  NODE_ENV: 'test',
  INTEGRATIONS_MODE: 'fake',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://contract:contract@127.0.0.1:1/contract',
  REDIS_URL: 'redis://127.0.0.1:1',
  S3_BUCKET: 'contract',
  DOCS_ENABLED: 'false',
};

async function main(): Promise<void> {
  Object.assign(process.env, CONTRACT_ENV);
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  configureApp(app);
  const document = buildOpenApiDocument(app, APP_VERSION);
  await app.close();

  const problems = [...contractViolations(document), ...duplicateSchemaClasses(document)];
  if (problems.length > 0) {
    console.error(`Contract violations:\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }

  const outDir = join(__dirname, '..', '..', 'contract');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'openapi.json'), `${JSON.stringify(document, null, 2)}\n`);
  console.log(`contract/openapi.json written (${Object.keys(document.paths).length} paths)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
