import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  type PDFObject,
  PDFRawStream,
  PDFRef,
  PDFStream,
} from 'pdf-lib';

/**
 * Removes identifying metadata from a file without touching what it shows or prints (D-442, GLOBAL-RULES §1,
 * DECISIONS-STAGE-A §1 "Production access to originals"): EXIF (camera, GPS, capture time, owner), XMP, IPTC and
 * comments of photos; Info dictionary (author, creator, producer, title, subject, keywords, company), XMP and
 * application private data of PDFs. Everything is done at the container level — pixels, colour profiles and page
 * content are never re-encoded, so a print file prints exactly as before.
 *
 * Formats it cannot scrub safely (TIFF, SVG, PostScript / EPS, Illustrator, Photoshop, ZIP, video…) are reported as
 * `unsupported`, never guessed at: callers decide what that means (an open question for the business, D-442).
 */
export type ScrubFormat = 'jpeg' | 'png' | 'webp' | 'pdf';

export type ScrubFailure = 'unsupported_format' | 'encrypted' | 'signed' | 'unreadable' | 'too_large';

export type ScrubResult = { ok: true; format: ScrubFormat; body: Buffer } | { ok: false; reason: ScrubFailure };

/**
 * Technical ceiling for an in-memory scrub (the preflight's own limit, `MAX_PREFLIGHT_BYTES`): above it the file is
 * reported `too_large`, never half-processed. Not a business value.
 */
export const MAX_SCRUB_BYTES = 200 * 1024 * 1024;

class ScrubError extends Error {
  constructor(readonly reason: ScrubFailure) {
    super(reason);
  }
}

/** The format by its leading bytes — never by the declared MIME type or the file name. */
export function detectScrubFormat(body: Buffer): ScrubFormat | null {
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'jpeg';
  if (body.length >= 8 && body.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (
    body.length >= 12 &&
    body.toString('latin1', 0, 4) === 'RIFF' &&
    body.toString('latin1', 8, 12) === 'WEBP'
  )
    return 'webp';
  // A PDF header may follow up to 1 KiB of leading bytes (ISO 32000-1 §7.5.2, implementation note).
  if (body.subarray(0, 1024).includes('%PDF-')) return 'pdf';
  return null;
}

export interface ScrubOptions {
  /**
   * PDF/X print files must keep a `/Title` (ISO 15930): when the file declares PDF/X, the cleaned copy gets this
   * neutral title (e.g. the order code); otherwise the title is dropped like every other Info entry.
   */
  pdfxTitle?: string;
}

export async function scrubMetadata(body: Buffer, opts: ScrubOptions = {}): Promise<ScrubResult> {
  if (body.length > MAX_SCRUB_BYTES) return { ok: false, reason: 'too_large' };
  const format = detectScrubFormat(body);
  if (!format) return { ok: false, reason: 'unsupported_format' };
  try {
    const scrubbed =
      format === 'jpeg'
        ? scrubJpeg(body)
        : format === 'png'
          ? scrubPng(body)
          : format === 'webp'
            ? scrubWebp(body)
            : await scrubPdf(body, opts);
    return { ok: true, format, body: scrubbed };
  } catch (error) {
    return { ok: false, reason: error instanceof ScrubError ? error.reason : 'unreadable' };
  }
}

// --- JPEG --------------------------------------------------------------------------------------------------

/**
 * Keeps the image data and what decoding needs: APP0 (JFIF), APP2 `ICC_PROFILE` (colour), APP14 (Adobe: CMYK
 * transform) and every non-APP marker. Drops APP1 (EXIF and XMP: GPS, camera, owner, software), APP2 other than the
 * ICC profile (MPF / FlashPix), APP3–APP13 (IPTC, Photoshop resources), APP15, comments and everything after EOI
 * (MPF secondary images, vendor trailers — they carry their own EXIF). The EXIF orientation is kept as a one-tag
 * EXIF so a phone photo does not turn sideways.
 */
export function scrubJpeg(body: Buffer): Buffer {
  if (body[0] !== 0xff || body[1] !== 0xd8) throw new ScrubError('unreadable');
  const out: Buffer[] = [body.subarray(0, 2)];
  let exifAt = 1; // after SOI, or after a leading APP0
  let orientation: number | null = null;
  let i = 2;
  let first = true;
  while (i < body.length) {
    if (body[i] !== 0xff) throw new ScrubError('unreadable');
    let j = i + 1;
    while (j < body.length && body[j] === 0xff) j++; // fill bytes
    if (j >= body.length) break;
    const marker = body[j]!;
    if (marker === 0xd9) {
      out.push(Buffer.from([0xff, 0xd9]));
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(Buffer.from([0xff, marker]));
      i = j + 1;
      continue;
    }
    if (j + 3 > body.length) throw new ScrubError('unreadable');
    const length = body.readUInt16BE(j + 1);
    const end = j + 1 + length;
    if (length < 2 || end > body.length) throw new ScrubError('unreadable');
    const payload = body.subarray(j + 3, end);
    if (marker === 0xe1 && payload.toString('latin1', 0, 6) === 'Exif\0\0')
      orientation ??= exifOrientation(payload.subarray(6));
    if (keepJpegSegment(marker, payload)) {
      out.push(Buffer.from([0xff, marker]), body.subarray(j + 1, end));
      if (first && marker === 0xe0) exifAt = out.length;
    }
    first = false;
    i = end;
    if (marker === 0xda) {
      // Entropy-coded data runs to the next marker that is not a stuffed 0xFF00, a restart marker or fill.
      let k = end;
      while (k < body.length) {
        if (body[k] === 0xff && k + 1 < body.length) {
          const next = body[k + 1]!;
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7) || next === 0xff) {
            k += next === 0xff ? 1 : 2;
            continue;
          }
          break;
        }
        k++;
      }
      out.push(body.subarray(end, k));
      i = k;
    }
  }
  if (orientation !== null && orientation !== 1) out.splice(exifAt, 0, orientationExif(orientation));
  return Buffer.concat(out);
}

function keepJpegSegment(marker: number, payload: Buffer): boolean {
  if (marker === 0xfe) return false; // COM
  if (marker < 0xe0 || marker > 0xef) return true; // not an APPn: tables, frames, scans
  if (marker === 0xe0 || marker === 0xee) return true; // JFIF, Adobe
  if (marker === 0xe2) return payload.toString('latin1', 0, 12) === 'ICC_PROFILE\0';
  return false;
}

/** IFD0 tag 0x0112 of a TIFF-structured EXIF block; null when absent or malformed. */
function exifOrientation(tiff: Buffer): number | null {
  if (tiff.length < 8) return null;
  const order = tiff.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const u16 = (at: number) => (order === 'II' ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number) => (order === 'II' ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return null;
  const count = u16(ifd);
  for (let n = 0; n < count; n++) {
    const entry = ifd + 2 + n * 12;
    if (entry + 12 > tiff.length) return null;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/** APP1 with a minimal big-endian EXIF holding only the orientation tag. */
function orientationExif(orientation: number): Buffer {
  const b = Buffer.alloc(36);
  b.writeUInt16BE(0xffe1, 0);
  b.writeUInt16BE(34, 2);
  b.write('Exif\0\0', 4, 'latin1');
  b.write('MM', 10, 'latin1');
  b.writeUInt16BE(42, 12);
  b.writeUInt32BE(8, 14);
  b.writeUInt16BE(1, 18); // one entry
  b.writeUInt16BE(0x0112, 20); // Orientation
  b.writeUInt16BE(3, 22); // SHORT
  b.writeUInt32BE(1, 24);
  b.writeUInt16BE(orientation, 28);
  b.writeUInt32BE(0, 32); // no next IFD
  return b;
}

// --- PNG ---------------------------------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Text (author, software, comments), EXIF and the modification time; colour chunks (iCCP, sRGB, gAMA…) stay. */
const PNG_DROPPED = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

export function scrubPng(body: Buffer): Buffer {
  const out: Buffer[] = [PNG_SIGNATURE];
  let i = 8;
  while (i + 12 <= body.length) {
    const length = body.readUInt32BE(i);
    const type = body.toString('latin1', i + 4, i + 8);
    const end = i + 12 + length;
    if (end > body.length) throw new ScrubError('unreadable');
    if (!PNG_DROPPED.has(type)) out.push(body.subarray(i, end));
    i = end;
    if (type === 'IEND') return Buffer.concat(out); // trailing bytes after IEND go
  }
  throw new ScrubError('unreadable');
}

// --- WebP --------------------------------------------------------------------------------------------------

/** Drops the `EXIF` and `XMP ` chunks and clears their flags in `VP8X`; image, alpha, ICC and animation stay. */
export function scrubWebp(body: Buffer): Buffer {
  const declared = body.readUInt32LE(4) + 8;
  if (declared > body.length || declared < 12) throw new ScrubError('unreadable');
  const chunks: Buffer[] = [];
  let i = 12;
  while (i + 8 <= declared) {
    const fourcc = body.toString('latin1', i, i + 4);
    const size = body.readUInt32LE(i + 4);
    const end = i + 8 + size + (size % 2);
    if (i + 8 + size > declared) throw new ScrubError('unreadable');
    if (fourcc === 'VP8X' && size >= 1) {
      const chunk = Buffer.from(body.subarray(i, Math.min(end, declared)));
      chunk[8] = chunk[8]! & ~(0x08 | 0x04); // EXIF and XMP flags
      chunks.push(chunk);
    } else if (fourcc !== 'EXIF' && fourcc !== 'XMP ') {
      chunks.push(body.subarray(i, Math.min(end, declared)));
    }
    i = end;
  }
  const payload = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(payload.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  return Buffer.concat([header, payload]);
}

// --- PDF ---------------------------------------------------------------------------------------------------

/** Info entries a PDF/X file needs (ISO 15930): its conformance, trapping and dates — no identity. */
const PDFX_INFO_KEYS = ['GTS_PDFXVersion', 'GTS_PDFXConformance', 'Trapped', 'CreationDate', 'ModDate'];

const KEY = {
  metadata: PDFName.of('Metadata'),
  pieceInfo: PDFName.of('PieceInfo'),
  subtype: PDFName.of('Subtype'),
  widget: PDFName.of('Widget'),
  rect: PDFName.of('Rect'),
  author: PDFName.of('T'),
  filter: PDFName.of('Filter'),
  dct: PDFName.of('DCTDecode'),
};

/**
 * Removes the document information dictionary (Title, Author, Subject, Keywords, Creator, Producer, Company, dates),
 * every XMP `/Metadata` stream (document, pages, images, fonts), application private data (`/PieceInfo`: Illustrator,
 * Photoshop…), the author (`/T`) of comment annotations, and EXIF / XMP inside embedded JPEG images; then drops every
 * object no longer reachable from the catalog (older revisions of an incrementally saved file keep old metadata in
 * orphaned objects). Page content, fonts, images and colour spaces are written back unchanged. Encrypted PDFs are
 * refused (`encrypted`): they cannot be rewritten without the password.
 */
export async function scrubPdf(body: Buffer, opts: ScrubOptions = {}): Promise<Buffer> {
  let doc: PDFDocument;
  try {
    // Loaded with `ignoreEncryption` only to tell an encrypted file apart (pdf-lib's error class is not reliable
    // across its ES5 build); an encrypted file is never rewritten.
    doc = await PDFDocument.load(body, {
      updateMetadata: false,
      throwOnInvalidObject: false,
      ignoreEncryption: true,
    });
  } catch {
    throw new ScrubError('unreadable');
  }
  if (doc.isEncrypted) throw new ScrubError('encrypted');
  // Rewriting a digitally signed PDF would break its signatures: refused, never rewritten.
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    const dict = object instanceof PDFStream ? object.dict : object instanceof PDFDict ? object : null;
    if (dict?.has(PDFName.of('ByteRange'))) throw new ScrubError('signed');
  }
  const context = doc.context;
  // A lenient parse of something that is not really a PDF yields an empty document: never hand that out instead.
  const pages = pageCount(doc);
  if (!(context.lookup(context.trailerInfo.Root) instanceof PDFDict) || pages === 0)
    throw new ScrubError('unreadable');
  // PDF/X (print) declares itself in the Info dictionary; those keys and the dates it requires stay, nothing else.
  const info = context.lookup(context.trailerInfo.Info);
  const kept =
    info instanceof PDFDict && info.has(PDFName.of('GTS_PDFXVersion'))
      ? PDFX_INFO_KEYS.flatMap((key) => {
          const value = info.get(PDFName.of(key));
          return value && !(value instanceof PDFRef) ? [[key, value] as const] : [];
        })
      : [];
  context.trailerInfo.Info = undefined;
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    scrubObject(object);
    if (object instanceof PDFRawStream && object.dict.get(KEY.filter) === KEY.dct) {
      try {
        const jpeg = scrubJpeg(Buffer.from(object.contents));
        context.assign(ref, PDFRawStream.of(object.dict, jpeg));
      } catch {
        // Not a parseable JPEG stream: left as it is (the viewer could not decode it either).
      }
    }
  }
  const reachable = new Set<string>();
  const visit = (object: PDFObject | undefined): void => {
    if (object instanceof PDFRef) {
      if (reachable.has(object.tag)) return;
      reachable.add(object.tag);
      visit(context.lookup(object));
    } else if (object instanceof PDFDict) {
      for (const [, value] of object.entries()) visit(value);
    } else if (object instanceof PDFArray) {
      for (const value of object.asArray()) visit(value);
    } else if (object instanceof PDFStream) {
      visit(object.dict);
    }
  };
  visit(context.trailerInfo.Root);
  for (const [ref] of context.enumerateIndirectObjects()) if (!reachable.has(ref.tag)) context.delete(ref);
  if (kept.length > 0) {
    const pdfx = context.obj({});
    for (const [key, value] of kept) pdfx.set(PDFName.of(key), value);
    if (opts.pdfxTitle) pdfx.set(PDFName.of('Title'), PDFHexString.fromText(opts.pdfxTitle));
    context.trailerInfo.Info = context.register(pdfx);
  }
  const out = Buffer.from(
    await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false }),
  );
  // The result must still open with every page (a scrub never loses content).
  const check = await PDFDocument.load(out, { updateMetadata: false }).catch(() => null);
  if (!check || pageCount(check) !== pages) throw new ScrubError('unreadable');
  return out;
}

function pageCount(doc: PDFDocument): number {
  try {
    return doc.getPageCount();
  } catch {
    return 0;
  }
}

/** Deletes metadata keys on a dictionary and the direct dictionaries / arrays inside it. */
function scrubObject(object: PDFObject | undefined): void {
  const dict = object instanceof PDFStream ? object.dict : object instanceof PDFDict ? object : null;
  if (dict) {
    dict.delete(KEY.metadata);
    dict.delete(KEY.pieceInfo);
    // A comment's `/T` is its author; a form field widget's `/T` is the field name (kept).
    const subtype = dict.get(KEY.subtype);
    if (subtype instanceof PDFName && subtype !== KEY.widget && dict.has(KEY.rect)) dict.delete(KEY.author);
    for (const [, value] of dict.entries()) if (!(value instanceof PDFRef)) scrubObject(value);
  } else if (object instanceof PDFArray) {
    for (const value of object.asArray()) if (!(value instanceof PDFRef)) scrubObject(value);
  }
}
