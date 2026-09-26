import { blankGeometry } from './formulas';
import { calLayoutAmount } from './layout-amount';
import {
  type GeometryInput,
  type GeometryResult,
  type GeometrySnapshot,
  type LayoutCandidate,
  type PaperSheet,
  type PatternArea,
} from './types';

/** Legacy default when the pattern needs `x` and none is given (`PatternArea.php:22`). */
const DEFAULT_X = 3;

/**
 * `PatternArea::calPatternArea` (legacy `app/Libraries/Folding/PatternArea.php:162-765`): the blank
 * of the pattern plus the factory's delta and trims.
 */
export function patternArea(input: GeometryInput, snapshot: GeometrySnapshot): PatternArea {
  const { w, l, d } = input;
  const blank = blankGeometry(snapshot.pattern, { w, l, d, x: input.x ?? DEFAULT_X, c: input.c ?? 0 });
  // `factory_rel_pattern_conditions` (:725-738)
  const dlPlus = snapshot.patternDelta?.plusDl ?? 0;
  const dwPlus = snapshot.patternDelta?.plusDw ?? 0;
  const dl = blank.dl + dlPlus;
  const dw = blank.dw + dwPlus;
  const trim = snapshot.paperTrim;
  return {
    dw,
    dl,
    dwPlus,
    dlPlus,
    dwWithGap: dw + trim.gap,
    dlWithGap: dl + trim.gap,
    paperTrimGap: trim.gap,
    nd: blank.nd,
    nl: blank.nl,
    nw: blank.nw,
    c: blank.c,
    paperTrimW: trim.trimW,
    paperTrimL: trim.trimL,
    edgeTrim: trim.edgeTrim,
    trimFoilMm: trim.trimFoil,
    trimFinishPlateMm: trim.trimFinishPlate / 2,
    w,
    l,
    d,
    combineLayout: blank.combineLayout,
  };
}

/**
 * `swipePaperSheetSize` (legacy `helpers.php:1140-1172`): each sheet plus its rotated copy, marked as
 * against the grain. Legacy casts Eloquent models with `(array)` here, which loses every attribute,
 * so flip-paper factories never got a layout; Packio implements the intended rotation (quirk Q13).
 */
export function withFlippedSheets(sheets: readonly PaperSheet[]): PaperSheet[] {
  return sheets.flatMap((sheet) => [
    sheet,
    {
      ...sheet,
      sheetWIn: sheet.sheetLIn,
      sheetLIn: sheet.sheetWIn,
      sizeWIn: sheet.sizeLIn,
      sizeLIn: sheet.sizeWIn,
      isGrain: false,
    },
  ]);
}

/**
 * `PatternArea::calculate` (legacy `:830-1092`): every sheet × orientation on which the blank fits,
 * per box amount. The sheet list is the factory's sheets for the material, already filtered to
 * fix-grain sheets when the customer fixes the grain (`getPaperSheet:790-792`).
 */
export function calculateGeometry(input: GeometryInput, snapshot: GeometrySnapshot): GeometryResult {
  const area = patternArea(input, snapshot);
  const eligible = input.isGrain ? snapshot.sheets.filter((s) => s.isFixGrain) : snapshot.sheets;
  const sheets = snapshot.terms.canFlipPaperSize ? withFlippedSheets(eligible) : [...eligible];
  const standardAllowed = !input.isGrain || input.grainParallel === 'dl';
  const rotatedAllowed = !input.isGrain || input.grainParallel === 'dw';

  const layouts = input.boxAmounts.map((boxAmount, index) => {
    const candidates: LayoutCandidate[] = [];
    for (const sheet of sheets) {
      const sheetW = sheet.sheetWIn * 25.4;
      const sheetL = sheet.sheetLIn * 25.4;
      let pwWithoutTrim: number;
      let plWithoutTrim: number;
      if (snapshot.terms.useMaxMinPaperTrim && sheet.sheetWIn > sheet.sheetLIn) {
        pwWithoutTrim = sheetW - area.paperTrimL - area.edgeTrim;
        plWithoutTrim = sheetL - area.paperTrimW - area.edgeTrim;
      } else {
        pwWithoutTrim = sheetW - area.paperTrimW - area.edgeTrim;
        plWithoutTrim = sheetL - area.paperTrimL - area.edgeTrim;
      }
      const noOverlap = snapshot.terms.disableOverlapLayout;
      const c = noOverlap ? 0 : area.c;
      const combineLayout = noOverlap ? false : area.combineLayout;

      const place = (layoutStandard: boolean): void => {
        const layout = calLayoutAmount({
          pw: pwWithoutTrim,
          pl: plWithoutTrim,
          dw: area.dw,
          dl: area.dl,
          c,
          layoutStandard,
          trimGap: area.paperTrimGap,
          paperTrimW: area.paperTrimW,
          paperTrimL: area.paperTrimL,
          combineLayout,
        });
        if (!(layout.layout > 0)) return;
        candidates.push({
          layoutStandard,
          layoutAmount: layout.layout,
          slotW: layout.slotW,
          slotL: layout.slotL,
          areaW: layout.areaW,
          areaL: layout.areaL,
          paperAmount: Math.ceil(boxAmount / layout.layout),
          boxAmount,
          qty: input.quantities[index]!,
          sheet,
          pw: sheet.sheetWIn,
          pl: sheet.sheetLIn,
          pwWithoutTrim,
          plWithoutTrim,
          dw: area.dw,
          dl: area.dl,
          dwPlus: area.dwPlus,
          dlPlus: area.dlPlus,
          nd: area.nd,
          nl: area.nl,
          nw: area.nw,
          dwWithGap: area.dwWithGap,
          dlWithGap: area.dlWithGap,
          c,
          gap: area.paperTrimGap,
          isGrain: sheet.isGrain ?? true,
          sortGrain: sheet.isGrain === undefined ? 0 : 1,
          lIsGrainStandard: sheet.sizeLIn > sheet.sizeWIn,
          paperSheetWWithoutEdge: sheet.sheetWIn - area.edgeTrim / 25.4,
          paperSheetLWithoutEdge: sheet.sheetLIn - area.edgeTrim / 25.4,
          trimFoilMm: area.trimFoilMm,
          patternArea: area,
        });
      };

      // Fit is checked on the blank without the gap (:946-947, :1029).
      if (standardAllowed && pwWithoutTrim >= area.dw && plWithoutTrim >= area.dl) place(true);
      if (rotatedAllowed && pwWithoutTrim >= area.dl && plWithoutTrim >= area.dw) place(false);
    }
    return candidates;
  });

  return { patternArea: area, layouts };
}
