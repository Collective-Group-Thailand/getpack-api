import { DomainException } from '@common/errors/domain.exception';
import ExcelJS from 'exceljs';

/** A cell after normalisation: formulas become their cached result, rich text its plain text. */
export type CellValue = string | number | boolean | null;

export interface SheetRows {
  name: string;
  /** Lower-cased, trimmed header texts in column order. */
  headers: string[];
  /** Data rows (Excel row number ≥ 2), keyed by header. Empty rows are skipped. */
  rows: { rowNumber: number; cells: Record<string, CellValue> }[];
}

function normalise(value: ExcelJS.CellValue): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('result' in value) return normalise((value as { result?: ExcelJS.CellValue }).result ?? null);
    if ('richText' in value) return normalise(value.richText.map((part) => part.text).join(''));
    if ('text' in value) return normalise((value as { text: string }).text);
    if ('error' in value) return null;
  }
  return null;
}

/** Reads every worksheet of an `.xlsx` workbook (row 1 = headers). */
export async function readWorkbook(buffer: Buffer): Promise<SheetRows[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch (error) {
    throw new DomainException('catalog.import_unreadable', { cause: error });
  }
  return workbook.worksheets.map((sheet) => {
    const headers: string[] = [];
    sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => {
      headers[column - 1] = String(normalise(cell.value) ?? '')
        .trim()
        .toLowerCase();
    });
    const rows: SheetRows['rows'] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const cells: Record<string, CellValue> = {};
      let any = false;
      headers.forEach((header, index) => {
        if (!header) return;
        const value = normalise(row.getCell(index + 1).value);
        cells[header] = value;
        if (value !== null) any = true;
      });
      if (any) rows.push({ rowNumber, cells });
    });
    return { name: sheet.name.trim().toLowerCase(), headers: headers.filter(Boolean), rows };
  });
}

/**
 * Writes sheets with a bold header row. Values are written as typed cells (string cells in `.xlsx`
 * are never evaluated as formulas, so exported text needs no escaping).
 */
export async function writeWorkbook(
  sheets: { name: string; headers: string[]; rows: Record<string, CellValue>[] }[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Packio';
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    worksheet.columns = sheet.headers.map((header) => ({
      header,
      key: header,
      width: Math.max(12, header.length + 4),
    }));
    worksheet.getRow(1).font = { bold: true };
    for (const row of sheet.rows) worksheet.addRow(row);
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
