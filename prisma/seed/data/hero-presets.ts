/**
 * The homepage Studio hero's presets as the product owner set them (Phase 4 review, 2026-10-08; D-310). Business
 * values only: which catalogue product a shape opens and which material / ink options a board or print means are
 * the catalogue's and are mapped per environment (`productSlug`, `optionCodes`) — without a mapping an entry is
 * dropped on read, never shipped unquotable. Style codes (owner, 2026-10-08): mailer PK-CF-01; lid PK-CT-02 (HSC body
 * with a separate telescope lid — two pieces); tuck PK-TE-01, whose engine recipes include the reverse tuck end and
 * whose paperboard range (L 20–400, W 15–300, H 20–450 mm) takes 100×100×180. D-459 (C11): the mailer's sizes are its
 * product's postal sizes A–D (`standardSizeCodes`).
 */
export interface HeroPresetsSeed {
  shapes: {
    id: 'mailer' | 'lid' | 'tuck';
    labelTh: string;
    styleCode?: string;
    productSlug?: string;
    /**
     * D-459 (owner 2026-10-29, C11): this shape offers its catalogue product's standard sizes with these codes, in this
     * order — the catalogue's own millimetres and names, never typed numbers; `sizesMm` serves the other shapes.
     */
    standardSizeCodes?: string[];
  }[];
  sizesMm: { w: number; d: number; h: number }[];
  materials: { id: 'kraft350' | 'art350' | 'corrE'; labelTh: string; optionCodes?: string[] }[];
  prints: { id: 'none' | 'one' | 'full'; labelTh: string; optionCodes?: string[] }[];
  quantities: number[];
  default: { shape: string; size: number; material: string; print: string; qty: number };
}

export const HERO_PRESETS: HeroPresetsSeed = {
  shapes: [
    // D-459: the mailer offers the postal sizes A–D of its product (UAT: เบอร์ A 20×14×6 … D 35×22×14 ซม.).
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
};

/**
 * D-459 (C11): an existing `catalog.hero_presets` gets the mailer's postal sizes once — only while no shape names
 * standard sizes yet (an Admin's own choice is never overwritten). Pure, for the seed and its test.
 */
export function heroPresetsAmendment(current: unknown): HeroPresetsSeed | undefined {
  const value = current as HeroPresetsSeed | null;
  if (!value || !Array.isArray(value.shapes)) return undefined;
  if (value.shapes.some((s) => s.standardSizeCodes !== undefined)) return undefined;
  const codes = HERO_PRESETS.shapes.find((s) => s.id === 'mailer')?.standardSizeCodes;
  if (!codes || !value.shapes.some((s) => s.id === 'mailer')) return undefined;
  return {
    ...value,
    shapes: value.shapes.map((s) => (s.id === 'mailer' ? { ...s, standardSizeCodes: [...codes] } : s)),
  };
}
