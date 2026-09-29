import { ApiProperty } from '@nestjs/swagger';

import { CALCULATOR_KEYS } from '../product-structure/product-structure.dto';
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

  @ApiProperty({ type: String, nullable: true, example: 'rsc', description: 'Key for `@packio/dieline`' })
  dielineKey!: string | null;

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
    type: [StoreConfiguratorSizeDto],
    description: 'Standard sizes (corrugate: no die block on them)',
  })
  standardSizes!: StoreConfiguratorSizeDto[];

  @ApiProperty({
    type: [StoreOptionGroupDto],
    description: 'The options offered, with the ids the configuration takes',
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

  @ApiProperty({ example: 15, description: 'Days a saved price holds (D-051)' })
  quoteValidityDays!: number;
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
    },
  ],
  standardSizes: [
    { id: ID('005'), code: 'M', name: '30×40×25 ซม.', lengthMm: 400, widthMm: 300, heightMm: 250 },
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
          attributes: { kind: 'corrugated_board', gsm: 450, flute: 'B', coatable: false },
        },
      ],
    },
  ],
  printAreas: ['top', 'side', 'top_side', 'all_round'],
  quoteValidityDays: 15,
};
