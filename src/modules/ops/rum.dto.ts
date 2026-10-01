import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

import { RUM_ZONES, VITAL_RATINGS, WEB_VITALS } from './rum';

export class WebVitalDto {
  @ApiProperty({ enum: WEB_VITALS, enumName: 'WebVitalName', example: 'LCP' })
  @IsIn(WEB_VITALS)
  name!: (typeof WEB_VITALS)[number];

  @ApiProperty({ example: 2140.5, description: 'Milliseconds (CLS: unitless score)' })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(600_000)
  value!: number;

  @ApiProperty({ enum: VITAL_RATINGS, enumName: 'WebVitalRating', example: 'good' })
  @IsIn(VITAL_RATINGS)
  rating!: (typeof VITAL_RATINGS)[number];

  @ApiProperty({ example: 'v4-169615-123', description: 'The sample id of the web-vitals library' })
  @IsString()
  @MaxLength(100)
  id!: string;

  @ApiProperty({
    example: '/orders/[orderId]',
    description: 'Route pattern, never a real path (no ids, codes or tokens — 422 otherwise)',
  })
  @IsString()
  @MaxLength(200)
  @Matches(/^\//)
  route!: string;

  @ApiProperty({ enum: RUM_ZONES, enumName: 'RumZone', example: 'store' })
  @IsIn(RUM_ZONES)
  zone!: (typeof RUM_ZONES)[number];
}

export class WebVitalSummaryDto {
  @ApiProperty({ enum: RUM_ZONES, enumName: 'RumZone', example: 'store' })
  zone!: string;

  @ApiProperty({ example: '/orders/[orderId]' })
  route!: string;

  @ApiProperty({ enum: WEB_VITALS, enumName: 'WebVitalName', example: 'LCP' })
  name!: string;

  @ApiProperty({ type: 'integer', example: 120 })
  samples!: number;

  @ApiProperty({ example: 2140.5, description: 'Mean value (ms; CLS unitless)' })
  average!: number;

  @ApiProperty({ example: 4.2, description: 'Share of samples rated poor, percent' })
  poorPct!: number;
}

export const WEB_VITAL_EXAMPLE = {
  name: 'LCP',
  value: 2140.5,
  rating: 'good',
  id: 'v4-169615-123',
  route: '/orders/[orderId]',
  zone: 'store',
};
