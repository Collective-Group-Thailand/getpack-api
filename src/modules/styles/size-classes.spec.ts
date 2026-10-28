import { bodyDiameter, insideFromParameters } from '@integrations/dieline/inside-rules';

import { remapRecipeBounds } from './fit-range-sources';
import { insideRuleOf, recipeParameterNames, sizeClassOf } from './size-classes';
import { fitOf } from './style-fit';

const recipe = (...params: (string | { ref: string })[]) => ({ engine: [{ params }] });

describe('size classes (C1e, DECISIONS-STAGE-A §13.2)', () => {
  it.each([
    ['PK-LA-01', recipe({ ref: 'diameter' }), 'not_applicable'],
    ['PK-LA-07', recipe({ ref: 'diameter' }, { ref: 'height' }), 'not_applicable'],
    ['PK-TG-02', recipe({ ref: 'topDiameter' }, { ref: 'height' }), 'not_applicable'],
    ['PK-TG-03', recipe('length', 'width', 'height'), 'not_applicable'],
    ['PK-SL-03', null, 'not_applicable'],
    ['PK-IN-02', null, 'not_applicable'],
    ['PK-CI-02', null, 'not_applicable'],
    ['PK-DS-04', null, 'not_applicable'],
    ['PK-SP-13', null, 'not_applicable'],
    ['PK-SP-12', recipe('length', 'height', 'spine'), 'not_applicable'],
    ['PK-PG-01', recipe({ ref: 'width' }, { ref: 'gusset' }, { ref: 'height' }), 'bag'],
    ['PK-PB-04', recipe({ ref: 'width' }, { ref: 'length' }, { ref: 'gusset' }), 'bag'],
    ['PK-SP-23', recipe({ ref: 'topDiameter' }, { ref: 'bottomDiameter' }, { ref: 'height' }), 'cylinder'],
    ['PK-RG-07', recipe({ ref: 'diameter' }, { ref: 'height' }), 'cylinder'],
    // A neck hole does not make a round body.
    ['PK-SP-18', recipe('length', 'width', 'height', 'neckDiameter'), 'box'],
    ['PK-TE-01', recipe('length', 'width', 'height'), 'box'],
    ['PK-TE-02', null, 'box'],
  ])('%s → %s', (code, r, expected) => {
    expect(sizeClassOf(code, r)).toBe(expected);
  });

  it('reads parameter names from strings and refs, across engine recipes', () => {
    expect(
      recipeParameterNames({ engine: [{ params: ['a', { ref: 'b' }] }, { params: ['a', 'c'] }] }),
    ).toEqual(['a', 'b', 'c']);
    expect(recipeParameterNames(null)).toEqual([]);
    expect(recipeParameterNames({ engine: 'x' })).toEqual([]);
  });

  it('maps classes to the engine inside rule', () => {
    expect(insideRuleOf('bag')).toBe('bag');
    expect(insideRuleOf('cylinder')).toBe('cylinder');
    expect(insideRuleOf('box')).toBe('parameters');
  });
});

describe('inside rules (C1e, inside-rules.ts)', () => {
  it('reads a bag as width × gusset × height', () => {
    expect(insideFromParameters('bag', { width: 180, gusset: 80, height: 230, length: 999 })).toEqual({
      length: 180,
      width: 80,
      height: 230,
    });
    expect(insideFromParameters('bag', { width: 120, length: 180 })).toEqual({
      length: 120,
      width: undefined,
      height: undefined,
    });
  });

  it('reads a cylinder as its diameter square × height, a tapered body by its smaller diameter', () => {
    expect(insideFromParameters('cylinder', { diameter: 80, height: 200 })).toEqual({
      length: 80,
      width: 80,
      height: 200,
    });
    expect(insideFromParameters('cylinder', { topDiameter: 90, bottomDiameter: 60, height: 110 })).toEqual({
      length: 60,
      width: 60,
      height: 110,
    });
    expect(bodyDiameter({ neckDiameter: 30 })).toBeNull();
  });

  it('reads anything else from its own length, width and height', () => {
    expect(insideFromParameters('parameters', { length: 1, width: 2, height: 3, gusset: 9 })).toEqual({
      length: 1,
      width: 2,
      height: 3,
    });
  });
});

describe('recipe range by size class (C1e)', () => {
  const stated = {
    fitMinLMm: { value: 1, basis: ['recipe_size_range' as const] },
    fitMinWMm: { value: 120, basis: ['recipe_size_range' as const] },
    fitMaxWMm: { value: 600, basis: ['recipe_size_range' as const] },
    fitMinHMm: { value: 150, basis: ['recipe_size_range' as const] },
    fitMaxHMm: { value: 700, basis: ['recipe_size_range' as const] },
  };
  it("takes a bag's width range as its length, never its own length; the gusset is not in the range", () => {
    expect(remapRecipeBounds('bag', stated)).toEqual({
      fitMinLMm: stated.fitMinWMm,
      fitMaxLMm: stated.fitMaxWMm,
      fitMinHMm: stated.fitMinHMm,
      fitMaxHMm: stated.fitMaxHMm,
    });
  });
  it("takes only a cylinder's height, and nothing for a not-applicable style", () => {
    expect(remapRecipeBounds('cylinder', stated)).toEqual({
      fitMinHMm: stated.fitMinHMm,
      fitMaxHMm: stated.fitMaxHMm,
    });
    expect(remapRecipeBounds('not_applicable', stated)).toEqual({});
    expect(remapRecipeBounds('box', stated)).toBe(stated);
  });
});

describe('fit by size class (C1e)', () => {
  const CUP = { fitMinLMm: 56, fitMaxLMm: 60, fitMinWMm: 56, fitMaxWMm: 60, fitMinHMm: 30, fitMaxHMm: 200 };
  it("fits the product's L × W inside the diameter square — the larger side + clearance is the diameter", () => {
    expect(fitOf(CUP, { l: 52, w: 20, h: 100 }, 'cylinder')).toEqual({
      insideLMm: 57,
      insideWMm: 57,
      insideHMm: 105,
    });
    expect(fitOf(CUP, { l: 20, w: 52, h: 100 }, 'cylinder')).toEqual({
      insideLMm: 57,
      insideWMm: 57,
      insideHMm: 105,
    });
    expect(fitOf(CUP, { l: 60, w: 20, h: 100 }, 'cylinder')).toBeNull();
    expect(fitOf(CUP, { l: 52, w: 20, h: 300 }, 'cylinder')).toBeNull();
  });
  it('never fits a style whose size search does not apply', () => {
    expect(fitOf(CUP, { l: 52, w: 52, h: 100 }, 'not_applicable')).toBeNull();
    expect(fitOf(CUP, { l: 52, w: 52, h: 100 }, 'bag')).toEqual({
      insideLMm: 57,
      insideWMm: 57,
      insideHMm: 105,
    });
  });
});
