import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty } from '@nestjs/swagger';

import { STORAGE_ACCOUNT_TYPES, type StorageAccountType } from './storage-settings';

export const QUOTA_LEVELS = ['ok', 'warning', 'full', 'over'] as const;
export type QuotaLevelName = (typeof QUOTA_LEVELS)[number];

export class StorageRecordCountDto {
  @ApiProperty({ example: 'sales_invoice', description: 'Record type (D-436 counted records)' })
  type!: string;

  @ApiProperty({ type: 'integer', example: 1203 })
  count!: number;

  @ApiProperty({
    type: 'integer',
    example: 2048,
    description: 'Counted size of one record (`storage.record_bytes`)',
  })
  bytesEach!: number;
}

export class StoragePackDto {
  @ApiProperty({ example: 'plus-20' })
  key!: string;

  @ApiProperty({ example: '20', description: 'Size in GB (decimal string)' })
  gb!: string;

  @ApiProperty({ example: '49.00', description: 'Monthly price in THB (decimal string)' })
  monthlyPrice!: string;
}

/** A factory's storage against its free allowance (D-436). */
export class StorageUsageDto {
  @ApiProperty({ enum: STORAGE_ACCOUNT_TYPES, enumName: 'StorageAccountType', example: 'factory' })
  accountType!: StorageAccountType;

  @ApiProperty({
    format: 'date-time',
    example: '2026-10-25T09:30:00+07:00',
    description: 'When this was measured (Asia/Bangkok)',
  })
  asOf!: string;

  @ApiProperty({ type: 'integer', example: 1_610_612_736, description: 'Files + counted records, bytes' })
  usedBytes!: number;

  @ApiProperty({ type: 'integer', example: 1_598_029_824, description: 'Live files the account owns, bytes' })
  fileBytes!: number;

  @ApiProperty({ type: 'integer', example: 12_582_912, description: 'Records at their counted size, bytes' })
  recordBytes!: number;

  @ApiProperty({ type: [StorageRecordCountDto] })
  records!: StorageRecordCountDto[];

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 5_368_709_120,
    description: 'Free allowance plus packs, bytes; null while no allowance is set for the account type',
  })
  allowanceBytes!: number | null;

  @ApiProperty({ nullable: true, example: '30.0', description: 'Used ÷ allowance in percent, one decimal' })
  usedPct!: string | null;

  @ApiProperty({ enum: QUOTA_LEVELS, enumName: 'StorageQuotaLevel', nullable: true, example: 'ok' })
  level!: QuotaLevelName | null;

  @ApiProperty({ nullable: true, example: '5', description: 'Free allowance in GB (`storage.free_gb`)' })
  freeGb!: string | null;

  @ApiProperty({
    nullable: true,
    example: null,
    description:
      'THB per GB-month above the allowance (`storage.price_per_gb_month`); null = overage not sold',
  })
  pricePerGbMonth!: string | null;

  @ApiProperty({ type: [Number], example: [80, 100], description: 'Usage percentages that send a notice' })
  noticeAtPercent!: number[];

  @ApiProperty({ type: [StoragePackDto], description: 'Add-on packs offered (`storage.packs`)' })
  packs!: StoragePackDto[];
}

export const STORAGE_USAGE_EXAMPLE: StorageUsageDto = {
  accountType: 'factory',
  asOf: '2026-10-25T09:30:00+07:00',
  usedBytes: 1_610_612_736,
  fileBytes: 1_598_029_824,
  recordBytes: 12_582_912,
  records: [
    { type: 'sales_invoice', count: 1203, bytesEach: 2048 },
    { type: 'stock_movement', count: 39_520, bytesEach: 256 },
  ],
  allowanceBytes: 5_368_709_120,
  usedPct: '30.0',
  level: 'ok',
  freeGb: '5',
  pricePerGbMonth: null,
  noticeAtPercent: [80, 100],
  packs: [],
};

/** One account's latest daily snapshot (admin console, D-436). */
export class StorageAccountDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000f0001' })
  factoryId!: string;

  @ApiProperty({ example: 'F0001' })
  factoryCode!: string;

  @ApiProperty({ example: 'โรงพิมพ์ตัวอย่าง' })
  factoryName!: string;

  @ApiProperty({ format: 'date', example: '2026-10-25', description: 'Snapshot day (Asia/Bangkok)' })
  day!: string;

  @ApiProperty({ type: 'integer', example: 1_610_612_736 })
  usedBytes!: number;

  @ApiProperty({ type: 'integer', example: 1_598_029_824 })
  fileBytes!: number;

  @ApiProperty({ type: 'integer', nullable: true, example: 5_368_709_120 })
  allowanceBytes!: number | null;

  @ApiProperty({ nullable: true, example: '30.0' })
  usedPct!: string | null;

  @ApiProperty({ type: 'integer', example: 41_877, description: 'Records counted, all types' })
  records!: number;
}

export const STORAGE_ACCOUNT_EXAMPLE: StorageAccountDto = {
  factoryId: '0192f3a0-7c1e-7d2a-9b1f-0000000f0001',
  factoryCode: 'F0001',
  factoryName: 'โรงพิมพ์ตัวอย่าง',
  day: '2026-10-25',
  usedBytes: 1_610_612_736,
  fileBytes: 1_598_029_824,
  allowanceBytes: 5_368_709_120,
  usedPct: '30.0',
  records: 41_877,
};

export class StorageAccountListQuery extends PageQuery {}

/** The storage line of a month's platform invoice (D-436). */
export class StorageChargeDto {
  @ApiProperty({ example: '2026-10' })
  month!: string;

  @ApiProperty({ type: 'integer', example: 31, description: 'Days of the month counted' })
  days!: number;

  @ApiProperty({
    example: '0.250',
    description: 'Average use above the allowance, GB-months (three decimals)',
  })
  overageGbMonths!: string;

  @ApiProperty({ example: '0.00', description: 'THB; 0 while overage is not sold' })
  overageAmount!: string;

  @ApiProperty({ example: '0.00', description: 'THB, packs bought' })
  packsAmount!: string;

  @ApiProperty({ example: '0.00', description: 'THB, the invoice line (before VAT)' })
  total!: string;
}

export const STORAGE_CHARGE_EXAMPLE: StorageChargeDto = {
  month: '2026-10',
  days: 31,
  overageGbMonths: '0.000',
  overageAmount: '0.00',
  packsAmount: '0.00',
  total: '0.00',
};
