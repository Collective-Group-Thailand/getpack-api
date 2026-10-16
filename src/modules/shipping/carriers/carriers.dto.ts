import { BoolField, TextField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { POSTCODE } from '../rates/customer-rates.dto';

/** Fallback carriers and getpack's carrier accounts (D-013, D-114, D-005). */

export const CARRIER_CODES = ['factory_fleet', 'flash_express', 'deliveree'] as const;
export const CARRIER_CAPABILITIES = ['quote', 'book', 'label', 'track', 'cancel', 'webhook'] as const;

const IDS = {
  carrier: '0192f3a0-7c1e-7d2a-9b1f-00000000d421',
  account: '0192f3a0-7c1e-7d2a-9b1f-00000000d422',
};

export class CarrierAccountDto {
  @ApiProperty({ format: 'uuid', example: IDS.account })
  id!: string;

  @ApiProperty({ example: 'getpack Flash sandbox (fake)' })
  label!: string;

  @ApiProperty({ example: true, description: 'Provider test environment' })
  sandbox!: boolean;

  @ApiProperty({ example: true, description: 'false once replaced or deactivated (kept for history)' })
  active!: boolean;

  @ApiProperty({ example: 'CGT', description: 'Legal entity holding the account' })
  entityCode!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T09:00:00+07:00' })
  createdAt!: string;
}

export class CarrierDto {
  @ApiProperty({ format: 'uuid', example: IDS.carrier })
  id!: string;

  @ApiProperty({ enum: CARRIER_CODES, enumName: 'CarrierCode', example: 'flash_express' })
  code!: string;

  @ApiProperty({ example: 'Flash Express' })
  name!: string;

  @ApiProperty({ example: false, description: 'Used as fallback only when enabled (D-114)' })
  enabled!: boolean;

  @ApiProperty({
    enum: CARRIER_CAPABILITIES,
    enumName: 'CarrierCapability',
    isArray: true,
    example: ['quote', 'book'],
  })
  supports!: string[];

  @ApiProperty({
    type: [CarrierAccountDto],
    description: 'Credentials stay in Secrets Manager and are never returned',
  })
  accounts!: CarrierAccountDto[];
}

export class AddCarrierAccountDto {
  @TextField({ example: 'getpack Flash sandbox (fake)', max: 200 })
  label!: string;

  @TextField({
    example: 'getpack/sandbox/carriers/flash-express',
    max: 500,
    description: 'Secrets Manager id of a JSON secret with the carrier credentials (never the credentials)',
  })
  credentialsSecretRef!: string;

  @BoolField({ example: true, description: 'Provider test environment' })
  sandbox!: boolean;
}

export class CarrierParcelDto {
  @ApiProperty({ type: 'integer', example: 3200, minimum: 1, description: 'Unit: g.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_000_000)
  weightG!: number;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 50, description: 'Unit: cm.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  lengthCm?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 48, description: 'Unit: cm.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  widthCm?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 13, description: 'Unit: cm.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  heightCm?: number | null;
}

export class CarrierPlaceDto {
  @ApiProperty({ example: '10110', pattern: POSTCODE.source })
  @Matches(POSTCODE)
  postcode!: string;

  @ApiPropertyOptional({
    description: 'Latitude, decimal degrees (WGS 84)',
    type: Number,
    nullable: true,
    example: 13.7563,
  })
  @IsOptional()
  @IsLatitude()
  lat?: number | null;

  @ApiPropertyOptional({
    description: 'Longitude, decimal degrees (WGS 84)',
    type: Number,
    nullable: true,
    example: 100.5018,
  })
  @IsOptional()
  @IsLongitude()
  lng?: number | null;
}

export class CarrierTestQuoteDto {
  @ApiProperty({ type: CarrierPlaceDto })
  @ValidateNested()
  @Type(() => CarrierPlaceDto)
  from!: CarrierPlaceDto;

  @ApiProperty({ type: CarrierPlaceDto })
  @ValidateNested()
  @Type(() => CarrierPlaceDto)
  to!: CarrierPlaceDto;

  @ApiProperty({ type: [CarrierParcelDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CarrierParcelDto)
  parcels!: CarrierParcelDto[];
}

export class CarrierQuoteDto {
  @ApiProperty({ example: '85.00', description: 'THB as quoted by the carrier' })
  amount!: string;

  @ApiProperty({ type: 'integer', nullable: true, example: 2 })
  transitDays!: number | null;

  @ApiProperty({
    enum: ['THB'],
    enumName: 'Currency',
    example: 'THB',
    description: 'Always THB (one currency)',
  })
  currency!: 'THB';
}

export class CarrierWebhookAckDto {
  @ApiProperty({
    example: '1',
    description: 'Flash Express: `1` = processed (anything else makes Flash retry)',
  })
  errorCode!: string;

  @ApiProperty({ example: 'success' })
  state!: string;
}

export class WebhookReceivedDto {
  @ApiProperty({ example: true })
  received!: boolean;
}

export const ACCOUNT_EXAMPLE: CarrierAccountDto = {
  id: IDS.account,
  label: 'getpack Flash sandbox (fake)',
  sandbox: true,
  active: true,
  entityCode: 'CGT',
  createdAt: '2026-10-01T09:00:00+07:00',
};

export const CARRIER_EXAMPLE: CarrierDto = {
  id: IDS.carrier,
  code: 'flash_express',
  name: 'Flash Express',
  enabled: false,
  supports: ['quote', 'book', 'label', 'track', 'cancel', 'webhook'],
  accounts: [ACCOUNT_EXAMPLE],
};
