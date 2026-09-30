import { type Tx } from '@database/prisma.service';
import { imageUrl } from '@modules/catalog/store/store-catalog.service';

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

const mm = (n: number) => String(Number(n));
const uniq = (ids: (string | undefined)[]) => [...new Set(ids.filter((id): id is string => !!id))];

async function names(
  ids: string[],
  find: (ids: string[]) => Promise<Named[]>,
): Promise<Map<string, Named>> {
  return new Map((ids.length ? await find(ids) : []).map((r) => [r.publicId, r]));
}

export async function boxSpecLines(db: Tx, cfg: BoxConfiguration): Promise<SpecLineDto[]> {
  const parts = cfg.parts ?? [];
  const colours = uniq(parts.flatMap((p) => [...(p.printFront ?? []), ...(p.printBack ?? [])].map((c) => c.inkColourId)));
  const finishes = uniq(
    parts.flatMap((p) => [
      p.finish1FrontId,
      p.finish1BackId,
      p.coatingFrontId,
      p.coatingBackId,
      ...(p.finish2 ?? []).map((f) => f.finishId),
    ]),
  );
  const single = (r: { publicId: string; name: string }) => ({ publicId: r.publicId, th: r.name, en: r.name });
  const pair = (r: { publicId: string; nameTh: string; nameEn: string }) => ({
    publicId: r.publicId,
    th: r.nameTh,
    en: r.nameEn,
  });
  const byIds = (ids: string[]) => ({ where: { publicId: { in: ids } } });
  const [patterns, subPatterns, materials, inks, finishNames, diecuts, assemblies] = await Promise.all([
    names([cfg.patternId], async (ids) => (await db.pattern.findMany(byIds(ids))).map(single)),
    names(uniq(parts.map((p) => p.subPatternId)), async (ids) => (await db.subPattern.findMany(byIds(ids))).map(single)),
    names([cfg.materialId], async (ids) => (await db.material.findMany(byIds(ids))).map(pair)),
    names(colours, async (ids) => (await db.inkColour.findMany(byIds(ids))).map(single)),
    names(finishes, async (ids) => (await db.finish.findMany(byIds(ids))).map(pair)),
    names(uniq(parts.map((p) => p.diecutTypeId)), async (ids) => (await db.diecutType.findMany(byIds(ids))).map(pair)),
    names(uniq(parts.flatMap((p) => (p.assemblies ?? []).map((a) => a.assemblyId))), async (ids) =>
      (await db.assembly.findMany(byIds(ids))).map(pair),
    ),
  ]);

  const lines: SpecLineDto[] = [];
  const push = (key: LineKey, valueTh: string, valueEn: string, part?: { index: number; name: string }) => {
    const [labelTh, labelEn] = LABELS[key];
    lines.push({
      key: part ? `parts[${part.index}].${key}` : key,
      labelTh: part ? `${part.name} · ${labelTh}` : labelTh,
      labelEn: part ? `${part.name} · ${labelEn}` : labelEn,
      valueTh,
      valueEn,
    });
  };
  const list = (map: Map<string, Named>, ids: (string | undefined)[], push: (th: string, en: string) => void) => {
    const found = uniq(ids)
      .map((id) => map.get(id))
      .filter((n): n is Named => !!n);
    if (found.length) push(found.map((n) => n.th).join(', '), found.map((n) => n.en).join(', '));
  };

  const pattern = patterns.get(cfg.patternId);
  if (pattern) push('style', pattern.th, pattern.en);
  push('size', `${mm(cfg.w)} × ${mm(cfg.l)} × ${mm(cfg.d)} มม.`, `${mm(cfg.w)} × ${mm(cfg.l)} × ${mm(cfg.d)} mm`);
  const material = materials.get(cfg.materialId);
  if (material) push('material', material.th, material.en);

  parts.forEach((p, index) => {
    const sub = p.subPatternId ? subPatterns.get(p.subPatternId) : undefined;
    const part = parts.length > 1 ? { index, name: sub?.th ?? String(index + 1) } : undefined;
    const add = (key: LineKey) => (th: string, en: string) => push(key, th, en, part);
    list(inks, (p.printFront ?? []).map((c) => c.inkColourId), add('print_front'));
    list(inks, (p.printBack ?? []).map((c) => c.inkColourId), add('print_back'));
    list(finishNames, [p.finish1FrontId ?? p.coatingFrontId], add('coating_front'));
    list(finishNames, [p.finish1BackId ?? p.coatingBackId], add('coating_back'));
    list(finishNames, (p.finish2 ?? []).map((f) => f.finishId), add('special_finish'));
    list(diecuts, [p.diecutTypeId], add('diecut'));
    list(assemblies, (p.assemblies ?? []).map((a) => a.assemblyId), add('assembly'));
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
  const keys = [...Object.keys(properties).filter((k) => k in spec), ...Object.keys(spec).filter((k) => !(k in properties))];
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
  catalogProduct:
    | { slug: string; nameTh: string; nameEn: string; images: { fileObject: { publicId: string } }[] }
    | null;
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
      ? { slug: p.slug, nameTh: p.nameTh, nameEn: p.nameEn, imageUrl: imageUrl(p.images[0]?.fileObject.publicId) }
      : null,
    productTypeCode: source.productType.code,
    productTypeNameTh: source.productType.nameTh,
    productTypeNameEn: source.productType.nameEn,
    unit,
    specs: Array.isArray(source.specSummary) ? (source.specSummary as SpecLineDto[]) : [],
  };
}
