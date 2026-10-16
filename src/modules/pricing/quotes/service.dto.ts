import { BoolField, DecimalField, EnumField, IntField, RefField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

import { MAX_QUANTITY_TIERS } from './quote.dto';
import { SERVICE_AMOUNT_BASES, UNIT_AMOUNT_PATTERN } from './service-amount';

export { SERVICE_AMOUNT_BASES };

/** Service configuration and CS service pricing DTOs (U-B6 service). Money is a 2-decimal string (contract §3). */

export const SERVICE_IDS = {
  item: '0192f3a0-7c1e-7d2a-9b1f-00000000e301',
};

export class ServiceConfigurationDto {
  @RefField({
    example: SERVICE_IDS.item,
    description: 'The service item (a catalogue product of type `service`)',
  })
  catalogProductId!: string;

  @ApiProperty({ type: [Number], example: [1], description: 'Quantities to price, 1 to 10' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_QUANTITY_TIERS)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(10_000, { each: true })
  quantities!: number[];
}

export const SERVICE_CONFIGURATION_EXAMPLE = { catalogProductId: SERVICE_IDS.item, quantities: [1] };

export class CsServicePriceDto {
  @RefField({ example: SERVICE_IDS.item, description: 'The service item' })
  catalogProductId!: string;

  @EnumField(SERVICE_AMOUNT_BASES, 'ServiceAmountBasis', {
    example: 'buy_price_net',
    description:
      'What CS entered: `buy_price_net` the factory’s net buy price (plates, die blocks, molds, mockups, delivery) or ' +
      '`sell_gross` the VAT-inclusive sell price (design) — legacy `cs/service` (D-194). `buy_cost_net` is the ' +
      'deprecated spelling of `buy_price_net` (D-042), accepted until removed',
  })
  basis!: (typeof SERVICE_AMOUNT_BASES)[number];

  @ApiPropertyOptional({
    type: String,
    pattern: UNIT_AMOUNT_PATTERN.source,
    example: '1000.00',
    description:
      'The amount CS entered, per unit (THB, money string). Required unless the deprecated `amount` is sent',
  })
  @IsOptional()
  @Matches(UNIT_AMOUNT_PATTERN)
  unitAmount?: string;

  @DecimalField({
    example: 1000,
    positive: true,
    optional: true,
    deprecated: true,
    unit: 'THB',
    description: 'Deprecated: the same amount as a JSON number — send `unitAmount`',
  })
  amount?: number;

  @IntField({ example: 1, optional: true, min: 1, max: 10_000, description: 'Units (default 1, as legacy)' })
  quantity?: number;

  @BoolField({
    example: false,
    optional: true,
    description: 'A hired freelancer design: also returns the freelancer’s payable (`sell_gross` only)',
  })
  freelancer?: boolean;
}

export class ServiceAmountsDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '1000.00',
    description: 'The factory’s net buy price; null without the D-141 grant',
  })
  buyAmount!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '1000.00',
    deprecated: true,
    description: 'Deprecated: the same value as `buyAmount` (D-042 terminology)',
  })
  costAmount!: string | null;

  @ApiProperty({ example: '1069.52', description: 'Net sell price' })
  netAmount!: string;

  @ApiProperty({ example: '74.87' })
  vatAmount!: string;

  @ApiProperty({ example: '1144.39', description: 'Sell price, VAT included' })
  grossAmount!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '69.52',
    description: 'getpack margin; null without `margin.read`',
  })
  marginAmount!: string | null;
}

export class CsServicePriceResultDto {
  @ApiProperty({ example: 'buy_price_net', description: 'The basis as sent' })
  basis!: string;

  @ApiProperty({ example: 1 })
  quantity!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '6.5',
    description: 'Margin %; null without `margin.read`',
  })
  marginPct!: string | null;

  @ApiProperty({ example: '7', description: 'VAT % (the dated `vat_standard` rate)' })
  vatPct!: string;

  @ApiProperty({ type: ServiceAmountsDto, description: 'Per unit' })
  unit!: ServiceAmountsDto;

  @ApiProperty({ type: ServiceAmountsDto, description: 'Per unit × quantity' })
  total!: ServiceAmountsDto;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Payable to a hired freelancer for the quantity (legacy `design_cost`); null otherwise',
  })
  freelancerPayableAmount!: string | null;
}

export const CS_SERVICE_PRICE_EXAMPLE = {
  catalogProductId: SERVICE_IDS.item,
  basis: 'buy_price_net',
  unitAmount: '1000.00',
  quantity: 1,
};

export const CS_SERVICE_PRICE_RESULT_EXAMPLE: CsServicePriceResultDto = {
  basis: 'buy_price_net',
  quantity: 1,
  marginPct: '6.5',
  vatPct: '7',
  unit: {
    buyAmount: '1000.00',
    costAmount: '1000.00',
    netAmount: '1069.52',
    vatAmount: '74.87',
    grossAmount: '1144.39',
    marginAmount: '69.52',
  },
  total: {
    buyAmount: '1000.00',
    costAmount: '1000.00',
    netAmount: '1069.52',
    vatAmount: '74.87',
    grossAmount: '1144.39',
    marginAmount: '69.52',
  },
  freelancerPayableAmount: null,
};
