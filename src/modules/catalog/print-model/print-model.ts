/**
 * The print model of a catalogue product, per side (D-443): what the customer may print outside and inside.
 *
 * Per side the method is one choice — `none` (ไม่พิมพ์), `spot` (สีพิเศษ: 1..N spot colours, ดำ is one of them) or
 * `cmyk` (พิมพ์ 4 สี, optionally "+ สีพิเศษ" 0..M when the add-on is enabled). N, M, the allowed colours and the
 * process ink are back-office data, effective-dated (`catalog_product_print_models`; `PUT …/print-model` adds a
 * version, B-API-6) and capped by the `catalog.print_limits` setting — never constants.
 *
 * The model maps to the ink inputs the pricing engine already takes (corrugate `parts[].printFront` / `printBack`:
 * one entry per ink, the process set is one entry): no formula changes. Pure functions only.
 */

export const PRINT_METHODS = ['none', 'spot', 'cmyk'] as const;
export type PrintMethod = (typeof PRINT_METHODS)[number];

export const PRINT_SIDES = ['outside', 'inside'] as const;
export type PrintSide = (typeof PRINT_SIDES)[number];

/** The calculator field each side maps to (corrugate parts). */
export const PRINT_SIDE_FIELD = { outside: 'printFront', inside: 'printBack' } as const satisfies Record<
  PrintSide,
  string
>;

/** Calculators whose store configuration the per-side model drives (the others: see API-CHANGES B-API-2). */
export const PRINT_MODEL_CALCULATORS: ReadonlySet<string> = new Set(['corrugate']);

/** The problem field codes of `pricing.print_combination_invalid` (and of an invalid admin model). */
export const PRINT_VIOLATIONS = [
  'method_not_offered',
  'cmyk_with_spot',
  'process_repeated',
  'spot_count',
  'add_on_count',
  'colour_repeated',
  'colour_not_allowed',
] as const;
export type PrintViolationCode = (typeof PRINT_VIOLATIONS)[number];

export interface PrintSpotConfig {
  /** N: the most spot colours on the side (at least 1). */
  maxColours: number;
  /** The spot colours (ink colour public ids) the customer may pick, in display order. */
  inkColourIds: string[];
}

export interface PrintCmykConfig {
  /** The process ink (public id) that prints the CMYK set. */
  inkColourId: string;
  /** "+ สีพิเศษ" beside CMYK: 0..maxColours of the side's spot colours, only when enabled. */
  addOn: { enabled: boolean; maxColours: number };
}

export interface PrintSideConfig {
  methods: PrintMethod[];
  spot: PrintSpotConfig | null;
  cmyk: PrintCmykConfig | null;
}

export interface PrintModel {
  outside: PrintSideConfig;
  inside: PrintSideConfig;
}

/**
 * B-API-6: what the engine can price today, an effective-dated setting (`catalog.print_limits`, ADR-0005; seeded
 * max 1 spot colour per side, CMYK + spot add-on off until the business answers). It caps every model: combinations
 * beyond it are not offered by the configurator and a store calculation that still sends one gets the quote path.
 * Null when the setting has no version in force (then only the product's model applies).
 */
export interface PrintLimits {
  maxSpotColoursPerSide: number;
  cmykSpotAddOnEnabled: boolean;
}

/** A side's model capped by the limits in force (N ≤ the limit; the add-on off unless the limits allow it). */
export function limitSide(config: PrintSideConfig, limits: PrintLimits | null): PrintSideConfig {
  if (!limits) return config;
  const spot = config.spot && {
    ...config.spot,
    maxColours: Math.min(config.spot.maxColours, limits.maxSpotColoursPerSide),
  };
  const addOnOn = !!config.cmyk?.addOn.enabled && limits.cmykSpotAddOnEnabled;
  const cmyk = config.cmyk && {
    inkColourId: config.cmyk.inkColourId,
    addOn: { enabled: addOnOn, maxColours: addOnOn ? config.cmyk.addOn.maxColours : 0 },
  };
  const methods = config.methods.filter((m) => m !== 'spot' || (spot !== null && spot.maxColours >= 1));
  return { methods, spot, cmyk };
}

/** What a customer chose on one side. */
export interface PrintSelection {
  method: PrintMethod;
  /** `spot`: the spot colours, 1..N, distinct. */
  spotInkColourIds: string[];
  /** `cmyk`: the add-on spot colours, 0..M, distinct (empty when the add-on is off). */
  cmykAddOnInkColourIds: string[];
}

export const NO_PRINT: PrintSelection = { method: 'none', spotInkColourIds: [], cmykAddOnInkColourIds: [] };

export type InkKind = 'process' | 'spot' | 'white' | 'metallic';

export interface PrintViolation {
  code: PrintViolationCode;
  message: string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** A stored model (JSON column) as a typed value; null when unset or not a model. */
export function printModelOf(value: unknown): PrintModel | null {
  if (!isObject(value) || !isObject(value['outside']) || !isObject(value['inside'])) return null;
  return value as unknown as PrintModel;
}

const repeated = (ids: string[]) => new Set(ids).size !== ids.length;

/**
 * Reads the inks printed on one side into a selection: no ink = `none`; spot colours only = `spot`; one process ink
 * (+ spot colours) = `cmyk` (+ add-on). Two process entries are refused; an unknown ink is left to the engine.
 */
export function selectionOf(
  inkColourIds: string[],
  kindOf: (id: string) => InkKind | undefined,
): PrintSelection | PrintViolation {
  if (inkColourIds.length === 0) return NO_PRINT;
  const process = inkColourIds.filter((id) => kindOf(id) === 'process');
  const spots = inkColourIds.filter((id) => kindOf(id) !== 'process');
  if (process.length > 1)
    return { code: 'process_repeated', message: 'a side prints the CMYK set once (one process ink entry)' };
  if (process.length === 0) return { method: 'spot', spotInkColourIds: spots, cmykAddOnInkColourIds: [] };
  return { method: 'cmyk', spotInkColourIds: [], cmykAddOnInkColourIds: spots };
}

/**
 * Checks one side's inks against the side's model. Without a model (a product the back office has not configured
 * yet) only the combinations that are never valid are refused: CMYK together with a spot colour (e.g. ดำ + CMYK as
 * two inks — the add-on is off unless configured) and the process set twice.
 */
export function checkSide(
  config: PrintSideConfig | null,
  inkColourIds: string[],
  kindOf: (id: string) => InkKind | undefined,
  limits: PrintLimits | null = null,
): PrintViolation | null {
  const selection = selectionOf(inkColourIds, kindOf);
  if ('code' in selection) return selection;
  if (!config) {
    if (selection.method === 'cmyk' && selection.cmykAddOnInkColourIds.length > 0)
      return { code: 'cmyk_with_spot', message: 'CMYK and a spot colour on one side are not offered' };
    if (
      limits &&
      selection.method === 'spot' &&
      selection.spotInkColourIds.length > limits.maxSpotColoursPerSide
    )
      return {
        code: 'spot_count',
        message: `at most ${limits.maxSpotColoursPerSide} spot colours on a side (catalog.print_limits)`,
      };
    return null;
  }
  return checkSelection(limitSide(config, limits), selection, inkColourIds);
}

/** Checks a selection against the side's model (also used for the default spec). */
export function checkSelection(
  config: PrintSideConfig,
  selection: PrintSelection,
  inkColourIds: string[] = toInkColourIds(config, selection),
): PrintViolation | null {
  if (!config.methods.includes(selection.method))
    return { code: 'method_not_offered', message: `"${selection.method}" is not offered on this side` };
  if (repeated(inkColourIds)) return { code: 'colour_repeated', message: 'a colour is listed twice' };
  const allowed = new Set(config.spot?.inkColourIds ?? []);
  if (selection.method === 'spot') {
    const n = selection.spotInkColourIds.length;
    const max = config.spot?.maxColours ?? 0;
    if (n < 1 || n > max)
      return { code: 'spot_count', message: `between 1 and ${max} spot colours on this side` };
    if (selection.spotInkColourIds.some((id) => !allowed.has(id)))
      return { code: 'colour_not_allowed', message: 'a spot colour is not offered on this side' };
  }
  if (selection.method === 'cmyk') {
    const process = inkColourIds.find((id) => !selection.cmykAddOnInkColourIds.includes(id));
    if (config.cmyk && process !== undefined && process !== config.cmyk.inkColourId)
      return { code: 'colour_not_allowed', message: 'the process ink is not offered on this side' };
    const addOns = selection.cmykAddOnInkColourIds;
    const addOn = config.cmyk?.addOn;
    if (addOns.length > 0 && !addOn?.enabled)
      return { code: 'cmyk_with_spot', message: 'CMYK and a spot colour on one side are not offered' };
    if (addOn && addOns.length > addOn.maxColours)
      return { code: 'add_on_count', message: `at most ${addOn.maxColours} spot colours beside CMYK` };
    if (addOns.some((id) => !allowed.has(id)))
      return { code: 'colour_not_allowed', message: 'a spot colour is not offered on this side' };
  }
  return null;
}

/** The ink ids the engine prints for a selection: none → []; spot → the spot colours; CMYK → process + add-ons. */
export function toInkColourIds(config: PrintSideConfig, selection: PrintSelection): string[] {
  switch (selection.method) {
    case 'none':
      return [];
    case 'spot':
      return [...selection.spotInkColourIds];
    case 'cmyk':
      return config.cmyk ? [config.cmyk.inkColourId, ...selection.cmykAddOnInkColourIds] : [];
  }
}

/** The corrugate engine input of one side: one `{ inkColourId, area }` entry per ink (the CMYK set is one entry). */
export function toCorrugateColours(
  config: PrintSideConfig,
  selection: PrintSelection,
  area: string,
): { inkColourId: string; area: string }[] {
  return toInkColourIds(config, selection).map((inkColourId) => ({ inkColourId, area }));
}

/** The inks of every corrugate part side in a configuration, with their paths. */
export function corrugateSides(
  configuration: Record<string, unknown>,
): { path: string; side: PrintSide; inkColourIds: string[] }[] {
  const parts = Array.isArray(configuration['parts']) ? (configuration['parts'] as unknown[]) : [];
  const out: { path: string; side: PrintSide; inkColourIds: string[] }[] = [];
  parts.forEach((part, i) => {
    if (!isObject(part)) return;
    for (const side of PRINT_SIDES) {
      const field = PRINT_SIDE_FIELD[side];
      const colours = Array.isArray(part[field]) ? (part[field] as unknown[]) : [];
      out.push({
        path: `configuration.parts[${i}].${field}`,
        side,
        inkColourIds: colours
          .map((c) => (isObject(c) ? c['inkColourId'] : undefined))
          .filter((id): id is string => typeof id === 'string'),
      });
    }
  });
  return out;
}

/**
 * The default selection of a side (D-441 + D-443): what the default spec (reference configuration) prints on that
 * side — a side it does not print is `none`. Without a default spec, the outside follows the admin's default ink
 * flag (a spot ink → that spot colour, the process ink → CMYK) and the inside is `none`: the side-less ink flag never
 * turns inside print on. A default the model does not allow falls back to `none` (or the first offered method).
 */
export function defaultSelection(
  config: PrintSideConfig,
  side: PrintSide,
  reference: Record<string, unknown> | null,
  kindOf: (id: string) => InkKind | undefined,
  defaultInkColourId: string | null,
): PrintSelection {
  let ids: string[] = [];
  if (reference) {
    ids =
      corrugateSides(reference).find((s) => s.side === side && s.inkColourIds.length > 0)?.inkColourIds ?? [];
  } else if (side === 'outside' && defaultInkColourId) {
    ids = [defaultInkColourId];
  }
  const read = selectionOf(ids, kindOf);
  if (!('code' in read) && checkSelection(config, read, ids) === null) return read;
  if (config.methods.includes('none')) return NO_PRINT;
  const first = config.methods[0];
  if (first === 'spot' && config.spot?.inkColourIds[0])
    return { method: 'spot', spotInkColourIds: [config.spot.inkColourIds[0]], cmykAddOnInkColourIds: [] };
  if (first === 'cmyk') return { method: 'cmyk', spotInkColourIds: [], cmykAddOnInkColourIds: [] };
  return NO_PRINT;
}

/**
 * Validates a model an admin saves: at least one method per side; `spot` needs N ≥ 1 and at least N distinct
 * offered spot colours; `cmyk` needs an offered process ink; an enabled add-on needs the side's spot colours and
 * M ≥ 1 (M ≤ the colours listed). `offered` maps the product's offered ink colours (public id → kind).
 */
export function validatePrintModel(
  model: PrintModel,
  offered: ReadonlyMap<string, InkKind>,
  limits: PrintLimits | null = null,
): { path: string; code: string; message: string }[] {
  const errors: { path: string; code: string; message: string }[] = [];
  for (const side of PRINT_SIDES) {
    const c = model[side];
    const at = (p: string) => `printModel.${side}${p}`;
    // B-API-6: nothing beyond what the engine can price today (`catalog.print_limits`).
    if (limits && c.spot && c.spot.maxColours > limits.maxSpotColoursPerSide)
      errors.push({
        path: at('.spot.maxColours'),
        code: 'spot_count',
        message: `at most ${limits.maxSpotColoursPerSide} spot colours per side (catalog.print_limits)`,
      });
    if (limits && c.cmyk?.addOn.enabled && !limits.cmykSpotAddOnEnabled)
      errors.push({
        path: at('.cmyk.addOn.enabled'),
        code: 'add_on_count',
        message: 'the CMYK + spot colour add-on is not offered (catalog.print_limits)',
      });
    if (c.methods.length === 0 || repeated(c.methods))
      errors.push({ path: at('.methods'), code: 'invalid', message: 'list each offered method once' });
    if (c.spot) {
      if (repeated(c.spot.inkColourIds))
        errors.push({ path: at('.spot.inkColourIds'), code: 'unique', message: 'a colour is listed twice' });
      c.spot.inkColourIds.forEach((id, i) => {
        const kind = offered.get(id);
        if (kind === undefined || kind === 'process')
          errors.push({
            path: at(`.spot.inkColourIds[${i}]`),
            code: 'colour_not_allowed',
            message: 'not a spot ink colour the product offers',
          });
      });
      if (c.spot.maxColours > c.spot.inkColourIds.length)
        errors.push({
          path: at('.spot.maxColours'),
          code: 'spot_count',
          message: 'at most as many spot colours as are listed',
        });
    }
    if (c.methods.includes('spot') && !c.spot)
      errors.push({ path: at('.spot'), code: 'required', message: 'spot printing needs its colours' });
    if (c.methods.includes('cmyk') && !c.cmyk)
      errors.push({ path: at('.cmyk'), code: 'required', message: 'CMYK printing needs its process ink' });
    if (c.cmyk) {
      if (offered.get(c.cmyk.inkColourId) !== 'process')
        errors.push({
          path: at('.cmyk.inkColourId'),
          code: 'colour_not_allowed',
          message: 'not a process ink colour the product offers',
        });
      const addOn = c.cmyk.addOn;
      if (addOn.enabled && (!c.spot || addOn.maxColours < 1 || addOn.maxColours > c.spot.inkColourIds.length))
        errors.push({
          path: at('.cmyk.addOn'),
          code: 'add_on_count',
          message: 'an enabled add-on needs 1..(listed spot colours) colours',
        });
    }
  }
  return errors;
}

/** The configurator's view of one side (`StorePrintSideDto`). */
export interface StorePrintSide {
  field: 'printFront' | 'printBack';
  methods: PrintMethod[];
  spot: { minColours: number; maxColours: number; inkColourIds: string[] } | null;
  cmyk: { inkColourId: string; addOn: { enabled: boolean; minColours: number; maxColours: number } } | null;
  default: PrintSelection;
  /**
   * C0b (owner decision 2026-10-28, DECISIONS-STAGE-A §9.5): how many colours a customer may still choose on this side
   * beyond what is priced instantly — up to the side's offered spot inks. Such a choice is never refused or trimmed:
   * `calculate` answers `rfq_required` (the quote path, B-API-6). Null when nothing lies beyond the priced counts.
   */
  quote: { spotMaxColours: number; cmykAddOnMaxColours: number } | null;
}

/**
 * The configurator's per-side model (D-443): the admin's model restricted to the ink colours the product still offers
 * (active), with each side's default (`defaultSelection`). `kindOf` knows the offered inks only.
 */
export function storePrintModel(
  model: PrintModel,
  reference: Record<string, unknown> | null,
  kindOf: (id: string) => InkKind | undefined,
  defaultInkColourId: string | null,
  limits: PrintLimits | null = null,
): { outside: StorePrintSide; inside: StorePrintSide } {
  const view = (side: PrintSide): StorePrintSide => {
    // B-API-6: only what the engine can price is offered (`catalog.print_limits`).
    const c = limitSide(model[side], limits);
    const spotIds = (c.spot?.inkColourIds ?? []).filter((id) => {
      const kind = kindOf(id);
      return kind !== undefined && kind !== 'process';
    });
    const spot =
      c.spot && spotIds.length > 0
        ? { maxColours: Math.min(c.spot.maxColours, spotIds.length), inkColourIds: spotIds }
        : null;
    const cmyk = c.cmyk && kindOf(c.cmyk.inkColourId) === 'process' ? c.cmyk : null;
    const addOnMax = cmyk?.addOn.enabled && spot ? Math.min(cmyk.addOn.maxColours, spotIds.length) : 0;
    const methods = c.methods.filter((m) =>
      m === 'spot' ? spot !== null : m === 'cmyk' ? cmyk !== null : true,
    );
    const effective: PrintSideConfig = {
      methods,
      spot,
      cmyk: cmyk && { inkColourId: cmyk.inkColourId, addOn: { enabled: addOnMax > 0, maxColours: addOnMax } },
    };
    // C0b: more colours than priced (up to the offered spot inks) are a quote, not a refusal (`catalog.print_limits`
    // stays as set; nothing here is priced).
    const quoteSpot =
      spot && methods.includes('spot') && spotIds.length > spot.maxColours ? spotIds.length : null;
    const quoteAddOn =
      effective.cmyk && methods.includes('cmyk') && spotIds.length > addOnMax ? spotIds.length : null;
    const quote =
      quoteSpot !== null || quoteAddOn !== null
        ? {
            spotMaxColours: quoteSpot ?? spot?.maxColours ?? 0,
            cmykAddOnMaxColours: quoteAddOn ?? addOnMax,
          }
        : null;
    return {
      field: PRINT_SIDE_FIELD[side],
      methods,
      quote,
      spot: spot && { minColours: 1, ...spot },
      cmyk: effective.cmyk && {
        inkColourId: effective.cmyk.inkColourId,
        addOn: { ...effective.cmyk.addOn, minColours: 0 },
      },
      default: defaultSelection(effective, side, reference, kindOf, defaultInkColourId),
    };
  };
  return { outside: view('outside'), inside: view('inside') };
}
