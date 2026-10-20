import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ExcelJS from 'exceljs';
import { strFromU8, unzipSync } from 'fflate';
import sharp from 'sharp';

import { type TextPage } from './chunking';
import { run, ToolError } from './exec';
import { cleanText, letterCount, readableShare } from './text-fold';

export const FILE_TEXT_EXTRACTOR = Symbol('FILE_TEXT_EXTRACTOR');

export interface ExtractOptions {
  ocr: boolean;
  /** Tesseract languages, e.g. `tha+eng`. */
  ocrLanguages: string;
  ocrMaxPages: number;
  ocrDpi: number;
}

export type ExtractMethod =
  'pdf_text' | 'pdf_ocr' | 'pdf_mixed' | 'image_ocr' | 'docx' | 'xlsx' | 'pptx' | 'plain';

export interface Extraction {
  /** `unsupported`: a type this reader cannot open (or a password-protected PDF). */
  status: 'read' | 'unsupported';
  method: ExtractMethod | null;
  pages: TextPage[];
  pageCount: number | null;
  ocrPages: number;
  skippedPages: number;
  /** Mean OCR word confidence (0–100) over OCR'd pages; null without OCR. */
  ocrConfidence: number | null;
  /** Why a file is unsupported, for the record. */
  reason?: string;
}

export interface FileTextExtractor {
  extract(
    file: { bytes: Buffer; mimeType: string; name: string },
    options: ExtractOptions,
  ): Promise<Extraction>;
}

/** Fewer letters than this on a PDF page (or an unreadable text layer) and the page is read by OCR. */
const MIN_PAGE_LETTERS = 25;
const MIN_READABLE_SHARE = 0.6;
const PDF_TEXT_TIMEOUT_MS = 120_000;
const RENDER_TIMEOUT_MS = 60_000;
const OCR_TIMEOUT_MS = 120_000;
/** Entries of an Office file read at most (declared uncompressed size, bytes) — a zip bomb is refused. */
const ZIP_ENTRY_MAX = 64 * 1024 * 1024;
const ZIP_TOTAL_MAX = 256 * 1024 * 1024;
const XLSX_MAX_ROWS = 20_000;
/** Images narrower than this are scaled up before OCR (Tesseract wants ~30 px capital letters). */
const OCR_MIN_WIDTH = 1800;
/** OCR words read with less confidence than this (0–100) are dropped as noise. */
const MIN_WORD_CONFIDENCE = 30;

const unsupported = (reason: string): Extraction => ({
  status: 'unsupported',
  method: null,
  pages: [],
  pageCount: null,
  ocrPages: 0,
  skippedPages: 0,
  ocrConfidence: null,
  reason,
});

export class UnsupportedFileError extends Error {}

type Kind = 'pdf' | 'image' | 'docx' | 'xlsx' | 'pptx' | 'plain' | null;

const EXT_KIND: Record<string, Kind> = {
  pdf: 'pdf',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  tif: 'image',
  tiff: 'image',
  docx: 'docx',
  xlsx: 'xlsx',
  pptx: 'pptx',
  txt: 'plain',
  csv: 'plain',
  md: 'plain',
};

const MIME_KIND: Record<string, Kind> = {
  'application/pdf': 'pdf',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/tiff': 'image',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'plain',
  'text/csv': 'plain',
  'text/markdown': 'plain',
};

/** What a file is, by its first bytes first (a renamed file is read as what it is), then type and name. */
export function kindOf(bytes: Buffer, mimeType: string, name: string): Kind {
  const head = bytes.subarray(0, 8);
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (head[0] === 0x89 && head.subarray(1, 4).toString('latin1') === 'PNG') return 'image';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image';
  if (
    head.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image';
  if (
    head.subarray(0, 4).toString('latin1') === 'II*\0' ||
    head.subarray(0, 4).toString('latin1') === 'MM\0*'
  )
    return 'image';
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const declared = MIME_KIND[mimeType.toLowerCase()] ?? EXT_KIND[ext] ?? null;
  if (head[0] === 0x50 && head[1] === 0x4b) {
    // An OOXML package: which one is told by its parts.
    return declared === 'docx' || declared === 'xlsx' || declared === 'pptx' ? declared : null;
  }
  return declared === 'plain' ? 'plain' : null;
}

/**
 * Reads the text of a stored file (D-427, ADR-0013): a PDF's text layer page by page (poppler `pdftotext`), pages
 * without a usable one rendered (`pdftoppm`) and read by Tesseract; photos and scans by Tesseract; Word, PowerPoint
 * and Excel from their XML; plain text as UTF-8, else Windows-874 (Thai Windows exports).
 */
export class DocumentTextExtractor implements FileTextExtractor {
  constructor(
    private readonly tools: { pdftotext: string; pdftoppm: string; tesseract: string } = {
      pdftotext: 'pdftotext',
      pdftoppm: 'pdftoppm',
      tesseract: 'tesseract',
    },
  ) {}

  async extract(
    file: { bytes: Buffer; mimeType: string; name: string },
    options: ExtractOptions,
  ): Promise<Extraction> {
    const kind = kindOf(file.bytes, file.mimeType, file.name);
    try {
      switch (kind) {
        case 'pdf':
          return await this.pdf(file.bytes, options);
        case 'image':
          return options.ocr ? await this.image(file.bytes, options) : unsupported('ocr_off');
        case 'docx':
          return docx(file.bytes);
        case 'pptx':
          return pptx(file.bytes);
        case 'xlsx':
          return await xlsx(file.bytes);
        case 'plain':
          return plain(file.bytes);
        default:
          return unsupported(`type ${file.mimeType}`);
      }
    } catch (error) {
      if (error instanceof UnsupportedFileError) return unsupported(error.message);
      throw error;
    }
  }

  private async pdf(bytes: Buffer, options: ExtractOptions): Promise<Extraction> {
    const dir = await mkdtemp(join(tmpdir(), 'getpack-text-'));
    try {
      const path = join(dir, 'in.pdf');
      await writeFile(path, bytes);
      let layer: string;
      try {
        layer = (
          await run(this.tools.pdftotext, ['-enc', 'UTF-8', '-eol', 'unix', '-layout', path, '-'], {
            timeoutMs: PDF_TEXT_TIMEOUT_MS,
          })
        ).toString('utf8');
      } catch (error) {
        if (error instanceof ToolError && /password|encrypt/i.test(error.message))
          throw new UnsupportedFileError('pdf_encrypted');
        throw error;
      }
      // pdftotext ends every page with a form feed.
      const raw = layer.split('\f');
      if (raw.length > 1 && raw[raw.length - 1]!.trim() === '') raw.pop();
      const pages: TextPage[] = raw.map((text, i) => ({ page: i + 1, text, ocr: false }));
      const needOcr = pages.filter((p) => {
        const clean = cleanText(p.text);
        return letterCount(clean) < MIN_PAGE_LETTERS || readableShare(clean) < MIN_READABLE_SHARE;
      });
      let ocrPages = 0;
      let skippedPages = 0;
      const confidences: number[] = [];
      if (options.ocr) {
        for (const p of needOcr) {
          if (ocrPages >= options.ocrMaxPages) {
            skippedPages++;
            continue;
          }
          const png = join(dir, `p${p.page}`);
          await run(
            this.tools.pdftoppm,
            [
              '-f',
              String(p.page),
              '-l',
              String(p.page),
              '-r',
              String(options.ocrDpi),
              '-gray',
              '-png',
              '-singlefile',
              path,
              png,
            ],
            { timeoutMs: RENDER_TIMEOUT_MS },
          );
          const image = await readFile(`${png}.png`);
          await rm(`${png}.png`, { force: true });
          const read = await this.ocr(image, options.ocrLanguages);
          ocrPages++;
          // Keep whichever reads more: a thin text layer (a page number) over a scan loses to the OCR.
          if (letterCount(read.text) > letterCount(cleanText(p.text))) {
            p.text = read.text;
            p.ocr = true;
          }
          if (read.confidence !== null) confidences.push(read.confidence);
        }
      } else skippedPages = needOcr.length;
      const ocrUsed = pages.filter((p) => p.ocr).length;
      return {
        status: 'read',
        method: ocrUsed === 0 ? 'pdf_text' : ocrUsed === pages.length ? 'pdf_ocr' : 'pdf_mixed',
        pages,
        pageCount: pages.length,
        ocrPages,
        skippedPages,
        ocrConfidence: mean(confidences),
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async image(bytes: Buffer, options: ExtractOptions): Promise<Extraction> {
    let pipeline = sharp(bytes, { failOn: 'error', limitInputPixels: 100_000_000 }).rotate().greyscale();
    const meta = await sharp(bytes).metadata();
    if ((meta.width ?? 0) > 0 && (meta.width ?? 0) < OCR_MIN_WIDTH)
      pipeline = pipeline.resize({ width: OCR_MIN_WIDTH, kernel: 'lanczos3' });
    const png = await pipeline.normalise().png().toBuffer();
    const read = await this.ocr(png, options.ocrLanguages);
    return {
      status: 'read',
      method: 'image_ocr',
      pages: [{ page: null, text: read.text, ocr: true }],
      pageCount: 1,
      ocrPages: 1,
      skippedPages: 0,
      ocrConfidence: read.confidence,
    };
  }

  /** Tesseract (LSTM) on one image; text rebuilt line by line from its TSV, with the mean word confidence. */
  private async ocr(image: Buffer, languages: string): Promise<{ text: string; confidence: number | null }> {
    const tsv = (
      await run(
        this.tools.tesseract,
        ['stdin', 'stdout', '-l', languages, '--oem', '1', '--psm', '3', 'tsv'],
        {
          timeoutMs: OCR_TIMEOUT_MS,
          input: image,
        },
      )
    ).toString('utf8');
    return fromTsv(tsv);
  }
}

/** Text and mean confidence from Tesseract's TSV (level 5 = word; block / paragraph / line numbers group them). */
export function fromTsv(tsv: string): { text: string; confidence: number | null } {
  const lines = new Map<string, string[]>();
  const paragraphs: string[] = [];
  const confidences: number[] = [];
  for (const row of tsv.split('\n').slice(1)) {
    const cols = row.split('\t');
    if (cols.length < 12 || cols[0] !== '5') continue;
    const word = cols.slice(11).join('\t').trim();
    const conf = Number(cols[10]);
    if (!word) continue;
    // Table rules and specks come out as low-confidence junk; a real word below this is rare and stays findable
    // through its neighbours.
    if (Number.isFinite(conf) && conf >= 0 && conf < MIN_WORD_CONFIDENCE) continue;
    if (Number.isFinite(conf) && conf >= 0) confidences.push(conf);
    const key = `${cols[2]}.${cols[3]}.${cols[4]}`;
    const para = `${cols[2]}.${cols[3]}`;
    if (!lines.has(key)) {
      lines.set(key, []);
      if (paragraphs[paragraphs.length - 1] !== para) paragraphs.push(para);
    }
    lines.get(key)!.push(word);
  }
  let text = '';
  let lastPara = '';
  for (const [key, words] of lines) {
    const para = key.split('.').slice(0, 2).join('.');
    if (text) text += para === lastPara ? '\n' : '\n\n';
    text += joinWords(words);
    lastPara = para;
  }
  return { text, confidence: mean(confidences) };
}

/** Words of one OCR line: Thai words run together (Thai has no spaces), others are spaced. */
function joinWords(words: string[]): string {
  let out = '';
  for (const w of words) {
    if (!out) out = w;
    else if (/[฀-๿]$/u.test(out) && /^[฀-๿]/u.test(w)) out += w;
    else out += ` ${w}`;
  }
  return out;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

// --------------------------------------------------------------------------------------------- Office files

function unzipParts(bytes: Buffer, wanted: (name: string) => boolean): Record<string, string> {
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
      filter: (f) => {
        if (!wanted(f.name)) return false;
        if (f.originalSize > ZIP_ENTRY_MAX) throw new UnsupportedFileError('zip_entry_too_large');
        total += f.originalSize;
        if (total > ZIP_TOTAL_MAX) throw new UnsupportedFileError('zip_too_large');
        return true;
      },
    });
  } catch (error) {
    if (error instanceof UnsupportedFileError) throw error;
    throw new UnsupportedFileError('zip_unreadable');
  }
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strFromU8(v)]));
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function xmlText(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    }
    return ENTITIES[e] ?? m;
  });
}

/**
 * Word: paragraphs of the body, then headers, footers and notes. Page numbers follow the page breaks Word recorded
 * when the file was last saved (`w:lastRenderedPageBreak`, explicit page breaks); none recorded → no pages.
 */
export function docx(bytes: Buffer): Extraction {
  const parts = unzipParts(bytes, (n) =>
    /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n),
  );
  const body = parts['word/document.xml'];
  if (body === undefined) throw new UnsupportedFileError('docx_without_body');
  const hasBreaks = /<w:lastRenderedPageBreak\/>|<w:br [^>]*w:type="page"/.test(body);
  const pages: TextPage[] = [];
  let page = 1;
  let current = '';
  const flush = () => {
    if (current.trim()) pages.push({ page: hasBreaks ? page : null, text: current, ocr: false });
    current = '';
  };
  for (const para of body.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g) ?? []) {
    const breaks = (para.match(/<w:lastRenderedPageBreak\/>|<w:br [^>]*w:type="page"[^>]*\/>/g) ?? []).length;
    if (hasBreaks && breaks > 0) {
      flush();
      page += breaks;
    }
    current += `${wordParagraph(para)}\n`;
  }
  flush();
  const extra = Object.entries(parts)
    .filter(([name]) => name !== 'word/document.xml')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, xml]) => (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map(wordParagraph).join('\n'))
    .join('\n')
    .trim();
  if (extra) pages.push({ page: null, text: extra, ocr: false });
  return read('docx', pages, hasBreaks ? page : null);
}

function wordParagraph(xml: string): string {
  let out = '';
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g)) {
    if (m[1] !== undefined) out += xmlText(m[1]);
    else out += m[0] === '<w:tab/>' ? '\t' : '\n';
  }
  return out;
}

/** PowerPoint: one page per slide, in slide order. */
export function pptx(bytes: Buffer): Extraction {
  const parts = unzipParts(bytes, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const slides = Object.entries(parts)
    .map(([name, xml]) => ({ n: Number(/slide(\d+)\.xml$/.exec(name)![1]), xml }))
    .sort((a, b) => a.n - b.n);
  const pages = slides.map(({ n, xml }) => ({
    page: n,
    text: (xml.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? [])
      .map((p) => [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => xmlText(m[1]!)).join(''))
      .join('\n'),
    ocr: false,
  }));
  return read('pptx', pages, slides.length);
}

/** Excel: one page per sheet — each row's cells joined with ` | ` (formula results, dates as shown). */
export async function xlsx(bytes: Buffer): Promise<Extraction> {
  // Refuse a zip bomb before ExcelJS inflates it.
  unzipParts(bytes, (n) => n.startsWith('xl/'));
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    throw new UnsupportedFileError('xlsx_unreadable');
  }
  const pages: TextPage[] = [];
  book.worksheets.forEach((sheet, i) => {
    const lines: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, n) => {
      if (n > XLSX_MAX_ROWS) return;
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        const t = cell.text?.trim();
        if (t) cells.push(t);
      });
      if (cells.length) lines.push(cells.join(' | '));
    });
    pages.push({ page: i + 1, sheet: sheet.name, text: lines.join('\n'), ocr: false });
  });
  return read('xlsx', pages, book.worksheets.length);
}

/** Plain text, CSV, Markdown: UTF-8 (with or without a BOM), else Windows-874 / TIS-620. */
export function plain(bytes: Buffer): Extraction {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-874').decode(bytes);
  }
  return read('plain', [{ page: null, text: text.replace(/^\ufeff/, ''), ocr: false }], null);
}

function read(method: ExtractMethod, pages: TextPage[], pageCount: number | null): Extraction {
  return { status: 'read', method, pages, pageCount, ocrPages: 0, skippedPages: 0, ocrConfidence: null };
}
