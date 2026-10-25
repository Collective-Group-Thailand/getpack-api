import { type SpecLineDto } from './line-summary.dto';
import { sizeText, specLabel } from './spec-label';

const line = (key: string, valueTh: string, valueEn = valueTh): SpecLineDto => ({
  key,
  labelTh: key,
  labelEn: key,
  valueTh,
  valueEn,
});

describe('the one spec label (D-441, GLOBAL-RULES §5)', () => {
  it('writes sizes as length × width × height in mm, flat items without the height', () => {
    expect(sizeText({ l: 140, w: 97.5, d: 60 })).toBe('140 × 97.5 × 60');
    expect(sizeText({ l: 148, w: 105 })).toBe('148 × 105');
    expect(sizeText({ l: 148, w: 105, d: null })).toBe('148 × 105');
  });

  it('joins the values of the lines, without the style code or the priced inside size', () => {
    const label = specLabel(
      [
        line('style', 'กล่องฝาชน', 'RSC'),
        line('style_code', 'PK-RSC-01'),
        line('size', '140 × 97.5 × 60 มม. (ด้านใน)', '140 × 97.5 × 60 mm (inside)'),
        line('priced_size', '134 × 91.5 × 54 มม.'),
        line('material', 'ลูกฟูก KA125 ลอน B', 'KA125 B-flute'),
        line('print_front', 'ดำ', 'Black'),
      ],
      'corrugate',
    );
    expect(label).toEqual({
      th: 'กล่องฝาชน · 140 × 97.5 × 60 มม. (ด้านใน) · ลูกฟูก KA125 ลอน B · ดำ',
      en: 'RSC · 140 × 97.5 × 60 mm (inside) · KA125 B-flute · Black',
    });
  });

  it('says "ไม่พิมพ์" when a printable spec prints nothing (the Studio prices an empty draft unprinted)', () => {
    const label = specLabel(
      [line('size', '150 × 100 × 80 มม.', '150 × 100 × 80 mm'), line('material', 'KA125 B')],
      'corrugate',
    );
    expect(label).toEqual({
      th: '150 × 100 × 80 มม. · KA125 B · ไม่พิมพ์',
      en: '150 × 100 × 80 mm · KA125 B · Unprinted',
    });
  });

  it('counts a part’s print line and leaves non-printable calculators alone', () => {
    const parts = [line('size', '1 มม.'), line('parts[1].print_front', 'ดำ')];
    expect(specLabel(parts, 'corrugate').th).toBe('1 มม. · ดำ');
    expect(specLabel([line('service', 'ออกแบบโครงสร้าง')], 'service').th).toBe('ออกแบบโครงสร้าง');
    expect(specLabel([], 'corrugate')).toEqual({ th: '', en: '' });
  });
});
