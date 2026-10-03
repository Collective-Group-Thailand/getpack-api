/**
 * D-283 barcode / QR validation shared by the studio, the web and preflight: GS1 check digits (EAN-13, EAN-8, UPC-A),
 * the Code-128 character set, QR payload capacity per error-correction level, and the GS1 minimum size. These are
 * standards (GS1 General Specifications, ISO/IEC 15417, ISO/IEC 18004), not business values.
 */

export const SYMBOLOGIES = ['ean13', 'ean8', 'upca', 'code128', 'qr'] as const;
export type Symbology = (typeof SYMBOLOGIES)[number];
export const QR_LEVELS = ['L', 'M', 'Q', 'H'] as const;
export type QrLevel = (typeof QR_LEVELS)[number];

export interface BarcodeCheck {
  valid: boolean;
  /** Problem codes, empty when valid. */
  problems: string[];
  /** The value as it should be encoded (e.g. the check digit added to 12 EAN-13 digits). */
  normalised: string | null;
  /** GS1: the smallest printed width (mm) at 80 % magnification incl. quiet zones; null where none applies. */
  minWidthMm: number | null;
}

/** GS1 mod-10 check digit of the digits before it. */
export function gs1CheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10;
}

/** GS1 nominal symbol widths incl. quiet zones at 100 % (mm); 80 % is the smallest allowed. */
const GS1_NOMINAL_WIDTH_MM: Partial<Record<Symbology, number>> = { ean13: 37.29, upca: 37.29, ean8: 26.73 };
const MIN_MAGNIFICATION = 0.8;
const LENGTH: Partial<Record<Symbology, number>> = { ean13: 13, ean8: 8, upca: 12 };

/** QR byte-mode capacity of the largest symbol (version 40) per level (ISO/IEC 18004 table 7). */
const QR_BYTES: Record<QrLevel, number> = { L: 2953, M: 2331, Q: 1663, H: 1273 };

export function validateBarcode(symbology: Symbology, value: string, level: QrLevel = 'M'): BarcodeCheck {
  const problems: string[] = [];
  let normalised: string | null = value;
  const gs1 = LENGTH[symbology];
  if (gs1 !== undefined) {
    if (!/^[0-9]+$/.test(value)) problems.push('digits_only');
    else if (value.length === gs1 - 1) normalised = value + String(gs1CheckDigit(value));
    else if (value.length !== gs1) problems.push('wrong_length');
    else if (gs1CheckDigit(value.slice(0, -1)) !== Number(value.at(-1))) problems.push('check_digit');
  } else if (symbology === 'code128') {
    // Code sets A–C encode ASCII 0–127; anything else needs another symbology.
    if (value.length === 0) problems.push('empty');
    if ([...value].some((ch) => ch.charCodeAt(0) > 127)) problems.push('not_ascii');
  } else {
    const bytes = Buffer.byteLength(value, 'utf8');
    if (bytes === 0) problems.push('empty');
    if (bytes > QR_BYTES[level]) problems.push('too_long_for_level');
  }
  if (problems.length > 0) normalised = null;
  const nominal = GS1_NOMINAL_WIDTH_MM[symbology];
  return {
    valid: problems.length === 0,
    problems,
    normalised,
    minWidthMm: nominal === undefined ? null : Math.round(nominal * MIN_MAGNIFICATION * 100) / 100,
  };
}
