import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

/** Fixed assets (B5.5, D-150). Money: strings, THB. */

const MONEY = /^\d{1,12}\.\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ACCOUNT = /^[0-9A-Z][0-9A-Z.-]*$/;
export const ASSET_STATUSES = ['active', 'fully_depreciated', 'disposed', 'written_off'] as const;
export const ASSET_SOURCES = ['manual', 'vendor_bill'] as const;

export const FA_IDS = {
  category: '0192f3a0-7c1e-7d2a-9b1f-000000550001',
  asset: '0192f3a0-7c1e-7d2a-9b1f-000000550002',
  run: '0192f3a0-7c1e-7d2a-9b1f-000000550003',
  invoice: '0192f3a0-7c1e-7d2a-9b1f-000000530004',
  user: '0192f3a0-7c1e-7d2a-9b1f-000000000101',
};

export class AssetCategoryDto {
  @ApiProperty({ format: 'uuid', example: FA_IDS.category })
  id!: string;

  @ApiProperty({ example: 'computers' })
  code!: string;

  @ApiProperty({ example: 'คอมพิวเตอร์และอุปกรณ์ไอที' })
  nameTh!: string;

  @ApiProperty({ example: 'Computers & IT equipment' })
  nameEn!: string;

  @ApiProperty({ type: 'integer', example: 36, description: 'Useful life (months) — snapshot on each asset registered' })
  usefulLifeMonths!: number;

  @ApiProperty({ enum: ['straight_line'], enumName: 'DepreciationMethod', example: 'straight_line' })
  method!: string;

  @ApiProperty({ example: '1520' })
  assetAccountCode!: string;

  @ApiProperty({ example: '1521' })
  accumulatedAccountCode!: string;

  @ApiProperty({ example: '6150' })
  expenseAccountCode!: string;

  @ApiProperty({ example: '6910' })
  gainLossAccountCode!: string;

  @ApiProperty({ enum: ['active', 'inactive'], enumName: 'CapabilityStatus', example: 'active' })
  status!: string;

  @ApiProperty({ type: 'integer', example: 1, description: 'Send back in `If-Match` (as the ETag) to update' })
  rowVersion!: number;
}

export const CATEGORY_EXAMPLE: AssetCategoryDto = {
  id: FA_IDS.category,
  code: 'computers',
  nameTh: 'คอมพิวเตอร์และอุปกรณ์ไอที',
  nameEn: 'Computers & IT equipment',
  usefulLifeMonths: 36,
  method: 'straight_line',
  assetAccountCode: '1520',
  accumulatedAccountCode: '1521',
  expenseAccountCode: '6150',
  gainLossAccountCode: '6910',
  status: 'active',
  rowVersion: 1,
};

export class CreateAssetCategoryDto {
  @ApiProperty({ example: 'computers', pattern: '^[a-z0-9][a-z0-9_-]{0,39}$' })
  @Matches(/^[a-z0-9][a-z0-9_-]{0,39}$/)
  code!: string;

  @ApiProperty({ example: 'คอมพิวเตอร์และอุปกรณ์ไอที' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  nameTh!: string;

  @ApiProperty({ example: 'Computers & IT equipment' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  nameEn!: string;

  @ApiProperty({ type: 'integer', example: 36, minimum: 1, maximum: 1200, description: 'Set by Finance with the CPA (⚖)' })
  @IsInt()
  @Min(1)
  @Max(1200)
  usefulLifeMonths!: number;

  @ApiProperty({ example: '1520', description: 'Postable investing asset account' })
  @Matches(ACCOUNT)
  assetAccountCode!: string;

  @ApiProperty({ example: '1521', description: 'Contra-asset (credit) account' })
  @Matches(ACCOUNT)
  accumulatedAccountCode!: string;

  @ApiProperty({ example: '6150', description: 'Expense account' })
  @Matches(ACCOUNT)
  expenseAccountCode!: string;

  @ApiProperty({ example: '6910', description: 'Expense or revenue account for gain / loss on disposal' })
  @Matches(ACCOUNT)
  gainLossAccountCode!: string;
}

export class UpdateAssetCategoryDto {
  @ApiPropertyOptional({ example: 'คอมพิวเตอร์' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  nameTh?: string;

  @ApiPropertyOptional({ example: 'Computers' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  nameEn?: string;

  @ApiPropertyOptional({ type: 'integer', example: 60, description: 'Applies to assets registered afterwards' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1200)
  usefulLifeMonths?: number;

  @ApiPropertyOptional({ enum: ['active', 'inactive'], enumName: 'CapabilityStatus' })
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}

export class FixedAssetDto {
  @ApiProperty({ format: 'uuid', example: FA_IDS.asset })
  id!: string;

  @ApiProperty({ example: 'DEVFA-00001' })
  assetNo!: string;

  @ApiProperty({ format: 'uuid', example: FA_IDS.category })
  categoryId!: string;

  @ApiProperty({ example: 'computers' })
  categoryCode!: string;

  @ApiProperty({ example: 'โน้ตบุ๊กฝ่ายบัญชี (fake)' })
  name!: string;

  @ApiProperty({ enum: ASSET_SOURCES, enumName: 'AssetSource', example: 'manual' })
  source!: string;

  @ApiProperty({ format: 'date', example: '2026-10-01' })
  acquiredOn!: string;

  @ApiProperty({ format: 'date', example: '2026-10-01', description: 'First month depreciated' })
  depreciationStartOn!: string;

  @ApiProperty({ example: '36000.00' })
  cost!: string;

  @ApiProperty({ example: '0.00' })
  residualValue!: string;

  @ApiProperty({ type: 'integer', example: 36 })
  usefulLifeMonths!: number;

  @ApiProperty({ example: '1000.00' })
  accumulatedDepreciation!: string;

  @ApiProperty({ example: '35000.00' })
  netBookValue!: string;

  @ApiProperty({ example: '1520' })
  assetAccountCode!: string;

  @ApiProperty({ type: String, nullable: true, example: '2410' })
  creditAccountCode!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  vendorInvoiceId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'สำนักงานกรุงเทพ' })
  location!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: FA_IDS.user })
  custodianUserId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  costCentreCode!: string | null;

  @ApiProperty({ enum: ASSET_STATUSES, enumName: 'AssetStatus', example: 'active' })
  status!: string;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: null })
  disposedOn!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  disposalProceeds!: string | null;
}

export const ASSET_EXAMPLE: FixedAssetDto = {
  id: FA_IDS.asset,
  assetNo: 'DEVFA-00001',
  categoryId: FA_IDS.category,
  categoryCode: 'computers',
  name: 'โน้ตบุ๊กฝ่ายบัญชี (fake)',
  source: 'manual',
  acquiredOn: '2026-10-01',
  depreciationStartOn: '2026-10-01',
  cost: '36000.00',
  residualValue: '0.00',
  usefulLifeMonths: 36,
  accumulatedDepreciation: '1000.00',
  netBookValue: '35000.00',
  assetAccountCode: '1520',
  creditAccountCode: '2410',
  vendorInvoiceId: null,
  location: 'สำนักงานกรุงเทพ',
  custodianUserId: FA_IDS.user,
  costCentreCode: null,
  status: 'active',
  disposedOn: null,
  disposalProceeds: null,
};

export class RegisterAssetDto {
  @ApiProperty({ format: 'uuid', example: FA_IDS.category })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ example: 'โน้ตบุ๊กฝ่ายบัญชี (fake)' })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  name!: string;

  @ApiProperty({ format: 'date', example: '2026-10-01' })
  @Matches(DAY)
  acquiredOn!: string;

  @ApiProperty({ example: '36000.00', pattern: MONEY.source, description: 'Cost excluding recoverable VAT' })
  @Matches(MONEY)
  cost!: string;

  @ApiPropertyOptional({ example: '0.00', pattern: MONEY.source })
  @IsOptional()
  @Matches(MONEY)
  residualValue?: string;

  @ApiProperty({ enum: ASSET_SOURCES, enumName: 'AssetSource', example: 'manual', description: '`vendor_bill`: already capitalised by the bill (P25); `manual`: FA01 against `creditAccountCode`' })
  @IsIn(ASSET_SOURCES)
  source!: (typeof ASSET_SOURCES)[number];

  @ApiPropertyOptional({ format: 'uuid', description: 'Required for `vendor_bill`: the bill with the asset line' })
  @IsOptional()
  @IsUUID()
  vendorInvoiceId?: string;

  @ApiPropertyOptional({ example: '2410', description: 'Required for `manual`: the account credited (not a control account)' })
  @IsOptional()
  @Matches(ACCOUNT)
  creditAccountCode?: string;

  @ApiPropertyOptional({ example: 'สำนักงานกรุงเทพ' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'The staff member holding the asset' })
  @IsOptional()
  @IsUUID()
  custodianUserId?: string;

  @ApiPropertyOptional({ example: 'ops' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  costCentreCode?: string;
}

export class DisposeAssetDto {
  @ApiProperty({ enum: ['sold', 'written_off'], enumName: 'AssetDisposalKind', example: 'sold' })
  @IsIn(['sold', 'written_off'])
  kind!: 'sold' | 'written_off';

  @ApiProperty({ format: 'date', example: '2027-06-30' })
  @Matches(DAY)
  disposedOn!: string;

  @ApiPropertyOptional({ example: '15000.00', pattern: MONEY.source, description: 'Sold only (net of VAT)' })
  @IsOptional()
  @Matches(MONEY)
  proceeds?: string;

  @ApiPropertyOptional({ example: '1121', description: 'Where the proceeds went (an asset account) when there are any' })
  @IsOptional()
  @Matches(ACCOUNT)
  proceedsAccountCode?: string;

  @ApiProperty({ example: 'ขายเครื่องเก่า (fake)' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class AssetListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ASSET_STATUSES, enumName: 'AssetStatus' })
  @IsOptional()
  @IsIn(ASSET_STATUSES)
  status?: (typeof ASSET_STATUSES)[number];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

export class DepreciationLineDto {
  @ApiProperty({ example: '2026-10' })
  period!: string;

  @ApiProperty({ example: '1000.00' })
  amount!: string;

  @ApiProperty({ example: '1000.00' })
  accumulatedAfter!: string;

  @ApiProperty({ format: 'uuid', example: FA_IDS.run })
  runId!: string;
}

export class DepreciationRunDto {
  @ApiProperty({ format: 'uuid', example: FA_IDS.run })
  id!: string;

  @ApiProperty({ example: '2026-10' })
  period!: string;

  @ApiProperty({ format: 'date', example: '2026-10-31' })
  runOn!: string;

  @ApiProperty({ example: '1000.00' })
  totalAmount!: string;

  @ApiProperty({ type: 'integer', example: 1 })
  assetCount!: number;
}

export const RUN_EXAMPLE: DepreciationRunDto = { id: FA_IDS.run, period: '2026-10', runOn: '2026-10-31', totalAmount: '1000.00', assetCount: 1 };

export class RollForwardQuery {
  @ApiProperty({ example: '2026-10', pattern: MONTH.source })
  @Matches(MONTH)
  from!: string;

  @ApiProperty({ example: '2026-12', pattern: MONTH.source })
  @Matches(MONTH)
  to!: string;
}

export class RollForwardCategoryDto {
  @ApiProperty({ example: 'computers' })
  category!: string;

  @ApiProperty({ example: 'คอมพิวเตอร์และอุปกรณ์ไอที' })
  name!: string;

  @ApiProperty({ example: '0.00' })
  openingCost!: string;

  @ApiProperty({ example: '36000.00' })
  additions!: string;

  @ApiProperty({ example: '0.00' })
  disposalsCost!: string;

  @ApiProperty({ example: '36000.00' })
  closingCost!: string;

  @ApiProperty({ example: '0.00' })
  openingAccumulated!: string;

  @ApiProperty({ example: '3000.00' })
  depreciation!: string;

  @ApiProperty({ example: '0.00' })
  disposalsAccumulated!: string;

  @ApiProperty({ example: '3000.00' })
  closingAccumulated!: string;

  @ApiProperty({ example: '33000.00' })
  netBookValue!: string;
}

export class AssetReconciliationDto {
  @ApiProperty({ example: '1520' })
  accountCode!: string;

  @ApiProperty({ example: '36000.00', description: 'Register (cost debit-positive; accumulated credit-negative)' })
  register!: string;

  @ApiProperty({ example: '36000.00' })
  gl!: string;

  @ApiProperty({ example: '0.00', description: 'Must be 0 (§7 step 8)' })
  difference!: string;
}

export class RollForwardDto {
  @ApiProperty({ example: '2026-10' })
  from!: string;

  @ApiProperty({ example: '2026-12' })
  to!: string;

  @ApiProperty({ type: [RollForwardCategoryDto] })
  categories!: RollForwardCategoryDto[];

  @ApiProperty({ type: [AssetReconciliationDto] })
  reconciliation!: AssetReconciliationDto[];
}

export const ROLL_EXAMPLE: RollForwardDto = {
  from: '2026-10',
  to: '2026-12',
  categories: [
    {
      category: 'computers',
      name: 'คอมพิวเตอร์และอุปกรณ์ไอที',
      openingCost: '0.00',
      additions: '36000.00',
      disposalsCost: '0.00',
      closingCost: '36000.00',
      openingAccumulated: '0.00',
      depreciation: '3000.00',
      disposalsAccumulated: '0.00',
      closingAccumulated: '3000.00',
      netBookValue: '33000.00',
    },
  ],
  reconciliation: [
    { accountCode: '1520', register: '36000.00', gl: '36000.00', difference: '0.00' },
    { accountCode: '1521', register: '-3000.00', gl: '-3000.00', difference: '0.00' },
  ],
};
