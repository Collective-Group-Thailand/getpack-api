import { calWastePrice } from '../folding/a/waste';
import { calLayoutAmount } from '../folding/geometry/layout-amount';
import { inBand } from '../folding/tables';
import { type LabelSheet, type LabelTables } from './tables';

/** A waste band row (print, finish and die-cut waste share these columns). */
interface WasteRowLike {
  minSheets: number | null;
  maxSheets: number | null;
  percentWaste: number;
  setupWaste: number;
}

/**
 * Lay-outs and waste of the label calculator (legacy `LabelCalculator::calculateLayouts:658-822`,
 * `calculateLayout:883-892`, `calculateWaste:895-1006`). Every label is laid out on its W × L bounding box
 * (legacy prices only pattern 18, `patternArea:824-866`). Floating-point expressions keep the PHP order.
 */

/** What the label asks of its processes (legacy `setData:346-372` flags). */
export interface LabelProcesses {
  printFront: boolean;
  printBack: boolean;
  finishFront: boolean;
  finishBack: boolean;
  diecut: boolean;
}

/** Legacy flag order: setup waste goes to the first process on (`checkSetupWaste`, quirk L23). */
const FLAG_ORDER: readonly (keyof LabelProcesses)[] = [
  'printFront',
  'printBack',
  'finishFront',
  'finishBack',
  'diecut',
];

export interface LabelWaste {
  diecut: number | null;
  finishBack: number | null;
  printBack: number | null;
  finishFront: number | null;
  printFront: number | null;
  /** Press sheets including every waste. */
  total: number;
}

export interface LabelLayout {
  sheet: LabelSheet;
  standard: boolean;
  /** Labels per sheet; for roll-to-sheet the number of cut sheets (quirk L10). */
  layoutAmount: number;
  slotW: number;
  slotL: number;
  areaW: number;
  areaL: number;
  /** Sheets for the quantity before waste (`ceil(qty / layout)`). */
  paperAmount: number;
  roll: boolean;
  rollToSheet: boolean;
  /** Sheet without the edge trim, inches. */
  wWithoutEdgeIn: number;
  lWithoutEdgeIn: number;
  /** Sheets only (`calculateWaste`). */
  waste: LabelWaste | null;
}

/** The usable sheet in mm (`calculateLayouts:670-686`, `factory_type_id` 1; edge trim units quirk L8). */
function usable(sheet: LabelSheet, trim: LabelTables['trim']): { w: number; l: number } {
  if (sheet.sheetLIn === 0) {
    return {
      w: (sheet.sheetWIn - trim.edgeTrimMm) * 25.4 - trim.trimWMm,
      l: (sheet.sheetLIn - trim.edgeTrimMm) * 25.4 - trim.trimLMm,
    };
  }
  if (sheet.sheetWIn > sheet.sheetLIn) {
    return {
      w: sheet.sheetWIn * 25.4 - trim.trimLMm - trim.edgeTrimMm,
      l: sheet.sheetLIn * 25.4 - trim.trimWMm - trim.edgeTrimMm,
    };
  }
  return {
    w: sheet.sheetWIn * 25.4 - trim.trimWMm - trim.edgeTrimMm,
    l: sheet.sheetLIn * 25.4 - trim.trimLMm - trim.edgeTrimMm,
  };
}

/** The lay-outs of one quantity on every sheet, standard then rotated (`calculateLayouts`). */
export function labelLayouts(
  size: { w: number; l: number },
  qty: number,
  tables: Pick<LabelTables, 'sheets' | 'trim' | 'terms'>,
): LabelLayout[] {
  const { trim } = tables;
  const dw = size.w;
  const dl = size.l;
  const out: LabelLayout[] = [];
  for (const sheet of tables.sheets) {
    const { w, l } = usable(sheet, trim);
    const roll = sheet.sheetLIn === 0;
    for (const standard of [true, false]) {
      // Standard: fits as is, or a roll; rotated: fits turned, or a roll (`:720,768`).
      const fits = standard ? w >= dw && l >= dl : w >= dl && l >= dw;
      if (!(fits || roll)) continue;
      const r = calLayoutAmount({
        pw: w,
        pl: l,
        dw,
        dl,
        c: 0,
        layoutStandard: standard,
        trimGap: trim.gapMm,
        paperTrimW: trim.trimWMm,
        paperTrimL: trim.trimLMm,
        combineLayout: false,
        boxAmount: qty,
        sheetCutLength: sheet.sheetCutLengthIn,
        edgeTrim: trim.edgeTrimMm,
        endJobTrim: trim.endJobTrimMm,
        minSheetPerJob: tables.terms.minSheetPerJob,
      });
      // A roll-to-sheet cut that holds no label divides by zero in legacy (quirk L10): no lay-out.
      if (!(r.layout > 0) || !Number.isFinite(r.layout)) continue;
      out.push({
        sheet,
        standard,
        layoutAmount: r.layout,
        slotW: r.slotW,
        slotL: r.slotL,
        areaW: r.areaW,
        areaL: r.areaL,
        paperAmount: Math.ceil(qty / r.layout),
        roll,
        rollToSheet: sheet.sheetCutLengthIn > 0,
        wWithoutEdgeIn: sheet.sheetWIn - trim.edgeTrimMm / 25.4,
        lWithoutEdgeIn: sheet.sheetLIn - trim.edgeTrimMm / 25.4,
        waste: null,
      });
    }
  }
  return out;
}

/** The first band row holding `sheets` (legacy collection `where(max >= x)->where(min <= x)->first()`). */
const band = <T extends WasteRowLike>(rows: readonly T[], sheets: number): T | undefined =>
  rows.find((r) => inBand(r.minSheets, r.maxSheets, sheets));

/**
 * Waste of a sheet lay-out (`calculateWaste:895-984`): die-cut → finish back → print back → finish front → print
 * front, each `ceil(x + x·pct/100 + setup)`; a missing band adds nothing (legacy reads `null['…']`).
 */
export function labelWaste(
  layout: LabelLayout,
  processes: LabelProcesses,
  diecutTypeId: string | null,
  tables: Pick<LabelTables, 'terms' | 'printWastes' | 'finishWastes' | 'diecutWastes'>,
): LabelWaste {
  const first = FLAG_ORDER.find((p) => processes[p]) ?? null;
  const setup = (row: WasteRowLike | undefined, process: keyof LabelProcesses) =>
    tables.terms.wasteMethod === 1 || first === process ? (row?.setupWaste ?? 0) : 0;
  const step = (x: number, row: WasteRowLike | undefined, process: keyof LabelProcesses) =>
    Math.ceil(x + calWastePrice(x, row?.percentWaste ?? 0, setup(row, process)));

  let x = Math.max(layout.paperAmount, tables.terms.minSheetPerJob);
  const waste: LabelWaste = {
    diecut: null,
    finishBack: null,
    printBack: null,
    finishFront: null,
    printFront: null,
    total: 0,
  };
  if (processes.diecut) {
    // Diecut waste reads the die-cut type's rows (`diecutWaste:995-1006`).
    const rows = tables.diecutWastes.filter((r) => r.diecutTypeId === diecutTypeId);
    x = step(x, band(rows, x), 'diecut');
    waste.diecut = x;
  }
  // Finish waste ignores the finish, print waste the colours (quirk L16).
  if (processes.finishBack) {
    x = step(x, band(tables.finishWastes, x), 'finishBack');
    waste.finishBack = x;
  }
  if (processes.printBack) {
    x = step(x, band(tables.printWastes, x), 'printBack');
    waste.printBack = x;
  }
  if (processes.finishFront) {
    x = step(x, band(tables.finishWastes, x), 'finishFront');
    waste.finishFront = x;
  }
  if (processes.printFront) {
    x = step(x, band(tables.printWastes, x), 'printFront');
    waste.printFront = x;
  }
  waste.total = x;
  return waste;
}
