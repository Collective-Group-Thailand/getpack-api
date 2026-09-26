import { phpRound } from '../../../engine/php';
import {
  type GeometryBand,
  type GeometryCondition,
  type GeometryDeterminant,
  GeometryError,
  type GeometryFormula,
  type GeometrySlot,
  type PatternGeometry,
} from './types';

/**
 * Pattern formulas of `PatternArea::calPatternArea` (legacy `app/Libraries/Folding/PatternArea.php`,
 * lines cited per case). Expressions keep the PHP operand order so floating-point results match.
 * Where legacy reads a missing condition it silently computes with 0 (a PHP notice); Packio refuses
 * to price that configuration instead (quirk Q14).
 */

export interface Dims {
  w: number;
  l: number;
  d: number;
  x: number;
  c: number;
}

export interface BlankGeometry {
  dw: number;
  dl: number;
  nd: number;
  nl: number;
  nw: number;
  c: number;
  combineLayout: boolean;
}

/** Legacy `getValueByConditionId`: the band whose inclusive range holds the value (`:76-88`). */
export function bandValue(bands: readonly GeometryBand[], value: number, what: string): number {
  const band = bands.find((b) => b.lower <= value && b.upper >= value);
  if (!band) throw new GeometryError('geometry_band_missing', `${what} has no band for ${value}`);
  return band.value;
}

class Conditions {
  constructor(
    private readonly pattern: PatternGeometry,
    private readonly dims: Dims,
  ) {}

  private conditions(slot: GeometrySlot): readonly GeometryCondition[] {
    const list = this.pattern.conditions[slot] ?? [];
    if (list.length === 0) throw new GeometryError('geometry_condition_missing', `slot ${slot}`);
    return list;
  }

  /** The slot's condition looked up by its own determinant, or by `by` where legacy hard-codes it. */
  value(slot: GeometrySlot, by?: GeometryDeterminant): number {
    const condition = this.conditions(slot)[0]!;
    return bandValue(condition.bands, this.dims[by ?? condition.determinant], `slot ${slot}`);
  }

  /**
   * The slot's condition named `variable`, looked up by `by`: legacy assigns each condition to a PHP
   * variable of that name (`$$defineVar`), so the last one with the name wins.
   */
  variable(slot: GeometrySlot, variable: string, by: GeometryDeterminant): number {
    const condition = [...(this.pattern.conditions[slot] ?? [])]
      .reverse()
      .find((c) => c.variable === variable);
    if (!condition)
      throw new GeometryError('geometry_condition_missing', `slot ${slot} variable ${variable}`);
    return bandValue(condition.bands, this.dims[by], `slot ${slot} variable ${variable}`);
  }
}

const noNotches = { nd: 0, nl: 0, nw: 0 };

type Formula = (dims: Dims, cond: Conditions, pattern: PatternGeometry) => BlankGeometry;

const FORMULAS: Record<GeometryFormula, Formula> = {
  // case 1 แบบฝาเปิดบน (:186-219)
  tuck_top: ({ w, l, d }, cond) => {
    const f = cond.value('dw');
    const g = cond.value('dl');
    return {
      dw: f + w - 1 + d + 1 + w - 1 + f,
      dl: w - 1 + l + w + l + g,
      c: w + f,
      nd: d + 1,
      nl: l + 1,
      nw: w + 1,
      combineLayout: false,
    };
  },

  // case 2 ถาด (:221-241)
  tray: ({ w, l, d }, cond) => {
    const f = cond.value('dw');
    return {
      dw: 2 * (f + (d - 1) + 8 + d) + w + 16,
      dl: 2 * (f + (d - 1) + 8 + d) + l + 16,
      c: 0,
      nd: d + 1,
      nl: l + 16,
      nw: w + 16,
      combineLayout: false,
    };
  },

  // case 3 ปลอก (:243-256)
  sleeve: ({ w, l, d }, cond) => {
    const g = cond.value('dl');
    return {
      dw: d + 1,
      dl: g + (l + 1) + (w + 1) + (l + 1) + (w + 1),
      c: 0,
      nd: d + 1,
      nl: l,
      nw: w + 1,
      combineLayout: false,
    };
  },

  // case 4 ฝาครอบ (:258-273)
  lid: ({ w, l, d }, cond) => {
    const f = cond.value('dw');
    return {
      dw: 2 * (f + (d - 0.5) + d) + w + 19,
      dl: 2 * (f + (d - 0.5) + d) + l + 19,
      c: 0,
      nd: d + 1,
      nl: l + 2,
      nw: w + 2,
      combineLayout: false,
    };
  },

  // case 5 ไส้ (:275-294)
  insert: ({ w, l, d, x }, cond) => {
    const r = cond.value('dw');
    return {
      dw: d + l + 2 * r,
      dl: r * (x + 1) + w * x + d,
      c: 0,
      nd: d + 1,
      nl: x * w + (x + 1) * r + 1,
      nw: 2 * r + l + 1,
      combineLayout: false,
    };
  },

  // case 6 หูแขวนฝาเปิดบน (:296-320)
  hanger_tuck_top: ({ w, l, d }, cond) => {
    const f = cond.value('dw');
    const g = cond.value('dl');
    return {
      dw: Math.max(36 + 25 + d + 0.5 + w - 1 + f, f + w - 2 + d + 1 + w - 1 + f),
      dl: w - 1 + l + w + l + g,
      c: 0,
      nd: d + 25,
      nl: l + 1,
      nw: w + 1,
      combineLayout: false,
    };
  },

  // case 7 แบบป๊อปอัพฝาเปิดบน (:322-345)
  popup_tuck_top: ({ w, l, d }, cond) => {
    const f = cond.value('dw');
    const g = cond.value('dl');
    return {
      dw: f + w - 1 + d + 1 + w - 1 + f,
      dl: l - 0.5 + l + l + w + l + w + g,
      c: w + f,
      nd: d + 1,
      nl: l + 1,
      nw: w + 1,
      combineLayout: false,
    };
  },

  // case 8 แบบป๊อปอัพหูแขวน (:347-372)
  popup_hanger: ({ w, l, d }, cond) => {
    const f = cond.value('dw');
    const g = cond.value('dl');
    return {
      dw: Math.max(36 + 25 + d + 0.5 + w - 1 + f, f + w - 2 + d + 1 + w - 1 + f),
      dl: l - 0.5 + l + l + w + l + w + g,
      c: 0,
      nd: d + 25,
      nl: l + 1,
      nw: w + 1,
      combineLayout: false,
    };
  },

  // case 9 แบบทรงบ้าน (:374-409); `f` is legacy condition group 1 by length (`aux_f`).
  house: ({ w, l, d }, cond) => {
    const f = cond.value('aux_f', 'l');
    const g = cond.value('dl');
    const a = cond.value('nd');
    return {
      dw: 45 + 1 + 40 + d + 0.5 + w - 1 + f,
      dl: w - 1 + l + w + l + g,
      c: 0,
      nd: d + a,
      nl: l + 1,
      nw: w + 1,
      combineLayout: false,
    };
  },

  // case 10 แบบฝาพับ (:411-433); legacy also looks up `dl` but never uses it.
  fold_flap: ({ w, l, d }, cond) => {
    const b = cond.value('dw');
    return {
      dw: d / 2 + w + 0.5 + d + 0.5 + w - 1 + b,
      dl: w - 1 + l + w + l + 0.5 + d / 2,
      c: 0,
      nd: d + 1,
      nl: l + 2,
      nw: w + 1.5,
      combineLayout: false,
    };
  },

  // case 11 แบบขนมญี่ปุ่น (:435-456)
  wagashi: ({ w, l, d }) => ({
    dw: w - w / 8 + d + 0.5 + w + d + 0.5 + (3 * w) / 4,
    dl: Math.max(l / 4 + d + l + d + l / 4, 20 + w / 2 + l + w / 2 + 20),
    c: 0,
    nd: d + 1.5,
    nl: l + 1,
    nw: w + 2,
    combineLayout: false,
  }),

  // case 12 แบบขนมฝาเสียบข้าง (:458-470)
  wagashi_side_tuck: ({ w, l, d }) => ({
    dw: 30 + w - 0.5 + d + w + d,
    dl: 2 * d + l,
    c: 0,
    nd: d + 1,
    nl: l + 3,
    nw: w + 1,
    combineLayout: false,
  }),

  // case 13 แบบขนมฝาเปิด (:472-505); groups 1 and 10 by length (`aux_f`, `aux_f10`).
  wagashi_open_top: ({ w, l, d }, cond) => {
    const f = cond.value('aux_f', 'l');
    const f10 = cond.value('aux_f10', 'l');
    return {
      dw: d - 0.5 + w + d - 0.5 + w - 0.5 + f,
      dl: Math.max(f10 + d + l + d + f10, 20 + w / 2 + l + w / 2 + 20),
      c: 0,
      nd: d + 1,
      nl: l + 3,
      nw: w + 1,
      combineLayout: false,
    };
  },

  // case 14 แบบทั่วไป overlap (:507-511)
  flat_overlap: ({ w, l, c }) => ({ dw: w, dl: l, c, ...noNotches, combineLayout: false }),

  // cases 15, 33-36 แบบทั่วไป non-overlap (:513-517, 637-656)
  flat: ({ w, l }) => ({ dw: w, dl: l, c: 0, ...noNotches, combineLayout: false }),

  // case 16 แบบเปิดฝาบน/ฝาล่างขัดล็อค (:519-572): the `dw` conditions are read as named variables,
  // all by width; legacy uses the one named `b`, and group 1 by length as `f` (`aux_f`).
  lock_bottom_top: ({ w, l, d }, cond) => {
    const b = cond.variable('dw', 'b', 'w');
    const f = cond.value('aux_f', 'l');
    const bValue = w <= 30 ? 3 : w <= 80 ? 5 : 10;
    let aValue = w / 2 - 0.25 + bValue - l / 3;
    if (aValue < bValue + 2) aValue = bValue + 2;
    if (aValue + l / 3 > l / 2 - 1) aValue = l / 3 - (l / 2 - 1) - bValue;
    const dw1 = f + w - 1 + d + 0.5 + (w / 2 - 0.25) + b;
    const dw2 = f + w - 1 + d + 0.5 + l / 3 + aValue + bValue;
    // Legacy `floatval(number_format($dw, 2))` truncates at the thousands comma from 1,000 mm (Q12).
    const dw = phpRound(Math.max(dw1, dw2), 2);
    const g = cond.value('dl');
    return {
      dw,
      dl: w - 1 + l + w + l + g,
      c: dw - (d + w / 2 - 0.25 + b + l / 4),
      nd: d + 1,
      nl: l + 1,
      nw: w + 1,
      combineLayout: true,
    };
  },

  // case 17 แบบทั่วไป overlap2 (:574-579)
  flat_overlap_combined: ({ w, l, c }) => ({ dw: w, dl: l, c, ...noNotches, combineLayout: true }),

  // case 31 sub 5 and case 32 sub 7 (:582-594, 610-622)
  slide_tray: ({ w, l, d }, cond) => {
    const f = cond.value('dw');
    return {
      dl: 4 * d + 2 * f + w + 30,
      dw: Math.max(4 * d + 2 * f + l + 30, w + l + 52),
      c: 0,
      nd: d + 1,
      nl: l + 16,
      nw: w + 16,
      combineLayout: false,
    };
  },

  // case 31 sub 6 (:595-607): legacy looks the `dl` condition up by depth, whatever its determinant.
  slide_sleeve: ({ w, l, d }, cond) => {
    const g = cond.value('dl', 'd');
    return {
      dw: d + 1,
      dl: g + (l + 1) + (w + 1) + (l + 1) + w,
      c: 0,
      nd: d + 1,
      nl: l,
      nw: w + 1,
      combineLayout: false,
    };
  },

  // case 32 sub 8 (:623-635)
  cover_base: ({ w, l, d }, cond) => {
    const f = cond.value('dw');
    return {
      dl: 4 * d + 2 * f + w + 1,
      dw: 4 * d + 2 * f + l + 3,
      c: 0,
      nd: d + 1,
      nl: l + 2,
      nw: w + 2,
      combineLayout: false,
    };
  },

  // case 37 (:657-663)
  flat_extended: ({ w, l }, cond) => {
    const g = cond.value('dl');
    return { dw: w, dl: l + g, c: 0, ...noNotches, combineLayout: false };
  },

  // cases 45-48 food boxes (:664-719): the blank is stored per standard size, matched exactly.
  standard_blank: ({ w, l, d }, _cond, pattern) => {
    const blank = pattern.standardBlanks?.find((b) => b.wMm === w && b.lMm === l && b.dMm === d);
    if (!blank) throw new GeometryError('geometry_standard_blank_missing', `${w}×${l}×${d} mm`);
    return { dw: blank.dwMm, dl: blank.dlMm, c: 0, ...noNotches, combineLayout: false };
  },
};

/** The blank of one pattern (or sub-pattern) before the factory's own delta. */
export function blankGeometry(pattern: PatternGeometry, dims: Dims): BlankGeometry {
  return FORMULAS[pattern.formula](dims, new Conditions(pattern, dims), pattern);
}
