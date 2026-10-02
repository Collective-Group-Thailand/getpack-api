import { createHash } from 'node:crypto';

/**
 * The style master file (`docs/design-tool/style-library-master.json`, D-241) — pure parsing and variant generation:
 * every base's variants are the combinations of its option axes, the tuck pair limited to `allowed_tuck_pairs` and a
 * multi-select axis taken as any subset of its values (pouch features); the tuck pair is restricted only when a base
 * varies both ends. The generated count must equal the base's
 * `distinct_variants`, so a file and this code can never silently disagree.
 */

/** Axes whose values combine freely (any subset, the empty one included). */
export const MULTI_SELECT_AXES: ReadonlySet<string> = new Set(['pouch_feat']);
const PAIR = ['tuck_top', 'tuck_bottom'] as const;
const CODE = /^PK-[A-Z0-9]{2,8}-[0-9]{2,3}$/;
const AXIS = /^[a-z][a-z0-9_]*$/;
/** Option values: lower-case words or sizes (`2x3`); never the key separators `=`, `;`, `+`. */
const VALUE = /^[a-z0-9][a-z0-9_]*$/;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export interface MasterBase {
  code: string;
  family: string;
  category: string;
  productType: string;
  nameTh: string;
  nameEn: string;
  construction: string;
  materialClass: string;
  variantAxes: string[];
  wave: number;
  complexity: string | null;
  referenceCode: string | null;
  pricingPathAtLaunch: string | null;
  synonyms: { locale: 'th' | 'en'; term: string }[];
  useCases: string[];
  distinctVariants: number;
}

export interface MasterVariant {
  optionKey: string;
  options: Record<string, string | string[]>;
}

export interface ParsedMaster {
  axes: Record<string, string[]>;
  allowedTuckPairs: [string, string][];
  bases: MasterBase[];
}

export class MasterFileError extends Error {
  constructor(readonly problems: string[]) {
    super(`style master file: ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? ' …' : ''}`);
    this.name = 'MasterFileError';
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function parseMaster(raw: unknown): ParsedMaster {
  const problems: string[] = [];
  const file = (raw ?? {}) as { axes?: unknown; allowed_tuck_pairs?: unknown; styles?: unknown };
  const axes: Record<string, string[]> = {};
  if (!file.axes || typeof file.axes !== 'object') problems.push('axes is missing');
  for (const [axis, values] of Object.entries((file.axes ?? {}) as Record<string, unknown>)) {
    if (
      !AXIS.test(axis) ||
      !Array.isArray(values) ||
      values.length === 0 ||
      !values.every((v) => VALUE.test(str(v)))
    )
      problems.push(`axis ${axis} is not a list of snake_case values`);
    else axes[axis] = values.map(str);
  }
  const allowedTuckPairs: [string, string][] = (
    Array.isArray(file.allowed_tuck_pairs) ? (file.allowed_tuck_pairs as unknown[]) : []
  ).map((p): [string, string] => (Array.isArray(p) ? [str(p[0]), str(p[1])] : ['', '']));
  for (const [top, bottom] of allowedTuckPairs) {
    if (!axes['tuck_top']?.includes(top) || !axes['tuck_bottom']?.includes(bottom))
      problems.push(`allowed tuck pair ${top}/${bottom} is not on the tuck axes`);
  }
  const styles = Array.isArray(file.styles) ? (file.styles as Record<string, unknown>[]) : [];
  if (styles.length === 0) problems.push('styles is empty');
  const seen = new Set<string>();
  const bases: MasterBase[] = [];
  for (const [i, s] of styles.entries()) {
    const code = str(s['code']);
    const at = `styles[${i}] ${code}`;
    if (!CODE.test(code)) problems.push(`${at}: code is not PK-<FAMILY>-<NN>`);
    if (seen.has(code)) problems.push(`${at}: duplicate code`);
    seen.add(code);
    const variantAxes = str(s['variant_axes'])
      .split(';')
      .map((a) => a.trim())
      .filter(Boolean);
    for (const axis of variantAxes) if (!axes[axis]) problems.push(`${at}: unknown axis ${axis}`);
    const wave = Number(s['wave']);
    if (!Number.isInteger(wave) || wave < 1 || wave > 9) problems.push(`${at}: wave must be 1–9`);
    for (const field of [
      'family',
      'category',
      'product_type',
      'name_th',
      'name_en',
      'construction',
      'material_class',
    ])
      if (!str(s[field])) problems.push(`${at}: ${field} is empty`);
    const synonyms = Array.isArray(s['synonyms'])
      ? (s['synonyms'] as { locale?: unknown; term?: unknown }[]).map((x) => ({
          locale: str(x.locale) === 'en' ? ('en' as const) : ('th' as const),
          term: str(x.term),
        }))
      : [];
    const useCases = Array.isArray(s['use_cases']) ? (s['use_cases'] as unknown[]).map(str) : [];
    for (const u of useCases) if (!AXIS.test(u)) problems.push(`${at}: use case ${u} is not snake_case`);
    bases.push({
      code,
      family: str(s['family']),
      category: str(s['category']),
      productType: str(s['product_type']),
      nameTh: str(s['name_th']),
      nameEn: str(s['name_en']),
      construction: str(s['construction']),
      materialClass: str(s['material_class']),
      variantAxes,
      wave,
      complexity: str(s['complexity']) || null,
      referenceCode: str(s['reference']) || null,
      pricingPathAtLaunch: str(s['pricing_path_at_launch']) || null,
      synonyms: synonyms.filter((x) => x.term),
      useCases: [...new Set(useCases)].sort(),
      distinctVariants: Number(s['distinct_variants']),
    });
  }
  const parsed = { axes, allowedTuckPairs, bases };
  if (problems.length === 0) {
    for (const base of bases) {
      const n = variantsOf(base, parsed).length;
      if (n !== base.distinctVariants)
        problems.push(`${base.code}: ${n} generated variants, the file says ${base.distinctVariants}`);
    }
  }
  if (problems.length > 0) throw new MasterFileError(problems);
  return parsed;
}

/** Every variant of a base, in a deterministic order. A base without axes has one variant (its only form). */
export function variantsOf(
  base: Pick<MasterBase, 'variantAxes'>,
  master: Pick<ParsedMaster, 'axes' | 'allowedTuckPairs'>,
): MasterVariant[] {
  type Choice = Record<string, string | string[]>;
  let combos: Choice[] = [{}];
  const axes = base.variantAxes;
  // The tuck pair is restricted only when a base varies both ends; one end alone takes every value of its axis.
  const paired = axes.includes(PAIR[0]) && axes.includes(PAIR[1]);
  for (const axis of axes) {
    if (paired && axis === PAIR[1]) continue;
    let choices: Choice[];
    if (paired && axis === PAIR[0])
      choices = master.allowedTuckPairs.map(([top, bottom]) => ({ [PAIR[0]]: top, [PAIR[1]]: bottom }));
    else if (MULTI_SELECT_AXES.has(axis))
      choices = subsets(master.axes[axis]!).map((set) => ({ [axis]: set }));
    else choices = master.axes[axis]!.map((value) => ({ [axis]: value }));
    combos = combos.flatMap((c) => choices.map((choice) => ({ ...c, ...choice })));
  }
  return combos.map((options) => ({ optionKey: optionKey(axes, options), options: ordered(axes, options) }));
}

/** `axis=value;…` in the base's axis order; a multi-select value is its sorted members joined by `+` (`none` empty). */
export function optionKey(axes: readonly string[], options: Record<string, string | string[]>): string {
  return axes
    .map((axis) => {
      const v = options[axis];
      const value = Array.isArray(v) ? (v.length ? [...v].sort().join('+') : 'none') : (v ?? '');
      return `${axis}=${value}`;
    })
    .join(';');
}

/** The variant's code suffix: `length` base-32 characters of sha256(base code | option key) (D-241). */
export function codeSuffix(baseCode: string, key: string, length = 4): string {
  const digest = createHash('sha256').update(`${baseCode}|${key}`).digest();
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of digest) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < length) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length >= length) break;
  }
  return out;
}

/** sha256 of the fields a base takes from the file (re-importing the same data changes nothing). */
export function baseSha256(base: MasterBase): Buffer {
  const { distinctVariants: _count, ...fields } = base;
  void _count;
  return createHash('sha256').update(JSON.stringify(fields)).digest();
}

function subsets(values: readonly string[]): string[][] {
  const out: string[][] = [];
  for (let mask = 0; mask < 1 << values.length; mask++) out.push(values.filter((_, i) => mask & (1 << i)));
  return out;
}

function ordered(axes: readonly string[], options: Record<string, string | string[]>) {
  return Object.fromEntries(
    axes.map((a) => {
      const v = options[a]!;
      return [a, Array.isArray(v) ? [...v].sort() : v];
    }),
  );
}
