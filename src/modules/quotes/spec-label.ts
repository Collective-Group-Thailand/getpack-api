import { type SpecLineDto } from './line-summary.dto';

/**
 * The one spec label (GLOBAL-RULES §5, D-441): pure helpers with no catalogue imports, so every module (cards,
 * styles, quotes, Studio) can use them.
 */

const mm = (n: number) => String(Number(n));

/**
 * The one size string of a spec (GLOBAL-RULES §5, D-441): length × width × height in mm — the order of the standard
 * sizes, the configurator and the product page. A flat item (label, tag, sheet) leaves the height out.
 */
export function sizeText(size: { l: number; w: number; d?: number | null }): string {
  const parts = [size.l, size.w, ...(size.d !== undefined && size.d !== null ? [size.d] : [])];
  return parts.map(mm).join(' × ');
}

/** Calculators whose spec has a print line; without one, the spec is unprinted (the one-string label says so). */
const PRINTABLE_CALCULATORS: ReadonlySet<string> = new Set([
  'folding',
  'corrugate',
  'label',
  'tag_sleeve',
  'pouch',
]);

/** The one-string label of a spec, in both languages. */
export interface SpecLabel {
  th: string;
  en: string;
}

/** Lines the one-string label leaves out: the style code repeats the style, the priced size repeats the size. */
const LABEL_SKIP: ReadonlySet<string> = new Set(['style_code', 'priced_size']);

/**
 * One string per spec (GLOBAL-RULES §5, D-441): the values of its lines in order — style, size (ยาว × กว้าง × สูง,
 * mm), material, print, coatings … — joined by " · ". A printable calculator's spec without a print line is
 * unprinted and says so ("ไม่พิมพ์" / "Unprinted"), so a price is never shown without the spec it is for.
 */
export function specLabel(lines: readonly SpecLineDto[], calculatorKey?: string | null): SpecLabel {
  const shown = lines.filter((l) => !LABEL_SKIP.has(l.key.replace(/^parts\[\d+\]\./, '')));
  const th = shown.map((l) => l.valueTh);
  const en = shown.map((l) => l.valueEn);
  const printed = lines.some((l) => /(^|\.)print(_front|_back)?$/.test(l.key));
  if (calculatorKey && PRINTABLE_CALCULATORS.has(calculatorKey) && !printed && lines.length > 0) {
    const at = Math.max(
      shown.findIndex((l) => l.key === 'material'),
      shown.findIndex((l) => l.key === 'size'),
    );
    th.splice(at + 1, 0, 'ไม่พิมพ์');
    en.splice(at + 1, 0, 'Unprinted');
  }
  return { th: th.join(' · '), en: en.join(' · ') };
}
