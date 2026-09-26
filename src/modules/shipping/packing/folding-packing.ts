import { type GeometryFormula } from '@modules/pricing/calculators/folding/geometry/types';

/**
 * Packing helper for folding cartons (B2.4, D-013): blank size, flat size and thickness, weight, the
 * lay-out of flat boxes on the carton footprint, carton count and carton size. Ported from legacy
 * `app/Libraries/Shipping/FoldingUtil.php` (whole file) and `ShippingUtils::calShippingCostFolding`
 * (`ShippingUtils.php:463-600`), with the legacy pattern ids mapped to `geometry_formula` (port map §6).
 *
 * Differences from legacy, on purpose:
 * - the 60 cm footprint grid, the 60 cm stack height and the carrier's weight limit are the setting
 *   `shipping.carton_spec` (no decision gives them; unset → only weight is computed);
 * - legacy asked each carrier for its weight limit and threshold (`getAmountOfShippingBoxByWeight`,
 *   e.g. `Ninjavan.php:41-49`); here the carton's `maxWeightKg` is both (the factory fleet has no
 *   carrier table);
 * - a total weight of 0 kg gives 0 cartons by weight (legacy divides by zero).
 * Pure: no database access.
 */

export interface CartonSpec {
  /** Legacy footprint grid, 60 cm (`FoldingUtil.php:189-224`, spreadsheet `AV`/`AW`). */
  gridCm: number;
  /** Legacy stack height per carton, 60 cm (`ShippingUtils.php:506`, spreadsheet `$GH$17`). */
  maxStackHeightCm: number;
  maxWeightKg: number;
}

export interface FoldingPackInput {
  formula: GeometryFormula;
  /** Box dimensions in mm (legacy `Wmm`, `Lmm`, `Dmm`). */
  w: number;
  l: number;
  d: number;
  gsm: number;
  qty: number;
  /** Blank of a `standard_blank` pattern (legacy `pattern_rel_standard_sizes.dw/dl`, `FoldingUtil.php:298-309`). */
  standardBlank?: { dw: number; dl: number } | null;
}

export interface FlatSize {
  dw: number;
  dl: number;
  flatW: number;
  flatL: number;
  thickness: number;
  /** Overlap of neighbouring boxes on the footprint, cm (legacy `overLapLayoutcm`). */
  overlapCm: number;
}

export interface Carton {
  count: number;
  wCm: number;
  lCm: number;
  hCm: number;
  weightKg: number;
}

export interface FoldingPack {
  flat: FlatSize;
  /** Legacy `getWeightPerBox`, kg (`FoldingUtil.php:440-444`). */
  weightPerBoxKg: number;
  /** Legacy `weightAllBox` = ⌈weight per box × qty⌉, whole kg (`ShippingUtils.php:486`). */
  weightAllKg: number;
  layW: number | null;
  layL: number | null;
  /** Null without a carton spec. */
  carton: Carton | null;
}

/** Legacy flap constants (`FoldingUtil.php:97-167`, `:227-242`). */
function flaps(w: number, l: number) {
  return {
    f1: l <= 150 ? 15 : l >= 301 ? 25 : 20,
    f3: l <= 150 ? 15 : l >= 301 ? 30 : 20,
    f6: w <= 35 ? 25 : 15,
    g2: w <= 20 ? 10 : 15,
    r4: w <= 100 ? 20 : w > 300 ? 40 : 30,
    b7: w <= 120 ? 20 : 30,
    b11: w > 151 ? 23.25 : w > 81 ? 18.25 : w >= 31 ? 10.25 : 5.25,
  };
}

/** Legacy `initdW` / `initdL` (`FoldingUtil.php:244-386`), in mm. */
function blank(input: FoldingPackInput, f: ReturnType<typeof flaps>): { dw: number; dl: number } {
  const { w, l, d } = input;
  switch (input.formula) {
    case 'tuck_top':
      return { dw: f.f1 + w + d + (w - 0.5) + f.f1, dl: f.g2 + l + l + w + w - 0.5 };
    case 'tray':
    case 'slide_tray':
      return { dw: 2 * (f.f3 + (d - 1) + 8 + d) + w + 16, dl: 2 * (f.f3 + (d - 1) + 8 + d) + l + 16 };
    case 'sleeve':
    case 'slide_sleeve':
      return { dw: l + 16, dl: f.g2 + (w + 18) + (d + 3) + (w + 18) + (d + 1) };
    case 'lid':
    case 'cover_base':
      return { dw: 2 * (f.f3 + (d - 0.5) + d) + w + 19, dl: 2 * (f.f3 + (d - 0.5) + d) + l + 19 };
    case 'insert':
      // Legacy `amtBoxInside` is always 1 (`FoldingUtil.php:14`).
      return { dw: d + l + 2 * f.r4, dl: f.r4 * (1 + 1) + w * 1 + d };
    case 'hanger_tuck_top':
      return { dw: 2 * f.f6 + 2 * w + d + 60, dl: f.g2 + 2 * l + 2 * w };
    case 'popup_tuck_top':
      return { dw: 2 * w + d + 2 * f.f1, dl: f.g2 + 2 * w + 4 * l };
    case 'popup_hanger':
      return { dw: 2 * f.f6 + 2 * w + d + 60, dl: f.g2 + 2 * w + 4 * l };
    case 'house':
      return { dw: f.b7 + w / 2 + d + 30 + d / 2, dl: f.g2 + 2 * w + 2 * l };
    case 'fold_flap':
      return { dw: f.b7 + d / 2 + d + w + w / 2, dl: f.g2 + 2 * w + 2 * l };
    case 'wagashi':
      return { dw: 2 * d + w + w / 2 + (3 * w) / 4, dl: l / 2 + 2 * d + l };
    case 'wagashi_side_tuck':
      return { dw: 2 * d + 2 * w + 30, dl: 2 * d + l };
    case 'wagashi_open_top':
      return { dw: 2 * d + 2 * w + 30, dl: 40 + w + l };
    case 'flat':
    case 'flat_overlap':
    case 'flat_overlap_combined':
    case 'flat_extended':
      return { dw: w, dl: l };
    case 'lock_bottom_top':
      return { dw: f.f1 + w + d + w / 2 - 0.25 + f.b11, dl: f.g2 + l + l + w + w - 0.5 };
    case 'standard_blank':
      if (!input.standardBlank) throw new RangeError('standard_blank needs the pattern standard blank');
      return { dw: input.standardBlank.dw, dl: input.standardBlank.dl };
  }
}

/** Legacy `findFlatSize` and `initOverlapLayout` (`FoldingUtil.php:169-182`, `:388-438`). */
export function flatSize(input: FoldingPackInput): FlatSize {
  const f = flaps(input.w, input.l);
  const { dw, dl } = blank(input, f);
  const { w, l, d } = input;
  const hangerW = w + f.f6 >= 60 ? dw : dw + (60 - Math.abs(w + f.f6));
  let flat: { flatW: number; flatL: number; thickness: number };
  switch (input.formula) {
    case 'tuck_top':
    case 'lock_bottom_top':
      flat = { thickness: 1.5, flatW: dw, flatL: (dl - f.g2 + 0.5) / 2 + 1 };
      break;
    case 'hanger_tuck_top':
      flat = { thickness: 1.5, flatW: hangerW, flatL: (dl - f.g2) / 2 + 1 };
      break;
    case 'popup_tuck_top':
      flat = { thickness: 2, flatW: dw, flatL: w + l + Math.abs(l - w) + 1 };
      break;
    case 'popup_hanger':
      flat = { thickness: 2, flatW: hangerW, flatL: w + l + Math.abs(l - w) + 1 };
      break;
    case 'house':
    case 'fold_flap':
      flat = { thickness: 1.5, flatW: dw, flatL: (dl - f.g2) / 2 + 1 };
      break;
    default:
      flat = { thickness: 0.5, flatW: dw, flatL: dl };
  }
  const overlapMm =
    input.formula === 'tuck_top' ||
    input.formula === 'hanger_tuck_top' ||
    input.formula === 'popup_tuck_top' ||
    input.formula === 'popup_hanger'
      ? w + f.f1
      : input.formula === 'lock_bottom_top'
        ? dw - (d + w / 2 - 0.25 + f.b11 + l / 4)
        : 0;
  return { dw, dl, ...flat, overlapCm: overlapMm / 10 };
}

/** Legacy `initAnsW/L`, `initAreaWasteW/L`, `getLayW/L` (`FoldingUtil.php:184-225`, `:446-507`). */
export function layout(
  formula: GeometryFormula,
  flat: FlatSize,
  gridCm: number,
): { layW: number; layL: number } {
  const dWcm = Math.ceil(flat.flatW / 10);
  const dLcm = Math.ceil(flat.flatL / 10);
  const overlap = flat.overlapCm;
  const lock = formula === 'lock_bottom_top';
  const ansW = lock ? Math.floor(gridCm / (dWcm * 2 - overlap)) : Math.floor(gridCm / dWcm);
  const ansL = Math.floor(gridCm / dLcm);
  const wasteW =
    formula === 'tuck_top'
      ? gridCm - (dWcm * ansW - (ansW - 1) * overlap)
      : lock
        ? gridCm - ansW * (dWcm * 2 - overlap)
        : gridCm - dWcm * ansW;
  const wasteL = gridCm - dLcm * ansL;
  let layW: number;
  if (dWcm > gridCm) layW = 1;
  else if (formula === 'tuck_top') {
    layW =
      wasteW < 0 ? ansW - 1 : wasteW > dWcm - overlap ? ansW + Math.floor(wasteW / (dWcm - overlap)) : ansW;
  } else if (lock) {
    layW = wasteW < 0 ? ansW * 2 - 1 : wasteW > dWcm ? ansW * 2 + 1 : ansW * 2;
  } else {
    layW = wasteW < 0 ? ansW - Math.ceil(Math.abs(wasteW) / dWcm) : ansW;
  }
  const layL = dLcm > gridCm ? 1 : wasteL < 0 ? ansL - Math.ceil(Math.abs(wasteL) / dLcm) : ansL;
  return { layW, layL };
}

/** Legacy `getAmountOfShippingBoxByWeight` with limit = threshold = `maxKg` (e.g. `Ninjavan.php:41-49`). */
export function cartonsByWeight(weightAllKg: number, maxKg: number): number {
  if (weightAllKg <= 0) return 0;
  const n = Math.ceil(weightAllKg / (maxKg - 0.5));
  return Math.ceil(weightAllKg / n) > maxKg ? n + 1 : n;
}

/** `calShippingCostFolding` up to the carton size and weight (`ShippingUtils.php:480-532`). */
export function packFolding(input: FoldingPackInput, spec: CartonSpec | null): FoldingPack {
  const flat = flatSize(input);
  const weightPerBoxKg = (((flat.dw * flat.dl) / 1_000_000) * input.gsm) / 1000;
  const weightAllKg = Math.ceil(weightPerBoxKg * input.qty);
  if (!spec) return { flat, weightPerBoxKg, weightAllKg, layW: null, layL: null, carton: null };
  const { layW, layL } = layout(input.formula, flat, spec.gridCm);
  const byWeight = cartonsByWeight(weightAllKg, spec.maxWeightKg);
  const layH = input.qty / (layW * layL);
  const bySize = Math.ceil((layH * flat.thickness) / 10 / spec.maxStackHeightCm);
  const count = Math.max(bySize, byWeight);
  const stackW = Math.ceil(flat.flatW / 10);
  const stackL = Math.ceil(flat.flatL / 10);
  let wCm: number;
  if (input.formula === 'tuck_top') wCm = stackW * layW - (layW - 1) * flat.overlapCm;
  else if (input.formula === 'lock_bottom_top') {
    wCm =
      layW % 2 !== 0
        ? layW * stackW - ((layW - 1) / 2) * flat.overlapCm
        : layW * stackW - (layW / 2) * flat.overlapCm;
  } else wCm = stackW * layW;
  return {
    flat,
    weightPerBoxKg,
    weightAllKg,
    layW,
    layL,
    carton: {
      count,
      wCm,
      lCm: stackL * layL,
      hCm: Math.ceil((layH * flat.thickness) / 10 / count),
      weightKg: Math.ceil(weightAllKg / count + 0.5),
    },
  };
}
