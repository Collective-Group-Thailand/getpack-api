import { mergeHomePhotos, photoEntry, slotOf } from './home-photos';

const photo = (url: string) => photoEntry({ file: 'x.jpg', position: 'hero', altTh: 'ภาพ' }, url);

describe('home-photos manifest positions', () => {
  it('maps every position the page has', () => {
    expect(slotOf('hero')).toEqual({ kind: 'hero' });
    expect(slotOf('sage')).toEqual({ kind: 'quality' });
    expect(slotOf('frame-4')).toEqual({ kind: 'process', step: 'sample' });
    expect(slotOf('frame-9')).toEqual({ kind: 'process', step: 'packing' });
    expect(slotOf('mosaic-1')).toEqual({ kind: 'mosaic', index: 0 });
    expect(slotOf('mosaic-5')).toEqual({ kind: 'mosaic', index: 4 });
    expect(slotOf('template-PK-CF-01')).toEqual({ kind: 'template', code: 'PK-CF-01' });
    expect(slotOf('template-mailer', { mailer: 'PK-CF-01' })).toEqual({ kind: 'template', code: 'PK-CF-01' });
  });

  it('refuses positions it cannot place', () => {
    expect(slotOf('mosaic-6')).toBeNull();
    expect(slotOf('frame-1')).toBeNull();
    // A template needs a style code: a name without a mapping is never guessed.
    expect(slotOf('template-mailer')).toBeNull();
    expect(slotOf('template-mailer', { mailer: 'mailer' })).toBeNull();
  });

  it('keeps Thai text, drops an empty caption and requires alt text', () => {
    expect(photoEntry({ file: 'a.jpg', position: 'sage', altTh: ' โรงพิมพ์ ', captionTh: '' }, '/u')).toEqual(
      {
        url: '/u',
        alt: { th: 'โรงพิมพ์' },
        caption: null,
      },
    );
    expect(() => photoEntry({ file: 'a.jpg', position: 'sage', altTh: ' ' }, '/u')).toThrow('altTh');
  });

  it('replaces only the slots the manifest names', () => {
    const current = {
      hero: photo('/old-hero'),
      mosaic: [photo('/m1'), photo('/m2')],
      process: { sample: photo('/s') },
      templates: { 'PK-TE-01': photo('/t') },
      other: true,
    };
    const next = mergeHomePhotos(current, [
      { slot: { kind: 'mosaic', index: 1 }, photo: photo('/m2-new') },
      { slot: { kind: 'mosaic', index: 3 }, photo: photo('/m4') },
      { slot: { kind: 'process', step: 'packing' }, photo: photo('/p') },
      { slot: { kind: 'template', code: 'PK-CF-01' }, photo: photo('/cf') },
      { slot: { kind: 'quality' }, photo: photo('/q') },
    ]);
    expect(next).toMatchObject({
      hero: { url: '/old-hero' },
      quality: { url: '/q' },
      process: { sample: { url: '/s' }, packing: { url: '/p' } },
      templates: { 'PK-TE-01': { url: '/t' }, 'PK-CF-01': { url: '/cf' } },
      other: true,
    });
    expect((next.mosaic as { url: string }[]).map((m) => m?.url ?? null)).toEqual([
      '/m1',
      '/m2-new',
      null,
      '/m4',
    ]);
    expect(current.mosaic).toHaveLength(2);
  });
});
