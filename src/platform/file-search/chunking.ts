import { cleanText, fold, skeleton } from './text-fold';

/** One page of a PDF, one sheet of a workbook, one slide, or the whole of a document without pages. */
export interface TextPage {
  /** 1-based; null for a document without pages (Word without page marks, plain text). */
  page: number | null;
  sheet?: string | null;
  text: string;
  ocr: boolean;
}

export interface TextChunk {
  chunkIndex: number;
  page: number | null;
  sheet: string | null;
  ocr: boolean;
  content: string;
  searchText: string;
  searchSkeleton: string;
}

/** Longest chunk (characters): a passage short enough to show and to embed (e5-small reads 512 tokens). */
export const CHUNK_CHARS = 1000;
/** Characters carried over from the end of one chunk to the next, so a phrase cut at the edge is still found. */
export const CHUNK_OVERLAP = 120;

/**
 * Splits pages into chunks of at most `CHUNK_CHARS`, never across pages, on line breaks where it can and on spaces
 * otherwise (a long Thai line with no break is cut hard). Consecutive chunks of one page overlap by
 * `CHUNK_OVERLAP` characters. Empty pages give no chunk.
 */
export function chunkPages(pages: TextPage[], maxChars = Number.POSITIVE_INFINITY): TextChunk[] {
  const out: TextChunk[] = [];
  let budget = maxChars;
  for (const p of pages) {
    if (budget <= 0) break;
    let text = cleanText(p.text);
    if (!text) continue;
    if (text.length > budget) text = text.slice(0, budget);
    budget -= text.length;
    for (const content of splitText(text)) {
      const searchText = fold(content);
      if (!searchText) continue;
      out.push({
        chunkIndex: out.length,
        page: p.page,
        sheet: p.sheet ?? null,
        ocr: p.ocr,
        content,
        searchText,
        searchSkeleton: skeleton(searchText),
      });
    }
  }
  return out;
}

export function splitText(text: string): string[] {
  if (text.length <= CHUNK_CHARS) return [text];
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + CHUNK_CHARS);
    if (end < text.length) {
      const window = text.slice(start + CHUNK_CHARS / 2, end);
      const nl = window.lastIndexOf('\n');
      const sp = window.lastIndexOf(' ');
      const cut = nl >= 0 ? nl : sp;
      if (cut >= 0) end = start + CHUNK_CHARS / 2 + cut;
    }
    const piece = text.slice(start, end).trim();
    if (piece) out.push(piece);
    if (end >= text.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP);
  }
  return out;
}
