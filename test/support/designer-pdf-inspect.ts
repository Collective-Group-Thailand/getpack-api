import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString } from 'pdf-lib';

/** What a designer opening the dieline PDF sees (D-302): layers, spot swatches, boxes and metadata. */
export interface InspectedPdf {
  layers: string[];
  swatches: string[];
  title: string | undefined;
  subject: string | undefined;
  keywords: string | undefined;
  styleCode: string | undefined;
  xmp: string;
  trimBox: number[];
  bleedBox: number[];
}

const text = (v: unknown) =>
  v instanceof PDFHexString || v instanceof PDFString ? v.decodeText() : undefined;

export async function inspectDesignerPdf(bytes: Uint8Array): Promise<InspectedPdf> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const catalog = doc.catalog;
  const props = catalog.lookup(PDFName.of('OCProperties'), PDFDict);
  const ocgs = props.lookup(PDFName.of('OCGs'), PDFArray);
  const layers = ocgs.asArray().map((ref) => text(doc.context.lookup(ref, PDFDict).get(PDFName.of('Name')))!);
  const page = doc.getPage(0);
  const resources = page.node.Resources()!;
  const spaces = resources.lookup(PDFName.of('ColorSpace'), PDFDict);
  const swatches = spaces.values().map((ref) => {
    const cs = doc.context.lookup(ref, PDFArray);
    return (cs.get(1) as PDFName).decodeText();
  });
  const infoRef = doc.context.trailerInfo.Info;
  const info = doc.context.lookup(infoRef, PDFDict);
  const metadata = catalog.lookup(PDFName.of('Metadata')) as PDFRawStream;
  const box = (b: { x: number; y: number; width: number; height: number }) =>
    [b.x, b.y, b.x + b.width, b.y + b.height].map((v) => Math.round(v * 100) / 100);
  return {
    layers,
    swatches,
    title: text(info.get(PDFName.of('Title'))),
    subject: text(info.get(PDFName.of('Subject'))),
    keywords: text(info.get(PDFName.of('Keywords'))),
    styleCode: text(info.get(PDFName.of('GetpackStyleCode'))),
    xmp: Buffer.from(metadata.getContents()).toString('utf8'),
    trimBox: box(page.getTrimBox()),
    bleedBox: box(page.getBleedBox()),
  };
}
