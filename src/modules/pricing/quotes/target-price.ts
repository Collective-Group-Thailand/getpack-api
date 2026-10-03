import { MoneyDecimal } from '@common/money/money';
import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

/** A positive THB amount with at most 2 decimals (D-247). */
const TARGET_PATTERN = /^(?!0+(\.0{1,2})?$)\d{1,9}(\.\d{1,2})?$/;

/**
 * D-247 the customer's optional target per unit: THB incl. VAT, excluding shipping — the basis of a step's
 * `unitPrice`. Never shown to a partner (D-190).
 */
export function TargetPriceField(description = ''): PropertyDecorator {
  return applyDecorators(
    ApiPropertyOptional({
      type: String,
      example: '11.50',
      pattern: TARGET_PATTERN.source,
      description:
        'Target price per unit (THB incl. VAT, excluding shipping — the basis of `unitPrice`), > 0; never shown to a ' +
        'factory (D-247, D-190)' +
        (description ? `. ${description}` : ''),
    }),
    IsOptional(),
    IsString(),
    Matches(TARGET_PATTERN, {
      message: 'targetPricePerUnit must be a positive amount with at most 2 decimals',
    }),
  );
}

export class TargetGapDto {
  @ApiProperty({
    example: '1.88',
    description: 'Unit price − target, THB (negative = below the target, D-247)',
  })
  gapPerUnit!: string;

  @ApiProperty({ example: '16.35', description: 'The gap in % of the target (2 decimals)' })
  gapPct!: string;

  @ApiProperty({ example: false, description: 'The unit price is at or below the target' })
  meetsTarget!: boolean;
}

export interface TargetGap {
  gapPerUnit: string;
  gapPct: string;
  meetsTarget: boolean;
}

/** D-247 the gap of a unit price against the target; null without a target or a price. */
export function targetGap(
  unitPrice: string | { toString(): string } | null | undefined,
  target: string | { toString(): string } | null | undefined,
): TargetGap | null {
  if (unitPrice === null || unitPrice === undefined || target === null || target === undefined) return null;
  const price = new MoneyDecimal(unitPrice.toString());
  const t = new MoneyDecimal(target.toString());
  if (t.lte(0)) return null;
  const gap = price.minus(t);
  return {
    gapPerUnit: gap.toDecimalPlaces(2).toFixed(2),
    gapPct: gap.div(t).times(100).toDecimalPlaces(2).toFixed(2),
    meetsTarget: gap.lte(0),
  };
}

/** A target from the request or a row as a 2-decimal string (null when none). */
export function targetString(value: string | { toString(): string } | null | undefined): string | null {
  return value === null || value === undefined ? null : new MoneyDecimal(value.toString()).toFixed(2);
}
