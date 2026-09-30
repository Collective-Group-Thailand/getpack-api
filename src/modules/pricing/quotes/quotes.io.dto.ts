import { CodeNameRefDto } from '@common/dto/code-name-ref.dto';
import {
  StoreConfiguratorQuantityDto,
  StoreConfiguratorSizeDto,
  StoreSizeRulesDto,
} from '@modules/catalog/store/store-configurator.dto';
import { ApiProperty } from '@nestjs/swagger';

import { CORRUGATE_FORMULAS } from '../calculators/corrugate/formulas';
import { CORRUGATE_IDS, PRINT_AREAS } from './corrugate.dto';
import { IDS } from './quote.dto';

/** CS folding input data and the partner's buy-side calculation (B2.3). */

class InputSubPatternDto {
  @ApiProperty({ format: 'uuid', example: IDS.pattern })
  id!: string;

  @ApiProperty({ example: 1 })
  seq!: number;

  @ApiProperty({ example: 'ถาด' })
  name!: string;
}

class InputPatternDto {
  @ApiProperty({ format: 'uuid', example: IDS.pattern })
  id!: string;

  @ApiProperty({ example: 'RTE-01' })
  code!: string;

  @ApiProperty({ example: 'ฝาเสียบกลับด้าน' })
  name!: string;

  @ApiProperty({ example: 'tuck_top', description: 'Blank formula (port-map §6)' })
  geometryFormula!: string;

  @ApiProperty({ type: [InputSubPatternDto], description: 'Parts to configure; empty = one part' })
  subPatterns!: InputSubPatternDto[];

  @ApiProperty({ type: StoreSizeRulesDto, description: 'Size rules of the box style' })
  rules!: StoreSizeRulesDto;
}

export class CsCatalogProductDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000a108' })
  id!: string;

  @ApiProperty({ example: 'tuck-end-box' })
  slug!: string;

  @ApiProperty({ example: 'กล่องฝาเสียบ' })
  nameTh!: string;

  @ApiProperty({ example: 'Tuck-end box' })
  nameEn!: string;

  @ApiProperty({ type: [StoreConfiguratorSizeDto] })
  standardSizes!: StoreConfiguratorSizeDto[];

  @ApiProperty({ type: StoreConfiguratorQuantityDto, description: 'Quantity limits and presets of the product' })
  quantity!: StoreConfiguratorQuantityDto;
}

export class CsDiscountPolicyDto {
  @ApiProperty({
    example: '5',
    description: 'Discount % CS may give without a discount memo (`discounts.cs_limit_pct`, D-052)',
  })
  directLimitPct!: string;
}

class InputMaterialDto {
  @ApiProperty({ format: 'uuid', example: IDS.material })
  id!: string;

  @ApiProperty({ example: 'art-350' })
  code!: string;

  @ApiProperty({ example: 'อาร์ตการ์ด 350 แกรม' })
  nameTh!: string;

  @ApiProperty({ example: 'Art card 350 gsm' })
  nameEn!: string;

  @ApiProperty({ type: Number, nullable: true, example: 350 })
  gsm!: number | null;
}

class InputInkColourDto {
  @ApiProperty({ format: 'uuid', example: IDS.ink })
  id!: string;

  @ApiProperty({ example: 'cmyk' })
  code!: string;

  @ApiProperty({ example: 'CMYK' })
  name!: string;

  @ApiProperty({ example: 'process' })
  colourKind!: string;
}

class InputFinishDto {
  @ApiProperty({ format: 'uuid', example: IDS.finish })
  id!: string;

  @ApiProperty({ example: 'matt-lamination' })
  code!: string;

  @ApiProperty({ example: 'เคลือบด้าน' })
  nameTh!: string;

  @ApiProperty({ example: 'Matt lamination' })
  nameEn!: string;

  @ApiProperty({ example: 'lamination' })
  finishKind!: string;

  @ApiProperty({ enum: ['finish1', 'finish2'], enumName: 'FinishSlot', example: 'finish1' })
  slot!: 'finish1' | 'finish2';

  @ApiProperty({ example: false })
  requiresAmount!: boolean;

  @ApiProperty({ example: false })
  requiresWidth!: boolean;

  @ApiProperty({ example: false })
  requiresLength!: boolean;
}

class InputAssemblyDto extends CodeNameRefDto {
  @ApiProperty({ example: false })
  requiresAmount!: boolean;

  @ApiProperty({ example: false })
  requiresWidth!: boolean;

  @ApiProperty({ example: false })
  requiresLength!: boolean;
}

export class FoldingInputDataDto {
  @ApiProperty({ type: [CsCatalogProductDto], description: 'The calculator’s catalogue products' })
  catalogProducts!: CsCatalogProductDto[];

  @ApiProperty({ type: CsDiscountPolicyDto })
  discountPolicy!: CsDiscountPolicyDto;

  @ApiProperty({ type: [InputPatternDto] })
  patterns!: InputPatternDto[];

  @ApiProperty({ type: [InputMaterialDto] })
  materials!: InputMaterialDto[];

  @ApiProperty({ type: [InputInkColourDto] })
  inkColours!: InputInkColourDto[];

  @ApiProperty({ type: [InputFinishDto] })
  finishes!: InputFinishDto[];

  @ApiProperty({ type: [CodeNameRefDto] })
  diecutTypes!: CodeNameRefDto[];

  @ApiProperty({ type: [InputAssemblyDto] })
  assemblies!: InputAssemblyDto[];

  @ApiProperty({ type: [CodeNameRefDto] })
  difficultyLevels!: CodeNameRefDto[];
}

// --- corrugate CS input data (U-B6, legacy `CorrugateController@getCSData:104-189`) ------------------

class CorrugateInputSubPatternDto extends InputSubPatternDto {
  @ApiProperty({
    enum: CORRUGATE_FORMULAS,
    enumName: 'CorrugateFormula',
    nullable: true,
    example: 'tele_body',
    description: "The part's blank formula; null = the pattern's",
  })
  corrugateFormula!: (typeof CORRUGATE_FORMULAS)[number] | null;
}

class CorrugateInputPatternDto {
  @ApiProperty({ format: 'uuid', example: CORRUGATE_IDS.pattern })
  id!: string;

  @ApiProperty({ example: 'RSC-01' })
  code!: string;

  @ApiProperty({ example: 'กล่องฝาชน' })
  name!: string;

  @ApiProperty({
    enum: CORRUGATE_FORMULAS,
    enumName: 'CorrugateFormula',
    nullable: true,
    example: 'rsc',
    description: 'Blank formula (port map §6.1); null when each part has its own',
  })
  corrugateFormula!: (typeof CORRUGATE_FORMULAS)[number] | null;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    example: [IDS.material],
    description: 'Flutes offered; empty = any',
  })
  fluteTypeIds!: string[];

  @ApiProperty({ type: [CorrugateInputSubPatternDto], description: 'Parts to configure; empty = one part' })
  subPatterns!: CorrugateInputSubPatternDto[];

  @ApiProperty({ type: StoreSizeRulesDto, description: 'Size rules of the box style' })
  rules!: StoreSizeRulesDto;
}

class CorrugateInputFluteDto {
  @ApiProperty({ format: 'uuid', example: IDS.material })
  id!: string;

  @ApiProperty({ example: 'B' })
  code!: string;

  @ApiProperty({ example: 'ลอน B (3 ชั้น)' })
  name!: string;

  @ApiProperty({ example: 3 })
  layers!: number;
}

class CorrugateInputBoardDto {
  @ApiProperty({ format: 'uuid', example: CORRUGATE_IDS.board })
  id!: string;

  @ApiProperty({ example: 'ka125-b' })
  code!: string;

  @ApiProperty({ example: 'กระดาษลัง KA125 ลอน B' })
  nameTh!: string;

  @ApiProperty({ example: 'Kraft board KA125 B-flute' })
  nameEn!: string;

  @ApiProperty({ type: Number, nullable: true, example: 450 })
  gsm!: number | null;

  @ApiProperty({ type: CorrugateInputFluteDto })
  flute!: CorrugateInputFluteDto;

  @ApiProperty({ example: false, description: 'Takes a coating (legacy `can_finish`)' })
  coatable!: boolean;

  @ApiProperty({ type: String, nullable: true, example: 'น้ำตาล' })
  insideColour!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'น้ำตาล' })
  outsideColour!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  strength!: string | null;
}

class CorrugateInputCoatingDto extends CodeNameRefDto {
  @ApiProperty({ example: 'coating' })
  finishKind!: string;
}

export class CorrugateInputDataDto {
  @ApiProperty({ type: [CsCatalogProductDto], description: 'The calculator’s catalogue products' })
  catalogProducts!: CsCatalogProductDto[];

  @ApiProperty({ type: CsDiscountPolicyDto })
  discountPolicy!: CsDiscountPolicyDto;

  @ApiProperty({ type: [CorrugateInputPatternDto] })
  patterns!: CorrugateInputPatternDto[];

  @ApiProperty({ type: [CorrugateInputBoardDto] })
  boards!: CorrugateInputBoardDto[];

  @ApiProperty({ type: [InputInkColourDto] })
  inkColours!: InputInkColourDto[];

  @ApiProperty({ type: [CorrugateInputCoatingDto], description: 'Digital print on a coatable board only' })
  coatings!: CorrugateInputCoatingDto[];

  @ApiProperty({
    type: [InputAssemblyDto],
    description: 'Without the automatic ones (packing), added by the calculator',
  })
  assemblies!: InputAssemblyDto[];

  @ApiProperty({ type: [CodeNameRefDto] })
  difficultyLevels!: CodeNameRefDto[];

  @ApiProperty({
    enum: PRINT_AREAS,
    enumName: 'CorrugatePrintArea',
    isArray: true,
    example: ['top', 'side', 'top_side', 'all_round'],
  })
  printAreas!: (typeof PRINT_AREAS)[number][];
}

class FactoryQuotePartDto {
  @ApiProperty({ example: 'main' })
  partKey!: string;

  @ApiProperty({ example: '9111.11', description: 'Cost before the factory margin' })
  totalCost!: string;

  @ApiProperty({ example: '10123.45', description: 'Buy price of the part (cost ÷ (1 − factory margin))' })
  buyPrice!: string;

  @ApiProperty({ example: 10 })
  layoutAmount!: number;

  @ApiProperty({ example: 225 })
  sheets!: number;

  @ApiProperty({ example: false })
  layoutStandard!: boolean;
}

class FactoryQuoteStepDto {
  @ApiProperty({ example: 1000 })
  quantity!: number;

  @ApiProperty({ type: Number, nullable: true, example: 1000 })
  productionRun!: number | null;

  @ApiProperty({ type: String, nullable: true, example: '10123.45' })
  buyPrice!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 7 })
  leadTimeDays!: number | null;

  @ApiProperty({ type: [FactoryQuotePartDto] })
  parts!: FactoryQuotePartDto[];
}

class FactoryQuoteOptionDto {
  @ApiProperty({ format: 'uuid', example: IDS.printType })
  printTypeId!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  error!: string | null;

  @ApiProperty({ type: [FactoryQuoteStepDto] })
  steps!: FactoryQuoteStepDto[];
}

export class FactoryQuoteDto {
  @ApiProperty({ example: '1.0.0' })
  calculatorVersion!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: IDS.pattern,
    description: 'Own price list in force',
  })
  priceListVersionId!: string | null;

  @ApiProperty({ type: [FactoryQuoteOptionDto] })
  options!: FactoryQuoteOptionDto[];
}

export const INPUT_DATA_EXAMPLE: FoldingInputDataDto = {
  catalogProducts: [
    {
      id: '0192f3a0-7c1e-7d2a-9b1f-00000000a108',
      slug: 'tuck-end-box',
      nameTh: 'กล่องฝาเสียบ',
      nameEn: 'Tuck-end box',
      standardSizes: [
        { id: '0192f3a0-7c1e-7d2a-9b1f-00000000a109', code: 'S', name: 'ขนาดเล็ก', lengthMm: 100, widthMm: 100, heightMm: 50 },
      ],
      quantity: { min: 500, max: 100000, default: 1000, presets: [500, 1000, 3000], maxTiers: 10 },
    },
  ],
  discountPolicy: { directLimitPct: '5' },
  patterns: [
    {
      id: IDS.pattern,
      code: 'RTE-01',
      name: 'ฝาเสียบกลับด้าน',
      geometryFormula: 'tuck_top',
      subPatterns: [],
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
      id: IDS.material,
      code: 'art-350',
      nameTh: 'อาร์ตการ์ด 350 แกรม',
      nameEn: 'Art card 350 gsm',
      gsm: 350,
    },
  ],
  inkColours: [{ id: IDS.ink, code: 'cmyk', name: 'CMYK', colourKind: 'process' }],
  finishes: [
    {
      id: IDS.finish,
      code: 'matt-lamination',
      nameTh: 'เคลือบด้าน',
      nameEn: 'Matt lamination',
      finishKind: 'lamination',
      slot: 'finish1',
      requiresAmount: false,
      requiresWidth: false,
      requiresLength: false,
    },
  ],
  diecutTypes: [{ id: IDS.diecut, code: 'standard', nameTh: 'ไดคัททั่วไป', nameEn: 'Standard die-cut' }],
  assemblies: [],
  difficultyLevels: [{ id: IDS.difficulty, code: 'normal', nameTh: 'ปกติ', nameEn: 'Normal' }],
};

export const FACTORY_QUOTE_EXAMPLE: FactoryQuoteDto = {
  calculatorVersion: '1.0.0',
  priceListVersionId: IDS.pattern,
  options: [
    {
      printTypeId: IDS.printType,
      error: null,
      steps: [
        {
          quantity: 1000,
          productionRun: 1000,
          buyPrice: '10123.45',
          leadTimeDays: 7,
          parts: [
            {
              partKey: 'main',
              totalCost: '9111.11',
              buyPrice: '10123.45',
              layoutAmount: 10,
              sheets: 225,
              layoutStandard: false,
            },
          ],
        },
      ],
    },
  ],
};

export const CORRUGATE_INPUT_DATA_EXAMPLE: CorrugateInputDataDto = {
  catalogProducts: [
    {
      id: '0192f3a0-7c1e-7d2a-9b1f-00000000a108',
      slug: 'rsc-carton',
      nameTh: 'กล่องลูกฟูก',
      nameEn: 'RSC carton',
      standardSizes: [
        { id: '0192f3a0-7c1e-7d2a-9b1f-00000000a109', code: 'S', name: 'ขนาดเล็ก', lengthMm: 100, widthMm: 100, heightMm: 50 },
      ],
      quantity: { min: 500, max: 100000, default: 1000, presets: [500, 1000, 3000], maxTiers: 10 },
    },
  ],
  discountPolicy: { directLimitPct: '5' },
  patterns: [
    {
      id: CORRUGATE_IDS.pattern,
      code: 'RSC-01',
      name: 'กล่องฝาชน',
      corrugateFormula: 'rsc',
      fluteTypeIds: [IDS.material],
      subPatterns: [],
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
  boards: [
    {
      id: CORRUGATE_IDS.board,
      code: 'ka125-b',
      nameTh: 'กระดาษลัง KA125 ลอน B',
      nameEn: 'Kraft board KA125 B-flute',
      gsm: 450,
      flute: { id: IDS.material, code: 'B', name: 'ลอน B (3 ชั้น)', layers: 3 },
      coatable: false,
      insideColour: 'น้ำตาล',
      outsideColour: 'น้ำตาล',
      strength: null,
    },
  ],
  inkColours: [{ id: IDS.ink, code: 'black', name: 'ดำ', colourKind: 'spot' }],
  coatings: [
    {
      id: CORRUGATE_IDS.coating,
      code: 'aqueous',
      nameTh: 'เคลือบวานิช',
      nameEn: 'Aqueous coating',
      finishKind: 'coating',
    },
  ],
  assemblies: [],
  difficultyLevels: [{ id: IDS.difficulty, code: 'normal', nameTh: 'ปกติ', nameEn: 'Normal' }],
  printAreas: ['top', 'side', 'top_side', 'all_round'],
};
