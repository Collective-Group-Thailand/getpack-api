import { type FileFacts, isNonPrintingSpot } from '../preflight/facts';
import {
  type CheckResult,
  evaluate,
  type EvaluateOptions,
  type ExpectedSize,
  type PreflightCheck,
  type PreflightRules,
  type PrintMethodContext,
} from '../preflight/rules';

/**
 * C9 (D-457) the upload page's report: the 12 checks of the shared engine (ADR-0009), one item per check (the worst
 * page wins), in the levels the customer sees — `must_fix` (a failing `block` check: the cart stays closed),
 * `review` (a failing `warn` / `info` check), `pass`, `not_checked` (the engine could not tell, or Prepress has not set
 * the rule: the team checks it before production). Auto-fixes (`ระบบแก้ให้ได้`) are not offered: no derived print
 * file is produced yet (OPEN QUESTION in the C9 report). Pure.
 */

/** The 12 checks the upload page lists, in its order. */
export const UPLOAD_CHECKS = [
  'size_mismatch',
  'missing_bleed',
  'safe_zone',
  'low_resolution',
  'fonts_not_embedded',
  'rgb_colour',
  'ink_count',
  'small_text',
  'thin_lines',
  'barcode',
  'die_layer',
  'small_text_black',
] as const satisfies readonly PreflightCheck[];
export type UploadCheck = (typeof UPLOAD_CHECKS)[number];

export const CHECK_LEVELS = ['must_fix', 'review', 'pass', 'not_checked'] as const;
export type CheckLevel = (typeof CHECK_LEVELS)[number];

export interface ReportItem {
  check: UploadCheck;
  level: CheckLevel;
  page: number | null;
  messageTh: string;
  messageEn: string;
  measurements: Record<string, unknown>;
  /** Where on the page (points, PDF space: y up) the marker goes; null for a whole-sheet item. */
  at: { x: number; y: number } | null;
}

export interface UploadReport {
  schemaVersion: 1;
  items: ReportItem[];
  counts: Record<CheckLevel, number>;
  /** True when anything must be fixed before the file can go in the cart. */
  blocking: boolean;
  /** The first page's boxes (points), for placing markers over a rendering of the page. */
  page: { mediaBox: number[]; trimBox: number[] | null; dieBox: number[] | null } | null;
  /** The finished size the checks compared with (the chosen product and size), mm. */
  expected: ExpectedSize | null;
  /** What the file prints with, read from its colours (all pages); null when the file could not be read. */
  inks: FileInks | null;
}

/**
 * The inks a file needs: process colour (CMYK with C/M/Y, RGB, colour images), its printed spot colours (die and
 * helper layers excluded), and the method that prints it — `cmyk` for process work, `spot` for spot / black-only
 * work, `none` for an empty file. A fact of the file, not a price: the page prices each method through the API.
 */
export interface FileInks {
  process: boolean;
  spotColours: string[];
  recommended: 'none' | 'spot' | 'cmyk';
}

export function inksOf(facts: FileFacts): FileInks | null {
  if (facts.kind !== 'pdf' && facts.kind !== 'raster') return null;
  const process = facts.pages.some(
    (p) =>
      p.processPaint === true ||
      p.rgbPaintOps > 0 ||
      p.images.some((i) => i.colour === 'rgb' || i.colour === 'cmyk'),
  );
  const spotColours = [
    ...new Set(facts.pages.flatMap((p) => p.spotNames).filter((n) => !isNonPrintingSpot(n))),
  ].sort();
  const painted = facts.pages.some(
    (p) =>
      (p.texts?.length ?? p.textOrigins.length) > 0 || p.images.length > 0 || p.minStrokeWidthPt !== null,
  );
  return {
    process,
    spotColours,
    recommended: process ? 'cmyk' : spotColours.length || painted ? 'spot' : 'none',
  };
}

const RANK: Record<CheckLevel, number> = { must_fix: 3, review: 2, not_checked: 1, pass: 0 };

export function levelOf(result: CheckResult): CheckLevel {
  if (result.outcome === 'not_evaluated') return 'not_checked';
  if (result.outcome === 'pass') return 'pass';
  return result.severity === 'block' ? 'must_fix' : 'review';
}

function atOf(measurements: Record<string, unknown>): { x: number; y: number } | null {
  const at = measurements['at'];
  if (Array.isArray(at) && typeof at[0] === 'number' && typeof at[1] === 'number')
    return { x: at[0], y: at[1] };
  return null;
}

/** The report of one file for the spec in force. */
export function uploadReport(
  facts: FileFacts,
  expected: ExpectedSize | null,
  rules: PreflightRules,
  print: PrintMethodContext | null,
  options: EvaluateOptions = {},
): UploadReport {
  const results = evaluate(facts, expected, rules, print, options);
  const items: ReportItem[] = [];
  for (const check of UPLOAD_CHECKS) {
    const own = results.filter((r) => r.check === check);
    // The worst page decides; a check the engine did not run at all is "not checked".
    const worst = own.reduce<CheckResult | null>(
      (a, r) => (a === null || RANK[levelOf(r)] > RANK[levelOf(a)] ? r : a),
      null,
    );
    if (!worst) {
      items.push({
        check,
        level: 'not_checked',
        page: null,
        messageTh: 'ทีมเตรียมพิมพ์ตรวจให้ก่อนผลิต',
        messageEn: 'Prepress checks it before production',
        measurements: {},
        at: null,
      });
      continue;
    }
    items.push({
      check,
      level: levelOf(worst),
      page: worst.page,
      messageTh: worst.messageTh,
      messageEn: worst.messageEn,
      measurements: worst.measurements,
      at: atOf(worst.measurements),
    });
  }
  const counts = { must_fix: 0, review: 0, pass: 0, not_checked: 0 } satisfies Record<CheckLevel, number>;
  for (const item of items) counts[item.level] += 1;
  const first = facts.kind === 'pdf' || facts.kind === 'raster' ? facts.pages[0] : undefined;
  return {
    schemaVersion: 1,
    items,
    counts,
    blocking: counts.must_fix > 0 || facts.kind === 'error',
    page: first
      ? {
          mediaBox: [...first.mediaBox],
          trimBox: first.trimBox ? [...first.trimBox] : null,
          dieBox: first.dieBox ? [...first.dieBox] : null,
        }
      : null,
    expected,
    inks: inksOf(facts),
  };
}
