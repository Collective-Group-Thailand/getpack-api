import { BoolField, DecimalField, EnumField, IntField, RefField } from '@modules/catalog/crud/dto-fields';
import { RATE_MISS_REASONS } from '@modules/shipping/rates/customer-rates.dto';
import { type MeasurementBasis } from '@modules/specs/dimension-conversion';
import { QUOTE_DIMENSIONS_EXAMPLE, QuoteDimensionsDto } from '@modules/specs/specs.dto';
import { BasisField } from '@modules/specs/specs.dto';
import { ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Folding configuration and quote calculation DTOs (B2.3; corrugate's configuration in `corrugate.dto.ts`, U-B6).
 * Money is a 2-decimal string (contract §3).
 */

export const IDS = {
  pattern: '0192f3a0-7c1e-7d2a-9b1f-00000000a101',
  material: '0192f3a0-7c1e-7d2a-9b1f-00000000a102',
  difficulty: '0192f3a0-7c1e-7d2a-9b1f-00000000a103',
  ink: '0192f3a0-7c1e-7d2a-9b1f-00000000a104',
  finish: '0192f3a0-7c1e-7d2a-9b1f-00000000a105',
  diecut: '0192f3a0-7c1e-7d2a-9b1f-00000000a106',
  factory: '0192f3a0-7c1e-7d2a-9b1f-00000000f001',
  printType: '0192f3a0-7c1e-7d2a-9b1f-00000000a107',
};

const MM = { unit: 'mm', scale: 2 };

/** Quantity tiers one calculate / save request may price (every box calculator). */
export const MAX_QUANTITY_TIERS = 10;

export class PrintColourDto {
  @RefField({ example: IDS.ink })
  inkColourId!: string;

  @ApiProperty({ example: 100, minimum: 0, maximum: 100, description: 'Ink coverage in percent' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  percent!: number;
}

export class Finish2Dto {
  @RefField({ example: IDS.finish, description: 'A foil, spot UV, emboss or deboss finish' })
  finishId!: string;

  @IntField({
    example: 1,
    optional: true,
    min: 1,
    max: 100,
    description: 'Locations, when the finish counts them',
  })
  amount?: number;

  @ApiPropertyOptional({ type: [Number], example: [40], description: 'Width of each location, mm' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { each: true })
  @Min(0, { each: true })
  w?: number[];

  @ApiPropertyOptional({ type: [Number], example: [20], description: 'Length of each location, mm' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { each: true })
  @Min(0, { each: true })
  l?: number[];
}

export class QuoteAssemblyInputDto {
  @RefField({ example: IDS.diecut, description: 'Gluing, window film, handle…' })
  assemblyId!: string;

  @IntField({ example: 1, optional: true, min: 1, max: 100 })
  amount?: number;

  @ApiPropertyOptional({ type: [Number], example: [50], description: 'Width of each item, mm' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { each: true })
  @Min(0, { each: true })
  w?: number[];

  @ApiPropertyOptional({ type: [Number], example: [40], description: 'Length of each item, mm' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { each: true })
  @Min(0, { each: true })
  l?: number[];
}

export class FoldingPartDto {
  @RefField({ example: IDS.pattern, optional: true, description: 'The part of a multi-part pattern' })
  subPatternId?: string;

  @ApiPropertyOptional({
    type: [PrintColourDto],
    description: 'Colours printed on the front; a process set is its colour four times',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => PrintColourDto)
  printFront?: PrintColourDto[];

  @ApiPropertyOptional({ type: [PrintColourDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => PrintColourDto)
  printBack?: PrintColourDto[];

  @RefField({ example: IDS.finish, optional: true, description: 'Coating or lamination, front' })
  finish1FrontId?: string;

  @RefField({ example: IDS.finish, optional: true, description: 'Coating or lamination, back' })
  finish1BackId?: string;

  @ApiPropertyOptional({ type: [Finish2Dto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => Finish2Dto)
  finish2?: Finish2Dto[];

  @RefField({ example: IDS.diecut, optional: true })
  diecutTypeId?: string;

  @ApiPropertyOptional({ type: [QuoteAssemblyInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => QuoteAssemblyInputDto)
  assemblies?: QuoteAssemblyInputDto[];
}

export class DesignOptionsDto {
  @BoolField({ example: false, description: 'Packio designs the artwork (graphic design fee)' })
  graphic!: boolean;

  @BoolField({ example: false, description: 'Packio designs the structure (structure design fee)' })
  structure!: boolean;
}

export class FoldingConfigurationDto {
  @RefField({ example: IDS.pattern })
  patternId!: string;

  @RefField({ example: IDS.pattern, optional: true })
  catalogProductId?: string;

  @BasisField('box')
  basis?: MeasurementBasis;

  @DecimalField({ example: 60, positive: true, ...MM, description: 'Box width' })
  w!: number;

  @DecimalField({ example: 40, positive: true, ...MM, description: 'Box length' })
  l!: number;

  @DecimalField({ example: 120, positive: true, ...MM, description: 'Box depth (height)' })
  d!: number;

  @IntField({
    example: 3,
    optional: true,
    min: 1,
    max: 20,
    description: 'Cells of an insert pattern (legacy default 3)',
  })
  x?: number;

  @DecimalField({ example: 0, optional: true, ...MM, description: 'Overlap of the flat overlap patterns' })
  c?: number;

  @EnumField(['dw', 'dl'], 'GrainParallel', {
    example: 'dl',
    optional: true,
    description: 'Fixed grain along this blank side; omit for a free grain (port-map Q15)',
  })
  grainParallel?: 'dw' | 'dl';

  @RefField({ example: IDS.material })
  materialId!: string;

  @RefField({ example: IDS.difficulty })
  difficultyLevelId!: string;

  @ApiProperty({ type: [Number], example: [500, 1000, 3000], description: 'Quantities to price, 1 to 10' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_QUANTITY_TIERS)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(10_000_000, { each: true })
  quantities!: number[];

  @ApiProperty({ type: [FoldingPartDto], description: 'One entry per part (one for single-part patterns)' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => FoldingPartDto)
  parts!: FoldingPartDto[];

  @ApiPropertyOptional({ type: DesignOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DesignOptionsDto)
  design?: DesignOptionsDto;
}

export class CalculateQuoteDto {
  @ApiProperty({ example: 'folding_carton', pattern: '^[a-z][a-z0-9_]*$' })
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z][a-z0-9_]*$/)
  productTypeCode!: string;

  @ApiProperty({
    anyOf: [
      { $ref: getSchemaPath(FoldingConfigurationDto) },
      { $ref: getSchemaPath('CorrugateConfigurationDto') },
      { $ref: getSchemaPath('LabelConfigurationDto') },
      { $ref: getSchemaPath('TagSleeveConfigurationDto') },
      { $ref: getSchemaPath('PouchConfigurationDto') },
      { $ref: getSchemaPath('StandardProductConfigurationDto') },
      { $ref: getSchemaPath('ServiceConfigurationDto') },
    ],
    description:
      "The configuration of the product type's calculator: `FoldingConfigurationDto` for folding cartons, " +
      '`CorrugateConfigurationDto` for corrugated boxes, `LabelConfigurationDto` for labels, ' +
      '`TagSleeveConfigurationDto` for tags & sleeves, `PouchConfigurationDto` for pouches, ' +
      '`StandardProductConfigurationDto` for standard products, `ServiceConfigurationDto` for services (validated ' +
      'against it; paths under `configuration`)',
  })
  @IsObject()
  configuration!: Record<string, unknown>;

  @ApiPropertyOptional({
    example: '10110',
    pattern: '^[0-9]{5}$',
    description: 'Delivery postcode: prices shipping on the customer rate card (D-013)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{5}$/)
  deliveryPostcode?: string;
}

// --- responses -----------------------------------------------------------------------------------

export class QuoteStepDto {
  @ApiProperty({ example: 1000 })
  quantity!: number;

  @ApiProperty({
    example: true,
    description: 'false = no instant price; the configurator routes to RFQ (D-043)',
  })
  instant!: boolean;

  @ApiProperty({
    nullable: true,
    example: null,
    enum: [
      'no_price_path',
      'not_priceable',
      'envelope_not_covered',
      'capacity_unavailable',
      'delivery_unavailable',
    ],
    enumName: 'QuoteNoPriceReason',
    description:
      'Why there is no instant price; `envelope_not_covered`: only tier-B paths priced it, outside their envelopes (D-234)',
  })
  reason!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '13.38',
    description: 'Per piece incl. VAT, excluding shipping (its own line, D-013)',
  })
  unitPrice!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '13380.00', description: 'Pieces incl. VAT' })
  productAmount!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '0.00' })
  designFeeAmount!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '0.00' })
  structureDesignFeeAmount!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '0.00',
    description:
      'Print plates and die blocks, incl. VAT, charged apart from the pieces (corrugate flexo, legacy ' +
      '`calculate_cs:835-837`); 0.00 for the other calculators',
  })
  toolingAmount!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '128.40',
    description: 'Shipping incl. VAT, its own line (D-013); null while not priced',
  })
  shippingAmount!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '120.00', description: 'Shipping before VAT' })
  shippingNetAmount!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '8.40', description: 'VAT on shipping' })
  shippingVatAmount!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '875.33',
    description: 'VAT included in the amounts',
  })
  vatAmount!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '13380.00', description: 'Total incl. VAT' })
  grossAmount!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 7 })
  leadTimeDays!: number | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    example: '2026-10-09',
    description: 'Asia/Bangkok date (D-101)',
  })
  earliestShipDate!: string | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    example: '2026-10-10',
    description: 'Ship date plus the zone’s extra lead days or the carrier’s transit days, when known',
  })
  earliestDeliveryDate!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '5.0000',
    description: 'Quantity tolerance, shortage % (D-021)',
  })
  toleranceShortagePct!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '5.0000',
    description: 'Quantity tolerance, overage % (D-021)',
  })
  toleranceOveragePct!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '1.00',
    description:
      'The selected factory’s dimensional tolerance ± mm (D-186); null = none published for the product',
  })
  toleranceDimensionalMm!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '3.00',
    description:
      'The selected factory’s colour tolerance, ΔE2000 against the approved proof (D-186); null = not printed',
  })
  toleranceColourDeltaE!: string | null;

  @ApiProperty({ example: false, description: 'Shipping is not priced (no postcode, zone or band)' })
  shippingPending!: boolean;

  @ApiProperty({
    nullable: true,
    example: null,
    enum: RATE_MISS_REASONS,
    enumName: 'ShippingRateMissReason',
    description: 'Why shipping is not priced',
  })
  shippingPendingReason!: string | null;
}

export class QuoteCalculationDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000c1001',
    description:
      'This calculation; send it as `routedFrom.calculationId` when a quantity routes to RFQ (D-102). Null when it was not recorded',
  })
  calculationId!: string | null;

  @ApiProperty({ example: '1.0.0', description: 'Semver of the calculator port' })
  calculatorVersion!: string;

  @ApiProperty({ type: [QuoteStepDto] })
  steps!: QuoteStepDto[];

  @ApiProperty({
    type: QuoteDimensionsDto,
    nullable: true,
    example: QUOTE_DIMENSIONS_EXAMPLE,
    description: 'The sizes on every basis and the size priced (D-182); null for a product without a size',
  })
  dimensions!: QuoteDimensionsDto | null;
}

export class QuotePartInternalDto {
  @ApiProperty({ example: 'main' })
  partKey!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '10123.45',
    description: 'Needs `factory_cost.read` (D-141)',
  })
  buyPrice!: string | null;

  @ApiProperty({ example: 10 })
  layoutAmount!: number;

  @ApiProperty({ example: 225 })
  sheets!: number;

  @ApiProperty({ example: false })
  layoutStandard!: boolean;
}

export class QuoteShippingInternalDto {
  @ApiProperty({
    enum: ['factory_fleet', 'flash_express', 'deliveree'],
    enumName: 'CarrierCode',
    example: 'factory_fleet',
  })
  method!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '95.00',
    description: 'Packio’s delivery cost (fleet payout or carrier); needs `factory_cost.read` (D-141)',
  })
  costAmount!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '25.00',
    description: 'Shipping margin before VAT (D-013); needs `margin.read` (D-141)',
  })
  marginAmount!: string | null;

  @ApiProperty({ example: 31000, description: 'Weight the rate cards were read at. Unit: g.' })
  weightG!: number;

  @ApiProperty({ type: Number, nullable: true, example: 2, description: 'Null without a carton spec' })
  cartons!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 61776, description: 'Unit: cm³.' })
  volumeCm3!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: null, description: 'Null without a pallet spec' })
  pallets!: number | null;

  @ApiProperty({ example: 'bkk' })
  zoneCode!: string;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000d402' })
  customerRateVersionId!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: '0192f3a0-7c1e-7d2a-9b1f-00000000d412',
  })
  factoryPayoutVersionId!: string | null;
}

export class QuoteInternalDto {
  @ApiProperty({ format: 'uuid', example: IDS.factory })
  factoryId!: string;

  @ApiProperty({ format: 'uuid', example: IDS.printType })
  printTypeId!: string;

  @ApiProperty({
    format: 'uuid',
    example: IDS.pattern,
    description: 'The price-list version used (snapshot, D-040)',
  })
  priceListVersionId!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '10123.45',
    description: 'Needs `factory_cost.read` (D-141)',
  })
  buyPrice!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '24.1234',
    description: 'Needs `margin.read` (D-141)',
  })
  marginPct!: string | null;

  @ApiProperty({ example: false, description: 'Below the margin floor (D-012)' })
  belowMarginFloor!: boolean;

  @ApiProperty({ example: 1000, description: 'Production run (the minimum for production when larger)' })
  productionRun!: number;

  @ApiProperty({ type: [QuotePartInternalDto] })
  parts!: QuotePartInternalDto[];

  @ApiProperty({
    type: QuoteShippingInternalDto,
    nullable: true,
    description: 'Null while shipping is not priced',
  })
  shipping!: QuoteShippingInternalDto | null;
}

export class AdminQuoteStepDto extends QuoteStepDto {
  @ApiProperty({ type: QuoteInternalDto, nullable: true })
  internal!: QuoteInternalDto | null;
}

export class QuoteOptionDto {
  @ApiProperty({ example: `${IDS.factory}:${IDS.printType}` })
  optionKey!: string;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Why the option has no price' })
  error!: string | null;
}

export class AdminQuoteCalculationDto {
  @ApiProperty({ example: '1.0.0' })
  calculatorVersion!: string;

  @ApiProperty({ type: [AdminQuoteStepDto] })
  steps!: AdminQuoteStepDto[];

  @ApiProperty({ type: [QuoteOptionDto] })
  options!: QuoteOptionDto[];

  @ApiProperty({
    type: QuoteDimensionsDto,
    nullable: true,
    example: QUOTE_DIMENSIONS_EXAMPLE,
    description: 'The sizes on every basis and the size priced (D-182)',
  })
  dimensions!: QuoteDimensionsDto | null;
}

export const STORE_CALCULATION_EXAMPLE: QuoteCalculationDto = {
  calculatorVersion: '1.0.0',
  dimensions: QUOTE_DIMENSIONS_EXAMPLE,
  calculationId: '0192f3a0-7c1e-7d2a-9b1f-0000000c1001',
  steps: [
    {
      quantity: 1000,
      instant: true,
      reason: null,
      unitPrice: '13.38',
      productAmount: '13380.00',
      designFeeAmount: '0.00',
      structureDesignFeeAmount: '0.00',
      toolingAmount: '0.00',
      shippingAmount: '128.40',
      shippingNetAmount: '120.00',
      shippingVatAmount: '8.40',
      vatAmount: '883.73',
      grossAmount: '13508.40',
      leadTimeDays: 7,
      earliestShipDate: '2026-10-09',
      earliestDeliveryDate: '2026-10-10',
      toleranceShortagePct: '5.0000',
      toleranceOveragePct: '5.0000',
      toleranceDimensionalMm: '1.00',
      toleranceColourDeltaE: '3.00',
      shippingPending: false,
      shippingPendingReason: null,
    },
  ],
};

export const ADMIN_CALCULATION_EXAMPLE: AdminQuoteCalculationDto = {
  dimensions: QUOTE_DIMENSIONS_EXAMPLE,
  calculatorVersion: '1.0.0',
  steps: [
    {
      ...STORE_CALCULATION_EXAMPLE.steps[0]!,
      internal: {
        factoryId: IDS.factory,
        printTypeId: IDS.printType,
        priceListVersionId: IDS.pattern,
        buyPrice: '10123.45',
        marginPct: '24.1234',
        belowMarginFloor: false,
        productionRun: 1000,
        parts: [
          { partKey: 'main', buyPrice: '10123.45', layoutAmount: 10, sheets: 225, layoutStandard: false },
        ],
        shipping: {
          method: 'factory_fleet',
          costAmount: '95.00',
          marginAmount: '25.00',
          weightG: 31000,
          cartons: 2,
          volumeCm3: 61776,
          pallets: null,
          zoneCode: 'bkk',
          customerRateVersionId: '0192f3a0-7c1e-7d2a-9b1f-00000000d402',
          factoryPayoutVersionId: '0192f3a0-7c1e-7d2a-9b1f-00000000d412',
        },
      },
    },
  ],
  options: [{ optionKey: `${IDS.factory}:${IDS.printType}`, error: null }],
};

export const CONFIGURATION_EXAMPLE = {
  patternId: IDS.pattern,
  w: 60,
  l: 40,
  d: 120,
  materialId: IDS.material,
  difficultyLevelId: IDS.difficulty,
  quantities: [1000],
  parts: [
    {
      printFront: [1, 2, 3, 4].map(() => ({ inkColourId: IDS.ink, percent: 100 })),
      finish1FrontId: IDS.finish,
      diecutTypeId: IDS.diecut,
    },
  ],
  design: { graphic: false, structure: false },
};
