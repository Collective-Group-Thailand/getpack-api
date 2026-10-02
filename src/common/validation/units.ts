import { DomainException } from '../errors/domain.exception';
import { type ProblemFieldError } from '../errors/problem-details.dto';

/**
 * D-183: the API is millimetre-only — a request naming a unit is refused with `specs.unit_not_accepted` instead of
 * being read in another unit. The display unit is a per-user preference used only by the web (`displayUnit`).
 */
export const UNIT_KEYS: ReadonlySet<string> = new Set([
  'unit',
  'units',
  'lengthUnit',
  'dimensionUnit',
  'sizeUnit',
  'uom',
]);

const lastSegment = (path: string): string =>
  path
    .replace(/\[\d+\]$/, '')
    .split('.')
    .pop() ?? path;

/** The refusal of a validated payload whose only unknown fields are units (the global pipe's whitelist). */
export function unitRefusal(errors: ProblemFieldError[]): DomainException | null {
  const units = errors.filter((e) => e.code === 'whitelistValidation' && UNIT_KEYS.has(lastSegment(e.path)));
  if (units.length === 0) return null;
  return new DomainException('specs.unit_not_accepted', {
    errors: units.map((e) => ({
      path: e.path,
      code: 'unit_not_accepted',
      message: 'sizes are millimetres only',
    })),
  });
}

/** Free JSON (RFQ specs, design documents, configurator states): refuses any unit key at any depth. */
export function refuseUnits(value: unknown, path: string, depth = 0): void {
  if (depth > 12 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => refuseUnits(v, `${path}[${i}]`, depth + 1));
    return;
  }
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const at = path ? `${path}.${key}` : key;
    if (UNIT_KEYS.has(key)) {
      throw new DomainException('specs.unit_not_accepted', {
        errors: [{ path: at, code: 'unit_not_accepted', message: 'sizes are millimetres only' }],
      });
    }
    refuseUnits(v, at, depth + 1);
  }
}
