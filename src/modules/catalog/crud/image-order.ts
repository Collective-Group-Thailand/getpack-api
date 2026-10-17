import { DomainException } from '@common/errors/domain.exception';

/**
 * Where a newly uploaded photo goes and what it is tagged (D-426): without a `sort` it leads — a photograph the
 * catalogue owner uploads replaces an AI render as the cover — and carries `{ kind: photo, source: getpack }` under
 * whatever else the caller said about it; with a `sort` it goes where asked, tagged the same.
 */
export const uploadedPhotoVariant = (
  variant: Record<string, unknown> | null | undefined,
): Record<string, unknown> => ({
  kind: 'photo',
  source: 'getpack',
  ...(variant ?? {}),
});

/**
 * The new order of a product's images: every current image exactly once, by public id. Returns the images in
 * that order; a missing, repeated or foreign id is a validation error naming the position.
 */
export function orderedImages<T extends { publicId: string }>(images: T[], imageIds: string[]): T[] {
  const byId = new Map(images.map((image) => [image.publicId, image]));
  const seen = new Set<string>();
  const ordered: T[] = [];
  imageIds.forEach((id, index) => {
    const image = byId.get(id);
    if (!image || seen.has(id))
      throw new DomainException('validation.failed', {
        errors: [
          {
            path: `imageIds[${index}]`,
            code: image ? 'unique' : 'exists',
            message: image ? 'listed twice' : 'not an image of this product',
          },
        ],
      });
    seen.add(id);
    ordered.push(image);
  });
  if (ordered.length !== images.length)
    throw new DomainException('validation.failed', {
      errors: [{ path: 'imageIds', code: 'complete', message: `all ${images.length} images must be listed` }],
    });
  return ordered;
}
