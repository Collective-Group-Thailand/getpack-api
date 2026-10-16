import { PassThrough } from 'node:stream';

import ExcelJS from 'exceljs';

import {
  type Cell,
  type ReportColumn,
  type ReportDefinition,
  type ReportRow,
  type ResolvedFilters,
} from './report-types';

export interface WrittenReport {
  body: Buffer;
  rowCount: number;
  mimeType: string;
  extension: 'xlsx' | 'csv';
}

/** UTF-8 byte-order mark: Excel opens the CSV as UTF-8 (Thai text). */
const BOM = String.fromCharCode(0xfeff);
const NUMERIC = new Set<ReportColumn['type']>(['integer', 'money', 'decimal', 'percent']);
const NUMBER_FORMAT: Partial<Record<ReportColumn['type'], string>> = {
  money: '#,##0.00',
  decimal: '#,##0.00',
  percent: '0.00',
  integer: '#,##0',
};

/** Neutralises spreadsheet formulas in text (CSV / formula injection) — numbers are written as numbers. */
export function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function xlsxValue(column: ReportColumn, value: Cell): Cell {
  if (value === null) return null;
  if (NUMERIC.has(column.type)) return Number(value);
  return typeof value === 'string' ? safeText(value) : value;
}

export function csvCell(column: ReportColumn, value: Cell): string {
  if (value === null) return '';
  const text = NUMERIC.has(column.type) || typeof value !== 'string' ? String(value) : safeText(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Streams the rows of a report into an XLSX (exceljs streaming writer, rows committed as they come) or a UTF-8 CSV
 * with a BOM (Thai text opens correctly in Excel). Headers are bilingual; an `About` sheet / trailer records the
 * report, its filters and when it was generated.
 */
export async function writeReport(
  def: Pick<ReportDefinition, 'key' | 'nameTh' | 'nameEn' | 'columns'>,
  rows: AsyncIterable<ReportRow>,
  format: 'xlsx' | 'csv',
  meta: { filters: ResolvedFilters; generatedAt: Date },
): Promise<WrittenReport> {
  const header = def.columns.map((c) => `${c.labelEn} / ${c.labelTh}`);
  if (format === 'csv') {
    const chunks: string[] = [BOM, header.map((h) => `"${h.replace(/"/g, '""')}"`).join(','), '\r\n'];
    let rowCount = 0;
    for await (const row of rows) {
      chunks.push(def.columns.map((c) => csvCell(c, row[c.key] ?? null)).join(','), '\r\n');
      rowCount++;
    }
    return {
      body: Buffer.from(chunks.join(''), 'utf8'),
      rowCount,
      mimeType: 'text/csv; charset=utf-8',
      extension: 'csv',
    };
  }

  const stream = new PassThrough();
  const parts: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => parts.push(chunk));
  const done = new Promise<void>((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
  wb.creator = 'getpack';
  wb.created = meta.generatedAt;
  const ws = wb.addWorksheet('Report', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = def.columns.map((c, i) => ({
    header: header[i],
    key: c.key,
    width: Math.min(40, Math.max(12, header[i]!.length / 1.5)),
    ...(NUMBER_FORMAT[c.type] && { style: { numFmt: NUMBER_FORMAT[c.type] } }),
  }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).commit();
  let rowCount = 0;
  for await (const row of rows) {
    ws.addRow(Object.fromEntries(def.columns.map((c) => [c.key, xlsxValue(c, row[c.key] ?? null)]))).commit();
    rowCount++;
  }
  ws.commit();
  const about = wb.addWorksheet('About');
  about.columns = [
    { header: 'Item', key: 'item', width: 24 },
    { header: 'Value', key: 'value', width: 80 },
  ];
  about.addRow({ item: 'Report', value: `${def.nameEn} / ${def.nameTh} (${def.key})` }).commit();
  for (const [key, value] of Object.entries(meta.filters) as [string, string][])
    about.addRow({ item: `Filter: ${key}`, value }).commit();
  about.addRow({ item: 'Rows', value: rowCount }).commit();
  about.addRow({ item: 'Generated at', value: meta.generatedAt.toISOString() }).commit();
  about.commit();
  await wb.commit();
  await done;
  return {
    body: Buffer.concat(parts),
    rowCount,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx',
  };
}
