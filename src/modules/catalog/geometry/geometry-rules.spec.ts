import { bandViolation, slotViolation } from './geometry-rules';

describe('geometry rules', () => {
  it('accepts bands that touch without sharing a bound, in any order', () => {
    expect(
      bandViolation([
        { lower: 100.01, upper: 200 },
        { lower: 0, upper: 100 },
      ]),
    ).toBeNull();
    expect(bandViolation([])).toBeNull();
  });

  it('refuses an inverted band and overlapping bands (inclusive bounds, like legacy)', () => {
    expect(bandViolation([{ lower: 5, upper: 4 }])).toMatchObject({ path: 'bands[0].upper', code: 'range' });
    expect(
      bandViolation([
        { lower: 0, upper: 100 },
        { lower: 100, upper: 200 },
      ]),
    ).toMatchObject({ path: 'bands[1]', code: 'overlap' });
  });

  it('reads corrugate slots by their own dimension, on the pattern only', () => {
    const at = (slot: 'i' | 'j', determinant: 'w' | 'w_over_l' | 'l', onPart = false) =>
      slotViolation('conditions[0]', { slot, determinant, onPart }, 'corrugate');
    expect(at('i', 'w')).toBeNull();
    expect(at('j', 'w_over_l')).toBeNull();
    expect(at('j', 'w')).toMatchObject({ path: 'conditions[0].conditionId', code: 'determinant' });
    expect(at('i', 'l')).toMatchObject({ code: 'determinant' });
    expect(at('i', 'w', true)).toMatchObject({ path: 'conditions[0].subPatternId' });
  });

  it('keeps each calculator to its own slots', () => {
    expect(slotViolation('c', { slot: 'dw', determinant: 'w', onPart: true }, 'folding')).toBeNull();
    expect(
      slotViolation('c', { slot: 'dw', determinant: 'w_over_l', onPart: false }, 'folding'),
    ).toMatchObject({
      code: 'determinant',
    });
    expect(slotViolation('c', { slot: 'i', determinant: 'w', onPart: false }, 'folding')).toMatchObject({
      path: 'c.slot',
      code: 'in',
    });
    expect(slotViolation('c', { slot: 'dw', determinant: 'w', onPart: false }, 'corrugate')).toMatchObject({
      code: 'in',
    });
    // A pattern of a type without a calculator still follows each slot's own reading.
    expect(slotViolation('c', { slot: 'k', determinant: 'w', onPart: false }, null)).toBeNull();
    expect(slotViolation('c', { slot: 'k', determinant: 'd', onPart: false }, null)).toMatchObject({
      code: 'determinant',
    });
  });
});
