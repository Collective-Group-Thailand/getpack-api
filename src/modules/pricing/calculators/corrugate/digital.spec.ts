import vectors from '../../../../../test/golden/corrugate/reference/digital.vectors.json';
import { type PricingError } from '../shared/pricing-error';
import { type DigitalInput, type DigitalTables, priceDigitalPart } from './digital';
import { type Blank } from './geometry';

/**
 * Corrugate digital engine (U-B6 slice 5) against vectors from an independent Python transcription of the
 * PHP (`test/golden/corrugate/reference/digital_reference.py`, the PHP's statement order). Made-up prices.
 */

type Case = (typeof vectors)[number];
interface LayoutExpect {
  sheetWIn: number;
  sheetLIn: number;
  across: number;
  along: number;
  sheets: number;
  paperCost: number;
  printCost: number;
  dieCut: number;
  dieBlock: number;
  printingFixCost: number;
  fixCostPct: number | null;
  costPerPcs: number;
  buyPrice: number;
}

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

const inputOf = (c: Case): DigitalInput => ({
  blank: blankOf(c.part.dw, c.part.dl),
  qty: c.part.qty,
  materialId: c.part.materialId,
  frontColours: c.part.front,
  backColours: c.part.back,
  frontCoveragePct: c.part.frontCoveragePct,
  finishFrontId: c.part.finishFrontId,
  finishBackId: c.part.finishBackId,
  assemblyTotal: c.part.assemblyTotal,
  hasAssemblies: c.part.hasAssemblies,
  standardSize: c.part.standardSize,
});

describe('corrugate digital engine (CalDigital:1337-1545)', () => {
  it.each(vectors.map((c) => [c.name, c]))('%s', (_name, c) => {
    const kase = c;
    const tables = kase.tables as unknown as DigitalTables;
    if (typeof kase.expect === 'string') {
      expect(() => priceDigitalPart(inputOf(kase), tables)).toThrow(
        expect.objectContaining({ code: kase.expect }) as PricingError,
      );
      return;
    }
    const layouts = priceDigitalPart(inputOf(kase), tables);
    const expected = kase.expect as unknown as LayoutExpect[];
    expect(layouts).toHaveLength(expected.length);
    layouts.forEach((got, n) => {
      const e = expected[n]!;
      expect({
        n,
        sheet: [got.sheetWIn, got.sheetLIn],
        layout: got.dieLayout,
        sheets: got.sheets,
        fixCostPct: got.fixCostPct,
        costPerPcs: got.costPerPcs,
      }).toEqual({
        n,
        sheet: [e.sheetWIn, e.sheetLIn],
        layout: { w: e.across, l: e.along },
        sheets: e.sheets,
        fixCostPct: e.fixCostPct,
        costPerPcs: e.costPerPcs,
      });
      for (const key of [
        'paperCost',
        'printCost',
        'dieCut',
        'dieBlock',
        'printingFixCost',
        'buyPrice',
      ] as const) {
        expect({ n, key, value: got[key] }).toEqual({ n, key, value: expect.closeTo(e[key], 6) as number });
      }
    });
  });
});
