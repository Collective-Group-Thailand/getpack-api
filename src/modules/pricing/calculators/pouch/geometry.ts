import { PricingError } from '../shared/pricing-error';

/**
 * Pouch geometry (U-B6 pouch): legacy `PouchCalculator::calculateDimension:557-581`. `dl` is the film **across** the
 * web, `dw` the advance per pouch **along** it, both mm; the factory's allowance `t` is added across. The film is
 * priced at least `min_dl` wide (`cal_dl`), and the minimum-order band is read on that area. Pure.
 */

export const POUCH_FORMULAS = [
  'three_side_seal',
  'pillow_center_seal',
  'center_seal_gusset',
  'quad_seal',
  'stand_up',
] as const;
export type PouchFormula = (typeof POUCH_FORMULAS)[number];

/** W × L and, per shape, the bottom gusset `b`, side gusset `s` and centre seal `cs`, mm (seals included). */
export interface PouchSize {
  w: number;
  l: number;
  b?: number;
  s?: number;
  cs?: number;
}

/** The size parts each shape reads (legacy `pattern.required_b / s / cs`, port map §2.2). */
export const POUCH_FORMULA_NEEDS: Readonly<Record<PouchFormula, readonly ('b' | 's' | 'cs')[]>> = {
  three_side_seal: [],
  pillow_center_seal: ['cs'],
  center_seal_gusset: ['s', 'cs'],
  quad_seal: ['s'],
  stand_up: ['b'],
};

export interface PouchDimension {
  dl: number;
  dw: number;
  sqcm: number;
  calDl: number;
  calSqcm: number;
}

export function pouchDimension(
  formula: PouchFormula,
  size: PouchSize,
  terms: { toleranceMm: number; minDlMm: number },
): PouchDimension {
  const need = (key: 'b' | 's' | 'cs'): number => {
    const value = size[key];
    if (value === undefined)
      throw new PricingError('process_not_possible', `the ${formula} pouch needs ${key}`);
    return value;
  };
  const { w, l } = size;
  const t = terms.toleranceMm;
  let dl: number;
  let dw: number;
  switch (formula) {
    case 'three_side_seal': // pattern 40
      dl = l + l + t;
      dw = w;
      break;
    case 'pillow_center_seal': // 41
      dl = 2 * w + 2 * need('cs') + t;
      dw = l;
      break;
    case 'center_seal_gusset': // 42
      dl = 2 * w + 2 * need('s') + 2 * need('cs') + t;
      dw = l;
      break;
    case 'quad_seal': // 43
      dl = 2 * w + 2 * need('s') + t;
      dw = l;
      break;
    case 'stand_up': // 44
      dl = l + need('b') + l + t;
      dw = w;
      break;
  }
  const sqcm = (dl * dw) / 100;
  const calDl = Math.max(dl, terms.minDlMm);
  const calSqcm = (calDl * dw) / 100;
  return { dl, dw, sqcm, calDl, calSqcm };
}
