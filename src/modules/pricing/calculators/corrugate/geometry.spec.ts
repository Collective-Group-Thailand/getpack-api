import vectors from '../../../../../test/golden/corrugate/reference/geometry.vectors.json';
import { phpRound } from '../../engine/php';
import { PricingError } from '../shared/pricing-error';
import {
  blank,
  type ConditionBands,
  type CorrugateFormula,
  type FluteFactors,
  isRsc,
  type PrintArea,
  printAreaPercent,
  type RscLimits,
} from './geometry';

/**
 * Corrugate geometry (U-B6 slice 3) against vectors derived from the PHP by an independent transcription
 * (`test/golden/corrugate/reference/geometry_reference.py`, organised by legacy pattern / sub id). Fake flutes
 * and bands; each vector names its legacy case in `formula` (port map §6.1).
 */

const FLUTES: Record<string, FluteFactors> = {
  B: { a: 3, c: 4, dd: 5, g: 35, fh: 3, ct: 2, z: 0.5 },
  BC: { a: 6, c: 8, dd: 10, g: 40, fh: 6, ct: 4, z: 1 },
};
const BANDS: ConditionBands = {
  i: [
    { lower: 0, upper: 200, value: 10 },
    { lower: 200.0001, upper: 9999, value: 15 },
  ],
  j: [
    { lower: 0, upper: 0.5, value: 1 },
    { lower: 0.5001, upper: 10, value: 0 },
  ],
  k: [{ lower: 0, upper: 9999, value: 5 }],
  m: [{ lower: 0, upper: 9999, value: 1 }],
};

interface Vector {
  formula: string;
  w: number;
  l: number;
  d: number;
  flute: string;
  plus: { dl: number; dw: number } | null;
  expect: Record<'w' | 'l' | 'd' | 'dw' | 'dl' | 'areaRaw', number> &
    Record<'flap' | 'slh' | 'odl' | 'odw' | 'odh', number | null>;
  pct: Record<string, number>;
}

const part = (v: Vector) =>
  blank({
    formula: v.formula as CorrugateFormula,
    w: v.w,
    l: v.l,
    d: v.d,
    flute: FLUTES[v.flute]!,
    conditions: BANDS,
    plus: v.plus,
  });

describe('corrugate blank geometry (CalculatorCorrugate::calculate:297-481)', () => {
  it('covers every formula', () => {
    const formulas = new Set((vectors as Vector[]).map((v) => v.formula));
    expect(formulas.size).toBe(16);
  });

  it.each((vectors as Vector[]).map((v, n) => [`${n + 1} ${v.formula} ${v.w}×${v.l}×${v.d} ${v.flute}`, v]))(
    '%s',
    (_name, v) => {
      const b = part(v);
      const e = v.expect;
      expect([b.w, b.l, b.d]).toEqual([e.w, e.l, e.d]);
      expect(b.dw).toBeCloseTo(e.dw, 9);
      expect(b.dl).toBeCloseTo(e.dl, 9);
      expect([b.flap, b.slh, b.odl, b.odw, b.odh]).toEqual([e.flap, e.slh, e.odl, e.odw, e.odh]);
      expect(b.areaSqm).toBe(phpRound(e.areaRaw, 4));
    },
  );

  it('reads condition bands only for the formulas that use them, and refuses a missing one (quirks C3, C4)', () => {
    const rsc = { formula: 'rsc' as const, w: 300, l: 400, d: 250, flute: FLUTES['B']!, plus: null };
    expect(() => blank({ ...rsc, conditions: {} })).not.toThrow();
    const openTop = { ...rsc, formula: 'open_top' as const };
    expect(() => blank({ ...openTop, conditions: { ...BANDS, i: undefined } })).toThrow(
      new PricingError('geometry_condition_missing', 'condition i'),
    );
    expect(() => blank({ ...openTop, w: 99999, conditions: BANDS })).toThrow(PricingError);
    // Handles read j, k, m but not i (`:387, :395`).
    expect(() =>
      blank({ ...openTop, formula: 'handle', w: 180, l: 300, conditions: { ...BANDS, i: undefined } }),
    ).not.toThrow();
  });

  it('looks j up by W ÷ L, bands inclusive on both ends (`:310, :2044-2045`)', () => {
    const at = (w: number) =>
      blank({ formula: 'open_top', w, l: 400, d: 120, flute: FLUTES['B']!, conditions: BANDS, plus: null });
    // W 200 ÷ L 400 = 0.5 is inside the first j band (value 1); W 200 is inside the first i band (value 10).
    expect(at(200).j).toBe(1);
    expect(at(200).i).toBe(10);
    expect(at(201).j).toBe(0);
  });
});

describe('RSC or die-cut (CalculatorCorrugate::calculate:613-660)', () => {
  const limits: RscLimits = {
    plRscMinIn: 20,
    plRscMaxIn: 80,
    pwRscMinIn: 10,
    pwRscMaxIn: 40,
    minRscFlapMm: 100,
    minRscSlhMm: 100,
    minSllMm: 200,
    minSlwMm: 150,
  };
  const b = blank({
    formula: 'rsc',
    w: 301,
    l: 405,
    d: 250,
    flute: FLUTES['B']!,
    conditions: {},
    plus: null,
  });

  it('makes a pattern-19 blank inside every limit RSC', () => {
    // dL 1456 mm = 57.3 in, dW 563 mm = 22.2 in, flap 154, SLH 255, SLL 408, SLW 304.
    expect(isRsc('rsc', b, FLUTES['B']!, limits)).toBe(true);
  });

  it.each([
    ['blank too long', { plRscMaxIn: 57 }],
    ['blank too narrow', { pwRscMinIn: 23 }],
    ['flap too short', { minRscFlapMm: 155 }],
    ['SLH too short', { minRscSlhMm: 256 }],
    ['SLL too short', { minSllMm: 409 }],
    ['SLW too short', { minSlwMm: 305 }],
  ])('makes it die-cut when the %s', (_why, change) => {
    expect(isRsc('rsc', b, FLUTES['B']!, { ...limits, ...change })).toBe(false);
  });

  it('never makes another formula RSC, even inside the limits (legacy tests pattern 19 only)', () => {
    expect(isRsc('full_overlap', b, FLUTES['B']!, limits)).toBe(false);
  });
});

describe('print-area percentages (calculate_percent_from_pattern_area:1798-1954)', () => {
  const areas: PrintArea[] = ['top', 'side', 'top_side', 'all_round'];

  it.each((vectors as Vector[]).map((v) => [v.formula, v]))(
    '%s: every area × method × factory-4 rule',
    (_f, v) => {
      const vector = v;
      const b = part(vector);
      for (const area of areas) {
        for (const method of [1, 2]) {
          for (const combined of [false, true]) {
            const got = printAreaPercent(vector.formula as CorrugateFormula, b, FLUTES[vector.flute]!, area, {
              method,
              topSideCombined: combined,
            });
            expect({ area, method, combined, got }).toEqual({
              area,
              method,
              combined,
              got: expect.closeTo(vector.pct[`${area}:${method}:${combined ? 1 : 0}`]!, 9) as number,
            });
          }
        }
      }
    },
  );

  it('prints 0 % on the sides of tuck boxes when the factory has no side-area method (legacy returns nothing)', () => {
    const b = blank({
      formula: 'single_tuck',
      w: 150,
      l: 220,
      d: 90,
      flute: FLUTES['B']!,
      conditions: {},
      plus: null,
    });
    expect(
      printAreaPercent('single_tuck', b, FLUTES['B']!, 'side', { method: 0, topSideCombined: false }),
    ).toBe(0);
    expect(
      printAreaPercent('single_tuck', b, FLUTES['B']!, 'all_round', { method: 0, topSideCombined: false }),
    ).toBe(100);
  });
});
