import { sizeRulesOf, sizeViolation } from './size-rules';

/** Pattern size rules on customer requests (legacy `Calculator::validateInput:471-518`, U-B6). */
describe('size rules', () => {
  const rules = sizeRulesOf({
    minW: 100,
    maxW: 800,
    minL: 100,
    maxL: 1000,
    minH: 50,
    maxH: 800,
    wMustExceedH: true,
  });

  it('reads the known constraint keys and ignores the rest', () => {
    expect(sizeRulesOf({ minW: 30, other: 'x', lMustExceedW: true })).toEqual({
      minWMm: 30,
      maxWMm: null,
      minLMm: null,
      maxLMm: null,
      minHMm: null,
      maxHMm: null,
      lengthMustExceedWidth: true,
      lengthMustExceedHeight: false,
      widthMustExceedHeight: false,
    });
    expect(sizeRulesOf(null).minWMm).toBeNull();
  });

  it.each([
    [{ w: 99, l: 400, d: 250 }, 'configuration.w'],
    [{ w: 300, l: 1001, d: 250 }, 'configuration.l'],
    [{ w: 300, l: 400, d: 40 }, 'configuration.d'],
    // Corrugate: the height at most 0.95 × the width (`:510`): 0.95 × 300 = 285.
    [{ w: 300, l: 400, d: 286 }, 'configuration.d'],
  ])('refuses %j on %s', (size, path) => {
    expect(sizeViolation(rules, size, { corrugate: true })?.path).toBe(path);
  });

  it('accepts a size inside the rules, and applies the 0.95 rule to corrugate only', () => {
    expect(sizeViolation(rules, { w: 300, l: 400, d: 285 }, { corrugate: true })).toBeNull();
    expect(sizeViolation(rules, { w: 300, l: 400, d: 286 }, { corrugate: false })).toBeNull();
  });

  it('checks the length against the width and the height when the pattern asks', () => {
    const tall = sizeRulesOf({ lMustExceedW: true, lMustExceedH: true });
    expect(sizeViolation(tall, { w: 300, l: 200, d: 100 }, { corrugate: false })?.message).toBe(
      'the length must be at least the width',
    );
    expect(sizeViolation(tall, { w: 100, l: 200, d: 300 }, { corrugate: false })?.message).toBe(
      'the length must be at least the height',
    );
  });

  it('checks a flat blank (tag & sleeve) on width and length only', () => {
    const tall = sizeRulesOf({ lMustExceedW: true, lMustExceedH: true });
    expect(sizeViolation(tall, { w: 300, l: 200, d: 0 }, { corrugate: false, flat: true })).toBeNull();
    expect(sizeViolation(rules, { w: 99, l: 400, d: 0 }, { corrugate: false, flat: true })?.path).toBe(
      'configuration.w',
    );
  });
});
