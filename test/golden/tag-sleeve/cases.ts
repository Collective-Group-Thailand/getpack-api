import {
  type FoldingInput,
  type FoldingOption,
} from '@modules/pricing/calculators/folding/folding-calculator';
import { type AssemblyRequest, type PartRequest } from '@modules/pricing/calculators/folding/request';
import { type AssemblyPriceRow } from '@modules/pricing/calculators/folding/tables';

import {
  cmyk,
  digitalTables,
  flat,
  geometry,
  offsetTables,
  offsetTerms,
  one,
  option,
  req,
  sell,
} from '../folding/cases';

/**
 * The 20 tag & sleeve validation cases (U-B6 tag & sleeve). A tag or sleeve is a flat folding blank (legacy patterns
 * 33–36, d = 0) priced on folding engine A (`docs/legacy/05-tag-sleeve-port-map.md` §0), so the cases reuse the
 * folding cases' made-up price lists and check what the tag port adds: the flat d = 0 blank, the hole and corner-cut
 * assemblies, finish 2 offset only (T9), one option per print type (T3–T5), the production minimum (T16), the
 * graphic fee without a structure fee (T18). The expected result is `<id>.json`, the port's output (the engine is
 * checked piece by piece by the folding unit vectors). Regenerate with `UPDATE_GOLDEN=1` and
 * `--testPathPatterns tag-sleeve-golden` only after a reviewed change.
 */

export interface GoldenCase {
  id: string;
  title: string;
  /** Legacy code the case exercises. */
  legacy: string[];
  input: FoldingInput;
  options: FoldingOption[];
}

const tag = (
  request: PartRequest,
  quantities: number[] = [1000],
  size = { w: 50, l: 90 },
  design = { graphic: false, structure: false },
): FoldingInput => ({
  quantities,
  parts: [{ key: 'main', geometry: { ...size, d: 0 }, request }],
  design,
});

const assembly = (assemblyId: string): AssemblyRequest => ({
  assemblyId,
  requiresAmount: false,
  requiresWidth: false,
  requiresLength: false,
  skipWaste: false,
});
const perPiece = (assemblyId: string, pricePerPcs: number, minPrice: number): AssemblyPriceRow => ({
  assemblyId,
  rangeMin: 0,
  rangeMax: null,
  assemblyType: 3,
  addsDiecutWindow: false,
  pricePerCm: 0,
  pricePerPcs,
  minPrice,
  minimumOperation: 0,
  blockPrice: 0,
  materialPricePerIn2: 0,
});
/** Legacy CS defaults for patterns 33 / 34: hole 3 mm (group 23) and corner cut (group 25), `cs-v2.vue:1548-1551`. */
const holeAndCorner = [assembly('hole'), assembly('corner')];
const tagAssemblies = [perPiece('hole', 0.06, 200), perPiece('corner', 0.04, 150)];
const digitalAssemblies: AssemblyPriceRow[] = tagAssemblies.map((r) => ({
  ...r,
  printTypeId: 'digital',
  digitalMethod: 'per_piece',
}));

/** A tag die block: small tags lay up to 400 per sheet (the folding cases' block stops at 60). */
const tagDiecutBlocks = [
  {
    machineId: 'D1',
    wMin: 10,
    wMax: 31,
    lMin: 15,
    lMax: 43,
    layMin: 1,
    layMax: 400,
    diecutPrice: 1800,
    pricePerDrawing: 6,
  },
];
const tagOffsetTables = (over: Parameters<typeof offsetTables>[0] = {}) =>
  offsetTables({ assemblyPrices: tagAssemblies, diecutBlocks: tagDiecutBlocks, ...over });

const tagReq = (over: Partial<PartRequest> = {}) => req({ diecutTypeId: 'dc', ...over });
const offsetOption = (over: Partial<FoldingOption> = {}) =>
  option({ tables: tagOffsetTables(), parts: one(geometry(flat)), ...over });
const digitalOption = (over: Partial<FoldingOption> = {}, terms = {}) =>
  option({
    engine: 'a_digital',
    printTypeId: 'digital',
    optionKey: 'F1:digital',
    minOrderForProduction: null,
    leadTimeDays: 3,
    tables: digitalTables(terms, { assemblyPrices: digitalAssemblies }),
    parts: one(geometry(flat)),
    ...over,
  });
const foil = (amount: number, w: number[], l: number[]) => ({
  finishId: 'foil',
  requiresAmount: true,
  requiresWidth: true,
  requiresLength: true,
  amount,
  w,
  l,
});

export const CASES: GoldenCase[] = [
  {
    id: '01-hang-tag',
    title: 'Hang tag 50 × 90 mm (pattern 33), CMYK front, die-cut, 1,000 pieces',
    legacy: [
      'PatternArea.php:637-656',
      'TagAndSleeveCalculator.php:493-720',
      'FoldingCalculator.php:1293-1476',
    ],
    input: tag(tagReq()),
    options: [offsetOption()],
  },
  {
    id: '02-matt-front',
    title: 'Case 1 + matt lamination front',
    legacy: ['TagAndSleeveCalculator.php:597-627', 'A/CalculateCost.php:945-979'],
    input: tag(tagReq({ finish1FrontId: 'matt' })),
    options: [offsetOption()],
  },
  {
    id: '03-hole-corner-cut',
    title: 'Cut-corner tag with the legacy default hole 3 mm and corner cut (assemblies per piece)',
    legacy: ['cs-v2.vue:1548-1551', 'A/CalculateWaste.php:654-698', 'A/CalculateCost.php:1537-1558'],
    input: tag(tagReq({ finish1FrontId: 'matt', assemblies: holeAndCorner })),
    options: [offsetOption()],
  },
  {
    id: '04-rounded-tiers',
    title: 'Rounded-corner tag (pattern 34) with a hole: 500 / 1,000 / 5,000 across the sell-margin tiers',
    legacy: ['FoldingCalculator.php:1409-1440', 'Calculator.php:406-415'],
    input: tag(tagReq({ assemblies: [assembly('hole')] }), [500, 1000, 5000]),
    options: [offsetOption()],
  },
  {
    id: '05-printed-sheet',
    title: 'Printed sheet A5 148 × 210 mm (pattern 35), CMYK both sides, no assemblies',
    legacy: ['PatternArea.php:637-656', 'A/CalculateWaste.php:911-950'],
    input: tag(tagReq({ printBack: cmyk() }), [1000], { w: 148, l: 210 }),
    options: [offsetOption()],
  },
  {
    id: '06-cup-sleeve',
    title: 'Cup sleeve priced flat 280 × 90 mm (pattern 36, no glue flap), matt front',
    legacy: ['PatternArea.php:637-656', 'FoldingUtil.php:397-401'],
    input: tag(tagReq({ finish1FrontId: 'matt' }), [2000], { w: 280, l: 90 }),
    options: [offsetOption()],
  },
  {
    id: '07-back-pantone',
    title: 'CMYK front, one Pantone 40 % on the back',
    legacy: ['TagAndSleeveCalculator.php:560-596', 'A/CalculateCost.php:547-649'],
    input: tag(tagReq({ printBack: [{ inkColourId: 'pantone', percent: 40 }] })),
    options: [offsetOption()],
  },
  {
    id: '08-production-minimum',
    title: '300 tags raised to the 500 production minimum; the sell side on the 300 asked (T16)',
    legacy: ['FoldingCalculator.php:1308-1318, 1442'],
    input: tag(tagReq({ assemblies: [assembly('hole')] }), [300]),
    options: [offsetOption()],
  },
  {
    id: '09-foil',
    title: 'Hot foil at one 30 × 15 mm location (finish 2, offset)',
    legacy: ['TagAndSleeveCalculator.php:628-650', 'A/CalculateCost.php:1037-1193'],
    input: tag(tagReq({ finish2: [foil(1, [30], [15])] })),
    options: [offsetOption()],
  },
  {
    id: '10-foil-digital-refused',
    title: 'Foil on a factory with offset and digital: digital refused (finish 2 is offset only, T9)',
    legacy: ['TagAndSleeveCalculator.php:632-634'],
    input: tag(tagReq({ finish2: [foil(1, [30], [15])] }), [500]),
    options: [offsetOption(), digitalOption()],
  },
  {
    id: '11-digital',
    title: 'Digital tag: paper and ink by sheet area, matt, die-cut per run, 100 / 300 pieces',
    legacy: ['A/CalculateCostDigital.php:137-140, 174, 245, 305-321'],
    input: tag(tagReq({ finish1FrontId: 'matt' }), [100, 300]),
    options: [digitalOption()],
  },
  {
    id: '12-digital-hole',
    title: 'Digital tag with a hole priced per piece on the digital print type',
    legacy: ['A/CalculateCostDigital.php:366-456'],
    input: tag(tagReq({ assemblies: [assembly('hole')] }), [300]),
    options: [digitalOption()],
  },
  {
    id: '13-digital-per-sheet',
    title: 'Digital with per-sheet terms (legacy factory 23: paper, print and finish per sheet)',
    legacy: ['A/CalculateCostDigital.php:131-133, 171-172, 242-243, 325-353'],
    input: tag(tagReq({ finish1FrontId: 'matt' }), [300]),
    options: [
      digitalOption(
        {},
        {
          paperMethod: 'per_sheet',
          printMethod: 'per_sheet',
          finishMethod: 'per_sheet',
          diecutBlock: 'flat_by_pieces',
        },
      ),
    ],
  },
  {
    id: '14-offset-or-digital',
    title:
      'One factory, offset and digital: each print type its own option, the lower buy price wins (T3–T5)',
    legacy: ['TagAndSleeveCalculator.php:325-474'],
    input: tag(tagReq({ finish1FrontId: 'matt' }), [200, 3000]),
    options: [offsetOption(), digitalOption()],
  },
  {
    id: '15-two-factories',
    title: 'Two factories: the lower buy price wins per quantity',
    legacy: ['TagAndSleeveCalculator.php:236-247, 478-483'],
    input: tag(tagReq({ finish1FrontId: 'matt', assemblies: holeAndCorner }), [1000, 5000]),
    options: [
      offsetOption(),
      offsetOption({
        optionKey: 'F2:offset',
        factoryId: 'F2',
        leadTimeDays: 5,
        tables: tagOffsetTables({ terms: { ...offsetTerms, factoryMarginPct: 8 } }),
        parts: one(
          geometry(flat, {
            paperTrim: { gap: 4, trimW: 12, trimL: 14, edgeTrim: 6, trimFoil: 4, trimFinishPlate: 6 },
          }),
        ),
      }),
    ],
  },
  {
    id: '16-design-fee',
    title: 'Graphic design asked once per quote; a structure fee is never charged for tags (T18)',
    legacy: ['Calculator.php:241-289', 'TagAndSleeveCalculator.php:120, 427-429'],
    input: tag(
      tagReq({ finish1FrontId: 'matt' }),
      [1000, 3000],
      { w: 50, l: 90 },
      { graphic: true, structure: true },
    ),
    options: [offsetOption({ sell: sell({ designFee: 1200 }) })],
  },
  {
    id: '17-waste-method-2',
    title: 'Setup waste on the first process only (waste method 2)',
    legacy: ['A/CalculateWaste.php:775-793'],
    input: tag(tagReq({ finish1FrontId: 'matt', assemblies: holeAndCorner })),
    options: [
      offsetOption({
        tables: tagOffsetTables({ terms: { ...offsetTerms, wasteMethod: 2 } }),
      }),
    ],
  },
  {
    id: '18-pattern-delta',
    title: 'Factory pattern condition adds 3 mm to each side of the sleeve blank',
    legacy: ['PatternArea.php:725-738', 'FoldingCalculator.php:1368-1369'],
    input: tag(tagReq(), [2000], { w: 280, l: 90 }),
    options: [offsetOption({ parts: one(geometry(flat, { patternDelta: { plusDl: 3, plusDw: 3 } })) })],
  },
  {
    id: '19-too-large',
    title: 'A 900 × 1,200 mm sheet does not fit any press sheet: no price',
    legacy: ['FoldingCalculator.php:1325-1330'],
    input: tag(tagReq(), [500], { w: 900, l: 1200 }),
    options: [offsetOption()],
  },
  {
    id: '20-engine-b-refused',
    title: 'A type-B print type is not an instant path; the offset print type prices',
    legacy: ['FoldingCalculator.php:414'],
    input: tag(tagReq(), [1000]),
    options: [offsetOption(), offsetOption({ optionKey: 'F1:typeB', printTypeId: 'typeB', engine: 'b' })],
  },
];
