import { PDFDocument } from 'pdf-lib';

import { type DielineDrawing, type DielineEngine, type DielineRequest } from './dieline-engine.port';

const PT_PER_MM = 72 / 25.4;

/**
 * Test / `pnpm dev` engine: a PDF (or SVG) whose trim box is a flat blank of (2L + 2W) × (H + W) mm with a
 * 3 mm bleed — an obviously fake geometry that only exercises the pipeline (drawing → template → preflight).
 */
export class FakeDielineEngine implements DielineEngine {
  readonly drawn: DielineRequest[] = [];

  available(): Promise<boolean> {
    return Promise.resolve(true);
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
