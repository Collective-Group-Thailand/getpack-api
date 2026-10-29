import { UAT_PRODUCTS, UAT_SUB_PATTERN_RENAMES } from '../../prisma/seed/uat/uat-data';

/** C2b (D-454, DECISIONS-STAGE-A §15.2): the catalogue data bugs C2 found stay fixed in the UAT seed. */
describe('UAT catalogue data (C2b)', () => {
  const sizes = UAT_PRODUCTS.flatMap((p) => (p.sizes ?? []).map((s) => ({ product: p, size: s })));

  it('writes 3-D standard-size names in the spec-label order L × W × H (cm)', () => {
    const triple = /(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?) ซม\./;
    let checked = 0;
    for (const { product, size } of sizes) {
      const [code, name, l, w, h] = size;
      const m = triple.exec(name);
      if (!m) continue;
      checked++;
      expect([product.slug, code, Number(m[1]) * 10, Number(m[2]) * 10, Number(m[3]) * 10]).toEqual([
        product.slug,
        code,
        l,
        w,
        h,
      ]);
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('writes flat items’ names L × W (labels, hang tags, the A6 card, the food-tray sleeve); pouches keep W × H (C11)', () => {
    const pair = /(?<![\d.×])(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)(?![\d.]*×)/;
    let checked = 0;
    for (const { product, size } of sizes) {
      const [code, name, l, w, h] = size;
      const m = pair.exec(name);
      if (!m || h !== 0 || product.type === 'flexible_pouch') continue;
      checked++;
      expect([product.slug, code, Number(m[1]) * 10, Number(m[2]) * 10]).toEqual([product.slug, code, l, w]);
    }
    expect(checked).toBeGreaterThanOrEqual(15);
    const snack = UAT_PRODUCTS.find((p) => p.slug === 'uat-snack-3side-pouch')!;
    expect(snack.sizes?.[0]).toEqual(['10x15', '10×15 ซม.', 150, 100, 0]);
  });

  it('describes the postal box print options as its print model offers them (1 spot colour or CMYK)', () => {
    const postal = UAT_PRODUCTS.find((p) => p.slug === 'uat-postal-box-b')!;
    expect(postal.inks).toEqual(['uat-black', 'dev-cmyk']);
    expect(postal.descriptionTh).toContain('เลือกพิมพ์โลโก้ 1 สี หรือพิมพ์ 4 สี (CMYK) ได้');
    expect(postal.descriptionTh).not.toMatch(/\d\s*[–-]\s*\d\s*สี/);
  });

  it('has no "[DEV]" in customer-facing product, size or part names', () => {
    for (const p of UAT_PRODUCTS) {
      expect(`${p.nameTh} ${p.nameEn} ${p.descriptionTh ?? ''}`).not.toContain('[DEV]');
      for (const [, name] of p.sizes ?? []) expect(name).not.toContain('[DEV]');
    }
    expect(UAT_SUB_PATTERN_RENAMES['DEV-TELE']).toEqual({ 1: 'ตัวกล่อง', 2: 'ฝา' });
  });
});
