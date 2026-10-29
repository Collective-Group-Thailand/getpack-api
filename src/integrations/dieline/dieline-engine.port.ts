import { type InsideRule } from './inside-rules';

/**
 * The dieline engine (`@getpack/dieline`, published by `getpack-web`, D-002; consumed as a vendored, pinned bundle —
 * ADR-0010). It builds a style from its recipe for a size and a material into a flat dieline: drawings (SVG / DXF /
 * PDF), the dieline-derived quantities (D-267), thumbnails (D-270) and the recipe facts the library needs
 * (processes, size ranges, variants). The `drawing.engine` flag gates its use; without the bundle the engine is
 * unavailable and the API answers `501 drawing.engine_unavailable` (B4.1).
 */
export const DIELINE_ENGINE = Symbol('DIELINE_ENGINE');

export type DielineFormat = 'svg' | 'dxf' | 'pdf';

/** B4.1 drawings by a legacy pattern key (`patterns.dieline_key`). */
export interface DielineRequest {
  dielineKey: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  format: DielineFormat;
}

/**
 * D-302 the designer PDF: layers and spot swatches `CutContour`, `Crease`, `Perf`, `Glue`, `Bleed`, `Safe` (+ `HalfCut`),
 * the title and style code in the metadata. Asked for with a `pdf` format; without it the engine's own PDF is drawn.
 */
export interface DesignerPdfOptions {
  title: string;
  styleCode: string;
  bleedMm: number;
  safeMm: number;
  keywords?: string[];
}

export interface DielineBlank {
  widthMm: number;
  heightMm: number;
  engineVersion: string;
}

export interface DielineDrawing {
  body: Buffer;
  mimeType: string;
  fileName: string;
  engineVersion: string;
}

/** A board or film as the engine sees it (`MaterialSpec`). */
export interface DielineMaterial {
  kind: string;
  caliperMm: number;
  flute?: string;
  /** Material class (`paperboard`, `corrugated` …); implied by `kind` when absent. */
  class?: string;
}

/**
 * A stored recipe of a style base (D-241): the engine recipes of that base — one base can need several, each
 * covering some of its variants (ADR-0010).
 */
export interface StoredRecipe {
  engine: unknown[];
}

export interface RecipeBuildRequest {
  recipe: StoredRecipe;
  /** The variant's options (`axis → value`) as the library stores them. */
  options: Record<string, unknown>;
  /** Inside sizes and any other size parameters, mm (D-182). */
  sizes: Record<string, number>;
  material: DielineMaterial;
}

/** D-267: what the dieline says about the structure. */
export interface DielineQuantities {
  blankWidthMm: number;
  blankHeightMm: number;
  /** Net board of the blank (faces, holes removed), mm². */
  blankAreaMm2: number;
  cutMm: number;
  creaseMm: number;
  perforationMm: number;
  halfCutMm: number;
  /** Outline length of the glue areas, mm. */
  glueOutlineMm: number;
  /** Windows, hang and handle holes, mm². */
  cutoutAreaMm2: number;
  pieces: number;
}

export interface RecipeBuild {
  quantities: DielineQuantities;
  files: Partial<Record<DielineFormat, { body: Buffer; mimeType: string }>>;
  /** Rules the size breaks (`code`, `param`, `expected`, `actual`); empty when it builds cleanly. */
  violations: { code: string; severity: string; param: string | null }[];
  engineVersion: string;
}

export interface RecipeFacts {
  /** The style base code the engine recipes name (`PK-…`), when they all agree. */
  baseCode: string | null;
  /** Factory processes the recipe needs (D-244 vocabulary). */
  processes: string[];
  /** Valid size ranges per material class, mm. */
  sizeRanges: Record<string, Record<string, { min: number; max: number }>>;
  /** The variants the recipes build (`axis → value`); null when the engine cannot enumerate them (the fake). */
  variants: Record<string, string>[] | null;
}

/** An inside size span per dimension (mm); null where the source gives nothing for that dimension. */
export interface InsideSpan {
  length: { min: number; max: number } | null;
  width: { min: number; max: number } | null;
  height: { min: number; max: number } | null;
}

/**
 * C1c (DECISIONS-STAGE-A §11.1): the inside (closed) sizes a recipe's own data gives, per material class — `standard`
 * = the span of its presets (the style's standard sizes), `limits` = the span its solver's parameter limits allow;
 * both through the recipe's own `closedSize` (or, when it has none, its parameters read by the style's inside rule —
 * C1e, `inside-rules.ts`: length/width/height; bags width × gusset × height; cylinders diameter square × height). A
 * dimension neither gives (flat items) stays null.
 */
export type RecipeInsideSizes = Record<string, { standard: InsideSpan; limits: InsideSpan }>;

export interface Thumbnails {
  png2d: Buffer;
  png3d: Buffer | null;
  svg: string;
  engineVersion: string;
}

export class DielineEngineUnavailableError extends Error {
  constructor(reason: string) {
    super(`dieline engine unavailable: ${reason}`);
    this.name = 'DielineEngineUnavailableError';
  }
}

/** A request the engine cannot build: no recipe covers the variant, or the recipe is not usable. */
export class DielineBuildError extends Error {
  constructor(
    readonly code: 'variant_not_in_recipe' | 'recipe_invalid' | 'material_not_supported',
    message: string,
  ) {
    super(message);
    this.name = 'DielineBuildError';
  }
}

export interface DielineEngine {
  /** Loads the engine when needed; false when it is not installed. */
  available(): Promise<boolean>;
  version(): Promise<string>;
  draw(request: DielineRequest): Promise<DielineDrawing>;
  /**
   * C9 (D-457): the flat blank of a legacy pattern key at a size — the bounding box of its die, mm — so an uploaded
   * file's die lines can be matched to a product and standard size. Same build as {@link draw}.
   */
  blank(request: Omit<DielineRequest, 'format'>): Promise<DielineBlank>;
  build(
    request: RecipeBuildRequest,
    formats: DielineFormat[],
    designerPdf?: DesignerPdfOptions,
  ): Promise<RecipeBuild>;
  facts(recipe: StoredRecipe): Promise<RecipeFacts>;
  /**
   * C1c: inside size spans of the recipe's presets and solver limits, per material class ({@link RecipeInsideSizes}).
   * C1e: without a `closedSize`, the parameters are read by `rule` (`inside-rules.ts`: bag, cylinder; default as before).
   */
  insideSizes(recipe: StoredRecipe, rule?: InsideRule): Promise<RecipeInsideSizes>;
  thumbnails(request: RecipeBuildRequest, size: number): Promise<Thumbnails>;
  /** The engine's own recipes, grouped by the base code they name (for the recipe bundle, ADR-0010). */
  recipesByBase(): Promise<Record<string, unknown[]>>;
  /**
   * ADR-0011: the print PDF of a variant — the vector die on its Separation layers, TrimBox = the dieline, BleedBox = +
   * bleed — with the studio's artwork tiles under it (sheet millimetres, y down).
   */
  printPdf(request: RecipeBuildRequest, options: PrintPdfOptions): Promise<PrintPdf>;
  /** The engine's reference material of a material class (the first it lists), null for a class it does not know (D-270). */
  referenceMaterial(materialClass: string): Promise<DielineMaterial | null>;
}

/** A JPEG tile placed on the sheet (mm, y down from the dieline's top-left). */
export interface PrintTile {
  jpeg: Buffer;
  widthPx: number;
  heightPx: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PrintPdfOptions {
  bleedMm: number;
  tiles: PrintTile[];
  title?: string;
}

export interface PrintPdf {
  pdf: Buffer;
  /** The dieline's bounding box and the paper margin around it, mm (to place further pages the same way). */
  sheetWidthMm: number;
  sheetHeightMm: number;
  marginMm: number;
  engineVersion: string;
}
