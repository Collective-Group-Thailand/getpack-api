import { type SpecLineDto } from './line-summary.dto';
import { printMethodText, printSideText, sizeText, sizeValue, specLabel, specLinesText } from './spec-label';

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
        {
          ...line('print_front', 'สีพิเศษ 1 สี (ดำ)', '1 spot colour (ดำ)'),
          labelTh: 'พิมพ์ด้านนอก',
          labelEn: 'Print (outside)',
        },
      ],
      'corrugate',
    );
    expect(label).toEqual({
      th: 'กล่องฝาชน · 140 × 97.5 × 60 มม. (ด้านใน) · ลูกฟูก KA125 ลอน B · พิมพ์ด้านนอก: สีพิเศษ 1 สี (ดำ)',
      en: 'RSC · 140 × 97.5 × 60 mm (inside) · KA125 B-flute · Print (outside): 1 spot colour (ดำ)',
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
    expect(specLabel(parts, 'corrugate').th).toBe('1 มม. · parts[1].print_front: ดำ');
    expect(specLabel([line('service', 'ออกแบบโครงสร้าง')], 'service').th).toBe('ออกแบบโครงสร้าง');
    expect(specLabel([], 'corrugate')).toEqual({ th: '', en: '' });
  });

  describe('B-API-3: print per side and inner dimensions', () => {
    const black = { name: 'ดำ', kind: 'spot' };
    const red = { name: 'แดง', kind: 'spot' };
    const cmyk = { name: 'CMYK', kind: 'process' };
    const box = (...extra: SpecLineDto[]) => [
      {
        key: 'size',
        labelTh: 'ขนาด',
        labelEn: 'Size',
        ...toLine(sizeValue({ l: 140, w: 97.5, d: 60 }, 'internal')),
      },
      ...extra,
    ];
    const toLine = (v: { th: string; en: string } | null) => ({ valueTh: v!.th, valueEn: v!.en });
    const side = (key: string, labelTh: string, labelEn: string, inks: { name: string; kind: string }[]) => ({
      key,
      labelTh,
      labelEn,
      ...toLine(printMethodText(inks)),
    });

    it('describes the method of a side: CMYK, สีพิเศษ n สี, CMYK + สีพิเศษ n สี; nothing for an unprinted side', () => {
      expect(printMethodText([cmyk])).toEqual({ th: 'CMYK', en: 'CMYK' });
      expect(printMethodText([black, red])).toEqual({
        th: 'สีพิเศษ 2 สี (ดำ, แดง)',
        en: '2 spot colours (ดำ, แดง)',
      });
      expect(printMethodText([cmyk, black])).toEqual({
        th: 'CMYK + สีพิเศษ 1 สี (ดำ)',
        en: 'CMYK + 1 spot colour (ดำ)',
      });
      expect(printMethodText([])).toBeNull();
      expect(printSideText('outside', [cmyk])).toEqual({
        th: 'พิมพ์ด้านนอก: CMYK',
        en: 'Print (outside): CMYK',
      });
      expect(printSideText('inside', [black])?.th).toBe('พิมพ์ด้านใน: สีพิเศษ 1 สี (ดำ)');
      expect(printSideText('inside', [])).toBeNull();
    });

    it('writes inner dimensions as ยาว × กว้าง × สูง มม. (ด้านใน), and RFQ blanks as —', () => {
      expect(sizeValue({ l: 140, w: 97.5, d: 60 }, 'internal')).toEqual({
        th: '140 × 97.5 × 60 มม. (ด้านใน)',
        en: '140 × 97.5 × 60 mm (inside)',
      });
      expect(sizeValue({ l: 148, w: 105 })).toEqual({ th: '148 × 105 มม.', en: '148 × 105 mm' });
      expect(sizeValue({ l: 300, w: 200, d: null }, null, { missing: '—' }).th).toBe('300 × 200 × — มม.');
    });

    it('labels both sides printed', () => {
      const lines = box(
        side('print_front', 'พิมพ์ด้านนอก', 'Print (outside)', [cmyk]),
        side('print_back', 'พิมพ์ด้านใน', 'Print (inside)', [black]),
      );
      expect(specLabel(lines, 'corrugate')).toEqual({
        th: '140 × 97.5 × 60 มม. (ด้านใน) · พิมพ์ด้านนอก: CMYK · พิมพ์ด้านใน: สีพิเศษ 1 สี (ดำ)',
        en: '140 × 97.5 × 60 mm (inside) · Print (outside): CMYK · Print (inside): 1 spot colour (ดำ)',
      });
    });

    it('labels the outside only, the inside only, and an unprinted spec', () => {
      expect(specLabel(box(side('print_front', 'พิมพ์ด้านนอก', 'x', [cmyk, black])), 'corrugate').th).toBe(
        '140 × 97.5 × 60 มม. (ด้านใน) · พิมพ์ด้านนอก: CMYK + สีพิเศษ 1 สี (ดำ)',
      );
      expect(specLabel(box(side('print_back', 'พิมพ์ด้านใน', 'x', [black, red])), 'corrugate').th).toBe(
        '140 × 97.5 × 60 มม. (ด้านใน) · พิมพ์ด้านใน: สีพิเศษ 2 สี (ดำ, แดง)',
      );
      expect(specLabel(box(), 'corrugate')).toEqual({
        th: '140 × 97.5 × 60 มม. (ด้านใน) · ไม่พิมพ์',
        en: '140 × 97.5 × 60 mm (inside) · Unprinted',
      });
    });

    it('writes a document spec as label value, a print line as "พิมพ์ด้านนอก: …"', () => {
      const lines = box(side('print_front', 'พิมพ์ด้านนอก', 'Print (outside)', [cmyk]));
      expect(specLinesText(lines)).toBe('ขนาด 140 × 97.5 × 60 มม. (ด้านใน) · พิมพ์ด้านนอก: CMYK');
      expect(specLinesText(lines, 'en')).toBe('Size 140 × 97.5 × 60 mm (inside) · Print (outside): CMYK');
    });
  });
});
