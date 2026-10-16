import fc from 'fast-check';

import {
  basesOf,
  BasisError,
  constructionFamily,
  convertSize,
  internalSize,
  type MeasurementBasis,
} from './dimension-conversion';

describe('measurement-basis conversion (D-182)', () => {
  it('adds getpack-web’s caliper allowances per construction family', () => {
    const box = convertSize({ w: 100, l: 150, d: 50 }, 'internal', 'box', 0.5);
    expect(box.sizes).toEqual({
      internal: { w: 100, l: 150, d: 50 },
      external: { w: 101, l: 151, d: 51 },
      over_crease: { w: 100.5, l: 150.5, d: 51 },
    });
    const tray = convertSize({ w: 100, l: 150, d: 50 }, 'internal', 'tray', 0.5);
    expect(tray.sizes.over_crease).toEqual({ w: 100.5, l: 150.5, d: 50.5 });
    expect(tray.sizes.external).toEqual({ w: 101, l: 151, d: 50.5 });
    const sleeve = convertSize({ w: 100, l: 150, d: 50 }, 'internal', 'sleeve', 0.5);
    expect(sleeve.sizes.external).toEqual({ w: 101, l: 151, d: 50 });
    expect(box.conversionVersion).toBe('1.0.0');
  });

  it('converts back from the outside or the score-to-score size', () => {
    const fromOutside = convertSize({ w: 304, l: 404, d: 254 }, 'external', 'box', 2);
    expect(internalSize(fromOutside)).toEqual({ w: 300, l: 400, d: 250 });
    const fromCrease = convertSize({ w: 302, l: 402, d: 254 }, 'over_crease', 'box', 2);
    expect(internalSize(fromCrease)).toEqual({ w: 300, l: 400, d: 250 });
  });

  it('round-trips every basis within 0.05 mm', () => {
    const families = fc.constantFrom('box' as const, 'tray' as const, 'sleeve' as const);
    const bases = fc.constantFrom<MeasurementBasis>('internal', 'external', 'over_crease');
    const mm = fc.integer({ min: 2000, max: 200000 }).map((v) => v / 100);
    const caliper = fc.integer({ min: 1, max: 9000 }).map((v) => v / 1000);
    fc.assert(
      fc.property(families, bases, bases, mm, mm, mm, caliper, (family, from, to, w, l, d, t) => {
        const first = convertSize({ w, l, d }, from, family, t);
        const target = first.sizes[to]!;
        const back = convertSize(target, to, family, t).sizes[from]!;
        return Math.abs(back.w - w) <= 0.05 && Math.abs(back.l - l) <= 0.05 && Math.abs(back.d - d) <= 0.05;
      }),
      { numRuns: 2000 },
    );
  });

  it('needs a caliper to leave the given basis', () => {
    const unknown = convertSize({ w: 100, l: 150, d: 50 }, 'external', 'box', null);
    expect(unknown.sizes).toEqual({ internal: null, external: { w: 100, l: 150, d: 50 }, over_crease: null });
    expect(() => internalSize(unknown)).toThrow(BasisError);
    expect(convertSize({ w: 1, l: 2, d: 3 }, 'internal', 'box', null).sizes.internal).toEqual({
      w: 1,
      l: 2,
      d: 3,
    });
  });

  it('measures flat products on their finished size only', () => {
    expect(basesOf('flat')).toEqual(['product']);
    expect(convertSize({ w: 50, l: 80, d: 0 }, 'product', 'flat', null).sizes).toEqual({
      product: { w: 50, l: 80, d: 0 },
    });
    expect(() => convertSize({ w: 50, l: 80, d: 0 }, 'internal', 'flat', null)).toThrow(BasisError);
    expect(() => convertSize({ w: 50, l: 80, d: 20 }, 'product', 'box', 0.5)).toThrow(BasisError);
  });

  it('takes the family from the style’s formula', () => {
    expect(constructionFamily('folding', { geometryFormula: 'tuck_top', corrugateFormula: null }, 50)).toBe(
      'box',
    );
    expect(constructionFamily('folding', { geometryFormula: 'tray', corrugateFormula: null }, 30)).toBe(
      'tray',
    );
    expect(constructionFamily('folding', { geometryFormula: 'sleeve', corrugateFormula: null }, 30)).toBe(
      'sleeve',
    );
    expect(constructionFamily('folding', { geometryFormula: 'tuck_top', corrugateFormula: null }, 0)).toBe(
      'flat',
    );
    expect(constructionFamily('corrugate', { geometryFormula: null, corrugateFormula: 'rsc' }, 300)).toBe(
      'box',
    );
    expect(constructionFamily('corrugate', { geometryFormula: null, corrugateFormula: 'tele_lid' }, 60)).toBe(
      'tray',
    );
    expect(constructionFamily('label', null, null)).toBe('flat');
    expect(constructionFamily('pouch', { geometryFormula: null, corrugateFormula: null }, null)).toBe('flat');
  });
});
