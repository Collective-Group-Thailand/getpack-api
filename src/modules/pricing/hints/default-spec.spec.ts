import {
  defaultSizeIndex,
  defaultSpecConfiguration,
  defaultSpecQuantity,
  selectedOptionIds,
  withSpecDefaults,
} from './default-spec';

const reference = {
  patternId: 'pattern',
  l: 140,
  w: 97.5,
  d: 60,
  materialId: 'ka125',
  difficultyLevelId: 'normal',
  quantities: [300],
  parts: [{ printFront: [{ inkColourId: 'cmyk', area: 'top' }], coatingFrontId: 'varnish' }],
  design: { graphic: false, structure: false },
};

describe('the default spec (D-441)', () => {
  it('is the reference configuration bound to its product, at its one quantity', () => {
    const spec = defaultSpecConfiguration(reference, 'product-1');
    expect(spec).toMatchObject({ ...reference, catalogProductId: 'product-1' });
    expect(defaultSpecQuantity(spec)).toBe(300);
    expect(defaultSpecConfiguration(null, 'product-1')).toBeNull();
    expect(defaultSpecQuantity(null)).toBeNull();
  });

  it('collects the option ids it selects, at any depth, not the product, pattern, part or difficulty', () => {
    const ids = selectedOptionIds({
      ...defaultSpecConfiguration(reference, 'product-1')!,
      printFront: { inkColourIds: ['spot-1', 'spot-2'] },
      parts: [{ subPatternId: 'lid', assemblies: [{ assemblyId: 'window' }] }],
    });
    expect([...ids].sort()).toEqual(['ka125', 'spot-1', 'spot-2', 'window']);
  });

  it('marks exactly the selected options as defaults; a group with nothing selected has none', () => {
    const groups = [
      {
        kind: 'material',
        options: [
          { id: 'ka125', isDefault: false },
          { id: 'kt125', isDefault: true },
        ],
      },
      {
        kind: 'ink_colour',
        options: [
          { id: 'black', isDefault: true },
          { id: 'cmyk', isDefault: false },
        ],
      },
      { kind: 'finish', options: [{ id: 'matt', isDefault: true }] },
    ];
    const out = withSpecDefaults(groups, defaultSpecConfiguration(reference, 'p'));
    expect(out.map((g) => g.options.filter((o) => o.isDefault).map((o) => o.id))).toEqual([
      ['ka125'],
      ['cmyk'],
      [],
    ]);
    // Without a default spec the admin's flags stand.
    expect(withSpecDefaults(groups, null)).toBe(groups);
  });

  it('finds the standard size it is (length × width × height = l × w × d)', () => {
    const sizes = [
      { lengthMm: 170, widthMm: 110, heightMm: 60 },
      { lengthMm: 140, widthMm: 97.5, heightMm: 60 },
    ];
    expect(defaultSizeIndex(sizes, reference)).toBe(1);
    expect(defaultSizeIndex(sizes, { ...reference, l: 150 })).toBe(-1);
    expect(defaultSizeIndex([{ lengthMm: 90, widthMm: 55, heightMm: 0 }], { l: 90, w: 55 })).toBe(0);
    expect(defaultSizeIndex(sizes, null)).toBe(-1);
  });
});
