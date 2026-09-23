/** Value types of `settings.value_type` (schema-design §3.1). */
export type SettingValueTypeName =
  | 'string'
  | 'integer'
  | 'decimal'
  | 'money'
  | 'percent'
  | 'boolean'
  | 'duration'
  | 'time_of_day_window'
  | 'date'
  | 'enum'
  | 'json';

const DECIMAL = /^-?\d+(\.\d+)?$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DURATION = /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?$/;

/**
 * Checks a setting value against its declared type and schema fragment (`enum`, `minimum`,
 * `maximum`). Money and percentages are decimal strings (CLAUDE.md hard rules). Returns the
 * reason when invalid, `null` when valid. Used by the seed and by setting changes.
 */
export function settingValueError(
  valueType: SettingValueTypeName,
  value: unknown,
  schema?: Record<string, unknown> | null,
): string | null {
  const bounds = (n: number): string | null => {
    const min = schema?.['minimum'];
    const max = schema?.['maximum'];
    if (typeof min === 'number' && n < min) return `must be ≥ ${min}`;
    if (typeof max === 'number' && n > max) return `must be ≤ ${max}`;
    return null;
  };
  switch (valueType) {
    case 'string':
      return typeof value === 'string' && value.trim() !== '' ? null : 'must be a non-empty string';
    case 'integer':
      return Number.isInteger(value) ? bounds(value as number) : 'must be an integer';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be a boolean';
    case 'decimal':
    case 'money':
    case 'percent':
      return typeof value === 'string' && DECIMAL.test(value)
        ? bounds(Number(value))
        : 'must be a decimal string';
    case 'date':
      return typeof value === 'string' && DATE.test(value) ? null : 'must be YYYY-MM-DD';
    case 'duration':
      return typeof value === 'string' && ISO_DURATION.test(value) ? null : 'must be an ISO 8601 duration';
    case 'enum': {
      const allowed = schema?.['enum'];
      return Array.isArray(allowed) && allowed.includes(value) ? null : 'must be one of the allowed values';
    }
    case 'time_of_day_window': {
      const window = value as { from?: unknown; to?: unknown; timezone?: unknown } | null;
      return window &&
        typeof window === 'object' &&
        typeof window.from === 'string' &&
        TIME.test(window.from) &&
        typeof window.to === 'string' &&
        TIME.test(window.to)
        ? null
        : 'must be { from: "HH:MM", to: "HH:MM" }';
    }
    case 'json':
      return value !== null && typeof value === 'object' ? null : 'must be a JSON object or array';
  }
}
