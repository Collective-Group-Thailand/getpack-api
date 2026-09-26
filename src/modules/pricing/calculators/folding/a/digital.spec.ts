import { convertNumberFloat, convertTo2Decimal, phpFloatval } from '../../../engine/php';
import { calculateGeometry } from '../geometry/pattern-area';
import { type GeometrySnapshot, type LayoutCandidate } from '../geometry/types';
import { type PartRequest, PricingError } from '../request';
import { type DigitalTables } from '../tables';
import { inch2toM2, priceDigitalLayout, sortDigitalLayouts } from './digital';
import { priceDigitalPart } from './engine';
import { layoutWaste } from './waste';

/** Engine A digital, vectors derived by hand from `A/CalculateCostDigital.php` (B2.3). */

const geometry: GeometrySnapshot = {
  pattern: { formula: 'flat', conditions: {} },
  paperTrim: { gap: 3, trimW: 10, trimL: 12, edgeTrim: 5, trimFoil: 4, trimFinishPlate: 6 },
  patternDelta: null,
  sheets: [
    {
      sheetKey: 's',
      sizeWIn: 31,
      sizeLIn: 43,
      sheetCut: 1,
      sheetWIn: 31,
      sheetLIn: 43,
      isFixGrain: false,
      costPerKg: 30,
      gsm: 350,
    },
  ],
  terms: { useMaxMinPaperTrim: true, canFlipPaperSize: false, disableOverlapLayout: false },
};

const all = { minSheets: 0, maxSheets: 100000 };

const tables = (
  terms: Partial<DigitalTables['terms']> = {},
  overrides: Partial<DigitalTables> = {},
): DigitalTables => ({
  terms: {
    wasteMethod: 1,
    finish2StepDownWaste: false,
    fourColourPriceByMaxPercent: false,
    assemblyWasteByAssembly: false,
    diecutWasteByBoxAmount: false,
    factoryMarginPct: 10,
    paperMethod: 'auto',
    trimDlMm: 0,
    trimDwMm: 0,
    usePaperAmountForCal: false,
    printMethod: 'sheet_area',
    printBand: 'sheets',
    printByMaterial: false,
    finishMethod: 'sheet_area',
    diecutBlock: 'none',
    costMultiplier: 1,
    minLotPrice: null,
    ...terms,
  },
  printTypeId: 'digital',
  printWastes: [{ ...all, minPercent: null, maxPercent: null, percentWaste: 10, setupWaste: 50 }],
  finishWastes: [{ ...all, finishId: null, percentWaste: 5, setupWaste: 20 }],
  diecutWastes: [
    { ...all, diecutTypeId: 'dc1', minBox: null, maxBox: null, percentWaste: 2, setupWaste: 30 },
  ],
  assemblyWastes: [],
  materialPrices: [
    { minPaperAmount: null, maxPaperAmount: null, costPerKg: null, costPerPcs: 2, costPerM2: 12 },
    { minPaperAmount: 0, maxPaperAmount: 500, costPerKg: null, costPerPcs: 9, costPerM2: null },
  ],
  printPrices: [
    {
      ...all,
      machineId: 'D1',
      inkColourId: 'cmyk',
      percentColor: null,
      pricePerSheet: 0,
      pricePerPcs: 1.5,
      flatPriceFourColor: 0,
      flatPriceFourColorPerPcs: 0,
      priceColorCombineSpecialColor: 0,
      operationCost: 0,
      minBox: 0,
      maxBox: 5000,
      priceInkPerM2: 3,
    },
  ],
  finishPrices: [
    {
      ...all,
      finishId: 'lam',
      machineId: null,
      finishPrice: 0,
      pricePerSheet: 4,
      priceByAreaPerIn2: 0.01,
      minPrice: 150,
      toolingPrice: 0,
      blockPricePerIn2: 0,
      materialPricePerIn2: 0,
      operationCost: 0,
      addsDiecutWindow: false,
    },
  ],
  diecutPrices: [
    {
      ...all,
      machineId: 'D1',
      diecutPrice: 400,
      pricePerSheet: 0,
      operationCost: 0,
      pricePerPcs: 0.2,
      minPrice: 150,
    },
  ],
  diecutBlocks: [],
  assemblyPrices: [],
  ...overrides,
});

const request = (overrides: Partial<PartRequest> = {}): PartRequest => ({
  materialId: 'art300',
  difficultyLevelId: 'normal',
  printFront: [1, 2, 3, 4].map(() => ({ inkColourId: 'cmyk', percent: 100 })),
  finish1FrontId: 'lam',
  finish2: [],
  diecutTypeId: 'dc1',
  assemblies: [],
  ...overrides,
});

function rotatedLayout(): LayoutCandidate {
  const { layouts } = calculateGeometry(
    { w: 200, l: 300, d: 50, boxAmounts: [1000], quantities: [1000] },
    geometry,
  );
  return layouts[0]!.find((c) => !c.layoutStandard)!;
}

const price = (t: DigitalTables, req: PartRequest = request()) => {
  const layout = rotatedLayout();
  const waste = layoutWaste('digital', req, layout, t);
  return { waste, priced: priceDigitalLayout(req, layout, waste, t) };
};

describe('engine A digital (A/CalculateCostDigital.php)', () => {
  it('waste reads every print-waste row as one set (A/CalculateWaste.php:143-145)', () => {
    const { waste } = price(tables());
    // die-cut 132, finish 1 159, print front ⌈159 · 10 % + 50⌉ + 159 = 225
    expect([waste.diecut, waste.finish1Front, waste.printFront, waste.totalSheets]).toEqual([
      132, 159, 225, 225,
    ]);
  });

  it('prices paper, ink, finish and die-cut by sheet area and run (:137-140, :174, :245, :305-321)', () => {
    const { priced } = price(tables());
    const area = inch2toM2(31 * 43);
    expect(priced!.paper).toBe(convertTo2Decimal(12 * area * 225));
    expect(priced!.paper).toBe(2322);
    expect(priced!.printFront).toBe(convertTo2Decimal(3 * area * 225) * (100 / 100));
    expect(priced!.finish1Front).toBe(convertTo2Decimal(31 * 43 * 0.01 * 159));
    // not on die-cut sheets: run 1000 × 0.20 per piece, above the 150 floor
    expect(priced!.diecut).toEqual({ price: 200, blockPrice: 0, totalCost: 200 });
    const total = priced!.paper + priced!.printFront! + priced!.finish1Front! + 200;
    expect(priced!.totalCost).toBe(total);
    // margin on the run; the lot shown is the rounded per-piece price × run (:2388-2411, :487-488)
    const sale = total / (1 - 10 / 100) - total + total;
    const suggest = convertNumberFloat(sale / 1000);
    expect(priced!.margin).toMatchObject({
      suggestPrice: suggest,
      salePrice: phpFloatval(suggest) * 1000,
      qty: 1000,
    });
  });

  it('follows the factory terms that replace legacy factories 9, 16 and 23', () => {
    // 23: paper per press sheet, ink per piece and sheet, finish per sheet
    const t23 = price(
      tables({ paperMethod: 'per_sheet', printMethod: 'per_sheet', finishMethod: 'per_sheet' }),
    ).priced!;
    expect(t23.paper).toBe(2 * 225);
    expect(t23.printFront).toBe(convertTo2Decimal(1.5 * 225));
    expect(t23.finish1Front).toBe(convertTo2Decimal(4 * 159));
    // 9: paper per piece from the band holding the sheets, ink on the blank by run, finish per sheet per up, ×1.2
    const t9 = price(
      tables({
        paperMethod: 'per_piece_band',
        printMethod: 'blank_area',
        printBand: 'box',
        finishMethod: 'per_sheet_per_layout',
        costMultiplier: 1.2,
      }),
    ).priced!;
    expect(t9.paper).toBe(convertTo2Decimal(9 / 10) * 1000);
    expect(t9.printFront).toBe(convertTo2Decimal(((200 * 300) / 1000000) * 1000 * 3));
    expect(t9.finish1Front).toBe(convertTo2Decimal((4 / 10) * 1000));
    const base = t9.paper + t9.printFront! + t9.finish1Front! + 200;
    expect(t9.totalCost).toBe(base * 1.2);
    // trims: the blank plus its trims per piece (:134-136)
    const trimmed = price(tables({ trimDlMm: 3, trimDwMm: 2 })).priced!;
    expect(trimmed.paper).toBe((((300 + 3) * (200 + 2)) / 1000000) * 1000 * 12);
  });

  it('raises the lot to the factory minimum (legacy factory 16, :2386-2396)', () => {
    const { priced } = price(tables({ minLotPrice: 1000000 }));
    expect(priced!.margin.salePrice).toBe(1000000);
    expect(priced!.margin.suggestPrice).toBe('1000.00');
  });

  it('skips a layout whose colours have no ink price, refuses a missing finish price (:166-168, :235-237)', () => {
    const noInk = tables({}, { printPrices: [] });
    expect(price(noInk).priced).toBeNull();
    expect(() => price(tables({}, { finishPrices: [] }))).toThrow(PricingError);
  });

  it('prices assemblies per piece with window material, and refuses per-carton ones (not wired to packing yet, :413-430)', () => {
    const row = (digitalMethod: 'per_piece' | 'per_carton') => ({
      assemblyId: 'window',
      rangeMin: 0,
      rangeMax: 5000,
      assemblyType: 3 as const,
      addsDiecutWindow: false,
      pricePerCm: 0,
      pricePerPcs: 0.1,
      minPrice: 50,
      minimumOperation: 0,
      blockPrice: 0,
      materialPricePerIn2: 0.02,
      printTypeId: 'digital',
      minAreaSqcm: null,
      maxAreaSqcm: null,
      digitalMethod,
    });
    const asb = {
      assemblyId: 'window',
      requiresAmount: true,
      requiresWidth: true,
      requiresLength: true,
      skipWaste: false,
      amount: 1,
      w: [50],
      l: [40],
    };
    const req = request({
      printFront: undefined,
      finish1FrontId: undefined,
      diecutTypeId: undefined,
      assemblies: [asb],
    });
    const { priced } = price(tables({}, { assemblyPrices: [row('per_piece')] }), req);
    // 0.1 × 1000 = 100; material ((50 + 6) × (40 + 6)) / 25.4² in² × 0.02 × 1 per piece × 1000 (full plate trim 6 mm)
    const material = (((50 + 6) * (40 + 6)) / (25.4 * 25.4)) * 0.02 * 1;
    expect(priced!.assembly).toEqual([100 + material * 1000]);
    expect(() => price(tables({}, { assemblyPrices: [row('per_carton')] }), req)).toThrow(
      expect.objectContaining({ code: 'process_not_possible' }),
    );
  });

  it('orders by cost then rotated first, and prices a whole part', () => {
    const result = priceDigitalPart(
      { geometry: { w: 200, l: 300, d: 50 }, quantities: [1000], request: request() },
      { geometry, tables: tables(), exclusions: [], minOrderForProduction: null },
    );
    const layouts = result.steps[0]!.layouts;
    expect(layouts.length).toBe(2);
    expect(sortDigitalLayouts([...layouts].reverse())[0]!.totalCost).toBe(layouts[0]!.totalCost);
  });
});
