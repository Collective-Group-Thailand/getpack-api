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
