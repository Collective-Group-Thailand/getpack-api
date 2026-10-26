import { DESIGN_OPTIONS } from '@modules/carts/carts.dto';
import { POUCH_FORMULAS, type PouchFormula } from '@modules/pricing/calculators/pouch/geometry';
import {
  SPEC_LABEL_EXAMPLE,
  SPEC_LINES_EXAMPLE,
  SpecLabelDto,
  SpecLineDto,
} from '@modules/quotes/line-summary.dto';
import { ApiProperty } from '@nestjs/swagger';

import { STORE_PRINT_MODEL_EXAMPLE, StorePrintModelDto } from '../print-model/print-model.dto';
import { CALCULATOR_KEYS } from '../product-structure/product-structure.dto';
import { PRODUCT_UNITS } from '../stock/stock.dto';
import { StoreOptionGroupDto } from './store-catalog.dto';

/** The configurator read of a calculator-backed product (U-B6; triage `store.configurator`). */

const ID = (n: string) => `0192f3a0-7c1e-7d2a-9b1f-00000000e${n}`;

export class StoreSizeRulesDto {
  @ApiProperty({ type: Number, nullable: true, example: 100, description: 'Unit: mm.' })
  minWMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 800, description: 'Unit: mm.' })
  maxWMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 100, description: 'Unit: mm.' })
  minLMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 1000, description: 'Unit: mm.' })
  maxLMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 50, description: 'Unit: mm.' })
  minHMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 800, description: 'Unit: mm.' })
  maxHMm!: number | null;

  @ApiProperty({ example: false, description: 'The length must be at least the width' })
  lengthMustExceedWidth!: boolean;

  @ApiProperty({ example: false, description: 'The length must be at least the height' })
  lengthMustExceedHeight!: boolean;

  @ApiProperty({ example: true, description: 'Corrugate: the height at most 0.95 × the width' })
  widthMustExceedHeight!: boolean;
}

export const POUCH_SIZE_PARTS = ['b', 's', 'cs'] as const;

/** A pouch pattern's shape (U-B6 pouch): which gussets / centre seal it reads, and their limits. */
export class StorePouchShapeDto {
  @ApiProperty({ enum: POUCH_FORMULAS, enumName: 'PouchFormula', example: 'stand_up' })
  formula!: PouchFormula;

  @ApiProperty({
    enum: POUCH_SIZE_PARTS,
    enumName: 'PouchSizePart',
    isArray: true,
    example: ['b'],
    description: 'Required in the configuration: `b` bottom gusset, `s` side gusset, `cs` centre seal',
  })
  needs!: (typeof POUCH_SIZE_PARTS)[number][];

  @ApiProperty({ type: Number, nullable: true, example: 40, description: 'Unit: mm.' })
  minBMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 120, description: 'Unit: mm.' })
  maxBMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: null, description: 'Unit: mm.' })
  minSMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: null, description: 'Unit: mm.' })
  maxSMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: null, description: 'Unit: mm.' })
  minCsMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: null, description: 'Unit: mm.' })
  maxCsMm!: number | null;
}

export class StoreConfiguratorPartDto {
  @ApiProperty({ format: 'uuid', example: ID('003') })
  subPatternId!: string;

  @ApiProperty({ example: 1 })
  seq!: number;

  @ApiProperty({ example: 'ตัวกล่อง' })
  name!: string;
}

export class StoreConfiguratorPatternDto {
  @ApiProperty({ format: 'uuid', example: ID('002') })
  id!: string;

  @ApiProperty({ example: 'RSC-01' })
  code!: string;

  @ApiProperty({ example: 'กล่องฝาชน' })
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: 'rsc', description: 'Key for `@getpack/dieline`' })
  dielineKey!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'PK-RTE-01',
    description: 'Public style code (D-184), fixed once published',
  })
  styleCode!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'International name (RSC, FOL …), only once verified (D-211)',
  })
  internationalName!: string | null;

  @ApiProperty({
    type: [StoreConfiguratorPartDto],
    description:
      'The parts to configure (a Tele body and lid…); empty = one part, sent without `subPatternId`',
  })
  parts!: StoreConfiguratorPartDto[];

  @ApiProperty({
    type: [String],
    format: 'uuid',
    example: [ID('004')],
    description: 'Corrugate: the flutes offered (a board of another flute is refused); empty = any',
  })
  fluteTypeIds!: string[];

  @ApiProperty({ type: StoreSizeRulesDto })
  rules!: StoreSizeRulesDto;

  @ApiProperty({
    type: StorePouchShapeDto,
    nullable: true,
    description: 'Pouch patterns only: the shape and its gussets; null otherwise',
  })
  pouch!: StorePouchShapeDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Admin-maintained; null until set',
  })
  descriptionTh!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  descriptionEn!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  imageUrl!: string | null;

  @ApiProperty({
    type: [String],
    example: ['PK-RSC-01-A'],
    description:
      'Published variants of the style drawn for this pattern (D-271): with a standard size, the product page links ' +
      '"ดาวน์โหลดแบบกล่อง" to `store.dielines.download` (`variantCode` + the size). Empty = no dieline to download',
  })
  dielineVariantCodes!: string[];
}

export class StoreConfiguratorSizeDto {
  @ApiProperty({ format: 'uuid', example: ID('005') })
  id!: string;

  @ApiProperty({ example: 'M' })
  code!: string;

  @ApiProperty({ example: '30×40×25 ซม.' })
  name!: string;

  @ApiProperty({ example: 400, description: 'Unit: mm.' })
  lengthMm!: number;

  @ApiProperty({ example: 300, description: 'Unit: mm.' })
  widthMm!: number;

  @ApiProperty({ example: 250, description: 'Unit: mm.' })
  heightMm!: number;
}

/** A standard size of the store configurator, with the one it opens on (D-441). */
export class StoreConfiguratorStandardSizeDto extends StoreConfiguratorSizeDto {
  @ApiProperty({
    example: true,
    description:
      'The size the configurator opens on: the default spec’s (D-441); without a default spec the first size',
  })
  isDefault!: boolean;
}

/**
 * The default spec (D-441): the admin's reference configuration (D-220), which the configurator opens on and the
 * "starting from" price of cards, category pages, the product page and its JSON-LD is priced at, through the same
 * `store.quotes.calculate` path.
 */
export class StoreConfiguratorDefaultSpecDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: {
      catalogProductId: ID('001'),
      patternId: ID('002'),
      l: 400,
      w: 300,
      d: 250,
      materialId: ID('007'),
      difficultyLevelId: ID('006'),
      quantities: [300],
      parts: [{ printFront: [{ inkColourId: ID('008'), area: 'top' }] }],
      design: { graphic: false, structure: false },
    },
    description:
      'The calculator configuration, ready for `store.quotes.calculate` (send it as is, or with the customer’s quantities)',
  })
  configuration!: Record<string, unknown>;

  @ApiProperty({
    type: 'integer',
    example: 300,
    description: 'The reference quantity the starting price is for',
  })
  quantity!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'M',
    description: 'The standard size it is; null for a custom size',
  })
  standardSizeCode!: string | null;

  @ApiProperty({ type: [SpecLineDto], example: SPEC_LINES_EXAMPLE })
  specs!: SpecLineDto[];

  @ApiProperty({ type: SpecLabelDto, example: SPEC_LABEL_EXAMPLE, description: 'One string (D-441)' })
  specLabel!: SpecLabelDto;
}

/**
 * Quantity entry of the configurator: limits and presets are catalogue data kept by admins (null / empty until
 * set, never invented); `maxTiers` is how many quantities one calculation prices.
 */
export class StoreConfiguratorQuantityDto {
  @ApiProperty({ type: 'integer', nullable: true, example: 100 })
  min!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 50000 })
  max!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 1000 })
  default!: number | null;

  @ApiProperty({ type: [Number], example: [500, 1000, 3000], description: 'Suggested quantities, ascending' })
  presets!: number[];

  @ApiProperty({ type: 'integer', example: 10, description: 'Quantities one calculation prices' })
  maxTiers!: number;
}

/**
 * How the customer provides the artwork (chosen on the cart item). `hired_design` is priced by quoting with
 * `design.graphic` (D-071); `free_design` only comes from a real promotion (D-181), so it is never offered here.
 */
export class StoreConfiguratorDesignDto {
  @ApiProperty({
    enum: DESIGN_OPTIONS,
    enumName: 'DesignOption',
    isArray: true,
    example: ['own_file', 'online_designer', 'hired_design'],
  })
  options!: (typeof DESIGN_OPTIONS)[number][];

  @ApiProperty({ enum: DESIGN_OPTIONS, enumName: 'DesignOption', example: 'own_file' })
  default!: (typeof DESIGN_OPTIONS)[number];
}

export class StoreConfiguratorDto {
  @ApiProperty({ example: 'rsc-carton' })
  slug!: string;

  @ApiProperty({ format: 'uuid', example: ID('001'), description: 'The configuration’s `catalogProductId`' })
  catalogProductId!: string;

  @ApiProperty({ example: 'corrugated' })
  productTypeCode!: string;

  @ApiProperty({ enum: CALCULATOR_KEYS, enumName: 'CalculatorKey', example: 'corrugate' })
  calculator!: (typeof CALCULATOR_KEYS)[number];

  @ApiProperty({
    example: true,
    description:
      'Priced online now: the type is instant (D-043, D-100) and the product has a difficulty level; else the ' +
      'configurator routes to RFQ',
  })
  instant!: boolean;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: ID('006'),
    description: 'The configuration’s `difficultyLevelId` (the product’s, not the customer’s choice)',
  })
  difficultyLevelId!: string | null;

  @ApiProperty({ type: [StoreConfiguratorPatternDto] })
  patterns!: StoreConfiguratorPatternDto[];

  @ApiProperty({
    type: [StoreConfiguratorStandardSizeDto],
    description: 'Standard sizes (corrugate: no die block on them)',
  })
  standardSizes!: StoreConfiguratorStandardSizeDto[];

  @ApiProperty({
    type: [StoreOptionGroupDto],
    description:
      'The options offered, with the ids the configuration takes; with a default spec `isDefault` marks exactly ' +
      'the options it selects (a group it selects nothing in, e.g. no print, has no default) (D-441)',
  })
  optionGroups!: StoreOptionGroupDto[];

  @ApiProperty({
    enum: ['top', 'side', 'top_side', 'all_round'],
    enumName: 'CorrugatePrintArea',
    isArray: true,
    example: ['top', 'side', 'top_side', 'all_round'],
    description: 'Corrugate: where a colour can print; empty for the other calculators',
  })
  printAreas!: string[];

  @ApiProperty({
    type: StorePrintModelDto,
    nullable: true,
    description:
      'Corrugate, D-443: the per-side print model (outside → `printFront`, inside → `printBack` of each part) — ' +
      'method radios (`none` ไม่พิมพ์ · `spot` สีพิเศษ · `cmyk` พิมพ์ 4 สี), the spot-colour counter 1..N with the ' +
      'allowed colours, the "+ สีพิเศษ" counter beside CMYK when enabled, and each side’s default (inside: `none` ' +
      'unless the default spec prints inside). Back-office data; null until an admin sets it (then send at most one ' +
      'ink kind per side: no CMYK together with a spot colour)',
  })
  printModel!: StorePrintModelDto | null;

  @ApiProperty({ example: 15, description: 'Days a saved price holds (D-051)' })
  quoteValidityDays!: number;

  @ApiProperty({
    enum: PRODUCT_UNITS,
    enumName: 'ProductUnit',
    example: 'piece',
    description: 'Sales unit of a quantity',
  })
  unit!: (typeof PRODUCT_UNITS)[number];

  @ApiProperty({ type: StoreConfiguratorQuantityDto })
  quantity!: StoreConfiguratorQuantityDto;

  @ApiProperty({ type: StoreConfiguratorDesignDto })
  design!: StoreConfiguratorDesignDto;

  @ApiProperty({
    type: StoreConfiguratorDefaultSpecDto,
    nullable: true,
    description:
      'The spec to open on and the one the "starting from" price is for (D-441); null without a reference ' +
      'configuration (then there is no starting price either, D-220)',
  })
  defaultSpec!: StoreConfiguratorDefaultSpecDto | null;
}

export const CONFIGURATOR_EXAMPLE: StoreConfiguratorDto = {
  slug: 'rsc-carton',
  catalogProductId: ID('001'),
  productTypeCode: 'corrugated',
  calculator: 'corrugate',
  instant: true,
  difficultyLevelId: ID('006'),
  patterns: [
    {
      id: ID('002'),
      code: 'RSC-01',
      styleCode: 'PK-RSC-01',
      internationalName: null,
      name: 'กล่องฝาชน',
      dielineKey: 'rsc',
      parts: [],
      fluteTypeIds: [ID('004')],
      rules: {
        minWMm: 100,
        maxWMm: 800,
        minLMm: 100,
        maxLMm: 1000,
        minHMm: 50,
        maxHMm: 800,
        lengthMustExceedWidth: false,
        lengthMustExceedHeight: false,
        widthMustExceedHeight: true,
      },
      pouch: null,
      descriptionTh: 'กล่องลูกฟูกทรงมาตรฐาน ฝาบนล่างชนกัน',
      descriptionEn: 'Regular slotted carton, flaps meet in the middle',
      imageUrl: null,
      dielineVariantCodes: [],
    },
  ],
  standardSizes: [
    {
      id: ID('005'),
      code: 'M',
      name: '30×40×25 ซม.',
      lengthMm: 400,
      widthMm: 300,
      heightMm: 250,
      isDefault: true,
    },
  ],
  optionGroups: [
    {
      kind: 'material',
      options: [
        {
          id: ID('007'),
          code: 'ka125-b',
          nameTh: 'กระดาษลัง KA125 ลอน B',
          nameEn: 'Kraft board KA125 B-flute',
          isDefault: true,
          descriptionTh: null,
          descriptionEn: null,
          imageUrl: null,
          swatchHex: null,
          attributes: { kind: 'corrugated_board', gsm: 450, flute: 'B', coatable: false },
        },
      ],
    },
  ],
  printAreas: ['top', 'side', 'top_side', 'all_round'],
  printModel: STORE_PRINT_MODEL_EXAMPLE,
  quoteValidityDays: 15,
  unit: 'piece',
  quantity: { min: 100, max: 50000, default: 300, presets: [100, 300, 500, 1000], maxTiers: 10 },
  design: { options: ['own_file', 'online_designer', 'hired_design'], default: 'own_file' },
  defaultSpec: {
    configuration: {
      catalogProductId: ID('001'),
      patternId: ID('002'),
      l: 400,
      w: 300,
      d: 250,
      materialId: ID('007'),
      difficultyLevelId: ID('006'),
      quantities: [300],
      parts: [{}],
      design: { graphic: false, structure: false },
    },
    quantity: 300,
    standardSizeCode: 'M',
    specs: [
      { key: 'style', labelTh: 'แบบกล่อง', labelEn: 'Style', valueTh: 'กล่องฝาชน', valueEn: 'กล่องฝาชน' },
      {
        key: 'size',
        labelTh: 'ขนาด (ยาว × กว้าง × สูง)',
        labelEn: 'Size (L × W × H)',
        valueTh: '400 × 300 × 250 มม. (ด้านใน)',
        valueEn: '400 × 300 × 250 mm (inside)',
      },
      {
        key: 'material',
        labelTh: 'วัสดุ',
        labelEn: 'Material',
        valueTh: 'กระดาษลัง KA125 ลอน B',
        valueEn: 'Kraft board KA125 B-flute',
      },
    ],
    specLabel: {
      th: 'กล่องฝาชน · 400 × 300 × 250 มม. (ด้านใน) · กระดาษลัง KA125 ลอน B · ไม่พิมพ์',
      en: 'กล่องฝาชน · 400 × 300 × 250 mm (inside) · Kraft board KA125 B-flute · Unprinted',
    },
  },
};
