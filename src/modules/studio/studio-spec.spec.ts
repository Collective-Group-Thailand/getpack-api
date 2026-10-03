import {
  changeReasons,
  specHash,
  type StudioBox,
  studioConfiguration,
  type StudioInput,
} from './studio-spec';

const BOX: StudioBox = {
  styleVariantCode: 'PK-TE-01-K7QD',
  lengthMm: 100,
  widthMm: 60,
  heightMm: 40,
  measurementBasis: 'internal',
  materialId: 'm1',
  printMethod: 'digital',
  printSides: 'outside',
  finishes: [],
};
const SPEC = {
  patternId: 'p1',
  materialId: 'm1',
  parts: [{ printFront: [{ colourId: 'c' }], printBack: [] }],
};

describe('studio spec (D-277)', () => {
  it('fills the configuration from the box and sorts the quantities', () => {
    const { configuration, problems } = studioConfiguration(BOX, SPEC, 'p1', [5000, 1000]);
    expect(problems).toEqual([]);
    expect(configuration).toMatchObject({
      patternId: 'p1',
      l: 100,
      w: 60,
      d: 40,
      basis: 'internal',
      styleVariantCode: 'PK-TE-01-K7QD',
      quantities: [1000, 5000],
    });
  });

  it('refuses a spec that is not the box', () => {
    const { problems } = studioConfiguration(
      { ...BOX, printSides: 'both' },
      { ...SPEC, materialId: 'm2', l: 120 },
      'p2',
      [1000],
    );
    expect(problems.map((p) => p.path).sort()).toEqual([
      'spec.l',
      'spec.materialId',
      'spec.parts',
      'spec.patternId',
    ]);
  });

  it('hashes equal inputs equally whatever the key order', () => {
    const a: StudioInput = {
      productTypeCode: 'folding_carton',
      configuration: { a: 1, b: [1, 2] },
      deliveryPostcode: null,
    };
    const b: StudioInput = {
      deliveryPostcode: null,
      configuration: { b: [1, 2], a: 1 },
      productTypeCode: 'folding_carton',
    };
    expect(specHash(a)).toBe(specHash(b));
    expect(specHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(specHash({ ...a, deliveryPostcode: '10110' })).not.toBe(specHash(a));
  });

  it('explains a change with reason codes', () => {
    const base: StudioInput = {
      productTypeCode: 'folding_carton',
      configuration: { ...SPEC, l: 100, w: 60, d: 40, quantities: [1000], difficultyLevelId: 'x' },
      deliveryPostcode: '10110',
    };
    const next: StudioInput = {
      ...base,
      configuration: {
        ...base.configuration,
        l: 120,
        quantities: [2000],
        difficultyLevelId: 'y',
        parts: [{ printFront: [{ colourId: 'c' }], printBack: [{ colourId: 'c' }], finish1FrontId: 'f' }],
      },
    };
    expect(changeReasons(base, next)).toEqual([
      'size_changed',
      'print_changed',
      'finishes_changed',
      'quantity_changed',
      'options_changed',
    ]);
    expect(changeReasons(base, base)).toEqual([]);
    expect(changeReasons(base, { ...base, deliveryPostcode: '50000' })).toEqual(['delivery_changed']);
  });
});
