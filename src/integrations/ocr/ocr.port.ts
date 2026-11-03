/** D-468: optical character recognition of business-card photos (agent zone "สแกนนามบัตร"). */
export const OCR = Symbol('OCR');

export interface OcrLine {
  text: string;
  /** 0–100, the mean word confidence of the line. */
  confidence: number;
}

export interface OcrResult {
  lines: OcrLine[];
  /** Which adapter read it (`tesseract_cli`, `fake`). */
  engine: string;
}

export interface OcrPort {
  /** Reads an image (PNG / JPEG / WebP bytes) in the given Tesseract languages (`tha`, `eng`). */
  recognise(image: Buffer, languages: readonly string[]): Promise<OcrResult>;
}
