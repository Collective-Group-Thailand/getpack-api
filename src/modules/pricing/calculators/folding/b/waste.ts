import { calWastePrice } from '../a/waste';
import { type LayoutCandidate } from '../geometry/types';
import {
  hasAssembly,
  hasDiecut,
  hasFinish2,
  hasPrintBack,
  hasPrintFront,
  type PartRequest,
  type PrintColour,
} from '../request';
import { type BTables } from './tables';

/**
 * Waste of engine B (legacy `app/Libraries/Folding/B/CalculateWaste.php:304-476`, port map §4). Unlike engine A every
 * waste is taken on the same net press sheets and nothing cascades: the press sheets are the net sheets plus every
 * process's waste, and each process then receives the press sheets minus the waste of the processes before it in
 * forward order (`paper_amount_waste`). B reads no waste band (QB4, QB5). Semi-tone and sorting waste are none (D-233).
 */

export interface BWasteResult {
  printFront: number;
  printBack: number;
  finish1Front: number;
  finish1Back: number;
  /** Waste of each finish 2, by position (kept by position, QB12). */
  finish2: number[];
  diecut: number;
  /** Waste of each assembly, by position. */
  assembly: number[];
  /** Press sheets including every waste (`total_waste_paper_sheet`, `calTotalWaste`). */
  totalSheets: number;
  /** Sheets entering each process (`paper_amount_waste`), 0 for a process the part does not have. */
  sheets: {
    printFront: number;
    printBack: number;
    finish1Front: number;
    finish1Back: number;
    finish2: number;
    diecut: number;
    assembly: number;
  };
  totalPaperSize: number;
  paperSizePrice: number;
  costPaperSize: number;
  /** Waste lookups that found no row: legacy then adds no waste or fails; Packio adds none (Q16, QB3). */
  missingBands: string[];
}

/**
 * `Process/Printing::prepareData:45-103`: one waste row per side, keyed by the **last distinct colour** of the side
 * (the loop variable of `array_count_values` leaks) and the side's colour count (QB2).
 */
export function printWasteKey(colours: readonly PrintColour[]): { inkColourId: string; colourCount: number } {
  const distinct = [...new Set(colours.map((c) => c.inkColourId))];
  return { inkColourId: distinct[distinct.length - 1]!, colourCount: colours.length };
}

export function bLayoutWaste(request: PartRequest, layout: LayoutCandidate, tables: BTables): BWasteResult {
  const p = layout.paperAmount;
  const missingBands: string[] = [];
  const waste = (row: { percentWaste: number; setupWaste: number } | undefined, what: string): number => {
    if (!row) {
      missingBands.push(what);
      return 0;
    }
    return Math.ceil(calWastePrice(p, row.percentWaste, row.setupWaste));
  };
  const printSide = (colours: readonly PrintColour[] | undefined, side: string): number => {
    if (!colours?.length) return 0;
    const key = printWasteKey(colours);
    const row = tables.printWastes.find(
      (r) => r.inkColourId === key.inkColourId && r.colourCount === key.colourCount,
    );
    return waste(row, `b_print_wastes ${side} ${key.inkColourId}×${key.colourCount}`);
  };
  const finishWaste = (finishId: string | undefined, what: string): number =>
    finishId === undefined
      ? 0
      : waste(
          tables.finishWastes.find((r) => r.finishId === finishId),
          `${what} ${finishId}`,
        );

  const printFront = printSide(request.printFront, 'front');
  const printBack = printSide(request.printBack, 'back');
  const finish1Front = finishWaste(request.finish1FrontId, 'finish_wastes finish1_front');
  const finish1Back = finishWaste(request.finish1BackId, 'finish_wastes finish1_back');
  const finish2 = request.finish2.map((f, i) => finishWaste(f.finishId, `finish_wastes finish2[${i}]`));
  const diecut =
    request.diecutTypeId === undefined
      ? 0
      : waste(
          tables.diecutWastes.find((r) => r.diecutTypeId === request.diecutTypeId),
          `diecut_wastes ${request.diecutTypeId}`,
        );
  const assembly = request.assemblies.map((a, i) =>
    waste(
      tables.assemblyWastes.find((r) => r.assemblyId === a.assemblyId),
      `assembly_wastes [${i}] ${a.assemblyId}`,
    ),
  );
  const sumF2 = finish2.reduce((a, b) => a + b, 0);
  const sumAsb = assembly.reduce((a, b) => a + b, 0);
  const totalSheets = p + printFront + printBack + finish1Front + finish1Back + sumF2 + diecut + sumAsb;

  // Forward subtraction (`:405-476`), each `abs`'ed; semi-tone waste is 0 (D-233).
  const t = totalSheets;
  const afterPrint = t - printFront - printBack;
  const sheets = {
    printFront: hasPrintFront(request) ? Math.abs(t) : 0,
    printBack: hasPrintBack(request) ? Math.abs(t - printFront) : 0,
    finish1Front: request.finish1FrontId !== undefined ? Math.abs(afterPrint) : 0,
    finish1Back: request.finish1BackId !== undefined ? Math.abs(afterPrint - finish1Front) : 0,
    finish2: hasFinish2(request) ? Math.abs(afterPrint - finish1Front - finish1Back) : 0,
    diecut: hasDiecut(request) ? Math.abs(afterPrint - finish1Front - finish1Back - sumF2) : 0,
    assembly: hasAssembly(request) ? Math.abs(afterPrint - finish1Front - finish1Back - sumF2 - diecut) : 0,
  };

  // Paper as engine A (`calTotalWastePaperSize`, `calPricePaperSizeBahtPerSheet`, `calCostPaperSize`).
  const sheet = layout.sheet;
  const totalPaperSize = Math.ceil(totalSheets / sheet.sheetCut);
  const paperSizePrice =
    (sheet.costPerKg * (sheet.gsm * sheet.sizeWIn * sheet.sizeLIn)) / ((100 * 100 * 1000) / (2.54 * 2.54));
  return {
    printFront,
    printBack,
    finish1Front,
    finish1Back,
    finish2,
    diecut,
    assembly,
    totalSheets,
    sheets,
    totalPaperSize,
    paperSizePrice,
    costPaperSize: totalPaperSize * paperSizePrice,
    missingBands,
  };
}
