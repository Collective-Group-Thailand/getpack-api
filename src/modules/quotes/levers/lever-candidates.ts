/**
 * D-248 lever candidates: alternatives to a quotation's configuration that may lower its price, as pure transforms
 * over the calculator configuration JSON. Structure, style and size are never touched; the real engine prices every
 * candidate and drops the ones it refuses or that are not cheaper (QuoteLeversService).
 */

export const LEVER_KINDS = [
  'quantity',
  'material',
  'back_print',
  'special_finish',
  'coating',
  'assembly',
] as const;
export type LeverKind = (typeof LEVER_KINDS)[number];

export const LEVER_REASON_CODES = [
  'quantity_increased',
  'material_changed',
  'back_print_removed',
  'special_finish_removed',
  'coating_removed',
  'assembly_removed',
] as const;
export type LeverReasonCode = (typeof LEVER_REASON_CODES)[number];

export interface LeverChange {
  from: unknown;
  to: unknown;
}

export interface LeverCandidate {
  kind: LeverKind;
  configuration: Record<string, unknown>;
  /** Changed paths (`materialId`, `parts[0].printBack`, `quantities` …) → { from, to }. */
  changes: Record<string, LeverChange>;
  reasonCodes: LeverReasonCode[];
}

export interface LeverContext {
  /** Public ids of the other materials the catalogue product offers (none: no material lever). */
  materialIds: string[];
  /** The catalogue product's preset quantities (any order). */
  quantityPresets: number[];
  /** `quotes.lever_quantity_multipliers`, used when no preset lies above the largest quoted quantity. */
  quantityMultipliers: number[];
}

/** Quantity levers at most (the next breaks). */
export const MAX_QUANTITY_LEVERS = 2;
/** Candidates priced per quotation at most — a technical cap like the advisor's, not a business value. */
export const MAX_LEVER_CANDIDATES = 12;

type Part = Record<string, unknown>;

const nonEmpty = (v: unknown): boolean => Array.isArray(v) && v.length > 0;
const clone = <T>(v: T): T => structuredClone(v);

function partsOf(cfg: Record<string, unknown>): Part[] {
  return Array.isArray(cfg['parts']) ? (cfg['parts'] as Part[]) : [];
}

/** A candidate that changes some fields of every part; null when no part has them. */
function partLever(
  cfg: Record<string, unknown>,
  kind: LeverKind,
  reason: LeverReasonCode,
  applies: (part: Part) => boolean,
  change: (part: Part) => Record<string, LeverChange>,
): LeverCandidate | null {
  const parts = partsOf(cfg);
  if (!parts.some(applies)) return null;
  const next = clone(cfg);
  const changes: Record<string, LeverChange> = {};
  (next['parts'] as Part[]).forEach((part, i) => {
    if (!applies(part)) return;
    for (const [field, c] of Object.entries(change(part))) {
      changes[`parts[${i}].${field}`] = c;
      if (c.to === undefined) delete part[field];
      else part[field] = c.to;
    }
  });
  return { kind, configuration: next, changes, reasonCodes: [reason] };
}

/** The next quantity breaks above the largest quoted quantity (D-248). */
export function nextQuantities(
  quoted: number[],
  ctx: Pick<LeverContext, 'quantityPresets' | 'quantityMultipliers'>,
) {
  const max = Math.max(...quoted);
  const presets = [...new Set(ctx.quantityPresets)]
    .filter((q) => Number.isInteger(q) && q > max)
    .sort((a, b) => a - b);
  const next =
    presets.length > 0
      ? presets
      : [...new Set(ctx.quantityMultipliers.map((m) => Math.round(max * m)))]
          .filter((q) => q > max)
          .sort((a, b) => a - b);
  return next.slice(0, MAX_QUANTITY_LEVERS);
}

/** Every candidate for the configuration, in a stable order, capped at MAX_LEVER_CANDIDATES. */
export function leverCandidates(cfg: Record<string, unknown>, ctx: LeverContext): LeverCandidate[] {
  const out: LeverCandidate[] = [];
  const quoted = Array.isArray(cfg['quantities']) ? (cfg['quantities'] as number[]) : [];

  if (quoted.length > 0) {
    for (const q of nextQuantities(quoted, ctx)) {
      out.push({
        kind: 'quantity',
        configuration: { ...clone(cfg), quantities: [q] },
        changes: { quantities: { from: quoted, to: [q] } },
        reasonCodes: ['quantity_increased'],
      });
    }
  }

  const back = partLever(
    cfg,
    'back_print',
    'back_print_removed',
    (p) => nonEmpty(p['printBack']),
    (p) => ({ printBack: { from: p['printBack'], to: [] } }),
  );
  if (back) out.push(back);

  const special = partLever(
    cfg,
    'special_finish',
    'special_finish_removed',
    (p) => nonEmpty(p['finish2']),
    (p) => ({ finish2: { from: p['finish2'], to: [] } }),
  );
  if (special) out.push(special);

  const COATING_FIELDS = ['finish1FrontId', 'finish1BackId', 'coatingFrontId', 'coatingBackId'];
  const coating = partLever(
    cfg,
    'coating',
    'coating_removed',
    (p) => COATING_FIELDS.some((f) => typeof p[f] === 'string'),
    (p) =>
      Object.fromEntries(
        COATING_FIELDS.filter((f) => typeof p[f] === 'string').map((f) => [f, { from: p[f], to: undefined }]),
      ),
  );
  if (coating) out.push(coating);

  const assembly = partLever(
    cfg,
    'assembly',
    'assembly_removed',
    (p) => nonEmpty(p['assemblies']),
    (p) => ({ assemblies: { from: p['assemblies'], to: [] } }),
  );
  if (assembly) out.push(assembly);

  // Materials last: the most numerous; whatever the cap leaves.
  if (typeof cfg['materialId'] === 'string') {
    for (const materialId of ctx.materialIds) {
      if (materialId === cfg['materialId']) continue;
      out.push({
        kind: 'material',
        configuration: { ...clone(cfg), materialId },
        changes: { materialId: { from: cfg['materialId'], to: materialId } },
        reasonCodes: ['material_changed'],
      });
    }
  }
  return out.slice(0, MAX_LEVER_CANDIDATES);
}
