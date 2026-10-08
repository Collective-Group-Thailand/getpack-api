/**
 * The homepage Studio hero's presets as the product owner set them (Phase 4 review, 2026-10-08; D-310). Business
 * values only: which catalogue product a shape opens and which material / ink options a board or print means are
 * the catalogue's and are mapped per environment (`productSlug`, `optionCodes`) — without a mapping an entry is
 * dropped on read, never shipped unquotable. Style codes (owner, 2026-10-08): mailer PK-CF-01; lid PK-CT-02 (HSC body
 * with a separate telescope lid — two pieces); tuck PK-TE-01, whose engine recipes include the reverse tuck end and
 * whose paperboard range (L 20–400, W 15–300, H 20–450 mm) takes 100×100×180.
 */
export interface HeroPresetsSeed {
  shapes: { id: 'mailer' | 'lid' | 'tuck'; labelTh: string; styleCode?: string; productSlug?: string }[];
  sizesMm: { w: number; d: number; h: number }[];
  materials: { id: 'kraft350' | 'art350' | 'corrE'; labelTh: string; optionCodes?: string[] }[];
  prints: { id: 'none' | 'one' | 'full'; labelTh: string; optionCodes?: string[] }[];
  quantities: number[];
  default: { shape: string; size: number; material: string; print: string; qty: number };
}

export const HERO_PRESETS: HeroPresetsSeed = {
  shapes: [
    { id: 'mailer', labelTh: 'ไปรษณีย์', styleCode: 'PK-CF-01' },
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
