/**
 * Text folding for content search (D-427, ADR-0013). Thai has no spaces between words and OCR puts some in at
 * random, so matching ignores every space: both the stored `search_text` and the query are folded the same way —
 * per code point NFKC (ำ becomes ํา on both sides, full-width digits become ASCII), lower case, spaces, zero-width
 * characters and soft hyphens dropped. `foldWithMap` also keeps, for each folded character, where it came from, so a
 * match in folded text highlights the right span of the original.
 */

/** Spaces, zero-width characters, soft hyphen and the BOM: dropped by folding. */
const DROP = /[\s\u00ad\u200b-\u200d\u2060\ufeff]/u;

/**
 * Thai glyph variants in the Private Use Area that legacy Thai fonts (TH SarabunPSK and kin) map their shifted
 * vowels and tone marks to: a PDF using them yields these code points; they are read as the real characters.
 */
const THAI_PUA: Record<number, string> = {
  0xf700: 'ฐ',
  0xf701: 'ิ',
  0xf702: 'ี',
  0xf703: 'ึ',
  0xf704: 'ื',
  0xf705: '่',
  0xf706: '้',
  0xf707: '๊',
  0xf708: '๋',
  0xf709: '์',
  0xf70a: '่',
  0xf70b: '้',
  0xf70c: '๊',
  0xf70d: '๋',
  0xf70e: '์',
  0xf70f: 'ญ',
  0xf710: 'ั',
  0xf711: 'ํ',
  0xf712: '็',
  0xf713: '่',
  0xf714: '้',
  0xf715: '๊',
  0xf716: '๋',
  0xf717: '์',
  0xf718: 'ุ',
  0xf719: 'ู',
  0xf71a: 'ฺ',
};

/** The text as read, with legacy Thai PUA glyphs replaced and runs of blank lines / spaces tidied. */
export function cleanText(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    out += THAI_PUA[cp] ?? ch;
  }
  return (
    out
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex -- control characters a text layer can carry
      .replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g, '')
      .replace(/[ \t\u00a0]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

function foldChar(ch: string): string {
  if (DROP.test(ch)) return '';
  return ch.normalize('NFKC').toLowerCase().replace(/\s/gu, '');
}

/** Folded text (see the file comment). */
export function fold(text: string): string {
  let out = '';
  for (const ch of text) out += foldChar(ch);
  return out;
}

/**
 * Folded text and, per folded UTF-16 unit, where it came from in the original: `map[i]` the start and `ends[i]`
 * the end of the original character (a match `[a, b)` in folded text is `[map[a], ends[b - 1])` in the original).
 */
export function foldWithMap(text: string): { folded: string; map: number[]; ends: number[] } {
  let folded = '';
  const map: number[] = [];
  const ends: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = foldChar(ch);
    for (let k = 0; k < f.length; k++) {
      map.push(i);
      ends.push(i + ch.length);
    }
    folded += f;
    i += ch.length;
  }
  return { folded, map, ends };
}

/**
 * Folded text without Thai vowel signs above and below the line, tone marks and the other combining marks
 * (U+0E31, U+0E34–U+0E3A, U+0E47–U+0E4E): what OCR misreads most, and what people leave out when typing fast.
 * The near-match tier compares skeletons (`search_skeleton`).
 */
export function skeleton(folded: string): string {
  return folded.replace(/[\u0e31\u0e34-\u0e3a\u0e47-\u0e4e]/gu, '');
}

/** Escapes LIKE wildcards (`%`, `_`, `\`) of a folded query. */
export function likeEscape(folded: string): string {
  return folded.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Letters and digits in a text (Thai, Latin, digits): too few on a PDF page means it needs OCR. */
export function letterCount(text: string): number {
  return text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
}

/**
 * Share of the letters that are Thai or Latin: a text layer from a font without a Unicode map comes out as
 * symbols or odd scripts and is treated as no text.
 */
export function readableShare(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 0;
  const ok = letters.filter((c) => /[฀-๿a-zA-ZÀ-ɏ]/u.test(c)).length;
  return ok / letters.length;
}

export interface Snippet {
  text: string;
  /** Spans of `text` that matched, `[start, end)` in UTF-16 units. */
  highlights: [number, number][];
}

const WINDOW = 90;

/**
 * A short passage of `content` around the first match of `query` (folded on both sides), with every match inside
 * it highlighted. Without an exact match (a fuzzy or a by-meaning hit) the passage starts at the best partial
 * match — the longest run of the query's words found — or at the top of the chunk.
 */
export function snippetOf(content: string, query: string, width = WINDOW): Snippet {
  const text = content.replace(/\s+/g, ' ').trim();
  const { folded, map, ends } = foldWithMap(text);
  const needles = needlesOf(query);
  const find = (hay: string, starts: number[], stops: number[], list: string[]) => {
    const found: [number, number][] = [];
    for (const needle of list) {
      if (!needle) continue;
      let from = 0;
      for (;;) {
        const at = hay.indexOf(needle, from);
        if (at < 0) break;
        found.push([starts[at]!, stops[at + needle.length - 1]!]);
        from = at + needle.length;
      }
    }
    return found;
  };
  let spans = find(folded, map, ends, needles);
  if (spans.length === 0) {
    // A near match (marks missing or misread): find it on the skeletons, map back through the folded positions.
    const keep: number[] = [];
    for (let i = 0; i < folded.length; i++) if (skeleton(folded[i]!) !== '') keep.push(i);
    const bare = keep.map((i) => folded[i]).join('');
    const starts = keep.map((i) => map[i]!);
    const stops = keep.map((i) => ends[i]!);
    spans = find(bare, starts, stops, needles.map(skeleton));
    if (spans.length === 0) {
      // A fuzzy match (a letter or two misread): mark the longest run the query shares with the passage.
      const best = longestCommon(bare, skeleton(needles[0] ?? ''));
      if (best && best.length >= 4) spans = [[starts[best.at]!, stops[best.at + best.length - 1]!]];
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([s[0], s[1]]);
  }
  const anchor = merged[0]?.[0] ?? 0;
  let start = Math.max(0, anchor - width);
  let end = Math.min(text.length, (merged[0]?.[1] ?? 0) + width * 2);
  if (end - start < width * 3) end = Math.min(text.length, start + width * 3);
  // Do not cut a word or a Thai cluster in two where a space is near.
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space >= 0 && space < anchor && space - start < 20) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > start && end - space < 20 && space >= (merged[0]?.[1] ?? 0)) end = space;
  }
  const prefix = start > 0 ? '… ' : '';
  const suffix = end < text.length ? ' …' : '';
  const highlights = merged
    .filter(([a, b]) => a >= start && b <= end)
    .map(([a, b]) => [a - start + prefix.length, b - start + prefix.length] as [number, number]);
  return { text: `${prefix}${text.slice(start, end)}${suffix}`, highlights };
}

/** The longest substring of `b` found in `a` (dynamic programming; passages are ≤ 1,000 and queries ≤ 200). */
export function longestCommon(a: string, b: string): { at: number; length: number } | null {
  if (!a || !b) return null;
  let prev = new Array<number>(b.length + 1).fill(0);
  let best = { at: 0, length: 0 };
  for (let i = 1; i <= a.length; i++) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        row[j] = prev[j - 1]! + 1;
        if (row[j]! > best.length) best = { at: i - row[j]!, length: row[j]! };
      }
    }
    prev = row;
  }
  return best.length ? best : null;
}

/**
 * What to highlight for a query: the whole folded query, and — when it has several words — each word of three or
 * more characters (a Thai word with its marks counts by code units).
 */
export function needlesOf(query: string): string[] {
  const whole = fold(query);
  if (!whole) return [];
  const words = query
    .split(/\s+/)
    .map(fold)
    .filter((w) => w.length >= 3 && w !== whole);
  return [whole, ...new Set(words)];
}
