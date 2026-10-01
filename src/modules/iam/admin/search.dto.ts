import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export const SEARCH_RESULT_TYPES = [
  'order',
  'order_group',
  'quote',
  'rfq',
  'customer',
  'company',
  'factory',
  'shipment',
  'claim',
  'user',
] as const;

export class AdminSearchQuery {
  @ApiProperty({
    example: '2610-0001',
    minLength: 2,
    maxLength: 100,
    description: 'A code, phone number or e-mail',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q!: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 20, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}

export class SearchResultDto {
  @ApiProperty({ enum: SEARCH_RESULT_TYPES, enumName: 'SearchResultType', example: 'order' })
  type!: string;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-000000000c01' })
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'DEV-2610-00001-01' })
  code!: string | null;

  @ApiProperty({ example: 'DEV-2610-00001-01' })
  title!: string;

  @ApiProperty({ type: String, nullable: true, example: 'in_production' })
  subtitle!: string | null;
}

export class SearchResultsDto {
  @ApiProperty({ type: [SearchResultDto] })
  data!: SearchResultDto[];
}

export const SEARCH_EXAMPLE: SearchResultsDto = {
  data: [
    {
      type: 'order',
      id: '0192f3a0-7c1e-7d2a-9b1f-000000000c01',
      code: 'DEV-2610-00001-01',
      title: 'DEV-2610-00001-01',
      subtitle: 'in_production',
    },
  ],
};
