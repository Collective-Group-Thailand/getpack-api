/**
 * Neutral facts extracted from one artwork file (ADR-0009). Rule functions read only these, so they are
 * tested without files and a different extractor (e.g. Ghostscript) only has to produce the same shape.
 * Lengths are in PostScript points (1/72 inch) unless the name says otherwise.
 */

/** `[x1, y1, x2, y2]` in points. */
export type Box = readonly [number, number, number, number];

export type ColourFamily = 'rgb' | 'cmyk' | 'gray' | 'spot' | 'lab' | 'pattern' | 'mask' | 'other';

export interface ColourSpaceInfo {
  family: ColourFamily;
  /** Separation / DeviceN colorant names (spot colours). */
  spotNames?: string[];
}

export interface ImageFact {
  /** Resource name or `inline`. */
  name: string;
  widthPx: number;
  heightPx: number;
  /** Size on the page after the transformation matrix. */
  placedWidthPt: number;
  placedHeightPt: number;
  colour: ColourFamily;
  /** C9: where it is placed (page space, points; the transformation's origin), for the check's marker. */
  x?: number;
  y?: number;
}

/**
 * C9 (D-457): one text run as painted — its origin, its effective size (the font size through the text and
 * transformation matrices) and which plates its fill lands on: `k` = black only (gray, or CMYK with no C/M/Y),
 * `process` = CMYK with C, M or Y (rich black, colour), `spot`, `rgb`, `other`.
 */
export interface TextFact {
  x: number;
  y: number;
  sizePt: number;
  plates: 'k' | 'process' | 'spot' | 'rgb' | 'other';
}

export interface FontFact {
  name: string;
  subtype: string;
  embedded: boolean;
}

export interface PageFacts {
  page: number;
  mediaBox: Box;
  /** Only when the file declares it (not inherited, not defaulted to the media box). */
  trimBox: Box | null;
  bleedBox: Box | null;
  images: ImageFact[];
  fonts: FontFact[];
  /** Painting operations in DeviceRGB / RGB-based spaces (rg, RG, sc/scn in an RGB space). */
  rgbPaintOps: number;
  spotNames: string[];
  /** Thinnest stroke painted, in points after the transformation matrix (0 = device hairline). */
  minStrokeWidthPt: number | null;
  overprint: boolean;
  /** Text origins in page space (a bounded sample). */
  textOrigins: { x: number; y: number }[];
  /** C9: text runs with their size and plates (a bounded sample); absent in facts extracted before C9. */
  texts?: TextFact[];
  /**
   * C9: the bounding box of the die (cut / crease) paths painted in a die spot colour (`CutContour`, `Crease` … —
   * {@link DIE_SPOT_NAMES}); null when the file has none. The file's own dieline, read for detection (D-457).
   */
  dieBox?: Box | null;
  /** C9: the die spot colours the die paths use. */
  dieNames?: string[];
  /** C9: anything painted in process colour (CMYK with C/M/Y, RGB, colour images) — the job needs CMYK printing. */
  processPaint?: boolean;
}

/**
 * The spot colours a die line is drawn in: the ones the getpack templates use (D-302: `CutContour`, `Crease`, `Perf`,
 * `HalfCut`; the engine's `Perforation`) and the common prepress names. Technical vocabulary, compared without case.
 */
export const DIE_SPOT_NAMES = [
  'cutcontour',
  'crease',
  'perf',
  'perforation',
  'halfcut',
  'cut',
  'die',
  'dieline',
  'diecut',
  'die cut',
  'die-cut',
  'thru-cut',
  'thrucut',
  'kiss cut',
  'kisscut',
  'fold',
  'creasing',
] as const;
/** Helper layers a template carries that never print (D-302 `Glue`, `Bleed`, `Safe`). */
export const NON_PRINTING_SPOT_NAMES = [
  'glue',
  'bleed',
  'safe',
  'safe zone',
  'safezone',
  'dimension',
  'dimensions',
] as const;

export const isDieSpot = (name: string) =>
  (DIE_SPOT_NAMES as readonly string[]).includes(name.trim().toLowerCase());
/** C12 (D-460): the die names that mark creases (folds), as opposed to cuts. */
export const isCreaseName = (name: string) =>
  ['crease', 'creasing', 'fold'].includes(name.trim().toLowerCase());
export const isNonPrintingSpot = (name: string) =>
  isDieSpot(name) || (NON_PRINTING_SPOT_NAMES as readonly string[]).includes(name.trim().toLowerCase());

export type FileFacts =
  | { kind: 'pdf'; pages: PageFacts[]; pageCount: number; truncated: boolean }
  | { kind: 'raster'; pages: PageFacts[]; pageCount: 1; truncated: false; densityPpi: number }
  | { kind: 'unsupported'; reason: 'type' | 'too_large' | 'link' }
  | { kind: 'error'; reason: 'encrypted' | 'unreadable' | 'infected' | 'not_scanned' };

export const PT_PER_MM = 72 / 25.4;
export const mmOf = (pt: number) => pt / PT_PER_MM;
export const boxWidth = (b: Box) => Math.abs(b[2] - b[0]);
export const boxHeight = (b: Box) => Math.abs(b[3] - b[1]);

/** Normalises `[x1,y1,x2,y2]` so x1 ≤ x2 and y1 ≤ y2. */
export function normaliseBox(b: readonly number[]): Box {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = b;
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}
