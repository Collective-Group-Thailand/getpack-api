import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export const CODE_REASONS = [
  'not_found',
  'disabled',
  'used_up',
  'not_yours',
  'inactive',
  'not_started',
  'expired',
  'budget_exhausted',
  'not_applicable',
] as const;
export const OFFER_STATUSES = ['usable', ...CODE_REASONS.filter((r) => r !== 'not_found')] as const;

export class CheckCodeDto {
  @ApiProperty({ example: 'WELCOME10', pattern: '^[A-Za-z0-9-]{3,40}$' })
  @IsString()
  @Matches(/^[A-Za-z0-9-]{3,40}$/)
  code!: string;

  @ApiPropertyOptional({ example: 'folding_carton', description: 'Check the product-type condition too' })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_]*$/)
  productTypeCode?: string;

  @ApiPropertyOptional({
    type: 'integer',
    example: 1000,
    description: 'Check the minimum-quantity condition too',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  quantity?: number;
}

export class OfferBenefitDto {
  @ApiProperty({
    example: 'percent',
    description: '`percent`, `fixed`, `tiered`, … as the promotion engine applies it',
  })
  type!: string;

  @ApiProperty({ type: String, nullable: true, example: '10' })
  pct!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  amount!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '500.00' })
  maxAmount!: string | null;
}

export class OfferConditionsDto {
  @ApiProperty({ type: String, nullable: true, example: '3000.00' })
  minOrderValue!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, example: null })
  minQuantity!: number | null;

  @ApiProperty({ type: [String], example: [], description: 'Empty = every product type' })
  productTypeCodes!: string[];

  @ApiProperty({ example: true })
  firstOrderOnly!: boolean;

  @ApiProperty({ type: [String], example: [], description: 'Empty = any payment method' })
  paymentMethods!: string[];
}

/** A promotion code as a customer may see it (D-053; real promotions only, D-181). */
export class PromotionOfferDto {
  @ApiProperty({ example: 'WELCOME10' })
  code!: string;

  @ApiProperty({ example: 'ลด 10% ลูกค้าใหม่' })
  title!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  description!: string | null;

  @ApiProperty({ type: OfferBenefitDto })
  benefit!: OfferBenefitDto;

  @ApiProperty({ type: OfferConditionsDto })
  conditions!: OfferConditionsDto;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-12-31T23:59:59+07:00' })
  validUntil!: string | null;

  @ApiProperty({ enum: OFFER_STATUSES, enumName: 'PromotionOfferStatus', example: 'usable' })
  status!: (typeof OFFER_STATUSES)[number];
}

export class CodeCheckDto {
  @ApiProperty({ example: 'WELCOME10' })
  code!: string;

  @ApiProperty({ example: true })
  valid!: boolean;

  @ApiProperty({ enum: CODE_REASONS, enumName: 'PromotionCodeReason', nullable: true, example: null })
  reason!: (typeof CODE_REASONS)[number] | null;

  @ApiProperty({
    type: PromotionOfferDto,
    nullable: true,
    description:
      'Shown when the code is valid or only its conditions do not match; the amount is worked out on the cart',
  })
  offer!: PromotionOfferDto | null;
}

export const OFFER_EXAMPLE: PromotionOfferDto = {
  code: 'WELCOME10',
  title: 'ลด 10% ลูกค้าใหม่',
  description: null,
  benefit: { type: 'percent', pct: '10', amount: null, maxAmount: '500.00' },
  conditions: {
    minOrderValue: '3000.00',
    minQuantity: null,
    productTypeCodes: [],
    firstOrderOnly: true,
    paymentMethods: [],
  },
  validUntil: '2026-12-31T23:59:59+07:00',
  status: 'usable',
};
