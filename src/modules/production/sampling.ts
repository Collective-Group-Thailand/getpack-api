/**
 * ISO 2859-1:1999 single sampling for normal inspection (D-076: general inspection level II, AQL 0 / 2.5 /
 * 4.0). Tables 1 (sample size code letters) and 2-A (master table) as published; an arrow sends the lookup
 * to the first plan below (↓) or above (↑) it, whose sample size then applies. Pure.
 */

/** Table 1, general inspection level II: [upper lot size, code letter]. */
const LEVEL_II: readonly [number, string][] = [
  [8, 'A'],
  [15, 'B'],
  [25, 'C'],
  [50, 'D'],
  [90, 'E'],
  [150, 'F'],
  [280, 'G'],
  [500, 'H'],
  [1200, 'J'],
  [3200, 'K'],
  [10000, 'L'],
  [35000, 'M'],
  [150000, 'N'],
  [500000, 'P'],
  [Number.POSITIVE_INFINITY, 'Q'],
];

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R'] as const;
const SAMPLE_SIZE: Record<string, number> = {
  A: 2,
  B: 3,
  C: 5,
  D: 8,
  E: 13,
  F: 20,
  G: 32,
  H: 50,
  J: 80,
  K: 125,
  L: 200,
  M: 315,
  N: 500,
  P: 800,
  Q: 1250,
  R: 2000,
};

/** Table 2-A columns: acceptance number, or an arrow. */
type Cell = number | 'down' | 'up';
const TABLE_2A: Record<string, readonly Cell[]> = {
  //      A       B       C     D       E       F  G  H  J  K   L   M   N     P     Q     R
  '2.5': ['down', 'down', 0, 'up', 'down', 1, 2, 3, 5, 7, 10, 14, 21, 'up', 'up', 'up'],
  '4.0': ['down', 0, 'up', 'down', 1, 2, 3, 5, 7, 10, 14, 21, 'up', 'up', 'up', 'up'],
  '6.5': [0, 'up', 'down', 1, 2, 3, 5, 7, 10, 14, 21, 'up', 'up', 'up', 'up', 'up'],
  '1.5': ['down', 'down', 'down', 0, 'up', 'down', 1, 2, 3, 5, 7, 10, 14, 21, 'up', 'up'],
  '1.0': ['down', 'down', 'down', 'down', 0, 'up', 'down', 1, 2, 3, 5, 7, 10, 14, 21, 'up'],
};

export function codeLetter(lotSize: number): string {
  if (!Number.isInteger(lotSize) || lotSize < 2) return 'A';
  return LEVEL_II.find(([max]) => lotSize <= max)![1];
}

export interface Plan {
  letter: string;
  sampleSize: number;
  accept: number;
}

/**
 * The single sampling plan for a lot and an AQL (percent). AQL 0 is "no defect accepted": the level-II
 * sample with Ac = 0. Samples never exceed the lot (ISO: sample ≥ lot → 100 % inspection).
 */
export function plan(lotSize: number, aql: string): Plan {
  const letter = codeLetter(lotSize);
  const aqlKey = Number(aql).toFixed(1);
  if (Number(aql) === 0) return { letter, sampleSize: Math.min(SAMPLE_SIZE[letter]!, lotSize), accept: 0 };
  const column = TABLE_2A[aqlKey];
  if (!column) throw new RangeError(`AQL ${aql} is not in the table`);
  let i = LETTERS.indexOf(letter as (typeof LETTERS)[number]);
  for (let guard = 0; guard < LETTERS.length; guard++) {
    const cell = column[i]!;
    if (typeof cell === 'number') {
      const used = LETTERS[i]!;
      return { letter: used, sampleSize: Math.min(SAMPLE_SIZE[used]!, lotSize), accept: cell };
    }
    i += cell === 'down' ? 1 : -1;
  }
  throw new RangeError('no sampling plan found');
}

export interface SamplingRules {
  fullInspectionFromValue: string;
  sampledBandFromValue: string;
  sampledBandRatePct: string;
  trialFactoryJobs: number;
  trialFactoryRatePct: string;
  highDefectRateThresholdPct: string;
  highDefectWindowDays: number;
  highDefectRatePct: string;
  specialFinishOrFoodUpliftPp: string;
  aql: { critical: string; major: string; minor: string };
}

export type InspectionReasonKey =
  'value_100_pct' | 'value_band_sample' | 'trial_factory' | 'high_defect_factory' | 'special_finish_or_food';

export interface RiskFacts {
  orderValue: number;
  priorFactoryJobs: number;
  factoryDefectRatePct: number;
  specialFinishOrFood: boolean;
}

/**
 * D-076 inspection rate: the highest of the triggered rates (value ≥ full → 100 %, value band → 20 %,
 * trial factory → 100 %, high defect factory → 50 %) plus the special-finish / food-contact uplift (+20 pp)
 * when any rate applies, capped at 100 %. No trigger → 0 (no inspection).
 */
export function inspectionRate(
  facts: RiskFacts,
  rules: SamplingRules,
): { ratePct: number; reasons: InspectionReasonKey[] } {
  const reasons: InspectionReasonKey[] = [];
  let rate = 0;
  const raise = (reason: InspectionReasonKey, pct: number) => {
    reasons.push(reason);
    rate = Math.max(rate, pct);
  };
  if (facts.orderValue >= Number(rules.fullInspectionFromValue)) raise('value_100_pct', 100);
  else if (facts.orderValue >= Number(rules.sampledBandFromValue))
    raise('value_band_sample', Number(rules.sampledBandRatePct));
  if (facts.priorFactoryJobs < rules.trialFactoryJobs)
    raise('trial_factory', Number(rules.trialFactoryRatePct));
  if (facts.factoryDefectRatePct > Number(rules.highDefectRateThresholdPct))
    raise('high_defect_factory', Number(rules.highDefectRatePct));
  if (facts.specialFinishOrFood) {
    reasons.push('special_finish_or_food');
    rate += Number(rules.specialFinishOrFoodUpliftPp);
  }
  return { ratePct: Math.min(rate, 100), reasons };
}
