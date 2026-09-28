/**
 * Field names that must never reach logs (PDPA; CLAUDE.md hard rules). Matched at any depth up to
 * `REDACT_DEPTH` because pino's redaction paths do not support recursive wildcards.
 * `taxId` is always redacted: when a log genuinely needs it, log an internal id instead.
 */
export const REDACTED_FIELDS = [
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'newPassword',
  'currentPassword',
  'pin',
  'otp',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'clientSecret',
  'apiKey',
  'x-api-key',
  'x-line-signature',
  'secret',
  'cardNumber',
  'cvv',
  'bankAccount',
  'bankAccountNumber',
  'taxId',
] as const;

const REDACT_DEPTH = 5;

export const REDACT_CENSOR = '[REDACTED]';

function pathFor(field: string, depth: number): string {
  const key = /^[A-Za-z_$][\w$]*$/.test(field) ? field : `["${field}"]`;
  const prefix = Array.from({ length: depth }, () => '*').join('.');
  if (depth === 0) return key;
  return key.startsWith('[') ? `${prefix}${key}` : `${prefix}.${key}`;
}

export const REDACT_PATHS: string[] = REDACTED_FIELDS.flatMap((field) =>
  Array.from({ length: REDACT_DEPTH + 1 }, (_, depth) => pathFor(field, depth)),
);

const REDACTED_LOWER = new Set<string>(REDACTED_FIELDS.map((f) => f.toLowerCase()));

/**
 * Deep copy of `value` with every redacted field replaced by the censor, at any depth. Used for
 * data that is persisted (audit diffs, webhook payloads), where pino's path redaction does not apply.
 */
export function redactDeep<T>(value: T): T {
  return redactValue(value, 0) as T;
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 20 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_LOWER.has(key.toLowerCase()) ? REDACT_CENSOR : redactValue(inner, depth + 1);
  }
  return out;
}
