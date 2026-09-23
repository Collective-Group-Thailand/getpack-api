import { jsonBodyParser } from '@common/http/json-body-parser';
import { buildOpenApiDocument } from '@common/openapi/openapi.document';
import { createValidationPipe } from '@common/validation/validation';
import { AppConfig } from '@config/app-config';
import { type INestApplication, VersioningType } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { version } from '../package.json';

export const APP_VERSION: string = version;

/**
 * Everything that shapes the HTTP surface, shared by `main.ts`, the contract build and e2e tests,
 * so all three see exactly the same routes.
 */
export function configureApp(app: INestApplication): void {
  app.use(helmet());
  app.use(jsonBodyParser());
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();
}

/** Serves `/docs` (Swagger UI) and `/docs-json` when enabled (contract §2). */
export function setupDocs(app: INestApplication): void {
  if (!app.get(AppConfig).docsEnabled) return;
  const document = buildOpenApiDocument(app, APP_VERSION);
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json', raw: ['json'] });
}
