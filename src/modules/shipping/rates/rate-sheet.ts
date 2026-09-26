import { sha256 } from '@common/crypto/hashing';
import { type CellValue, type SheetRows } from '@modules/catalog/imports/workbook';

import { MONEY, POSTCODE, RATE } from './customer-rates.dto';

/**
 * Excel layout of a rate card (customer rates or factory payouts): one sheet `rates`, one row per
 * band, zones by code inside the version's scheme. Parsing is pure; the service resolves zone codes.
 */
export const RATE_SHEET = 'rates';

export interface RateSheetLayout {
  /** Header of the amount column: `price_amount` (customer) or `payout_amount` (factory). */
  amountColumn: string;
}

export function rateSheetHeaders(layout: RateSheetLayout): string[] {
  return [
    'zone_code',
    'postcode',
    'weight_min_g',
    'weight_max_g',
    'volume_min_cm3',
    'volume_max_cm3',
    layout.amountColumn,
    'per_extra_kg',
  ];
}

export interface ParsedRate {
  row: number;
  zoneCode: string;
  postcode: string | null;
  weightMinG: number;
  weightMaxG: number | null;
  volumeMinCm3: number | null;
  volumeMaxCm3: number | null;
  amount: string;
  perExtraKg: string | null;
}

export interface RateSheetError {
  sheet: string;
  row: number;
  column: string | null;
  code: string;
  message: string;
}

export interface ParsedRateSheet {
  rates: ParsedRate[];
  errors: RateSheetError[];
}

const text = (value: CellValue): string | null => (value === null ? null : String(value).trim() || null);

export function parseRateSheet(workbook: SheetRows[], layout: RateSheetLayout): ParsedRateSheet {
  const sheet = workbook.find((s) => s.name === RATE_SHEET);
  if (!sheet) {
    return {
      rates: [],
      errors: [
        {
          sheet: RATE_SHEET,
          row: 1,
          column: null,
          code: 'sheet',
          message: `sheet "${RATE_SHEET}" is missing`,
        },
      ],
    };
  }
  const expected = rateSheetHeaders(layout);
  const missing = expected.filter((h) => !sheet.headers.includes(h));
  if (missing.length > 0) {
    return {
      rates: [],
      errors: missing.map((h) => ({
        sheet: RATE_SHEET,
        row: 1,
        column: h,
        code: 'header',
        message: `column ${h} is missing`,
      })),
    };
  }
  const rates: ParsedRate[] = [];
  const errors: RateSheetError[] = [];
  for (const { rowNumber, cells } of sheet.rows) {
    const rowErrors: RateSheetError[] = [];
    const fail = (column: string, code: string, message: string) =>
      rowErrors.push({ sheet: RATE_SHEET, row: rowNumber, column, code, message });
    const int = (column: string, required: boolean): number | null => {
      const raw = cells[column] ?? null;
      if (raw === null) {
        if (required) fail(column, 'required', `${column} is required`);
        return null;
      }
      const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isInteger(value) || value < 0) {
        fail(column, 'int', `${column} must be a whole number ≥ 0`);
        return null;
      }
      return value;
    };
    const decimal = (column: string, pattern: RegExp, required: boolean): string | null => {
      const raw = text(cells[column] ?? null);
      if (raw === null) {
        if (required) fail(column, 'required', `${column} is required`);
        return null;
      }
      if (!pattern.test(raw)) {
        fail(column, 'decimal', `${column} must be a non-negative amount`);
        return null;
      }
      return raw;
    };
    const zoneCode = text(cells['zone_code'] ?? null);
    if (zoneCode === null) fail('zone_code', 'required', 'zone_code is required');
    const postcodeRaw = text(cells['postcode'] ?? null);
    const postcode = postcodeRaw === null ? null : postcodeRaw.padStart(5, '0');
    if (postcode !== null && !POSTCODE.test(postcode))
      fail('postcode', 'pattern', 'postcode has an invalid format');
    const rate: ParsedRate = {
      row: rowNumber,
      zoneCode: zoneCode ?? '',
      postcode,
      weightMinG: int('weight_min_g', true) ?? 0,
      weightMaxG: int('weight_max_g', false),
      volumeMinCm3: int('volume_min_cm3', false),
      volumeMaxCm3: int('volume_max_cm3', false),
      amount: decimal(layout.amountColumn, MONEY, true) ?? '0',
      perExtraKg: decimal('per_extra_kg', RATE, false),
    };
    if (rate.weightMaxG !== null && rate.weightMaxG <= rate.weightMinG) {
      fail('weight_max_g', 'range', 'weight_max_g must be greater than weight_min_g');
    }
    if (rate.volumeMaxCm3 !== null && rate.volumeMaxCm3 <= (rate.volumeMinCm3 ?? 0)) {
      fail('volume_max_cm3', 'range', 'volume_max_cm3 must be greater than volume_min_cm3');
    }
    if (rowErrors.length > 0) errors.push(...rowErrors);
    else rates.push(rate);
  }
  return { rates, errors };
}

/** Rows as the exporter writes them (same headers as the importer reads). */
export function rateSheetRows(
  layout: RateSheetLayout,
  rates: readonly Omit<ParsedRate, 'row'>[],
): Record<string, CellValue>[] {
  return rates.map((r) => ({
    zone_code: r.zoneCode,
    postcode: r.postcode,
    weight_min_g: r.weightMinG,
    weight_max_g: r.weightMaxG,
    volume_min_cm3: r.volumeMinCm3,
    volume_max_cm3: r.volumeMaxCm3,
    [layout.amountColumn]: r.amount,
    per_extra_kg: r.perExtraKg,
  }));
}

/** Fingerprint of a preview: target version, file and every parsed row / error (A-14 pattern). */
export function ratePreviewSha(versionPublicId: string, fileSha: string, parsed: ParsedRateSheet): string {
  const canonical = JSON.stringify({
    v: 1,
    versionPublicId,
    fileSha,
    rates: parsed.rates,
    errors: parsed.errors,
  });
  return Buffer.from(sha256(canonical)).toString('hex');
}
