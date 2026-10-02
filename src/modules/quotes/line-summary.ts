import { type Tx } from '@database/prisma.service';
import { imageUrl } from '@modules/catalog/store/store-catalog.service';
import { type MeasurementBasis } from '@modules/specs/dimension-conversion';
import { type QuoteDimensions } from '@modules/specs/specs.service';

import { type LineSummaryDto, type SpecLineDto } from './line-summary.dto';

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

type Named = { publicId: string; th: string; en: string };
const LABELS = {
  style: ['แบบกล่อง', 'Style'],
  style_code: ['รหัสแบบ', 'Style code'],
  size: ['ขนาด (กว้าง × ยาว × ลึก)', 'Size (W × L × D)'],
  material: ['วัสดุ', 'Material'],
  print_front: ['พิมพ์ด้านนอก', 'Print (outside)'],
  print_back: ['พิมพ์ด้านใน', 'Print (inside)'],
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
  size: ['ขนาด (กว้าง × ยาว)', 'Size (W × L)'],
  print_front: ['พิมพ์ด้านหน้า', 'Print (front)'],
  print_back: ['พิมพ์ด้านหลัง', 'Print (back)'],
  coating_front: ['เคลือบด้านหน้า', 'Coating (front)'],
  coating_back: ['เคลือบด้านหลัง', 'Coating (back)'],
};

const mm = (n: number) => String(Number(n));
const uniq = (ids: (string | undefined)[]) => [...new Set(ids.filter((id): id is string => !!id))];

async function names(ids: string[], find: (ids: string[]) => Promise<Named[]>): Promise<Map<string, Named>> {
  return new Map((ids.length ? await find(ids) : []).map((r) => [r.publicId, r]));
}

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
    names(colours, async (ids) => (await db.inkColour.findMany(byIds(ids))).map(single)),
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
  const styleCode = (pattern as (Named & { code?: string | null }) | undefined)?.code;
  if (styleCode) push('style_code', styleCode, styleCode);
  const size = opts.flat ? `${mm(cfg.w)} × ${mm(cfg.l)}` : `${mm(cfg.w)} × ${mm(cfg.l)} × ${mm(cfg.d)}`;
  push('size', `${size} มม.`, `${size} mm`);
  const material = materials.get(cfg.materialId);
  if (material) push('material', material.th, material.en);

  parts.forEach((p, index) => {
    const sub = p.subPatternId ? subPatterns.get(p.subPatternId) : undefined;
    const part = parts.length > 1 ? { index, name: sub?.th ?? String(index + 1) } : undefined;
    const add = (key: LineKey) => (th: string, en: string) => push(key, th, en, part);
    list(
      inks,
      (p.printFront ?? []).map((c) => c.inkColourId),
      add('print_front'),
    );
    list(
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
  size: ['ขนาด (กว้าง × ยาว)', 'Size (W × L)'],
  material: ['วัสดุ', 'Material'],
  print_front: ['พิมพ์ด้านหน้า', 'Print (face)'],
  print_back: ['พิมพ์ด้านหลัง', 'Print (back)'],
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
    names(colours, async (ids) =>
      (await db.inkColour.findMany(byIds(ids))).map((r) => ({
        publicId: r.publicId,
        th: r.name,
        en: r.name,
      })),
    ),
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
  push('size', `${mm(cfg.w)} × ${mm(cfg.l)} มม.`, `${mm(cfg.w)} × ${mm(cfg.l)} mm`);
  list(materials, [cfg.materialId], 'material');
  list(inks, cfg.printFront?.inkColourIds ?? [], 'print_front');
  list(inks, cfg.printBack?.inkColourIds ?? [], 'print_back');
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
  const styleCode = (patterns.get(cfg.patternId) as (Named & { code?: string | null }) | undefined)?.code;
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
export function rfqSpecLines(
  schema: unknown,
  spec: Record<string, unknown>,
  dims: { lengthMm: number | null; widthMm: number | null; heightMm: number | null },
): SpecLineDto[] {
  const lines: SpecLineDto[] = [];
  const size = [dims.widthMm, dims.lengthMm, dims.heightMm];
  if (size.some((n) => n !== null)) {
    const value = size.map((n) => (n === null ? '—' : mm(n))).join(' × ');
    lines.push({
      key: 'size',
      labelTh: LABELS.size[0],
      labelEn: LABELS.size[1],
      valueTh: `${value} มม.`,
      valueEn: `${value} mm`,
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
    const th = typeof prop.title === 'string' ? prop.title : key;
    const en = typeof prop['x-title-en'] === 'string' ? prop['x-title-en'] : th;
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

const BASIS_LABELS: Record<MeasurementBasis, [string, string]> = {
  internal: ['ด้านใน', 'inside'],
  external: ['ด้านนอก', 'outside'],
  over_crease: ['วัดตามรอยพับ', 'over crease'],
  product: ['ขนาดชิ้นงาน', 'finished size'],
};

/**
 * The basis on the size line (D-182), and the inside size priced when the customer measured on another basis — what
 * the proof, the job sheet and the factory read. Lines without `dimensions` (older quotes) are left as they are.
 */
export function withBasisLines(lines: SpecLineDto[], dimensions: QuoteDimensions | null): SpecLineDto[] {
  if (!dimensions) return lines;
  const [th, en] = BASIS_LABELS[dimensions.basis];
  const out = lines.map((line) =>
    line.key === 'size'
      ? { ...line, valueTh: `${line.valueTh} (${th})`, valueEn: `${line.valueEn} (${en})` }
      : line,
  );
  if (dimensions.basis !== dimensions.pricedBasis) {
    const p = dimensions.priced;
    const size = `${mm(p.w)} × ${mm(p.l)} × ${mm(p.d)}`;
    const at = out.findIndex((line) => line.key === 'size');
    out.splice(at + 1, 0, {
      key: 'priced_size',
      labelTh: 'ขนาดด้านในที่ใช้คำนวณ',
      labelEn: 'Inside size priced',
      valueTh: `${size} มม.`,
      valueEn: `${size} mm`,
    });
  }
  return out;
}
