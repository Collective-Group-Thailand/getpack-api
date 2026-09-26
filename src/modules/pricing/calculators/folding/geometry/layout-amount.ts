/**
 * Port of `calLayoutAmount` (legacy `app/Helpers/helpers.php:597-891`): how many blanks fit on a sheet
 * (or a roll) and the area they use. Shared by the calculators that impose blanks on paper; the
 * folding calculator uses the sheet-fed branches only. Floating-point expressions keep the PHP order.
 */

export interface LayoutAmountArgs {
  pw: number;
  pl: number;
  dw: number;
  dl: number;
  c: number;
  layoutStandard?: boolean;
  trimGap?: number;
  paperTrimW?: number;
  paperTrimL?: number;
  combineLayout?: boolean;
  /** Roll branches only. */
  boxAmount?: number | null;
  sheetCutLength?: number;
  edgeTrim?: number;
  endJobTrim?: number;
  minSheetPerJob?: number;
}

export interface LayoutAmountResult {
  layout: number;
  slotW: number;
  slotL: number;
  areaW: number;
  areaL: number;
  /** Roll-to-sheet only (`sheet_cut_length > 0`). */
  sheetAmount?: number;
  useMinSheet?: boolean;
}

/** PHP 7 `$a % $b`: both operands truncated to integers; INF/NaN become 0. */
function phpMod(a: number, b: number): number {
  const toInt = (v: number) => (Number.isFinite(v) ? Math.trunc(v) : 0);
  return toInt(a) % toInt(b);
}

const NOTHING: LayoutAmountResult = { layout: 0, slotW: 0, slotL: 0, areaW: 0, areaL: 0 };

export function calLayoutAmount(args: LayoutAmountArgs): LayoutAmountResult {
  const { pw, pl, dw, dl, c } = args;
  const layoutStandard = args.layoutStandard ?? true;
  const trimGap = args.trimGap ?? 0;
  const paperTrimW = args.paperTrimW ?? 0;
  const paperTrimL = args.paperTrimL ?? 0;
  const combineLayout = args.combineLayout ?? false;
  const boxAmount = args.boxAmount ?? 0;
  const sheetCutLength = args.sheetCutLength ?? 0;
  const edgeTrim = args.edgeTrim ?? 0;
  const endJobTrim = args.endJobTrim ?? 0;
  const minSheetPerJob = args.minSheetPerJob ?? 0;

  const trim = pw < pl ? paperTrimW : paperTrimL;
  let layW: number;
  let layL: number;
  let areaW: number;
  let areaL: number;
  let ansW: number;
  let ansL: number;
  let areaWasteW: number;
  let areaWasteL: number;
  // Roll-to-sheet results.
  let sheetAmount = 0;
  let sheetAmountOutput = 0;
  let useMinSheet = false;
  let layLSheetCut = 0;

  if (combineLayout) {
    // overlap type 2 (:600-637)
    if (layoutStandard) {
      ansW = Math.floor(pw / (dw * 2 - c + trimGap));
      ansL = Math.floor(pl / dl);
      areaWasteW = pw - (ansW * (dw * 2 - c + trimGap) + (ansW - 1) * trimGap);
      areaWasteL = pl - (ansL * dl + (ansL - 1) * trimGap);
      if (areaWasteW >= 0) {
        layW = areaWasteW > dw + trimGap ? ansW * 2 + 1 : ansW * 2;
      } else {
        layW = ansW * 2 - 1;
      }
      layL = areaWasteL < 0 ? ansL - Math.ceil(Math.abs(areaWasteL) / (dl + trimGap)) : ansL;
      const checkedLayW = phpMod(layW, 2) === 0 ? layW : layW - 1;
      const checkedLayL = phpMod(layL, 2) === 0 ? layL : layL - 1;
      areaW = layW * dw + (layW - 1) * trimGap - checkedLayW * c + trim;
      areaL = layL * dl + (layL - 1) * trimGap - checkedLayL * c + trim;
    } else {
      ansW = Math.floor(pw / dl);
      ansL = Math.floor(pl / (dw * 2 - c + trimGap));
      areaWasteW = pw - (ansW * dl + (ansW - 1) * trimGap);
      areaWasteL = pl - (ansL * (dw * 2 - c + trimGap) + (ansL - 1) * trimGap);
      layW = areaWasteW < 0 ? ansW - Math.ceil(Math.abs(areaWasteW) / (dw + trimGap)) : ansW;
      if (areaWasteL >= 0) {
        layL = areaWasteL > dw + trimGap ? ansL * 2 + 1 : ansL * 2;
      } else {
        layL = ansL * 2 - 1;
      }
      const checkedLayW = phpMod(layW, 2) === 0 ? layW : layW - 1;
      const checkedLayL = phpMod(layL, 2) === 0 ? layL : layL - 1;
      areaW = layW * dl + (layW - 1) * trimGap - checkedLayW * c + trim;
      areaL = layL * dw + (layL - 1) * trimGap - checkedLayL * c + trim;
    }
  } else if (c > 0) {
    // overlap type 1 (:638-693)
    const trimW = pw <= pl ? paperTrimW : paperTrimL;
    const trimL = pw <= pl ? paperTrimL : paperTrimW;
    if (layoutStandard) {
      ansW = Math.floor(pw / dw);
      ansL = Math.floor(pl / dl);
      if (!(ansW > 0 || ansL > 0)) return NOTHING;
      areaWasteW = pw - (ansW * dw + (ansW - 1) * trimGap - (ansW - 1) * c);
      areaWasteL = pl - (ansL * dl + (ansL - 1) * trimGap);
      if (areaWasteW >= 0) {
        layW = areaWasteW > dw + trimGap - c ? Math.floor(ansW + areaWasteW / (dw + trimGap - c)) : ansW;
      } else {
        layW = ansW - 1;
      }
      layL = areaWasteL < 0 ? ansL - Math.ceil(Math.abs(areaWasteL) / (dl + trimGap)) : ansL;
      areaW = layW * dw - (layW - 1) * c + (layW - 1) * trimGap + trimW;
      areaL = layL * dl + (layL - 1) * trimGap + trimL;
    } else {
      ansW = Math.floor(pw / dl);
      ansL = Math.floor(pl / dw);
      if (!(ansW > 0 || ansL > 0)) return NOTHING;
      areaWasteW = pw - (ansW * dl + (ansW - 1) * trimGap);
      areaWasteL = pl - (ansL * dw + (ansL - 1) * trimGap - (ansL - 1) * c);
      if (areaWasteL >= 0) {
        layL = areaWasteL > dw + trimGap - c ? Math.floor(ansL + areaWasteL / (dw + trimGap - c)) : ansL;
      } else {
        layL = ansL - 1;
      }
      layW = areaWasteW < 0 ? ansW - Math.ceil(Math.abs(areaWasteW) / (dw + trimGap)) : ansW;
      areaW = layW * dl + (layW - 1) * trimGap + trimW;
      areaL = layL * dw - (layL - 1) * c + (layL - 1) * trimGap + trimL;
    }
  } else if (pl > 0) {
    // non overlap, sheet (:694-739)
    if (layoutStandard) {
      ansW = Math.floor(pw / dw);
      ansL = Math.floor(pl / dl);
      if (!(ansW > 0 || ansL > 0)) return NOTHING;
      areaWasteW = pw - (ansW * dw + (ansW - 1) * trimGap);
      areaWasteL = pl - (ansL * dl + (ansL - 1) * trimGap);
      layW = areaWasteW < 0 ? ansW - Math.ceil(Math.abs(areaWasteW) / (dw + trimGap)) : ansW;
      layL = areaWasteL < 0 ? ansL - Math.ceil(Math.abs(areaWasteL) / (dl + trimGap)) : ansL;
      if (pw > pl) {
        areaW = layW * dw + (layW - 1) * trimGap + paperTrimL;
        areaL = layL * dl + (layL - 1) * trimGap + paperTrimW;
      } else {
        areaW = layW * dw + (layW - 1) * trimGap + paperTrimW;
        areaL = layL * dl + (layL - 1) * trimGap + paperTrimL;
      }
    } else {
      ansW = Math.floor(pw / dl);
      ansL = Math.floor(pl / dw);
      if (!(ansW > 0 || ansL > 0)) return NOTHING;
      areaWasteW = pw - (ansW * dl + (ansW - 1) * trimGap);
      areaWasteL = pl - (ansL * dw + (ansL - 1) * trimGap);
      layW = areaWasteW < 0 ? ansW - Math.ceil(Math.abs(areaWasteW) / (dl + trimGap)) : ansW;
      layL = areaWasteL < 0 ? ansL - Math.ceil(Math.abs(areaWasteL) / (dw + trimGap)) : ansL;
      if (pw > pl) {
        areaW = layW * dl + (layW - 1) * trimGap + paperTrimL;
        areaL = layL * dw + (layL - 1) * trimGap + paperTrimW;
      } else {
        areaW = layW * dl + (layW - 1) * trimGap + paperTrimW;
        areaL = layL * dw + (layL - 1) * trimGap + paperTrimL;
      }
    }
  } else if (sheetCutLength > 0) {
    // roll to sheet (:741-830)
    const sheetCutWithoutTl = (sheetCutLength - edgeTrim) * 25.4 - paperTrimL;
    const across = layoutStandard ? dw : dl;
    const along = layoutStandard ? dl : dw;
    ansW = Math.floor(pw / across);
    if (!(ansW > 0)) return NOTHING;
    areaWasteW = pw - (ansW * across + (ansW - 1) * trimGap);
    layW = areaWasteW < 0 ? ansW - Math.ceil(Math.abs(areaWasteW) / (across + trimGap)) : ansW;
    layL = Math.ceil(boxAmount / layW);
    ansL = Math.floor(sheetCutWithoutTl / along);
    areaWasteL = sheetCutWithoutTl - (ansL * along + (ansL - 1) * trimGap);
    // Both orientations divide the negative waste by (dl + gap) in legacy (:760, :800).
    layLSheetCut = areaWasteL < 0 ? ansL - Math.ceil(Math.abs(areaWasteL / (dl + trimGap))) : ansL;
    sheetAmount = layL / layLSheetCut;
    sheetAmountOutput = sheetAmount;
    if (sheetAmount < minSheetPerJob) {
      sheetAmount = minSheetPerJob;
      useMinSheet = true;
    } else {
      useMinSheet = false;
    }
    const sheetAmountCalculate = Math.floor(sheetAmount);
    const sheetWaste = layL - layLSheetCut * sheetAmountCalculate;
    const wasteLength =
      sheetWaste < 0 ? 0 : sheetWaste * along + (sheetWaste - 1) * trimGap + paperTrimL + endJobTrim;
    areaL = sheetAmountCalculate * sheetCutLength * 25.4 + wasteLength;
    areaW = pw;
  } else {
    // roll (:831-857)
    const across = layoutStandard ? dw : dl;
    const along = layoutStandard ? dl : dw;
    ansW = Math.floor(pw / across);
    if (!(ansW > 0)) return NOTHING;
    areaWasteW = pw - (ansW * across + (ansW - 1) * trimGap);
    layW = areaWasteW < 0 ? ansW - Math.ceil(Math.abs(areaWasteW) / (across + trimGap)) : ansW;
    layL = Math.ceil(boxAmount / layW);
    areaW = layW * across + (layW - 1) * trimGap + trim;
    areaL = layL * along + (layL - 1) * trimGap + trim;
  }

  if (sheetCutLength > 0) {
    return {
      layout: sheetAmount,
      slotW: layW,
      slotL: layLSheetCut,
      areaW,
      areaL,
      sheetAmount: sheetAmountOutput,
      useMinSheet,
    };
  }
  return { layout: layW * layL, slotW: layW, slotL: layL, areaW, areaL };
}
