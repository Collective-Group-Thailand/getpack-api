import { DomainException } from '@common/errors/domain.exception';

import { orderedImages, uploadedPhotoVariant } from './image-order';

const images = [{ publicId: 'a' }, { publicId: 'b' }, { publicId: 'c' }];

describe('orderedImages', () => {
  it('returns the images in the asked order', () => {
    expect(orderedImages(images, ['c', 'a', 'b']).map((i) => i.publicId)).toEqual(['c', 'a', 'b']);
  });

  it.each([
    [['c', 'a'], 'imageIds', 'complete'],
    [['c', 'a', 'a'], 'imageIds[2]', 'unique'],
    [['c', 'a', 'x'], 'imageIds[2]', 'exists'],
  ])('rejects %j at %s (%s)', (ids, path, code) => {
    let caught: unknown;
    try {
      orderedImages(images, ids);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DomainException);
    expect((caught as DomainException).code).toBe('validation.failed');
    expect((caught as DomainException).errors).toEqual([expect.objectContaining({ path, code })]);
  });
});

describe('uploadedPhotoVariant', () => {
  it('tags an upload as a getpack photograph, keeping what the caller said', () => {
    expect(uploadedPhotoVariant(null)).toEqual({ kind: 'photo', source: 'getpack' });
    expect(uploadedPhotoVariant({ material: 'art-card-350' })).toEqual({
      kind: 'photo',
      source: 'getpack',
      material: 'art-card-350',
    });
  });
});
