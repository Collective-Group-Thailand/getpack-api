import { type OcrPort, type OcrResult } from './ocr.port';

/** Obviously fake card text (tests and local dev without Tesseract). */
export const FAKE_CARD_LINES = [
  'คุณมานี ใจดี',
  'ผู้จัดการฝ่ายจัดซื้อ',
  'บริษัท ตัวอย่างบรรจุภัณฑ์ จำกัด',
  'โทร 089-000-1234',
  'manee@example.invalid',
  'LINE: manee.cafe',
  'เลขประจำตัวผู้เสียภาษี 0000000000124',
];

export class FakeOcr implements OcrPort {
  constructor(private readonly lines: readonly string[] = FAKE_CARD_LINES) {}

  recognise(): Promise<OcrResult> {
    return Promise.resolve({ engine: 'fake', lines: this.lines.map((text) => ({ text, confidence: 90 })) });
  }
}
