import { DomainException } from '@common/errors/domain.exception';
import { MoneyDecimal, type MoneyValue, parseMoney } from '@common/money/money';

import { type AutoCell, type AutoSource } from './pnl-auto';
import { type PnlLineDef } from './pnl-lines';

/**
 * D-472 manual input rules (PLAN A-14), pure:
 * - a line with no system data is `manual` — its first value needs a note; later edits keep the note unless a new
 *   one is given;
 * - changing a value the system computed is an `override` — the auto value stays beside it and a reason is required
 *   every time the overriding value changes; entering the auto value again (or `null`) returns the cell to `auto`;
 * - formula and memo lines are read-only;
 * - recomputing never loses a person's value: a manual value whose line gains system data becomes an override with
 *   its note as the reason; an override whose system data disappears becomes manual.
 */

export type CellMode = 'auto' | 'calculated' | 'manual' | 'override';

export interface StoredCell {
  value: MoneyValue | null;
  mode: CellMode;
  autoValue: MoneyValue | null;
  source: AutoSource;
  sourceRef: Record<string, unknown> | null;
  note: string | null;
}

export interface CellEdit {
  /** Decimal string (2 places at most) or null (revert an override / clear a manual value). */
  value: string | null;
  note?: string | null;
}

export const NOTE_MIN = 3;
export const NOTE_MAX = 1000;

const same = (a: MoneyValue | null, b: MoneyValue | null) => (a === null || b === null ? a === b : a.eq(b));

const cleanNote = (note: string | null | undefined): string | null => {
  const t = note?.trim() ?? '';
  return t.length === 0 ? null : t;
};

function requireNote(note: string | null, code: 'pnl.note_required' | 'pnl.reason_required'): string {
  if (note === null || note.length < NOTE_MIN)
    throw new DomainException(code, {
      errors: [{ path: 'note', code: 'required', message: `at least ${NOTE_MIN} characters` }],
    });
  return note;
}

/** The cell after a person's edit (or the same cell when nothing changes). */
export function applyEdit(line: PnlLineDef, cell: StoredCell, edit: CellEdit): StoredCell {
  if (!line.editable) throw new DomainException('pnl.line_read_only');
  const note = cleanNote(edit.note);
  if (note !== null && note.length > NOTE_MAX)
    throw new DomainException('validation.failed', {
      errors: [{ path: 'note', code: 'max_length', message: `at most ${NOTE_MAX} characters` }],
    });
  let value: MoneyValue | null = null;
  if (edit.value !== null) {
    try {
      value = parseMoney(edit.value);
    } catch {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'value', code: 'money', message: 'a decimal string with at most 2 places' }],
      });
    }
  }
  const hasSystemData = cell.autoValue !== null;
  if (hasSystemData) {
    // Back to the system's value: `null` or the auto value itself.
    if (value === null || same(value, cell.autoValue))
      return { ...cell, value: cell.autoValue, mode: 'auto', note: null };
    if (cell.mode === 'override' && same(value, cell.value) && note === null) return cell;
    return { ...cell, value, mode: 'override', note: requireNote(note, 'pnl.reason_required') };
  }
  // No system data: manual.
  if (value === null) return { ...cell, value: null, mode: 'manual', note: note ?? cell.note };
  const firstEntry = cell.value === null && cell.note === null;
  return {
    ...cell,
    value,
    mode: 'manual',
    note: firstEntry ? requireNote(note, 'pnl.note_required') : (note ?? cell.note),
  };
}

/** A source cell after the system recomputed its auto value; people's values are kept. */
export function mergeAuto(line: PnlLineDef, stored: StoredCell | null, auto: AutoCell): StoredCell {
  const base = { autoValue: auto.value, source: auto.source, sourceRef: auto.sourceRef };
  if (!line.editable || stored === null || stored.mode === 'auto' || stored.mode === 'calculated') {
    // Read-only memo lines with no data stay "auto" and empty: nothing for a person to fill.
    const mode: CellMode = auto.value !== null || !line.editable ? 'auto' : 'manual';
    return { ...base, value: auto.value, mode, note: null };
  }
  if (stored.value === null) {
    // An empty manual cell follows the system when it gains data.
    return auto.value === null
      ? { ...base, value: null, mode: 'manual', note: stored.note }
      : { ...base, value: auto.value, mode: 'auto', note: null };
  }
  if (auto.value === null) return { ...base, value: stored.value, mode: 'manual', note: stored.note };
  if (same(stored.value, auto.value)) return { ...base, value: auto.value, mode: 'auto', note: null };
  return { ...base, value: stored.value, mode: 'override', note: stored.note };
}

/** A formula cell. */
export function calculatedCell(value: MoneyValue | null): StoredCell {
  const rounded = value === null ? null : value.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
  return {
    value: rounded,
    mode: 'calculated',
    autoValue: rounded,
    source: 'formula',
    sourceRef: null,
    note: null,
  };
}
