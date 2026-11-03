import { DomainException } from '@common/errors/domain.exception';

import { type AutoCell } from './pnl-auto';
import { applyEdit, calculatedCell, type CellEdit, mergeAuto, type StoredCell } from './pnl-cell-rules';
import { D, fmt } from './pnl-engine';
import { PNL_LINE_BY_KEY, type PnlLineKey } from './pnl-lines';

const line = (key: PnlLineKey) => PNL_LINE_BY_KEY.get(key)!;
const cell = (over: Partial<StoredCell> = {}): StoredCell => ({
  value: null,
  mode: 'manual',
  autoValue: null,
  source: 'none',
  sourceRef: null,
  note: null,
  ...over,
});
const auto = (value: string | null): AutoCell => ({
  value: value === null ? null : D(value),
  source: value === null ? 'none' : 'gl',
  sourceRef: null,
});
const codeOf = (f: () => unknown) => {
  try {
    f();
    return undefined;
  } catch (e) {
    return (e as DomainException).code;
  }
};
const view = (c: StoredCell) => ({
  value: fmt(c.value),
  mode: c.mode,
  autoValue: fmt(c.autoValue),
  note: c.note,
});

describe('P&L manual input rules (D-472)', () => {
  describe('manual lines (no system data)', () => {
    const empty = cell();
    it('requires a note on the first entry', () => {
      expect(codeOf(() => applyEdit(line('salaries'), empty, { value: '250000.00' }))).toBe(
        'pnl.note_required',
      );
      expect(codeOf(() => applyEdit(line('salaries'), empty, { value: '250000.00', note: ' x ' }))).toBe(
        'pnl.note_required',
      );
      expect(view(applyEdit(line('salaries'), empty, { value: '250000.00', note: '5 คน × 50,000' }))).toEqual(
        {
          value: '250000.00',
          mode: 'manual',
          autoValue: null,
          note: '5 คน × 50,000',
        },
      );
    });

    it('keeps the note on later edits unless a new one is given, and clears with null', () => {
      const first = applyEdit(line('salaries'), empty, { value: '250000.00', note: '5 คน × 50,000' });
      expect(applyEdit(line('salaries'), first, { value: '260000' }).note).toBe('5 คน × 50,000');
      expect(applyEdit(line('salaries'), first, { value: '260000', note: 'ขึ้นเงินเดือน' }).note).toBe(
        'ขึ้นเงินเดือน',
      );
      expect(view(applyEdit(line('salaries'), first, { value: null }))).toMatchObject({
        value: null,
        mode: 'manual',
      });
    });

    it('refuses money that is not a 2-place decimal string', () => {
      for (const value of ['1.234', 'abc', '1e5', '1234567890123.00'])
        expect([value, codeOf(() => applyEdit(line('salaries'), empty, { value, note: 'note' }))]).toEqual([
          value,
          'validation.failed',
        ]);
    });
  });

  describe('overrides of auto values', () => {
    const a = cell({ value: D('100000'), mode: 'auto', autoValue: D('100000'), source: 'gl' });
    it('needs a reason and keeps the auto value beside the override', () => {
      expect(codeOf(() => applyEdit(line('marketing'), a, { value: '120000' }))).toBe('pnl.reason_required');
      const o = applyEdit(line('marketing'), a, { value: '120000', note: 'งานแสดงสินค้า' });
      expect(view(o)).toEqual({
        value: '120000.00',
        mode: 'override',
        autoValue: '100000.00',
        note: 'งานแสดงสินค้า',
      });
      // A new overriding value needs a reason again.
      expect(codeOf(() => applyEdit(line('marketing'), o, { value: '130000' }))).toBe('pnl.reason_required');
      expect(applyEdit(line('marketing'), o, { value: '120000.00' })).toBe(o);
    });

    it('returns to auto with null or the auto value itself', () => {
      const o = applyEdit(line('marketing'), a, { value: '120000', note: 'งานแสดงสินค้า' });
      expect(view(applyEdit(line('marketing'), o, { value: null }))).toEqual({
        value: '100000.00',
        mode: 'auto',
        autoValue: '100000.00',
        note: null,
      });
      expect(applyEdit(line('marketing'), o, { value: '100000.00' }).mode).toBe('auto');
    });
  });

  it('refuses edits of formula and memo lines', () => {
    const edit: CellEdit = { value: '1', note: 'note' };
    for (const key of [
      'net_revenue',
      'gross_margin',
      'ebit',
      'cit_estimate',
      'net_profit',
      'memo_dso',
      'memo_ebitda',
    ] as const)
      expect([key, codeOf(() => applyEdit(line(key), cell(), edit))]).toEqual([key, 'pnl.line_read_only']);
  });

  describe('recompute keeps people’s values', () => {
    it('fills new and auto cells from the system; no data → manual (editable) or empty auto (memo)', () => {
      expect(view(mergeAuto(line('marketing'), null, auto('5000')))).toMatchObject({
        value: '5000.00',
        mode: 'auto',
      });
      expect(view(mergeAuto(line('salaries'), null, auto(null)))).toMatchObject({
        value: null,
        mode: 'manual',
      });
      expect(view(mergeAuto(line('memo_dso'), null, auto(null)))).toMatchObject({
        value: null,
        mode: 'auto',
      });
      const was = cell({ value: D('5000'), mode: 'auto', autoValue: D('5000') });
      expect(view(mergeAuto(line('marketing'), was, auto('6000')))).toMatchObject({
        value: '6000.00',
        mode: 'auto',
      });
    });

    it('turns a manual value into an override when the line gains system data, its note becoming the reason', () => {
      const manual = cell({ value: D('250000'), note: 'ประมาณการ' });
      expect(view(mergeAuto(line('salaries'), manual, auto('240000')))).toEqual({
        value: '250000.00',
        mode: 'override',
        autoValue: '240000.00',
        note: 'ประมาณการ',
      });
      expect(view(mergeAuto(line('salaries'), manual, auto(null)))).toMatchObject({
        value: '250000.00',
        mode: 'manual',
      });
    });

    it('keeps an override with the new auto value, and drops to manual when the data disappears', () => {
      const o = cell({ value: D('120000'), mode: 'override', autoValue: D('100000'), note: 'งาน' });
      expect(view(mergeAuto(line('marketing'), o, auto('110000')))).toEqual({
        value: '120000.00',
        mode: 'override',
        autoValue: '110000.00',
        note: 'งาน',
      });
      expect(view(mergeAuto(line('marketing'), o, auto('120000')))).toMatchObject({
        mode: 'auto',
        note: null,
      });
      expect(view(mergeAuto(line('marketing'), o, auto(null)))).toMatchObject({
        value: '120000.00',
        mode: 'manual',
      });
    });
  });

  it('rounds formula cells half-up to the satang', () => {
    expect(view(calculatedCell(D('10.005')))).toMatchObject({ value: '10.01', mode: 'calculated' });
    expect(calculatedCell(null).value).toBeNull();
  });
});
