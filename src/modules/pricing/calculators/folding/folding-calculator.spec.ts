import { convertTo2Decimal } from '../../engine/php';
import { type FoldingOption, foldingCalculator } from './folding-calculator';
import { type GeometrySnapshot } from './geometry/types';
import { type PartRequest, PricingError } from './request';
import { saleMargin, type SellSnapshot, sellMargins } from './sell';
import { type OffsetTables } from './tables';

/** Sell side and the folding calculator (B2.3), vectors from `Calculator::SaleMargin` and `calculate_cs`. */

const sell = (overrides: Partial<SellSnapshot> = {}): SellSnapshot => ({
  marginLines: [
    { qtyMin: 1, qtyMax: 999, priceMin: 0, priceMax: null, valuePct: 25 },
    { qtyMin: 1000, qtyMax: null, priceMin: 0, priceMax: null, valuePct: 20 },
  ],
  marginFallbackPct: null,
  fixCost: 0,
  designFee: 2500,
  structureDesignFee: 1500,
  vatPct: 7,
  ...overrides,
});

describe('sell side (Calculator::SaleMargin, Calculator.php:400-449)', () => {
  it('reads the tier of the run and buy price, the base at run 1 and price 1 (FoldingCalculator.php:1409-1436)', () => {
    expect(sellMargins(sell(), 1000, 10000)).toEqual({ target: 20, base: 25 });
    expect(sellMargins(sell({ marginLines: [], marginFallbackPct: 3 }), 1000, 10000)).toEqual({
      target: 3,
      base: 3,
    });
    expect(() => sellMargins(sell({ marginLines: [] }), 1000, 10000)).toThrow(PricingError);
  });

  it('prices a lot: buy ÷ (1 − margin) × VAT, rounded up to the satang per piece', () => {
    const f = saleMargin(sell(), 10000, 1000, 1000, 0);
    // (10000 + 0) / 0.8 × 1.07 = 13375 → 13.375 per piece → 13.38 (:406-414)
    expect(f.perPcs).toBe(13.38);
    expect(f.sum).toBe(13.38 * 1000);
    expect(f.vatPrice).toBeCloseTo(875, 9);
    // base: 10000 / 0.75 × 1.07 / 1000 = 14.2667 → 14.27; discount from margin (14.27 − 13.38) × 1000 (:444)
    expect(f.discountFromMargin).toBeCloseTo((14.27 - 13.38) * 1000, 9);
    expect(f.total).toBe(13.38 * 1000);
  });

  it('adds shipping with VAT, rounded up to the baht then to the satang per piece (:400-403)', () => {
    const f = saleMargin(sell(), 10000, 1000, 1000, 500);
    // ⌈500 × 1.07⌉ = 535 → 0.535 per piece → 0.54 → 540
    expect([f.deliveryPricePerPcs, f.deliveryPrice]).toEqual([0.54, 0.54 * 1000]);
    expect(f.perPcsWithDelivery).toBe(13.38 + 0.54);
    expect(f.total).toBe((13.38 + 0.54) * 1000);
  });
});

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
const tables = (factoryMarginPct: number): OffsetTables => ({
  terms: {
    wasteMethod: 1,
    finish2StepDownWaste: false,
    fourColourPriceByMaxPercent: false,
    assemblyWasteByAssembly: false,
    diecutWasteByBoxAmount: false,
    factoryMarginPct,
  },
  standardInkColours: new Set(['cmyk']),
  printWastes: [{ ...all, minPercent: 0, maxPercent: 100, percentWaste: 10, setupWaste: 50 }],
  finishWastes: [],
  diecutWastes: [],
  assemblyWastes: [],
  printPlates: [{ machineId: 'M1', wMin: 20, wMax: 35, lMin: 25, lMax: 45, platePrice: 500 }],
  printPrices: [
    {
      ...all,
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
  ],
  finishPrices: [],
  finishPlates: [],
  diecutPrices: [],
  diecutBlocks: [],
  assemblyPrices: [],
  assemblySheets: [],
  patternKind: null,
});

const request: PartRequest = {
  materialId: 'art350',
  difficultyLevelId: 'normal',
  printFront: [1, 2, 3, 4].map(() => ({ inkColourId: 'cmyk', percent: 100 })),
  finish2: [],
  assemblies: [],
};

const option = (key: string, marginPct: number, overrides: Partial<FoldingOption> = {}): FoldingOption => ({
  optionKey: key,
  factoryId: key,
  printTypeId: 'offset',
  engine: 'a_offset',
  leadTimeDays: 7.5,
  bulkLeadTime: null,
  minOrderForProduction: null,
  tables: tables(marginPct),
  parts: { body: { geometry, exclusions: [] } },
  sell: sell(),
  ...overrides,
});

const input = {
  quantities: [1000],
  parts: [{ key: 'body', geometry: { w: 200, l: 300, d: 50 }, request }],
  design: { graphic: true, structure: false },
};

describe('folding calculator (FoldingCalculator::calculate_cs)', () => {
  it('prices each option, adds the design fee once and selects the lowest buy price', () => {
    const result = foldingCalculator.calculate(input, { options: [option('F1', 20), option('F2', 10)] });
    const [f1, f2] = result.options;
    const s1 = f1!.steps[0]!;
    const s2 = f2!.steps[0]!;
    expect(s2.buyPrice).toBeLessThan(s1.buyPrice);
    expect(result.selection).toEqual(['F2']);
    // one part: its lot at the sell margin plus the graphic design fee, once (quirk Q2)
    expect(s2.total).toBe(s2.parts[0]!.forSale.total + 2500);
    expect(s2.designFee).toBe(2500);
    // lead time rounded up (`:1163`)
    expect(s2.leadTimeDays).toBe(8);
    const net = s2.total / 1.07;
    expect(s2.marginPct).toBeCloseTo(((net - s2.buyPrice) / net) * 100, 9);
    expect(s2.shippingPriced).toBe(false);
  });

  it('prefers the shorter lead time at an equal buy price, and applies bulk lead times', () => {
    const result = foldingCalculator.calculate(input, {
      options: [
        option('slow', 10, { leadTimeDays: 12 }),
        option('fast', 10, { bulkLeadTime: { minQty: 500, days: 5 } }),
      ],
    });
    expect(result.options[1]!.steps[0]!.leadTimeDays).toBe(5);
    expect(result.selection).toEqual(['fast']);
  });

  it('reports why an option has no price, and never offers engine B (PROGRESS B2.3 slice 6)', () => {
    const result = foldingCalculator.calculate(input, {
      options: [
        option('b', 10, { engine: 'b' }),
        option('bare', 10, { tables: { ...tables(10), printPlates: [] } }),
      ],
    });
    expect(result.options.map((o) => o.error?.code)).toEqual(['process_not_possible', 'price_line_missing']);
    expect(result.selection).toEqual([null]);
  });

  it('keeps the per-piece price rounded like legacy', () => {
    const result = foldingCalculator.calculate(input, { options: [option('F1', 20)] });
    const step = result.options[0]!.steps[0]!;
    const part = step.parts[0]!;
    expect(part.forSale.perPcs).toBe(convertTo2Decimal(((part.buyPrice / 0.8) * 1.07) / 1000));
  });
});
