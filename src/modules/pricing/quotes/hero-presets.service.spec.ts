import { HERO_PRESETS } from '../../../../prisma/seed/data/hero-presets';
import { SETTINGS } from '../../../../prisma/seed/data/settings';
import { pickDefault, type ResolvedShape, sizeLabelTh } from './hero-presets.service';

const shape = (over: Partial<ResolvedShape>): ResolvedShape =>
  ({
    id: 'mailer',
    labelTh: 'ไปรษณีย์',
    styleCode: null,
    configurator: {} as ResolvedShape['configurator'],
    patternId: 'pt',
    sizes: [
      { index: 0, lengthMm: 180, widthMm: 120, heightMm: 50 },
      { index: 1, lengthMm: 250, widthMm: 180, heightMm: 80 },
    ],
    materials: new Map([['corrE', { id: 'm-e', nameTh: 'E', nameEn: 'E' }]]),
    prints: new Map([
      ['none', []],
      ['one', ['ink']],
    ]),
    qtys: [300, 500, 1000, 2000],
    ...over,
  });

describe('hero presets (Phase 4 review, D-310)', () => {
  it('seeds exactly the product owner’s values, with no catalogue mapping in the reference seed', () => {
    expect(HERO_PRESETS).toEqual({
      shapes: [
        { id: 'mailer', labelTh: 'ไปรษณีย์', styleCode: 'PK-CF-01' },
        { id: 'lid', labelTh: 'ฝาครอบ' },
        { id: 'tuck', labelTh: 'ฝาเสียบ' },
      ],
      sizesMm: [
        { w: 180, d: 120, h: 50 },
        { w: 250, d: 180, h: 80 },
        { w: 100, d: 100, h: 180 },
      ],
      materials: [
        { id: 'kraft350', labelTh: 'คราฟท์ 350g' },
        { id: 'art350', labelTh: 'อาร์ตการ์ด 350g' },
        { id: 'corrE', labelTh: 'ลูกฟูก E' },
      ],
      prints: [
        { id: 'none', labelTh: 'ไม่พิมพ์' },
        { id: 'one', labelTh: '1 สี' },
        { id: 'full', labelTh: 'เต็มสี' },
      ],
      quantities: [300, 500, 1000, 2000],
      default: { shape: 'mailer', size: 0, material: 'kraft350', print: 'one', qty: 500 },
    });
    const setting = SETTINGS.find((s) => s.key === 'catalog.hero_presets')!;
    expect(setting).toMatchObject({ value: HERO_PRESETS, ownerRole: 'admin' });
    expect(setting.unset).toBeUndefined();
    for (const key of [
      'artwork.first_proof_business_days',
      'storefront.support_hours',
      'support.reply_minutes',
    ])
      expect(SETTINGS.find((s) => s.key === key)).toMatchObject({ unset: true, value: null });
  });

  it('keeps the owner’s default when it is offered', () => {
    const wanted = { shape: 'mailer', size: 0, material: 'corrE', print: 'one', qty: 500 };
    expect(pickDefault([shape({})], wanted)).toEqual({
      selection: { shape: 'mailer', size: 0, material: 'corrE', print: 'one', qty: 500 },
      adjusted: false,
    });
  });

  it('moves to the nearest offered selection, keeping what the shape offers', () => {
    const wanted = { shape: 'mailer', size: 2, material: 'kraft350', print: 'one', qty: 500 };
    expect(pickDefault([shape({})], wanted)).toEqual({
      selection: { shape: 'mailer', size: 0, material: 'corrE', print: 'one', qty: 500 },
      adjusted: true,
    });
    const tuck = shape({ id: 'tuck', qtys: [500, 1000] });
    expect(pickDefault([tuck], { ...wanted, shape: 'mailer', qty: 300 }).selection).toMatchObject({
      shape: 'tuck',
      qty: 500,
    });
    expect(pickDefault([], wanted)).toEqual({ selection: null, adjusted: true });
  });

  it('labels a size in centimetres', () => {
    expect(sizeLabelTh({ lengthMm: 180, widthMm: 120, heightMm: 50 })).toBe('18×12×5 ซม.');
    expect(sizeLabelTh({ lengthMm: 97.5, widthMm: 140, heightMm: 60 })).toBe('9.8×14×6 ซม.');
  });
});
