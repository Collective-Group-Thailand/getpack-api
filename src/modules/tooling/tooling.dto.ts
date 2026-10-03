import { CodedRefDto } from '@common/dto/factory-ref.dto';
import { PageQuery } from '@common/pagination/pagination.dto';
import { OrderRefDto } from '@modules/carts/carts.dto';
import { EnumField, RefField, TextField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty } from '@nestjs/swagger';

export const TOOLING_KINDS = ['plates', 'die_block'] as const;
export const TOOLING_STATUSES = ['active', 'unusable'] as const;

export const TOOLING_IDS = {
  tooling: '0192f3a0-7c1e-7d2a-9b1f-0000000e7101',
  remake: '0192f3a0-7c1e-7d2a-9b1f-0000000e7102',
  job: '0192f3a0-7c1e-7d2a-9b1f-0000000e7103',
  factory: '0192f3a0-7c1e-7d2a-9b1f-0000000d1003',
  order: '0192f3a0-7c1e-7d2a-9b1f-0000000f1002',
} as const;

export class ToolingRemakeDto {
  @ApiProperty({ format: 'uuid', example: TOOLING_IDS.remake })
  id!: string;

  @ApiProperty({ format: 'uuid', example: TOOLING_IDS.tooling })
  toolingId!: string;

  @ApiProperty({ format: 'uuid', example: TOOLING_IDS.job })
  productionJobId!: string;

  @ApiProperty({ example: 'Die block warped in storage; cutting lines no longer close' })
  reason!: string;

  @ApiProperty({
    example: '2500.00',
    description: 'The remake at the job’s price list, net of VAT, paid with the job’s goods receipt (D-205)',
  })
  buyNetAmount!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T10:00:00+07:00' })
  reportedAt!: string;
}

/** D-289 a register entry: plates or a die block kept at the factory that made them. */
export class ToolingItemDto {
  @ApiProperty({ format: 'uuid', example: TOOLING_IDS.tooling })
  id!: string;

  @ApiProperty({ enum: TOOLING_KINDS, enumName: 'ToolingKind', example: 'die_block' })
  kind!: (typeof TOOLING_KINDS)[number];

  @ApiProperty({
    enum: TOOLING_STATUSES,
    enumName: 'ToolingStatus',
    example: 'active',
    description:
      '`unusable` once the factory reported it at acceptance; active again when the remade tool is delivered',
  })
  status!: (typeof TOOLING_STATUSES)[number];

  @ApiProperty({ type: CodedRefDto, description: 'The factory keeping it (location, D-205)' })
  factory!: CodedRefDto;

  @ApiProperty({ type: OrderRefDto, description: 'The order that paid for it' })
  sourceOrder!: OrderRefDto;

  @ApiProperty({ type: OrderRefDto, description: 'The last delivered order that used it' })
  lastOrder!: OrderRefDto;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T15:00:00+07:00' })
  lastUsedAt!: string;

  @ApiProperty({
    format: 'date-time',
    example: '2027-10-01T15:00:00+07:00',
    description: 'Last use + `tooling.reuse_months` (D-289): a reorder at this factory waives it until then',
  })
  reusableUntil!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Plates: the sha256 (hex) of the approved artwork they print; null for a die block',
  })
  artworkSha256!: string | null;

  @ApiProperty({ type: [ToolingRemakeDto], description: 'Remakes Packio absorbed (D-205), newest first' })
  remakes!: ToolingRemakeDto[];

  @ApiProperty({ format: 'date-time', example: '2026-10-01T15:00:00+07:00' })
  createdAt!: string;
}

export const TOOLING_EXAMPLE: ToolingItemDto = {
  id: TOOLING_IDS.tooling,
  kind: 'die_block',
  status: 'active',
  factory: { id: TOOLING_IDS.factory, code: 'F0001', name: 'โรงพิมพ์ ทดสอบ' },
  sourceOrder: { orderId: TOOLING_IDS.order, orderCode: 'PK-2610-0001-01' },
  lastOrder: { orderId: TOOLING_IDS.order, orderCode: 'PK-2610-0001-01' },
  lastUsedAt: '2026-10-01T15:00:00+07:00',
  reusableUntil: '2027-10-01T15:00:00+07:00',
  artworkSha256: null,
  remakes: [],
  createdAt: '2026-10-01T15:00:00+07:00',
};

export const REMAKE_EXAMPLE: ToolingRemakeDto = {
  id: TOOLING_IDS.remake,
  toolingId: TOOLING_IDS.tooling,
  productionJobId: TOOLING_IDS.job,
  reason: 'Die block warped in storage; cutting lines no longer close',
  buyNetAmount: '2500.00',
  reportedAt: '2026-10-03T10:00:00+07:00',
};

export class AdminToolingQuery extends PageQuery {
  @RefField({ example: TOOLING_IDS.factory, optional: true })
  factoryId?: string;

  @EnumField(TOOLING_KINDS, 'ToolingKind', { example: 'die_block', optional: true })
  kind?: (typeof TOOLING_KINDS)[number];

  @EnumField(TOOLING_STATUSES, 'ToolingStatus', { example: 'active', optional: true })
  status?: (typeof TOOLING_STATUSES)[number];
}

export class ReportToolingUnusableDto {
  @RefField({ example: TOOLING_IDS.tooling, description: 'A register entry the job reuses' })
  toolingId!: string;

  @TextField({ example: 'Die block warped in storage; cutting lines no longer close', max: 1000 })
  reason!: string;
}
