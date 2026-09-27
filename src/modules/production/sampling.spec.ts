import { codeLetter, inspectionRate, plan, type SamplingRules } from './sampling';

const RULES: SamplingRules = {
  fullInspectionFromValue: '300000.00',
  sampledBandFromValue: '100000.00',
  sampledBandRatePct: '20',
  trialFactoryJobs: 3,
  trialFactoryRatePct: '100',
  highDefectRateThresholdPct: '3',
  highDefectWindowDays: 90,
  highDefectRatePct: '50',
  specialFinishOrFoodUpliftPp: '20',
  aql: { critical: '0', major: '2.5', minor: '4.0' },
};
const facts = (over: Partial<Parameters<typeof inspectionRate>[0]> = {}) => ({
  orderValue: 50_000,
  priorFactoryJobs: 10,
  factoryDefectRatePct: 0,
  specialFinishOrFood: false,
  ...over,
});

describe('ISO 2859-1 sampling (D-076)', () => {
  it('maps lot sizes to level II code letters (Table 1)', () => {
    expect([2, 8, 9, 50, 51, 500, 501, 1200, 1201, 3200, 10_001, 500_001].map(codeLetter)).toEqual([
      'A',
      'A',
      'B',
      'D',
      'E',
      'H',
      'J',
      'J',
      'K',
      'K',
      'M',
      'Q',
    ]);
  });

  it('reads Table 2-A, following arrows to the next plan and its sample size', () => {
    expect(plan(1000, '2.5')).toEqual({ letter: 'J', sampleSize: 80, accept: 5 });
    expect(plan(1000, '4.0')).toEqual({ letter: 'J', sampleSize: 80, accept: 7 });
    expect(plan(1000, '0')).toEqual({ letter: 'J', sampleSize: 80, accept: 0 });
    // E at 2.5 is an arrow down → F (n = 20, Ac 1); D at 2.5 an arrow up → C (n = 5, Ac 0).
    expect(plan(60, '2.5')).toEqual({ letter: 'F', sampleSize: 20, accept: 1 });
    expect(plan(40, '2.5')).toEqual({ letter: 'C', sampleSize: 5, accept: 0 });
    // Large lots: 2.5 stops at N (n = 500, Ac 21), 4.0 at M (n = 315, Ac 21).
    expect(plan(600_000, '2.5')).toEqual({ letter: 'N', sampleSize: 500, accept: 21 });
    expect(plan(600_000, '4.0')).toEqual({ letter: 'M', sampleSize: 315, accept: 21 });
    // A sample never exceeds the lot (100 % inspection).
    expect(plan(4, '2.5').sampleSize).toBe(4);
  });

  it('decides the inspection rate from the D-076 triggers', () => {
    expect(inspectionRate(facts(), RULES)).toEqual({ ratePct: 0, reasons: [] });
    expect(inspectionRate(facts({ orderValue: 300_000 }), RULES)).toEqual({
      ratePct: 100,
      reasons: ['value_100_pct'],
    });
    expect(inspectionRate(facts({ orderValue: 150_000 }), RULES)).toEqual({
      ratePct: 20,
      reasons: ['value_band_sample'],
    });
    expect(inspectionRate(facts({ priorFactoryJobs: 2 }), RULES)).toEqual({
      ratePct: 100,
      reasons: ['trial_factory'],
    });
    expect(inspectionRate(facts({ factoryDefectRatePct: 3.5 }), RULES)).toEqual({
      ratePct: 50,
      reasons: ['high_defect_factory'],
    });
    expect(inspectionRate(facts({ factoryDefectRatePct: 3 }), RULES).ratePct).toBe(0);
    expect(inspectionRate(facts({ orderValue: 150_000, specialFinishOrFood: true }), RULES)).toEqual({
      ratePct: 40,
      reasons: ['value_band_sample', 'special_finish_or_food'],
    });
    expect(inspectionRate(facts({ orderValue: 300_000, specialFinishOrFood: true }), RULES).ratePct).toBe(
      100,
    );
  });
});
