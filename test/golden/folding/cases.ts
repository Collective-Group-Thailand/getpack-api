import {
  type FoldingInput,
  type FoldingOption,
} from '@modules/pricing/calculators/folding/folding-calculator';
import {
  type GeometrySnapshot,
  type PatternGeometry,
} from '@modules/pricing/calculators/folding/geometry/types';
import { type PartRequest } from '@modules/pricing/calculators/folding/request';
import { type SellSnapshot } from '@modules/pricing/calculators/folding/sell';
import { type DigitalTables, type OffsetTables } from '@modules/pricing/calculators/folding/tables';

/**
 * The 20 folding validation cases (B2.3). Each case is a complete, made-up price list and a configuration;
 * its expected result is `<id>.json` next to this file. There is no legacy dump with outputs, so the
 * expected values are the port's results, checked piece by piece by the hand-derived unit vectors, and
 * `docs/pricing-validation-folding.md` lists every case for the business team to replay on legacy and
 * sign off. Regenerate with `UPDATE_GOLDEN=1 pnpm test -- folding-golden` only after a reviewed change.
 */

export interface GoldenCase {
  id: string;
  title: string;
  /** Legacy code the case exercises. */
  legacy: string[];
  input: FoldingInput;
  options: FoldingOption[];
}

const all = { minSheets: 0, maxSheets: 1000000 };
const flat: PatternGeometry = { formula: 'flat', conditions: {} };
const band = (value: number, determinant: 'w' | 'l' | 'd' = 'w', variable = 'f') => ({
  variable,
  determinant,
  bands: [
    { lower: 0, upper: 100, value },
    { lower: 100.01, upper: 2000, value: value + 5 },
  ],
});

const sheets = [
  {
    sheetKey: '31x43/1',
    sizeWIn: 31,
    sizeLIn: 43,
    sheetCut: 1,
    sheetWIn: 31,
    sheetLIn: 43,
    isFixGrain: true,
    costPerKg: 32,
    gsm: 350,
  },
  {
    sheetKey: '31x43/2',
    sizeWIn: 31,
    sizeLIn: 43,
    sheetCut: 2,
    sheetWIn: 21.5,
    sheetLIn: 31,
    isFixGrain: false,
    costPerKg: 32,
    gsm: 350,
  },
  {
    sheetKey: '25x36/1',
    sizeWIn: 25,
    sizeLIn: 36,
    sheetCut: 1,
    sheetWIn: 25,
    sheetLIn: 36,
    isFixGrain: true,
    costPerKg: 32,
    gsm: 350,
  },
];

const geometry = (pattern: PatternGeometry, over: Partial<GeometrySnapshot> = {}): GeometrySnapshot => ({
  pattern,
  paperTrim: { gap: 3, trimW: 10, trimL: 12, edgeTrim: 5, trimFoil: 4, trimFinishPlate: 6 },
  patternDelta: null,
  sheets,
  terms: { useMaxMinPaperTrim: true, canFlipPaperSize: false, disableOverlapLayout: false },
  ...over,
});

const sell = (over: Partial<SellSnapshot> = {}): SellSnapshot => ({
  marginLines: [
    { qtyMin: 1, qtyMax: 999, priceMin: 0, priceMax: 20000, valuePct: 35 },
    { qtyMin: 1, qtyMax: 999, priceMin: 20000, priceMax: null, valuePct: 30 },
    { qtyMin: 1000, qtyMax: 4999, priceMin: 0, priceMax: null, valuePct: 25 },
    { qtyMin: 5000, qtyMax: null, priceMin: 0, priceMax: null, valuePct: 20 },
  ],
  marginFallbackPct: 30,
  fixCost: 150,
  designFee: 2500,
  structureDesignFee: 1500,
  vatPct: 7,
  ...over,
});

const offsetTerms = {
  wasteMethod: 1,
  finish2StepDownWaste: false,
  fourColourPriceByMaxPercent: false,
  assemblyWasteByAssembly: false,
  diecutWasteByBoxAmount: false,
  factoryMarginPct: 12,
};

const printPrice = (
  inkColourId: string,
  percentColor: number,
  pricePerSheet: number,
  pricePerPcs: number,
  combine = 0,
) => ({
  ...all,
  machineId: 'P1',
  inkColourId,
  percentColor,
  pricePerSheet,
  pricePerPcs,
  flatPriceFourColor: 1200,
  flatPriceFourColorPerPcs: 0.35,
  priceColorCombineSpecialColor: combine,
  operationCost: 150,
});

const offsetTables = (over: Partial<OffsetTables> = {}): OffsetTables => ({
  terms: offsetTerms,
  standardInkColours: new Set(['cmyk', 'black']),
  printWastes: [
    { minSheets: 0, maxSheets: 2000, minPercent: 0, maxPercent: 50, percentWaste: 8, setupWaste: 60 },
    {
      minSheets: 2000.01,
      maxSheets: 1000000,
      minPercent: 0,
      maxPercent: 50,
      percentWaste: 5,
      setupWaste: 80,
    },
    { minSheets: 0, maxSheets: 2000, minPercent: 50.01, maxPercent: 100, percentWaste: 10, setupWaste: 80 },
    {
      minSheets: 2000.01,
      maxSheets: 1000000,
      minPercent: 50.01,
      maxPercent: 100,
      percentWaste: 6,
      setupWaste: 100,
    },
  ],
  finishWastes: [{ ...all, finishId: null, percentWaste: 4, setupWaste: 25 }],
  diecutWastes: [{ ...all, diecutTypeId: 'dc', minBox: null, maxBox: null, percentWaste: 3, setupWaste: 30 }],
  assemblyWastes: [{ ...all, assemblyId: null, percentWaste: 2, setupWaste: 15 }],
  printPlates: [
    { machineId: 'P1', wMin: 18, wMax: 31, lMin: 24, lMax: 43, platePrice: 450 },
    { machineId: 'P2', wMin: 10, wMax: 25, lMin: 15, lMax: 36, platePrice: 300 },
  ],
  printPrices: [
    printPrice('cmyk', 100, 1.1, 0.4),
    printPrice('black', 100, 0.8, 0.2),
    printPrice('pantone', 40, 1.5, 0.6, 90),
    { ...printPrice('cmyk', 100, 0.9, 0.35), machineId: 'P2' },
    { ...printPrice('black', 100, 0.7, 0.2), machineId: 'P2' },
    { ...printPrice('pantone', 40, 1.3, 0.5, 80), machineId: 'P2' },
  ],
  finishPrices: [
    {
      ...all,
      finishId: 'matt',
      machineId: null,
      finishPrice: 0,
      pricePerSheet: 0.45,
      priceByAreaPerIn2: 0.0012,
      minPrice: 350,
      toolingPrice: 120,
      blockPricePerIn2: 0,
      materialPricePerIn2: 0,
      operationCost: 40,
      addsDiecutWindow: false,
    },
    {
      ...all,
      finishId: 'foil',
      machineId: 'F1',
      finishPrice: 600,
      pricePerSheet: 0.9,
      priceByAreaPerIn2: 0,
      minPrice: 900,
      toolingPrice: 200,
      blockPricePerIn2: 0,
      materialPricePerIn2: 0.004,
      operationCost: 60,
      addsDiecutWindow: false,
    },
  ],
  finishPlates: [
    {
      finishId: 'foil',
      machineId: 'F1',
      wMin: 10,
      wMax: 31,
      lMin: 15,
      lMax: 43,
      pricePerIn2: 2.5,
      minPlatePrice: 800,
    },
  ],
  diecutPrices: [{ ...all, machineId: 'D1', diecutPrice: 400, pricePerSheet: 0.5, operationCost: 70 }],
  diecutBlocks: [
    {
      machineId: 'D1',
      wMin: 10,
      wMax: 31,
      lMin: 15,
      lMax: 43,
      layMin: 1,
      layMax: 60,
      diecutPrice: 1500,
      pricePerDrawing: 35,
    },
  ],
  assemblyPrices: [],
  assemblySheets: [{ wIn: 20, lIn: 28 }],
  patternKind: null,
  ...over,
});

const digitalTables = (
  over: Partial<DigitalTables['terms']> = {},
  rows: Partial<DigitalTables> = {},
): DigitalTables => ({
  terms: {
    ...offsetTerms,
    factoryMarginPct: 15,
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
    ...over,
  },
  printTypeId: 'digital',
  printWastes: [{ ...all, minPercent: null, maxPercent: null, percentWaste: 3, setupWaste: 10 }],
  finishWastes: [{ ...all, finishId: null, percentWaste: 2, setupWaste: 5 }],
  diecutWastes: [{ ...all, diecutTypeId: 'dc', minBox: null, maxBox: null, percentWaste: 2, setupWaste: 5 }],
  assemblyWastes: [],
  materialPrices: [
    { minPaperAmount: null, maxPaperAmount: null, costPerKg: null, costPerPcs: 6.5, costPerM2: 14 },
    { minPaperAmount: 0, maxPaperAmount: 200, costPerKg: null, costPerPcs: 9, costPerM2: null },
    { minPaperAmount: 201, maxPaperAmount: 100000, costPerKg: null, costPerPcs: 7.5, costPerM2: null },
  ],
  printPrices: [
    {
      ...all,
      machineId: 'X1',
      inkColourId: 'cmyk',
      percentColor: null,
      pricePerSheet: 0,
      pricePerPcs: 3.2,
      flatPriceFourColor: 0,
      flatPriceFourColorPerPcs: 0,
      priceColorCombineSpecialColor: 0,
      operationCost: 0,
      minBox: 0,
      maxBox: 100000,
      materialId: null,
      priceInkPerM2: 9.5,
      addTwoSidePerSqm: 0,
    },
  ],
  finishPrices: [
    {
      ...all,
      finishId: 'matt',
      machineId: null,
      finishPrice: 0,
      pricePerSheet: 2.2,
      priceByAreaPerIn2: 0.006,
      minPrice: 250,
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
      machineId: 'X1',
      diecutPrice: 500,
      pricePerSheet: 1.8,
      operationCost: 0,
      pricePerPcs: 0,
      minPrice: 300,
    },
  ],
  diecutBlocks: [
    {
      machineId: 'X1',
      wMin: 10,
      wMax: 31,
      lMin: 15,
      lMax: 43,
      layMin: null,
      layMax: null,
      diecutPrice: 900,
      pricePerDrawing: 0,
      minPcs: 0,
      maxPcs: 100000,
      pricePerPcs: 0.3,
      minDiecutPrice: 600,
    },
  ],
  assemblyPrices: [],
  ...rows,
});

const cmyk = (percent = 100) => [1, 2, 3, 4].map(() => ({ inkColourId: 'cmyk', percent }));
const req = (over: Partial<PartRequest> = {}): PartRequest => ({
  materialId: 'art350',
  difficultyLevelId: 'normal',
  printFront: cmyk(),
  finish2: [],
  assemblies: [],
  ...over,
});
const option = (over: Partial<FoldingOption> & Pick<FoldingOption, 'tables' | 'parts'>): FoldingOption => ({
  optionKey: 'F1:offset',
  factoryId: 'F1',
  printTypeId: 'offset',
  engine: 'a_offset',
  leadTimeDays: 8,
  bulkLeadTime: null,
  minOrderForProduction: 500,
  sell: sell(),
  unavailable: [],
  ...over,
});
const one = (g: GeometrySnapshot) => ({ main: { geometry: g, exclusions: [] } });
const input = (
  request: PartRequest,
  quantities: number[] = [1000],
  dims = { w: 200, l: 300, d: 50 },
  design = { graphic: false, structure: false },
): FoldingInput => ({
  quantities,
  parts: [{ key: 'main', geometry: dims, request }],
  design,
});

const tuckTop: PatternGeometry = {
  formula: 'tuck_top',
  conditions: { dw: [band(15)], dl: [band(12, 'l', 'g')] },
};
const lockBottom: PatternGeometry = {
  formula: 'lock_bottom_top',
  conditions: { dw: [band(4, 'w', 'b')], aux_f: [band(13, 'l')], dl: [band(10, 'l', 'g')] },
};

export const CASES: GoldenCase[] = [
  {
    id: '01-flat-cmyk',
    title: 'Flat blank, CMYK front (one 4-colour pass), 1,000 pieces',
    legacy: [
      'PatternArea.php:513-517',
      'A/CalculateWaste.php:876-909',
      'A/CalculateCost.php:356-677',
      'Calculator.php:400-449',
    ],
    input: input(req()),
    options: [option({ tables: offsetTables(), parts: one(geometry(flat)) })],
  },
  {
    id: '02-matt-front',
    title: 'Case 1 + matt lamination front',
    legacy: ['A/CalculateWaste.php:727-748', 'A/CalculateCost.php:945-979'],
    input: input(req({ finish1FrontId: 'matt' })),
    options: [option({ tables: offsetTables(), parts: one(geometry(flat)) })],
  },
  {
    id: '03-diecut',
    title: 'Case 2 + die-cut (cheapest die block per machine)',
    legacy: ['A/CalculateWaste.php:700-725', 'A/CalculateCost.php:679-840'],
    input: input(req({ finish1FrontId: 'matt', diecutTypeId: 'dc' })),
    options: [option({ tables: offsetTables(), parts: one(geometry(flat)) })],
  },
  {
    id: '04-back-pantone',
    title: 'CMYK front, one Pantone 40 % on the back (special colour with combine price)',
    legacy: ['A/CalculateWaste.php:911-950', 'A/CalculateCost.php:547-649'],
    input: input(req({ printBack: [{ inkColourId: 'pantone', percent: 40 }] })),
    options: [option({ tables: offsetTables(), parts: one(geometry(flat)) })],
  },
  {
    id: '05-min-order',
    title: '300 pieces raised to the 500 production minimum',
    legacy: ['FoldingCalculator.php:1308-1318, 1389, 1442'],
    input: input(req({ finish1FrontId: 'matt' }), [300]),
    options: [option({ tables: offsetTables(), parts: one(geometry(flat)) })],
  },
  {
    id: '06-quantity-tiers',
    title: 'Three quantities 500 / 1,000 / 5,000 across the sell-margin tiers',
    legacy: ['FoldingCalculator.php:1419-1427', 'Calculator.php:406-415'],
    input: input(req({ finish1FrontId: 'matt', diecutTypeId: 'dc' }), [500, 1000, 5000]),
    options: [option({ tables: offsetTables(), parts: one(geometry(flat)) })],
  },
  {
    id: '07-tuck-top',
    title: 'Tuck-top pattern with flap allowances by width and length',
    legacy: ['PatternArea.php:186-219'],
    input: input(req({ diecutTypeId: 'dc' }), [1000], { w: 60, l: 90, d: 150 }),
    options: [option({ tables: offsetTables(), parts: one(geometry(tuckTop)) })],
  },
  {
    id: '08-lock-bottom',
    title: 'Lock-bottom pattern laid in combined pairs',
    legacy: ['PatternArea.php:519-572', 'helpers.php:600-637'],
    input: input(req({ diecutTypeId: 'dc' }), [1000], { w: 60, l: 90, d: 30 }),
    options: [option({ tables: offsetTables(), parts: one(geometry(lockBottom)) })],
  },
  {
    id: '09-flat-overlap',
    title: 'Flat blank with a 20 mm overlap',
    legacy: ['PatternArea.php:507-511', 'helpers.php:638-693'],
    input: {
      ...input(req()),
      parts: [{ key: 'main', geometry: { w: 200, l: 300, d: 50, c: 20 }, request: req() }],
    },
    options: [
      option({ tables: offsetTables(), parts: one(geometry({ formula: 'flat_overlap', conditions: {} })) }),
    ],
  },
  {
    id: '10-fixed-grain',
    title: 'Fixed grain along the blank length (fix-grain sheets only, one orientation)',
    legacy: ['PatternArea.php:790-792, 947, 1029'],
    input: {
      ...input(req()),
      parts: [
        {
          key: 'main',
          geometry: { w: 200, l: 300, d: 50, isGrain: true, grainParallel: 'dl' },
          request: req(),
        },
      ],
    },
    options: [option({ tables: offsetTables(), parts: one(geometry(flat)) })],
  },
  {
    id: '11-flip-sheets',
    title: 'Factory that flips sheet sizes (port-map Q13)',
    legacy: ['helpers.php:1140-1172', 'PatternArea.php:861-865'],
    input: input(req()),
    options: [
      option({
        tables: offsetTables(),
        parts: one(
          geometry(flat, {
            terms: { useMaxMinPaperTrim: true, canFlipPaperSize: true, disableOverlapLayout: false },
          }),
        ),
      }),
    ],
  },
  {
    id: '12-waste-method-2',
    title: 'Setup waste on the first process only (waste method 2)',
    legacy: ['A/CalculateWaste.php:775-793'],
    input: input(req({ finish1FrontId: 'matt', diecutTypeId: 'dc' })),
    options: [
      option({
        tables: offsetTables({ terms: { ...offsetTerms, wasteMethod: 2 } }),
        parts: one(geometry(flat)),
      }),
    ],
  },
  {
    id: '13-foil',
    title: 'Hot foil at two 40 × 20 mm locations (finish 2 with plate)',
    legacy: ['A/CalculateWaste.php:795-874', 'A/CalculateCost.php:1037-1193'],
    input: input(
      req({
        finish2: [
          {
            finishId: 'foil',
            requiresAmount: true,
            requiresWidth: true,
            requiresLength: true,
            amount: 2,
            w: [40, 40],
            l: [20, 20],
          },
        ],
      }),
    ),
    options: [option({ tables: offsetTables(), parts: one(geometry(flat)) })],
  },
  {
    id: '14-assembly-per-piece',
    title: 'Gluing priced per piece (assembly type 3)',
    legacy: ['A/CalculateWaste.php:654-698', 'A/CalculateCost.php:1537-1558'],
    input: input(
      req({
        diecutTypeId: 'dc',
        assemblies: [
          {
            assemblyId: 'glue',
            requiresAmount: false,
            requiresWidth: false,
            requiresLength: false,
            skipWaste: false,
          },
        ],
      }),
    ),
    options: [
      option({
        tables: offsetTables({
          assemblyPrices: [
            {
              assemblyId: 'glue',
              rangeMin: 0,
              rangeMax: null,
              assemblyType: 3,
              addsDiecutWindow: false,
              pricePerCm: 0,
              pricePerPcs: 0.45,
              minPrice: 400,
              minimumOperation: 0,
              blockPrice: 0,
              materialPricePerIn2: 0,
            },
          ],
        }),
        parts: one(geometry(flat)),
      }),
    ],
  },
  {
    id: '15-assembly-by-height',
    title: 'Handle priced by box height with a minimum operation (assembly type 1)',
    legacy: ['A/CalculateCost.php:1449-1482'],
    input: input(
      req({
        diecutTypeId: 'dc',
        assemblies: [
          {
            assemblyId: 'handle',
            requiresAmount: false,
            requiresWidth: false,
            requiresLength: false,
            skipWaste: true,
          },
        ],
      }),
    ),
    options: [
      option({
        tables: offsetTables({
          assemblyPrices: [
            {
              assemblyId: 'handle',
              rangeMin: 0,
              rangeMax: null,
              assemblyType: 1,
              addsDiecutWindow: false,
              pricePerCm: 0.08,
              pricePerPcs: 0,
              minPrice: 500,
              minimumOperation: 200,
              blockPrice: 150,
              materialPricePerIn2: 0,
            },
          ],
        }),
        parts: one(geometry(flat)),
      }),
    ],
  },
  {
    id: '16-window',
    title: 'Window film 50 × 40 mm with its die-cut on assembly sheets (assembly type 2)',
    legacy: ['A/CalculateCost.php:1262-1440, 1484-1535'],
    input: input(
      req({
        diecutTypeId: 'dc',
        assemblies: [
          {
            assemblyId: 'window',
            requiresAmount: true,
            requiresWidth: true,
            requiresLength: true,
            skipWaste: false,
            amount: 1,
            w: [50],
            l: [40],
          },
        ],
      }),
    ),
    options: [
      option({
        tables: offsetTables({
          assemblyPrices: [
            {
              assemblyId: 'window',
              rangeMin: 0,
              rangeMax: null,
              assemblyType: 2,
              addsDiecutWindow: true,
              pricePerCm: 0.02,
              pricePerPcs: 0.3,
              minPrice: 600,
              minimumOperation: 100,
              blockPrice: 0,
              materialPricePerIn2: 0.01,
            },
          ],
          // The window die block is matched to the assembly sheet by its exact size (`A/CalculateCost.php:1333-1334`).
          diecutBlocks: [
            {
              machineId: 'D1',
              wMin: 10,
              wMax: 31,
              lMin: 15,
              lMax: 43,
              layMin: 1,
              layMax: 60,
              diecutPrice: 1500,
              pricePerDrawing: 35,
            },
            {
              machineId: 'D1',
              wMin: 10,
              wMax: 20,
              lMin: 15,
              lMax: 28,
              layMin: 1,
              layMax: 400,
              diecutPrice: 900,
              pricePerDrawing: 10,
            },
          ],
        }),
        parts: one(geometry(flat)),
      }),
    ],
  },
  {
    id: '17-digital',
    title: 'Digital: paper and ink by sheet area, matt, die-cut per run',
    legacy: ['A/CalculateCostDigital.php:137-140, 174, 245, 305-321'],
    input: input(req({ finish1FrontId: 'matt', diecutTypeId: 'dc' }), [100, 300]),
    options: [
      option({
        engine: 'a_digital',
        printTypeId: 'digital',
        optionKey: 'F1:digital',
        minOrderForProduction: null,
        tables: digitalTables(),
        parts: one(geometry(flat)),
      }),
    ],
  },
  {
    id: '18-digital-per-sheet',
    title: 'Digital with legacy factory 23 terms (per sheet, flat die block by pieces)',
    legacy: ['A/CalculateCostDigital.php:131-133, 171-172, 242-243, 325-353'],
    input: input(req({ finish1FrontId: 'matt', diecutTypeId: 'dc' }), [300]),
    options: [
      option({
        engine: 'a_digital',
        printTypeId: 'digital',
        optionKey: 'F1:digital',
        minOrderForProduction: null,
        tables: digitalTables({
          paperMethod: 'per_sheet',
          printMethod: 'per_sheet',
          finishMethod: 'per_sheet',
          diecutBlock: 'flat_by_pieces',
        }),
        parts: one(geometry(flat)),
      }),
    ],
  },
  {
    id: '19-digital-per-piece',
    title:
      'Digital with legacy factory 9 terms (paper band per piece, ink on the blank by run, ×1.2, bulk lead time)',
    legacy: ['A/CalculateCostDigital.php:112-130, 154-170, 240-241, 459-469', 'helpers.php:1980-2012'],
    input: input(req({ finish1FrontId: 'matt', diecutTypeId: 'dc' }), [300, 600]),
    options: [
      option({
        engine: 'a_digital',
        printTypeId: 'digital',
        optionKey: 'F1:digital',
        minOrderForProduction: null,
        bulkLeadTime: { minQty: 500, days: 12 },
        tables: digitalTables({
          paperMethod: 'per_piece_band',
          printMethod: 'blank_area',
          printBand: 'box',
          finishMethod: 'per_sheet_per_layout',
          diecutBlock: 'per_piece',
          costMultiplier: 1.2,
        }),
        parts: one(geometry(flat)),
      }),
    ],
  },
  {
    id: '20-two-factories',
    title: 'Two factories: the lower buy price wins; design fees once per quote',
    legacy: ['FoldingCalculator.php:874-1240', 'Calculator.php:241-289'],
    input: input(
      req({ finish1FrontId: 'matt', diecutTypeId: 'dc' }),
      [1000, 3000],
      { w: 200, l: 300, d: 50 },
      { graphic: true, structure: true },
    ),
    options: [
      option({ tables: offsetTables(), parts: one(geometry(flat)) }),
      option({
        optionKey: 'F2:offset',
        factoryId: 'F2',
        leadTimeDays: 5,
        tables: offsetTables({ terms: { ...offsetTerms, factoryMarginPct: 8 } }),
        parts: one(
          geometry(flat, {
            paperTrim: { gap: 4, trimW: 12, trimL: 14, edgeTrim: 6, trimFoil: 4, trimFinishPlate: 6 },
          }),
        ),
      }),
    ],
  },
];
