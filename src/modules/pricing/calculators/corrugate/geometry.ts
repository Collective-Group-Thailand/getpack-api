import { phpRound } from '../../engine/php';
import { PricingError } from '../shared/pricing-error';
import { type CORRUGATE_FORMULAS } from './formulas';

/**
 * Corrugate blank geometry (U-B6, port map §6): legacy `CalculatorCorrugate::calculate:289-487` with the
 * formulas `cal1–cal29:1580-1756`, `Tele*:1758-1784`, the condition bands `getConditionValue:2039`, the
 * RSC test `:613-660` and the print-area percentages `calculate_percent_from_pattern_area:1798-1954`.
 * Expressions keep the PHP operand order so floating-point results match (IEEE doubles, as PHP). Pure.
 *
 * Deviations (port map §5): a missing condition band refuses the configuration (quirk C3; legacy reads
 * `->first()->condition_value` on null), and only the formulas that read a band need it (quirk C4).
 */

export type CorrugateFormula = (typeof CORRUGATE_FORMULAS)[number];

/** Flute take-up factors (legacy `flute_type.col_a, col_c, col_dd, col_g, col_fh, ct, z`), mm. */
export interface FluteFactors {
  a: number;
  c: number;
  dd: number;
  g: number;
  fh: number;
  ct: number;
  z: number;
}

/** One band of a legacy `conditions` table: inclusive on both ends (`:2044-2045`). */
export interface ConditionBand {
  lower: number;
  upper: number;
  value: number;
}

/** The band tables of the condition variables (legacy `i`, `k`, `m` by W; `j` by W ÷ L). */
export type ConditionBands = Partial<Record<'i' | 'j' | 'k' | 'm', readonly ConditionBand[]>>;

export interface GeometryInput {
  formula: CorrugateFormula;
  /** Box width, length, depth in mm (legacy `W`, `L`, `D`; the calculation size of a standard size). */
  w: number;
  l: number;
  d: number;
  flute: FluteFactors;
  conditions: ConditionBands;
  /** The factory's blank adjustment for the pattern × flute (legacy `plus_dl`, `plus_dw`). */
  plus: { dl: number; dw: number } | null;
}

export interface Blank {
  /** The box as laid out: a Tele lid and a slide sleeve are sized from the box (`:412-414, :433-438`). */
  w: number;
  l: number;
  d: number;
  /** Blank width and length, factory adjustment included (legacy `$this->dW`, `$this->dL`). */
  dw: number;
  dl: number;
  plusDw: number;
  plusDl: number;
  flap: number | null;
  slh: number | null;
  odl: number | null;
  odw: number | null;
  odh: number | null;
  /** Blank area in m², rounded to 4 places (`:481`). */
  areaSqm: number;
  /** The condition values read, for the print-area formulas (`i`, `j`: `:509-510`). */
  i: number;
  j: number;
}

const needsBands: Partial<Record<CorrugateFormula, readonly ('i' | 'j' | 'k' | 'm')[]>> = {
  open_top: ['i', 'j', 'k', 'm'],
  handle: ['j', 'k', 'm'],
  handle_rim: ['j', 'k', 'm'],
};

/** `getConditionValue`: the first band whose inclusive range holds the value (`:2039-2047`). */
function conditionValue(
  bands: readonly ConditionBand[] | undefined,
  variable: string,
  value: number,
): number {
  if (!bands || bands.length === 0) {
    throw new PricingError('geometry_condition_missing', `condition ${variable}`);
  }
  const band = bands.find((b) => b.lower <= value && b.upper >= value);
  if (!band)
    throw new PricingError('geometry_band_missing', `condition ${variable} has no band for ${value}`);
  return band.value;
}

/** RSC-family flap: `cal1`…`cal7` of legacy pattern 19 (`:1580-1620`). */
const cal = {
  cal1: (W: number, D: number, f: FluteFactors) => Math.floor(W / 2) * 2 + 2 * f.c + D + f.dd,
  cal2: (W: number, L: number, f: FluteFactors) => f.g + (L + f.a) * 2 + (W + f.a) * 2 - 3,
  cal3: (W: number, f: FluteFactors) => Math.floor(W / 2) + f.c,
  cal4: (D: number, f: FluteFactors) => D + f.dd,
  cal8: (W: number, D: number, f: FluteFactors) =>
    D + W + (D + f.a) + (W + f.c + 2 * f.fh) + (D + f.a) + (f.fh + f.a) + (D + f.a - 2) + (f.fh + 1 + f.z),
  cal9: (L: number, D: number, f: FluteFactors) => D * 2 + f.c * 2 + L + f.a,
  cal13: (L: number, D: number, f: FluteFactors) =>
    D +
    f.c +
    f.fh +
    2.5 * f.z +
    (2 * f.fh + f.a - 2 + f.z) +
    (D + f.a + 1) +
    (L + 6 * f.fh + f.a - 1 + 4 * f.z) +
    (D + f.a + 1) +
    (2 * f.fh + f.a - 2 + f.z) +
    (D + f.c + f.fh + 2.5 * f.z),
  cal14: (W: number, D: number, f: FluteFactors) =>
    D +
    f.c +
    f.fh +
    1.5 * f.z +
    (W + f.fh + f.a + 1 + 0.5 * f.z) +
    (D + f.a + 1) +
    (W + f.a + 1) +
    (D + f.a - 1),
  cal24: (W: number, D: number, f: FluteFactors) =>
    D +
    f.c +
    f.fh +
    1.5 * f.z +
    (W + 2 * f.fh + f.a + 1 + 0.5 * f.z) +
    (D + f.a + 1) +
    (W + f.a + f.fh + 1) +
    (D + f.a - 1) +
    (D - f.fh),
  teleDW: (W: number, D: number, f: FluteFactors) => W / 2 + f.c + D + f.a,
  teleDL: (W: number, L: number, f: FluteFactors) => f.g + (L + f.a) * 2 + (W + f.a) * 2 - 3,
  /** The shared body of patterns 26–28 (`:379, :387, :395`), after the leading terms. */
  openTopTail: (W: number, L: number, f: FluteFactors, j: number, k: number, m: number) =>
    W / 2 +
    f.c -
    1 +
    ((W * 3) / 16) * m +
    k +
    (L / 9 - (W / 2 + f.c - 1 + ((W * 3) / 16) * m + k - L / 3)) * j,
};

/**
 * The blank of one part (`:297-481`). `i j k m` are read at the box as asked, before a Tele lid or slide
 * sleeve resizes it (`:309-312` run before the pattern switch).
 */
export function blank(input: GeometryInput): Blank {
  const f = input.flute;
  let W = input.w;
  let L = input.l;
  let D = input.d;
  const read = new Set(needsBands[input.formula] ?? []);
  const band = (v: 'i' | 'j' | 'k' | 'm', value: number) =>
    read.has(v) ? conditionValue(input.conditions[v], v, value) : 0;
  const i = band('i', W);
  const j = band('j', W / L);
  const k = band('k', W);
  const m = band('m', W);

  if (input.formula === 'tele_lid') {
    // The lid is sized over the body, then laid out as the body (`:411-414`).
    W = W + 2 * f.fh - f.ct;
    L = L + 2 * f.fh - f.ct;
    D = D + 2 * f.fh - f.ct;
  }

  let dW: number;
  let dL: number;
  let flap: number | null = null;
  let slh: number | null = null;
  let odl: number | null = null;
  let odw: number | null = null;
  let odh: number | null = null;
  switch (input.formula) {
    case 'rsc': // pattern 19 (`:314-322`)
      dW = cal.cal1(W, D, f);
      dL = cal.cal2(W, L, f);
      flap = cal.cal3(W, f);
      slh = cal.cal4(D, f);
      odl = L + 2 * f.fh;
      odw = W + 2 * f.fh;
      odh = D + 4 * f.fh;
      break;
    case 'single_tuck': // pattern 20 (`:323-331`, cal8–cal12)
      dW = cal.cal8(W, D, f);
      dL = cal.cal9(L, D, f);
      odl = L + 2 * f.fh;
      odw = W + 4 * f.fh;
      odh = D + 2 * f.fh;
      break;
    case 'double_tuck': // pattern 21 (`:332-340`, cal13–cal17)
      dW = cal.cal13(L, D, f);
      dL = cal.cal14(W, D, f);
      odl = L + 8 * f.fh;
      odw = W + 2 * f.fh;
      odh = D + 2 * f.fh;
      break;
    case 'double_tuck_top_wall': // pattern 22 (`:341-349`, cal18–cal22)
      dW = cal.cal13(L, D, f);
      dL = cal.cal14(W, D, f) + (W - f.fh);
      odl = L + 8 * f.fh;
      odw = W + 2 * f.fh;
      odh = D + 3 * f.fh;
      break;
    case 'double_tuck_side_wall': // pattern 23 (`:350-358`, cal23–cal27)
      dW = cal.cal13(L, D, f);
      dL = cal.cal24(W, D, f);
      odl = L + 8 * f.fh;
      odw = W + 3 * f.fh;
      odh = D + 2 * f.fh;
      break;
    case 'flat_sheet': // pattern 24 (`:359-367`, cal28–cal29)
      dW = W;
      dL = L;
      break;
    case 'seafood': // pattern 25 (`:368-377`)
      dW = cal.cal8(W, D, f);
      dL = cal.cal9(L, D, f);
      odl = L + 4 * f.fh + 5;
      odw = W + 4 * f.fh + f.c;
      odh = D + 2 * f.fh;
      break;
    case 'open_top': // pattern 26 (`:378-385`)
      dW = i + W + f.a + (D + f.a) + cal.openTopTail(W, L, f, j, k, m);
      dL = f.g + (L + f.a) + (W + f.a) + (L + f.a) + (W + f.a - 3);
      odl = L + 2 * f.fh;
      odw = W + 2 * f.fh;
      odh = D + 3 * f.fh;
      break;
    case 'handle': // pattern 27 (`:386-393`)
      dW = 25 + 30 + W / 2 + (D + f.a) + cal.openTopTail(W, L, f, j, k, m);
      dL = f.g + (L + f.a) + (W + f.a) + (L + f.a) + (W + f.a - 3);
      odl = L + 2 * f.fh;
      odw = W + 2 * f.fh;
      odh = D + 2 * f.fh + 25 + 30;
      break;
    case 'handle_rim': // pattern 28 (`:394-401`)
      dW = 25 + 30 + (20 + f.a) + W / 2 + (D + f.a) + cal.openTopTail(W, L, f, j, k, m);
      dL = f.g + (L + f.a) + (W + f.a) + (L + f.a) + (W + f.a - 3);
      odl = L + 2 * f.fh;
      odw = W + 2 * f.fh;
      odh = D + 2 * f.fh + 25 + 30 + (20 + f.a);
      break;
    case 'tele_body': // pattern 29 sub 1 (`:403-410`)
    case 'tele_lid': // pattern 29 sub 2, sized over the body above (`:411-421`)
      dW = cal.teleDW(W, D, f);
      dL = cal.teleDL(W, L, f);
      flap = W / 2 + f.c;
      slh = D + f.a;
      odl = L + 2 * f.fh;
      odw = W + 2 * f.fh;
      odh = D + 2 * f.fh;
      break;
    case 'slide_tray': // pattern 30 sub 3 (`:424-431`)
    case 'tray': // pattern 38 (`:447-454`)
      dW =
        f.fh + (D - f.c) + (f.fh + f.a) + D + (2 * f.fh + f.c) * 2 + L + D + (f.fh + f.a) + (D - f.c) + f.fh;
      dL = D + (W + f.a) + D;
      odl = L + 6 * f.fh;
      odw = W + 2 * f.fh;
      odh = D + f.fh;
      break;
    case 'slide_sleeve': {
      // pattern 30 sub 4: the sleeve wraps the tray (`:432-446`)
      const [w0, l0, d0] = [W, L, D];
      W = d0 + f.fh;
      L = w0 + 2 * f.fh;
      D = l0 + 6 * f.fh;
      dW = f.g + (L + f.a + 1) + (W + f.a + 1) + (L + f.a + 1) + (W + f.a - 1);
      dL = D;
      odl = D;
      odw = L + 2 * f.fh + 1;
      odh = W + 2 * f.fh + 1;
      break;
    }
    case 'full_overlap': // pattern 39 (`:455-463`)
      dW = W * 2 + 2 * f.c + D + f.dd;
      dL = cal.cal2(W, L, f);
      flap = W + f.c;
      slh = cal.cal4(D, f);
      odl = L + 2 * f.fh;
      odw = W + 2 * f.fh;
      odh = D + 6 * f.fh;
      break;
  }

  // The factory's adjustment of the blank (`:465-475`).
  const plusDw = input.plus?.dw ?? 0;
  const plusDl = input.plus?.dl ?? 0;
  if (input.plus) {
    dW += plusDw;
    dL += plusDl;
  }
  return {
    w: W,
    l: L,
    d: D,
    dw: dW,
    dl: dL,
    plusDw,
    plusDl,
    flap,
    slh,
    odl,
    odw,
    odh,
    areaSqm: phpRound((dL * dW) / 1000000, 4),
    i,
    j,
  };
}

// ------------------------------------------------------------------------------------------------
// RSC or die-cut (`:613-660`)
// ------------------------------------------------------------------------------------------------

/** The RSC limits of the factory's process terms for the print type × flute (legacy `find_pattern_type`). */
export interface RscLimits {
  plRscMinIn: number;
  plRscMaxIn: number;
  pwRscMinIn: number;
  pwRscMaxIn: number;
  minRscFlapMm: number;
  minRscSlhMm: number;
  minSllMm: number;
  minSlwMm: number;
}

/**
 * A pattern-19 (`rsc`) blank inside the RSC limits is made as RSC (slotted, no die); every other blank is a
 * die-cut box (`:614-627`). SLL / SLW are the box length / width plus the flute's `a` (LOC-791).
 */
export function isRsc(
  formula: CorrugateFormula,
  part: Blank,
  flute: FluteFactors,
  limits: RscLimits,
): boolean {
  const dlIn = part.dl / 25.4;
  const dwIn = part.dw / 25.4;
  const sll = part.l + flute.a;
  const slw = part.w + flute.a;
  return (
    formula === 'rsc' &&
    dlIn >= limits.plRscMinIn &&
    dlIn <= limits.plRscMaxIn &&
    dwIn >= limits.pwRscMinIn &&
    dwIn <= limits.pwRscMaxIn &&
    (part.flap ?? 0) >= limits.minRscFlapMm &&
    (part.slh ?? 0) >= limits.minRscSlhMm &&
    sll >= limits.minSllMm &&
    slw >= limits.minSlwMm
  );
}

// ------------------------------------------------------------------------------------------------
// Print area % (`calculate_percent_from_pattern_area:1798-1954`)
// ------------------------------------------------------------------------------------------------

/** Where a colour prints (legacy pattern areas 36 top, 37 side, 38 top + side, 39 all round). */
export type PrintArea = 'top' | 'side' | 'top_side' | 'all_round';

export interface PrintAreaTerms {
  /** Legacy `corrugate_cal_pattern_area_percent_type` (0, 1, 2): which side-area formulas apply. */
  method: number;
  /** Legacy factory 4: its own top + side formulas (`:1901-1934`). */
  topSideCombined: boolean;
}

interface AreaData {
  formula: CorrugateFormula;
  W: number;
  L: number;
  D: number;
  dW: number;
  dL: number;
  a: number;
  c: number;
  dd: number;
  fh: number;
  i: number;
  method: number;
}

const isTele = (f: CorrugateFormula) => f === 'tele_body' || f === 'tele_lid';

/**
 * `top:1812-1844`. Legacy returns nothing for a pattern without a case (e.g. 38 `tray`), which PHP divides
 * as 0 (the colour then prints on 0 %); kept.
 */
function top(x: AreaData): number {
  const { W, L, D, a, c, fh } = x;
  switch (x.formula) {
    case 'rsc':
    case 'tele_body':
    case 'tele_lid':
      return ((W / 2 + c) * ((L + a) * 2 + (W + a) * 2 - 3)) / 1000000;
    case 'single_tuck':
      return ((L + a) * W) / 1000000;
    case 'double_tuck':
    case 'double_tuck_side_wall':
      return ((L + a) * (W + fh + a + 1)) / 1000000;
    case 'double_tuck_top_wall':
      return ((L + a) * (W + fh + a + 1) + (W - fh) * L) / 1000000;
    case 'flat_sheet':
      return (x.dL * x.dW) / 1000000;
    case 'seafood':
      // Legacy `(($L+$a) * $W+$a) / 1000000`: the `+ a` is outside the product (operator precedence), kept.
      return ((L + a) * W + a) / 1000000;
    case 'open_top':
      return ((x.i + W) * (L + a + c + c)) / 1000000;
    case 'handle':
      return ((25 + 30 + W / 2) * (L + a + (W + a) + (L + a) + (W + a - 3))) / 1000000;
    case 'handle_rim':
      return ((25 + 30 + (20 + a) + W / 2) * (L + a + (W + a) + (L + a) + (W + a - 3))) / 1000000;
    case 'slide_tray':
      return 0;
    case 'slide_sleeve':
      return (D * (L + a)) / 1000000;
    case 'full_overlap':
      return ((W + c) * ((L + a) * 2 + (W + a) * 2 - 3)) / 1000000;
    case 'tray':
      return 0;
  }
}

/** `side:1846-1896`; a method without a branch returns nothing (0 %). */
function side(x: AreaData): number {
  const { W, L, D, a, c, dd, fh } = x;
  switch (x.formula) {
    case 'rsc':
    case 'full_overlap':
      return ((D + dd) * ((L + a) * 2 + (W + a) * 2 - 3)) / 1000000;
    case 'single_tuck':
    case 'seafood':
      if (x.method === 1) return ((D * 2 + c * 2 + L + a) * (D + a + (W + c + 2 * fh) + (D + a))) / 1000000;
      if (x.method === 2) return ((D + a) * (L + a) * 2 + (D + c) * (W + c) * 2) / 1000000;
      return 0;
    case 'double_tuck':
      if (x.method === 1) {
        return (
          ((D + a) * (L + a) +
            (D + a + 1 + (L + 6 * fh + a - 1) + (D + a + 1)) * (D + a + 1 + (W + a + 1) + (D + a - 1))) /
          1000000
        );
      }
      if (x.method === 2) return ((D + a) * (L + a) * 3 + (D + a + 1) * (W + a + 1) * 2) / 1000000;
      return 0;
    case 'double_tuck_top_wall':
      if (x.method === 1) {
        return (
          ((D + c + fh + fh) * (L + 6 * fh + a - 1) +
            (D + a + fh + 1 + (W + a + 1) + (D + a)) *
              (D + a + 1 + fh + (L + 6 * fh + a - 1) + (D + a + 1 + fh))) /
          1000000
        );
      }
      if (x.method === 2) return ((D + a) * (L + a) * 3 + (D + a + 1) * (W + a + 1) * 2) / 1000000;
      return 0;
    case 'double_tuck_side_wall':
      if (x.method === 1) {
        return (
          ((D + a) * (L + a) +
            (D + a + 1 + (L + 6 * fh + a - 1) + (D + a + 1)) *
              (D + a + 1 + (L + 6 * fh + a - 1) + (D + a + 1))) /
          1000000
        );
      }
      if (x.method === 2) return ((D + a) * (L + a) * 3 + (D + a + 1) * (W + a + 1) * 2) / 1000000;
      return 0;
    case 'flat_sheet':
      return (x.dL * x.dW) / 1000000;
    case 'open_top':
    case 'handle':
    case 'handle_rim':
      return ((D + a) * (L + a + (W + a) + (L + a) + (W + a - 3))) / 1000000;
    case 'tele_body':
    case 'tele_lid':
      return ((D + a) * ((L + a) * 2 + (W + a) * 2 - 3)) / 1000000;
    case 'slide_tray':
      return ((D + W + a + D) * (fh + a + D + (2 * fh + c) * 2 + L + D + (fh + a))) / 1000000;
    case 'slide_sleeve':
      return (D * (W + a) * 2) / 1000000;
    case 'tray':
      return 0;
  }
}

/** `top_side:1898-1936`. */
function topSide(x: AreaData, terms: PrintAreaTerms): number {
  const { W, L, D, a, c, fh } = x;
  if (x.formula === 'flat_sheet') return (x.dL * x.dW) / 1000000;
  if (!terms.topSideCombined || ['rsc', 'seafood', 'full_overlap'].includes(x.formula) || isTele(x.formula)) {
    return top(x) + side(x);
  }
  // Legacy factory 4's own formulas (method 1 only where legacy has no other branch).
  switch (x.formula) {
    case 'single_tuck':
      return x.method === 1
        ? ((D * 2 + c * 2 + L + a) * (W + (D + a) + (W + c + 2 * fh) + (D + a))) / 1000000
        : 0;
    case 'double_tuck':
      return x.method === 1
        ? ((D + a + 1 + (L + 6 * fh + a - 1) + (D + a + 1)) *
            (D + c + fh + (W + fh + a + 1) + (D + a + 1) + (W + a + 1) + (D + a - 1))) /
            1000000
        : 0;
    case 'double_tuck_top_wall':
      return x.method === 1
        ? ((D + a + 1 + fh + (L + 6 * fh + a - 1) + (D + a + 1 + fh)) *
            (D + c + fh + fh + (W + fh + a + 1) + (D + a + fh + 1) + (W + a + 1) + (D + a) + (W - fh))) /
            1000000
        : 0;
    case 'double_tuck_side_wall':
      return x.method === 1
        ? ((D + a + 1 + (L + 6 * fh + a - 1) + (D + a + 1)) *
            (D + c + fh + (W + 2 * fh + a + 1) + (D + a + 1) + (W + a + fh + 1) + (D + a - 1))) /
            1000000
        : 0;
    case 'open_top':
      return ((x.i + W + a + (D + a)) * (L + a + (W + a) + (L + a) + (W + a - 3))) / 1000000;
    case 'handle':
      return ((25 + 30 + W / 2 + (D + a)) * (L + a + (W + a) + (L + a) + (W + a - 3))) / 1000000;
    case 'handle_rim':
      return ((25 + 30 + (20 + a) + W / 2 + (D + a)) * (L + a + (W + a) + (L + a) + (W + a - 3))) / 1000000;
    case 'slide_tray':
      return ((D + W + a + D) * (fh + a + D + (2 * fh + c) * 2 + L + D + (fh + a))) / 1000000;
    case 'slide_sleeve':
      return ((W + a + (L + a) + (W + a - 3)) * D) / 1000000;
    default:
      return 0; // legacy 38 `tray`: no branch
  }
}

/** `allArea:1938-1954`. */
function allRound(x: AreaData): number {
  const { W, L, D, a } = x;
  if (x.formula === 'rsc' || x.formula === 'full_overlap' || isTele(x.formula)) {
    return (x.dW * ((L + a) * 2 + (W + a) * 2 - 3)) / 1000000;
  }
  if (x.formula === 'open_top' || x.formula === 'handle' || x.formula === 'handle_rim') {
    return (x.dW * (L + a + (W + a) + (L + a) + (W + a - 3))) / 1000000;
  }
  if (x.formula === 'slide_sleeve') {
    return ((L + a + (W + a) + (L + a) + (W + a - 3)) * D) / 1000000;
  }
  return (x.dL * x.dW) / 1000000;
}

/**
 * The % of the blank a colour covers when it prints on `area` (`:1798-1810`): the printed area over the
 * whole blank (factory adjustment included, unrounded), × 100.
 */
export function printAreaPercent(
  formula: CorrugateFormula,
  part: Blank,
  flute: FluteFactors,
  area: PrintArea,
  terms: PrintAreaTerms,
): number {
  const x: AreaData = {
    formula,
    W: part.w,
    L: part.l,
    D: part.d,
    dW: part.dw,
    dL: part.dl,
    a: flute.a,
    c: flute.c,
    dd: flute.dd,
    fh: flute.fh,
    i: part.i,
    method: terms.method,
  };
  const printed =
    area === 'top'
      ? top(x)
      : area === 'side'
        ? side(x)
        : area === 'top_side'
          ? topSide(x, terms)
          : allRound(x);
  const areaSqm = (part.dl * part.dw) / 1000000;
  return (printed / areaSqm) * 100;
}
