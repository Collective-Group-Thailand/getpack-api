import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Saved list views of staff (U-B0.3): a view is the list's URL parameters, so the frontend renders it as a URL. */

const RESOURCE = /^[a-z][a-z0-9_.-]{1,63}$/;

export class SavedViewQuery extends PageQuery {
  @ApiProperty({ example: 'orders', description: 'The list the views belong to (the frontend’s list key)' })
  @Matches(RESOURCE)
  resource!: string;
}

export class CreateSavedViewDto {
  @ApiProperty({ example: 'orders', pattern: RESOURCE.source })
  @Matches(RESOURCE)
  resource!: string;

  @ApiProperty({ example: 'รอชำระเงิน กรุงเทพฯ', minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { status: 'waiting_payment', sort: 'placedAt', order: 'desc' },
    description: 'The list’s URL parameters (at most 30, values ≤ 500 characters)',
  })
  @IsObject()
  query!: Record<string, string>;

  @ApiPropertyOptional({
    type: [String],
    nullable: true,
    example: ['orderCode', 'customer', 'status'],
    description: 'Visible columns in order; null keeps the list’s defaults',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  columns?: string[] | null;

  @ApiPropertyOptional({ example: false, description: 'Every staff member sees a shared view' })
  @IsOptional()
  @IsBoolean()
  shared?: boolean;
}

export class SavedViewDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-000000000b01' })
  id!: string;

  @ApiProperty({ example: 'orders' })
  resource!: string;

  @ApiProperty({ example: 'รอชำระเงิน กรุงเทพฯ' })
  name!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { status: 'waiting_payment', sort: 'placedAt', order: 'desc' },
  })
  query!: Record<string, string>;

  @ApiProperty({ type: [String], nullable: true, example: null })
  columns!: string[] | null;

  @ApiProperty({ example: false })
  shared!: boolean;

  @ApiProperty({ type: UserRefDto })
  owner!: UserRefDto;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T10:00:00+07:00' })
  createdAt!: string;
}

export const SAVED_VIEW_EXAMPLE: SavedViewDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-000000000b01',
  resource: 'orders',
  name: 'รอชำระเงิน กรุงเทพฯ',
  query: { status: 'waiting_payment', sort: 'placedAt', order: 'desc' },
  columns: null,
  shared: false,
  owner: { id: '0192f3a0-7c1e-7d2a-9b1f-000000000a01', displayName: 'Dev CS' },
  createdAt: '2026-10-01T10:00:00+07:00',
};
