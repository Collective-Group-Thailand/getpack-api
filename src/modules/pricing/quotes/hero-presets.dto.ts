import { BusinessDayRangeDto } from '@modules/pricing/hints/price-hints.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNumber, Max, Min } from 'class-validator';

import { HERO_MATERIALS, HERO_PRINTS, HERO_SHAPES } from './hero-preview.adapter';

export class HeroShapeDto {
  @ApiProperty({ enum: HERO_SHAPES, enumName: 'HeroShape', example: 'mailer' })
  id!: string;

  @ApiProperty({ example: 'กล่องไปรษณีย์', description: 'The product’s box style name' })
  labelTh!: string;

  @ApiProperty({ example: 'mailer-box', description: 'The catalogue product `/configure` opens' })
  productSlug!: string;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000a0001' })
  catalogProductId!: string;

  @ApiProperty({ example: 'corrugated' })
  productTypeCode!: string;

  @ApiProperty({ example: 'corrugate', description: 'The calculator that prices it (folding or corrugate)' })
  calculator!: string;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000a0002' })
  patternId!: string;

  @ApiProperty({ type: String, nullable: true, example: 'FEFCO-0427' })
  dielineKey!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'PK-CF-01',
    description: 'The style-library code of the shape (the preset’s, else the pattern’s)',
  })
  styleCode!: string | null;

  @ApiProperty({
    type: [Number],
    example: [300, 500, 1000, 2000],
    description: 'Quantities this shape offers (the product’s own minimum and maximum applied)',
  })
  qtys!: number[];
}

export class HeroSizeDto {
  @ApiProperty({
    example: 'mailer:s0',
    description: '`<shape>:s<index of the preset size>`, returned as `presetId`',
  })
  id!: string;

  @ApiProperty({ enum: HERO_SHAPES, enumName: 'HeroShape', example: 'mailer' })
  shapeId!: string;

  @ApiProperty({
    example: 's0',
    description:
      'The preset size’s index, as `s<index>` (in `standardSizeCodes` when the shape names them, D-459)',
  })
  code!: string;

  @ApiProperty({
    example: '18×12×5 ซม.',
    description:
      'Inside W × D × H in centimetres; for a shape offering its product’s standard sizes, the catalogue’s own size ' +
      'name, e.g. "เบอร์ A (20×14×6 ซม.)" (D-459)',
  })
  labelTh!: string;

  @ApiProperty({ example: 200, description: 'Inside length (mm, D-182)' })
  lengthMm!: number;

  @ApiProperty({ example: 150, description: 'Inside width (mm)' })
  widthMm!: number;

  @ApiProperty({ example: 80, description: 'Inside height (mm)' })
  heightMm!: number;
}

export class HeroMaterialOptionDto {
  @ApiProperty({ enum: HERO_SHAPES, enumName: 'HeroShape', example: 'mailer' })
  shapeId!: string;

  @ApiProperty({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000a0003',
    description: 'Material option id',
  })
  materialId!: string;
}

export class HeroMaterialDto {
  @ApiProperty({ enum: HERO_MATERIALS, enumName: 'HeroMaterial', example: 'kraft350' })
  id!: string;

  @ApiProperty({ example: 'กระดาษคราฟท์ 350 แกรม', description: 'The catalogue material’s name' })
  labelTh!: string;

  @ApiProperty({ example: 'Kraft 350 gsm' })
  labelEn!: string;

  @ApiProperty({
    type: [HeroMaterialOptionDto],
    description: 'What the board is on each shape that offers it',
  })
  options!: HeroMaterialOptionDto[];
}

export class HeroPrintOptionDto {
  @ApiProperty({ enum: HERO_SHAPES, enumName: 'HeroShape', example: 'mailer' })
  shapeId!: string;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    example: ['0192f3a0-7c1e-7d2a-9b1f-0000000a0004'],
    description: 'Front ink option ids; empty for no print',
  })
  inkIds!: string[];
}

export class HeroPrintDto {
  @ApiProperty({ enum: HERO_PRINTS, enumName: 'HeroPrint', example: 'one' })
  id!: string;

  @ApiProperty({ example: 'พิมพ์ 1 สี' })
  labelTh!: string;

  @ApiProperty({ example: 'One colour' })
  labelEn!: string;

  @ApiProperty({ type: [HeroPrintOptionDto] })
  options!: HeroPrintOptionDto[];
}

/** The selection the hero opens on — one the presets offer. */
export class HeroDefaultDto {
  @ApiProperty({ enum: HERO_SHAPES, enumName: 'HeroShape', example: 'mailer' })
  shape!: string;

  @ApiProperty({ example: 'mailer:s0' })
  sizeId!: string;

  @ApiProperty({ example: 180, description: 'Inside length (mm)' })
  lengthMm!: number;

  @ApiProperty({ example: 120, description: 'Inside width (mm)' })
  widthMm!: number;

  @ApiProperty({ example: 50, description: 'Inside height (mm)' })
  heightMm!: number;

  @ApiProperty({ enum: HERO_MATERIALS, enumName: 'HeroMaterial', example: 'corrE' })
  material!: string;

  @ApiProperty({ enum: HERO_PRINTS, enumName: 'HeroPrint', example: 'one' })
  print!: string;

  @ApiProperty({ type: 'integer', example: 500 })
  qty!: number;
}

/**
 * D-310: everything the hero offers per shape, each with what it means in the catalogue — only what the catalogue
 * can price; empty when nothing maps.
 */
export class HeroPresetsDto {
  @ApiProperty({ type: [HeroShapeDto] })
  shapes!: HeroShapeDto[];

  @ApiProperty({ type: [HeroSizeDto] })
  sizes!: HeroSizeDto[];

  @ApiProperty({ type: [HeroMaterialDto] })
  materials!: HeroMaterialDto[];

  @ApiProperty({ type: [HeroPrintDto] })
  prints!: HeroPrintDto[];

  @ApiProperty({
    type: [Number],
    example: [300, 500, 1000, 2000],
    description: 'Every quantity some shape offers',
  })
  qtys!: number[];

  @ApiProperty({
    type: HeroDefaultDto,
    nullable: true,
    description:
      'The selection to open on — the product owner’s default (`catalog.hero_presets.default`) when the catalogue ' +
      'offers it; null otherwise (open on the first offered options)',
  })
  default!: HeroDefaultDto | null;
}

export class HeroPreviewRequestDto {
  @ApiProperty({ enum: HERO_SHAPES, enumName: 'HeroShape', example: 'mailer' })
  @IsIn(HERO_SHAPES)
  shape!: (typeof HERO_SHAPES)[number];

  @ApiProperty({ example: 200, minimum: 1, maximum: 2000, description: 'Inside length (mm, D-182)' })
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(1)
  @Max(2000)
  lengthMm!: number;

  @ApiProperty({ example: 150, minimum: 1, maximum: 2000, description: 'Inside width (mm)' })
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(1)
  @Max(2000)
  widthMm!: number;

  @ApiProperty({ example: 80, minimum: 1, maximum: 2000, description: 'Inside height (mm)' })
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(1)
  @Max(2000)
  heightMm!: number;

  @ApiProperty({ enum: HERO_MATERIALS, enumName: 'HeroMaterial', example: 'kraft350' })
  @IsIn(HERO_MATERIALS)
  material!: (typeof HERO_MATERIALS)[number];

  @ApiProperty({ enum: HERO_PRINTS, enumName: 'HeroPrint', example: 'one' })
  @IsIn(HERO_PRINTS)
  print!: (typeof HERO_PRINTS)[number];

  @ApiProperty({
    type: 'integer',
    example: 1000,
    description: 'One of `qtys` of `store.catalog.getHeroPresets`',
  })
  @IsInt()
  @Min(1)
  qty!: number;
}

export class HeroPreviewDto {
  @ApiProperty({ example: '13.38', description: 'Price per piece incl. VAT (decimal string)' })
  unitPrice!: string;

  @ApiProperty({
    example: '13380.00',
    description:
      'Total incl. VAT — the calculation’s `grossAmount` (no shipping without a postcode; decimal string)',
  })
  total!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ example: true, description: 'Prices include VAT' })
  vatIncluded!: boolean;

  @ApiProperty({ type: BusinessDayRangeDto, description: 'Production lead time (business days)' })
  leadTimeBusinessDays!: BusinessDayRangeDto;

  @ApiProperty({
    format: 'date-time',
    example: '2026-10-22T10:15:00+07:00',
    description:
      'Until when a quotation saved now keeps this price (`quotes.validity_days`, D-051); the preview itself ' +
      'locks nothing',
  })
  priceLockUntil!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'mailer:s0',
    description: 'The preset size the dimensions match; null for a size of the customer’s own',
  })
  presetId!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'The `store.quotes.calculate` body this preview priced — `/configure` sends the same for the same choices',
    example: { productTypeCode: 'corrugated', configuration: { patternId: '…', l: 200, w: 150, d: 80 } },
  })
  calculation!: Record<string, unknown>;
}

export const HERO_PREVIEW_EXAMPLE: HeroPreviewDto = {
  unitPrice: '13.38',
  total: '13380.00',
  currency: 'THB',
  vatIncluded: true,
  leadTimeBusinessDays: { min: 7, max: 7 },
  priceLockUntil: '2026-10-22T10:15:00+07:00',
  presetId: 'mailer:s0',
  calculation: {
    productTypeCode: 'corrugated',
    configuration: {
      patternId: '0192f3a0-7c1e-7d2a-9b1f-0000000a0002',
      l: 200,
      w: 150,
      d: 80,
      quantities: [1000],
    },
  },
};

export const HERO_PRESETS_EXAMPLE: HeroPresetsDto = {
  shapes: [
    {
      id: 'mailer',
      labelTh: 'ไปรษณีย์',
      productSlug: 'mailer-box',
      catalogProductId: '0192f3a0-7c1e-7d2a-9b1f-0000000a0001',
      productTypeCode: 'corrugated',
      calculator: 'corrugate',
      patternId: '0192f3a0-7c1e-7d2a-9b1f-0000000a0002',
      dielineKey: 'FEFCO-0427',
      styleCode: 'PK-CF-01',
      qtys: [300, 500, 1000, 2000],
    },
  ],
  sizes: [
    {
      id: 'mailer:s0',
      shapeId: 'mailer',
      code: 's0',
      labelTh: '18×12×5 ซม.',
      lengthMm: 180,
      widthMm: 120,
      heightMm: 50,
    },
  ],
  materials: [
    {
      id: 'corrE',
      labelTh: 'ลูกฟูก E',
      labelEn: 'E-flute kraft',
      options: [{ shapeId: 'mailer', materialId: '0192f3a0-7c1e-7d2a-9b1f-0000000a0003' }],
    },
  ],
  prints: [
    {
      id: 'one',
      labelTh: '1 สี',
      labelEn: 'One colour',
      options: [{ shapeId: 'mailer', inkIds: ['0192f3a0-7c1e-7d2a-9b1f-0000000a0004'] }],
    },
  ],
  qtys: [300, 500, 1000, 2000],
  default: {
    shape: 'mailer',
    sizeId: 'mailer:s0',
    lengthMm: 180,
    widthMm: 120,
    heightMm: 50,
    material: 'corrE',
    print: 'one',
    qty: 500,
  },
};
