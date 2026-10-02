import { type AdvisoryRuleSet } from '@platform/settings/setting-keys';

import { CORRUGATE_FORMULAS } from '../pricing/calculators/corrugate/formulas';

/**
 * Structure Advisor bands and rule set (U2.2, D-237, D-238). The bands are the API's input enums; the rule set
 * (`advisory.rule_set`, effective-dated, Superadmin) holds one retained-strength factor per band. Nothing here is a
 * business value: the values live in the setting only.
 */

export const TRANSPORT_MODES = ['pickup', 'parcel_domestic', 'pallet_domestic', 'sea_export'] as const;
export const HUMIDITY_BANDS = ['dry', 'normal', 'humid', 'very_humid'] as const;
export const STORAGE_BANDS = ['up_to_10_days', 'up_to_30_days', 'up_to_90_days', 'over_90_days'] as const;
export const FRAGILITY_BANDS = ['low', 'medium', 'high'] as const;
export const PALLET_PATTERNS = ['column', 'interlocked'] as const;

export type TransportMode = (typeof TRANSPORT_MODES)[number];
export type HumidityBand = (typeof HUMIDITY_BANDS)[number];
export type StorageBand = (typeof STORAGE_BANDS)[number];
export type FragilityBand = (typeof FRAGILITY_BANDS)[number];
export type PalletPattern = (typeof PALLET_PATTERNS)[number];

/** The factor tables of the rule set, in the order the engine applies (and reports) them. */
export const FACTOR_TABLES = {
  humidity: HUMIDITY_BANDS,
  storage: STORAGE_BANDS,
  palletPattern: ['none', ...PALLET_PATTERNS],
  palletOverhang: ['none', 'overhang'],
  transport: TRANSPORT_MODES,
  fragility: FRAGILITY_BANDS,
} as const satisfies {
  [K in keyof AdvisoryRuleSet['factors']]: readonly (keyof AdvisoryRuleSet['factors'][K])[];
};

export type FactorTable = keyof typeof FACTOR_TABLES;

const DECIMAL = '^\\d{1,6}(\\.\\d{1,6})?$';
const FACTOR = '^(0\\.\\d{1,4}|1(\\.0{1,4})?)$';

const table = (bands: readonly string[]) => ({
  type: 'object',
  additionalProperties: false,
  required: [...bands],
  properties: Object.fromEntries(bands.map((b) => [b, { type: 'string', pattern: FACTOR }])),
});

/** `settings.value_schema` of `advisory.rule_set`: every band must carry a factor. */
export const ADVISORY_RULE_SET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['mckeeConstant', 'uncertaintyPct', 'formulas', 'thinMarginPct', 'factors'],
  properties: {
    mckeeConstant: { type: 'string', pattern: DECIMAL },
    uncertaintyPct: { type: 'string', pattern: DECIMAL },
    formulas: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: { type: 'string', enum: [...CORRUGATE_FORMULAS] },
    },
    thinMarginPct: { type: 'string', pattern: DECIMAL },
    factors: {
      type: 'object',
      additionalProperties: false,
      required: Object.keys(FACTOR_TABLES),
      properties: Object.fromEntries(Object.entries(FACTOR_TABLES).map(([k, bands]) => [k, table(bands)])),
    },
  },
} as const;

export class RuleSetError extends Error {
  constructor(message: string) {
    super(`advisory.rule_set: ${message}`);
    this.name = 'RuleSetError';
  }
}

/** The rule set as numbers, checked again here so a hand-edited version can never feed the engine a 0 factor. */
export interface ParsedRuleSet {
  mckeeConstant: number;
  uncertaintyPct: number;
  formulas: readonly string[];
  thinMarginPct: number;
  factors: { [K in FactorTable]: Record<string, number> };
}

export function parseRuleSet(value: AdvisoryRuleSet): ParsedRuleSet {
  const num = (v: unknown, path: string, check: (n: number) => boolean) => {
    const n = typeof v === 'string' ? Number(v) : NaN;
    if (!Number.isFinite(n) || !check(n)) throw new RuleSetError(`${path} is not valid (${String(v)})`);
    return n;
  };
  const factors = {} as ParsedRuleSet['factors'];
  for (const [name, bands] of Object.entries(FACTOR_TABLES) as [FactorTable, readonly string[]][]) {
    const raw = (value.factors as Record<string, Record<string, unknown> | undefined>)?.[name];
    factors[name] = Object.fromEntries(
      bands.map((b) => [b, num(raw?.[b], `factors.${name}.${b}`, (n) => n > 0 && n <= 1)]),
    );
  }
  if (!Array.isArray(value.formulas) || value.formulas.length === 0)
    throw new RuleSetError('formulas is empty');
  return {
    mckeeConstant: num(value.mckeeConstant, 'mckeeConstant', (n) => n > 0),
    uncertaintyPct: num(value.uncertaintyPct, 'uncertaintyPct', (n) => n >= 0 && n < 100),
    formulas: value.formulas,
    thinMarginPct: num(value.thinMarginPct, 'thinMarginPct', (n) => n >= 0),
    factors,
  };
}
