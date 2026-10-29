import {
  type Box,
  boxHeight,
  boxWidth,
  type FileFacts,
  isNonPrintingSpot,
  mmOf,
  type PageFacts,
  PT_PER_MM,
} from './facts';

/**
 * D-070 preflight rules over extracted facts (ADR-0009). Pure: the same facts, expected size and rules
 * always give the same results. Severity per check comes from `artwork.preflight_rules`; D-070 fixes
 * block on size mismatch / missing bleed and warn on low resolution / RGB.
 */

export const PREFLIGHT_CHECKS = [
  'size_mismatch',
  'missing_bleed',
  'low_resolution',
  'rgb_colour',
  'fonts_not_embedded',
  'safe_zone',
  'thin_lines',
  'overprint',
  'ink_coverage',
  // C9 (D-457): the rest of the upload page's 12 checks — one engine for the upload pre-check, the order's
  // submissions and the Studio print file (GLOBAL-RULES §5).
  'ink_count',
  'small_text',
  'small_text_black',
  'barcode',
  'die_layer',
] as const;
export type PreflightCheck = (typeof PREFLIGHT_CHECKS)[number];
export type Severity = 'block' | 'warn' | 'info';
export type Outcome = 'pass' | 'fail' | 'not_evaluated';

export interface PreflightRules {
  severities: Record<string, Severity>;
  bleedMm: string;
  sizeToleranceMm: string;
  minEffectivePpi: number;
  safeZoneMm: string;
  minLineWidthPt: string;
  maxInkCoveragePct: number;
  /**
   * C9 (D-457): the smallest text size that prints legibly, pt. Prepress's profile value — unset (absent or null)
   * leaves `small_text` unevaluated (never a value of ours, D-278 pattern).
   */
  minTextPt?: string | null;
  /** C9: text below this size must print in black only (no C/M/Y — no registration blur), pt; unset → unevaluated. */
  blackOnlyTextBelowPt?: string | null;
}

/**
 * C9 (D-457): what the order prints with, for `ink_count` — none, spot colour(s) (how many) or CMYK (+ spots). From the
 * spec the customer chose; absent → the check is not evaluated (the order's own submissions carry no method yet).
 */
export interface PrintMethodContext {
  method: 'none' | 'spot' | 'cmyk';
  spotColours: number;
}

/** Finished (trim) size the artwork must have: the dieline template sent to the customer. */
export interface ExpectedSize {
  widthMm: number;
  heightMm: number;
}

export interface CheckResult {
  check: PreflightCheck;
  outcome: Outcome;
  severity: Severity;
  page: number | null;
  measurements: Record<string, unknown>;
  messageTh: string;
  messageEn: string;
}

const round = (v: number, places = 1) => Math.round(v * 10 ** places) / 10 ** places;
/** Bleed shortfalls under this are rounding noise in the file, not missing bleed (technical). */
const BLEED_EPSILON_MM = 0.1;

export function severityOf(rules: PreflightRules, check: PreflightCheck): Severity {
  const s = rules.severities[check];
  return s === 'block' || s === 'warn' ? s : 'info';
}

/** Evaluates every check on every page of one file. Unsupported and unreadable files evaluate nothing. */
export function evaluate(
  facts: FileFacts,
  expected: ExpectedSize | null,
  rules: PreflightRules,
  print: PrintMethodContext | null = null,
): CheckResult[] {
  if (facts.kind === 'unsupported' || facts.kind === 'error') {
    return PREFLIGHT_CHECKS.map((check) => notEvaluated(rules, check, null, facts.reason));
  }
  const results: CheckResult[] = [];
  for (const page of facts.pages) {
    results.push(...sizeAndBleed(page, expected, rules));
    results.push(resolution(page, rules));
    results.push(rgb(page, rules));
    results.push(fonts(page, rules));
    results.push(safeZone(page, expected, rules));
    results.push(thinLines(page, rules));
    results.push(overprint(page, rules));
    results.push(notEvaluated(rules, 'ink_coverage', page.page, 'needs_rasteriser'));
    results.push(inkCount(page, rules, print));
    results.push(smallText(page, rules));
    results.push(smallTextBlack(page, rules));
    results.push(notEvaluated(rules, 'barcode', page.page, 'barcode_not_read'));
    results.push(dieLayer(page, rules));
  }
  return results;
}

/** Overall status: any failing block → blocked, any failing warn → passed_with_warnings, else passed. */
export function statusOf(results: readonly CheckResult[]): 'passed' | 'passed_with_warnings' | 'blocked' {
  const failing = results.filter((r) => r.outcome === 'fail');
  if (failing.some((r) => r.severity === 'block')) return 'blocked';
  if (failing.some((r) => r.severity === 'warn')) return 'passed_with_warnings';
  return 'passed';
}

function result(
  rules: PreflightRules,
  check: PreflightCheck,
  page: number | null,
  outcome: Outcome,
  measurements: Record<string, unknown>,
  th: string,
  en: string,
): CheckResult {
  return {
    check,
    outcome,
    severity: severityOf(rules, check),
    page,
    measurements,
    messageTh: th,
    messageEn: en,
  };
}

const REASONS: Record<string, [string, string]> = {
  type: [
    'ไฟล์ประเภทนี้ตรวจอัตโนมัติไม่ได้ ฝ่ายเตรียมพิมพ์จะตรวจให้',
    'This file type is checked by Prepress, not automatically',
  ],
  too_large: [
    'ไฟล์ใหญ่เกินกว่าจะตรวจอัตโนมัติ ฝ่ายเตรียมพิมพ์จะตรวจให้',
    'Too large for the automatic check; Prepress checks it',
  ],
  link: ['ลิงก์ไฟล์ตรวจอัตโนมัติไม่ได้ ฝ่ายเตรียมพิมพ์จะตรวจให้', 'Links are checked by Prepress'],
  encrypted: [
    'ไฟล์ PDF ถูกเข้ารหัส กรุณาส่งไฟล์ที่ไม่ใส่รหัสผ่าน',
    'The PDF is encrypted; please send it without a password',
  ],
  unreadable: ['เปิดไฟล์ไม่ได้ ไฟล์อาจเสีย กรุณาส่งใหม่', 'The file could not be read; please send it again'],
  infected: [
    'ไฟล์ไม่ผ่านการตรวจความปลอดภัย กรุณาส่งไฟล์ใหม่',
    'The file failed the security scan; please send another',
  ],
  not_scanned: ['ไฟล์ยังไม่ผ่านการตรวจความปลอดภัย', 'The file has not been scanned yet'],
  no_dieline: [
    'ยังไม่มีแบบแปลน (dieline) ให้เทียบขนาด ฝ่ายเตรียมพิมพ์จะตรวจให้',
    'No dieline to compare with yet; Prepress checks it',
  ],
  needs_rasteriser: ['ยังไม่ได้ตรวจปริมาณหมึกอัตโนมัติ', 'Ink coverage is not checked automatically yet'],
  no_trim: [
    'ไม่ทราบขอบตัดของงาน จึงตรวจระยะปลอดภัยไม่ได้',
    'The trim edge is unknown, so the safe zone is not checked',
  ],
  no_print_method: [
    'ยังไม่ได้เลือกระบบพิมพ์ จึงยังไม่ได้เทียบจำนวนสี',
    'No print method chosen yet, so the ink count is not compared',
  ],
  no_rule: [
    'ทีมเตรียมพิมพ์ยังไม่ได้กำหนดเกณฑ์ข้อนี้ ทีมจะตรวจให้ก่อนผลิต',
    'Prepress has not set this threshold yet; the team checks it before production',
  ],
  barcode_not_read: [
    'บาร์โค้ดและ QR ทีมเตรียมพิมพ์ตรวจให้ก่อนผลิต',
    'Barcodes and QR codes are checked by Prepress before production',
  ],
  no_die: [
    'ไม่พบเส้นไดคัทในไฟล์ (สีพิเศษ CutContour / Crease) ทีมจะเทียบกับแบบกล่องให้',
    'No die lines found in the file (CutContour / Crease spot colours); the team matches it to the box style',
  ],
};

function notEvaluated(
  rules: PreflightRules,
  check: PreflightCheck,
  page: number | null,
  reason: string,
): CheckResult {
  const [th, en] = REASONS[reason] ?? [reason, reason];
  return result(rules, check, page, 'not_evaluated', { reason }, th, en);
}

/** Width × height of `box` in mm, oriented like `expected` when that fits better. */
function orientedMm(box: Box, expected: ExpectedSize | null): { w: number; h: number } {
  const w = mmOf(boxWidth(box));
  const h = mmOf(boxHeight(box));
  if (!expected) return { w, h };
  const straight = Math.abs(w - expected.widthMm) + Math.abs(h - expected.heightMm);
  const turned = Math.abs(h - expected.widthMm) + Math.abs(w - expected.heightMm);
  return turned < straight ? { w: h, h: w } : { w, h };
}

/**
 * Size and bleed. With a trim box: the trim must match the dieline (± tolerance) and the bleed box (or the
 * media box) must extend the required bleed beyond it on every side. Without one the finished size is
 * assumed centred in the media box: smaller than the dieline is a size mismatch, less than the bleed on a
 * side is missing bleed.
 */
function sizeAndBleed(page: PageFacts, expected: ExpectedSize | null, rules: PreflightRules): CheckResult[] {
  const tolerance = Number(rules.sizeToleranceMm);
  const bleedRequired = Number(rules.bleedMm);
  const out: CheckResult[] = [];
  // C9: without a TrimBox, the file's own die lines (painted in a die spot) are its finished size.
  const trimBox = page.trimBox ?? page.dieBox ?? null;
  if (trimBox) {
    const trim = orientedMm(trimBox, expected);
    if (!expected) out.push(notEvaluated(rules, 'size_mismatch', page.page, 'no_dieline'));
    else {
      const ok =
        Math.abs(trim.w - expected.widthMm) <= tolerance && Math.abs(trim.h - expected.heightMm) <= tolerance;
      out.push(
        result(
          rules,
          'size_mismatch',
          page.page,
          ok ? 'pass' : 'fail',
          {
            trimMm: [round(trim.w), round(trim.h)],
            dielineMm: [expected.widthMm, expected.heightMm],
            toleranceMm: tolerance,
          },
          ok
            ? 'ขนาดงานตรงกับแบบแปลน'
            : `ขนาดงาน ${round(trim.w)}×${round(trim.h)} มม. ไม่ตรงกับแบบแปลน ${expected.widthMm}×${expected.heightMm} มม.`,
          ok
            ? 'The trim size matches the dieline'
            : `Trim ${round(trim.w)}×${round(trim.h)} mm does not match the dieline ${expected.widthMm}×${expected.heightMm} mm`,
        ),
      );
    }
    const outer = page.bleedBox ?? page.mediaBox;
    const sides = [
      trimBox[0] - outer[0],
      trimBox[1] - outer[1],
      outer[2] - trimBox[2],
      outer[3] - trimBox[3],
    ].map((pt) => mmOf(pt));
    const least = Math.min(...sides);
    out.push(bleedResult(rules, page.page, least, bleedRequired));
    return out;
  }
  if (!expected) {
    out.push(notEvaluated(rules, 'size_mismatch', page.page, 'no_dieline'));
    out.push(notEvaluated(rules, 'missing_bleed', page.page, 'no_dieline'));
    return out;
  }
  const media = orientedMm(page.mediaBox, expected);
  const tooSmall = media.w < expected.widthMm - tolerance || media.h < expected.heightMm - tolerance;
  out.push(
    result(
      rules,
      'size_mismatch',
      page.page,
      tooSmall ? 'fail' : 'pass',
      {
        pageMm: [round(media.w), round(media.h)],
        dielineMm: [expected.widthMm, expected.heightMm],
        toleranceMm: tolerance,
      },
      tooSmall
        ? `หน้างาน ${round(media.w)}×${round(media.h)} มม. เล็กกว่าแบบแปลน ${expected.widthMm}×${expected.heightMm} มม.`
        : 'ขนาดหน้างานครอบคลุมแบบแปลน',
      tooSmall
        ? `The page ${round(media.w)}×${round(media.h)} mm is smaller than the dieline ${expected.widthMm}×${expected.heightMm} mm`
        : 'The page covers the dieline',
    ),
  );
  const least = Math.min((media.w - expected.widthMm) / 2, (media.h - expected.heightMm) / 2);
  out.push(bleedResult(rules, page.page, least, bleedRequired));
  return out;
}

function bleedResult(rules: PreflightRules, page: number, leastMm: number, requiredMm: number): CheckResult {
  const ok = leastMm >= requiredMm - BLEED_EPSILON_MM;
  return result(
    rules,
    'missing_bleed',
    page,
    ok ? 'pass' : 'fail',
    { leastBleedMm: round(Math.max(leastMm, 0)), requiredMm },
    ok
      ? 'มีระยะตัดตก (bleed) ครบ'
      : `ระยะตัดตก (bleed) ${round(Math.max(leastMm, 0))} มม. ไม่ถึง ${requiredMm} มม. ทุกด้าน`,
    ok
      ? 'Bleed is sufficient'
      : `Bleed ${round(Math.max(leastMm, 0))} mm is less than ${requiredMm} mm on some side`,
  );
}

function resolution(page: PageFacts, rules: PreflightRules): CheckResult {
  const placed = page.images.filter(
    (i) => i.widthPx > 0 && i.heightPx > 0 && i.placedWidthPt > 0 && i.placedHeightPt > 0,
  );
  const ppiOf = (i: (typeof placed)[number]) =>
    Math.min(i.widthPx / (i.placedWidthPt / 72), i.heightPx / (i.placedHeightPt / 72));
  const low = placed.filter((i) => ppiOf(i) < rules.minEffectivePpi);
  const lowest = placed.length ? Math.min(...placed.map(ppiOf)) : null;
  const worst = low.length ? low.reduce((a, b) => (ppiOf(b) < ppiOf(a) ? b : a)) : null;
  return result(
    rules,
    'low_resolution',
    page.page,
    low.length ? 'fail' : 'pass',
    {
      images: placed.length,
      lowImages: low.length,
      lowestPpi: lowest === null ? null : Math.round(lowest),
      minPpi: rules.minEffectivePpi,
      ...(worst?.x !== undefined && worst.y !== undefined
        ? {
            at: [round(worst.x + worst.placedWidthPt / 2), round(worst.y + worst.placedHeightPt / 2)],
            placedMm: [round(mmOf(worst.placedWidthPt)), round(mmOf(worst.placedHeightPt))],
            neededPx: [
              Math.ceil((worst.placedWidthPt / 72) * rules.minEffectivePpi),
              Math.ceil((worst.placedHeightPt / 72) * rules.minEffectivePpi),
            ],
          }
        : {}),
    },
    low.length
      ? `ภาพ ${low.length} ภาพมีความละเอียดต่ำ (ต่ำสุด ${Math.round(lowest!)} ppi จากที่แนะนำ ${rules.minEffectivePpi} ppi)`
      : 'ความละเอียดภาพเพียงพอ',
    low.length
      ? `${low.length} image(s) below ${rules.minEffectivePpi} ppi (lowest ${Math.round(lowest!)} ppi)`
      : 'Image resolution is sufficient',
  );
}

function rgb(page: PageFacts, rules: PreflightRules): CheckResult {
  const rgbImages = page.images.filter((i) => i.colour === 'rgb').length;
  const fail = page.rgbPaintOps > 0 || rgbImages > 0;
  return result(
    rules,
    'rgb_colour',
    page.page,
    fail ? 'fail' : 'pass',
    { rgbPaintOps: page.rgbPaintOps, rgbImages, spotColours: page.spotNames },
    fail
      ? 'พบสีโหมด RGB ควรแปลงเป็น CMYK ก่อนพิมพ์ สีที่พิมพ์ออกมาอาจเพี้ยน'
      : 'ใช้สีสำหรับงานพิมพ์ (CMYK / สีพิเศษ)',
    fail
      ? 'RGB colour found; convert to CMYK — printed colours may shift'
      : 'Print colours only (CMYK / spot)',
  );
}

function fonts(page: PageFacts, rules: PreflightRules): CheckResult {
  const missing = page.fonts.filter((f) => !f.embedded).map((f) => f.name);
  return result(
    rules,
    'fonts_not_embedded',
    page.page,
    missing.length ? 'fail' : 'pass',
    { fonts: page.fonts.length, notEmbedded: missing },
    missing.length
      ? `ฟอนต์ไม่ได้ฝังในไฟล์: ${missing.join(', ')} กรุณาฝังฟอนต์หรือแปลงเป็นเส้น (outline)`
      : 'ฟอนต์ฝังครบหรือแปลงเป็นเส้นแล้ว',
    missing.length
      ? `Fonts not embedded: ${missing.join(', ')}; embed or outline them`
      : 'Fonts embedded or outlined',
  );
}

function safeZone(page: PageFacts, expected: ExpectedSize | null, rules: PreflightRules): CheckResult {
  let trim: Box | null = page.trimBox ?? page.dieBox ?? null;
  if (!trim && expected) {
    const cx = (page.mediaBox[0] + page.mediaBox[2]) / 2;
    const cy = (page.mediaBox[1] + page.mediaBox[3]) / 2;
    const landscape = boxWidth(page.mediaBox) >= boxHeight(page.mediaBox);
    const longMm = Math.max(expected.widthMm, expected.heightMm);
    const shortMm = Math.min(expected.widthMm, expected.heightMm);
    const wPt = (landscape ? longMm : shortMm) * PT_PER_MM;
    const hPt = (landscape ? shortMm : longMm) * PT_PER_MM;
    trim = [cx - wPt / 2, cy - hPt / 2, cx + wPt / 2, cy + hPt / 2];
  }
  if (!trim) return notEvaluated(rules, 'safe_zone', page.page, 'no_trim');
  const margin = Number(rules.safeZoneMm) * PT_PER_MM;
  const box = trim;
  const nearPoints = page.textOrigins.filter(
    (p) => p.x < box[0] + margin || p.x > box[2] - margin || p.y < box[1] + margin || p.y > box[3] - margin,
  );
  const near = nearPoints.length;
  return result(
    rules,
    'safe_zone',
    page.page,
    near ? 'fail' : 'pass',
    {
      textRuns: page.textOrigins.length,
      nearEdge: near,
      safeZoneMm: Number(rules.safeZoneMm),
      ...(nearPoints[0] ? { at: [round(nearPoints[0].x), round(nearPoints[0].y)] } : {}),
    },
    near
      ? `ข้อความ ${near} จุดอยู่ใกล้ขอบตัดเกิน ${rules.safeZoneMm} มม. อาจถูกตัด`
      : 'ข้อความอยู่ในระยะปลอดภัย',
    near
      ? `${near} text run(s) within ${rules.safeZoneMm} mm of the trim edge`
      : 'Text stays inside the safe zone',
  );
}

function thinLines(page: PageFacts, rules: PreflightRules): CheckResult {
  const min = Number(rules.minLineWidthPt);
  const thinnest = page.minStrokeWidthPt;
  const fail = thinnest !== null && thinnest < min;
  return result(
    rules,
    'thin_lines',
    page.page,
    fail ? 'fail' : 'pass',
    { thinnestPt: thinnest === null ? null : round(thinnest, 3), minPt: min },
    fail
      ? `มีเส้นบางเกินไป (${round(thinnest, 3)} pt ต่ำกว่า ${min} pt) อาจพิมพ์ไม่ติด`
      : 'ความหนาเส้นเพียงพอ',
    fail
      ? `Lines thinner than ${min} pt (${round(thinnest, 3)} pt) may not print`
      : 'Line widths are sufficient',
  );
}

function overprint(page: PageFacts, rules: PreflightRules): CheckResult {
  return result(
    rules,
    'overprint',
    page.page,
    page.overprint ? 'fail' : 'pass',
    { overprint: page.overprint },
    page.overprint ? 'มีการตั้งค่าพิมพ์ทับ (overprint) กรุณาตรวจสอบว่าตั้งใจ' : 'ไม่มีการพิมพ์ทับ',
    page.overprint ? 'Overprint is set; check it is intended' : 'No overprint',
  );
}

/** A rule value Prepress has set (a positive number), else null — the check is then not evaluated. */
function ruleNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * C9 (D-457) ink count vs print method: printed spot colours (die and helper layers excluded) and process colour
 * against the method chosen. Black-only work fits any method; colour work needs CMYK; spot work needs as many spot
 * colours as it uses (or CMYK, which matches them).
 */
function inkCount(page: PageFacts, rules: PreflightRules, print: PrintMethodContext | null): CheckResult {
  if (!print) return notEvaluated(rules, 'ink_count', page.page, 'no_print_method');
  const spots = page.spotNames.filter((n) => !isNonPrintingSpot(n));
  const process = page.processPaint === true;
  const fileNeeds: 'none' | 'black' | 'spot' | 'cmyk' = process
    ? 'cmyk'
    : spots.length
      ? 'spot'
      : page.texts?.length || page.images.length || (page.minStrokeWidthPt ?? null) !== null
        ? 'black'
        : 'none';
  let ok: boolean;
  if (print.method === 'cmyk') ok = true;
  else if (print.method === 'spot') ok = !process && spots.length <= Math.max(print.spotColours, 1);
  else ok = fileNeeds === 'none';
  const measurements = {
    process,
    spotColours: spots,
    fileNeeds,
    method: print.method,
    methodSpots: print.spotColours,
  };
  return result(
    rules,
    'ink_count',
    page.page,
    ok ? 'pass' : 'fail',
    measurements,
    ok
      ? 'สีในไฟล์ตรงกับระบบพิมพ์ที่เลือก'
      : process
        ? 'ไฟล์มีภาพหรือสีหลายสี (CMYK) แต่ระบบพิมพ์ที่เลือกพิมพ์ได้ไม่ครบ ต้องพิมพ์ 4 สี หรือเปลี่ยนงานให้ใช้สีเดียว'
        : print.method === 'none'
          ? 'ไฟล์มีงานพิมพ์ แต่เลือกไม่พิมพ์'
          : `ไฟล์ใช้สีพิเศษ ${spots.length} สี มากกว่าที่ระบบพิมพ์ที่เลือกพิมพ์ได้`,
    ok
      ? 'The file’s inks match the chosen print method'
      : process
        ? 'The file has colour images or process colour; it needs CMYK printing, or a one-colour artwork'
        : print.method === 'none'
          ? 'The file has artwork but no printing is chosen'
          : `The file uses ${spots.length} spot colours, more than the chosen method prints`,
  );
}

/** C9 text ≥ Prepress's minimum size (`minTextPt`). */
function smallText(page: PageFacts, rules: PreflightRules): CheckResult {
  const min = ruleNumber(rules.minTextPt);
  if (min === null) return notEvaluated(rules, 'small_text', page.page, 'no_rule');
  const texts = (page.texts ?? []).filter((t) => t.sizePt > 0);
  const small = texts.filter((t) => t.sizePt < min);
  const smallest = small.length ? small.reduce((a, b) => (b.sizePt < a.sizePt ? b : a)) : null;
  return result(
    rules,
    'small_text',
    page.page,
    small.length ? 'fail' : 'pass',
    {
      textRuns: texts.length,
      small: small.length,
      smallestPt: smallest ? round(smallest.sizePt) : null,
      minPt: min,
      ...(smallest ? { at: [round(smallest.x), round(smallest.y)] } : {}),
    },
    small.length
      ? `ตัวอักษร ${small.length} จุดเล็กกว่า ${min} pt (เล็กสุด ${round(smallest!.sizePt)} pt) อาจอ่านไม่ออกเมื่อพิมพ์`
      : `ตัวอักษรไม่เล็กกว่า ${min} pt`,
    small.length
      ? `${small.length} text run(s) below ${min} pt (smallest ${round(smallest!.sizePt)} pt) may not be legible`
      : `No text below ${min} pt`,
  );
}

/** C9 small text in black only: text below `blackOnlyTextBelowPt` must not be rich black or process colour. */
function smallTextBlack(page: PageFacts, rules: PreflightRules): CheckResult {
  const below = ruleNumber(rules.blackOnlyTextBelowPt);
  if (below === null) return notEvaluated(rules, 'small_text_black', page.page, 'no_rule');
  const texts = (page.texts ?? []).filter((t) => t.sizePt > 0 && t.sizePt < below);
  const bad = texts.filter((t) => t.plates === 'process' || t.plates === 'rgb');
  return result(
    rules,
    'small_text_black',
    page.page,
    bad.length ? 'fail' : 'pass',
    {
      smallTextRuns: texts.length,
      notBlackOnly: bad.length,
      belowPt: below,
      ...(bad[0] ? { at: [round(bad[0].x), round(bad[0].y)] } : {}),
    },
    bad.length
      ? `ตัวอักษรเล็ก ${bad.length} จุดใช้สีผสม (มี C M Y) ควรเป็นสีดำ K 100% อย่างเดียว ไม่อย่างนั้นอาจพิมพ์ไม่คม`
      : 'ตัวอักษรเล็กใช้สีดำล้วน',
    bad.length
      ? `${bad.length} small text run(s) use process colour; set them in 100% K only so they print sharp`
      : 'Small text is black only',
  );
}

/**
 * C9 die-cut on a non-printing layer: the die lines are found in a die spot colour (a separation the press does not
 * print, D-302). A file without them is not failed — the team matches it — but not passed either.
 */
function dieLayer(page: PageFacts, rules: PreflightRules): CheckResult {
  if (!page.dieBox) return notEvaluated(rules, 'die_layer', page.page, 'no_die');
  return result(
    rules,
    'die_layer',
    page.page,
    'pass',
    { dieColours: page.dieNames ?? [] },
    `เส้นไดคัทอยู่บนสีพิเศษที่ไม่พิมพ์ (${(page.dieNames ?? []).join(', ')})`,
    `Die lines are on a non-printing spot colour (${(page.dieNames ?? []).join(', ')})`,
  );
}
