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
}

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
