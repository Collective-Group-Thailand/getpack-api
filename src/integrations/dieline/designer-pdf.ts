/**
 * The designer dieline PDF (U5.B4, D-302): a vector die for Illustrator / Acrobat with one optional-content layer and
 * one spot swatch (Separation colour space) per role, both named exactly — `CutContour`, `Crease`, `Perf`, `Glue`,
 * `Bleed`, `Safe` (and `HalfCut` only when the structure has half-cuts) — overprinting, on a page with TrimBox = the
 * dieline and BleedBox = + bleed. The document title names the style code, the style code is also in the Info
 * dictionary (`Subject`, `Keywords`, `PackioStyleCode`) and in XMP. Written here (not by the vendored engine, whose
 * bundle is pinned, ADR-0010) from the engine's geometry; deterministic (no dates) so a render is cached by content.
 */
export type Pt = [number, number];
/** A straight segment, or a cubic Bézier when `c1` / `c2` are set (millimetres, y down from the dieline's top-left). */
export interface Segment {
  from: Pt;
  to: Pt;
  c1?: Pt;
  c2?: Pt;
}
export type StrokeRole = 'cut' | 'crease' | 'perforation' | 'half_cut' | 'glue_area';

export interface DesignerPdfInput {
  widthMm: number;
  heightMm: number;
  marginMm?: number;
  /** Open paths per die role. */
  strokes: Partial<Record<StrokeRole, Segment[][]>>;
  /** Closed outlines of the bleed (the blank + bleed). */
  bleed: Pt[][];
  /** Closed outlines of the safe areas (each panel − the safe distance). */
  safe: Pt[][];
  title: string;
  styleCode: string;
  producer: string;
  keywords?: string[];
  bleedMm: number;
  safeMm: number;
}

interface LayerStyle {
  name: string;
  cmyk: [number, number, number, number];
  dash?: string;
  /** Present only when it has lines. */
  optional?: boolean;
}

/** D-302 layer = swatch names, in stacking order (the cut on top). */
export const DESIGNER_LAYERS: readonly (LayerStyle & { role: StrokeRole | 'bleed' | 'safe' })[] = [
  { name: 'Safe', role: 'safe', cmyk: [0, 0, 0, 0.4], dash: '2 2' },
  { name: 'Bleed', role: 'bleed', cmyk: [0.7, 0, 0, 0], dash: '1 2' },
  { name: 'Glue', role: 'glue_area', cmyk: [0, 0.3, 1, 0], dash: '2 1' },
  { name: 'HalfCut', role: 'half_cut', cmyk: [0, 1, 1, 0], dash: '4 1 1 1', optional: true },
  { name: 'Perf', role: 'perforation', cmyk: [0.8, 0, 1, 0], dash: '1 1' },
  { name: 'Crease', role: 'crease', cmyk: [1, 0.5, 0, 0], dash: '3 2' },
  { name: 'CutContour', role: 'cut', cmyk: [0, 1, 0, 0] },
];
export const DESIGNER_PDF_WRITER = 'packio-designer-pdf/1';

const PT_PER_MM = 72 / 25.4;
const STROKE_MM = 0.25;
const n = (v: number) => String(Math.round(v * 1000) / 1000);

/** UTF-16BE hex string (Thai titles). */
function pdfText(s: string): string {
  let hex = 'FEFF';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code > 0xffff) {
      const v = code - 0x10000;
      hex +=
        (0xd800 + (v >> 10)).toString(16).padStart(4, '0') +
        (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0');
    } else hex += code.toString(16).padStart(4, '0');
  }
  return `<${hex.toUpperCase()}>`;
}

const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function pathOps(path: Segment[]): string {
  if (path.length === 0) return '';
  const ops = [`${n(path[0]!.from[0])} ${n(path[0]!.from[1])} m`];
  let at = path[0]!.from;
  for (const s of path) {
    if (s.from[0] !== at[0] || s.from[1] !== at[1]) ops.push(`${n(s.from[0])} ${n(s.from[1])} m`);
    ops.push(
      s.c1 && s.c2
        ? `${n(s.c1[0])} ${n(s.c1[1])} ${n(s.c2[0])} ${n(s.c2[1])} ${n(s.to[0])} ${n(s.to[1])} c`
        : `${n(s.to[0])} ${n(s.to[1])} l`,
    );
    at = s.to;
  }
  return `${ops.join(' ')} S`;
}

const polygonOps = (poly: Pt[]) =>
  poly.length < 2 ? '' : `${poly.map((q, i) => `${n(q[0])} ${n(q[1])} ${i ? 'l' : 'm'}`).join(' ')} h S`;

function xmp(input: DesignerPdfInput, layers: string[], keywords: string): string {
  return [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"' +
      ' xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:packio="https://ns.packio.invalid/dieline/1.0/">',
    '<dc:format>application/pdf</dc:format>',
    `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xml(input.title)}</rdf:li></rdf:Alt></dc:title>`,
    `<dc:subject><rdf:Bag><rdf:li>${xml(input.styleCode)}</rdf:li></rdf:Bag></dc:subject>`,
    `<pdf:Keywords>${xml(keywords)}</pdf:Keywords>`,
    `<pdf:Producer>${xml(input.producer)}</pdf:Producer>`,
    '<xmp:CreatorTool>Packio</xmp:CreatorTool>',
    `<packio:styleCode>${xml(input.styleCode)}</packio:styleCode>`,
    `<packio:layers>${xml(layers.join(','))}</packio:layers>`,
    `<packio:bleedMm>${n(input.bleedMm)}</packio:bleedMm>`,
    `<packio:safeMm>${n(input.safeMm)}</packio:safeMm>`,
    '</rdf:Description></rdf:RDF></x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('\n');
}

export function writeDesignerPdf(input: DesignerPdfInput): Buffer {
  const margin = input.marginMm ?? 10;
  const k = PT_PER_MM;
  const pageW = (input.widthMm + margin * 2) * k;
  const pageH = (input.heightMm + margin * 2) * k;
  const content = new Map<string, string[]>();
  for (const layer of DESIGNER_LAYERS) {
    const ops =
      layer.role === 'bleed'
        ? input.bleed.map(polygonOps)
        : layer.role === 'safe'
          ? input.safe.map(polygonOps)
          : (input.strokes[layer.role] ?? []).map(pathOps);
    const lines = ops.filter(Boolean);
    if (layer.optional && lines.length === 0) continue;
    content.set(layer.name, lines);
  }
  const layers = DESIGNER_LAYERS.filter((l) => content.has(l.name));

  const objects: (string | Buffer)[] = [];
  const add = (body: string | Buffer) => objects.push(body);
  const catalog = add('');
  const pages = add('');
  const page = add('');
  const stream = add('');
  const gs = add('<< /Type /ExtGState /OP true /op true /OPM 1 >>');
  const tint = (c: number[]) =>
    `<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [${c.map(n).join(' ')}] /N 1 >>`;
  const separations = new Map(
    layers.map((l) => [l.name, add(`[/Separation /${l.name} /DeviceCMYK ${tint(l.cmyk)}]`)]),
  );
  const ocgs = new Map(layers.map((l) => [l.name, add(`<< /Type /OCG /Name ${pdfText(l.name)} >>`)]));
  const keywords = [
    'Packio dieline',
    input.styleCode,
    ...layers.map((l) => l.name),
    ...(input.keywords ?? []),
  ].join('; ');
  const metadataBody = Buffer.from(
    xmp(
      input,
      layers.map((l) => l.name),
      keywords,
    ),
    'utf8',
  );
  const metadata = add(
    Buffer.concat([
      Buffer.from(`<< /Type /Metadata /Subtype /XML /Length ${metadataBody.length} >>\nstream\n`),
      metadataBody,
      Buffer.from('\nendstream'),
    ]),
  );
  const info = add(
    `<< /Title ${pdfText(input.title)} /Subject ${pdfText(input.styleCode)} /Keywords ${pdfText(keywords)}` +
      ` /Creator (Packio) /Producer ${pdfText(input.producer)} /PackioStyleCode ${pdfText(input.styleCode)} >>`,
  );

  const ops = [`${n(k)} 0 0 ${n(-k)} ${n(margin * k)} ${n(pageH - margin * k)} cm`];
  for (const l of layers) {
    const dash = l.dash ? `[${l.dash}] 0 d` : '[] 0 d';
    ops.push(`/OC /${l.name} BDC q /GS0 gs /CS_${l.name} CS 1 SCN ${n(STROKE_MM)} w ${dash} 1 J 1 j`);
    ops.push(...content.get(l.name)!);
    ops.push('Q EMC');
  }
  const streamBody = Buffer.from(ops.join('\n'), 'utf8');
  objects[stream - 1] = Buffer.concat([
    Buffer.from(`<< /Length ${streamBody.length} >>\nstream\n`),
    streamBody,
    Buffer.from('\nendstream'),
  ]);
  const ids = [...ocgs.values()].map((id) => `${id} 0 R`).join(' ');
  objects[catalog - 1] =
    `<< /Type /Catalog /Pages ${pages} 0 R /Metadata ${metadata} 0 R` +
    ` /OCProperties << /OCGs [${ids}] /D << /Order [${ids}] /ON [${ids}] >> >> >>`;
  objects[pages - 1] = `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`;
  const trim = [margin * k, margin * k, pageW - margin * k, pageH - margin * k];
  const b = input.bleedMm;
  const bleedBox = [(margin - b) * k, (margin - b) * k, pageW - (margin - b) * k, pageH - (margin - b) * k];
  objects[page - 1] =
    `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${n(pageW)} ${n(pageH)}] /TrimBox [${trim.map(n).join(' ')}]` +
    ` /BleedBox [${bleedBox.map(n).join(' ')}] /Resources << /ExtGState << /GS0 ${gs} 0 R >>` +
    ` /ColorSpace << ${layers.map((l) => `/CS_${l.name} ${separations.get(l.name)} 0 R`).join(' ')} >>` +
    ` /Properties << ${layers.map((l) => `/${l.name} ${ocgs.get(l.name)} 0 R`).join(' ')} >> >>` +
    ` /Contents ${stream} 0 R >>`;

  const chunks: Buffer[] = [Buffer.from('%PDF-1.6\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  let offset = chunks[0]!.length;
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(offset);
    const chunk = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`),
      typeof body === 'string' ? Buffer.from(body, 'utf8') : body,
      Buffer.from('\nendobj\n'),
    ]);
    chunks.push(chunk);
    offset += chunk.length;
  });
  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
        offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
        `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(chunks);
}
