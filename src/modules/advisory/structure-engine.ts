import Decimal from 'decimal.js';

import {
  type FactorTable,
  type FragilityBand,
  type HumidityBand,
  type PalletPattern,
  type ParsedRuleSet,
  type StorageBand,
  type TransportMode,
} from './rule-set';

/**
 * Structure Advisor engine (U2.2, D-188, D-235–D-239) — pure, deterministic, no I/O, so every recommendation can be
 * replayed from its log (D-240). Rules only; no model is used, and the API never calls it "AI" (D-189).
 *
 * - Load on the bottom box = (boxes high − 1) × box gross weight × g; box gross weight = units × unit weight + tare,
 *   tare = blank area × grammage of the **heaviest** candidate board (one requirement for every board — conservative,
 *   and it makes "a heavier or taller stack never gets a weaker board" hold exactly).
 * - Required BCT = load ÷ the product of the rule set's retained-strength factors (humidity, storage time, pallet
 *   pattern, overhang, transport mode, fragility).
 * - Estimated BCT = simplified McKee, k × ECT × √(caliper × perimeter), perimeter = 2 (L + W) of the inside size,
 *   shown as a ± uncertainty range; a board passes when the **low** end ≥ the requirement (D-239).
 * - Recommended = the cheapest passing board with an instant price (tie → stronger, then id); without one, the
 *   weakest passing board (routes to CS / RFQ); no passing board → no recommendation, the strongest is the closest.
 * - Alternatives = the cheapest, strongest and fastest passing boards with an instant price, without duplicates or
 *   the recommended one.
 */

export const ADVISOR_ENGINE_VERSION = '1.0.0';
/** Standard gravity, m/s² (kg → N). */
export const GRAVITY = 9.80665;

export interface AdvisoryLoadInputs {
  /** Product weight per unit, grams. */
  productWeightG: number;
  unitsPerBox: number;
  /** Boxes in the tallest column, the bottom box included (across stacked pallets). */
  stackLayers: number;
  /** null = not palletised. */
  pallet: { pattern: PalletPattern; overhang: boolean } | null;
  fragility: FragilityBand;
  transportMode: TransportMode;
  humidity: HumidityBand;
  storage: StorageBand;
}

/** One board the engine may recommend, with the sheet the service chose for it (D-236) and its price (D-239). */
export interface CandidateBoard {
  materialId: string;
  /** Null: no sheet in force — never recommended (D-188). */
  sheet: { sheetId: string; ectKnPerM: number; caliperMm: number; grammageGsm: number } | null;
  /** The ported corrugate blank of this board's flute, m². */
  blankAreaSqm: number;
  /** The first quantity of the configuration, priced by the quote engine. */
  price: {
    instant: boolean;
    unitPrice: string | null;
    grossAmount: string | null;
    leadTimeDays: number | null;
  };
}

export interface BoxGeometry {
  /** Inside size priced (D-182), mm. */
  l: number;
  w: number;
  d: number;
}

export type OptionRole = 'recommended' | 'cheapest' | 'strongest' | 'fastest' | 'closest';
export type WarningCode = 'no_board_meets_load' | 'thin_margin' | 'below_requirement';

export interface Reason {
  code: string;
  /** The factor table a factor reason comes from. */
  factor?: FactorTable;
  band?: string;
  value?: number;
  unit?: string;
}

export interface OptionResult {
  materialId: string;
  sheetId: string;
  ectKnPerM: number;
  caliperMm: number;
  grammageGsm: number;
  bctN: { estimate: number; low: number; high: number };
  /** ECT the box would need for the low end to meet the requirement, kN/m. */
  requiredEctKnPerM: number;
  /** (low end ÷ requirement − 1) × 100; null with no top load. */
  marginPct: number | null;
  passes: boolean;
  instant: boolean;
  unitPrice: string | null;
  grossAmount: string | null;
  leadTimeDays: number | null;
  roles: OptionRole[];
  warnings: WarningCode[];
}

export interface Alternative {
  materialId: string;
  roles: OptionRole[];
  /** Unit price minus the recommended one; null without both prices. */
  unitPriceDelta: string | null;
  leadTimeDeltaDays: number | null;
}

export interface EngineOutput {
  engineVersion: string;
  outcome: 'recommended' | 'no_board_meets_load';
  requirement: {
    perimeterMm: number;
    tareKg: number;
    boxWeightKg: number;
    layers: number;
    loadN: number;
    factors: { factor: FactorTable; band: string; value: number }[];
    combinedFactor: number;
    requiredBctN: number;
  };
  recommendedMaterialId: string | null;
  closestMaterialId: string | null;
  /** Every board with a sheet, strongest first. */
  options: OptionResult[];
  alternatives: Alternative[];
  warnings: WarningCode[];
  reasons: Reason[];
  /** Boards without a sheet in force (staff only). */
  excluded: { materialId: string; reason: 'no_board_data' }[];
}

const round = (n: number, places: number) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

const priceOf = (o: { unitPrice: string | null }) => (o.unitPrice === null ? null : new Decimal(o.unitPrice));

function factorsOf(inputs: AdvisoryLoadInputs, rules: ParsedRuleSet) {
  const bands: [FactorTable, string][] = [
    ['humidity', inputs.humidity],
    ['storage', inputs.storage],
    ['palletPattern', inputs.pallet?.pattern ?? 'none'],
    ['palletOverhang', inputs.pallet?.overhang ? 'overhang' : 'none'],
    ['transport', inputs.transportMode],
    ['fragility', inputs.fragility],
  ];
  return bands.map(([factor, band]) => {
    const value = rules.factors[factor][band];
    if (value === undefined) throw new Error(`advisory: no ${factor} factor for band ${band}`);
    return { factor, band, value };
  });
}

const priced = (o: OptionResult) => o.instant && o.unitPrice !== null;

export function evaluate(
  inputs: AdvisoryLoadInputs,
  box: BoxGeometry,
  boards: readonly CandidateBoard[],
  rules: ParsedRuleSet,
): EngineOutput {
  const withData = boards.filter((b): b is CandidateBoard & { sheet: NonNullable<CandidateBoard['sheet']> } =>
    Boolean(b.sheet),
  );
  const excluded = boards
    .filter((b) => !b.sheet)
    .map((b) => ({ materialId: b.materialId, reason: 'no_board_data' as const }))
    .sort((a, b) => (a.materialId < b.materialId ? -1 : 1));

  const perimeterMm = 2 * (box.l + box.w);
  const tareKg = withData.reduce((max, b) => Math.max(max, (b.blankAreaSqm * b.sheet.grammageGsm) / 1000), 0);
  const boxWeightKg = (inputs.unitsPerBox * inputs.productWeightG) / 1000 + tareKg;
  const loadN = Math.max(0, inputs.stackLayers - 1) * boxWeightKg * GRAVITY;
  const factors = factorsOf(inputs, rules);
  const combinedFactor = factors.reduce((p, f) => p * f.value, 1);
  const requiredBctN = loadN / combinedFactor;
  const band = rules.uncertaintyPct / 100;

  const options: OptionResult[] = withData.map((b) => {
    const root = Math.sqrt(b.sheet.caliperMm * perimeterMm);
    const estimate = rules.mckeeConstant * b.sheet.ectKnPerM * root;
    const low = estimate * (1 - band);
    const high = estimate * (1 + band);
    const passes = low >= requiredBctN;
    const marginPct = requiredBctN > 0 ? (low / requiredBctN - 1) * 100 : null;
    const warnings: WarningCode[] = [];
    if (!passes) warnings.push('below_requirement');
    else if (marginPct !== null && marginPct < rules.thinMarginPct) warnings.push('thin_margin');
    return {
      materialId: b.materialId,
      sheetId: b.sheet.sheetId,
      ectKnPerM: b.sheet.ectKnPerM,
      caliperMm: b.sheet.caliperMm,
      grammageGsm: b.sheet.grammageGsm,
      bctN: { estimate: round(estimate, 1), low: round(low, 1), high: round(high, 1) },
      requiredEctKnPerM: round(requiredBctN / (rules.mckeeConstant * root * (1 - band)), 3),
      marginPct: marginPct === null ? null : round(marginPct, 1),
      passes,
      instant: b.price.instant,
      unitPrice: b.price.unitPrice,
      grossAmount: b.price.grossAmount,
      leadTimeDays: b.price.leadTimeDays,
      roles: [],
      warnings,
    };
  });
  // Rank on unrounded strengths (the rounded figures are for display only).
  const lowOf = new Map(
    withData.map((b) => [
      b.materialId,
      rules.mckeeConstant * b.sheet.ectKnPerM * Math.sqrt(b.sheet.caliperMm * perimeterMm) * (1 - band),
    ]),
  );
  /** Stronger first (unrounded low end), then the material id (deterministic). */
  const strength = (a: OptionResult, b: OptionResult) =>
    lowOf.get(b.materialId)! - lowOf.get(a.materialId)! ||
    (a.materialId < b.materialId ? -1 : a.materialId > b.materialId ? 1 : 0);
  /** Cheaper first (instant prices only), then stronger. */
  const byPrice = (a: OptionResult, b: OptionResult) => priceOf(a)!.comparedTo(priceOf(b)!) || strength(a, b);
  /** Faster first, then cheaper. */
  const bySpeed = (a: OptionResult, b: OptionResult) =>
    (a.leadTimeDays ?? Infinity) - (b.leadTimeDays ?? Infinity) || byPrice(a, b);
  options.sort(strength);

  const passing = options.filter((o) => o.passes);
  const passingPriced = passing.filter(priced);
  let recommended: OptionResult | null = null;
  const reasons: Reason[] = [];
  if (passingPriced.length > 0) {
    recommended = [...passingPriced].sort(byPrice)[0]!;
    reasons.push({ code: 'cheapest_passing' });
  } else if (passing.length > 0) {
    recommended = passing[passing.length - 1]!;
    reasons.push({ code: 'no_instant_price' });
  }
  const closest = recommended ? null : (options[0] ?? null);

  const warnings: WarningCode[] = recommended ? [...recommended.warnings] : ['no_board_meets_load'];
  if (inputs.stackLayers <= 1) reasons.unshift({ code: 'no_top_load' });
  reasons.unshift(
    { code: 'box_weight', value: round(boxWeightKg, 3), unit: 'kg' },
    { code: 'top_load', value: round(loadN, 1), unit: 'N' },
    ...factors.map((f) => ({ code: 'factor', factor: f.factor, band: f.band, value: f.value })),
    { code: 'combined_factor', value: round(combinedFactor, 4) },
    { code: 'required_bct', value: round(requiredBctN, 1), unit: 'N' },
  );
  const lead = recommended ?? closest;
  if (lead) {
    reasons.push(
      { code: 'estimated_bct_low', value: lead.bctN.low, unit: 'N' },
      { code: 'estimated_bct_high', value: lead.bctN.high, unit: 'N' },
    );
    if (lead.marginPct !== null) reasons.push({ code: 'margin', value: lead.marginPct, unit: '%' });
  }

  // Roles and alternatives: only passing boards with an instant price (D-239); with no recommendation the closest
  // board is shown alone.
  const pool = recommended ? passingPriced : [];
  const roleOf: [OptionRole, OptionResult | undefined][] = [
    ['cheapest', [...pool].sort(byPrice)[0]],
    ['strongest', [...pool].sort(strength)[0]],
    ['fastest', [...pool].sort(bySpeed)[0]],
  ];
  if (recommended) recommended.roles.push('recommended');
  if (closest) closest.roles.push('closest');
  for (const [role, option] of roleOf) if (option && !option.roles.includes(role)) option.roles.push(role);
  const alternatives: Alternative[] = [];
  for (const [, option] of roleOf) {
    if (!option || option === recommended || alternatives.some((a) => a.materialId === option.materialId))
      continue;
    const base = recommended ? priceOf(recommended) : null;
    const mine = priceOf(option);
    alternatives.push({
      materialId: option.materialId,
      roles: option.roles.filter((r) => r !== 'closest'),
      unitPriceDelta:
        base && mine
          ? mine.minus(base).toFixed(Math.max(base.decimalPlaces(), mine.decimalPlaces(), 2))
          : null,
      leadTimeDeltaDays:
        recommended?.leadTimeDays != null && option.leadTimeDays != null
          ? option.leadTimeDays - recommended.leadTimeDays
          : null,
    });
  }

  return {
    engineVersion: ADVISOR_ENGINE_VERSION,
    outcome: recommended ? 'recommended' : 'no_board_meets_load',
    requirement: {
      perimeterMm: round(perimeterMm, 2),
      tareKg: round(tareKg, 3),
      boxWeightKg: round(boxWeightKg, 3),
      layers: inputs.stackLayers,
      loadN: round(loadN, 1),
      factors,
      combinedFactor: round(combinedFactor, 4),
      requiredBctN: round(requiredBctN, 1),
    },
    recommendedMaterialId: recommended?.materialId ?? null,
    closestMaterialId: closest?.materialId ?? null,
    options,
    alternatives,
    warnings,
    reasons,
    excluded,
  };
}
