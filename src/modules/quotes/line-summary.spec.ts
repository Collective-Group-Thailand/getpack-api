import { lineSummary, rfqSpecLines } from './line-summary';

describe('line summary', () => {
  it('labels RFQ spec fields from the admin schema, in schema order, then the dimensions first', () => {
    const schema = {
      type: 'object',
      properties: {
        style: { type: 'string', title: 'รูปทรง', 'x-title-en': 'Shape' },
        handles: { type: 'boolean', title: 'หูหิ้ว' },
      },
    };
    const lines = rfqSpecLines(
      schema,
      { handles: true, style: 'ถุงกระดาษ', extra: ['a', 'b'] },
      { lengthMm: 300, widthMm: 200, heightMm: null },
    );
    expect(lines).toEqual([
      { key: 'size', labelTh: 'ขนาด (กว้าง × ยาว × ลึก)', labelEn: 'Size (W × L × D)', valueTh: '200 × 300 × — มม.', valueEn: '200 × 300 × — mm' },
      { key: 'style', labelTh: 'รูปทรง', labelEn: 'Shape', valueTh: 'ถุงกระดาษ', valueEn: 'ถุงกระดาษ' },
      { key: 'handles', labelTh: 'หูหิ้ว', labelEn: 'หูหิ้ว', valueTh: '✓', valueEn: '✓' },
      { key: 'extra', labelTh: 'extra', labelEn: 'extra', valueTh: 'a, b', valueEn: 'a, b' },
    ]);
  });

  it('builds the summary from the quote snapshot, empty specs for quotes made before it', () => {
    const base = {
      productType: { code: 'folding_carton', nameTh: 'กล่อง', nameEn: 'Box' },
      catalogProduct: {
        slug: 'tuck-end-box',
        nameTh: 'กล่องฝาเสียบ',
        nameEn: 'Tuck-end box',
        images: [{ fileObject: { publicId: 'f1' } }],
      },
    };
    const specs = [{ key: 'size', labelTh: 'ขนาด', labelEn: 'Size', valueTh: '1 มม.', valueEn: '1 mm' }];
    expect(lineSummary({ ...base, specSummary: specs }, 'piece')).toEqual({
      product: {
        slug: 'tuck-end-box',
        nameTh: 'กล่องฝาเสียบ',
        nameEn: 'Tuck-end box',
        imageUrl: '/v1/store/catalog/images/f1',
      },
      productTypeCode: 'folding_carton',
      productTypeNameTh: 'กล่อง',
      productTypeNameEn: 'Box',
      unit: 'piece',
      specs,
    });
    expect(lineSummary({ ...base, catalogProduct: null, specSummary: null }, 'box')).toMatchObject({
      product: null,
      unit: 'box',
      specs: [],
    });
  });
});
