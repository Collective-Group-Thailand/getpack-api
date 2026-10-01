import ExcelJS from 'exceljs';

import { REPORTS } from './definitions';
import { periodRange, resolveFilters } from './report-filters';
import { formatTimeOfDay, nextRunAt, parseTimeOfDay } from './report-schedule';
import { GROUP_OF, isTotalled } from './report-types';
import { type ReportFilter, type ReportRow } from './report-types';
import { csvCell, writeReport } from './report-writer';

/** 2026-10-15 (Thursday) 10:00 in Bangkok. */
const NOW = new Date('2026-10-15T03:00:00Z');
const def = (filters: ReportFilter[]) => ({ filters });

describe('report filters (B6.2)', () => {
  it('resolves relative periods in Asia/Bangkok', () => {
    expect(periodRange('previous_day', NOW)).toEqual({ from: '2026-10-14', to: '2026-10-14' });
    expect(periodRange('previous_week', NOW)).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(periodRange('previous_month', NOW)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(periodRange('month_to_date', NOW)).toEqual({ from: '2026-10-01', to: '2026-10-15' });
    expect(periodRange('year_to_date', NOW)).toEqual({ from: '2026-01-01', to: '2026-10-15' });
    // 23:30 on 1 Jan in Bangkok: last month is December.
    expect(periodRange('previous_month', new Date('2027-01-01T16:30:00Z'))).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    });
    expect(periodRange('previous_week', new Date('2026-10-18T16:59:00Z'))).toEqual({
      from: '2026-10-05',
      to: '2026-10-11',
    });
  });

  it('takes explicit dates or a period for each kind of date filter', () => {
    const range = def([{ key: 'period', kind: 'range', required: true }]);
    expect(resolveFilters(range, { from: '2026-10-01', to: '2026-10-31' }, NOW)).toEqual({
      filters: { from: '2026-10-01', to: '2026-10-31' },
      errors: [],
    });
    expect(resolveFilters(range, { period: 'previous_month' }, NOW).filters).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(
      resolveFilters(def([{ key: 'period', kind: 'as_of', required: true }]), { period: 'previous_day' }, NOW)
        .filters,
    ).toEqual({ asOf: '2026-10-14' });
    expect(
      resolveFilters(
        def([{ key: 'period', kind: 'month', required: true }]),
        { period: 'previous_month' },
        NOW,
      ).filters,
    ).toEqual({ month: '2026-09' });
  });

  it('reports every invalid, missing or unknown filter', () => {
    const d = def([
      { key: 'period', kind: 'range', required: true },
      { key: 'channel', kind: 'enum', required: false, values: ['web', 'cs'] },
      { key: 'productTypeId', kind: 'uuid', required: false },
    ]);
    const codes = (raw: Record<string, unknown>) =>
      resolveFilters(d, raw, NOW).errors.map((e) => `${e.path}:${e.code}`);
    expect(codes({})).toEqual(['from:required']);
    expect(codes({ from: '2026-10-31', to: '2026-10-01' })).toEqual(['to:range']);
    expect(codes({ from: '2025-01-01', to: '2026-10-01' })).toEqual(['to:range']);
    expect(codes({ from: '2026-02-30', to: '2026-10-01' })).toEqual(['from:pattern']);
    expect(
      codes({ from: '1 Oct', to: '2026-10-01', channel: 'fax', productTypeId: 'x', asOf: '2026-10-01' }),
    ).toEqual(['from:pattern', 'channel:enum', 'productTypeId:format', 'asOf:unknown']);
    expect(codes({ period: 'last_quarter' })).toEqual(['period:enum', 'from:required']);
  });
});

describe('report schedules (B6.2)', () => {
  const daily = { frequency: 'daily' as const, runAtMinute: 7 * 60, dayOfWeek: null, dayOfMonth: null };
  it('finds the next run strictly after now, in Asia/Bangkok', () => {
    expect(nextRunAt(daily, NOW).toISOString()).toBe('2026-10-16T00:00:00.000Z'); // 07:00 tomorrow
    expect(nextRunAt({ ...daily, runAtMinute: 11 * 60 }, NOW).toISOString()).toBe('2026-10-15T04:00:00.000Z'); // 11:00 today
    expect(nextRunAt({ ...daily, runAtMinute: 10 * 60 }, NOW).toISOString()).toBe('2026-10-16T03:00:00.000Z'); // exactly now → tomorrow
    const monday = { frequency: 'weekly' as const, runAtMinute: 7 * 60, dayOfWeek: 1, dayOfMonth: null };
    expect(nextRunAt(monday, NOW).toISOString()).toBe('2026-10-19T00:00:00.000Z');
    expect(nextRunAt({ ...monday, dayOfWeek: 4, runAtMinute: 12 * 60 }, NOW).toISOString()).toBe(
      '2026-10-15T05:00:00.000Z',
    ); // today, later
    expect(nextRunAt({ ...monday, dayOfWeek: 4 }, NOW).toISOString()).toBe('2026-10-22T00:00:00.000Z'); // today, passed
    const monthly = { frequency: 'monthly' as const, runAtMinute: 6 * 60, dayOfWeek: null, dayOfMonth: 1 };
    expect(nextRunAt(monthly, NOW).toISOString()).toBe('2026-10-31T23:00:00.000Z'); // 1 Nov 06:00
    expect(nextRunAt({ ...monthly, dayOfMonth: 28 }, NOW).toISOString()).toBe('2026-10-27T23:00:00.000Z');
    expect(nextRunAt(monthly, new Date('2026-12-15T00:00:00Z')).toISOString()).toBe(
      '2026-12-31T23:00:00.000Z',
    ); // 1 Jan
  });

  it('parses and formats times of day', () => {
    expect(parseTimeOfDay('07:05')).toBe(425);
    expect(parseTimeOfDay('24:00')).toBeNull();
    expect(formatTimeOfDay(425)).toBe('07:05');
  });
});

describe('report writer (B6.2)', () => {
  const report = {
    key: 'test',
    nameTh: 'ทดสอบ',
    nameEn: 'Test',
    columns: [
      { key: 'name', labelTh: 'ชื่อ', labelEn: 'Name', type: 'text' as const },
      { key: 'amount', labelTh: 'ยอด', labelEn: 'Amount', type: 'money' as const },
      { key: 'qty', labelTh: 'จำนวน', labelEn: 'Qty', type: 'integer' as const },
    ],
  };
  async function* rows(): AsyncGenerator<ReportRow> {
    await Promise.resolve();
    yield { name: 'บริษัท ทดสอบ (fake)', amount: '-1234.50', qty: 3 };
    yield { name: '=HYPERLINK("http://x")', amount: null, qty: null };
  }

  it('neutralises formulas in text but keeps negative numbers', () => {
    expect(csvCell(report.columns[0]!, '=1+1')).toBe(`"'=1+1"`);
    expect(csvCell(report.columns[0]!, '-5')).toBe(`"'-5"`);
    expect(csvCell(report.columns[1]!, '-5.00')).toBe('"-5.00"');
    expect(csvCell(report.columns[0]!, 'say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(report.columns[1]!, null)).toBe('');
  });

  it('writes a UTF-8 CSV with a BOM and bilingual headers', async () => {
    const out = await writeReport(report, rows(), 'csv', { filters: {}, generatedAt: NOW });
    const text = out.body.toString('utf8');
    expect(text.startsWith('﻿"Name / ชื่อ","Amount / ยอด","Qty / จำนวน"\r\n')).toBe(true);
    expect(text).toContain('"บริษัท ทดสอบ (fake)","-1234.50","3"\r\n');
    expect(text).toContain(`"'=HYPERLINK(""http://x"")",,\r\n`);
    expect(out).toMatchObject({ rowCount: 2, extension: 'csv' });
  });

  it('streams an XLSX with typed numbers and an About sheet', async () => {
    const out = await writeReport(report, rows(), 'xlsx', {
      filters: { from: '2026-10-01', to: '2026-10-31' },
      generatedAt: NOW,
    });
    expect(out.rowCount).toBe(2);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out.body as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Report', 'About']);
    const ws = wb.getWorksheet('Report')!;
    expect(ws.getRow(1).getCell(1).value).toBe('Name / ชื่อ');
    expect(ws.getRow(2).getCell(2).value).toBe(-1234.5);
    expect(ws.getRow(3).getCell(1).value).toBe(`'=HYPERLINK("http://x")`);
    const about = wb.getWorksheet('About')!;
    expect(about.getRow(3).values).toEqual([undefined, 'Filter: from', '2026-10-01']);
  });
});

describe('report totals and groups (U-B0.3)', () => {
  it('adds up money and counts unless a column opts out, never text, dates or percentages', () => {
    expect(isTotalled({ key: 'gross', labelTh: '', labelEn: '', type: 'money' })).toBe(true);
    expect(isTotalled({ key: 'quantity', labelTh: '', labelEn: '', type: 'integer' })).toBe(true);
    expect(isTotalled({ key: 'seq', labelTh: '', labelEn: '', type: 'integer', total: false })).toBe(false);
    expect(isTotalled({ key: 'rate', labelTh: '', labelEn: '', type: 'percent' })).toBe(false);
    for (const r of REPORTS) expect(GROUP_OF[r.key]).toBeDefined();
  });
});
