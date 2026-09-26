import { type LayoutCandidate } from '../geometry/types';
import {
  hasAssembly,
  hasDiecut,
  hasFinish2,
  hasPrintBack,
  hasPrintFront,
  type PartRequest,
} from '../request';
import {
  type AssemblyWasteRow,
  type DiecutWasteRow,
  type FinishWasteRow,
  inBand,
  inSheetBand,
  type OffsetTerms,
  type PrintWasteRow,
  type WasteRow,
} from '../tables';

/**
 * Waste of engine A (legacy `app/Libraries/Folding/A/CalculateWaste.php`), shared by the offset and the
 * digital cost engines. Sheets run through the processes in reverse order — assembly, die-cut,
 * finish 2, finish 1 back, print back, finish 1 front, print front — each adding its waste to the
 * sheets the next one needs (`calWasteData:458-639`).
 */

export type PrintMode = 'offset' | 'digital';

export interface WasteTables {
  terms: Pick<
    OffsetTerms,
    'wasteMethod' | 'finish2StepDownWaste' | 'assemblyWasteByAssembly' | 'diecutWasteByBoxAmount'
  >;
  printWastes: readonly PrintWasteRow[];
  finishWastes: readonly FinishWasteRow[];
  diecutWastes: readonly DiecutWasteRow[];
  assemblyWastes: readonly AssemblyWasteRow[];
}

export interface WasteResult {
  /** Sheets each process needs, cumulative (legacy `*_waste`, `ceil`ed). */
  printFront: number;
  printBack: number;
  finish1Front: number;
  finish1Back: number;
  /** Cumulative sheets after each finish 2, by position (legacy `finish2_waste`, quirk Q17). */
  finish2: number[];
  diecut: number;
  /** Cumulative sheets after each assembly, by position (legacy `assembly_waste`). */
  assembly: Map<number, number>;
  /** Press sheets including every waste (`total_waste_paper_sheet`). */
  totalSheets: number;
  /** Mill sheets bought (`calTotalWastePaperSize`, helpers.php:1072-1091). */
  totalPaperSize: number;
  /** Price of one mill sheet (`calPricePaperSizeBahtPerSheet`, helpers.php:1094-1131). */
  paperSizePrice: number;
  /** `calCostPaperSize` (helpers.php:1172-1192). */
  costPaperSize: number;
  /** Waste lookups that found no band: legacy then adds no waste (quirk Q16). */
  missingBands: string[];
}

/** `calWastePrice` (helpers.php:902-907). */
export const calWastePrice = (paperAmount: number, percentWaste: number, setupWaste: number): number =>
  paperAmount * (percentWaste / 100) + setupWaste;

type SetupProcess = 'print_front' | 'print_back' | 'f1_front' | 'f1_back' | 'f2' | 'diecut' | 'assembly';

/** Waste sets of one part, built once per quantity step (legacy `initWasteAll:952-960`). */
interface WasteSets {
  printFront: PrintWasteRow[][];
  printBack: PrintWasteRow[][];
  finish1Front: FinishWasteRow[];
  finish1Back: FinishWasteRow[];
  finish2: (FinishWasteRow[] | null)[];
  finish2Count: number;
  diecut: DiecutWasteRow[];
  assembly: (AssemblyWasteRow[] | undefined)[];
  /** First process in legacy's flag order that the part has (`checkHasCalSetupWaste:779`). */
  firstSetupProcess: SetupProcess | null;
}

const unique = (values: readonly number[]): number[] => [...new Set(values)];

function printSets(
  mode: PrintMode,
  rows: readonly PrintWasteRow[],
  percents: readonly number[] | null,
): PrintWasteRow[][] {
  // Digital takes every row as one set (`:143-145`); offset one set per distinct ink coverage (`:133-142`).
  if (mode === 'digital') return [[...rows]];
  return unique(percents ?? [])
    .map((p) => rows.filter((r) => inBand(r.minPercent, r.maxPercent, p)))
    .filter((set) => set.length > 0);
}

function buildSets(mode: PrintMode, request: PartRequest, tables: WasteTables): WasteSets {
  const flags: [SetupProcess, boolean][] = [
    ['print_front', hasPrintFront(request)],
    ['print_back', hasPrintBack(request)],
    ['f1_front', request.finish1FrontId !== undefined],
    ['f1_back', request.finish1BackId !== undefined],
    ['f2', hasFinish2(request)],
    ['diecut', hasDiecut(request)],
    ['assembly', hasAssembly(request)],
  ];
  const finishRows = tables.finishWastes;
  // Legacy reads a lone "every finish" row for every finish 2, otherwise the finish's own rows (`:320-327`).
  const everyFinish = finishRows.length === 1 && finishRows[0]!.finishId === null;
  const finish2 = hasFinish2(request)
    ? request.finish2.map((f) => {
        const set = everyFinish ? [...finishRows] : finishRows.filter((r) => r.finishId === f.finishId);
        return set.length > 0 ? set : null;
      })
    : [];
  const assemblyRows = tables.assemblyWastes;
  const assembly =
    hasAssembly(request) && assemblyRows.length > 0
      ? request.assemblies.map((a) =>
          tables.terms.assemblyWasteByAssembly
            ? assemblyRows.filter((r) => r.assemblyId === a.assemblyId)
            : [...assemblyRows],
        )
      : [];
  return {
    // Front defaults to 100 % coverage when none is given (`:122`); back has no default (`:156`).
    printFront: hasPrintFront(request)
      ? printSets(
          mode,
          tables.printWastes,
          request.printFront!.map((c) => c.percent),
        )
      : [],
    printBack: hasPrintBack(request)
      ? printSets(
          mode,
          tables.printWastes,
          request.printBack!.map((c) => c.percent),
        )
      : [],
    // Finish 1 reads every finish-waste row of the factory, whatever the finish (legacy, `:241-246`).
    finish1Front: request.finish1FrontId !== undefined ? [...finishRows] : [],
    finish1Back: request.finish1BackId !== undefined ? [...finishRows] : [],
    finish2,
    finish2Count: finish2.filter((s) => s !== null).length,
    diecut: hasDiecut(request)
      ? tables.diecutWastes.filter((r) => r.diecutTypeId === request.diecutTypeId)
      : [],
    assembly,
    firstSetupProcess: flags.find(([, on]) => on)?.[0] ?? null,
  };
}

/** Waste of one layout (legacy `calWasteData` body, `:472-630`). */
export function layoutWaste(
  mode: PrintMode,
  request: PartRequest,
  layout: LayoutCandidate,
  tables: WasteTables,
): WasteResult {
  const sets = buildSets(mode, request, tables);
  const method = tables.terms.wasteMethod;
  const custom = request.customCost === true;
  const missingBands: string[] = [];
  let setupTaken = 0;

  // `checkHasCalSetupWaste` (:775-793)
  const setup = (waste: number, process: SetupProcess): number => {
    if (method === 1) return waste;
    if (method === 2 && setupTaken === 0 && sets.firstSetupProcess === process) {
      setupTaken++;
      return waste;
    }
    return 0;
  };
  const pick = <R extends WasteRow>(
    rows: readonly R[],
    sheets: number,
    what: string,
    extra?: (r: R) => boolean,
  ): R | undefined => {
    const row = custom ? rows[0] : rows.find((r) => inSheetBand(r, sheets) && (extra?.(r) ?? true));
    if (!row) missingBands.push(`${what}@${sheets}`);
    return row;
  };

  let paperAmount = layout.paperAmount;

  // Assembly (:654-698): last to first, each on the sheets after the previous one.
  const assembly = new Map<number, number>();
  if (sets.assembly.length > 0) {
    let amountWaste = paperAmount;
    for (let index = sets.assembly.length - 1; index >= 0; index--) {
      const row = pick(sets.assembly[index] ?? [], paperAmount, `assembly[${index}]`);
      if (!row) continue;
      const waste = request.assemblies[index]!.skipWaste
        ? Math.ceil(calWastePrice(amountWaste, 0, setup(0, 'assembly')))
        : Math.ceil(calWastePrice(amountWaste, row.percentWaste, setup(row.setupWaste, 'assembly')));
      amountWaste += waste;
      assembly.set(index, amountWaste);
    }
  }
  if (assembly.size > 0) paperAmount = [...assembly.values()].at(-1)!;

  // Die-cut (:700-725)
  let diecut = 0;
  if (sets.diecut.length > 0) {
    const row = pick(sets.diecut, paperAmount, 'diecut', (r) =>
      tables.terms.diecutWasteByBoxAmount ? inBand(r.minBox, r.maxBox, layout.boxAmount) : true,
    );
    if (row)
      diecut = paperAmount + calWastePrice(paperAmount, row.percentWaste, setup(row.setupWaste, 'diecut'));
  }
  diecut = Math.ceil(diecut);
  if (diecut) paperAmount = diecut;

  // Finish 2 (:795-874), last to first; positions without a waste row add none (quirk Q17).
  const finish2: number[] = [];
  if (sets.finish2.length > 0) {
    let amountWaste = paperAmount;
    let setupWaste = 0;
    let percentWaste = 0;
    let stepped = 0;
    for (let index = sets.finish2.length - 1; index >= 0; index--) {
      const set = sets.finish2[index];
      const row = set ? pick(set, paperAmount, `finish2[${index}]`) : undefined;
      if (!set) missingBands.push(`finish2[${index}]:no rows`);
      if (row) {
        if (method === 1 || method === 2) {
          if (tables.terms.finish2StepDownWaste) {
            if (stepped === 0) setupWaste = Math.ceil(row.setupWaste / sets.finish2Count);
            percentWaste = index === 0 ? row.percentWaste : row.percentWaste - index;
            if (index > 0 && percentWaste === 0) percentWaste = 1;
            stepped++;
          } else {
            percentWaste = row.percentWaste;
            setupWaste = method === 1 ? row.setupWaste : setup(row.setupWaste, 'f2');
          }
        }
        amountWaste += Math.ceil(calWastePrice(amountWaste, percentWaste, setupWaste));
      }
      finish2[index] = amountWaste;
    }
    paperAmount = finish2[0]!;
  }

  // Finish 1 back (:750-773)
  let finish1Back = 0;
  if (sets.finish1Back.length > 0) {
    const row = pick(sets.finish1Back, paperAmount, 'finish1_back');
    if (row) {
      finish1Back =
        paperAmount +
        Math.ceil(calWastePrice(paperAmount, row.percentWaste, setup(row.setupWaste, 'f1_back')));
    }
  }
  if (finish1Back) paperAmount = finish1Back;

  // Print back (:911-950): the last coverage set's waste on top of the sheets.
  let printBack = 0;
  if (sets.printBack.length > 0) {
    for (const [i, set] of sets.printBack.entries()) {
      const row = pick(set, paperAmount, `print_back[${i}]`);
      printBack = Math.ceil(
        calWastePrice(paperAmount, row?.percentWaste ?? 0, setup(row?.setupWaste ?? 0, 'print_back')),
      );
    }
    printBack += paperAmount;
  }
  if (printBack) paperAmount = printBack;

  // Finish 1 front (:727-748)
  let finish1Front = 0;
  if (sets.finish1Front.length > 0) {
    const row = pick(sets.finish1Front, paperAmount, 'finish1_front');
    if (row) {
      finish1Front =
        paperAmount +
        Math.ceil(calWastePrice(paperAmount, row.percentWaste, setup(row.setupWaste, 'f1_front')));
    }
  }
  if (finish1Front) paperAmount = finish1Front;

  // Print front (:876-909): the largest coverage set's waste on top of the sheets.
  const frontWastes = sets.printFront.map((set, i) => {
    const row = pick(set, paperAmount, `print_front[${i}]`);
    return Math.ceil(
      calWastePrice(paperAmount, row?.percentWaste ?? 0, setup(row?.setupWaste ?? 0, 'print_front')),
    );
  });
  const printFront = frontWastes.length > 0 ? Math.max(...frontWastes) + paperAmount : 0;
  if (printFront) paperAmount = printFront;

  const sheet = layout.sheet;
  const totalPaperSize = Math.ceil(paperAmount / sheet.sheetCut);
  const paperSizePrice =
    (sheet.costPerKg * (sheet.gsm * sheet.sizeWIn * sheet.sizeLIn)) / ((100 * 100 * 1000) / (2.54 * 2.54));
  return {
    printFront: Math.ceil(printFront),
    printBack: Math.ceil(printBack),
    finish1Front: Math.ceil(finish1Front),
    finish1Back: Math.ceil(finish1Back),
    finish2,
    diecut,
    assembly,
    totalSheets: paperAmount,
    totalPaperSize,
    paperSizePrice,
    costPaperSize: totalPaperSize * paperSizePrice,
    missingBands,
  };
}
