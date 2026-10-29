import { type QrLevel, validateBarcode } from './barcodes';

/**
 * D-278 the studio's print-check rule catalogue (setting `studio.print_rules`, Prepress) and the server's fast
 * evaluator over a studio document (getpack-web designer document v2: `{ spec, content: { elements, pattern } }`,
 * millimetres on the flat sheet). The web runs every rule live; the server re-runs the ones it can see in the document
 * (`evaluatedOn` contains `document`), the print PDF the ones of ADR-0009 (B4). A rule whose thresholds are null is
 * off until Prepress sets them.
 */

export const RULE_SURFACES = ['document', 'web', 'pdf'] as const;
export type RuleSurface = (typeof RULE_SURFACES)[number];
export type Severity = 'block' | 'warn' | 'info';

export interface PrintRule {
  id: string;
  severity: Severity;
  evaluatedOn: RuleSurface[];
  /** Print methods the rule applies to; null = all. */
  printMethods: string[] | null;
  /** Material classes the rule applies to; null = all. */
  materialClasses: string[] | null;
  /** null = off (not set by a decision yet); `{}` = on without thresholds. */
  thresholds: Record<string, number | string> | null;
}

export interface RuleCatalogue {
  rules: PrintRule[];
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  elementId: string;
  details: Record<string, unknown>;
}

const PT_PER_MM = 72 / 25.4;
const num = (v: unknown): number | null => (v === undefined || v === null || v === '' ? null : Number(v));

/** Rules in force for a design: on, and applying to its print method and material class. */
export function activeRules(
  catalogue: RuleCatalogue,
  ctx: { printMethod: string | null; materialClass: string | null },
): PrintRule[] {
  return catalogue.rules.filter(
    (r) =>
      r.thresholds !== null &&
      (r.printMethods === null || (ctx.printMethod !== null && r.printMethods.includes(ctx.printMethod))) &&
      (r.materialClasses === null ||
        (ctx.materialClass !== null && r.materialClasses.includes(ctx.materialClass))),
  );
}

export type El = Record<string, unknown> & { id?: unknown; type?: unknown };

/** The server's fast checks over a document (rules evaluated on `document` only). */
export function evaluateDocument(
  document: unknown,
  rules: PrintRule[],
  ctx: {
    assetPx: Map<string, { widthPx: number | null; heightPx: number | null }>;
    /** Studio elements (public ids) needing a right the design's owner has not declared (D-282). */
    undeclaredElements?: Set<string>;
  },
): Finding[] {
  const content = (document as { content?: { elements?: unknown; pattern?: unknown } } | null)?.content;
  // D-459 (C8-1): a hidden element is neither printed, checked nor priced.
  const elements = (Array.isArray(content?.elements) ? (content.elements as El[]) : []).filter(
    (el) => el['hidden'] !== true,
  );
  const findings: Finding[] = [];
  const on = (id: string) => rules.find((r) => r.id === id && r.evaluatedOn.includes('document'));
  const scale = (el: El, k: 'scaleX' | 'scaleY') => Math.abs(num(el[k]) ?? 1) || 1;
  const id = (el: El) => (typeof el.id === 'string' ? el.id : '');

  const image = on('image_resolution');
  if (image) {
    const warn = num(image.thresholds!['warnBelowPpi']);
    const block = num(image.thresholds!['blockBelowPpi']);
    for (const el of elements.filter((e) => e.type === 'image')) {
      const asset = typeof el['assetId'] === 'string' ? ctx.assetPx.get(el['assetId']) : undefined;
      const pxW = asset?.widthPx ?? num(el['naturalWidth']);
      const pxH = asset?.heightPx ?? num(el['naturalHeight']);
      const crop = (el['crop'] as { width?: number; height?: number } | undefined) ?? {};
      const mmW = (num(el['width']) ?? 0) * scale(el, 'scaleX');
      const mmH = (num(el['height']) ?? 0) * scale(el, 'scaleY');
      if (!pxW || !pxH || mmW <= 0 || mmH <= 0) continue;
      const ppi = Math.floor(
        Math.min((pxW * (crop.width ?? 1)) / (mmW / 25.4), (pxH * (crop.height ?? 1)) / (mmH / 25.4)),
      );
      const severity: Severity | null =
        block !== null && ppi < block ? 'block' : warn !== null && ppi < warn ? image.severity : null;
      if (severity) findings.push({ ruleId: image.id, severity, elementId: id(el), details: { ppi } });
    }
  }

  const text = on('min_text_size');
  const minPt = text ? num(text.thresholds!['minPt']) : null;
  if (text && minPt !== null)
    for (const el of elements.filter((e) => e.type === 'text')) {
      const pt = (num(el['fontSize']) ?? 0) * scale(el, 'scaleY') * PT_PER_MM;
      if (pt > 0 && pt < minPt)
        findings.push({
          ruleId: text.id,
          severity: text.severity,
          elementId: id(el),
          details: { pt: round(pt) },
        });
    }

  const hairline = on('hairline');
  const minStroke = hairline ? num(hairline.thresholds!['minStrokePt']) : null;
  if (hairline && minStroke !== null)
    for (const el of elements.filter((e) => ['rect', 'circle', 'shape'].includes(String(e.type)))) {
      const stroke =
        typeof el['stroke'] === 'string' && el['stroke'] !== '' && el['stroke'] !== 'transparent';
      const pt =
        (num(el['strokeWidth']) ?? 0) * Math.max(scale(el, 'scaleX'), scale(el, 'scaleY')) * PT_PER_MM;
      if (stroke && pt > 0 && pt < minStroke)
        findings.push({
          ruleId: hairline.id,
          severity: hairline.severity,
          elementId: id(el),
          details: { pt: round(pt) },
        });
    }

  const barcode = on('barcode_invalid');
  if (barcode)
    for (const el of elements.filter((e) => e.type === 'code')) {
      const kind = el['kind'] === 'ean13' ? 'ean13' : el['kind'] === 'qr' ? 'qr' : null;
      if (!kind) continue;
      const level = (typeof el['level'] === 'string' ? el['level'] : 'M') as QrLevel;
      const check = validateBarcode(kind, typeof el['value'] === 'string' ? el['value'] : '', level);
      const widthMm = (num(el['width']) ?? 0) * scale(el, 'scaleX');
      const problems = [...check.problems];
      if (check.minWidthMm !== null && widthMm > 0 && widthMm < check.minWidthMm) problems.push('too_small');
      if (problems.length > 0)
        findings.push({
          ruleId: barcode.id,
          severity: barcode.severity,
          elementId: id(el),
          details: { problems },
        });
    }

  const rights = on('element_right_missing');
  if (rights && ctx.undeclaredElements?.size)
    for (const el of elements) {
      const studioElementId = el['studioElementId'];
      if (typeof studioElementId === 'string' && ctx.undeclaredElements.has(studioElementId))
        findings.push({
          ruleId: rights.id,
          severity: rights.severity,
          elementId: id(el),
          details: { studioElementId },
        });
    }

  const spots = on('spot_colour_count');
  const maxColours = spots ? num(spots.thresholds!['maxColours']) : null;
  if (spots && maxColours !== null) {
    const inks = documentInks(elements, content?.pattern);
    if (inks.colours.size > maxColours || inks.process)
      findings.push({
        ruleId: spots.id,
        severity: spots.severity,
        elementId: '',
        details: { colours: inks.colours.size, max: maxColours, ...(inks.process && { process: true }) },
      });
  }
  return findings;
}

/**
 * D-459 (C8-1) the inks a document prints with, as the spot-colour rule counts them (getpack-web `spotColours`, the
 * same arithmetic): every flat fill, stroke (of a width above 0) and background of the visible elements and the
 * background pattern (a solid one: its colour); a gradient's two ends; an open path's fill is not printed; a one-ink
 * image (`mono`) is one ink of its own. Continuous
 * tone — a gradient or a colour image — needs process (CMYK) printing, which spot inks cannot print (`process`).
 */
export function documentInks(elements: El[], pattern: unknown): { colours: Set<string>; process: boolean } {
  const colours = new Set<string>();
  let process = false;
  const add = (c: unknown) => {
    if (typeof c === 'string' && c !== '' && c !== 'transparent') colours.add(c.toLowerCase());
  };
  for (const el of elements) {
    if (el['hidden'] === true) continue;
    if (el.type === 'image') {
      if (el['mono'] === true) colours.add('mono-image');
      else process = true;
      continue;
    }
    const gradient = el['fillGradient'] as { from?: unknown; to?: unknown } | undefined;
    if (gradient && typeof gradient === 'object') {
      process = true;
      add(gradient.from);
      add(gradient.to);
    } else if (el['open'] !== true) add(el['fill']);
    // A stroke of width 0 paints nothing; a document without widths keeps the older count (every stroke colour).
    const width = num(el['strokeWidth']);
    if (width === null || width > 0) add(el['stroke']);
    add(el['background']);
  }
  const p = pattern as { kind?: string; color?: string; background?: string } | undefined;
  if (p && p.kind !== 'none') {
    add(p.color);
    if (p.kind !== 'solid') add(p.background);
  }
  return { colours, process };
}

const round = (n: number) => Math.round(n * 100) / 100;
