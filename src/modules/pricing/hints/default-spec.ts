/**
 * The default spec of a catalogue product (D-441): the admin-maintained reference configuration (D-220) is the one
 * spec the configurator opens on, the "starting from" price is priced at, and the product page, cards, category
 * pages and JSON-LD describe. Pure helpers: the configuration with its product, the ids it selects, the option
 * defaults and the standard size it matches.
 */

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The calculator configuration of the default spec, bound to its product; null without a reference. */
export function defaultSpecConfiguration(reference: unknown, catalogProductId: string): Json | null {
  if (!isObject(reference)) return null;
  return { ...reference, catalogProductId };
}

/** The reference quantity: the one quantity a reference configuration names (validated on save, D-220). */
export function defaultSpecQuantity(configuration: Json | null): number | null {
  const q = configuration?.['quantities'];
  return Array.isArray(q) && typeof q[0] === 'number' ? q[0] : null;
}

/** Keys whose ids are not option choices (the product, its pattern and parts, the difficulty). */
const NOT_OPTIONS = new Set(['catalogProductId', 'patternId', 'subPatternId', 'difficultyLevelId']);

/**
 * Every option id the configuration selects — material, ink colours, finishes and coatings, die-cut, assemblies,
 * pouch options — whatever the calculator's shape (`…Id` / `…Ids` keys at any depth).
 */
export function selectedOptionIds(configuration: Json): Set<string> {
  const out = new Set<string>();
  const walk = (value: unknown, key: string | null): void => {
    if (Array.isArray(value)) {
      for (const v of value) {
        if (typeof v === 'string' && key?.endsWith('Ids')) out.add(v);
        else walk(v, key);
      }
      return;
    }
    if (isObject(value)) {
      for (const [k, v] of Object.entries(value)) walk(v, k);
      return;
    }
    if (typeof value === 'string' && key !== null && key.endsWith('Id') && !NOT_OPTIONS.has(key))
      out.add(value);
  };
  walk(configuration, null);
  return out;
}

/**
 * The option groups with `isDefault` taken from the default spec: an option is a default exactly when the spec
 * selects it; a group the spec selects nothing in (no print, no coating) has no default. Without a default spec the
 * admin's flags stand.
 */
export function withSpecDefaults<G extends { options: { id: string; isDefault: boolean }[] }>(
  groups: G[],
  configuration: Json | null,
): G[] {
  if (!configuration) return groups;
  const ids = selectedOptionIds(configuration);
  return groups.map((g) => ({ ...g, options: g.options.map((o) => ({ ...o, isDefault: ids.has(o.id) })) }));
}

const same = (a: unknown, b: number) => typeof a === 'number' && Math.abs(a - b) < 0.001;

/** The index of the standard size the default spec is (length × width × height = l × w × d), or -1. */
export function defaultSizeIndex(
  sizes: { lengthMm: number; widthMm: number; heightMm: number }[],
  configuration: Json | null,
): number {
  if (!configuration) return -1;
  const { l, w, d } = configuration;
  return sizes.findIndex(
    (s) =>
      same(l, s.lengthMm) && same(w, s.widthMm) && (d === undefined ? s.heightMm === 0 : same(d, s.heightMm)),
  );
}
