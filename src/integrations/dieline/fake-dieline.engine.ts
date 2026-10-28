import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';

import { writeDesignerPdf } from './designer-pdf';
import {
  type DesignerPdfOptions,
  type DielineBlank,
  type DielineDrawing,
  type DielineEngine,
  type DielineFormat,
  type DielineMaterial,
  type DielineRequest,
  type PrintPdf,
  type PrintPdfOptions,
  type RecipeBuild,
  type RecipeBuildRequest,
  type RecipeFacts,
  type RecipeInsideSizes,
  type StoredRecipe,
  type Thumbnails,
} from './dieline-engine.port';

const PT_PER_MM = 72 / 25.4;

/** D-302 the designer PDF of the fake blank: its outline cut, two creases, a glue flap; bleed and safe as rectangles. */
function fakeDesignerPdf(w: number, h: number, l: number, o: DesignerPdfOptions): Buffer {
  const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const outline = rect(0, 0, w, h);
  return writeDesignerPdf({
    widthMm: w,
    heightMm: h,
    strokes: {
      cut: [outline.map((p, i) => ({ from: p, to: outline[(i + 1) % 4]! }))],
      crease: [[{ from: [l, 0], to: [l, h] }], [{ from: [2 * l, 0], to: [2 * l, h] }]],
      glue_area: [[{ from: [w - 10, 0], to: [w - 10, h] }]],
    },
    bleed: [rect(-o.bleedMm, -o.bleedMm, w + o.bleedMm, h + o.bleedMm)],
    safe: [rect(o.safeMm, o.safeMm, w - o.safeMm, h - o.safeMm)],
    title: o.title,
    styleCode: o.styleCode,
    keywords: o.keywords,
    producer: 'getpack designer PDF (fake-dieline@0)',
    bleedMm: o.bleedMm,
    safeMm: o.safeMm,
  });
}

/**
 * Test / `pnpm dev` engine: a PDF (or SVG) whose trim box is a flat blank of (2L + 2W) × (H + W) mm with a
 * 3 mm bleed — an obviously fake geometry that only exercises the pipeline (drawing → template → preflight).
 */
export class FakeDielineEngine implements DielineEngine {
  readonly drawn: DielineRequest[] = [];

  readonly built: RecipeBuildRequest[] = [];

  available(): Promise<boolean> {
    return Promise.resolve(true);
  }

  version(): Promise<string> {
    return Promise.resolve('fake-dieline@0');
  }

  /** A flat (2L + 2W) × (H + W) blank: obviously fake quantities for the pipeline. */
  build(
    request: RecipeBuildRequest,
    formats: DielineFormat[],
    designerPdf?: DesignerPdfOptions,
  ): Promise<RecipeBuild> {
    this.built.push(request);
    const l = request.sizes['length'] ?? 100;
    const w = request.sizes['width'] ?? 50;
    const h = request.sizes['height'] ?? 100;
    const bw = 2 * l + 2 * w;
    const bh = h + w;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${bw}mm" height="${bh}mm"><rect width="${bw}" height="${bh}"/></svg>`;
    const files: RecipeBuild['files'] = {};
    for (const f of formats)
      files[f] = {
        body:
          f === 'pdf' && designerPdf
            ? fakeDesignerPdf(bw, bh, l, designerPdf)
            : Buffer.from(f === 'svg' ? svg : `fake ${f}`),
        mimeType: f === 'svg' ? 'image/svg+xml' : f === 'pdf' ? 'application/pdf' : 'application/dxf',
      };
    return Promise.resolve({
      quantities: {
        blankWidthMm: bw,
        blankHeightMm: bh,
        blankAreaMm2: bw * bh,
        cutMm: 2 * (bw + bh),
        creaseMm: 3 * bh,
        perforationMm: 0,
        halfCutMm: 0,
        glueOutlineMm: 2 * bh,
        cutoutAreaMm2: 0,
        pieces: 1,
      },
      files,
      violations: [],
      engineVersion: 'fake-dieline@0',
    });
  }

  facts(recipe: StoredRecipe): Promise<RecipeFacts> {
    const first = (recipe.engine[0] ?? {}) as { base?: string; processes?: string[] };
    return Promise.resolve({
      baseCode: first.base ?? null,
      processes: first.processes ?? ['die_cut'],
      sizeRanges: {
        paperboard: {
          length: { min: 20, max: 400 },
          width: { min: 15, max: 300 },
          height: { min: 20, max: 450 },
        },
      },
      // The fake cannot enumerate a recipe's variants: unknown, so the D-407 drawability gate stays open.
      variants: null,
    });
  }

  /** The fake knows no presets or closed sizes: nothing (C1c sources (b)/(c) from the engine stay empty). */
  insideSizes(_recipe: StoredRecipe): Promise<RecipeInsideSizes> {
    return Promise.resolve({});
  }

  async thumbnails(_request: RecipeBuildRequest, size: number): Promise<Thumbnails> {
    const png = await sharp({ create: { width: size, height: size, channels: 4, background: '#f2efe8' } })
      .png()
      .toBuffer();
    return {
      png2d: png,
      png3d: null,
      svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      engineVersion: 'fake-dieline@0',
    };
  }

  recipesByBase(): Promise<Record<string, unknown[]>> {
    return Promise.resolve({});
  }

  /** A page of the fake blank with the tiles placed on it (no die lines): exercises the print pipeline only. */
  async printPdf(request: RecipeBuildRequest, options: PrintPdfOptions): Promise<PrintPdf> {
    const l = request.sizes['length'] ?? 100;
    const w = request.sizes['width'] ?? 50;
    const h = request.sizes['height'] ?? 100;
    const sheetWidthMm = 2 * l + 2 * w;
    const sheetHeightMm = h + w;
    const margin = 10;
    const doc = await PDFDocument.create();
    doc.setTitle(options.title ?? 'fake print file');
    const page = doc.addPage([
      (sheetWidthMm + 2 * margin) * PT_PER_MM,
      (sheetHeightMm + 2 * margin) * PT_PER_MM,
    ]);
    for (const t of options.tiles) {
      const image = await doc.embedJpg(new Uint8Array(t.jpeg));
      page.drawImage(image, {
        x: (margin + t.x) * PT_PER_MM,
        y: page.getHeight() - (margin + t.y + t.height) * PT_PER_MM,
        width: t.width * PT_PER_MM,
        height: t.height * PT_PER_MM,
      });
    }
    page.setTrimBox(
      margin * PT_PER_MM,
      margin * PT_PER_MM,
      sheetWidthMm * PT_PER_MM,
      sheetHeightMm * PT_PER_MM,
    );
    return {
      pdf: Buffer.from(await doc.save()),
      sheetWidthMm,
      sheetHeightMm,
      marginMm: margin,
      engineVersion: 'fake-dieline@0',
    };
  }

  /** Obviously fake calipers per class. */
  referenceMaterial(materialClass: string): Promise<DielineMaterial | null> {
    const caliper: Record<string, number> = { paperboard: 0.45, corrugated: 3, rigid: 2, label_stock: 0.1 };
    const c = caliper[materialClass];
    return Promise.resolve(c === undefined ? null : { kind: materialClass, caliperMm: c });
  }

  /** The same obviously fake (2L + 2W) × (H + W) blank as {@link draw}. */
  blank(request: Omit<DielineRequest, 'format'>): Promise<DielineBlank> {
    return Promise.resolve({
      widthMm: 2 * request.lengthMm + 2 * request.widthMm,
      heightMm: request.heightMm + request.widthMm,
      engineVersion: 'fake-dieline@0',
    });
  }

  async draw(request: DielineRequest): Promise<DielineDrawing> {
    this.drawn.push(request);
    const w = 2 * request.lengthMm + 2 * request.widthMm;
    const h = request.heightMm + request.widthMm;
    const fileName = `dieline-${request.dielineKey}.${request.format}`;
    if (request.format === 'pdf') {
      const doc = await PDFDocument.create();
      const bleed = 3 * PT_PER_MM;
      const page = doc.addPage([w * PT_PER_MM + 2 * bleed, h * PT_PER_MM + 2 * bleed]);
      page.setTrimBox(bleed, bleed, w * PT_PER_MM, h * PT_PER_MM);
      page.setBleedBox(0, 0, page.getWidth(), page.getHeight());
      page.drawRectangle({
        x: bleed,
        y: bleed,
        width: w * PT_PER_MM,
        height: h * PT_PER_MM,
        borderWidth: 0.5,
      });
      return {
        body: Buffer.from(await doc.save()),
        mimeType: 'application/pdf',
        fileName,
        engineVersion: 'fake-dieline@0',
      };
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="none" stroke="black"/></svg>`;
    return {
      body: Buffer.from(request.format === 'svg' ? svg : `0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n`),
      mimeType: request.format === 'svg' ? 'image/svg+xml' : 'application/dxf',
      fileName,
      engineVersion: 'fake-dieline@0',
    };
  }
}
