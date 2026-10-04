import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type ExampleObject, type HeaderObject, type ParameterObject } from '@nestjs/swagger';

import { ERROR_CODES, type ErrorCode, PROBLEM_TYPE_BASE } from '../errors/error-codes';
import { DEFAULT_LANGUAGE } from '../i18n/language';

/**
 * Components defined once and referenced by every operation (contract §5):
 * problem examples per error code, common parameters and response headers.
 */
export const EXAMPLE_REQUEST_ID = '6f1c2d8e-2c7b-4d0e-9d1c-3f1a2b3c4d5e';

export const PARAMETERS = {
  AcceptLanguage: {
    name: 'Accept-Language',
    in: 'header',
    required: false,
    description:
      'Language of `title`/`detail` in problems and of generated documents: `th` (default) or `en`.',
    schema: { type: 'string', example: 'th' },
  },
  IdempotencyKey: {
    name: 'Idempotency-Key',
    in: 'header',
    required: true,
    description:
      'Client-generated uuid for this operation. A replay with the same key and body within 24 h returns the ' +
      'original response with `Idempotent-Replayed: true`; the same key with a different body → 422 ' +
      '`idempotency.key_reused`; while the first request is still running → 409 `idempotency.in_progress`. ' +
      'A failed attempt releases the key.',
    schema: { type: 'string', format: 'uuid', example: '3b241101-e2bb-4255-8caf-4136c566a962' },
  },
  IdempotencyKeyOptional: {
    name: 'Idempotency-Key',
    in: 'header',
    required: false,
    description:
      'Recommended client-generated uuid; required from U-B5. When sent, a replay with the same key and body ' +
      'within 24 h returns the original response with `Idempotent-Replayed: true`; the same key with a ' +
      'different body → 422 `idempotency.key_reused`; while the first request is still running → 409 ' +
      '`idempotency.in_progress`. Without it the request is not deduplicated.',
    schema: { type: 'string', format: 'uuid', example: '3b241101-e2bb-4255-8caf-4136c566a962' },
  },
  IfMatchOptional: {
    name: 'If-Match',
    in: 'header',
    required: false,
    description:
      'ETag from the last read of this resource. When sent and it does not match → 412 `concurrency.stale`.',
    schema: { type: 'string', example: '"k8QeW2mV0pYt4sLr9nXc1bJ7aZd"' },
  },
  IfMatch: {
    name: 'If-Match',
    in: 'header',
    required: true,
    description:
      'ETag from the last read of this resource. Mismatch → 412 `concurrency.stale`; missing → 428 ' +
      '`concurrency.precondition_required`.',
    schema: { type: 'string', example: '"k8QeW2mV0pYt4sLr9nXc1bJ7aZd"' },
  },
} satisfies Record<string, ParameterObject>;
export type ParameterName = keyof typeof PARAMETERS;

export const HEADERS = {
  XRequestId: {
    description: 'Request id (echoes a valid incoming `X-Request-Id`); also in every problem as `requestId`.',
    schema: { type: 'string', example: EXAMPLE_REQUEST_ID },
  },
  ETag: {
    description: 'Version of the returned resource; send it back as `If-Match` when updating.',
    schema: { type: 'string', example: '"k8QeW2mV0pYt4sLr9nXc1bJ7aZd"' },
  },
  Location: {
    description: 'URL of the created resource.',
    schema: { type: 'string', example: '/v1/admin/examples/0d0c7a4e-5b0e-4c55-9d7c-3f2b8a1e6c11' },
  },
  IdempotentReplayed: {
    description: '`true` when this response is a replay of an earlier request with the same Idempotency-Key.',
    schema: { type: 'string', example: 'true' },
  },
  Deprecation: {
    description:
      'RFC 9745: the operation is deprecated since this moment (`@<epoch seconds>`); move to the replacement named in ' +
      'its description. Every call is counted; it is removed in a later release.',
    schema: { type: 'string', example: '@1790960400' },
  },
  Sunset: {
    description: 'RFC 8594: after this date the deprecated operation may stop answering.',
    schema: { type: 'string', example: 'Sat, 31 Oct 2026 17:00:00 GMT' },
  },
  RetryAfter: {
    description: 'Seconds to wait before retrying.',
    schema: { type: 'integer', example: 30 },
  },
  RateLimitLimit: {
    description: 'Requests allowed in the current window.',
    schema: { type: 'integer', example: 300 },
  },
  RateLimitRemaining: {
    description: 'Requests left in the current window.',
    schema: { type: 'integer', example: 299 },
  },
  RateLimitReset: {
    description: 'Seconds until the window resets.',
    schema: { type: 'integer', example: 60 },
  },
} satisfies Record<string, HeaderObject>;
export type HeaderName = keyof typeof HEADERS;

export const RESPONSE_HEADER_NAMES: Record<HeaderName, string> = {
  XRequestId: 'X-Request-Id',
  ETag: 'ETag',
  Location: 'Location',
  IdempotentReplayed: 'Idempotent-Replayed',
  Deprecation: 'Deprecation',
  Sunset: 'Sunset',
  RetryAfter: 'Retry-After',
  RateLimitLimit: 'X-RateLimit-Limit',
  RateLimitRemaining: 'X-RateLimit-Remaining',
  RateLimitReset: 'X-RateLimit-Reset',
};

/** Component name of the problem example for an error code. */
export const problemExampleName = (code: ErrorCode): string => `problem.${code}`;

type Catalogue = Record<string, Record<string, { title: string; detail: string }>>;

/** One example per error code, in the default language (Thai), from the i18n catalogue. */
export function problemExamples(i18nDir: string): Record<string, ExampleObject> {
  const catalogue = JSON.parse(
    readFileSync(join(i18nDir, DEFAULT_LANGUAGE, 'errors.json'), 'utf8'),
  ) as Catalogue;
  return Object.fromEntries(
    (Object.keys(ERROR_CODES) as ErrorCode[]).map((code) => {
      const [group = '', name = ''] = code.split('.');
      const text = catalogue[group]?.[name];
      if (!text) throw new Error(`Missing ${DEFAULT_LANGUAGE} translation for ${code}`);
      const value: Record<string, unknown> = {
        type: `${PROBLEM_TYPE_BASE}${code}`,
        title: text.title,
        status: ERROR_CODES[code],
        code,
        detail: text.detail,
        requestId: EXAMPLE_REQUEST_ID,
      };
      if (code === 'validation.failed') {
        value.errors = [
          { path: 'items[0].quantity', code: 'min', message: 'quantity must not be less than 1' },
        ];
      }
      return [problemExampleName(code), { summary: code, value }];
    }),
  );
}
