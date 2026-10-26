import { PRODUCT_UNITS } from '@modules/catalog/stock/stock.dto';
import { ApiProperty } from '@nestjs/swagger';

/** One human-readable line of a specification ("Material: Art card 350 g"), in both languages. */
export class SpecLineDto {
  @ApiProperty({
    example: 'material',
    description:
      'Stable key of the line (`style`, `size` — ยาว × กว้าง × สูง in mm (D-441), `material`, `print_front`, `print_back` — the method of the side: CMYK, สีพิเศษ n สี (…), CMYK + สีพิเศษ n สี (…) (B-API-3), `coating_front`, `coating_back`, `special_finish`, `diecut`, `assembly`, `design_service`; `parts[n].…` for a part of a multi-part product; an RFQ spec field name for RFQ quotes)',
  })
  key!: string;

  @ApiProperty({ example: 'วัสดุ' })
  labelTh!: string;

  @ApiProperty({ example: 'Material' })
  labelEn!: string;

  @ApiProperty({ example: 'อาร์ตการ์ด 350 แกรม' })
  valueTh!: string;

  @ApiProperty({ example: 'Art card 350 gsm' })
  valueEn!: string;
}

/** A Thai / English pair of words (shared by the Studio and the one spec label of D-441). */
export class LocalisedLabelDto {
  @ApiProperty({ example: 'ภาพจำลองเพื่อดูตัวอย่าง ไม่ใช่แบบตัวอย่างสำหรับอนุมัติพิมพ์' })
  th!: string;

  @ApiProperty({ example: 'Preview, not a contract proof' })
  en!: string;
}

/**
 * One string per spec (GLOBAL-RULES §5, D-441, B-API-3): the values of the spec lines joined by " · " — size as
 * ยาว × กว้าง × สูง in mm ("(ด้านใน)" for inner dimensions), each printed side as "พิมพ์ด้านนอก: …" / "พิมพ์ด้านใน: …"
 * (CMYK, สีพิเศษ n สี, CMYK + สีพิเศษ n สี; a side not printed is left out), "ไม่พิมพ์" when nothing prints. Every surface shows it next to a price.
 */
export const SpecLabelDto = LocalisedLabelDto;
export type SpecLabelDto = LocalisedLabelDto;

export const SPEC_LINES_EXAMPLE: SpecLineDto[] = [
  { key: 'style', labelTh: 'แบบกล่อง', labelEn: 'Style', valueTh: 'กล่องฝาชน', valueEn: 'RSC' },
  {
    key: 'size',
    labelTh: 'ขนาด (ยาว × กว้าง × สูง)',
    labelEn: 'Size (L × W × H)',
    valueTh: '140 × 97.5 × 60 มม. (ด้านใน)',
    valueEn: '140 × 97.5 × 60 mm (inside)',
  },
  {
    key: 'material',
    labelTh: 'วัสดุ',
    labelEn: 'Material',
    valueTh: 'ลูกฟูก KA125 ลอน B (3 ชั้น)',
    valueEn: 'KA125 B-flute (3-ply)',
  },
  {
    key: 'print_front',
    labelTh: 'พิมพ์ด้านนอก',
    labelEn: 'Print (outside)',
    valueTh: 'สีพิเศษ 1 สี (ดำ)',
    valueEn: '1 spot colour (ดำ)',
  },
];

export const SPEC_LABEL_EXAMPLE: SpecLabelDto = {
  th: 'กล่องฝาชน · 140 × 97.5 × 60 มม. (ด้านใน) · ลูกฟูก KA125 ลอน B (3 ชั้น) · พิมพ์ด้านนอก: สีพิเศษ 1 สี (ดำ)',
  en: 'RSC · 140 × 97.5 × 60 mm (inside) · KA125 B-flute (3-ply) · Print (outside): 1 spot colour (ดำ)',
};

export class LineProductDto {
  @ApiProperty({ example: 'tuck-end-box' })
  slug!: string;

  @ApiProperty({ example: 'กล่องฝาเสียบ' })
  nameTh!: string;

  @ApiProperty({ example: 'Tuck-end box' })
  nameEn!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '/v1/store/catalog/images/0192f3a0-7c1e-7d2a-9b1f-00000000c009',
  })
  imageUrl!: string | null;
}

/**
 * What a quoted, carted or ordered line is, ready to display: the catalogue product, the product type, the
 * sales unit and the spec lines resolved when the quote was made (catalogue names frozen like the price).
 */
export class LineSummaryDto {
  @ApiProperty({
    type: LineProductDto,
    nullable: true,
    description: 'Null for an RFQ quote or a type-level quote',
  })
  product!: LineProductDto | null;

  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({ example: 'กล่องกระดาษแข็ง' })
  productTypeNameTh!: string;

  @ApiProperty({ example: 'Folding carton' })
  productTypeNameEn!: string;

  @ApiProperty({ enum: PRODUCT_UNITS, enumName: 'ProductUnit', example: 'piece', description: 'Sales unit' })
  unit!: (typeof PRODUCT_UNITS)[number];

  @ApiProperty({
    type: [SpecLineDto],
    description: 'Empty for quotes made before spec lines were recorded',
  })
  specs!: SpecLineDto[];
}

export const LINE_SUMMARY_EXAMPLE: LineSummaryDto = {
  product: {
    slug: 'tuck-end-box',
    nameTh: 'กล่องฝาเสียบ',
    nameEn: 'Tuck-end box',
    imageUrl: '/v1/store/catalog/images/0192f3a0-7c1e-7d2a-9b1f-00000000c009',
  },
  productTypeCode: 'folding_carton',
  productTypeNameTh: 'กล่องกระดาษแข็ง',
  productTypeNameEn: 'Folding carton',
  unit: 'piece',
  specs: [
    { key: 'style', labelTh: 'แบบกล่อง', labelEn: 'Style', valueTh: 'ฝาเสียบ', valueEn: 'ฝาเสียบ' },
    {
      key: 'size',
      labelTh: 'ขนาด (ยาว × กว้าง × สูง)',
      labelEn: 'Size (L × W × H)',
      valueTh: '60 × 60 × 150 มม.',
      valueEn: '60 × 60 × 150 mm',
    },
    {
      key: 'material',
      labelTh: 'วัสดุ',
      labelEn: 'Material',
      valueTh: 'อาร์ตการ์ด 350 แกรม',
      valueEn: 'Art card 350 gsm',
    },
  ],
};
