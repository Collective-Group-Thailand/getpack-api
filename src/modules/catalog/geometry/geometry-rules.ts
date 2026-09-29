import { CORRUGATE_CONDITION_DETERMINANTS } from '@modules/pricing/calculators/corrugate/formulas';
import { FOLDING_DETERMINANTS, FOLDING_SLOTS } from '@modules/pricing/calculators/folding/geometry/types';

import { type GeometryDeterminantValue, type GeometrySlotValue } from './geometry.dto';

/**
 * What the calculators need of geometry data, checked when it is edited so a pattern never reaches a quote with
 * data its calculator refuses. Pure.
 */

export interface RuleViolation {
  path: string;
  code: string;
  message: string;
}

const violation = (path: string, code: string, message: string): RuleViolation => ({ path, code, message });

/** Bands: `lower ≤ upper`, inclusive bounds never overlapping (`ex_geometry_bands__no_overlap`). */
export function bandViolation(bands: readonly { lower: number; upper: number }[]): RuleViolation | null {
  for (const [i, b] of bands.entries()) {
    if (b.lower > b.upper) return violation(`bands[${i}].upper`, 'range', 'upper must be at least lower');
    const j = bands.findIndex((o, k) => k < i && o.lower <= b.upper && b.lower <= o.upper);
    if (j >= 0)
      return violation(`bands[${i}]`, 'overlap', `the band overlaps bands[${j}] (bounds are inclusive)`);
  }
  return null;
}

const CORRUGATE_SLOTS = Object.keys(CORRUGATE_CONDITION_DETERMINANTS) as GeometrySlotValue[];
const isFoldingSlot = (slot: GeometrySlotValue) => (FOLDING_SLOTS as readonly string[]).includes(slot);
const isCorrugateSlot = (slot: GeometrySlotValue) => CORRUGATE_SLOTS.includes(slot);

/**
 * One slot of a pattern: a folding slot is read by a folding dimension (the folding loader skips others) and may
 * belong to a part; a corrugate slot is read by its own dimension (`i k m` by W, `j` by W ÷ L — the corrugate
 * loader refuses others) and belongs to the pattern. A pattern of a type with a calculator takes that
 * calculator's slots only.
 */
export function slotViolation(
  path: string,
  slot: { slot: GeometrySlotValue; determinant: GeometryDeterminantValue; onPart: boolean },
  calculator: string | null,
): RuleViolation | null {
  if (isCorrugateSlot(slot.slot)) {
    if (calculator === 'folding')
      return violation(`${path}.slot`, 'in', 'a folding pattern takes folding slots');
    if (slot.onPart)
      return violation(`${path}.subPatternId`, 'invalid', 'corrugate slots belong to the pattern');
    const expected =
      CORRUGATE_CONDITION_DETERMINANTS[slot.slot as keyof typeof CORRUGATE_CONDITION_DETERMINANTS];
    if (slot.determinant !== expected) {
      return violation(`${path}.conditionId`, 'determinant', `slot ${slot.slot} is read by ${expected}`);
    }
    return null;
  }
  if (isFoldingSlot(slot.slot)) {
    if (calculator === 'corrugate') {
      return violation(`${path}.slot`, 'in', 'a corrugate pattern takes the slots i, j, k, m');
    }
    if (!(FOLDING_DETERMINANTS as readonly string[]).includes(slot.determinant)) {
      return violation(`${path}.conditionId`, 'determinant', `slot ${slot.slot} is read by w, l, d, x or c`);
    }
  }
  return null;
}
