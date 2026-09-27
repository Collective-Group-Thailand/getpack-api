import sharp from 'sharp';

import { type ColourFamily, type FileFacts } from './facts';

/**
 * Facts of a raster upload (PNG, JPEG, TIFF, WebP) with sharp (ADR-0009): the image is its own page at its
 * declared density (72 ppi when the file declares none, the PDF/PostScript default), placed at full size.
 */
export async function rasterFacts(bytes: Uint8Array): Promise<FileFacts> {
  const info = await sharp(bytes)
    .metadata()
    .catch(() => null);
  if (!info?.width || !info.height) return { kind: 'error', reason: 'unreadable' };
  const density = info.density && info.density > 0 ? info.density : 72;
  const widthPt = (info.width / density) * 72;
  const heightPt = (info.height / density) * 72;
  const colour: ColourFamily =
    info.space === 'cmyk' ? 'cmyk' : info.space === 'b-w' || info.space === 'grey16' ? 'gray' : 'rgb';
  return {
    kind: 'raster',
    pageCount: 1,
    truncated: false,
    densityPpi: density,
    pages: [
      {
        page: 1,
        mediaBox: [0, 0, widthPt, heightPt],
        trimBox: null,
        bleedBox: null,
        images: [
          {
            name: 'image',
            widthPx: info.width,
            heightPx: info.height,
            placedWidthPt: widthPt,
            placedHeightPt: heightPt,
            colour,
          },
        ],
        fonts: [],
        rgbPaintOps: 0,
        spotNames: [],
        minStrokeWidthPt: null,
        overprint: false,
        textOrigins: [],
      },
    ],
  };
}
