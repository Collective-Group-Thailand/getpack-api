import { ApiProperty } from '@nestjs/swagger';

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

class InputNamedDto {
  @ApiProperty({ format: 'uuid', example: IDS.diecut })
  id!: string;

  @ApiProperty({ example: 'standard' })
  code!: string;

  @ApiProperty({ example: 'ไดคัททั่วไป' })
  nameTh!: string;

  @ApiProperty({ example: 'Standard die-cut' })
  nameEn!: string;
}

class InputAssemblyDto extends InputNamedDto {
  @ApiProperty({ example: false })
  requiresAmount!: boolean;

  @ApiProperty({ example: false })
  requiresWidth!: boolean;

  @ApiProperty({ example: false })
  requiresLength!: boolean;
}

export class FoldingInputDataDto {
  @ApiProperty({ type: [InputPatternDto] })
  patterns!: InputPatternDto[];

  @ApiProperty({ type: [InputMaterialDto] })
  materials!: InputMaterialDto[];

  @ApiProperty({ type: [InputInkColourDto] })
  inkColours!: InputInkColourDto[];

  @ApiProperty({ type: [InputFinishDto] })
  finishes!: InputFinishDto[];

  @ApiProperty({ type: [InputNamedDto] })
  diecutTypes!: InputNamedDto[];

  @ApiProperty({ type: [InputAssemblyDto] })
  assemblies!: InputAssemblyDto[];

  @ApiProperty({ type: [InputNamedDto] })
  difficultyLevels!: InputNamedDto[];
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
  patterns: [
    {
      id: IDS.pattern,
      code: 'RTE-01',
      name: 'ฝาเสียบกลับด้าน',
      geometryFormula: 'tuck_top',
      subPatterns: [],
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
