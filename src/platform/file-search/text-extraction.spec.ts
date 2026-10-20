import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CHUNK_CHARS, chunkPages, splitText } from './chunking';
import { DocumentTextExtractor, type ExtractOptions, fromTsv, kindOf } from './text-extractor';
import { cleanText, fold, foldWithMap, likeEscape, longestCommon, skeleton, snippetOf } from './text-fold';

const FIXTURES = join(__dirname, '../../../test/fixtures/file-text');
const fixture = (name: string) => readFileSync(join(FIXTURES, name));

/** The readers need poppler-utils and Tesseract with Thai (the worker image and CI install them). */
function toolsInstalled(): boolean {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    return execFileSync('tesseract', ['--list-langs'], { encoding: 'utf8' }).split('\n').includes('tha');
  } catch {
    return false;
  }
}
const withTools = toolsInstalled() ? describe : describe.skip;

const OPTIONS: ExtractOptions = { ocr: true, ocrLanguages: 'tha+eng', ocrMaxPages: 30, ocrDpi: 300 };

describe('text folding (D-427)', () => {
  it('ignores spaces, case and the two spellings of sara am', () => {
    expect(fold('สัญญา เช่า  เครื่องจักร')).toBe(fold('สัญญาเช่าเครื่องจักร'));
    expect(fold('จำนวน')).toBe(fold('จํานวน')); // ำ typed vs ํ + า from OCR
    expect(fold('Heidelberg SM 74')).toBe('heidelbergsm74');
    expect(fold('０１２３')).toBe('0123');
  });

  it('maps folded positions back to the original text', () => {
    const { folded, map, ends } = foldWithMap('ab c\u200bd');
    expect(folded).toBe('abcd');
    expect(map).toEqual([0, 1, 3, 5]);
    expect(ends).toEqual([1, 2, 4, 6]);
  });

  it('reads legacy Thai PUA glyphs as Thai and tidies spaces', () => {
    expect(cleanText('ก  ข\r\n\n\n\nค')).toBe('ก้ ข\n\nค');
  });

  it('escapes LIKE wildcards', () => {
    expect(likeEscape('100%_a\\')).toBe('100\\%\\_a\\\\');
  });

  it('highlights a match inside a snippet, across the spaces OCR added', () => {
    const s = snippetOf('ผู้เช่าต้องชำระ ค่า เช่า ภายในวันที่ 5 ของทุกเดือน', 'ค่าเช่าภายใน');
    expect(s.highlights).toHaveLength(1);
    const [a, b] = s.highlights[0]!;
    expect(s.text.slice(a, b)).toBe('ค่า เช่า ภายใน');
  });

  it('finds a near match without Thai marks and highlights it', () => {
    expect(skeleton(fold('เครื่องพิมพ์'))).toBe(skeleton(fold('เครืองพิมพ')));
    const s = snippetOf('สัญญาเช่า เครื่องพิมพ์ออฟเซ็ต', 'เครืองพิมพ');
    const [a, b] = s.highlights[0]!;
    expect(s.text.slice(a, b)).toBe('เครื่องพิมพ');
  });

  it('marks the longest shared run of a fuzzy match', () => {
    const s = snippetOf('ผู้เช่าเพื่อเช่าเครื่องพิมพ์ออฟเซ็ต Heidelberg', 'ค่าเชาเครืองพิมพ');
    const [a, b] = s.highlights[0]!;
    expect(s.text.slice(a, b)).toBe('เช่าเครื่องพิมพ');
    expect(longestCommon('abcdef', 'zcdez')).toEqual({ at: 2, length: 3 });
  });

  it('highlights each word of a several-word query', () => {
    const s = snippetOf('Either party may terminate this lease with ninety days notice.', 'terminate notice');
    expect(s.highlights.map(([a, b]) => s.text.slice(a, b))).toEqual(['terminate', 'notice']);
  });

  it('cuts a long chunk to a window around the match', () => {
    const long = `${'ก'.repeat(500)} เลขที่ CT-2569-0142 ${'ข'.repeat(500)}`;
    const s = snippetOf(long, 'CT-2569-0142');
    expect(s.text.length).toBeLessThan(320);
    expect(s.text.startsWith('… ')).toBe(true);
    const [a, b] = s.highlights[0]!;
    expect(s.text.slice(a, b)).toBe('CT-2569-0142');
  });
});

describe('chunking (D-427)', () => {
  it('keeps pages apart and folds each chunk', () => {
    const chunks = chunkPages([
      { page: 1, text: 'หน้า หนึ่ง', ocr: false },
      { page: 2, text: '   ', ocr: false },
      { page: 3, text: 'Page three', ocr: true },
    ]);
    expect(chunks.map((c) => [c.chunkIndex, c.page, c.ocr, c.searchText])).toEqual([
      [0, 1, false, 'หน้าหนึ่ง'],
      [1, 3, true, 'pagethree'],
    ]);
  });

  it('splits long text on line breaks with an overlap', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `บรรทัดที่ ${i} ข้อความทดสอบการแบ่งส่วน`);
    const parts = splitText(lines.join('\n'));
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(CHUNK_CHARS);
    expect(parts.join('\n')).toContain('บรรทัดที่ 59');
  });

  it('stops at the character budget', () => {
    const chunks = chunkPages(
      [{ page: 1, text: `${'ก '.repeat(600)}${'ข '.repeat(1900)}`, ocr: false }],
      1200,
    );
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => c.content.includes('ข'))).toBe(false);
  });
});

describe('what a file is', () => {
  it('trusts the first bytes over the declared type', () => {
    expect(kindOf(fixture('lease-text.pdf'), 'image/png', 'x.png')).toBe('pdf');
    expect(kindOf(fixture('lease-photo.jpg'), 'application/pdf', 'x.pdf')).toBe('image');
    expect(kindOf(fixture('spec.docx'), 'application/octet-stream', 'spec.docx')).toBe('docx');
    expect(kindOf(Buffer.from('PK\u0003\u0004junk'), 'application/zip', 'a.zip')).toBeNull();
    expect(kindOf(Buffer.from('hello'), 'application/octet-stream', 'notes.txt')).toBe('plain');
    expect(kindOf(Buffer.from('MZ'), 'application/x-msdownload', 'a.exe')).toBeNull();
  });

  it('rebuilds lines from Tesseract TSV and drops low-confidence noise', () => {
    const tsv = [
      'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
      '5\t1\t1\t1\t1\t1\t0\t0\t1\t1\t91\tสัญญา',
      '5\t1\t1\t1\t1\t2\t0\t0\t1\t1\t88\tเช่า',
      '5\t1\t1\t1\t1\t3\t0\t0\t1\t1\t95\tCT-2569',
      '5\t1\t1\t1\t2\t1\t0\t0\t1\t1\t12\tvo»',
      '5\t1\t2\t1\t1\t1\t0\t0\t1\t1\t90\tPage',
      '5\t1\t2\t1\t1\t2\t0\t0\t1\t1\t-1\t',
    ].join('\n');
    expect(fromTsv(tsv)).toEqual({ text: 'สัญญาเช่า CT-2569\n\nPage', confidence: 91 });
  });
});

withTools('reading documents (poppler + Tesseract)', () => {
  const reader = new DocumentTextExtractor();
  jest.setTimeout(120_000);

  it('reads a PDF text layer page by page', async () => {
    const r = await reader.extract(
      { bytes: fixture('lease-text.pdf'), mimeType: 'application/pdf', name: 'a.pdf' },
      OPTIONS,
    );
    expect(r).toMatchObject({ status: 'read', method: 'pdf_text', pageCount: 2, ocrPages: 0 });
    expect(fold(r.pages[0]!.text)).toContain(fold('สัญญาเช่าเครื่องจักร เลขที่ CT-2569-0142'));
    expect(fold(r.pages[1]!.text)).toContain(fold('ninety (90) days'));
  });

  it('reads a scanned PDF by OCR, Thai and English', async () => {
    const r = await reader.extract(
      { bytes: fixture('lease-scanned.pdf'), mimeType: 'application/pdf', name: 'b.pdf' },
      OPTIONS,
    );
    expect(r).toMatchObject({ status: 'read', method: 'pdf_ocr', pageCount: 2, ocrPages: 2 });
    expect(r.ocrConfidence).toBeGreaterThan(60);
    const all = fold(r.pages.map((p) => p.text).join('\n'));
    for (const phrase of [
      'เลขประจำตัวผู้เสียภาษี 0105561234567',
      'ค่าปรับร้อยละ 1.5',
      'Heidelberg Speedmaster',
    ])
      expect(all).toContain(fold(phrase));
  });

  it('honours the OCR page limit and the switch', async () => {
    const limited = await reader.extract(
      { bytes: fixture('lease-scanned.pdf'), mimeType: 'application/pdf', name: 'b.pdf' },
      { ...OPTIONS, ocrMaxPages: 1 },
    );
    expect(limited).toMatchObject({ ocrPages: 1, skippedPages: 1 });
    const off = await reader.extract(
      { bytes: fixture('lease-photo.jpg'), mimeType: 'image/jpeg', name: 'p.jpg' },
      { ...OPTIONS, ocr: false },
    );
    expect(off).toMatchObject({ status: 'unsupported', reason: 'ocr_off' });
  });

  it('reads a phone photo of a page', async () => {
    const r = await reader.extract(
      { bytes: fixture('lease-photo.jpg'), mimeType: 'image/jpeg', name: 'p.jpg' },
      OPTIONS,
    );
    expect(r).toMatchObject({ status: 'read', method: 'image_ocr', ocrPages: 1 });
    expect(fold(r.pages[0]!.text)).toContain(fold('สัญญาเช่าเครื่องจักร'));
  });

  it('reads Word with its page breaks, headers and tables', async () => {
    const r = await reader.extract(
      { bytes: fixture('spec.docx'), mimeType: 'application/octet-stream', name: 'spec.docx' },
      OPTIONS,
    );
    expect(r.method).toBe('docx');
    expect(r.pages.filter((p) => p.page !== null).map((p) => p.page)).toEqual([1, 2]);
    const all = r.pages.map((p) => p.text).join('\n');
    expect(all).toContain('แกรมผิว KA125');
    expect(all).toContain('ไม่น้อยกว่า 4.5 kN/m');
    expect(all).toContain('เอกสารควบคุม QF-07');
  });

  it('reads PowerPoint slide by slide and Excel sheet by sheet', async () => {
    const slides = await reader.extract(
      { bytes: fixture('review.pptx'), mimeType: 'x', name: 'review.pptx' },
      OPTIONS,
    );
    expect(slides.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(slides.pages[1]!.text).toContain('เปลี่ยนใบมีดตัด 3 ครั้ง');
    const book = await reader.extract(
      { bytes: fixture('prices.xlsx'), mimeType: 'x', name: 'prices.xlsx' },
      OPTIONS,
    );
    expect(book.pages.map((p) => [p.page, p.sheet])).toEqual([
      [1, 'ราคากระดาษ'],
      [2, 'Stock'],
    ]);
    expect(book.pages[0]!.text).toContain('KA | 125 | 21.5');
    expect(book.pages[1]!.text).toContain('Kraft liner roll 1.6 m | 42 | 84');
  });

  it('reads a Windows-874 CSV', async () => {
    const r = await reader.extract(
      { bytes: fixture('suppliers-tis620.csv'), mimeType: 'text/csv', name: 's.csv' },
      OPTIONS,
    );
    expect(r.pages[0]!.text).toContain('บริษัท ไทยเปเปอร์ จำกัด');
  });

  it('calls a file it cannot open unsupported', async () => {
    const r = await reader.extract(
      { bytes: Buffer.from('\xd0\xcf\x11\xe0legacy'), mimeType: 'application/msword', name: 'old.doc' },
      OPTIONS,
    );
    expect(r.status).toBe('unsupported');
  });
});
