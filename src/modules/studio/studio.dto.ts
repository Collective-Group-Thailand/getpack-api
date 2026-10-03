import { QuoteCalculationDto, STORE_CALCULATION_EXAMPLE } from '@modules/pricing/quotes/quote.dto';
import { TargetPriceField } from '@modules/pricing/quotes/target-price';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { PRICE_CHANGE_REASONS } from './studio-spec';

const POSTCODE = /^[0-9]{5}$/;

export class StudioQuoteRequestDto {
  @ApiProperty({
    type: [Number],
    example: [1000, 3000],
    description: 'Quantities to price (1–10, different)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(100_000_000, { each: true })
  quantities!: number[];

  @ApiPropertyOptional({ example: '10110', description: 'Delivery postcode (prices shipping)' })
  @IsOptional()
  @IsString()
  @Matches(POSTCODE)
  deliveryPostcode?: string;

  @ApiPropertyOptional({
    type: 'integer',
    example: 3,
    description: 'A saved version; absent: the current one',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  versionNo?: number;

  @TargetPriceField()
  targetPricePerUnit?: string;

  @ApiPropertyOptional({
    example: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    description: 'The `specHash` of the quote shown before this change: the answer explains the difference',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  previousSpecHash?: string;
}

export class SaveStudioQuoteDto {
  @ApiProperty({ type: [Number], example: [1000, 3000] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(100_000_000, { each: true })
  quantities!: number[];

  @ApiPropertyOptional({ example: '10110' })
  @IsOptional()
  @IsString()
  @Matches(POSTCODE)
  deliveryPostcode?: string;

  @ApiPropertyOptional({ type: 'integer', example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  versionNo?: number;

  @TargetPriceField()
  targetPricePerUnit?: string;
}

export class StudioRfqDto {
  @ApiProperty({ type: [Number], example: [1000, 3000] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(100_000_000, { each: true })
  quantities!: number[];

  @ApiProperty({ example: '10110' })
  @IsString()
  @Matches(POSTCODE)
  deliveryPostcode!: string;

  @ApiPropertyOptional({ type: 'integer', example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  versionNo?: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { printing: 'cmyk' },
    description: 'The product type’s RFQ form answers (`store.rfqs.getForm`); the studio pre-fills them',
  })
  @IsObject()
  spec!: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'ขอราคาแบบพิมพ์ด้านใน', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ type: String, format: 'date', example: '2026-11-15', nullable: true })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  targetDate?: string | null;

  @ApiPropertyOptional({ type: [String], example: [] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  fileIds?: string[];

  @TargetPriceField()
  targetPricePerUnit?: string;
}

export class UnitPriceChangeDto {
  @ApiProperty({ type: 'integer', example: 1000 })
  quantity!: number;

  @ApiProperty({ example: '12.96' })
  previousUnitPrice!: string;

  @ApiProperty({ example: '13.38' })
  unitPrice!: string;
}

export class StudioQuoteDto {
  @ApiProperty({
    example: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    description: 'sha256 of the canonical (product type, configuration, quantities, postcode) — D-277',
  })
  specHash!: string;

  @ApiProperty({ type: 'integer', example: 3, description: 'The design version priced' })
  versionNo!: number;

  @ApiProperty({
    enum: ['instant', 'rfq'],
    enumName: 'QuoteMode',
    example: 'instant',
    description: '`rfq`: the type has no instant price — ask for a quotation (`store.studio.requestQuote`)',
  })
  mode!: string;

  @ApiProperty({
    type: QuoteCalculationDto,
    nullable: true,
    description: 'The same object `store.quotes.calculate` answers; null for `rfq`',
  })
  calculation!: QuoteCalculationDto | null;

  @ApiProperty({ example: false, description: 'Served from the snapshot of the same `specHash`' })
  cached!: boolean;

  @ApiProperty({
    enum: PRICE_CHANGE_REASONS,
    enumName: 'PriceChangeReason',
    isArray: true,
    example: ['print_changed'],
    description: 'Why the price differs from the quote of `previousSpecHash`',
  })
  reasons!: string[];

  @ApiProperty({ type: String, nullable: true, example: null })
  previousSpecHash!: string | null;

  @ApiProperty({ type: [UnitPriceChangeDto], description: 'Unit price before and now, per quantity in both' })
  changes!: UnitPriceChangeDto[];
}

export const STUDIO_QUOTE_EXAMPLE: StudioQuoteDto = {
  specHash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  versionNo: 3,
  mode: 'instant',
  calculation: STORE_CALCULATION_EXAMPLE,
  cached: false,
  reasons: ['print_changed'],
  previousSpecHash: 'a3f1c2d4e5b60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
  changes: [{ quantity: 1000, previousUnitPrice: '12.96', unitPrice: '13.38' }],
};
