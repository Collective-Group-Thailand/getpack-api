import { blankGeometry } from './formulas';
import { calLayoutAmount } from './layout-amount';
import { calculateGeometry, withFlippedSheets } from './pattern-area';
import {
  type GeometryCondition,
  GeometryError,
  type GeometrySnapshot,
  type PaperSheet,
  type PatternGeometry,
} from './types';

/**
 * Vectors derived by hand from the legacy PHP (B2.3, no legacy dump with outputs exists). Each
 * expectation cites the expression it evaluates; lengths are mm.
 */

const flatBand = (value: number, determinant: GeometryCondition['determinant'] = 'w', variable = 'f') => ({
  variable,
  determinant,
  bands: [{ lower: 0, upper: 1000, value }],
});

const sheet = (overrides: Partial<PaperSheet> = {}): PaperSheet => ({
  sheetKey: 'sheet-31x43',
  sizeWIn: 31,
  sizeLIn: 43,
  sheetCut: 1,
  sheetWIn: 31,
  sheetLIn: 43,
  isFixGrain: false,
  costPerKg: 30,
  gsm: 350,
  ...overrides,
});

const snapshot = (pattern: PatternGeometry, overrides: Partial<GeometrySnapshot> = {}): GeometrySnapshot => ({
  pattern,
  paperTrim: { gap: 3, trimW: 10, trimL: 12, edgeTrim: 5, trimFoil: 4, trimFinishPlate: 6 },
  patternDelta: null,
  sheets: [sheet()],
  terms: { useMaxMinPaperTrim: true, canFlipPaperSize: false, disableOverlapLayout: false },
  ...overrides,
});

describe('folding geometry — pattern formulas (PatternArea::calPatternArea)', () => {
  const dims = { w: 50, l: 80, d: 120, x: 3, c: 0 };

  it('case 1 tuck_top (:186-219)', () => {
    const g = blankGeometry(
      { formula: 'tuck_top', conditions: { dw: [flatBand(15)], dl: [flatBand(12, 'l', 'g')] } },
      dims,
    );
    // dw = f + w - 1 + d + 1 + w - 1 + f = 15 + 50 - 1 + 120 + 1 + 50 - 1 + 15
    // dl = w - 1 + l + w + l + g = 50 - 1 + 80 + 50 + 80 + 12;  c = w + f
    expect(g).toEqual({ dw: 249, dl: 271, c: 65, nd: 121, nl: 81, nw: 51, combineLayout: false });
  });

  it('looks each condition up by its own determinant, bands inclusive on both ends (:76-88)', () => {
    const byLength: GeometryCondition = {
      variable: 'f',
      determinant: 'l',
      bands: [
        { lower: 0, upper: 79, value: 10 },
        { lower: 80, upper: 200, value: 20 },
      ],
    };
    const g = blankGeometry({ formula: 'tray', conditions: { dw: [byLength] } }, dims);
    // l = 80 falls in [80, 200] → f = 20; dw = 2 × (f + (d − 1) + 8 + d) + w + 16
    expect(g.dw).toBe(2 * (20 + 119 + 8 + 120) + 50 + 16);
    expect(g.dl).toBe(2 * (20 + 119 + 8 + 120) + 80 + 16);
  });

  it('case 16 lock_bottom_top reads the `b` condition by width and group-1 `f` by length (:519-572)', () => {
    const g = blankGeometry(
      {
        formula: 'lock_bottom_top',
        conditions: {
          dw: [flatBand(99, 'l', 'x'), flatBand(4, 'l', 'b')],
          aux_f: [flatBand(13, 'l')],
          dl: [flatBand(10, 'l', 'g')],
        },
      },
      { w: 60, l: 90, d: 30, x: 3, c: 0 },
    );
    // b_value = 5 (w ≤ 80); a = 60/2 − 0.25 + 5 − 90/3 = 4.75 < 7 → 7; 7 + 30 ≤ 44 keeps 7
    // dw1 = 13 + 59 + 30 + 0.5 + 29.75 + 4 = 136.25; dw2 = 13 + 59 + 30 + 0.5 + 30 + 7 + 5 = 144.5
    // dl = 59 + 90 + 60 + 90 + 10; c = 144.5 − (30 + 30 − 0.25 + 4 + 22.5)
    expect(g).toEqual({ dw: 144.5, dl: 309, c: 58.25, nd: 31, nl: 91, nw: 61, combineLayout: true });
  });

  it('flat patterns take the box as the blank; flat_overlap keeps the given overlap (:507-517)', () => {
    expect(blankGeometry({ formula: 'flat', conditions: {} }, { ...dims, c: 7 })).toMatchObject({
      dw: 50,
      dl: 80,
      c: 0,
    });
    expect(blankGeometry({ formula: 'flat_overlap', conditions: {} }, { ...dims, c: 7 })).toMatchObject({
      c: 7,
      combineLayout: false,
    });
  });

  it('standard_blank matches the standard size exactly (:664-719)', () => {
    const pattern: PatternGeometry = {
      formula: 'standard_blank',
      conditions: {},
      standardBlanks: [{ wMm: 50, lMm: 80, dMm: 120, dwMm: 333, dlMm: 444 }],
    };
    expect(blankGeometry(pattern, dims)).toMatchObject({ dw: 333, dl: 444, c: 0 });
    expect(() => blankGeometry(pattern, { ...dims, w: 51 })).toThrow(GeometryError);
  });

  it('refuses a missing condition or band instead of computing with 0 (quirk Q14)', () => {
    const missing = () => blankGeometry({ formula: 'tuck_top', conditions: { dw: [flatBand(15)] } }, dims);
    expect(missing).toThrow(expect.objectContaining({ code: 'geometry_condition_missing' }));
    const outOfBand = () =>
      blankGeometry(
        {
          formula: 'tray',
          conditions: {
            dw: [{ variable: 'f', determinant: 'w', bands: [{ lower: 0, upper: 10, value: 1 }] }],
          },
        },
        dims,
      );
    expect(outOfBand).toThrow(expect.objectContaining({ code: 'geometry_band_missing' }));
  });
});

describe('folding geometry — calLayoutAmount (helpers.php:597-891)', () => {
  const base = { pw: 700, pl: 1000, dw: 200, dl: 300, paperTrimW: 10, paperTrimL: 12 };

  it('non-overlap, standard orientation', () => {
    // ansW = ⌊700/200⌋ = 3, ansL = ⌊1000/300⌋ = 3, both wastes ≥ 0
    // areaW = 3·200 + 2·3 + trimW, areaL = 3·300 + 2·3 + trimL (pw ≤ pl)
    expect(calLayoutAmount({ ...base, c: 0, trimGap: 3 })).toEqual({
      layout: 9,
      slotW: 3,
      slotL: 3,
      areaW: 616,
      areaL: 918,
    });
  });

  it('non-overlap, rotated, dropping a row when the gaps overflow', () => {
    // ansW = ⌊700/300⌋ = 2; ansL = ⌊1000/200⌋ = 5, wasteL = 1000 − (1000 + 12) < 0 → 5 − ⌈12/203⌉ = 4
    expect(calLayoutAmount({ ...base, c: 0, trimGap: 3, layoutStandard: false })).toEqual({
      layout: 8,
      slotW: 2,
      slotL: 4,
      areaW: 613,
      areaL: 821,
    });
  });

  it('overlap type 1 fits an extra blank into the overlap (:638-667)', () => {
    // wasteW = 700 − (600 − 100) = 200 > 200 − 50 → layW = ⌊3 + 200/150⌋ = 4
    // areaW = 4·200 − 3·50 + trimW = 660; areaL = 3·300 + trimL = 912
    expect(calLayoutAmount({ ...base, c: 50, trimGap: 0 })).toEqual({
      layout: 12,
      slotW: 4,
      slotL: 3,
      areaW: 660,
      areaL: 912,
    });
  });

  it('combined overlap (type 2) lays pairs (:600-619)', () => {
    // ansW = ⌊700/(400 − 50)⌋ = 2, wasteW = 0 → layW = 4; layL = 3 (checked 2)
    // areaW = 800 − 4·50 + trim = 610; areaL = 900 − 2·50 + trim = 810
    expect(calLayoutAmount({ ...base, c: 50, trimGap: 0, combineLayout: true })).toEqual({
      layout: 12,
      slotW: 4,
      slotL: 3,
      areaW: 610,
      areaL: 810,
    });
  });

  it('returns no layout when nothing fits', () => {
    expect(calLayoutAmount({ ...base, pw: 100, pl: 100, c: 0 }).layout).toBe(0);
  });
});

describe('folding geometry — PatternArea::calculate (:830-1092)', () => {
  const flat: PatternGeometry = { formula: 'flat', conditions: {} };
  const input = { w: 200, l: 300, d: 50, boxAmounts: [1000], quantities: [800] };

  it('lays the blank both ways on each sheet, net of the trims', () => {
    const { patternArea, layouts } = calculateGeometry(input, snapshot(flat));
    expect(patternArea).toMatchObject({ dw: 200, dl: 300, dwWithGap: 203, trimFinishPlateMm: 3 });
    const [standard, rotated] = layouts[0]!;
    // pw = 31 in · 25.4 − trimW − edge = 772.4; pl = 43 in · 25.4 − trimL − edge = 1075.2
    expect(standard!.pwWithoutTrim).toBeCloseTo(772.4, 9);
    expect(standard!.plWithoutTrim).toBeCloseTo(1075.2, 9);
    expect(standard).toMatchObject({
      layoutStandard: true,
      layoutAmount: 9,
      areaW: 616,
      areaL: 918,
      paperAmount: 112, // ⌈1000 / 9⌉
      boxAmount: 1000,
      qty: 800,
      isGrain: true,
      sortGrain: 0,
      lIsGrainStandard: true,
    });
    expect(rotated).toMatchObject({
      layoutStandard: false,
      layoutAmount: 10,
      areaW: 613,
      areaL: 1024,
      paperAmount: 100,
    });
    expect(standard!.paperSheetWWithoutEdge).toBeCloseTo(31 - 5 / 25.4, 12);
  });

  it('adds the factory pattern delta to the blank (:725-738)', () => {
    const { patternArea } = calculateGeometry(
      input,
      snapshot(flat, { patternDelta: { plusDl: 2, plusDw: 1.5 } }),
    );
    expect(patternArea).toMatchObject({ dw: 201.5, dl: 302, dwPlus: 1.5, dlPlus: 2, dlWithGap: 305 });
  });

  it('subtracts the long trim from the long side for type-A factories (useMaxMinPaperTrim)', () => {
    const landscape = sheet({ sheetWIn: 43, sheetLIn: 31, sizeWIn: 43, sizeLIn: 31 });
    const a = calculateGeometry(input, snapshot(flat, { sheets: [landscape] })).layouts[0]![0]!;
    expect(a.pwWithoutTrim).toBeCloseTo(43 * 25.4 - 12 - 5, 9);
    const b = calculateGeometry(
      input,
      snapshot(flat, {
        sheets: [landscape],
        terms: { useMaxMinPaperTrim: false, canFlipPaperSize: false, disableOverlapLayout: false },
      }),
    ).layouts[0]![0]!;
    expect(b.pwWithoutTrim).toBeCloseTo(43 * 25.4 - 10 - 5, 9);
  });

  it('with a fixed grain uses fix-grain sheets in the chosen orientation only (:790-792, :947, :1029)', () => {
    const sheets = [sheet({ sheetKey: 'free' }), sheet({ sheetKey: 'grain', isFixGrain: true })];
    const noParallel = calculateGeometry({ ...input, isGrain: true }, snapshot(flat, { sheets }));
    expect(noParallel.layouts[0]).toEqual([]);
    const alongDl = calculateGeometry(
      { ...input, isGrain: true, grainParallel: 'dl' },
      snapshot(flat, { sheets }),
    );
    expect(alongDl.layouts[0]!.map((c) => [c.sheet.sheetKey, c.layoutStandard])).toEqual([['grain', true]]);
  });

  it('flips sheets for flip-paper factories, marking the copy against the grain (quirk Q13)', () => {
    expect(withFlippedSheets([sheet()])[1]).toMatchObject({
      sheetWIn: 43,
      sheetLIn: 31,
      sizeWIn: 43,
      sizeLIn: 31,
      isGrain: false,
    });
    const flipped = calculateGeometry(
      input,
      snapshot(flat, {
        terms: { useMaxMinPaperTrim: true, canFlipPaperSize: true, disableOverlapLayout: false },
      }),
    );
    expect(flipped.layouts[0]!.filter((c) => c.sortGrain === 1).every((c) => c.isGrain === false)).toBe(true);
    expect(flipped.layouts[0]!.length).toBe(4);
  });

  it('lays out without overlap when the factory terms say so (legacy factories 9 and 23, :911-914)', () => {
    const overlap: PatternGeometry = { formula: 'flat_overlap', conditions: {} };
    const on = calculateGeometry({ ...input, c: 20 }, snapshot(overlap)).layouts[0]![0]!;
    const off = calculateGeometry(
      { ...input, c: 20 },
      snapshot(overlap, {
        terms: { useMaxMinPaperTrim: true, canFlipPaperSize: false, disableOverlapLayout: true },
      }),
    ).layouts[0]![0]!;
    expect(on.c).toBe(20);
    expect(off.c).toBe(0);
  });
});
