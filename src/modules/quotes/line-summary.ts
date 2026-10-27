import { type Tx } from '@database/prisma.service';
import { imageUrl } from '@modules/catalog/store/store-catalog.service';
import { type MeasurementBasis } from '@modules/specs/dimension-conversion';
import { type QuoteDimensions } from '@modules/specs/specs.service';

import { type LineSummaryDto, type SpecLineDto } from './line-summary.dto';
import { BASIS_TEXT, PRINT_SIDE_TEXT, type PrintInk, printMethodText, sizeValue } from './spec-label';

export { sizeText, type SpecLabel, specLabel } from './spec-label';

/**
 * Spec lines of a quote (U-B0.1): resolved from catalogue names when the quote is made and stored on it
 * (`quotes.spec_summary`, schema-design A-51), so a quotation, a cart line and an order read the same words
 * the customer saw, and the storefront never derives a spec from ids.
 */

interface ColourRef {
  inkColourId: string;
}
interface BoxPart {
  subPatternId?: string;
  printFront?: ColourRef[];
  printBack?: ColourRef[];
  /** Folding: coating per side and special finishes. */
  finish1FrontId?: string;
  finish1BackId?: string;
  finish2?: { finishId: string }[];
  /** Corrugate: coating per side. */
  coatingFrontId?: string;
  coatingBackId?: string;
  diecutTypeId?: string;
  assemblies?: { assemblyId: string }[];
}
/** The shape the box calculators share (folding, corrugate): a pattern, W × L × D, a material and parts. */
export interface BoxConfiguration {
  patternId: string;
  w: number;
  l: number;
  d: number;
  materialId: string;
  parts?: BoxPart[];
  design?: { graphic?: boolean; structure?: boolean };
}

/** A catalogue name; `code` is the style code of a pattern (D-184). */
type Named = { publicId: string; th: string; en: string; code?: string | null };
const LABELS = {
  style: ['แบบกล่อง', 'Style'],
  style_code: ['รหัสแบบ', 'Style code'],
  size: ['ขนาด (ยาว × กว้าง × สูง)', 'Size (L × W × H)'],
  material: ['วัสดุ', 'Material'],
  print_front: [PRINT_SIDE_TEXT.outside.th, PRINT_SIDE_TEXT.outside.en],
  print_back: [PRINT_SIDE_TEXT.inside.th, PRINT_SIDE_TEXT.inside.en],
  coating_front: ['เคลือบด้านนอก', 'Coating (outside)'],
  coating_back: ['เคลือบด้านใน', 'Coating (inside)'],
  special_finish: ['งานพิเศษ', 'Special finishes'],
  diecut: ['ไดคัท', 'Die-cut'],
  assembly: ['งานประกอบ', 'Assembly'],
  design_service: ['บริการออกแบบ', 'Design service'],
} as const;
type LineKey = keyof typeof LABELS;
/** A flat blank (tag & sleeve): W × L, printed front and back. */
const FLAT_LABELS: Partial<Record<LineKey, readonly [string, string]>> = {
  size: ['ขนาด (ยาว × กว้าง)', 'Size (L × W)'],
  print_front: [PRINT_SIDE_TEXT.front.th, PRINT_SIDE_TEXT.front.en],
  print_back: [PRINT_SIDE_TEXT.back.th, PRINT_SIDE_TEXT.back.en],
  coating_front: ['เคลือบด้านหน้า', 'Coating (front)'],
  coating_back: ['เคลือบด้านหลัง', 'Coating (back)'],
};

const mm = (n: number) => String(Number(n));
/** A catalogue ink with its kind, for the print method of a side (D-443). */
type Ink = Named & { kind: string };
const uniq = (ids: (string | undefined)[]) => [...new Set(ids.filter((id): id is string => !!id))];

async function names<T extends Named>(
  ids: string[],
  find: (ids: string[]) => Promise<T[]>,
): Promise<Map<string, T>> {
  return new Map((ids.length ? await find(ids) : []).map((r) => [r.publicId, r]));
}

/** A side's print line value (B-API-3): the method from the per-side model — CMYK / สีพิเศษ n สี / CMYK + สีพิเศษ n สี. */
function printLine(inks: Map<string, Ink>, ids: string[], push: (th: string, en: string) => void): void {
  const found = uniq(ids)
    .map((id) => inks.get(id))
    .filter((n): n is Ink => !!n)
    .map((n): PrintInk => ({ name: n.th, kind: n.kind }));
  const method = printMethodText(found);
  if (method) push(method.th, method.en);
}
const ink = (r: { publicId: string; name: string; colourKind: string }): Ink => ({
  publicId: r.publicId,
  th: r.name,
  en: r.name,
  kind: r.colourKind,
});

export async function boxSpecLines(
  db: Tx,
  cfg: BoxConfiguration,
  opts: { flat?: boolean } = {},
): Promise<SpecLineDto[]> {
  const parts = cfg.parts ?? [];
  const colours = uniq(
    parts.flatMap((p) => [...(p.printFront ?? []), ...(p.printBack ?? [])].map((c) => c.inkColourId)),
  );
  const finishes = uniq(
    parts.flatMap((p) => [
      p.finish1FrontId,
      p.finish1BackId,
      p.coatingFrontId,
      p.coatingBackId,
      ...(p.finish2 ?? []).map((f) => f.finishId),
    ]),
  );
  const single = (r: { publicId: string; name: string }) => ({
    publicId: r.publicId,
    th: r.name,
    en: r.name,
  });
  const pair = (r: { publicId: string; nameTh: string; nameEn: string }) => ({
    publicId: r.publicId,
    th: r.nameTh,
    en: r.nameEn,
  });
  const byIds = (ids: string[]) => ({ where: { publicId: { in: ids } } });
  const [patterns, subPatterns, materials, inks, finishNames, diecuts, assemblies] = await Promise.all([
    names([cfg.patternId], async (ids) =>
      (await db.pattern.findMany(byIds(ids))).map((r) => ({ ...single(r), code: r.styleCode })),
    ),
    names(uniq(parts.map((p) => p.subPatternId)), async (ids) =>
      (await db.subPattern.findMany(byIds(ids))).map(single),
    ),
    names([cfg.materialId], async (ids) => (await db.material.findMany(byIds(ids))).map(pair)),
    names(colours, async (ids) => (await db.inkColour.findMany(byIds(ids))).map(ink)),
    names(finishes, async (ids) => (await db.finish.findMany(byIds(ids))).map(pair)),
    names(uniq(parts.map((p) => p.diecutTypeId)), async (ids) =>
      (await db.diecutType.findMany(byIds(ids))).map(pair),
    ),
    names(uniq(parts.flatMap((p) => (p.assemblies ?? []).map((a) => a.assemblyId))), async (ids) =>
      (await db.assembly.findMany(byIds(ids))).map(pair),
    ),
  ]);

  const lines: SpecLineDto[] = [];
  const push = (key: LineKey, valueTh: string, valueEn: string, part?: { index: number; name: string }) => {
    const [labelTh, labelEn] = (opts.flat ? FLAT_LABELS[key] : undefined) ?? LABELS[key];
    lines.push({
      key: part ? `parts[${part.index}].${key}` : key,
      labelTh: part ? `${part.name} · ${labelTh}` : labelTh,
      labelEn: part ? `${part.name} · ${labelEn}` : labelEn,
      valueTh,
      valueEn,
    });
  };
  const list = (
    map: Map<string, Named>,
    ids: (string | undefined)[],
    push: (th: string, en: string) => void,
  ) => {
    const found = uniq(ids)
      .map((id) => map.get(id))
      .filter((n): n is Named => !!n);
    if (found.length) push(found.map((n) => n.th).join(', '), found.map((n) => n.en).join(', '));
  };

  const pattern = patterns.get(cfg.patternId);
  if (pattern) push('style', pattern.th, pattern.en);
  // D-184: the public style code travels with the spec to the cart, order, proof, job sheet and exports.
  const styleCode = pattern?.code;
  if (styleCode) push('style_code', styleCode, styleCode);
  const size = sizeValue({ l: cfg.l, w: cfg.w, d: opts.flat ? null : cfg.d });
  push('size', size.th, size.en);
  const material = materials.get(cfg.materialId);
  if (material) push('material', material.th, material.en);

  parts.forEach((p, index) => {
    const sub = p.subPatternId ? subPatterns.get(p.subPatternId) : undefined;
    const part = parts.length > 1 ? { index, name: sub?.th ?? String(index + 1) } : undefined;
    const add = (key: LineKey) => (th: string, en: string) => push(key, th, en, part);
    printLine(
      inks,
      (p.printFront ?? []).map((c) => c.inkColourId),
      add('print_front'),
    );
    printLine(
      inks,
      (p.printBack ?? []).map((c) => c.inkColourId),
      add('print_back'),
    );
    list(finishNames, [p.finish1FrontId ?? p.coatingFrontId], add('coating_front'));
    list(finishNames, [p.finish1BackId ?? p.coatingBackId], add('coating_back'));
    list(
      finishNames,
      (p.finish2 ?? []).map((f) => f.finishId),
      add('special_finish'),
    );
    list(diecuts, [p.diecutTypeId], add('diecut'));
    list(
      assemblies,
      (p.assemblies ?? []).map((a) => a.assemblyId),
      add('assembly'),
    );
  });

  const design = [
    cfg.design?.graphic ? (['กราฟิก', 'Graphic'] as const) : null,
    cfg.design?.structure ? (['โครงสร้าง', 'Structure'] as const) : null,
  ].filter((d) => d !== null);
  if (design.length) {
    push('design_service', design.map((d) => d[0]).join(', '), design.map((d) => d[1]).join(', '));
  }
  return lines;
}

/** A tag & sleeve configuration (U-B6 tag & sleeve): one flat blank, W × L, the folding processes of one part. */
export type TagSleeveSpecConfiguration = Omit<BoxConfiguration, 'd' | 'parts'> & BoxPart;

export function tagSleeveSpecLines(db: Tx, cfg: TagSleeveSpecConfiguration): Promise<SpecLineDto[]> {
  const { patternId, w, l, materialId, design, ...part } = cfg;
  return boxSpecLines(db, { patternId, w, l, d: 0, materialId, parts: [part], design }, { flat: true });
}

/** A label configuration (U-B6 label): W × L, a label stock, print and coating per side, a die-cut. */
export interface LabelSpecConfiguration {
  w: number;
  l: number;
  materialId: string;
  printFront?: { inkColourIds: string[] };
  printBack?: { inkColourIds: string[] };
  finishFrontId?: string;
  finishBackId?: string;
  diecutTypeId?: string;
  design?: { graphic?: boolean };
}

const LABEL_LINES = {
  size: ['ขนาด (ยาว × กว้าง)', 'Size (L × W)'],
  material: ['วัสดุ', 'Material'],
  print_front: [PRINT_SIDE_TEXT.front.th, 'Print (face)'],
  print_back: [PRINT_SIDE_TEXT.back.th, PRINT_SIDE_TEXT.back.en],
  coating_front: ['เคลือบด้านหน้า', 'Coating (face)'],
  coating_back: ['เคลือบด้านหลัง', 'Coating (back)'],
  diecut: ['ไดคัท', 'Die-cut'],
  design_service: ['บริการออกแบบ', 'Design service'],
} as const;

export async function labelSpecLines(db: Tx, cfg: LabelSpecConfiguration): Promise<SpecLineDto[]> {
  const byIds = (ids: string[]) => ({ where: { publicId: { in: ids } } });
  const colours = uniq([...(cfg.printFront?.inkColourIds ?? []), ...(cfg.printBack?.inkColourIds ?? [])]);
  const [materials, inks, finishes, diecuts] = await Promise.all([
    names([cfg.materialId], async (ids) =>
      (await db.material.findMany(byIds(ids))).map((r) => ({
        publicId: r.publicId,
        th: r.nameTh,
        en: r.nameEn,
      })),
    ),
    names(colours, async (ids) => (await db.inkColour.findMany(byIds(ids))).map(ink)),
    names(uniq([cfg.finishFrontId, cfg.finishBackId]), async (ids) =>
      (await db.finish.findMany(byIds(ids))).map((r) => ({
        publicId: r.publicId,
        th: r.nameTh,
        en: r.nameEn,
      })),
    ),
    names(uniq([cfg.diecutTypeId]), async (ids) =>
      (await db.diecutType.findMany(byIds(ids))).map((r) => ({
        publicId: r.publicId,
        th: r.nameTh,
        en: r.nameEn,
      })),
    ),
  ]);
  const lines: SpecLineDto[] = [];
  const push = (key: keyof typeof LABEL_LINES, valueTh: string, valueEn: string) => {
    const [labelTh, labelEn] = LABEL_LINES[key];
    lines.push({ key, labelTh, labelEn, valueTh, valueEn });
  };
  const list = (map: Map<string, Named>, ids: (string | undefined)[], key: keyof typeof LABEL_LINES) => {
    const found = uniq(ids)
      .map((id) => map.get(id))
      .filter((n): n is Named => !!n);
    if (found.length) push(key, found.map((n) => n.th).join(', '), found.map((n) => n.en).join(', '));
  };
  const size = sizeValue({ l: cfg.l, w: cfg.w });
  push('size', size.th, size.en);
  list(materials, [cfg.materialId], 'material');
  printLine(inks, cfg.printFront?.inkColourIds ?? [], (th, en) => push('print_front', th, en));
  printLine(inks, cfg.printBack?.inkColourIds ?? [], (th, en) => push('print_back', th, en));
  list(finishes, [cfg.finishFrontId], 'coating_front');
  list(finishes, [cfg.finishBackId], 'coating_back');
  list(diecuts, [cfg.diecutTypeId], 'diecut');
  if (cfg.design?.graphic) push('design_service', 'กราฟิก', 'Graphic');
  return lines;
}

/** A pouch configuration (U-B6 pouch): shape, W × L with its gussets, film, print colour set, options. */
export interface PouchSpecConfiguration {
  patternId: string;
  w: number;
  l: number;
  b?: number;
  s?: number;
  cs?: number;
  materialId: string;
  printColourId?: string;
  optionIds?: string[];
  design?: { graphic?: boolean };
}

const POUCH_LINES = {
  style: ['แบบซอง', 'Style'],
  style_code: ['รหัสแบบ', 'Style code'],
  size: ['ขนาด (กว้าง × สูง)', 'Size (W × H)'],
  gusset: ['ขยายข้าง / ก้น / ซีลกลาง', 'Gussets / centre seal'],
  material: ['วัสดุ', 'Material'],
  print: ['พิมพ์', 'Print'],
  option: ['อุปกรณ์เสริม', 'Options'],
  design_service: ['บริการออกแบบ', 'Design service'],
} as const;

export async function pouchSpecLines(db: Tx, cfg: PouchSpecConfiguration): Promise<SpecLineDto[]> {
  const byIds = (ids: string[]) => ({ where: { publicId: { in: ids } } });
  const pair = (r: { publicId: string; nameTh: string; nameEn: string }) => ({
    publicId: r.publicId,
    th: r.nameTh,
    en: r.nameEn,
  });
  const single = (r: { publicId: string; name: string }) => ({
    publicId: r.publicId,
    th: r.name,
    en: r.name,
  });
  const [patterns, materials, inks, options] = await Promise.all([
    names([cfg.patternId], async (ids) =>
      (await db.pattern.findMany(byIds(ids))).map((r) => ({ ...single(r), code: r.styleCode })),
    ),
    names([cfg.materialId], async (ids) => (await db.material.findMany(byIds(ids))).map(pair)),
    names(uniq([cfg.printColourId]), async (ids) => (await db.inkColour.findMany(byIds(ids))).map(single)),
    names(uniq(cfg.optionIds ?? []), async (ids) => (await db.assembly.findMany(byIds(ids))).map(pair)),
  ]);
  const lines: SpecLineDto[] = [];
  const push = (key: keyof typeof POUCH_LINES, valueTh: string, valueEn: string) => {
    const [labelTh, labelEn] = POUCH_LINES[key];
    lines.push({ key, labelTh, labelEn, valueTh, valueEn });
  };
  const list = (map: Map<string, Named>, ids: (string | undefined)[], key: keyof typeof POUCH_LINES) => {
    const found = uniq(ids)
      .map((id) => map.get(id))
      .filter((n): n is Named => !!n);
    if (found.length) push(key, found.map((n) => n.th).join(', '), found.map((n) => n.en).join(', '));
  };
  list(patterns, [cfg.patternId], 'style');
  const styleCode = patterns.get(cfg.patternId)?.code;
  if (styleCode) push('style_code', styleCode, styleCode);
  push('size', `${mm(cfg.w)} × ${mm(cfg.l)} มม.`, `${mm(cfg.w)} × ${mm(cfg.l)} mm`);
  const gussets = (
    [
      ['b', 'ก้น', 'bottom'],
      ['s', 'ข้าง', 'side'],
      ['cs', 'ซีลกลาง', 'centre seal'],
    ] as const
  ).filter(([k]) => cfg[k] !== undefined);
  if (gussets.length) {
    push(
      'gusset',
      gussets.map(([k, th]) => `${th} ${mm(cfg[k]!)} มม.`).join(', '),
      gussets.map(([k, , en]) => `${en} ${mm(cfg[k]!)} mm`).join(', '),
    );
  }
  list(materials, [cfg.materialId], 'material');
  list(inks, [cfg.printColourId], 'print');
  list(options, cfg.optionIds ?? [], 'option');
  if (cfg.design?.graphic) push('design_service', 'กราฟิก', 'Graphic');
  return lines;
}

/** A standard-product configuration (U-B6 standard product): the stock product and the design service. */
export interface StandardProductSpecConfiguration {
  stockProductId: string;
  design?: { graphic?: boolean };
}

export async function standardProductSpecLines(
  db: Tx,
  cfg: StandardProductSpecConfiguration,
): Promise<SpecLineDto[]> {
  const product = await db.stockProduct.findUnique({ where: { publicId: cfg.stockProductId } });
  const lines: SpecLineDto[] = [];
  if (product) {
    lines.push({
      key: 'product',
      labelTh: 'สินค้า',
      labelEn: 'Product',
      valueTh: `${product.nameTh} (${product.sku})`,
      valueEn: `${product.nameEn} (${product.sku})`,
    });
  }
  if (cfg.design?.graphic) {
    lines.push({
      key: 'design_service',
      labelTh: 'บริการออกแบบ',
      labelEn: 'Design service',
      valueTh: 'กราฟิก',
      valueEn: 'Graphic',
    });
  }
  return lines;
}

/** A service configuration (U-B6 service): the service item. */
export async function serviceSpecLines(db: Tx, cfg: { catalogProductId: string }): Promise<SpecLineDto[]> {
  const item = await db.catalogProduct.findUnique({ where: { publicId: cfg.catalogProductId } });
  return item
    ? [{ key: 'service', labelTh: 'บริการ', labelEn: 'Service', valueTh: item.nameTh, valueEn: item.nameEn }]
    : [];
}

type SchemaProperty = { title?: unknown; 'x-title-en'?: unknown };

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(', ');
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString();
  if (value === null || value === undefined) return '—';
  return JSON.stringify(value);
}

/**
 * Spec lines of an RFQ quote: the dimensions, then each spec field in the admin schema's order, labelled by
 * its JSON Schema `title` (Thai) and `x-title-en` (English), falling back to the field name.
 */
/** Labels for the spec keys RFQ forms and clients commonly send when the type's schema does not title them. */
const RFQ_SPEC_LABELS: Record<string, [string, string]> = {
  material: ['วัสดุ', 'Material'],
  materials: ['วัสดุ', 'Material'],
  paper: ['กระดาษ', 'Paper'],
  board: ['กระดาษ', 'Board'],
  flute: ['ลอน', 'Flute'],
  thickness: ['ความหนา', 'Thickness'],
  printing: ['การพิมพ์', 'Printing'],
  print: ['การพิมพ์', 'Printing'],
  colors: ['จำนวนสี', 'Colours'],
  colours: ['จำนวนสี', 'Colours'],
  finishing: ['งานตกแต่ง', 'Finishing'],
  finish: ['งานตกแต่ง', 'Finishing'],
  coating: ['การเคลือบ', 'Coating'],
  lamination: ['การเคลือบลามิเนต', 'Lamination'],
  structure: ['โครงสร้าง', 'Structure'],
  pattern: ['รูปแบบกล่อง', 'Box style'],
  ink_colour: ['สีพิมพ์', 'Ink colours'],
  print_type: ['การพิมพ์', 'Printing'],
  diecut: ['ไดคัท', 'Die-cut'],
  assembly: ['การประกอบ', 'Assembly'],
  style: ['แบบกล่อง', 'Style'],
  shape: ['รูปทรง', 'Shape'],
  closure: ['การปิด', 'Closure'],
  window: ['หน้าต่าง', 'Window'],
  insert: ['ไส้ใน', 'Insert'],
  handle: ['หูหิ้ว', 'Handle'],
  usage: ['การใช้งาน', 'Use'],
  use: ['การใช้งาน', 'Use'],
  product: ['สินค้าที่บรรจุ', 'Product inside'],
  weight: ['น้ำหนัก', 'Weight'],
  capacity: ['ความจุ', 'Capacity'],
  volume: ['ปริมาตร', 'Volume'],
  quantity: ['จำนวน', 'Quantity'],
  notes: ['หมายเหตุ', 'Notes'],
  note: ['หมายเหตุ', 'Notes'],
  remark: ['หมายเหตุ', 'Notes'],
  reference: ['ตัวอย่างอ้างอิง', 'Reference'],
};

/** `printColours` / `print_colours` → `Print colours`. */
function wordsOf(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase() : key;
}

export function rfqSpecLines(
  schema: unknown,
  spec: Record<string, unknown>,
  dims: { lengthMm: number | null; widthMm: number | null; heightMm: number | null },
): SpecLineDto[] {
  const lines: SpecLineDto[] = [];
  if ([dims.lengthMm, dims.widthMm, dims.heightMm].some((n) => n !== null)) {
    const value = sizeValue({ l: dims.lengthMm, w: dims.widthMm, d: dims.heightMm }, null, { missing: '—' });
    lines.push({
      key: 'size',
      labelTh: LABELS.size[0],
      labelEn: LABELS.size[1],
      valueTh: value.th,
      valueEn: value.en,
    });
  }
  const properties =
    (schema as { properties?: Record<string, SchemaProperty> } | null | undefined)?.properties ?? {};
  const keys = [
    ...Object.keys(properties).filter((k) => k in spec),
    ...Object.keys(spec).filter((k) => !(k in properties)),
  ];
  for (const key of keys) {
    const prop = properties[key] ?? {};
    const known = RFQ_SPEC_LABELS[key.toLowerCase()];
    const title = typeof prop.title === 'string' ? prop.title : null;
    // A key the schema does not title (a type with no schema, a client's own key): a known
    // label, else the key as words — never a raw `material` on a customer's quotation. A titled
    // key without an English title reads the Thai title in both languages, as the form does.
    const th = title ?? known?.[0] ?? wordsOf(key);
    const en =
      typeof prop['x-title-en'] === 'string' ? prop['x-title-en'] : (title ?? known?.[1] ?? wordsOf(key));
    const value = text(spec[key]);
    lines.push({ key, labelTh: th, labelEn: en, valueTh: value, valueEn: value });
  }
  return lines;
}

/** The rows a line summary is built from (a quote with its type and catalogue product). */
export interface SummarySource {
  specSummary: unknown;
  productType: { code: string; nameTh: string; nameEn: string };
  catalogProduct: {
    slug: string;
    nameTh: string;
    nameEn: string;
    images: { fileObject: { publicId: string } }[];
  } | null;
}

/** The include that gives a quote everything `lineSummary` reads. */
export const SUMMARY_INCLUDE = {
  productType: { select: { code: true, nameTh: true, nameEn: true } },
  catalogProduct: {
    select: {
      slug: true,
      nameTh: true,
      nameEn: true,
      images: { select: { fileObject: { select: { publicId: true } } }, orderBy: { sort: 'asc' }, take: 1 },
    },
  },
} as const;

export function lineSummary(source: SummarySource, unit: LineSummaryDto['unit']): LineSummaryDto {
  const p = source.catalogProduct;
  return {
    product: p
      ? {
          slug: p.slug,
          nameTh: p.nameTh,
          nameEn: p.nameEn,
          imageUrl: imageUrl(p.images[0]?.fileObject.publicId),
        }
      : null,
    productTypeCode: source.productType.code,
    productTypeNameTh: source.productType.nameTh,
    productTypeNameEn: source.productType.nameEn,
    unit,
    specs: Array.isArray(source.specSummary) ? (source.specSummary as SpecLineDto[]) : [],
  };
}

const BASIS_LABELS = BASIS_TEXT as Readonly<Record<MeasurementBasis, { th: string; en: string }>>;

/**
 * The basis on the size line (D-182), and the inside size priced when the customer measured on another basis — what
 * the proof, the job sheet and the factory read. Lines without `dimensions` (older quotes) are left as they are.
 */
export function withBasisLines(lines: SpecLineDto[], dimensions: QuoteDimensions | null): SpecLineDto[] {
  if (!dimensions) return lines;
  const { th, en } = BASIS_LABELS[dimensions.basis];
  const out = lines.map((line) =>
    line.key === 'size'
      ? { ...line, valueTh: `${line.valueTh} (${th})`, valueEn: `${line.valueEn} (${en})` }
      : line,
  );
  if (dimensions.basis !== dimensions.pricedBasis) {
    const size = sizeValue(dimensions.priced);
    const at = out.findIndex((line) => line.key === 'size');
    out.splice(at + 1, 0, {
      key: 'priced_size',
      labelTh: 'ขนาดด้านในที่ใช้คำนวณ',
      labelEn: 'Inside size priced',
      valueTh: size.th,
      valueEn: size.en,
    });
  }
  return out;
}

const BOX_CALCULATORS: ReadonlySet<string> = new Set(['folding', 'corrugate']);
/**
 * The spec lines of a calculator configuration (D-441): one dispatcher for every surface — saved quotes, carts and
 * orders (frozen on the quote), the "starting from" basis, the configurator's default spec and every store
 * calculation (configurator, Studio, hero) — so the same configuration always reads the same words. `dimensions`
 * adds the measuring basis and the inside size priced (D-182). Null for a calculator without spec lines.
 */
export async function specLinesFor(
  db: Tx,
  calculatorKey: string,
  configuration: Record<string, unknown>,
  dimensions: QuoteDimensions | null,
): Promise<SpecLineDto[] | null> {
  const cfg = configuration as unknown;
  const lines = BOX_CALCULATORS.has(calculatorKey)
    ? await boxSpecLines(db, cfg as BoxConfiguration)
    : calculatorKey === 'label'
      ? await labelSpecLines(db, cfg as LabelSpecConfiguration)
      : calculatorKey === 'tag_sleeve'
        ? await tagSleeveSpecLines(db, cfg as TagSleeveSpecConfiguration)
        : calculatorKey === 'pouch'
          ? await pouchSpecLines(db, cfg as PouchSpecConfiguration)
          : calculatorKey === 'standard_product'
            ? await standardProductSpecLines(db, cfg as StandardProductSpecConfiguration)
            : calculatorKey === 'service'
              ? await serviceSpecLines(db, cfg as { catalogProductId: string })
              : null;
  return lines ? withBasisLines(lines, dimensions) : null;
}
