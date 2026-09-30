import { StoreSizeRulesDto } from '@modules/catalog/store/store-configurator.dto';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

import { DESIGN_IDS, DesignProductRefDto } from './designs.dto';

/** What the online designer needs for one catalogue product (U-B0.1, D-070, D-152): catalogue data, no prices. */

const ID = (n: string) => `0192f3a0-7c1e-7d2a-9b1f-0000000e6${n}`;

export class DesignerCatalogQuery {
  @ApiProperty({ example: 'tuck-end-box', description: 'Slug of the catalogue product' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  product!: string;
}

export class DesignerPatternDto {
  @ApiProperty({ format: 'uuid', example: DESIGN_IDS.pattern })
  id!: string;

  @ApiProperty({ example: 'RTE-01' })
  code!: string;

  @ApiProperty({ example: 'ฝาเสียบกลับด้าน' })
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: 'rte', description: 'Key understood by the dieline engine' })
  dielineKey!: string | null;

  @ApiProperty({ type: [String], example: [], description: 'Corrugate: the flutes this box style is made in' })
  fluteTypeIds!: string[];

  @ApiProperty({ type: StoreSizeRulesDto })
  rules!: StoreSizeRulesDto;
}

export class DesignerFluteDto {
  @ApiProperty({ format: 'uuid', example: ID('001') })
  id!: string;

  @ApiProperty({ example: 'BC' })
  code!: string;

  @ApiProperty({ example: 'ลอน BC' })
  name!: string;

  @ApiProperty({ type: 'integer', example: 5 })
  layers!: number;

  @ApiProperty({ type: Number, nullable: true, example: 6, description: 'Board allowance A, mm' })
  allowanceAMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 3, description: 'Board allowance C, mm' })
  allowanceCMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 12, description: 'Board allowance DD, mm' })
  allowanceDdMm!: number | null;
}

export class DesignerMaterialDto {
  @ApiProperty({ format: 'uuid', example: DESIGN_IDS.material })
  id!: string;

  @ApiProperty({ example: 'art-card-350' })
  code!: string;

  @ApiProperty({ example: 'อาร์ตการ์ด 350 แกรม' })
  nameTh!: string;

  @ApiProperty({ example: 'Art card 350 gsm' })
  nameEn!: string;

  @ApiProperty({ example: 'paper' })
  kind!: string;

  @ApiProperty({ type: Number, nullable: true, example: 400, description: 'Caliper, micron' })
  micron!: number | null;

  @ApiProperty({ type: DesignerFluteDto, nullable: true, description: 'Corrugated board: its flute' })
  flute!: DesignerFluteDto | null;
}

export class DesignerTemplateDto {
  @ApiProperty({ format: 'uuid', example: DESIGN_IDS.template })
  id!: string;

  @ApiProperty({ format: 'uuid', example: ID('002') })
  semiDesignId!: string;

  @ApiProperty({ example: 'มินิมอล ขาว-ดำ' })
  name!: string;

  @ApiProperty({ example: 'S' })
  sizeCode!: string;

  @ApiProperty({ example: 100, description: 'mm' })
  lengthMm!: number;

  @ApiProperty({ example: 100, description: 'mm' })
  widthMm!: number;

  @ApiProperty({ example: 50, description: 'mm' })
  heightMm!: number;

  @ApiProperty({ type: String, nullable: true, example: `/v1/store/catalog/images/${ID('003')}` })
  thumbnailUrl!: string | null;

  @ApiProperty({ type: [String], example: ['#000000', '#FFFFFF'], description: 'Palette of the semi-design' })
  colours!: string[];

  @ApiProperty({ type: [String], example: [ID('004')], description: 'Fonts the template uses' })
  fontIds!: string[];

  @ApiProperty({ example: true, description: 'A designer document is set: a design can start from it' })
  hasDesign!: boolean;
}

export class DesignerTemplateDetailDto extends DesignerTemplateDto {
  @ApiProperty({ type: DesignProductRefDto })
  product!: DesignProductRefDto;

  @ApiProperty({ type: 'integer', nullable: true, example: 1 })
  schemaVersion!: number | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: { pages: [{ side: 'front', objects: [] }] },
    description: 'The designer document (null until staff set one)',
  })
  document!: Record<string, unknown> | null;
}

export class DesignerFontDto {
  @ApiProperty({ format: 'uuid', example: ID('004') })
  id!: string;

  @ApiProperty({ example: 'Sarabun' })
  name!: string;

  @ApiProperty({ example: `/v1/store/designer/fonts/${ID('004')}`, description: 'The font file (public, cacheable)' })
  url!: string;
}

export class DesignerRulesDto {
  @ApiProperty({ example: '3', description: 'Bleed each side, mm (D-070)' })
  bleedMm!: string;

  @ApiProperty({ example: '3', description: 'Keep text this far inside the cut line, mm' })
  safeZoneMm!: string;

  @ApiProperty({ type: 'integer', example: 300, description: 'Lowest effective resolution before a warning' })
  minEffectivePpi!: number;

  @ApiProperty({ example: 'cmyk', description: 'Colour mode print files are checked against (D-070)' })
  colourMode!: string;

  @ApiProperty({ example: 'design_asset', description: 'File purpose to presign asset uploads with' })
  assetPurpose!: string;

  @ApiProperty({ type: [String], example: ['image/png', 'image/svg+xml', 'font/woff2'] })
  assetAccept!: string[];

  @ApiProperty({ type: 'integer', example: 52428800 })
  assetMaxBytes!: number;
}

export class DesignerCatalogDto {
  @ApiProperty({ type: DesignProductRefDto })
  product!: DesignProductRefDto;

  @ApiProperty({ type: [DesignerPatternDto] })
  patterns!: DesignerPatternDto[];

  @ApiProperty({ type: [DesignerMaterialDto] })
  materials!: DesignerMaterialDto[];

  @ApiProperty({ type: [DesignerTemplateDto], description: 'Active semi-design templates of the product' })
  templates!: DesignerTemplateDto[];

  @ApiProperty({ type: [DesignerFontDto], description: 'Fonts offered in the designer' })
  fonts!: DesignerFontDto[];

  @ApiProperty({ type: DesignerRulesDto })
  rules!: DesignerRulesDto;
}

export const DESIGNER_TEMPLATE_EXAMPLE: DesignerTemplateDto = {
  id: DESIGN_IDS.template,
  semiDesignId: ID('002'),
  name: 'มินิมอล ขาว-ดำ',
  sizeCode: 'S',
  lengthMm: 100,
  widthMm: 100,
  heightMm: 50,
  thumbnailUrl: `/v1/store/catalog/images/${ID('003')}`,
  colours: ['#000000', '#FFFFFF'],
  fontIds: [ID('004')],
  hasDesign: true,
};

const PRODUCT = {
  id: DESIGN_IDS.product,
  slug: 'tuck-end-box',
  nameTh: 'กล่องฝาเสียบ',
  nameEn: 'Tuck-end box',
  productTypeCode: 'folding_box',
};

export const DESIGNER_CATALOG_EXAMPLE: DesignerCatalogDto = {
  product: PRODUCT,
  patterns: [
    {
      id: DESIGN_IDS.pattern,
      code: 'RTE-01',
      name: 'ฝาเสียบกลับด้าน',
      dielineKey: 'rte',
      fluteTypeIds: [],
      rules: {
        minWMm: 30,
        maxWMm: 500,
        minLMm: 30,
        maxLMm: 500,
        minHMm: 10,
        maxHMm: 500,
        lengthMustExceedWidth: false,
        lengthMustExceedHeight: false,
        widthMustExceedHeight: false,
      },
    },
  ],
  materials: [
    {
      id: DESIGN_IDS.material,
      code: 'art-card-350',
      nameTh: 'อาร์ตการ์ด 350 แกรม',
      nameEn: 'Art card 350 gsm',
      kind: 'paper',
      micron: 400,
      flute: null,
    },
  ],
  templates: [DESIGNER_TEMPLATE_EXAMPLE],
  fonts: [{ id: ID('004'), name: 'Sarabun', url: `/v1/store/designer/fonts/${ID('004')}` }],
  rules: {
    bleedMm: '3',
    safeZoneMm: '3',
    minEffectivePpi: 300,
    colourMode: 'cmyk',
    assetPurpose: 'design_asset',
    assetAccept: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'font/ttf', 'font/otf', 'font/woff', 'font/woff2'],
    assetMaxBytes: 52428800,
  },
};

export const DESIGNER_TEMPLATE_DETAIL_EXAMPLE: DesignerTemplateDetailDto = {
  ...DESIGNER_TEMPLATE_EXAMPLE,
  product: PRODUCT,
  schemaVersion: 1,
  document: { pages: [{ side: 'front', objects: [] }] },
};
