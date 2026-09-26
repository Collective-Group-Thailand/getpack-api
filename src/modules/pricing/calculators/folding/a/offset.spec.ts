import { calculateGeometry } from '../geometry/pattern-area';
import { type GeometrySnapshot, type LayoutCandidate } from '../geometry/types';
import { type PartRequest, PricingError } from '../request';
import { type OffsetTables } from '../tables';
import { priceLayout, sortPricedLayouts } from './cost';
import { priceOffsetPart, productionRuns } from './engine';
import { layoutWaste } from './waste';

/**
 * Engine A offset, vectors derived by hand from the legacy PHP (B2.3). Expected values are written as
 * the legacy expression they evaluate, with its file and line.
 */

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

const allSheets = { minSheets: 0, maxSheets: 100000 };

const tables = (overrides: Partial<OffsetTables> = {}): OffsetTables => ({
  terms: {
    wasteMethod: 1,
    finish2StepDownWaste: false,
    fourColourPriceByMaxPercent: false,
    assemblyWasteByAssembly: false,
    diecutWasteByBoxAmount: false,
    factoryMarginPct: 10,
  },
  standardInkColours: new Set(['cmyk']),
  printWastes: [{ ...allSheets, minPercent: 0, maxPercent: 100, percentWaste: 10, setupWaste: 50 }],
  finishWastes: [{ ...allSheets, finishId: null, percentWaste: 5, setupWaste: 20 }],
  diecutWastes: [
    { ...allSheets, diecutTypeId: 'dc1', minBox: null, maxBox: null, percentWaste: 2, setupWaste: 30 },
  ],
  assemblyWastes: [{ ...allSheets, assemblyId: null, percentWaste: 1, setupWaste: 10 }],
  printPlates: [{ machineId: 'M1', wMin: 20, wMax: 35, lMin: 25, lMax: 45, platePrice: 500 }],
  printPrices: [
    {
      ...allSheets,
      machineId: 'M1',
      inkColourId: 'cmyk',
      percentColor: 100,
      pricePerSheet: 1,
      pricePerPcs: 0.5,
      flatPriceFourColor: 800,
      flatPriceFourColorPerPcs: 0.2,
      priceColorCombineSpecialColor: 0,
      operationCost: 100,
    },
    {
      ...allSheets,
      machineId: 'M1',
      inkColourId: 'gold',
      percentColor: 30,
      pricePerSheet: 2,
      pricePerPcs: 0.7,
      flatPriceFourColor: 0,
      flatPriceFourColorPerPcs: 0,
      priceColorCombineSpecialColor: 40,
      operationCost: 60,
    },
  ],
  finishPrices: [
    {
      ...allSheets,
      finishId: 'lam',
      machineId: null,
      finishPrice: 0,
      pricePerSheet: 0.5,
      priceByAreaPerIn2: 0.01,
      minPrice: 200,
      toolingPrice: 100,
      blockPricePerIn2: 0,
      materialPricePerIn2: 0,
      operationCost: 30,
      addsDiecutWindow: false,
    },
  ],
  finishPlates: [],
  diecutPrices: [{ ...allSheets, machineId: 'M2', diecutPrice: 300, pricePerSheet: 0.4, operationCost: 50 }],
  diecutBlocks: [
    {
      machineId: 'M2',
      wMin: 20,
      wMax: 35,
      lMin: 25,
      lMax: 45,
      layMin: 1,
      layMax: 20,
      diecutPrice: 1000,
      pricePerDrawing: 20,
    },
  ],
  assemblyPrices: [],
  assemblySheets: [],
  patternKind: null,
  ...overrides,
});

const cmyk = [1, 2, 3, 4].map(() => ({ inkColourId: 'cmyk', percent: 100 }));
const request = (overrides: Partial<PartRequest> = {}): PartRequest => ({
  materialId: 'art350',
  difficultyLevelId: 'normal',
  printFront: cmyk,
  finish1FrontId: 'lam',
  finish2: [],
  diecutTypeId: 'dc1',
  assemblies: [],
  ...overrides,
});

/** The rotated layout of a 200 × 300 mm blank on 31 × 43 in: 10 up, 100 sheets for 1,000 pieces. */
function rotatedLayout(): LayoutCandidate {
  const { layouts } = calculateGeometry(
    { w: 200, l: 300, d: 50, boxAmounts: [1000], quantities: [1000] },
    geometry,
  );
  const layout = layouts[0]!.find((c) => !c.layoutStandard)!;
  expect([layout.layoutAmount, layout.paperAmount]).toEqual([10, 100]);
  return layout;
}

describe('engine A waste (A/CalculateWaste.php)', () => {
  it('adds each process waste on top of the sheets the next one needs (method 1, :458-639)', () => {
    const w = layoutWaste('offset', request(), rotatedLayout(), tables());
    // die-cut: 100 + 100·2 % + 30 = 132 (:721); finish 1 front: 132 + ⌈132·5 % + 20⌉ = 159 (:744)
    // print front: ⌈159·10 % + 50⌉ + 159 = 225 (:898, :904)
    expect([w.diecut, w.finish1Front, w.printFront, w.totalSheets, w.totalPaperSize]).toEqual([
      132, 159, 225, 225, 225,
    ]);
    // paper per mill sheet = cost/kg · (gsm · w · l) / (100 · 100 · 1000 / 2.54²) (helpers.php:1127)
    const perSheet = (30 * (350 * 31 * 43)) / ((100 * 100 * 1000) / (2.54 * 2.54));
    expect(w.paperSizePrice).toBe(perSheet);
    expect(w.costPaperSize).toBe(225 * perSheet);
    expect(w.missingBands).toEqual([]);
  });

  it('with method 2 charges the setup waste of the first process in legacy order only (:775-793)', () => {
    const t = tables();
    const w = layoutWaste('offset', request(), rotatedLayout(), {
      ...t,
      terms: { ...t.terms, wasteMethod: 2 },
    });
    // die-cut 100 + 2 = 102; finish 1: 102 + ⌈5.1⌉ = 108; print front keeps its setup: ⌈10.8 + 50⌉ + 108 = 169
    expect([w.diecut, w.finish1Front, w.printFront]).toEqual([102, 108, 169]);
  });

  it('steps finish-2 waste down per position when the factory does (:822-839)', () => {
    const t = tables({
      finishWastes: [
        { ...allSheets, finishId: 'foil', percentWaste: 4, setupWaste: 40 },
        { ...allSheets, finishId: 'emboss', percentWaste: 4, setupWaste: 40 },
      ],
    });
    const f2 = (finishId: string) => ({
      finishId,
      requiresAmount: false,
      requiresWidth: false,
      requiresLength: false,
    });
    const req = request({
      printFront: undefined,
      finish1FrontId: undefined,
      diecutTypeId: undefined,
      finish2: [f2('foil'), f2('emboss')],
    });
    const w = layoutWaste('offset', req, rotatedLayout(), {
      ...t,
      terms: { ...t.terms, finish2StepDownWaste: true },
    });
    // last first: setup ⌈40 / 2⌉ = 20; position 1 at 4 − 1 = 3 %: ⌈100·3 % + 20⌉ = 23 → 123
    // position 0 at 4 %: ⌈123·4 % + 20⌉ = 25 → 148
    expect(w.finish2).toEqual([148, 123]);
    expect(w.totalSheets).toBe(148);
  });

  it('adds assembly waste last to first, none for skip-waste assemblies (:654-698)', () => {
    const asb = (assemblyId: string, skipWaste: boolean) => ({
      assemblyId,
      skipWaste,
      requiresAmount: false,
      requiresWidth: false,
      requiresLength: false,
    });
    const req = request({
      printFront: undefined,
      finish1FrontId: undefined,
      diecutTypeId: undefined,
      assemblies: [asb('glue', false), asb('tape', true)],
    });
    const w = layoutWaste('offset', req, rotatedLayout(), tables());
    // position 1 skips: ⌈100·0 + 0⌉ = 0 → 100; position 0: ⌈100·1 % + 10⌉ = 11 → 111
    expect([...w.assembly.entries()]).toEqual([
      [1, 100],
      [0, 111],
    ]);
    expect(w.totalSheets).toBe(111);
  });

  it('adds no waste for a missing band, like legacy, and reports it (quirk Q16)', () => {
    const w = layoutWaste('offset', request({ diecutTypeId: 'other' }), rotatedLayout(), tables());
    expect(w.diecut).toBe(0);
    expect(w.missingBands).toEqual([]);
    const narrow = tables({
      printWastes: [
        { minSheets: 0, maxSheets: 10, minPercent: 0, maxPercent: 100, percentWaste: 10, setupWaste: 50 },
      ],
    });
    const x = layoutWaste('offset', request(), rotatedLayout(), narrow);
    expect(x.printFront).toBe(159); // ⌈0⌉ + 159
    expect(x.missingBands).toEqual(['print_front[0]@159']);
  });
});

describe('engine A offset cost (A/CalculateCost.php)', () => {
  const areaF1 = (31 - 5 / 25.4) * (43 - 5 / 25.4); // sheet without edge, in² (:111)

  it('prices plate, 4-colour pass, die-cut, finish 1 and paper, then the factory margin', () => {
    const layout = rotatedLayout();
    const t = tables();
    const waste = layoutWaste('offset', request(), layout, t);
    const p = priceLayout(request(), layout, waste, t)!;
    // plate: 4 passes · 500 (:406); 4-colour flat 800 + 0.2 · 225 sheets; operation of the first colour (:462, :531)
    expect(p.printFront).toEqual({
      platePrice: 2000,
      printPrice: 800 + 0.2 * 225,
      combinePrice: 0,
      operationCost: 100,
      totalCost: 2000 + 845 + 0 + 100,
      paperAmount: 225,
    });
    // block 1000 + 20 · 10 up; cut 300 + 132 · 0.4; + operation 50 (:774-803)
    expect(p.diecut).toMatchObject({
      blockPrice: 1200,
      price: 300 + 132 * 0.4,
      totalCost: 300 + 132 * 0.4 + 1200 + 50,
    });
    // finish 1: max(area · 0.01 · 159, 200, 159 · 0.5) + tooling 100 + block 0 + 0 + operation 30 (:952-960)
    const selected = Math.max(areaF1 * 0.01 * 159, 200, 159 * 0.5);
    expect(p.finish1Front!.totalCost).toBe(selected + 100 + 0 + 0 + 30);
    const total = waste.costPaperSize + 2945 + p.finish1Front!.totalCost + p.diecut!.totalCost;
    expect(p.totalCost).toBeCloseTo(total, 9);
    expect(p.costPerPcs).toBe(p.totalCost / 1000);
    // factory margin 10 %: cost ÷ 0.9 (Object/Margin.php); per piece as a 2-decimal string
    expect(p.margin.salePrice).toBeCloseTo(p.totalCost / 0.9, 9);
    expect(p.margin.suggestPrice).toMatch(/^\d+\.\d{2}$/);
  });

  it('prices colours outside a 4-colour set per sheet and piece, with their combine price (:508-527)', () => {
    const layout = rotatedLayout();
    const t = tables();
    const req = request({
      printFront: [...cmyk, { inkColourId: 'gold', percent: 30 }],
      finish1FrontId: undefined,
      diecutTypeId: undefined,
    });
    const waste = layoutWaste('offset', req, layout, t);
    const p = priceLayout(req, layout, waste, t)!;
    const sheets = waste.printFront;
    // 5 passes of plates; flat 4-colour + gold per sheet 2 + 0.7 · sheets; combine 40; first operation 100
    expect(p.printFront).toMatchObject({
      platePrice: 5 * 500,
      printPrice: 800 + 0.2 * sheets + (2 + 0.7 * sheets),
      combinePrice: 40,
      operationCost: 100,
    });
  });

  it('refuses to price a process whose price line is missing, where legacy charged 0 (quirk Q16)', () => {
    const layout = rotatedLayout();
    const t = tables({ finishPrices: [] });
    expect(() => priceLayout(request(), layout, layoutWaste('offset', request(), layout, t), t)).toThrow(
      PricingError,
    );
    const noDiecut = tables({ diecutBlocks: [] });
    expect(() =>
      priceLayout(request(), layout, layoutWaste('offset', request(), layout, noDiecut), noDiecut),
    ).toThrow(expect.objectContaining({ code: 'price_line_missing' }));
  });

  it('prices assemblies per piece and by box height (:1449-1482, :1537-1558)', () => {
    const layout = rotatedLayout();
    const asbRow = (assemblyId: string, assemblyType: 1 | 3) => ({
      assemblyId,
      rangeMin: 0,
      rangeMax: 100000,
      assemblyType,
      addsDiecutWindow: false,
      pricePerCm: assemblyType === 1 ? 0.05 : 0,
      pricePerPcs: 0.3,
      minPrice: 100,
      minimumOperation: assemblyType === 1 ? 50 : 0,
      blockPrice: 20,
      materialPricePerIn2: 0,
    });
    const t = tables({ assemblyPrices: [asbRow('glue', 3), asbRow('height', 1)] });
    const asb = (assemblyId: string) => ({
      assemblyId,
      skipWaste: false,
      requiresAmount: false,
      requiresWidth: false,
      requiresLength: false,
    });
    const req = request({
      printFront: undefined,
      finish1FrontId: undefined,
      diecutTypeId: undefined,
      assemblies: [asb('glue'), asb('height')],
    });
    const p = priceLayout(req, layout, layoutWaste('offset', req, layout, t), t)!;
    // per piece: max(1000 · 0.3, 100) + block 20 (:1538-1541)
    expect(p.assembly[0]).toMatchObject({ case: 3, price: 300, totalCost: 300 + 20 });
    // by height: 1000 · 0.05 · (d 50 mm · 0.1) = 250 → max(250, 100) + minimum operation 50; + block 20 (:1452-1461)
    expect(p.assembly[1]).toMatchObject({
      case: 1,
      price: 1000 * 0.05 * (50 * 0.1),
      totalCost: 250 + 50 + 20,
    });
  });

  it('orders equal-cost layouts rotated first, then the grain along the long side (:313-330)', () => {
    const layout = rotatedLayout();
    const t = tables();
    const waste = layoutWaste('offset', request(), layout, t);
    const a = priceLayout(request(), layout, waste, t)!;
    const standard = { ...a, layout: { ...a.layout, layoutStandard: true } };
    expect(sortPricedLayouts([standard, a])[0]).toBe(a);
  });
});

describe('engine A offset part (FoldingCalculator::calculate:1293)', () => {
  it('raises small runs to the production minimum and keeps the asked quantity (:1311-1318)', () => {
    expect(productionRuns([100, 800], 500)).toEqual([500, 800]);
    expect(productionRuns([100], null)).toEqual([100]);
  });

  it('prices every layout of every step, cheapest first', () => {
    const result = priceOffsetPart(
      { geometry: { w: 200, l: 300, d: 50 }, quantities: [1000], request: request() },
      { geometry, tables: tables(), exclusions: [], minOrderForProduction: null },
    );
    const step = result.steps[0]!;
    expect(step.layouts.length).toBe(2);
    expect(step.layouts[0]!.totalCost).toBeLessThanOrEqual(step.layouts[1]!.totalCost);
  });

  it('refuses a process the factory cannot run on the material (quirk Q6)', () => {
    expect(() =>
      priceOffsetPart(
        { geometry: { w: 200, l: 300, d: 50 }, quantities: [1000], request: request() },
        {
          geometry,
          tables: tables(),
          exclusions: [{ process: 'finish', finishId: 'lam' }],
          minOrderForProduction: null,
        },
      ),
    ).toThrow(expect.objectContaining({ code: 'process_not_possible' }));
  });
});
