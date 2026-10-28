import {
  classSpan,
  mergeFitRange,
  productionEnvelopeBounds,
  recipeBounds,
  standardSizeBounds,
  summarySource,
} from './fit-range-sources';

const COMPLETE = { minL: 60, maxL: 400, minW: 50.0015, maxW: 300, minH: 20, maxH: 450 };
const NONE = { length: null, width: null, height: null };

describe('fit-range fallback order (C1c, DECISIONS-STAGE-A §11.1)', () => {
  it('(a) keeps the C0b complete recipe range unchanged', () => {
    const merged = mergeFitRange({
      recipe: recipeBounds('paperboard', { paperboard: COMPLETE }),
      standard_sizes: standardSizeBounds([{ lengthMm: 1, widthMm: 1, heightMm: 1 }], null),
      production_envelope: {},
    });
    expect(merged.range).toEqual({
      fitMinLMm: 60,
      fitMaxLMm: 400,
      fitMinWMm: 51,
      fitMaxWMm: 300,
      fitMinHMm: 20,
      fitMaxHMm: 450,
    });
    expect(summarySource(merged.bounds!)).toBe('recipe');
  });

  it('(a) gives the bounds a partial recipe states for the own class only', () => {
    const b = recipeBounds('paperboard', { paperboard: { ...COMPLETE, minH: null, maxH: null } });
    expect(Object.keys(b).sort()).toEqual(['fitMaxLMm', 'fitMaxWMm', 'fitMinLMm', 'fitMinWMm']);
    // C0b rule kept: an incomplete own class falls back to what every complete class allows.
    const other = recipeBounds('paperboard', {
      paperboard: { minL: null, maxL: null, minW: null, maxW: null, minH: 30, maxH: 400 },
      corrugated: COMPLETE,
    });
    expect(other.fitMinHMm?.value).toBe(20);
    // Without a complete class, only the own class's stated bounds count.
    const own = recipeBounds('paperboard', {
      paperboard: { minL: null, maxL: null, minW: null, maxW: null, minH: 30, maxH: 400 },
      corrugated: { ...COMPLETE, minW: null },
    });
    expect(own.fitMinLMm).toBeUndefined();
    expect(own.fitMinHMm?.value).toBe(30);
  });

  it('(b) fills missing bounds from the standard sizes: catalogue sizes and recipe presets together', () => {
    const merged = mergeFitRange({
      recipe: recipeBounds('paperboard', { paperboard: { ...COMPLETE, minH: null, maxH: null } }),
      standard_sizes: standardSizeBounds(
        [
          { lengthMm: 120, widthMm: 80, heightMm: 25 },
          { lengthMm: 200, widthMm: 120, heightMm: 0 },
        ],
        { length: null, width: null, height: { min: 30, max: 35 } },
      ),
      production_envelope: {},
    });
    expect(merged.range).toMatchObject({ fitMinLMm: 60, fitMaxLMm: 400, fitMinHMm: 25, fitMaxHMm: 35 });
    expect(merged.bounds!.fitMinHMm).toEqual({
      source: 'standard_sizes',
      basis: ['catalogue_standard_sizes', 'recipe_presets'],
    });
    expect(summarySource(merged.bounds!)).toBe('combined');
  });

  it('(c) the production envelope is the narrowest of calculator rules and engine limits', () => {
    const env = productionEnvelopeBounds(
      { minLMm: 100, maxLMm: 1200, minWMm: 80, maxWMm: 800, minHMm: null, maxHMm: null },
      { length: { min: 40, max: 400 }, width: null, height: { min: 30, max: 400 } },
    );
    expect(env.fitMinLMm).toEqual({ value: 100, basis: ['calculator_size_rules', 'engine_limits'] });
    expect(env.fitMaxLMm).toEqual({ value: 400, basis: ['calculator_size_rules', 'engine_limits'] });
    expect(env.fitMaxWMm).toEqual({ value: 800, basis: ['calculator_size_rules'] });
    expect(env.fitMinHMm).toEqual({ value: 30, basis: ['engine_limits'] });
    const merged = mergeFitRange({ recipe: {}, standard_sizes: {}, production_envelope: env });
    expect(merged.range).toEqual({
      fitMinLMm: 100,
      fitMaxLMm: 400,
      fitMinWMm: 80,
      fitMaxWMm: 800,
      fitMinHMm: 30,
      fitMaxHMm: 400,
    });
    expect(summarySource(merged.bounds!)).toBe('production_envelope');
  });

  it('leaves a style empty when any bound is missing, and says which', () => {
    const merged = mergeFitRange({
      recipe: recipeBounds('paperboard', { paperboard: { minL: 5, maxL: 1000, minW: 5, maxW: 1000 } }),
      standard_sizes: standardSizeBounds([], NONE),
      production_envelope: productionEnvelopeBounds(null, NONE),
    });
    expect(merged.range).toBeNull();
    expect(merged.missing).toEqual(['fitMinHMm', 'fitMaxHMm']);
  });

  it('leaves a style empty when the given bounds leave no size', () => {
    const merged = mergeFitRange({
      recipe: { fitMinLMm: { value: 300, basis: ['recipe_size_range'] } },
      standard_sizes: standardSizeBounds([{ lengthMm: 100, widthMm: 100, heightMm: 100 }], null),
      production_envelope: {},
    });
    expect(merged.range).toBeNull();
    expect(merged.conflicting).toEqual(['length']);
  });

  it("takes the style's own class span, else what every class allows", () => {
    const spans = {
      paperboard: { length: { min: 40, max: 400 }, width: null, height: { min: 10, max: 50 } },
      corrugated: { length: { min: 60, max: 300 }, width: { min: 1, max: 2 }, height: { min: 20, max: 80 } },
    };
    expect(classSpan('paperboard', spans)).toBe(spans.paperboard);
    expect(classSpan('rigid', spans)).toEqual({
      length: { min: 60, max: 300 },
      width: null,
      height: { min: 20, max: 50 },
    });
    expect(classSpan('rigid', {})).toEqual(NONE);
  });
});
