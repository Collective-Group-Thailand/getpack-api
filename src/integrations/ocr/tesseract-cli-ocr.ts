import { spawn } from 'node:child_process';

import { type OcrLine, type OcrPort, type OcrResult } from './ocr.port';

/** Technical limits of the OCR call (not business values). */
const TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 4 * 1024 * 1024;

/**
 * Tesseract 5 through its CLI (`tesseract stdin stdout -l tha+eng tsv`): the image goes in on stdin, nothing touches
 * the disk, the TSV (one row per word with its confidence) is grouped into lines. Needs the `tesseract` binary and the
 * `tha` and `eng` trained data on the host (`TESSERACT_PATH`, default `tesseract`).
 */
export class TesseractCliOcr implements OcrPort {
  constructor(private readonly binary = 'tesseract') {}

  recognise(image: Buffer, languages: readonly string[]): Promise<OcrResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, ['stdin', 'stdout', '-l', languages.join('+'), '--psm', '3', 'tsv'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const out: Buffer[] = [];
      let size = 0;
      const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_OUTPUT) child.kill('SIGKILL');
        else out.push(chunk);
      });
      // stderr carries Tesseract's warnings only; never the image or its text (PDPA: nothing logged).
      child.stderr.resume();
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(`tesseract exited with ${code}`));
        resolve({ engine: 'tesseract_cli', lines: linesFromTsv(Buffer.concat(out).toString('utf8')) });
      });
      child.stdin.on('error', () => undefined);
      child.stdin.end(image);
    });
  }
}

/**
 * Groups Tesseract TSV words (level 5) into lines by block / paragraph / line number. Thai is written without spaces
 * between words, so two Thai words are joined unless the gap between their boxes is wider than a third of the line
 * height (a real space). Pure.
 */
export function linesFromTsv(tsv: string): OcrLine[] {
  interface Word {
    text: string;
    left: number;
    right: number;
    height: number;
  }
  const groups = new Map<string, { words: Word[]; conf: number[] }>();
  for (const row of tsv.split('\n').slice(1)) {
    const cols = row.split('\t');
    if (cols.length < 12 || cols[0] !== '5') continue;
    const text = cols[11]!.trim();
    const conf = Number(cols[10]);
    if (!text || conf < 0) continue;
    const key = `${cols[1]}.${cols[2]}.${cols[3]}.${cols[4]}`;
    const g = groups.get(key) ?? { words: [], conf: [] };
    const left = Number(cols[6]);
    g.words.push({ text, left, right: left + Number(cols[8]), height: Number(cols[9]) });
    g.conf.push(conf);
    groups.set(key, g);
  }
  const THAI_END = /[\u0E00-\u0E7F]$/;
  const THAI_START = /^[\u0E00-\u0E7F]/;
  return [...groups.values()].map((g) => ({
    text: g.words.reduce((acc, w, i) => {
      if (i === 0) return w.text;
      const prev = g.words[i - 1]!;
      const gap = w.left - prev.right;
      const thai = THAI_END.test(prev.text) && THAI_START.test(w.text);
      return thai && gap <= Math.max(prev.height, w.height) / 3 ? acc + w.text : `${acc} ${w.text}`;
    }, ''),
    confidence: Math.round(g.conf.reduce((a, b) => a + b, 0) / g.conf.length),
  }));
}
