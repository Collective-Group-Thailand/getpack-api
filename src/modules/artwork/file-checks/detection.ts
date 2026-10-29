import { boxHeight, boxWidth, type FileFacts, mmOf } from '../preflight/facts';

/**
 * C9 (D-457) detection: the finished sheet an uploaded file shows — its die lines' bounding box (painted in a die spot
 * colour, the getpack templates' `CutContour` / `Crease`), else its TrimBox — matched to the blank of every product and
 * standard size the engine draws, within the size tolerance of the preflight rules (`sizeToleranceMm`). Pure.
 */

export interface SheetOfFile {
  widthMm: number;
  heightMm: number;
  /** `die` = the file's own die lines; `trim` = its TrimBox (no die lines found). */
  source: 'die' | 'trim';
}

/** One product × standard size, with the flat blank the engine builds for it. */
export interface DetectionCandidate {
  catalogProductId: bigint;
  productSlug: string;
  productNameTh: string;
  productNameEn: string;
  sizeCode: string;
  sizeName: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  blankWidthMm: number;
  blankHeightMm: number;
  /** C12 (D-460): the dieline has crease lines (the engine says so); absent when unknown. */
  hasCreases?: boolean;
}

export interface DetectionMatch extends DetectionCandidate {
  /** Largest difference of the two sides, mm (either orientation). */
  deltaMm: number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** The sheet of the file's first page: die lines first, else the TrimBox; null when it declares neither. */
export function sheetOf(facts: FileFacts): SheetOfFile | null {
  if (facts.kind !== 'pdf' && facts.kind !== 'raster') return null;
  const page = facts.pages[0];
  if (!page) return null;
  const box = page.dieBox ?? page.trimBox;
  if (!box) return null;
  return {
    widthMm: round1(mmOf(boxWidth(box))),
    heightMm: round1(mmOf(boxHeight(box))),
    source: page.dieBox ? 'die' : 'trim',
  };
}

/** Largest side difference between a sheet and a blank, taking the better of the two orientations. */
export function sheetDelta(
  sheet: { widthMm: number; heightMm: number },
  blank: { widthMm: number; heightMm: number },
) {
  const straight = Math.max(
    Math.abs(sheet.widthMm - blank.widthMm),
    Math.abs(sheet.heightMm - blank.heightMm),
  );
  const turned = Math.max(Math.abs(sheet.widthMm - blank.heightMm), Math.abs(sheet.heightMm - blank.widthMm));
  return Math.min(straight, turned);
}

/**
 * The candidate whose blank matches the sheet within `toleranceMm` (closest first; on a tie the earlier candidate,
 * i.e. catalogue order). Null when nothing is within the tolerance.
 */
export function detect(
  sheet: SheetOfFile | null,
  candidates: readonly DetectionCandidate[],
  toleranceMm: number,
): DetectionMatch | null {
  if (!sheet) return null;
  let best: DetectionMatch | null = null;
  for (const candidate of candidates) {
    const deltaMm = sheetDelta(sheet, { widthMm: candidate.blankWidthMm, heightMm: candidate.blankHeightMm });
    if (deltaMm > toleranceMm) continue;
    if (!best || deltaMm < best.deltaMm) best = { ...candidate, deltaMm: round1(deltaMm) };
  }
  return best;
}
