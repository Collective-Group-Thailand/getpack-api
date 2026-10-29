import {
  decodePDFRawStream,
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  type PDFObject,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
} from 'pdf-lib';

import {
  emptyPaintFacts,
  IDENTITY,
  interpret,
  type Matrix,
  type ResourceResolver,
  type XObjectInfo,
} from './content-stream';
import {
  type Box,
  type ColourSpaceInfo,
  type FileFacts,
  type FontFact,
  normaliseBox,
  type PageFacts,
} from './facts';

/** Pages evaluated per file (technical bound; packaging artwork has one or two). */
export const MAX_PAGES = 20;

/**
 * Facts of a PDF through pdf-lib's object model and the content-stream interpreter (ADR-0009): page boxes,
 * fonts and whether their programs are embedded, placed images, colour usage, stroke widths, overprint
 * and text origins. Encrypted or unreadable files are reported, never passed.
 */
export async function pdfFacts(bytes: Uint8Array): Promise<FileFacts> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch {
    return { kind: 'error', reason: 'unreadable' };
  }
  if (doc.isEncrypted) return { kind: 'error', reason: 'encrypted' };
  try {
    const all = doc.getPages();
    const pages: PageFacts[] = [];
    for (const [index, page] of all.slice(0, MAX_PAGES).entries()) {
      const node = page.node;
      const media = boxOf(doc, node.MediaBox()) ?? [0, 0, page.getWidth(), page.getHeight()];
      const resources = node.Resources();
      const fonts: FontFact[] = [];
      const resolver = resolverFor(doc, resources, fonts, `p${index}`);
      const paint = emptyPaintFacts();
      interpret(contentOf(doc, node.Contents()), resolver, paint, IDENTITY);
      pages.push({
        page: index + 1,
        mediaBox: media,
        trimBox: boxOf(doc, node.TrimBox()),
        bleedBox: boxOf(doc, node.BleedBox()),
        images: paint.images,
        fonts: dedupeFonts(fonts),
        rgbPaintOps: paint.rgbPaintOps,
        spotNames: [...paint.spotNames].sort(),
        minStrokeWidthPt: paint.minStrokeWidthPt,
        overprint: paint.overprint,
        textOrigins: paint.textOrigins,
        texts: paint.texts,
        dieBox: paint.dieBox,
        dieNames: [...paint.dieNames].sort(),
        processPaint: paint.processPaint,
      });
    }
    return { kind: 'pdf', pages, pageCount: all.length, truncated: all.length > MAX_PAGES };
  } catch {
    return { kind: 'error', reason: 'unreadable' };
  }
}

function lookup(doc: PDFDocument, obj: PDFObject | undefined): PDFObject | undefined {
  return obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
}

function boxOf(doc: PDFDocument, obj: PDFObject | undefined): Box | null {
  const arr = lookup(doc, obj);
  if (!(arr instanceof PDFArray) || arr.size() !== 4) return null;
  const values = arr.asArray().map((v) => lookup(doc, v));
  if (!values.every((v) => v instanceof PDFNumber)) return null;
  return normaliseBox(values.map((v) => v.asNumber()));
}

function streamBytes(stream: PDFObject | undefined): Uint8Array {
  if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
  if (stream instanceof PDFStream) return stream.getContents();
  return new Uint8Array();
}

function contentOf(doc: PDFDocument, contents: PDFObject | undefined): Uint8Array {
  const value = lookup(doc, contents);
  if (value instanceof PDFArray) {
    const parts = value.asArray().map((p) => streamBytes(lookup(doc, p)));
    // Streams are concatenated with a separator so a token never spans two of them.
    return Buffer.concat(parts.flatMap((p) => [Buffer.from(p), Buffer.from('\n')]));
  }
  return streamBytes(value);
}

const nameOf = (obj: PDFObject | undefined) => (obj instanceof PDFName ? obj.decodeText() : null);

function dictEntry(doc: PDFDocument, dict: PDFDict | undefined, key: string): PDFObject | undefined {
  return dict ? lookup(doc, dict.get(PDFName.of(key))) : undefined;
}

function subDict(doc: PDFDocument, dict: PDFDict | undefined, key: string): PDFDict | undefined {
  const value = dictEntry(doc, dict, key);
  return value instanceof PDFDict ? value : undefined;
}

function colourSpaceOf(doc: PDFDocument, obj: PDFObject | undefined): ColourSpaceInfo {
  const value = lookup(doc, obj);
  const name = nameOf(value);
  if (name) {
    if (['DeviceRGB', 'CalRGB'].includes(name)) return { family: 'rgb' };
    if (name === 'DeviceCMYK') return { family: 'cmyk' };
    if (['DeviceGray', 'CalGray'].includes(name)) return { family: 'gray' };
    if (name === 'Pattern') return { family: 'pattern' };
    return { family: 'other' };
  }
  if (!(value instanceof PDFArray) || value.size() === 0) return { family: 'other' };
  const kind = nameOf(lookup(doc, value.get(0)));
  switch (kind) {
    case 'ICCBased': {
      const stream = lookup(doc, value.get(1));
      const dict = stream instanceof PDFStream ? stream.dict : undefined;
      const n = dictEntry(doc, dict, 'N');
      const components = n instanceof PDFNumber ? n.asNumber() : 0;
      return {
        family: components === 3 ? 'rgb' : components === 4 ? 'cmyk' : components === 1 ? 'gray' : 'other',
      };
    }
    case 'CalRGB':
      return { family: 'rgb' };
    case 'CalGray':
      return { family: 'gray' };
    case 'Lab':
      return { family: 'lab' };
    case 'Separation': {
      const colorant = nameOf(lookup(doc, value.get(1)));
      return {
        family: 'spot',
        spotNames: colorant && colorant !== 'All' && colorant !== 'None' ? [colorant] : [],
      };
    }
    case 'DeviceN': {
      const names = lookup(doc, value.get(1));
      const colorants =
        names instanceof PDFArray
          ? names
              .asArray()
              .map((n) => nameOf(lookup(doc, n)))
              .filter(
                (n): n is string => !!n && !['Cyan', 'Magenta', 'Yellow', 'Black', 'None', 'All'].includes(n),
              )
          : [];
      return { family: 'spot', spotNames: colorants };
    }
    case 'Indexed':
      return colourSpaceOf(doc, value.get(1));
    case 'Pattern':
      return { family: 'pattern' };
    default:
      return { family: 'other' };
  }
}

function fontFacts(doc: PDFDocument, fontsDict: PDFDict | undefined, into: FontFact[]): void {
  if (!fontsDict) return;
  for (const [, ref] of fontsDict.entries()) {
    const font = lookup(doc, ref);
    if (!(font instanceof PDFDict)) continue;
    const subtype = nameOf(dictEntry(doc, font, 'Subtype')) ?? 'Unknown';
    const base = (nameOf(dictEntry(doc, font, 'BaseFont')) ?? 'Unnamed').replace(/^[A-Z]{6}\+/, '');
    let descriptorOwner: PDFDict | undefined = font;
    if (subtype === 'Type0') {
      const descendants = dictEntry(doc, font, 'DescendantFonts');
      const first = descendants instanceof PDFArray ? lookup(doc, descendants.get(0)) : undefined;
      descriptorOwner = first instanceof PDFDict ? first : undefined;
    }
    const descriptor = subDict(doc, descriptorOwner, 'FontDescriptor');
    const embedded =
      subtype === 'Type3' ||
      ['FontFile', 'FontFile2', 'FontFile3'].some((k) => dictEntry(doc, descriptor, k) !== undefined);
    into.push({ name: base, subtype, embedded });
  }
}

function dedupeFonts(fonts: FontFact[]): FontFact[] {
  const seen = new Map<string, FontFact>();
  for (const f of fonts) {
    const key = `${f.name}|${f.subtype}`;
    const known = seen.get(key);
    seen.set(key, known ? { ...known, embedded: known.embedded && f.embedded } : f);
  }
  return [...seen.values()];
}

function resolverFor(
  doc: PDFDocument,
  resources: PDFDict | undefined,
  fonts: FontFact[],
  key: string,
): ResourceResolver {
  fontFacts(doc, subDict(doc, resources, 'Font'), fonts);
  const colourSpaces = subDict(doc, resources, 'ColorSpace');
  const xObjects = subDict(doc, resources, 'XObject');
  const states = subDict(doc, resources, 'ExtGState');
  const properties = subDict(doc, resources, 'Properties');
  return {
    // C12 (D-460): `/OC /name BDC` → the optional-content group's `/Name` (the layer name Illustrator writes).
    layerName: (name) => {
      const group = subDict(doc, properties, name);
      if (!group || nameOf(dictEntry(doc, group, 'Type')) !== 'OCG') return null;
      const label = dictEntry(doc, group, 'Name');
      return label instanceof PDFString || label instanceof PDFHexString ? label.decodeText() : null;
    },
    colourSpace: (name) => {
      const entry = dictEntry(doc, colourSpaces, name);
      return entry === undefined ? null : colourSpaceOf(doc, entry);
    },
    extGState: (name) => {
      const state = subDict(doc, states, name);
      if (!state) return null;
      const on = (k: string) => {
        const v = dictEntry(doc, state, k);
        return v instanceof PDFBool && v.asBoolean();
      };
      return { overprint: on('OP') || on('op') };
    },
    xObject: (name): XObjectInfo | null => {
      const raw = xObjects?.get(PDFName.of(name));
      const stream = lookup(doc, raw);
      if (!(stream instanceof PDFStream)) return null;
      const dict = stream.dict;
      const subtype = nameOf(dictEntry(doc, dict, 'Subtype'));
      if (subtype === 'Image') {
        const num = (k: string) => {
          const v = dictEntry(doc, dict, k);
          return v instanceof PDFNumber ? v.asNumber() : 0;
        };
        const mask = dictEntry(doc, dict, 'ImageMask');
        return {
          kind: 'image',
          widthPx: num('Width'),
          heightPx: num('Height'),
          colour: colourSpaceOf(doc, dict.get(PDFName.of('ColorSpace'))),
          imageMask: mask instanceof PDFBool && mask.asBoolean(),
        };
      }
      if (subtype === 'Form') {
        const matrixObj = dictEntry(doc, dict, 'Matrix');
        const matrix =
          matrixObj instanceof PDFArray && matrixObj.size() === 6
            ? (matrixObj.asArray().map((v) => {
                const n = lookup(doc, v);
                return n instanceof PDFNumber ? n.asNumber() : 0;
              }) as unknown as Matrix)
            : IDENTITY;
        const formKey = raw instanceof PDFRef ? raw.toString() : `${key}/${name}`;
        return {
          kind: 'form',
          key: formKey,
          matrix,
          resources: resolverFor(doc, subDict(doc, dict, 'Resources') ?? resources, fonts, formKey),
          content: streamBytes(stream),
        };
      }
      return null;
    },
  };
}
