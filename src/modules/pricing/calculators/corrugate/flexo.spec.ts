import vectors from '../../../../../test/golden/corrugate/reference/flexo.vectors.json';
import { PricingError } from '../shared/pricing-error';
import { type AssemblyContext, assemblyLine } from './assemblies';
import { type FlexoInput, type FlexoTables, priceFlexoPart, reduceFactor } from './flexo';
import { type Blank } from './geometry';
import { type AssemblyPrice } from './tables';

/**
 * Corrugate flexo engines and assemblies (U-B6 slice 4) against vectors from an independent Python
 * transcription of the PHP (`test/golden/corrugate/reference/flexo_reference.py`, the PHP's statement order,
 * one object per `calculate()` call). Made-up price lists; each case names what it exercises.
 */

type Vectors = typeof vectors;
type Case = Vectors['flexo'][number];
type LayoutExpect = {
  rollWidthIn: number;
  widthLayout: number;
  lengthLayout: number;
  sheets: number;
  waste: number;
  paperCost: number;
  printPrice: number;
  plates: number;
  dieCut: number;
  dieBlock: number;
  dieDelivery: number;
  showTotal: number;
  costPerPcs: number;
  buyPrice: number;
  dieSize: string | null;
};

const tablesOf = (c: Case): FlexoTables => ({ ...vectors.fixtures.tables, ...c.override });

const blankOf = (dw: number, dl: number): Blank => ({
  w: 0,
  l: 0,
  d: 0,
  dw,
  dl,
  plusDw: 0,
  plusDl: 0,
  flap: null,
  slh: null,
  odl: null,
  odw: null,
  odh: null,
  areaSqm: 0,
  i: 0,
  j: 0,
});

const inputOf = (c: Case): FlexoInput => ({
  blank: blankOf(c.part.dw, c.part.dl),
  rsc: c.part.rsc,
  qty: c.part.qty,
  print: { frontPercents: c.part.front, backPercents: c.part.back },
  assemblyTotal: c.part.assemblyTotal,
  dieDeliveryRounds: c.part.dieDeliveryRounds,
  standardSize: c.part.standardSize,
});

describe('corrugate flexo engines (CalRSCFlexo:867, CalDCFlexo:1084)', () => {
  it.each(vectors.flexo.map((c) => [c.name, c]))('%s', (_name, c) => {
    const kase = c;
    if (typeof kase.expect === 'string') {
      expect(() => priceFlexoPart(inputOf(kase), tablesOf(kase))).toThrow(
        expect.objectContaining({ code: kase.expect }) as PricingError,
      );
      return;
    }
    const layouts = priceFlexoPart(inputOf(kase), tablesOf(kase));
    const expected = kase.expect as unknown as LayoutExpect[];
    expect(layouts).toHaveLength(expected.length);
    layouts.forEach((got, n) => {
      const e = expected[n]!;
      expect({
        n,
        roll: got.rollWidthIn,
        across: got.widthLayout,
        along: got.lengthLayout,
        sheets: got.sheets,
        waste: got.waste,
        dieSize: got.dieSize,
        showTotal: got.showTotal,
      }).toEqual({
        n,
        roll: e.rollWidthIn,
        across: e.widthLayout,
        along: e.lengthLayout,
        sheets: e.sheets,
        waste: e.waste,
        dieSize: e.dieSize,
        showTotal: e.showTotal,
      });
      for (const key of [
        'paperCost',
        'printPrice',
        'plates',
        'dieCut',
        'dieBlock',
        'dieDelivery',
        'costPerPcs',
        'buyPrice',
      ] as const) {
        expect({ n, key, value: got[key] }).toEqual({ n, key, value: expect.closeTo(e[key], 6) as number });
      }
    });
  });

  it('refuses a configuration without the 0-colour margin when nothing prints (quirk C3)', () => {
    const c = vectors.flexo[2]!;
    const tables = { ...tablesOf(c), margins: tablesOf(c).margins.filter((m) => m.colourAmount !== 0) };
    expect(() => priceFlexoPart(inputOf(c), tables)).toThrow(
      new PricingError('price_line_missing', 'difficulty_margins 0 colours'),
    );
  });

  it('refuses a material without board prices (quirk C1: legacy kept the previous grade’s price)', () => {
    const c = vectors.flexo[0]!;
    expect(() => priceFlexoPart(inputOf(c), { ...tablesOf(c), boardPrices: [] })).toThrow(
      new PricingError('price_line_missing', 'board_prices'),
    );
  });

  it('reads the volume reduction from the highest band at or below the print price', () => {
    const reduces = vectors.fixtures.tables.percentReduces;
    expect(reduceFactor(reduces, 49_999.99)).toBe(1);
    expect(reduceFactor(reduces, 50_000)).toBe(0.97);
    expect(reduceFactor(reduces, 200_000)).toBe(0.95);
    expect(reduceFactor([], 200_000)).toBe(1);
  });
});

describe('corrugate assemblies (calculateAssembly:1961-2037)', () => {
  const prices = vectors.fixtures.assemblyPrices as AssemblyPrice[];

  it.each(vectors.assemblies.map((a) => [a.name, a]))('%s', (_name, a) => {
    const line = assemblyLine(a.request, prices, a.context as AssemblyContext);
    expect(line.total).toBeCloseTo(a.expect, 9);
  });

  it('refuses an assembly without a price row (legacy priced it at 0)', () => {
    const ctx = vectors.assemblies[4]!.context as AssemblyContext;
    expect(() =>
      assemblyLine({ assemblyId: 'unknown', requiresAmount: false, autoAdd: false }, prices, ctx),
    ).toThrow(new PricingError('price_line_missing', 'corrugate_assembly_prices unknown'));
  });
});
