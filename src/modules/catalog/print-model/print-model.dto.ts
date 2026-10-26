import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { PRINT_METHODS, type PrintMethod, type PrintModel, type PrintSelection } from './print-model';

/**
 * DTOs of the per-side print model (D-443): the admin's model on a catalogue product and the configurator's view.
 * The technical upper bound 8 is the corrugate request's own limit (`printFront` / `printBack` ≤ 8 entries), not a
 * business value: N and M are what the back office sets.
 */
const INK = (n: string) => `0192f3a0-7c1e-7d2a-9b1f-00000000e${n}`;
const TECHNICAL_MAX_COLOURS = 8;

const METHODS_DOC = {
  enum: PRINT_METHODS,
  enumName: 'PrintSideMethod',
  isArray: true,
  example: ['none', 'spot', 'cmyk'],
  description: '`none` ไม่พิมพ์ · `spot` สีพิเศษ · `cmyk` พิมพ์ 4 สี (CMYK); one choice per side',
} as const;

export class PrintSpotConfigDto {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: TECHNICAL_MAX_COLOURS,
    example: 2,
    description: 'N: the most spot colours on this side (ดำ counts as one spot colour); at least 1',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TECHNICAL_MAX_COLOURS)
  maxColours!: number;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    example: [INK('101'), INK('102')],
    description:
      'The spot ink colours (offered `ink_colour` options of kind spot / white / metallic) the customer picks from; ' +
      'at least `maxColours` of them',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  inkColourIds!: string[];
}

export class PrintCmykAddOnDto {
  @ApiProperty({ example: false, description: '"+ สีพิเศษ" beside CMYK is offered' })
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: TECHNICAL_MAX_COLOURS,
    example: 0,
    description:
      'M: the most spot colours beside CMYK (0 when disabled); colours come from the side’s `spot` list',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(TECHNICAL_MAX_COLOURS)
  maxColours!: number;
}

export class PrintCmykConfigDto {
  @ApiProperty({
    format: 'uuid',
    example: INK('103'),
    description: 'The process ink colour (an offered `ink_colour` option of kind process) that prints CMYK',
  })
  @IsUUID()
  inkColourId!: string;

  @ApiProperty({ type: PrintCmykAddOnDto })
  @ValidateNested()
  @Type(() => PrintCmykAddOnDto)
  addOn!: PrintCmykAddOnDto;
}

export class PrintSideConfigDto {
  @ApiProperty(METHODS_DOC)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PRINT_METHODS.length)
  @IsIn(PRINT_METHODS, { each: true })
  methods!: PrintMethod[];

  @ApiProperty({ type: PrintSpotConfigDto, nullable: true, description: 'Required when `spot` is offered' })
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @ValidateNested()
  @Type(() => PrintSpotConfigDto)
  spot!: PrintSpotConfigDto | null;

  @ApiProperty({ type: PrintCmykConfigDto, nullable: true, description: 'Required when `cmyk` is offered' })
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @ValidateNested()
  @Type(() => PrintCmykConfigDto)
  cmyk!: PrintCmykConfigDto | null;
}

export class PrintModelDto implements PrintModel {
  @ApiProperty({ type: PrintSideConfigDto, description: 'Outside (`printFront` of each part)' })
  @ValidateNested()
  @Type(() => PrintSideConfigDto)
  outside!: PrintSideConfigDto;

  @ApiProperty({ type: PrintSideConfigDto, description: 'Inside (`printBack` of each part)' })
  @ValidateNested()
  @Type(() => PrintSideConfigDto)
  inside!: PrintSideConfigDto;
}

export class SetPrintModelDto {
  @ApiProperty({
    type: PrintModelDto,
    nullable: true,
    description:
      'The per-side print model; `null` removes it (then only never-valid combinations are refused)',
  })
  @ValidateIf((_, v) => v !== null)
  @ValidateNested()
  @Type(() => PrintModelDto)
  printModel!: PrintModelDto | null;
}

export const PRINT_MODEL_EXAMPLE: PrintModelDto = {
  outside: {
    methods: ['none', 'spot', 'cmyk'],
    spot: { maxColours: 2, inkColourIds: [INK('101'), INK('102')] },
    cmyk: { inkColourId: INK('103'), addOn: { enabled: true, maxColours: 1 } },
  },
  inside: {
    methods: ['none', 'spot'],
    spot: { maxColours: 1, inkColourIds: [INK('101')] },
    cmyk: null,
  },
};

// ------------------------------------------------------------------------------------------------ store view

export class StorePrintSelectionDto implements PrintSelection {
  @ApiProperty({ enum: PRINT_METHODS, enumName: 'PrintSideMethod', example: 'none' })
  method!: PrintMethod;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    example: [],
    description: '`spot`: the spot colours chosen',
  })
  spotInkColourIds!: string[];

  @ApiProperty({
    type: [String],
    format: 'uuid',
    example: [],
    description: '`cmyk`: the "+ สีพิเศษ" colours chosen (empty without the add-on)',
  })
  cmykAddOnInkColourIds!: string[];
}

export class StorePrintSpotDto {
  @ApiProperty({ type: 'integer', example: 1, description: 'Counter minimum (always 1)' })
  minColours!: number;

  @ApiProperty({ type: 'integer', example: 2, description: 'Counter maximum N (back-office data)' })
  maxColours!: number;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    example: [INK('101'), INK('102')],
    description: 'Allowed spot colours, ids of the `ink_colour` option group (names and swatches there)',
  })
  inkColourIds!: string[];
}

export class StorePrintAddOnDto {
  @ApiProperty({ example: true, description: 'Show the "+ สีพิเศษ" counter beside CMYK' })
  enabled!: boolean;

  @ApiProperty({ type: 'integer', example: 0 })
  minColours!: number;

  @ApiProperty({ type: 'integer', example: 1, description: 'M (0 when disabled)' })
  maxColours!: number;
}

export class StorePrintCmykDto {
  @ApiProperty({ format: 'uuid', example: INK('103'), description: 'The process ink sent for CMYK' })
  inkColourId!: string;

  @ApiProperty({ type: StorePrintAddOnDto })
  addOn!: StorePrintAddOnDto;
}

export class StorePrintSideDto {
  @ApiProperty({
    enum: ['printFront', 'printBack'],
    enumName: 'PrintSideField',
    example: 'printFront',
    description: 'The configuration field of each part this side fills',
  })
  field!: 'printFront' | 'printBack';

  @ApiProperty(METHODS_DOC)
  methods!: PrintMethod[];

  @ApiProperty({ type: StorePrintSpotDto, nullable: true })
  spot!: StorePrintSpotDto | null;

  @ApiProperty({ type: StorePrintCmykDto, nullable: true })
  cmyk!: StorePrintCmykDto | null;

  @ApiProperty({
    type: StorePrintSelectionDto,
    description:
      'What the configurator opens on: the default spec’s print on this side; inside defaults to `none`',
  })
  default!: StorePrintSelectionDto;
}

/**
 * The per-side print model of the configurator (D-443): radios for the method, a counter for spot colours and,
 * when enabled, a "+ สีพิเศษ" counter beside CMYK. Send each side as one entry per ink in `field`
 * (`{ inkColourId, area }`): `none` → none, `spot` → the spot colours, `cmyk` → the process ink then the add-ons.
 */
export class StorePrintModelDto {
  @ApiProperty({ type: StorePrintSideDto })
  outside!: StorePrintSideDto;

  @ApiProperty({ type: StorePrintSideDto })
  inside!: StorePrintSideDto;
}

export const STORE_PRINT_MODEL_EXAMPLE: StorePrintModelDto = {
  outside: {
    field: 'printFront',
    methods: ['none', 'spot', 'cmyk'],
    spot: { minColours: 1, maxColours: 2, inkColourIds: [INK('101'), INK('102')] },
    cmyk: { inkColourId: INK('103'), addOn: { enabled: true, minColours: 0, maxColours: 1 } },
    default: { method: 'cmyk', spotInkColourIds: [], cmykAddOnInkColourIds: [] },
  },
  inside: {
    field: 'printBack',
    methods: ['none', 'spot'],
    spot: { minColours: 1, maxColours: 1, inkColourIds: [INK('101')] },
    cmyk: null,
    default: { method: 'none', spotInkColourIds: [], cmykAddOnInkColourIds: [] },
  },
};
