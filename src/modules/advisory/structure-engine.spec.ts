import { type AdvisoryRuleSet } from '@platform/settings/setting-keys';
import fc from 'fast-check';

import {
  FRAGILITY_BANDS,
  HUMIDITY_BANDS,
  PALLET_PATTERNS,
  parseRuleSet,
  RuleSetError,
  STORAGE_BANDS,
  TRANSPORT_MODES,
} from './rule-set';
import { type AdvisoryLoadInputs, type CandidateBoard, evaluate, GRAVITY } from './structure-engine';

/** Test rule set (same shape as the proposal in docs/advisory-validation.md; values only for the tests). */
const RULES: AdvisoryRuleSet = {
  mckeeConstant: '5.87',
  uncertaintyPct: '15',
  formulas: ['rsc', 'full_overlap'],
  thinMarginPct: '10',
  factors: {
    humidity: { dry: '1', normal: '0.8', humid: '0.6', very_humid: '0.5' },
    storage: { up_to_10_days: '0.63', up_to_30_days: '0.6', up_to_90_days: '0.55', over_90_days: '0.5' },
    palletPattern: { none: '0.85', column: '0.9', interlocked: '0.55' },
    palletOverhang: { none: '1', overhang: '0.7' },
    transport: { pickup: '1', parcel_domestic: '0.7', pallet_domestic: '0.85', sea_export: '0.75' },
    fragility: { low: '1', medium: '0.9', high: '0.8' },
  },
};
const rules = parseRuleSet(RULES);
const BOX = { l: 400, w: 300, d: 250 };

const board = (
  id: string,
  ect: number,
  unitPrice: string | null,
  extra: Partial<CandidateBoard> = {},
): CandidateBoard => ({
  materialId: id,
  sheet: { sheetId: `s-${id}`, ectKnPerM: ect, caliperMm: 3, grammageGsm: 500 },
  blankAreaSqm: 0.8,
  price: { instant: unitPrice !== null, unitPrice, grossAmount: unitPrice, leadTimeDays: 10 },
  ...extra,
});

const INPUTS: AdvisoryLoadInputs = {
  productWeightG: 500,
  unitsPerBox: 10,
  stackLayers: 4,
  pallet: { pattern: 'column', overhang: false },
  fragility: 'low',
  transportMode: 'pallet_domestic',
  humidity: 'normal',
  storage: 'up_to_30_days',
};

describe('Structure Advisor engine (U2.2, D-239)', () => {
  it('computes the simplified McKee range and the requirement from the factors', () => {
    const out = evaluate(INPUTS, BOX, [board('a', 7, '10.00')], rules);
    const estimate = 5.87 * 7 * Math.sqrt(3 * 1400);
    expect(out.options[0]!.bctN.estimate).toBeCloseTo(estimate, 0);
    expect(out.options[0]!.bctN.low).toBeCloseTo(estimate * 0.85, 0);
    expect(out.options[0]!.bctN.high).toBeCloseTo(estimate * 1.15, 0);
    const boxKg = 5 + 0.8 * 0.5;
    const required = (3 * boxKg * GRAVITY) / (0.8 * 0.6 * 0.9 * 1 * 0.85 * 1);
    expect(out.requirement.requiredBctN).toBeCloseTo(required, 0);
    expect(out.requirement.factors.map((f) => f.factor)).toEqual([
      'humidity',
      'storage',
      'palletPattern',
      'palletOverhang',
      'transport',
      'fragility',
    ]);
    expect(out.reasons.filter((r) => r.code === 'factor')).toHaveLength(6);
  });

  it('recommends the cheapest passing board, lists the strongest and fastest as alternatives with deltas', () => {
    const boards = [
      board('weak', 3, '8.00'),
      board('mid', 6, '10.00'),
      board('strong', 12, '14.50', {
        price: { instant: true, unitPrice: '14.50', grossAmount: null, leadTimeDays: 7 },
      }),
    ];
    const out = evaluate({ ...INPUTS, productWeightG: 1000, stackLayers: 6 }, BOX, boards, rules);
    expect(out.outcome).toBe('recommended');
    expect(out.recommendedMaterialId).toBe('mid');
    expect(out.alternatives).toEqual([
      {
        materialId: 'strong',
        roles: ['strongest', 'fastest'],
        unitPriceDelta: '4.50',
        leadTimeDeltaDays: -3,
      },
    ]);
    expect(out.options.find((o) => o.materialId === 'weak')!.warnings).toEqual(['below_requirement']);
  });

  it('never recommends a board without a sheet, and lists it as excluded (D-188)', () => {
    const out = evaluate(
      INPUTS,
      BOX,
      [board('nodata', 50, '1.00', { sheet: null }), board('a', 7, '9.00')],
      rules,
    );
    expect(out.recommendedMaterialId).toBe('a');
    expect(out.excluded).toEqual([{ materialId: 'nodata', reason: 'no_board_data' }]);
    expect(out.options.map((o) => o.materialId)).toEqual(['a']);
  });

  it('makes no recommendation when nothing passes and shows the strongest as the closest', () => {
    const out = evaluate(
      { ...INPUTS, productWeightG: 5000, stackLayers: 20 },
      BOX,
      [board('a', 4, '9.00'), board('b', 6, '12.00')],
      rules,
    );
    expect(out.outcome).toBe('no_board_meets_load');
    expect(out.recommendedMaterialId).toBeNull();
    expect(out.closestMaterialId).toBe('b');
    expect(out.warnings).toEqual(['no_board_meets_load']);
  });

  it('falls back to the weakest passing board when no passing board has an instant price', () => {
    const out = evaluate(
      INPUTS,
      BOX,
      [board('a', 6, null), board('b', 9, null), board('c', 1, '1.00')],
      rules,
    );
    expect(out.recommendedMaterialId).toBe('a');
    expect(out.reasons.some((r) => r.code === 'no_instant_price')).toBe(true);
  });

  it('warns thin_margin when the low end clears the requirement by less than the threshold', () => {
    const low = 5.87 * 5 * Math.sqrt(3 * 1400) * 0.85;
    // Choose a weight so that the requirement is 95 % of the low end.
    const combined = 0.8 * 0.6 * 0.9 * 0.85;
    const boxKg = (low * 0.95 * combined) / (3 * GRAVITY);
    const productWeightG = ((boxKg - 0.4) / 10) * 1000;
    const out = evaluate({ ...INPUTS, productWeightG }, BOX, [board('a', 5, '9.00')], rules);
    expect(out.recommendedMaterialId).toBe('a');
    expect(out.warnings).toEqual(['thin_margin']);
  });

  const inputs = fc.record<AdvisoryLoadInputs>({
    productWeightG: fc.integer({ min: 1, max: 5000 }),
    unitsPerBox: fc.integer({ min: 1, max: 50 }),
    stackLayers: fc.integer({ min: 1, max: 25 }),
    pallet: fc.option(fc.record({ pattern: fc.constantFrom(...PALLET_PATTERNS), overhang: fc.boolean() }), {
      nil: null,
    }),
    fragility: fc.constantFrom(...FRAGILITY_BANDS),
    transportMode: fc.constantFrom(...TRANSPORT_MODES),
    humidity: fc.constantFrom(...HUMIDITY_BANDS),
    storage: fc.constantFrom(...STORAGE_BANDS),
  });
  const boards = fc
    .uniqueArray(
      fc.record({
        id: fc.stringMatching(/^[a-z]{1,6}$/),
        ect: fc.double({ min: 2, max: 25, noNaN: true }),
        caliper: fc.double({ min: 1.5, max: 10, noNaN: true }),
        gsm: fc.integer({ min: 200, max: 1500 }),
        price: fc.option(fc.integer({ min: 100, max: 5000 }), { nil: null }),
        lead: fc.integer({ min: 3, max: 20 }),
        data: fc.boolean(),
      }),
      { minLength: 1, maxLength: 8, selector: (b) => b.id },
    )
    .map((list) =>
      list.map((b): CandidateBoard => ({
        materialId: b.id,
        sheet: b.data
          ? { sheetId: `s-${b.id}`, ectKnPerM: b.ect, caliperMm: b.caliper, grammageGsm: b.gsm }
          : null,
        blankAreaSqm: 0.8,
        price: {
          instant: b.price !== null,
          unitPrice: b.price === null ? null : (b.price / 100).toFixed(2),
          grossAmount: null,
          leadTimeDays: b.price === null ? null : b.lead,
        },
      })),
    );
  const lowOf = (out: ReturnType<typeof evaluate>, id: string | null) =>
    id === null ? null : out.options.find((o) => o.materialId === id)!.bctN.low;

  it('never recommends a weaker board for a heavier or taller stack (property)', () => {
    fc.assert(
      fc.property(
        inputs,
        boards,
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 0, max: 10 }),
        (base, list, extraG, extraLayers) => {
          const light = evaluate(base, BOX, list, rules);
          const heavy = evaluate(
            {
              ...base,
              productWeightG: base.productWeightG + extraG,
              stackLayers: base.stackLayers + extraLayers,
            },
            BOX,
            list,
            rules,
          );
          if (light.recommendedMaterialId === null) {
            expect(heavy.recommendedMaterialId).toBeNull();
            return;
          }
          if (heavy.recommendedMaterialId === null) return;
          expect(lowOf(heavy, heavy.recommendedMaterialId)!).toBeGreaterThanOrEqual(
            lowOf(light, light.recommendedMaterialId)!,
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  it('keeps every range ordered, recommends only boards with data that pass, and is reproducible (property)', () => {
    fc.assert(
      fc.property(inputs, boards, (i, list) => {
        const out = evaluate(i, BOX, list, rules);
        for (const o of out.options) {
          expect(o.bctN.low).toBeLessThanOrEqual(o.bctN.estimate);
          expect(o.bctN.estimate).toBeLessThanOrEqual(o.bctN.high);
        }
        if (out.recommendedMaterialId !== null) {
          const rec = out.options.find((o) => o.materialId === out.recommendedMaterialId)!;
          expect(rec.passes).toBe(true);
          expect(list.find((b) => b.materialId === rec.materialId)!.sheet).not.toBeNull();
        }
        // A replay from the logged JSON gives the same output (D-240).
        const replay = evaluate(
          JSON.parse(JSON.stringify(i)) as AdvisoryLoadInputs,
          BOX,
          JSON.parse(JSON.stringify(list)) as CandidateBoard[],
          parseRuleSet(JSON.parse(JSON.stringify(RULES)) as AdvisoryRuleSet),
        );
        expect(replay).toEqual(out);
      }),
      { numRuns: 300 },
    );
  });
});

describe('advisory rule set (D-237)', () => {
  it('refuses a zero or missing factor and an empty style list', () => {
    const zero = structuredClone(RULES);
    zero.factors.humidity.dry = '0';
    expect(() => parseRuleSet(zero)).toThrow(RuleSetError);
    const missing = structuredClone(RULES) as unknown as { factors: { storage: Record<string, string> } };
    delete missing.factors.storage['over_90_days'];
    expect(() => parseRuleSet(missing as unknown as AdvisoryRuleSet)).toThrow(RuleSetError);
    expect(() => parseRuleSet({ ...RULES, formulas: [] })).toThrow(RuleSetError);
  });
});
