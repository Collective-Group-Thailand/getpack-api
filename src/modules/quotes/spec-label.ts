import { type SpecLineDto } from './line-summary.dto';

/**
 * The one spec label (GLOBAL-RULES §5, D-441): pure helpers with no catalogue imports, so every module (cards,
 * styles, quotes, Studio) can use them.
 */

const mm = (n: number) => String(Number(n));

/**
 * The one size string of a spec (GLOBAL-RULES §5, D-441): length × width × height in mm — the order of the standard
 * sizes, the configurator and the product page. A flat item (label, tag, sheet) leaves the height out. With
 * `missing` (an RFQ, whose sizes the customer may leave blank) an unknown value is written as that mark instead.
 */
export function sizeText(
  size: { l: number | null; w: number | null; d?: number | null },
  opts: { missing?: string } = {},
): string {
  const known = (n: number | null | undefined): n is number => n !== undefined && n !== null;
  const value = (n: number | null | undefined) => (known(n) ? mm(n) : (opts.missing ?? '—'));
  const parts = [size.l, size.w, ...(known(size.d) || (opts.missing && size.d === null) ? [size.d] : [])];
  return parts.map(value).join(' × ');
}

/** The measuring basis of a size (D-182), as the size line and every document write it. */
export const BASIS_TEXT: Readonly<Record<string, SpecLabel>> = {
  internal: { th: 'ด้านใน', en: 'inside' },
  external: { th: 'ด้านนอก', en: 'outside' },
  over_crease: { th: 'วัดตามรอยพับ', en: 'over crease' },
  product: { th: 'ขนาดชิ้นงาน', en: 'finished size' },
};

/**
 * The value of a size line (B-API-3): `ยาว × กว้าง × สูง มม.`, with the basis when known — "(ด้านใน)" for inner
 * dimensions — e.g. `140 × 97.5 × 60 มม. (ด้านใน)` / `140 × 97.5 × 60 mm (inside)`.
 */
export function sizeValue(
  size: { l: number | null; w: number | null; d?: number | null },
  basis?: string | null,
  opts: { missing?: string } = {},
): SpecLabel {
  const text = sizeText(size, opts);
  const b = basis ? BASIS_TEXT[basis] : undefined;
  return {
    th: `${text} มม.${b ? ` (${b.th})` : ''}`,
    en: `${text} mm${b ? ` (${b.en})` : ''}`,
  };
}

/** The sides of a printed item: a box's outside and inside, a flat item's front and back. */
export type PrintSideKey = 'outside' | 'inside' | 'front' | 'back';

/** How each side is named in a spec (B-API-3): "พิมพ์ด้านนอก: …" / "พิมพ์ด้านใน: …". */
export const PRINT_SIDE_TEXT: Readonly<Record<PrintSideKey, SpecLabel>> = {
  outside: { th: 'พิมพ์ด้านนอก', en: 'Print (outside)' },
  inside: { th: 'พิมพ์ด้านใน', en: 'Print (inside)' },
  front: { th: 'พิมพ์ด้านหน้า', en: 'Print (front)' },
  back: { th: 'พิมพ์ด้านหลัง', en: 'Print (back)' },
};

/** One ink printed on a side: its catalogue name and kind (`process` is the CMYK set, D-443). */
export interface PrintInk {
  name: string;
  kind: string;
}

/**
 * The print method of one side, from the per-side model (D-443, B-API-2): `CMYK`, `สีพิเศษ n สี (…)` or
 * `CMYK + สีพิเศษ n สี (…)` — the spot colours named in brackets, as the factory reads them. Null when the side
 * prints nothing (the side is then left out of the spec).
 */
export function printMethodText(inks: readonly PrintInk[]): SpecLabel | null {
  if (inks.length === 0) return null;
  const cmyk = inks.some((i) => i.kind === 'process');
  const spots = [...new Set(inks.filter((i) => i.kind !== 'process').map((i) => i.name))];
  const n = spots.length;
  const spot =
    n > 0
      ? {
          th: `สีพิเศษ ${n} สี (${spots.join(', ')})`,
          en: `${n} spot colour${n > 1 ? 's' : ''} (${spots.join(', ')})`,
        }
      : null;
  if (!cmyk) return spot;
  return spot ? { th: `CMYK + ${spot.th}`, en: `CMYK + ${spot.en}` } : { th: 'CMYK', en: 'CMYK' };
}

/** One printed side as the spec label writes it: `พิมพ์ด้านนอก: CMYK`; null when the side is not printed. */
export function printSideText(side: PrintSideKey, inks: readonly PrintInk[]): SpecLabel | null {
  const method = printMethodText(inks);
  if (!method) return null;
  const label = PRINT_SIDE_TEXT[side];
  return { th: `${label.th}: ${method.th}`, en: `${label.en}: ${method.en}` };
}

const PRINT_LINE = /(^|\.)print(_front|_back)?$/;

/**
 * The value of a spec line as the label writes it: a print line carries its side — `พิมพ์ด้านนอก: CMYK` (the line's
 * own label, with a part's name for a multi-part product); every other line is its value.
 */
function labelValue(line: SpecLineDto, lang: 'th' | 'en'): string {
  const value = lang === 'th' ? line.valueTh : line.valueEn;
  if (!PRINT_LINE.test(line.key)) return value;
  return `${lang === 'th' ? line.labelTh : line.labelEn}: ${value}`;
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
 * mm, "(ด้านใน)" for inner dimensions), material, print per side ("พิมพ์ด้านนอก: CMYK", "พิมพ์ด้านใน: สีพิเศษ 1 สี
 * (ดำ)"; a side not printed is left out), coatings … — joined by " · ". A printable calculator's spec without a print line is
 * unprinted and says so ("ไม่พิมพ์" / "Unprinted"), so a price is never shown without the spec it is for.
 */
export function specLabel(lines: readonly SpecLineDto[], calculatorKey?: string | null): SpecLabel {
  const shown = lines.filter((l) => !LABEL_SKIP.has(l.key.replace(/^parts\[\d+\]\./, '')));
  const th = shown.map((l) => labelValue(l, 'th'));
  const en = shown.map((l) => labelValue(l, 'en'));
  const printed = lines.some((l) => PRINT_LINE.test(l.key));
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

/**
 * The spec of a document (quotation PDF): each line as `label value`, a print line as `พิมพ์ด้านนอก: CMYK`, joined by
 * " · ". Reads the lines stored on the quote, so an issued quote keeps the words it was made with.
 */
export function specLinesText(lines: readonly SpecLineDto[], lang: 'th' | 'en' = 'th'): string {
  return lines
    .map((l) =>
      PRINT_LINE.test(l.key)
        ? labelValue(l, lang)
        : `${lang === 'th' ? l.labelTh : l.labelEn} ${lang === 'th' ? l.valueTh : l.valueEn}`,
    )
    .join(' · ');
}
