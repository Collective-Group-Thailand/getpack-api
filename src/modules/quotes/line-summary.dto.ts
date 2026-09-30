import { PRODUCT_UNITS } from '@modules/catalog/stock/stock.dto';
import { ApiProperty } from '@nestjs/swagger';

/** One human-readable line of a specification ("Material: Art card 350 g"), in both languages. */
export class SpecLineDto {
  @ApiProperty({
    example: 'material',
    description:
      'Stable key of the line (`style`, `size`, `material`, `print_front`, `print_back`, `coating_front`, `coating_back`, `special_finish`, `diecut`, `assembly`, `design_service`; `parts[n].…` for a part of a multi-part product; an RFQ spec field name for RFQ quotes)',
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
  @ApiProperty({ type: LineProductDto, nullable: true, description: 'Null for an RFQ quote or a type-level quote' })
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
    { key: 'size', labelTh: 'ขนาด', labelEn: 'Size', valueTh: '60 × 60 × 150 มม.', valueEn: '60 × 60 × 150 mm' },
    {
      key: 'material',
      labelTh: 'วัสดุ',
      labelEn: 'Material',
      valueTh: 'อาร์ตการ์ด 350 แกรม',
      valueEn: 'Art card 350 gsm',
    },
  ],
};
