import { optionValues, pricePath } from './publishability';

describe('pricePath (D-266, D-268)', () => {
  const options = { tuck_top: 'reverse_tuck', window: 'none', pouch_feat: ['zip', 'notch'] };

  it('lists the option values that need a price rule (none never does)', () => {
    expect(optionValues(options)).toEqual(['tuck_top:reverse_tuck', 'pouch_feat:zip', 'pouch_feat:notch']);
    expect(optionValues({ pouch_feat: [] })).toEqual([]);
  });

  it('is instant only with a calculator, an instant type and every option priced', () => {
    const rules = new Set(['tuck_top:reverse_tuck', 'pouch_feat:zip', 'pouch_feat:notch']);
    expect(pricePath({ calculatorKey: 'folding', instantType: true, options, rules })).toEqual({
      path: 'instant',
      reasons: [],
    });
    expect(
      pricePath({
        calculatorKey: 'folding',
        instantType: true,
        options,
        rules: new Set(['tuck_top:reverse_tuck']),
      }),
    ).toEqual({ path: 'rfq', reasons: ['option_not_priced'] });
    expect(pricePath({ calculatorKey: 'folding', instantType: false, options, rules })).toEqual({
      path: 'rfq',
      reasons: ['calculator_not_signed'],
    });
    expect(pricePath({ calculatorKey: null, instantType: false, options, rules })).toEqual({
      path: 'rfq',
      reasons: ['no_calculator'],
    });
  });
});
