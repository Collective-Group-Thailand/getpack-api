import { type Box, boxHeight, boxWidth, type FileFacts, mmOf, type PageFacts, PT_PER_MM } from './facts';

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
  if (page.trimBox) {
    const trim = orientedMm(page.trimBox, expected);
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
      page.trimBox[0] - outer[0],
      page.trimBox[1] - outer[1],
      outer[2] - page.trimBox[2],
      outer[3] - page.trimBox[3],
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
  let trim: Box | null = page.trimBox;
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
  const near = page.textOrigins.filter(
    (p) => p.x < box[0] + margin || p.x > box[2] - margin || p.y < box[1] + margin || p.y > box[3] - margin,
  ).length;
  return result(
    rules,
    'safe_zone',
    page.page,
    near ? 'fail' : 'pass',
    { textRuns: page.textOrigins.length, nearEdge: near, safeZoneMm: Number(rules.safeZoneMm) },
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
