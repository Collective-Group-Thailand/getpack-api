import vectors from '../../../../../test/golden/corrugate/reference/flexo.vectors.json';
import { phpRound } from '../../engine/php';
import {
  corrugateCalculator,
  type CorrugateInput,
  type CorrugateOption,
  type CorrugatePart,
} from './corrugate-calculator';
import { type FlexoLayout } from './flexo';

/**
 * The corrugate orchestration (`CorrugateCalculator::calculate_cs:310-1097`, U-B6 slice 6): its rules on top of
 * the engines, which have their own vectors. Made-up price lists (the flexo fixture of `flexo_reference.py`).
 */

const t = vectors.fixtures.tables;
const FLUTE = { a: 3, c: 4, dd: 5, g: 35, fh: 3, ct: 2, z: 0.5 };
const SELL = {
  marginLines: [],
  marginFallbackPct: 30,
  fixCost: 0,
  designFee: 2000,
  structureDesignFee: 1500,
  vatPct: 7,
  priceMaxInclusive: true,
};

const option = (over: Partial<CorrugateOption> = {}): CorrugateOption => ({
  optionKey: 'F1:flexo',
  factoryId: 'F1',
  printTypeId: '1',
  engine: 'flexo',
  leadTimeDays: 9.5,
  bulkLeadTime: null,
  minOrderAmount: 300,
  maxColours: 3,
  printArea: { method: 1, topSideCombined: false },
  packing: { rscFamilyPerPcs: null, otherPerPcs: null, freeOnRsc: false },
  engineTerms: t.terms,
  digitalTerms: {
    factoryMarginPct: 12,
    trimDlMm: 0,
    trimDwMm: 0,
    printFixCostPerSqm: null,
    nonPrintFixCostPerSqm: null,
    paperPriceByOrderAmount: false,
    digitalDieBlock: false,
    minLotPrice: null,
    backPrintPricePerM2: null,
    twoSideAddon: false,
  },
  process: t.process,
  rollWidthsIn: t.rollWidthsIn,
  boardPrices: t.boardPrices,
  difficulty: t.difficulty,
  margins: t.margins,
  percentReduces: t.percentReduces,
  flexoDieBlocks: t.dieBlocks,
  digital: {
    sheetSizes: [],
    printPrices: [],
    finishPrices: [],
    diecutPrices: [],
    dieBlocks: [],
    fixCostPcts: [],
  },
  assemblyPrices: vectors.fixtures.assemblyPrices as CorrugateOption['assemblyPrices'],
  trimFinishPlateMm: 3,
  inkColours: new Set(['cyan', 'black']),
  patternConditions: {},
  fixedOptions: [],
  sell: SELL,
  ...over,
});

const part = (over: Partial<CorrugatePart> = {}): CorrugatePart => ({
  key: 'main',
  formula: 'rsc',
  printFront: [{ inkColourId: 'cyan', area: 'top', percent: null }],
  printBack: [],
  coatingFrontId: null,
  coatingBackId: null,
  assemblies: [],
  ...over,
});

const input = (over: Partial<CorrugateInput> = {}): CorrugateInput => ({
  quantities: [200, 1000],
  parts: [part()],
  design: { graphic: true, structure: true },
  size: { w: 300, l: 400, d: 250 },
  flute: FLUTE,
  materialId: 'm1',
  materialCoatable: false,
  conditions: {},
  standardSize: false,
  autoAssemblies: [{ assemblyId: 'pack', requiresAmount: false, autoAdd: true }],
  digitalFrontCoveragePct: null,
  ...over,
});

const run = (i: CorrugateInput, o: CorrugateOption = option()) =>
  corrugateCalculator.calculate(i, { options: [o] }).options[0]!;

describe('corrugate calculator (CorrugateCalculator::calculate_cs)', () => {
  it('charges plates at the factory price × VAT, rounded up to the baht, apart from the product (`:835-837`)', () => {
    const step = run(input()).steps[1]!;
    const p = step.parts[0]!;
    expect(p.plates).toBe(phpRound((p.layout as FlexoLayout).plates, 2));
    expect(p.platesSale).toBe(Math.ceil(p.plates * 1.07));
    expect(p.dieBlockSale).toBe(0); // RSC: no die
    expect(step.tooling).toBe(p.platesSale);
    expect(step.total).toBeCloseTo(p.forSale.total + p.platesSale + 2000 + 1500, 9);
    expect(step.buyPrice).toBeCloseTo(p.buyPrice + p.plates, 9);
    // VAT: the product's plus the VAT inside the plates charged.
    expect(step.vatPrice).toBeCloseTo(p.forSale.vatPrice + (p.platesSale - p.platesSale / 1.07), 9);
    expect(step.leadTimeDays).toBe(10);
  });

  it('adds the automatic packing assembly to every part (quirk C8)', () => {
    const step = run(input()).steps[1]!;
    expect(step.parts[0]!.assemblies.map((a) => a.assemblyId)).toEqual(['pack']);
  });

  it('prices every part of a combination and adds the design fees once (quirk C14)', () => {
    const two = run(
      input({
        size: { w: 150, l: 200, d: 80 },
        parts: [part({ key: 'body', formula: 'tele_body' }), part({ key: 'lid', formula: 'tele_lid' })],
      }),
    ).steps[1]!;
    expect(two.parts).toHaveLength(2);
    const sumParts = two.parts.reduce((a, p) => a + p.forSale.total + p.platesSale + p.dieBlockSale, 0);
    expect(two.total).toBeCloseTo(sumParts + 2000 + 1500, 9);
  });

  it('leaves a quantity under the minimum order unpriced, not the option (`:389-395`)', () => {
    const result = run(input());
    expect(result.steps[0]).toBeNull();
    expect(result.stepErrors[0]).toEqual({ code: 'process_not_possible', detail: 'minimum order 300' });
    expect(result.steps[1]).not.toBeNull();
    expect(result.error).toBeNull();
  });

  it.each([
    [
      'more colours than the difficulty margins know (`:429-437`)',
      input({
        parts: [
          part({
            printFront: ['cyan', 'black', 'cyan', 'black'].map((c) => ({
              inkColourId: c,
              area: null,
              percent: 20,
            })),
          }),
        ],
      }),
      option({ maxColours: null }),
      { code: 'process_not_possible', detail: 'main: prints at most 3 colours' },
    ],
    [
      'more colours than the factory prints (`:448-455`)',
      input({
        parts: [
          part({ printFront: ['cyan', 'black'].map((c) => ({ inkColourId: c, area: null, percent: 20 })) }),
        ],
      }),
      option({ maxColours: 1 }),
      { code: 'process_not_possible', detail: 'main: prints at most 1 colours' },
    ],
    [
      'a colour the factory does not print',
      input({ parts: [part({ printFront: [{ inkColourId: 'gold', area: 'top', percent: null }] })] }),
      option(),
      { code: 'price_line_missing', detail: 'main: ink_colours gold' },
    ],
    [
      'a coating on a board that takes none (`:569`)',
      input({ parts: [part({ coatingFrontId: 'matt' })] }),
      option({ engine: 'digital' }),
      { code: 'process_not_possible', detail: 'main: the board takes no coating' },
    ],
    [
      'no terms at the difficulty level (`:458-468`)',
      input(),
      option({ difficulty: null }),
      { code: 'price_line_missing', detail: 'main: difficulty_levels' },
    ],
  ])('refuses the option for %s', (_why, i, o, error) => {
    const result = run(i, o);
    expect(result.error).toEqual(error);
    expect(result.steps.every((s) => s === null)).toBe(true);
  });

  it('applies the fixed options of the box style: an assembly and die delivery rounds (`:672-689`)', () => {
    // A single tuck is die-cut: its die-cut fixed options apply, the RSC one does not.
    const i = input({ size: { w: 150, l: 220, d: 90 }, parts: [part({ formula: 'single_tuck' })] });
    // One die block, with a delivery cost of 300 per round.
    const oneBlock = { flexoDieBlocks: [t.dieBlocks[0]!] };
    const fixed = option({
      ...oneBlock,
      fixedOptions: [
        {
          partKey: 'main',
          boxStyle: 'die_cut',
          assembly: { assemblyId: 'glue', requiresAmount: false, autoAdd: false },
          deliveryRounds: null,
        },
        { partKey: 'main', boxStyle: 'die_cut', assembly: null, deliveryRounds: 2 },
        {
          partKey: 'main',
          boxStyle: 'rsc',
          assembly: { assemblyId: 'stitch', requiresAmount: false, autoAdd: false },
          deliveryRounds: null,
        },
      ],
    });
    const plain = run(i, option(oneBlock)).steps[1]!.parts[0]!;
    const withFixed = run(i, fixed).steps[1]!.parts[0]!;
    expect(withFixed.assemblies.map((a) => a.assemblyId)).toEqual(['pack', 'glue']);
    expect((withFixed.layout as FlexoLayout).dieDelivery).toBe(600);
    expect((plain.layout as FlexoLayout).dieDelivery).toBe(0);
    expect(withFixed.buyPrice).toBeGreaterThan(plain.buyPrice);
  });

  it('charges no die block on a standard size', () => {
    const i = input({ size: { w: 150, l: 220, d: 90 }, parts: [part({ formula: 'single_tuck' })] });
    const normal = run(i).steps[1]!.parts[0]!;
    const standard = run({ ...i, standardSize: true }).steps[1]!.parts[0]!;
    expect(normal.dieBlock).toBeGreaterThan(0);
    expect(standard.dieBlock).toBe(0);
    expect(standard.dieBlockSale).toBe(0);
  });

  it('waives reused plates and die block at the factory keeping them, sale and buy alike (D-289)', () => {
    const i = input({ size: { w: 150, l: 220, d: 90 }, parts: [part({ formula: 'single_tuck' })] });
    const full = run(i).steps[1]!;
    const p = full.parts[0]!;
    expect(p.platesSale).toBeGreaterThan(0);
    expect(p.dieBlockSale).toBeGreaterThan(0);
    expect(full.toolingWaived).toEqual({ platesSale: 0, dieBlockSale: 0, platesBuy: 0, dieBlockBuy: 0 });

    const dieOnly = run({ ...i, waiveTooling: { F1: { plates: false, dieBlock: true } } }).steps[1]!;
    expect(dieOnly.tooling).toBe(p.platesSale);
    expect(dieOnly.total).toBeCloseTo(full.total - p.dieBlockSale, 9);
    expect(dieOnly.buyPrice).toBeCloseTo(full.buyPrice - p.dieBlock, 9);
    expect(dieOnly.toolingWaived).toEqual({
      platesSale: 0,
      dieBlockSale: p.dieBlockSale,
      platesBuy: 0,
      dieBlockBuy: p.dieBlock,
    });
    expect(dieOnly.toolingCharged.dieBlockSale).toBe(0);

    const both = run({ ...i, waiveTooling: { F1: { plates: true, dieBlock: true } } }).steps[1]!;
    expect(both.tooling).toBe(0);
    expect(both.total).toBeCloseTo(full.total - p.platesSale - p.dieBlockSale, 9);
    expect(both.vatPrice).toBeCloseTo(full.vatPrice - (full.tooling - full.tooling / 1.07), 9);

    // Another factory's tooling waives nothing here.
    const other = run({ ...i, waiveTooling: { F2: { plates: true, dieBlock: true } } }).steps[1]!;
    expect(other.total).toBe(full.total);
    expect(other.buyPrice).toBe(full.buyPrice);
  });
});
