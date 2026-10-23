import { randomBytes } from 'node:crypto';

import { AFRelationship, PDFArray, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';

import { SRGB_ICC_BASE64 } from './srgb-icc';

export interface PdfA3Options {
  title: string;
  author: string;
  subject?: string;
  createdAt: Date;
  /** Files carried inside the PDF (the e-Tax XML, D-430), with their relationship to the document. */
  attachments?: { name: string; mimeType: string; body: Buffer; description: string }[];
}

/** The byte-order mark XMP packets open with. */
const BOM = '\uFEFF';

const xmlEsc = (v: string) =>
  v.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** ISO 8601 with the offset, as XMP wants it (Bangkok time: the documents' own clock). */
function xmpDate(d: Date): string {
  const local = new Date(d.getTime() + 7 * 3600 * 1000);
  return `${local.toISOString().slice(0, 19)}+07:00`;
}

/**
 * Makes the renderer's PDF a PDF/A-3b file (ISO 19005-3), as e-Tax Invoice by Email requires (D-430): the sRGB
 * output intent, XMP metadata declaring the conformance and matching the document information, a file identifier,
 * and the attachments as associated files (`/AF`, relationship `Alternative`). Chromium already embeds every font
 * and uses no encryption or scripts, which PDF/A also requires.
 */
export async function toPdfA3(pdf: Buffer, opts: PdfA3Options): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const producer = 'getpack (Chromium, pdf-lib)';
  doc.setTitle(opts.title);
  doc.setAuthor(opts.author);
  if (opts.subject) doc.setSubject(opts.subject);
  doc.setProducer(producer);
  doc.setCreator('getpack');
  doc.setCreationDate(opts.createdAt);
  doc.setModificationDate(opts.createdAt);
  doc.setLanguage('th-TH');

  for (const a of opts.attachments ?? [])
    await doc.attach(a.body, a.name, {
      mimeType: a.mimeType,
      description: a.description,
      creationDate: opts.createdAt,
      modificationDate: opts.createdAt,
      afRelationship: AFRelationship.Alternative,
    });

  const ctx = doc.context;
  const icc = ctx.flateStream(Buffer.from(SRGB_ICC_BASE64, 'base64'), { N: 3 });
  const outputIntent = ctx.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
    Info: PDFString.of('sRGB IEC61966-2.1'),
    RegistryName: PDFString.of('http://www.color.org'),
    DestOutputProfile: ctx.register(icc),
  });
  doc.catalog.set(PDFName.of('OutputIntents'), ctx.obj([ctx.register(outputIntent)]));

  const xmp = `<?xpacket begin="${BOM}" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
<dc:format>application/pdf</dc:format>
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(opts.title)}</rdf:li></rdf:Alt></dc:title>
<dc:creator><rdf:Seq><rdf:li>${xmlEsc(opts.author)}</rdf:li></rdf:Seq></dc:creator>
${opts.subject ? `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(opts.subject)}</rdf:li></rdf:Alt></dc:description>` : ''}
<xmp:CreatorTool>getpack</xmp:CreatorTool>
<xmp:CreateDate>${xmpDate(opts.createdAt)}</xmp:CreateDate>
<xmp:ModifyDate>${xmpDate(opts.createdAt)}</xmp:ModifyDate>
<xmp:MetadataDate>${xmpDate(opts.createdAt)}</xmp:MetadataDate>
<pdf:Producer>${xmlEsc(producer)}</pdf:Producer>
<pdfaid:part>3</pdfaid:part>
<pdfaid:conformance>B</pdfaid:conformance>
</rdf:Description>
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  const metadata = ctx.stream(Buffer.from(xmp, 'utf8'), { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), ctx.register(metadata));

  const id = PDFHexString.of(randomBytes(16).toString('hex'));
  ctx.trailerInfo.ID = PDFArray.withContext(ctx);
  (ctx.trailerInfo.ID as PDFArray).push(id);
  (ctx.trailerInfo.ID as PDFArray).push(id);

  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
