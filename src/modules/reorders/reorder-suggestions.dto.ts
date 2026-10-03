import { CodeNameRefDto } from '@common/dto/code-name-ref.dto';
import { PageQuery } from '@common/pagination/pagination.dto';
import { EnumField } from '@modules/catalog/crud/dto-fields';
import { PersonRefDto } from '@modules/financial-reports/financial-reports.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { IsISO8601, IsOptional } from 'class-validator';

export const SUGGESTION_STATUSES = ['open', 'contacted', 'dismissed'] as const;

export const SUGGESTION_IDS = {
  suggestion: '0192f3a0-7c1e-7d2a-9b1f-0000000e7201',
  order: '0192f3a0-7c1e-7d2a-9b1f-0000000f1002',
  company: '0192f3a0-7c1e-7d2a-9b1f-0000000e7202',
  customer: '0192f3a0-7c1e-7d2a-9b1f-0000000e7203',
  cs: '0192f3a0-7c1e-7d2a-9b1f-0000000e7204',
} as const;

export class SuggestionLastOrderDto {
  @ApiProperty({ format: 'uuid', example: SUGGESTION_IDS.order })
  orderId!: string;

  @ApiProperty({ example: 'PK-2610-0001-01' })
  orderCode!: string;

  @ApiProperty({ type: 'integer', example: 1000 })
  quantity!: number;

  @ApiProperty({ example: 'piece' })
  unit!: string;
}

/** D-288 a reorder suggestion for a SKU (specification × approved artwork) of mine or my company's. */
export class ReorderSuggestionDto {
  @ApiProperty({ format: 'uuid', example: SUGGESTION_IDS.suggestion })
  id!: string;

  @ApiProperty({ enum: SUGGESTION_STATUSES, enumName: 'ReorderSuggestionStatus', example: 'open' })
  status!: (typeof SUGGESTION_STATUSES)[number];

  @ApiProperty({ type: CodeNameRefDto })
  productType!: CodeNameRefDto;

  @ApiProperty({ type: PersonRefDto, nullable: true, description: 'Null for my own orders' })
  company!: PersonRefDto | null;

  @ApiProperty({
    type: SuggestionLastOrderDto,
    description: 'The SKU’s last order — reorder it with `store.claims.reorder` (D-153)',
  })
  lastOrder!: SuggestionLastOrderDto;

  @ApiProperty({ type: 'integer', example: 3, description: 'Orders of the SKU so far' })
  orderCount!: number;

  @ApiProperty({ example: '30.00', description: 'Simple moving average of the recent order intervals, days' })
  averageIntervalDays!: string;

  @ApiProperty({
    type: 'integer',
    example: 10,
    description: 'Placement → delivery of the last delivered order',
  })
  lastLeadTimeDays!: number;

  @ApiProperty({ format: 'date', example: '2026-11-01', description: 'When the next order is likely needed' })
  nextNeedOn!: string;

  @ApiProperty({
    format: 'date',
    example: '2026-10-15',
    description: 'Next need − last lead time − `reorder.safety_stock_days` (D-288)',
  })
  suggestedOn!: string;

  @ApiProperty({
    type: 'integer',
    example: 1500,
    description: 'Mean quantity of the orders the intervals span',
  })
  suggestedQuantity!: number;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T02:30:00+07:00' })
  computedAt!: string;
}

export class AdminReorderSuggestionDto extends ReorderSuggestionDto {
  @ApiProperty({
    type: UserRefDto,
    nullable: true,
    description: 'The customer (own orders); null for a company',
  })
  customer!: UserRefDto | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  contactedAt!: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true, example: null })
  contactedBy!: UserRefDto | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  contactNote!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description:
      'The marketing reminder of this cycle was sent to the router (consent and quiet hours, D-144)',
  })
  remindedAt!: string | null;
}

export const SUGGESTION_EXAMPLE: ReorderSuggestionDto = {
  id: SUGGESTION_IDS.suggestion,
  status: 'open',
  productType: {
    id: '0192f3a0-7c1e-7d2a-9b1f-0000000e7205',
    code: 'folding_carton',
    nameTh: 'กล่องกระดาษพับ',
    nameEn: 'Folding carton',
  },
  company: null,
  lastOrder: { orderId: SUGGESTION_IDS.order, orderCode: 'PK-2610-0001-01', quantity: 1000, unit: 'piece' },
  orderCount: 3,
  averageIntervalDays: '30.00',
  lastLeadTimeDays: 10,
  nextNeedOn: '2026-11-01',
  suggestedOn: '2026-10-15',
  suggestedQuantity: 1500,
  computedAt: '2026-10-03T02:30:00+07:00',
};

export const ADMIN_SUGGESTION_EXAMPLE: AdminReorderSuggestionDto = {
  ...SUGGESTION_EXAMPLE,
  customer: { id: SUGGESTION_IDS.customer, displayName: 'ลูกค้า ทดสอบ' },
  contactedAt: null,
  contactedBy: null,
  contactNote: null,
  remindedAt: null,
};

export class ReorderSuggestionQuery extends PageQuery {
  @EnumField(SUGGESTION_STATUSES, 'ReorderSuggestionStatus', {
    example: 'open',
    optional: true,
    description: 'Default `open`',
  })
  status?: (typeof SUGGESTION_STATUSES)[number];

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-15',
    description: 'Suggested on or before this date',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  dueBy?: string;
}
