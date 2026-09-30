import { type RefResolver } from './ref-resolver';

/**
 * Storefront content of an offerable catalogue option or a pattern (U-B0.1, schema-design A-51): a description in
 * both languages and an image, shown in the configurator. Admin-maintained; null until set.
 */
export const CONTENT_INCLUDE = { imageFile: { select: { publicId: true } } } as const;

export interface WithContent {
  descriptionTh: string | null;
  descriptionEn: string | null;
  imageFile: { publicId: string } | null;
}

export const contentView = (row: WithContent) => ({
  descriptionTh: row.descriptionTh,
  descriptionEn: row.descriptionEn,
  imageFileId: row.imageFile?.publicId ?? null,
});

/** The image file of a create / update body (`undefined` leaves it, `null` clears it). */
export async function contentImage(refs: RefResolver, input: { imageFileId?: string | null }) {
  return { imageFileId: await refs.optionalFile(input.imageFileId, 'imageFileId') };
}
