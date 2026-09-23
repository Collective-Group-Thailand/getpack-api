import { AUDIENCES, SURFACES } from '@modules/surfaces/surfaces';
import { type INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

import { ProblemDetails, ProblemFieldError } from '../errors/problem-details.dto';
import { CursorMeta, PageMeta } from '../pagination/pagination.dto';

export const OPENAPI_VERSION = '3.1.0';

const AUDIENCE_DESCRIPTIONS: Record<(typeof AUDIENCES)[number], string> = {
  customer: 'Access token with `aud=customer` — `/v1/store/*`',
  staff: 'Access token with `aud=staff` — `/v1/admin/*`',
  partner: 'Access token with `aud=partner` — `/v1/partner/*` (users and client-credentials)',
};

/** Builds the OpenAPI document served at `/docs` and written to `contract/openapi.json`. */
export function buildOpenApiDocument(app: INestApplication, version: string): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setOpenAPIVersion(OPENAPI_VERSION)
    .setTitle('Packio API')
    .setDescription(
      'Packio — Your Packaging Production Partner (Collective Group (Thailand)). ' +
        'Conventions: docs/contract/api-conventions.md. Errors are RFC 9457 problem details.',
    )
    .setVersion(version);
  for (const audience of AUDIENCES) {
    builder.addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: AUDIENCE_DESCRIPTIONS[audience] },
      audience,
    );
  }

  const document = SwaggerModule.createDocument(app, builder.build(), {
    extraModels: [ProblemDetails, ProblemFieldError, PageMeta, CursorMeta],
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
  });
  return normaliseDocument(document);
}

/** Sorts object keys recursively (arrays keep their order) so the output is byte-for-byte stable. */
export function normaliseDocument<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item: unknown) => normaliseDocument(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normaliseDocument((value as Record<string, unknown>)[key])]),
    ) as T;
  }
  return value;
}

/**
 * Contract rules that the generator cannot enforce by itself (contract §2–§3):
 * every enum is a named component, and every operation tag is prefixed by a surface (or `ops.`).
 */
export function contractViolations(document: OpenAPIObject): string[] {
  const problems: string[] = [];
  const allowedPrefixes = [...Object.values(SURFACES), 'ops'].map((p) => `${p}.`);

  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, `${path}[${index}]`));
      return;
    }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const isComponentSchema = /^#\/components\/schemas\/[^/]+$/.test(path);
    if (Array.isArray(record.enum) && !isComponentSchema) {
      problems.push(`inline enum at ${path}: declare it with enumName so it becomes a named component`);
    }
    for (const [key, child] of Object.entries(record)) walk(child, `${path}/${key}`);
  };
  walk(document, '#');

  for (const [route, item] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(item as Record<string, { tags?: string[] }>)) {
      const tags = operation?.tags ?? [];
      if (typeof operation !== 'object' || !('responses' in operation)) continue;
      if (tags.length === 0 || tags.some((tag) => !allowedPrefixes.some((p) => tag.startsWith(p)))) {
        problems.push(
          `${method.toUpperCase()} ${route}: tags must be prefixed by a surface (${allowedPrefixes.join(', ')})`,
        );
      }
    }
  }
  return problems;
}
