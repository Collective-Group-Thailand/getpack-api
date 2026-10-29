import { HERO_PRESETS, heroPresetsAmendment } from '../../../../prisma/seed/data/hero-presets';
import { SETTINGS } from '../../../../prisma/seed/data/settings';
import { offeredDefault, type ResolvedShape, shapeSizeCandidates, sizeLabelTh } from './hero-presets.service';

const shape = (over: Partial<ResolvedShape>): ResolvedShape => ({
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
        { id: 'mailer', labelTh: 'ไปรษณีย์', styleCode: 'PK-CF-01', standardSizeCodes: ['A', 'B', 'C', 'D'] },
        { id: 'lid', labelTh: 'ฝาครอบ', styleCode: 'PK-CT-02' },
        { id: 'tuck', labelTh: 'ฝาเสียบ', styleCode: 'PK-TE-01' },
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
      default: { shape: 'mailer', size: 0, material: 'corrE', print: 'one', qty: 500 },
    });
    const setting = SETTINGS.find((s) => s.key === 'catalog.hero_presets')!;
    expect(setting).toMatchObject({ value: HERO_PRESETS, ownerRole: 'admin' });
    expect(setting.unset).toBeUndefined();
    for (const key of ['artwork.first_proof_business_days', 'support.reply_minutes'])
      expect(SETTINGS.find((s) => s.key === key)).toMatchObject({ unset: true, value: null });
    // D-447 (C1b): the support hours were decided — daily 09:00–18:00, filled where still unset.
    expect(SETTINGS.find((s) => s.key === 'storefront.support_hours')).toMatchObject({
      value: { days: 'daily', open: '09:00', close: '18:00' },
      fillIfUnset: true,
    });
  });

  it('opens on the owner’s default when the catalogue offers it, and on nothing otherwise', () => {
    const wanted = { shape: 'mailer', size: 0, material: 'corrE', print: 'one', qty: 500 };
    expect(offeredDefault([shape({})], wanted)).toEqual({
      shape: 'mailer',
      size: 0,
      material: 'corrE',
      print: 'one',
      qty: 500,
    });
    expect(offeredDefault([shape({})], { ...wanted, material: 'kraft350' })).toBeNull();
    expect(offeredDefault([shape({})], { ...wanted, size: 2 })).toBeNull();
    expect(offeredDefault([shape({ id: 'tuck' })], wanted)).toBeNull();
    expect(offeredDefault([], wanted)).toBeNull();
  });

  it('labels a size in centimetres', () => {
    expect(sizeLabelTh({ lengthMm: 180, widthMm: 120, heightMm: 50 })).toBe('18×12×5 ซม.');
    expect(sizeLabelTh({ lengthMm: 97.5, widthMm: 140, heightMm: 60 })).toBe('9.8×14×6 ซม.');
  });

  describe('D-459 (C11): the mailer offers its product’s postal sizes A–D', () => {
    const postal = [
      { code: '00', name: 'เบอร์ 00 (14×9.75×6 ซม.)', lengthMm: 140, widthMm: 97.5, heightMm: 60 },
      { code: 'A', name: 'เบอร์ A (20×14×6 ซม.)', lengthMm: 200, widthMm: 140, heightMm: 60 },
      { code: 'B', name: 'เบอร์ B (25×17×9 ซม.)', lengthMm: 250, widthMm: 170, heightMm: 90 },
      { code: 'C', name: 'เบอร์ C (30×20×11 ซม.)', lengthMm: 300, widthMm: 200, heightMm: 110 },
      { code: 'D', name: 'เบอร์ D (35×22×14 ซม.)', lengthMm: 350, widthMm: 220, heightMm: 140 },
    ];

    it('takes the catalogue’s sizes and names in the order of the codes', () => {
      const mailer = HERO_PRESETS.shapes.find((s) => s.id === 'mailer')!;
      expect(shapeSizeCandidates(HERO_PRESETS, mailer, postal)).toEqual([
        { index: 0, lengthMm: 200, widthMm: 140, heightMm: 60, nameTh: 'เบอร์ A (20×14×6 ซม.)' },
        { index: 1, lengthMm: 250, widthMm: 170, heightMm: 90, nameTh: 'เบอร์ B (25×17×9 ซม.)' },
        { index: 2, lengthMm: 300, widthMm: 200, heightMm: 110, nameTh: 'เบอร์ C (30×20×11 ซม.)' },
        { index: 3, lengthMm: 350, widthMm: 220, heightMm: 140, nameTh: 'เบอร์ D (35×22×14 ซม.)' },
      ]);
    });

    it('keeps the typed sizes for a shape without codes, or a product without those sizes', () => {
      const lid = HERO_PRESETS.shapes.find((s) => s.id === 'lid')!;
      const typed = HERO_PRESETS.sizesMm.map((s, index) => ({
        index,
        lengthMm: s.w,
        widthMm: s.d,
        heightMm: s.h,
      }));
      expect(shapeSizeCandidates(HERO_PRESETS, lid, postal)).toEqual(typed);
      expect(shapeSizeCandidates(HERO_PRESETS, { standardSizeCodes: ['A'] }, [])).toEqual(typed);
    });

    it('amends an existing value once, never over an Admin’s choice', () => {
      const old = {
        ...HERO_PRESETS,
        shapes: HERO_PRESETS.shapes.map(({ standardSizeCodes: _, ...s }) => ({
          ...s,
          productSlug: `p-${s.id}`,
        })),
      };
      const amended = heroPresetsAmendment(old)!;
      expect(amended.shapes[0]).toEqual({
        id: 'mailer',
        labelTh: 'ไปรษณีย์',
        styleCode: 'PK-CF-01',
        productSlug: 'p-mailer',
        standardSizeCodes: ['A', 'B', 'C', 'D'],
      });
      expect(amended.shapes.slice(1)).toEqual(old.shapes.slice(1));
      expect(heroPresetsAmendment(amended)).toBeUndefined();
      const chosen = {
        ...old,
        shapes: [{ ...old.shapes[0]!, standardSizeCodes: ['B'] }, ...old.shapes.slice(1)],
      };
      expect(heroPresetsAmendment(chosen)).toBeUndefined();
      expect(heroPresetsAmendment(null)).toBeUndefined();
    });
  });
});
