import { join } from 'node:path';

import { AUDIENCES, SURFACES } from '@modules/surfaces/surfaces';
import { type INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  getSchemaPath,
  type OpenAPIObject,
  type OperationObject,
  type ParameterObject,
  type ReferenceObject,
  type ResponseObject,
  SwaggerModule,
} from '@nestjs/swagger';

import { ERROR_CODES, type ErrorCode } from '../errors/error-codes';
import { ProblemDetails, ProblemFieldError } from '../errors/problem-details.dto';
import {
  type HeaderName,
  HEADERS,
  type ParameterName,
  PARAMETERS,
  problemExampleName,
  problemExamples,
  RESPONSE_HEADER_NAMES,
} from './components';
import { EXT } from './decorators';
import { API_TAGS } from './tags';

export const OPENAPI_VERSION = '3.1.0';
const I18N_DIR = join(__dirname, '..', '..', 'i18n');
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'] as const;

const AUDIENCE_DESCRIPTIONS: Record<(typeof AUDIENCES)[number], string> = {
  customer: 'Access token with `aud=customer` — `/v1/store/*`',
  staff: 'Access token with `aud=staff` — `/v1/admin/*`',
  partner: 'Access token with `aud=partner` — `/v1/partner/*` (users and client-credentials)',
  b2b: 'Access token with `aud=b2b` — `/v1/b2b/*` (company API clients, client-credentials, D-291)',
};

const INFO_DESCRIPTION = `Packio — Your Packaging Production Partner, operated by Collective Group (Thailand).
Rules: \`docs/contract/api-conventions.md\` (shared with packio-web).

- **Surfaces:** \`/v1/auth\`, \`/v1/store\` (customer), \`/v1/admin\` (staff), \`/v1/partner\` (factories), \`/v1/b2b\` (company API clients, D-291), \`/webhooks\`. A token is accepted only on its own audience's prefix.
- **Money:** decimal strings with exactly 2 decimals (\`"1234.50"\`) plus \`currency: "THB"\` on the object; never JSON numbers. Clients never compute prices.
- **Dates:** ISO 8601 with offset, rendered in \`Asia/Bangkok\` (\`2026-09-22T14:05:00+07:00\`); date-only fields \`YYYY-MM-DD\`.
- **IDs:** uuid only; business keys (\`orderCode\`) are separate fields.
- **Errors:** RFC 9457 \`application/problem+json\` with a stable \`code\`; \`title\`/\`detail\` localised by \`Accept-Language\` (\`th\` default, \`en\`).
- **Lists:** \`?page&perPage(≤100)&sort&order&q\` → \`{ data, meta: { page, perPage, total } }\`; feeds use \`?cursor&limit\` → \`{ data, meta: { nextCursor } }\`.
- **Idempotency:** irreversible POSTs require \`Idempotency-Key\` (uuid); replays within 24 h return the original response.
- **Concurrency:** editable resources return \`ETag\`; updates send \`If-Match\` (412 \`concurrency.stale\`).
- **Files:** presign → PUT to the returned URL → reference the \`fileId\`.`;

/** Environments; real hosts are an open question (docs/PROGRESS.md) — `.invalid` is a reserved TLD. */
const SERVERS: { url: string; description: string; host?: string }[] = [
  { url: 'http://localhost:3000', description: 'Local development (docker compose + pnpm dev)' },
  { url: 'https://{host}', description: 'Integration', host: 'integration.packio.invalid' },
  { url: 'https://{host}', description: 'Sandbox', host: 'sandbox.packio.invalid' },
  { url: 'https://{host}', description: 'Production', host: 'api.packio.invalid' },
];

/** Builds the OpenAPI document served at `/docs*` and written to `contract/openapi.json`. */
export function buildOpenApiDocument(app: INestApplication, version: string): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setOpenAPIVersion(OPENAPI_VERSION)
    .setTitle('Packio API')
    .setDescription(INFO_DESCRIPTION)
    .setVersion(version);
  for (const server of SERVERS) {
    builder.addServer(
      server.url,
      server.description,
      server.host
        ? { host: { default: server.host, description: `${server.description} host (to be confirmed)` } }
        : undefined,
    );
  }
  for (const audience of AUDIENCES) {
    builder.addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: AUDIENCE_DESCRIPTIONS[audience] },
      audience,
    );
  }

  const document = SwaggerModule.createDocument(app, builder.build(), {
    extraModels: [ProblemDetails, ProblemFieldError],
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
  });
  const enriched = pruneUnusedComponents(enrichDocument(document));
  enriched.tags = usedTags(enriched);
  return normaliseDocument(enriched);
}

const ref = (kind: 'parameters' | 'headers' | 'examples', name: string): ReferenceObject => ({
  $ref: `#/components/${kind}/${name}`,
});

/** Collects the values of every `x-packio-<base>-*` extension on an operation. */
function collect<T>(operation: Record<string, unknown>, base: string): { source: string; values: T[] }[] {
  return Object.keys(operation)
    .filter((key) => key.startsWith(`${base}-`))
    .map((key) => ({ source: key.slice(base.length + 1), values: operation[key] as T[] }));
}

/**
 * Turns the `x-packio-*` intents recorded by the documentation decorators into shared-component
 * references: problem responses per status with per-code examples, parameters, response headers,
 * explicit `security: []` for public operations, and rate-limit documentation.
 */
export function enrichDocument(document: OpenAPIObject): OpenAPIObject {
  document.components = {
    ...document.components,
    examples: problemExamples(I18N_DIR),
    parameters: PARAMETERS,
    headers: HEADERS,
  };

  for (const item of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = item[method] as (OperationObject & Record<string, unknown>) | undefined;
      if (!operation) continue;

      const errors = new Set(collect<ErrorCode>(operation, EXT.errors).flatMap((c) => c.values));
      const parameters = new Set(collect<ParameterName>(operation, EXT.parameters).flatMap((c) => c.values));
      const successHeaders = collect<HeaderName>(operation, EXT.successHeaders);
      const isPublic = operation[EXT.public] === true;
      const optionalAudience = operation[EXT.optionalAuth] as string | undefined;
      const throttled = operation[EXT.unthrottled] !== true;
      for (const key of Object.keys(operation)) if (key.startsWith('x-packio-')) delete operation[key];

      if (isPublic) operation.security = [];
      if (optionalAudience) operation.security = [{}, { [optionalAudience]: [] }];
      if (throttled) errors.add('http.too_many_requests');

      operation.parameters = [
        ...(operation.parameters ?? []),
        ...[...parameters].map((name) => ref('parameters', name)),
        ref('parameters', 'AcceptLanguage'),
      ] as (ParameterObject | ReferenceObject)[];

      addProblemResponses(operation, [...errors]);

      for (const [status, response] of Object.entries(operation.responses)) {
        const headers: Record<string, ReferenceObject> = { 'X-Request-Id': ref('headers', 'XRequestId') };
        if (status.startsWith('2')) {
          for (const { source, values } of successHeaders) {
            if (source.startsWith('status') && source !== `status${status}`) continue;
            for (const name of values) headers[RESPONSE_HEADER_NAMES[name]] = ref('headers', name);
          }
          if (throttled) {
            for (const name of ['RateLimitLimit', 'RateLimitRemaining', 'RateLimitReset'] as const) {
              headers[RESPONSE_HEADER_NAMES[name]] = ref('headers', name);
            }
          }
        }
        if (status === '429') headers['Retry-After'] = ref('headers', 'RetryAfter');
        const target = response as ResponseObject;
        target.headers = { ...target.headers, ...headers };
      }
    }
  }
  return document;
}

/**
 * Drops shared examples, parameters and headers that no operation references, so the contract
 * only contains what is used (shared components still appear exactly once when used).
 */
export function pruneUnusedComponents(document: OpenAPIObject): OpenAPIObject {
  const json = JSON.stringify({
    ...document,
    components: { ...document.components, examples: {}, parameters: {}, headers: {} },
  });
  const components = document.components ?? {};
  for (const kind of ['examples', 'parameters', 'headers'] as const) {
    const entries = Object.entries(components[kind] ?? {}).filter(([name]) =>
      json.includes(`"#/components/${kind}/${name}"`),
    );
    if (entries.length > 0) components[kind] = Object.fromEntries(entries);
    else delete components[kind];
  }
  return document;
}

function addProblemResponses(operation: OperationObject, codes: ErrorCode[]): void {
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of codes)
    byStatus.set(ERROR_CODES[code], [...(byStatus.get(ERROR_CODES[code]) ?? []), code]);

  for (const [status, statusCodes] of byStatus) {
    const sorted = [...statusCodes].sort();
    operation.responses[String(status)] = {
      description: `Problem: ${sorted.map((code) => `\`${code}\``).join(', ')}`,
      content: {
        'application/problem+json': {
          schema: { $ref: getSchemaPath(ProblemDetails) },
          examples: Object.fromEntries(
            sorted.map((code) => [code, ref('examples', problemExampleName(code))]),
          ),
        },
      },
    };
  }
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
 * Fast checks at build time (the full gate is `pnpm contract:lint`, Spectral): every enum is a
 * named component; every operation tag is surface-prefixed and registered with a description.
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

  // A component that references itself is how a DTO and an enum sharing one name surface (the enum's
  // values are lost); the contract has no recursive schema, so any self-reference is a defect.
  for (const [name, schema] of Object.entries(document.components?.schemas ?? {})) {
    if (JSON.stringify(schema).includes(`"#/components/schemas/${name}"`))
      problems.push(`schema ${name} references itself: an enum and a DTO probably share the name`);
  }

  for (const [route, item] of Object.entries(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (!operation) continue;
      const tags = operation.tags ?? [];
      if (tags.length === 0 || tags.some((tag) => !allowedPrefixes.some((p) => tag.startsWith(p)))) {
        problems.push(
          `${method.toUpperCase()} ${route}: tags must be prefixed by a surface (${allowedPrefixes.join(', ')})`,
        );
      }
      for (const tag of tags) {
        if (!API_TAGS[tag])
          problems.push(`${method.toUpperCase()} ${route}: tag "${tag}" is not in API_TAGS`);
      }
    }
  }
  return problems;
}

/** The tags used by operations, with their registered descriptions (sorted). */
export function usedTags(document: OpenAPIObject): { name: string; description: string }[] {
  const names = new Set<string>();
  for (const item of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) for (const tag of item[method]?.tags ?? []) names.add(tag);
  }
  return [...names].sort().map((name) => ({ name, description: API_TAGS[name] ?? '' }));
}
