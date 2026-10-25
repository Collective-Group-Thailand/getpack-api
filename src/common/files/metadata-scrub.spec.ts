import { type PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';

import { detectScrubFormat, scrubJpeg, scrubMetadata, scrubPdf, scrubPng, scrubWebp } from './metadata-scrub';

/** Obviously fake identities that must not survive (D-442). */
const LEAKS = ['Fake Factory Co (fake)', 'Fake Customer Somchai', 'FakeCam 9000', 'Fake Company Ltd'];

function noLeak(body: Buffer): void {
  const text = body.toString('latin1');
  for (const leak of LEAKS) expect(text).not.toContain(leak);
}

/** A minimal TIFF-structured EXIF block (big-endian) with Orientation, Artist and Make. */
function exifBlock(orientation: number): Buffer {
  const strings = Buffer.from(`${LEAKS[1]}\0${LEAKS[2]}\0`, 'latin1');
  const entries = 3;
  const ifdSize = 2 + entries * 12 + 4;
  const tiff = Buffer.alloc(8 + ifdSize);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(entries, 8);
  const dataAt = 8 + ifdSize;
  const entry = (n: number, tag: number, type: number, count: number, value: number) => {
    const at = 10 + n * 12;
    tiff.writeUInt16BE(tag, at);
    tiff.writeUInt16BE(type, at + 2);
    tiff.writeUInt32BE(count, at + 4);
    if (type === 3) tiff.writeUInt16BE(value, at + 8);
    else tiff.writeUInt32BE(value, at + 8);
  };
  entry(0, 0x010f, 2, LEAKS[2]!.length + 1, dataAt + LEAKS[1]!.length + 1); // Make
  entry(1, 0x0112, 3, 1, orientation); // Orientation
  entry(2, 0x013b, 2, LEAKS[1]!.length + 1, dataAt); // Artist
  return Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff, strings]);
}

function segment(marker: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xff00 | marker, 0);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/** A real JPEG with EXIF (orientation 6), XMP, IPTC, a comment, an ICC profile and a trailing second image. */
async function jpegWithMetadata(): Promise<{ jpeg: Buffer; plain: Buffer }> {
  const plain = await sharp({ create: { width: 8, height: 4, channels: 3, background: '#c03' } })
    .jpeg()
    .toBuffer();
  const xmp = Buffer.from(
    `http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><dc:creator>${LEAKS[0]}</dc:creator></x:xmpmeta>`,
    'latin1',
  );
  const iptc = Buffer.from(`Photoshop 3.0\0${LEAKS[3]}`, 'latin1');
  const icc = Buffer.concat([Buffer.from('ICC_PROFILE\0\x01\x01', 'latin1'), Buffer.alloc(16, 7)]);
  const jpeg = Buffer.concat([
    plain.subarray(0, 2),
    segment(0xe1, exifBlock(6)),
    segment(0xe1, xmp),
    segment(0xe2, icc),
    segment(0xed, iptc),
    segment(0xfe, Buffer.from(LEAKS[3]!, 'latin1')),
    plain.subarray(2),
    // A trailing "second image" (MPF style) carrying its own EXIF.
    Buffer.from([0xff, 0xd8]),
    segment(0xe1, exifBlock(1)),
    Buffer.from([0xff, 0xd9]),
  ]);
  return { jpeg, plain };
}

describe('metadata scrub (D-442, GLOBAL-RULES §1)', () => {
  it('detects formats by their bytes, not by name or MIME type', async () => {
    const { jpeg } = await jpegWithMetadata();
    expect(detectScrubFormat(jpeg)).toBe('jpeg');
    expect(detectScrubFormat(await sharp(jpeg).png().toBuffer())).toBe('png');
    expect(detectScrubFormat(await sharp(jpeg).webp().toBuffer())).toBe('webp');
    expect(detectScrubFormat(Buffer.from('%PDF-1.7\n'))).toBe('pdf');
    expect(detectScrubFormat(Buffer.from('%!PS-Adobe-3.0 EPSF-3.0'))).toBeNull();
    expect(detectScrubFormat(Buffer.from('PK\x03\x04'))).toBeNull();
    expect(detectScrubFormat(Buffer.from('8BPS'))).toBeNull();
  });

  it('JPEG: drops EXIF / GPS, XMP, IPTC, comments and trailing images; keeps pixels, ICC and the orientation', async () => {
    const { jpeg, plain } = await jpegWithMetadata();
    expect(jpeg.toString('latin1')).toContain(LEAKS[1]);
    const out = scrubJpeg(jpeg);
    noLeak(out);
    expect(out.toString('latin1')).toContain('ICC_PROFILE');
    const meta = await sharp(out).metadata();
    expect(meta).toMatchObject({ width: 8, height: 4, orientation: 6 });
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
    // Pixels are untouched: the entropy-coded data is copied byte for byte.
    const pixels = async (b: Buffer) => (await sharp(b).raw().toBuffer()).toString('hex');
    expect(await pixels(out)).toBe(await pixels(plain));
    // Idempotent.
    expect(scrubJpeg(out).equals(out)).toBe(true);
  });

  it('JPEG without an orientation keeps no EXIF at all', async () => {
    const plain = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000' } })
      .jpeg()
      .toBuffer();
    const withExif = Buffer.concat([plain.subarray(0, 2), segment(0xe1, exifBlock(1)), plain.subarray(2)]);
    const out = scrubJpeg(withExif);
    expect(out.toString('latin1')).not.toContain('Exif');
    noLeak(out);
  });

  it('PNG: drops text, EXIF and time chunks; keeps image data', async () => {
    const png = await sharp({ create: { width: 3, height: 3, channels: 4, background: '#0a0' } })
      .withExif({ IFD0: { Artist: LEAKS[1]!, Make: LEAKS[2]! } })
      .withXmp(`<x:xmpmeta><dc:creator>${LEAKS[0]}</dc:creator></x:xmpmeta>`)
      .png()
      .toBuffer();
    expect(png.toString('latin1')).toContain(LEAKS[1]);
    const out = scrubPng(png);
    noLeak(out);
    const meta = await sharp(out).metadata();
    expect(meta).toMatchObject({ width: 3, height: 3 });
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
  });

  it('WebP: drops EXIF and XMP chunks and their VP8X flags', async () => {
    const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#00f' } })
      .withExif({ IFD0: { Artist: LEAKS[1]! } })
      .withXmp(`<x:xmpmeta><dc:creator>${LEAKS[0]}</dc:creator></x:xmpmeta>`)
      .webp()
      .toBuffer();
    expect(webp.toString('latin1')).toContain(LEAKS[1]);
    const out = scrubWebp(webp);
    noLeak(out);
    expect(out.readUInt32LE(4) + 8).toBe(out.length);
    const meta = await sharp(out).metadata();
    expect(meta).toMatchObject({ width: 4, height: 4 });
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
  });

  it('PDF: drops Info, XMP, PieceInfo, comment authors, old revisions and EXIF in embedded JPEGs; keeps pages', async () => {
    const { jpeg } = await jpegWithMetadata();
    const doc = await PDFDocument.create();
    doc.setTitle(LEAKS[1]!);
    doc.setAuthor(LEAKS[1]!);
    doc.setCreator(LEAKS[0]!);
    doc.setProducer(LEAKS[0]!);
    doc.setSubject(LEAKS[3]!);
    doc.setKeywords([LEAKS[3]!]);
    const page = doc.addPage([200, 200]);
    page.drawText('Artwork', { x: 10, y: 10, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
    page.drawImage(await doc.embedJpg(new Uint8Array(jpeg)), { x: 20, y: 40, width: 80, height: 40 });
    const ctx = doc.context;
    const xmp = ctx.register(
      ctx.stream(`<x:xmpmeta><dc:creator>${LEAKS[0]}</dc:creator></x:xmpmeta>`, {
        Type: 'Metadata',
        Subtype: 'XML',
      }),
    );
    doc.catalog.set(PDFName.of('Metadata'), xmp);
    page.node.set(PDFName.of('Metadata'), xmp);
    page.node.set(
      PDFName.of('PieceInfo'),
      ctx.obj({ Illustrator: { Private: ctx.obj({ Owner: LEAKS[3]! }) } }),
    );
    const note = ctx.register(
      ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [0, 0, 10, 10], T: LEAKS[1]!, Contents: 'ok' }),
    );
    page.node.set(PDFName.of('Annots'), ctx.obj([note]));
    // An orphan left by an older revision.
    ctx.register(ctx.obj({ Author: LEAKS[2]! }));
    const pdf = Buffer.from(await doc.save({ useObjectStreams: false }));
    expect(pdf.toString('latin1')).toContain(LEAKS[0]);

    const out = await scrubPdf(pdf);
    noLeak(out);
    expect(out.toString('latin1')).not.toMatch(/\/Producer|\/Creator|\/Author|\/Title|\/Metadata|\/PieceInfo/);
    const again = await PDFDocument.load(out, { updateMetadata: false });
    expect(again.getPageCount()).toBe(1);
    expect(again.getTitle()).toBeUndefined();
    expect(again.getAuthor()).toBeUndefined();
    // The embedded image is still a decodable JPEG, without its EXIF.
    const image = [...again.context.enumerateIndirectObjects()]
      .map(([, o]) => o)
      .find((o) => o instanceof PDFRawStream && o.dict.get(PDFName.of('Filter')) === PDFName.of('DCTDecode'));
    expect(image).toBeDefined();
    const embedded = Buffer.from((image as PDFRawStream).contents);
    expect((await sharp(embedded).metadata()).width).toBe(8);
  });

  it('PDF/X keeps its conformance keys and gets the neutral title only', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage([100, 100]);
    doc.setTitle(LEAKS[1]!);
    doc.setAuthor(LEAKS[1]!);
    doc.setCreator(LEAKS[0]!);
    const info = doc.context.lookup(doc.context.trailerInfo.Info) as PDFDict;
    info.set(PDFName.of('GTS_PDFXVersion'), PDFString.of('PDF/X-1:2001'));
    info.set(PDFName.of('Trapped'), PDFName.of('False'));
    const pdf = Buffer.from(await doc.save({ useObjectStreams: false }));
    const result = await scrubMetadata(pdf, { pdfxTitle: 'DEVOR-2609-00001-original-v1' });
    expect(result.ok).toBe(true);
    const out = (result as { body: Buffer }).body;
    noLeak(out);
    const again = await PDFDocument.load(out, { updateMetadata: false });
    expect(again.getTitle()).toBe('DEVOR-2609-00001-original-v1');
    expect(again.getAuthor()).toBeUndefined();
    expect(out.toString('latin1')).toContain('GTS_PDFXVersion');
    // Without PDF/X the title goes too.
    const plainDoc = await PDFDocument.create();
    plainDoc.addPage([100, 100]);
    plainDoc.setTitle(LEAKS[1]!);
    const plain = await scrubMetadata(Buffer.from(await plainDoc.save()), { pdfxTitle: 'x' });
    expect(plain.ok).toBe(true);
    const reloaded = await PDFDocument.load((plain as { body: Buffer }).body, { updateMetadata: false });
    expect(reloaded.getTitle()).toBeUndefined();
  });

  it('reports what it cannot clean instead of guessing', async () => {
    expect(await scrubMetadata(Buffer.from('%!PS-Adobe-3.0 EPSF-3.0\n%%Creator: x'))).toEqual({
      ok: false,
      reason: 'unsupported_format',
    });
    expect(await scrubMetadata(Buffer.from('PK\x03\x04 zip'))).toEqual({ ok: false, reason: 'unsupported_format' });
    expect(await scrubMetadata(Buffer.from('%PDF-1.4\n% not really a pdf\n%%EOF\n'))).toEqual({
      ok: false,
      reason: 'unreadable',
    });
    const encrypted = Buffer.from(
      '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [4 0 R] /Count 1 >> endobj\n' +
        '4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >> endobj\n' +
        '3 0 obj << /Filter /Standard /V 1 /R 2 /O (x) /U (y) /P -4 >> endobj\n' +
        'trailer << /Root 1 0 R /Encrypt 3 0 R >>\n%%EOF\n',
    );
    expect(await scrubMetadata(encrypted)).toEqual({ ok: false, reason: 'encrypted' });
    const signedDoc = await PDFDocument.create();
    signedDoc.addPage([50, 50]);
    signedDoc.context.register(signedDoc.context.obj({ Type: 'Sig', ByteRange: [0, 10, 20, 30] }));
    expect(await scrubMetadata(Buffer.from(await signedDoc.save()))).toEqual({ ok: false, reason: 'signed' });
  });
});
