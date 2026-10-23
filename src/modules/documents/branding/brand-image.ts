import sharp from 'sharp';

/**
 * Images printed on documents (D-428, D-429): a logo, a company seal and a signature are re-encoded as PNG at a
 * size that prints sharply on A4 yet keeps the PDF small (e-Tax by Email allows 3 MB per document). A seal or a
 * signature photographed or scanned on white paper gets its paper made transparent, so it sits on the document's
 * lines the way ink would; a logo keeps its own background unless it already has transparency.
 */

export type BrandImageKind = 'logo' | 'seal' | 'signature';

const MAX_SIDE: Record<BrandImageKind, number> = { logo: 900, seal: 600, signature: 800 };

/** Near-white pixels (all channels ≥ this) become transparent; lighter greys fade smoothly. */
const PAPER = 235;
const FADE_FROM = 190;

export class BrandImageError extends Error {}

export async function prepareBrandImage(input: Buffer, kind: BrandImageKind): Promise<Buffer> {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(input, { failOn: 'error' }).metadata();
  } catch {
    throw new BrandImageError('not an image');
  }
  if (!meta.width || !meta.height) throw new BrandImageError('not an image');
  const side = MAX_SIDE[kind];
  const resized = sharp(input)
    .rotate()
    .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha();
  if (kind === 'logo') return resized.png({ compressionLevel: 9, palette: false }).toBuffer();
  const { data, info } = await resized.raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const lightest = Math.min(data[i]!, data[i + 1]!, data[i + 2]!);
    if (lightest >= PAPER) data[i + 3] = 0;
    else if (lightest > FADE_FROM)
      data[i + 3] = Math.min(data[i + 3]!, Math.round((255 * (PAPER - lightest)) / (PAPER - FADE_FROM)));
  }
  const trimmed = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
  // Cut the transparent margin so the image is the ink only (sizes on the page are then predictable).
  try {
    return await sharp(trimmed).trim({ threshold: 1 }).png({ compressionLevel: 9 }).toBuffer();
  } catch {
    return trimmed;
  }
}

export const dataUri = (png: Buffer, mime = 'image/png') => `data:${mime};base64,${png.toString('base64')}`;
