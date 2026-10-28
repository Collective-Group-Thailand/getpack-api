import {
  FIT_CLEARANCE_MM,
  fitOf,
  fitRangeFromRecipe,
  hasFitRange,
  isFitRangeEmpty,
  parseProductSize,
  sameFitRange,
} from './style-fit';

const RANGE = {
  fitMinLMm: 50,
  fitMaxLMm: 300,
  fitMinWMm: 40,
  fitMaxWMm: 200,
  fitMinHMm: 20,
  fitMaxHMm: 150,
};

describe('style fit rule (DECISIONS-STAGE-A §4)', () => {
  it('adds 0.5 cm to every dimension', () => {
    expect(FIT_CLEARANCE_MM).toBe(5);
    expect(fitOf(RANGE, { l: 100, w: 80, h: 50 })).toEqual({ insideLMm: 105, insideWMm: 85, insideHMm: 55 });
  });

  it('turns the product on the base when only the rotated L/W fits', () => {
    // 250 wide does not fit a 200 mm max width, but it fits as the length.
    expect(fitOf(RANGE, { l: 100, w: 250, h: 50 })).toEqual({
      insideLMm: 255,
      insideWMm: 105,
      insideHMm: 55,
    });
  });

  it('never rotates the height', () => {
    expect(fitOf(RANGE, { l: 100, w: 80, h: 146 })).toBeNull();
    expect(fitOf(RANGE, { l: 100, w: 80, h: 145 })).not.toBeNull();
  });

  it('checks the minimum too, after the clearance', () => {
    expect(fitOf(RANGE, { l: 100, w: 80, h: 14 })).toBeNull();
    expect(fitOf(RANGE, { l: 100, w: 80, h: 15 })).not.toBeNull();
  });

  it('leaves out a style with any bound missing', () => {
    expect(hasFitRange({ ...RANGE, fitMaxHMm: null })).toBe(false);
    expect(fitOf({ ...RANGE, fitMaxHMm: null }, { l: 100, w: 80, h: 50 })).toBeNull();
  });

  it('parses LxWxH in millimetres and refuses anything else', () => {
    expect(parseProductSize('200x150x80')).toEqual({ l: 200, w: 150, h: 80 });
    expect(parseProductSize('200.5X150x80')).toEqual({ l: 200.5, w: 150, h: 80 });
    expect(parseProductSize('0x150x80')).toBeNull();
    expect(parseProductSize('20x15')).toBeNull();
    expect(parseProductSize('-1x2x3')).toBeNull();
  });
});

describe('fit range from an approved recipe (C0b, DECISIONS-STAGE-A §9.1)', () => {
  const full = (minL: number, maxL: number, minW: number, maxW: number, minH: number, maxH: number) => ({
    minL,
    maxL,
    minW,
    maxW,
    minH,
    maxH,
  });

  it("takes the style's own material class", () => {
    expect(
      fitRangeFromRecipe('corrugated', {
        corrugated: full(600, 1300, 500, 1200, 300, 1200),
        paperboard: full(10, 20, 10, 20, 10, 20),
      }),
    ).toEqual({
      fitMinLMm: 600,
      fitMaxLMm: 1300,
      fitMinWMm: 500,
      fitMaxWMm: 1200,
      fitMinHMm: 300,
      fitMaxHMm: 1200,
    });
  });

  it('otherwise the range every complete class allows, in whole mm, never wider than the recipe', () => {
    expect(
      fitRangeFromRecipe('food_board', {
        paperboard: full(42.0012, 300.7, 30, 200, 20.2, 150),
        corrugated: full(50, 400, 25.5, 180, 20, 160),
      }),
    ).toEqual({
      fitMinLMm: 50,
      fitMaxLMm: 300,
      fitMinWMm: 30,
      fitMaxWMm: 180,
      fitMinHMm: 21,
      fitMaxHMm: 150,
    });
  });

  it('gives nothing for an incomplete, empty or contradictory range', () => {
    const noH = { minL: 60, maxL: 1200, minW: 60, maxW: 1000, minH: null, maxH: null };
    expect(fitRangeFromRecipe('corrugated', { corrugated: noH })).toBeNull();
    expect(fitRangeFromRecipe('corrugated', {})).toBeNull();
    expect(fitRangeFromRecipe('corrugated', null)).toBeNull();
    expect(
      fitRangeFromRecipe('x', { a: full(10, 20, 10, 20, 10, 20), b: full(30, 40, 10, 20, 10, 20) }),
    ).toBeNull();
  });

  it('caps a maximum at the admin bound (5000 mm)', () => {
    expect(fitRangeFromRecipe('c', { c: full(10, 9000, 10, 20, 10, 20) })?.fitMaxLMm).toBe(5000);
  });

  it('compares and empties ranges', () => {
    const empty = {
      fitMinLMm: null,
      fitMaxLMm: null,
      fitMinWMm: null,
      fitMaxWMm: null,
      fitMinHMm: null,
      fitMaxHMm: null,
    };
    expect(isFitRangeEmpty(empty)).toBe(true);
    expect(isFitRangeEmpty({ ...empty, fitMaxHMm: 3 })).toBe(false);
    expect(sameFitRange(RANGE, { ...RANGE })).toBe(true);
    expect(sameFitRange(RANGE, { ...RANGE, fitMaxHMm: 151 })).toBe(false);
  });
});
