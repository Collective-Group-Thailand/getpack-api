import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import sharp from 'sharp';

import {
  DielineBuildError,
  type DielineDrawing,
  type DielineEngine,
  DielineEngineUnavailableError,
  type DielineFormat,
  type DielineMaterial,
  type DielineQuantities,
  type DielineRequest,
  type RecipeBuild,
  type RecipeBuildRequest,
  type RecipeFacts,
  type StoredRecipe,
  type Thumbnails,
} from './dieline-engine.port';

type Pt = [number, number];
type Values = Record<string, unknown>;
interface Face {
  holes: unknown[];
}
interface Dieline {
  width: number;
  height: number;
  pieces: unknown[];
}
interface EngineRecipe {
  base?: string;
  variant?: Record<string, string>;
  materials?: string[];
  legacy?: { patternKeys: string[] };
  presets?: unknown;
}
interface Variant {
  axes: Record<string, string>;
  values: Values;
}
interface Image {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** What the API uses from `@packio/dieline` (README "Recipes and modules", "Solver", "Exports"). */
interface DielinePackage {
  RECIPES: EngineRecipe[];
  REFERENCE_MATERIALS: Record<string, DielineMaterial>;
  parseRecipe(raw: unknown): EngineRecipe;
  buildFromRecipe(
    recipe: EngineRecipe,
    values: Values,
    material: DielineMaterial,
  ): { dieline: Dieline; hinges: unknown };
  variantsOf(recipe: EngineRecipe): Variant[];
  recipeProcesses(recipe: EngineRecipe): string[];
  sizeRanges(recipe: EngineRecipe, material: DielineMaterial): Record<string, { min: number; max: number }>;
  explain(
    recipe: EngineRecipe,
    values: Values,
    material: DielineMaterial,
  ): { code: string; severity: string; param?: string | null }[];
  materialClassOf(material: DielineMaterial): string;
  dielineLines(d: Dieline): { role: string; edge: unknown }[];
  edgeLength(edge: unknown): number;
  allFaces(d: Dieline): Face[];
  facePolygons(face: Face): Pt[][];
  polygonsArea(polys: Pt[][]): number;
  flattenContour(contour: unknown): Pt[];
  dielineToSvg(d: Dieline, opts?: Values): string;
  dielineToDxf(d: Dieline): string;
  dielineToPdf(d: Dieline, opts?: Values): Uint8Array;
  render2D(d: Dieline, tone: 'kraft' | 'white', opts?: { size?: number }): Image;
  render3D(
    d: Dieline,
    hinges: unknown,
    material: DielineMaterial,
    tone: 'kraft' | 'white',
    opts?: { size?: number },
  ): Image;
}

const PACKAGE = '@packio/dieline';
const MIME: Record<DielineFormat, string> = {
  svg: 'image/svg+xml',
  dxf: 'application/dxf',
  pdf: 'application/pdf',
};

/** Shoelace area of a closed polygon, mm². */
function area(points: Pt[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Adapter over the vendored `@packio/dieline` bundle (`vendor/packio-dieline/index.mjs`, ADR-0010), loaded on first
 * use with a dynamic `import()`. Without the bundle the engine reports itself unavailable (callers answer 501).
 */
export class PackioDielineEngine implements DielineEngine {
  private loaded: Promise<{ pkg: DielinePackage; version: string } | null> | null = null;

  constructor(private readonly root = process.cwd()) {}

  async available(): Promise<boolean> {
    return (await this.load()) !== null;
  }

  async version(): Promise<string> {
    return (await this.engine()).version;
  }

  async draw(request: DielineRequest): Promise<DielineDrawing> {
    const { pkg, version } = await this.engine();
    const recipe = pkg.RECIPES.find((r) => r.legacy?.patternKeys.includes(request.dielineKey));
    if (!recipe)
      throw new DielineBuildError('variant_not_in_recipe', `no recipe for pattern key ${request.dielineKey}`);
    const material = Object.values(pkg.REFERENCE_MATERIALS).find((m) =>
      (recipe.materials ?? []).includes(pkg.materialClassOf(m)),
    );
    if (!material)
      throw new DielineBuildError('material_not_supported', 'no reference material for the recipe');
    const { dieline } = pkg.buildFromRecipe(
      recipe,
      { length: request.lengthMm, width: request.widthMm, height: request.heightMm },
      material,
    );
    return {
      body: this.file(pkg, dieline, request.format),
      mimeType: MIME[request.format],
      fileName: `dieline-${request.dielineKey}-${request.lengthMm}x${request.widthMm}x${request.heightMm}.${request.format}`,
      engineVersion: version,
    };
  }

  async build(request: RecipeBuildRequest, formats: DielineFormat[]): Promise<RecipeBuild> {
    const { pkg, version } = await this.engine();
    const { recipe, values } = this.pick(pkg, request);
    const violations = pkg.explain(recipe, values, request.material).map((v) => ({
      code: v.code,
      severity: v.severity,
      param: v.param ?? null,
    }));
    const { dieline } = pkg.buildFromRecipe(recipe, values, request.material);
    const files: RecipeBuild['files'] = {};
    for (const f of formats) files[f] = { body: this.file(pkg, dieline, f), mimeType: MIME[f] };
    return { quantities: this.quantities(pkg, dieline), files, violations, engineVersion: version };
  }

  async facts(stored: StoredRecipe): Promise<RecipeFacts> {
    const { pkg } = await this.engine();
    const recipes = this.parse(pkg, stored);
    const bases = new Set(recipes.map((r) => r.base ?? null));
    const processes = new Set<string>();
    const sizeRanges: RecipeFacts['sizeRanges'] = {};
    const variants: Record<string, string>[] = [];
    for (const r of recipes) {
      for (const p of pkg.recipeProcesses(r)) processes.add(p);
      for (const v of pkg.variantsOf(r)) variants.push(v.axes);
      for (const cls of r.materials ?? []) {
        if (sizeRanges[cls]) continue;
        const material = this.reference(pkg, cls);
        if (material) sizeRanges[cls] = pkg.sizeRanges(r, material);
      }
    }
    return {
      baseCode: bases.size === 1 ? [...bases][0]! : null,
      processes: [...processes].sort(),
      sizeRanges,
      variants,
    };
  }

  async thumbnails(request: RecipeBuildRequest, size: number): Promise<Thumbnails> {
    const { pkg, version } = await this.engine();
    const { recipe, values } = this.pick(pkg, request);
    const { dieline, hinges } = pkg.buildFromRecipe(recipe, values, request.material);
    const tone = pkg.materialClassOf(request.material) === 'corrugated' ? 'kraft' : 'white';
    const png = (img: Image) =>
      sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
        raw: { width: img.width, height: img.height, channels: 4 },
      })
        .png()
        .toBuffer();
    // Not every structure folds (labels, sleeves): 2D only then.
    const png3d = await Promise.resolve()
      .then(() => png(pkg.render3D(dieline, hinges, request.material, tone, { size })))
      .catch(() => null);
    return {
      png2d: await png(pkg.render2D(dieline, tone, { size })),
      png3d,
      svg: pkg.dielineToSvg(dieline),
      engineVersion: version,
    };
  }

  async recipesByBase(): Promise<Record<string, unknown[]>> {
    const { pkg } = await this.engine();
    const out: Record<string, unknown[]> = {};
    for (const r of pkg.RECIPES) if (r.base) (out[r.base] ??= []).push(r);
    return out;
  }

  // --- helpers ---------------------------------------------------------------------------------------------

  private parse(pkg: DielinePackage, stored: StoredRecipe): EngineRecipe[] {
    if (!Array.isArray(stored?.engine) || stored.engine.length === 0)
      throw new DielineBuildError('recipe_invalid', 'the stored recipe has no engine recipes');
    try {
      return stored.engine.map((r) => pkg.parseRecipe(r));
    } catch (error) {
      throw new DielineBuildError('recipe_invalid', (error as Error).message);
    }
  }

  /** The engine recipe and parameter values of the requested variant (axes compared as maps, ADR-0010). */
  private pick(pkg: DielinePackage, request: RecipeBuildRequest): { recipe: EngineRecipe; values: Values } {
    const wanted = Object.entries(request.options).map(([k, v]) => [
      k,
      Array.isArray(v) ? (v as unknown[]).map(String).sort().join('+') || 'none' : String(v),
    ]);
    for (const recipe of this.parse(pkg, request.recipe)) {
      const variant = pkg
        .variantsOf(recipe)
        .find((v) => wanted.every(([axis, value]) => v.axes[axis!] === undefined || v.axes[axis!] === value));
      if (variant) return { recipe, values: { ...variant.values, ...request.sizes } };
    }
    throw new DielineBuildError('variant_not_in_recipe', 'no engine recipe builds this variant');
  }

  private reference(pkg: DielinePackage, cls: string): DielineMaterial | null {
    return Object.values(pkg.REFERENCE_MATERIALS).find((m) => pkg.materialClassOf(m) === cls) ?? null;
  }

  private quantities(pkg: DielinePackage, d: Dieline): DielineQuantities {
    const byRole: Record<string, number> = {};
    for (const line of pkg.dielineLines(d))
      byRole[line.role] = (byRole[line.role] ?? 0) + pkg.edgeLength(line.edge);
    let blankArea = 0;
    let cutouts = 0;
    for (const face of pkg.allFaces(d)) {
      blankArea += pkg.polygonsArea(pkg.facePolygons(face));
      for (const hole of face.holes) cutouts += area(pkg.flattenContour(hole));
    }
    return {
      blankWidthMm: round(d.width),
      blankHeightMm: round(d.height),
      blankAreaMm2: round(blankArea),
      cutMm: round(byRole['cut'] ?? 0),
      creaseMm: round(byRole['crease'] ?? 0),
      perforationMm: round(byRole['perforation'] ?? 0),
      halfCutMm: round(byRole['half_cut'] ?? 0),
      glueOutlineMm: round(byRole['glue_area'] ?? 0),
      cutoutAreaMm2: round(cutouts),
      pieces: d.pieces.length,
    };
  }

  private file(pkg: DielinePackage, d: Dieline, format: DielineFormat): Buffer {
    if (format === 'svg') return Buffer.from(pkg.dielineToSvg(d), 'utf8');
    if (format === 'dxf') return Buffer.from(pkg.dielineToDxf(d), 'utf8');
    return Buffer.from(pkg.dielineToPdf(d));
  }

  private async engine(): Promise<{ pkg: DielinePackage; version: string }> {
    const engine = await this.load();
    if (!engine) throw new DielineEngineUnavailableError(`${PACKAGE} is not vendored (ADR-0010)`);
    return engine;
  }

  private load(): Promise<{ pkg: DielinePackage; version: string } | null> {
    this.loaded ??= (async () => {
      try {
        const dir = join(this.root, 'vendor', 'packio-dieline');
        const meta = JSON.parse(await readFile(join(dir, 'VERSION.json'), 'utf8')) as {
          version: string;
          bundleSha256: string;
        };
        const bundle = await readFile(join(dir, 'index.mjs'));
        // The bundle must be the one recorded (ADR-0010): a hand-edited bundle never loads.
        if (createHash('sha256').update(bundle).digest('hex') !== meta.bundleSha256) return null;
        const pkg = (await import(pathToFileURL(join(dir, 'index.mjs')).href)) as DielinePackage;
        return { pkg, version: `${PACKAGE}@${meta.version}+${meta.bundleSha256.slice(0, 8)}` };
      } catch {
        return null;
      }
    })();
    return this.loaded;
  }
}
