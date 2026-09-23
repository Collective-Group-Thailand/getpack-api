import { applyDecorators, type Type } from '@nestjs/common';
import { ApiExtension, ApiExtraModels, ApiOperation, ApiResponse, getSchemaPath } from '@nestjs/swagger';

import { type ErrorCode } from '../errors/error-codes';
import { type HeaderName, type ParameterName } from './components';

/**
 * Documentation decorators every module uses (contract §5). They record intent in `x-packio-*`
 * extensions; `enrichDocument()` (openapi.document.ts) turns those into responses, headers and
 * parameters that reference the shared components, merging what several decorators contribute
 * (e.g. 422 from validation and from idempotency) instead of overwriting it.
 */
export const EXT = {
  errors: 'x-packio-errors',
  parameters: 'x-packio-parameters',
  successHeaders: 'x-packio-success-headers',
  public: 'x-packio-public',
  unthrottled: 'x-packio-unthrottled',
} as const;

/** Each contributing decorator writes its own extension key, so contributions never overwrite each other. */
const ext = (base: string, source: string, value: unknown) => ApiExtension(`${base}-${source}`, value);

export const OPERATION_ID_PATTERN =
  /^(auth|store|admin|partner|webhooks|ops)\.[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/;
const REFERENCE_PATTERN = /^(D-\d{3}|ADR-\d{4})$/;

export interface ApiEndpointOptions {
  /** `<surface>.<resource>.<action>`, e.g. `admin.orders.approveSlip`. Stable: the frontend imports it. */
  id: string;
  /** One line, imperative. */
  summary: string;
  /** The business rule in plain words. */
  description: string;
  /** Decision ids (`D-052`) — or ADR ids for platform endpoints — this operation implements. */
  implements: string[];
}

/** Operation id, summary and a description that cites the decisions it implements. */
export function ApiEndpoint(options: ApiEndpointOptions) {
  if (!OPERATION_ID_PATTERN.test(options.id)) {
    throw new Error(`ApiEndpoint: operation id "${options.id}" must match ${String(OPERATION_ID_PATTERN)}`);
  }
  if (options.implements.length === 0 || !options.implements.every((ref) => REFERENCE_PATTERN.test(ref))) {
    throw new Error(`ApiEndpoint(${options.id}): implements must list D-### or ADR-#### ids`);
  }
  return ApiOperation({
    operationId: options.id,
    summary: options.summary,
    description: `${options.description}\n\nImplements: ${options.implements.join(', ')}.`,
  });
}

export interface ApiSuccessOptions {
  description: string;
  /** Response DTO; omit for 202/204 or when `schema` is given. */
  type?: Type<unknown> | [Type<unknown>];
  schema?: Record<string, unknown>;
  /** Required for every body-carrying response (contract §5). */
  example?: unknown;
  headers?: HeaderName[];
}

/** A success response with its schema and example. */
export function ApiSuccess(status: 200 | 201 | 202 | 204, options: ApiSuccessOptions) {
  const decorators = [];
  let schema: Record<string, unknown> | undefined = options.schema;
  if (options.type) {
    const model = Array.isArray(options.type) ? options.type[0] : options.type;
    decorators.push(ApiExtraModels(model));
    schema = Array.isArray(options.type)
      ? { type: 'array', items: { $ref: getSchemaPath(model) } }
      : { $ref: getSchemaPath(model) };
  }
  decorators.push(
    ApiResponse({
      status,
      description: options.description,
      ...(schema ? { content: { 'application/json': { schema, example: options.example } } } : {}),
    }),
  );
  if (options.headers?.length) decorators.push(ext(EXT.successHeaders, `status${status}`, options.headers));
  return applyDecorators(...decorators);
}

/**
 * The problem responses this operation can actually return, as `application/problem+json` with
 * the shared per-code examples. `500 internal.unexpected` is always included.
 */
export function ApiStandardErrors(...codes: ErrorCode[]) {
  return ext(EXT.errors, 'standard', [...new Set<ErrorCode>([...codes, 'internal.unexpected'])]);
}

/** Irreversible POST protected by `Idempotency-Key` (contract §3); use through `@Idempotent()`. */
export function ApiIdempotent() {
  return applyDecorators(
    ext(EXT.parameters, 'idempotency', ['IdempotencyKey'] satisfies ParameterName[]),
    ext(EXT.errors, 'idempotency', [
      'idempotency.key_required',
      'idempotency.key_invalid',
      'idempotency.in_progress',
      'idempotency.key_reused',
    ] satisfies ErrorCode[]),
    ext(EXT.successHeaders, 'idempotency', ['IdempotentReplayed'] satisfies HeaderName[]),
  );
}

/** Update guarded by `If-Match` / `ETag` (contract §3 "Concurrency"). */
export function ApiConcurrency() {
  return applyDecorators(
    ext(EXT.parameters, 'concurrency', ['IfMatch'] satisfies ParameterName[]),
    ext(EXT.errors, 'concurrency', [
      'concurrency.stale',
      'concurrency.precondition_required',
    ] satisfies ErrorCode[]),
    ext(EXT.successHeaders, 'concurrency', ['ETag'] satisfies HeaderName[]),
  );
}

/** Read endpoint that returns an `ETag` (pair with `@UseEtag`). */
export function ApiEtag() {
  return ext(EXT.successHeaders, 'etag', ['ETag'] satisfies HeaderName[]);
}

/** Operation without authentication: documented explicitly as `security: []`. */
export function ApiPublic() {
  return ApiExtension(EXT.public, true);
}

/** Operation excluded from rate limiting (pair with `@SkipThrottle()`): no 429 / rate-limit headers. */
export function ApiUnthrottled() {
  return ApiExtension(EXT.unthrottled, true);
}

/** Errors every secured surface operation can return (audience, permission, scope). */
export function ApiAuthErrors() {
  return ext(EXT.errors, 'auth', ['auth.unauthenticated', 'auth.forbidden'] satisfies ErrorCode[]);
}
