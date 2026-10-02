import { ApiProperty } from '@nestjs/swagger';

/** Colour tolerance by print process (D-186). */
export class ColourToleranceDto {
  @ApiProperty({ example: '3.00', description: 'ΔE2000 against the approved proof' })
  standard!: string;

  @ApiProperty({
    example: '5.00',
    description: 'ΔE2000 for flexo printing (corrugated); otherwise the standard',
  })
  flexo!: string;
}

/** The platform's published tolerances for a product type, before a factory is chosen (D-163, D-186). */
export class ProductTypeTolerancesDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000a001' })
  productTypeId!: string;

  @ApiProperty({ example: 'folding_carton' })
  productTypeCode!: string;

  @ApiProperty({ example: '5.0000', description: 'Quantity shortage accepted, % (D-163)' })
  quantityShortagePct!: string;

  @ApiProperty({ example: '5.0000', description: 'Quantity overage accepted, % (D-163)' })
  quantityOveragePct!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '1.00',
    description: 'Dimensional ± mm (D-186); null = none published for the type',
  })
  dimensionalMm!: string | null;

  @ApiProperty({
    type: ColourToleranceDto,
    nullable: true,
    description: 'Colour ΔE2000 (D-186); null = the type is not printed',
  })
  colourDeltaE!: ColourToleranceDto | null;
}

export const TYPE_TOLERANCES_EXAMPLE: ProductTypeTolerancesDto = {
  productTypeId: '0192f3a0-7c1e-7d2a-9b1f-00000000a001',
  productTypeCode: 'folding_carton',
  quantityShortagePct: '5.0000',
  quantityOveragePct: '5.0000',
  dimensionalMm: '1.00',
  colourDeltaE: { standard: '3.00', flexo: '3.00' },
};
