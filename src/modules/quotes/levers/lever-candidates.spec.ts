import { leverCandidates, MAX_LEVER_CANDIDATES, nextQuantities } from './lever-candidates';

const BASE = {
  patternId: 'p',
  materialId: 'm1',
  w: 60,
  l: 40,
  d: 120,
  basis: 'internal',
  quantities: [500, 1000],
  parts: [
    {
      printFront: [{ inkColourId: 'k' }],
      printBack: [{ inkColourId: 'k' }],
      finish1FrontId: 'f1',
      finish2: [{ finishId: 'foil', amount: 1 }],
      assemblies: [{ assemblyId: 'glue' }],
    },
  ],
};
const CTX = { materialIds: ['m1', 'm2', 'm3'], quantityPresets: [], quantityMultipliers: [2, 5] };

describe('nextQuantities (D-248)', () => {
  it('takes the next two presets above the largest quoted quantity', () => {
    expect(
      nextQuantities([500, 1000], { quantityPresets: [3000, 500, 2000, 5000], quantityMultipliers: [2] }),
    ).toEqual([2000, 3000]);
  });

  it('falls back to the multipliers when no preset lies above', () => {
    expect(nextQuantities([1000], { quantityPresets: [500, 1000], quantityMultipliers: [5, 2] })).toEqual([
      2000, 5000,
    ]);
  });
});

describe('leverCandidates (D-248)', () => {
  const candidates = leverCandidates(BASE, CTX);
  const byKind = (k: string) => candidates.filter((c) => c.kind === k);

  it('offers every kind the configuration has, never touching style or size', () => {
    expect(candidates.map((c) => c.kind)).toEqual([
      'quantity',
      'quantity',
      'back_print',
      'special_finish',
      'coating',
      'assembly',
      'material',
      'material',
    ]);
    for (const c of candidates) {
      expect(c.configuration).toMatchObject({ patternId: 'p', w: 60, l: 40, d: 120, basis: 'internal' });
    }
  });

  it('describes each change and leaves the original configuration intact', () => {
    expect(byKind('back_print')[0]!.changes).toEqual({
      'parts[0].printBack': { from: [{ inkColourId: 'k' }], to: [] },
    });
    expect(byKind('coating')[0]!.configuration['parts']).toEqual([
      expect.not.objectContaining({ finish1FrontId: expect.anything() }),
    ]);
    expect(byKind('material').map((c) => c.configuration['materialId'])).toEqual(['m2', 'm3']);
    expect(byKind('quantity').map((c) => c.configuration['quantities'])).toEqual([[2000], [5000]]);
    expect(BASE.parts[0]!.printBack).toHaveLength(1);
    expect(BASE.parts[0]!.finish1FrontId).toBe('f1');
  });

  it('offers nothing a configuration does not have and caps the number priced', () => {
    const plain = leverCandidates(
      { materialId: 'm1', quantities: [100], parts: [{ printFront: [] }] },
      {
        ...CTX,
        materialIds: [],
      },
    );
    expect(plain.map((c) => c.kind)).toEqual(['quantity', 'quantity']);
    const many = leverCandidates(BASE, {
      ...CTX,
      materialIds: Array.from({ length: 30 }, (_, i) => `x${i}`),
    });
    expect(many).toHaveLength(MAX_LEVER_CANDIDATES);
  });
});
