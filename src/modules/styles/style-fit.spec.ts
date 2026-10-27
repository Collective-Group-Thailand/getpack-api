import { FIT_CLEARANCE_MM, fitOf, hasFitRange, parseProductSize } from './style-fit';

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
