import { CodedRefDto } from '@common/dto/factory-ref.dto';
import { NextActionDto } from '@common/next-actions/next-action.dto';
import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Packio Factory ERP, phase E1 (docs/prompts/E1-factory-erp.md): trading partners, items, warehouses, stock,
 * purchase orders and goods receipts. Factory-private (D-317). Quantities are decimal strings with 3 places,
 * unit prices and costs 6, money 2 (`currency` THB).
 */

export const ERP_PARTNER_KINDS = ['supplier', 'customer', 'both'] as const;
export const ERP_RECORD_STATUSES = ['active', 'archived'] as const;
export const ERP_ITEM_KINDS = [
  'raw_material',
  'consumable',
  'spare_part',
  'semi_finished',
  'finished_good',
  'packing',
] as const;
export const ERP_UNITS = [
  'kg',
  'g',
  'ton',
  'sheet',
  'ream',
  'roll',
  'm',
  'm2',
  'pcs',
  'box',
  'pack',
  'set',
  'l',
  'ml',
] as const;
export const ERP_MOVEMENT_KINDS = [
  'opening',
  'receipt',
  'issue',
  'return',
  'adjustment',
  'count',
  'transfer_out',
  'transfer_in',
  'production_issue',
  'production_return',
  'production_receipt',
] as const;
export const ERP_VAT_MODES = ['exclusive', 'inclusive', 'none'] as const;
export const ERP_PO_STATUSES = [
  'draft',
  'issued',
  'partially_received',
  'received',
  'closed',
  'cancelled',
] as const;
export const ERP_MODULES = [
  'inventory',
  'procurement',
  'partners',
  'planning',
  'floor',
  'sales',
  'accounting',
  'maintenance',
  'documents',
] as const;

export type ErpUnitValue = (typeof ERP_UNITS)[number];

/** A quantity: up to 11 integer digits and 3 decimals; signed where stated. */
export const QTY = /^\d{1,11}(\.\d{1,3})?$/;
export const SIGNED_QTY = /^-?\d{1,11}(\.\d{1,3})?$/;
/** A unit price or cost: up to 12 integer digits and 6 decimals. */
export const PRICE = /^\d{1,12}(\.\d{1,6})?$/;
/** Money with up to 2 decimals. */
export const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
/** A percentage 0–100 with up to 4 decimals. */
export const PCT = /^\d{1,3}(\.\d{1,4})?$/;
export const DAY = /^\d{4}-\d{2}-\d{2}$/;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;

export const ERP_IDS = {
  factory: '0192f3a0-7c1e-7d2a-9b1f-000000000f01',
  supplier: '0192f3a0-7c1e-7d2a-9b1f-00000000e001',
  item: '0192f3a0-7c1e-7d2a-9b1f-00000000e101',
  warehouse: '0192f3a0-7c1e-7d2a-9b1f-00000000e201',
  movement: '0192f3a0-7c1e-7d2a-9b1f-00000000e301',
  po: '0192f3a0-7c1e-7d2a-9b1f-00000000e401',
  poLine: '0192f3a0-7c1e-7d2a-9b1f-00000000e402',
  gr: '0192f3a0-7c1e-7d2a-9b1f-00000000e501',
  material: '0192f3a0-7c1e-7d2a-9b1f-000000000a01',
} as const;

// --------------------------------------------------------------------------------------- refs

/** `{ id, code, name }` — the shared coded reference (one component for all modules). */
export const ErpRefDto = CodedRefDto;
export type ErpRefDto = CodedRefDto;

export class ErpItemRefDto {
  @ApiProperty({ format: 'uuid', example: ERP_IDS.item })
  id!: string;

  @ApiProperty({ example: 'PAP-KA-350' })
  sku!: string;

  @ApiProperty({ example: 'กระดาษคราฟท์ 350 แกรม' })
  name!: string;

  @ApiProperty({ enum: ERP_ITEM_KINDS, enumName: 'ErpItemKind', example: 'raw_material' })
  kind!: string;

  @ApiProperty({ enum: ERP_UNITS, enumName: 'ErpUnit', example: 'sheet' })
  baseUnit!: string;
}

// ------------------------------------------------------------------------------------ settings

export class ErpSettingsDto {
  @ApiProperty({
    enum: ERP_MODULES,
    enumName: 'ErpModule',
    isArray: true,
    example: ['inventory', 'procurement', 'partners'],
    description:
      'Modules switched on for this factory (D-318); everything is on unless the owner turned it off',
  })
  modules!: string[];

  @ApiProperty({ example: false, description: 'Allow issues beyond the stock on hand (D-322)' })
  allowNegativeStock!: boolean;

  @ApiProperty({
    example: '10.0000',
    description: 'How much more than ordered a receipt may take, % (D-325)',
  })
  overReceiptPct!: string;

  @ApiProperty({
    example: '2.0000',
    description: 'A supplier invoice priced within this % of the order matches (3-way match, D-337)',
  })
  priceTolerancePct!: string;

  @ApiProperty({
    example: true,
    description: 'Purchase requests wait for an approver (D-336); off → approved when submitted',
  })
  requireRequestApproval!: boolean;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: {
      po: 'PO',
      gr: 'GR',
      adj: 'ADJ',
      trf: 'TRF',
      iss: 'ISS',
      pr: 'PR',
      ap: 'AP',
      pv: 'PV',
      mo: 'MO',
    },
    description: 'Document number prefixes by document type (D-323)',
  })
  prefixes!: Record<string, string>;

  @ApiProperty({
    example: true,
    description: 'Whether the factory is VAT-registered (stock cost excludes VAT, D-321)',
  })
  vatRegistered!: boolean;

  @ApiProperty({ example: 1 })
  version!: number;
}

export class UpdateErpSettingsDto {
  @ApiPropertyOptional({
    enum: ERP_MODULES,
    enumName: 'ErpModule',
    isArray: true,
    example: ['inventory', 'procurement'],
  })
  @IsOptional()
  @IsArray()
  @IsIn(ERP_MODULES, { each: true })
  modules?: string[];

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  allowNegativeStock?: boolean;

  @ApiPropertyOptional({ example: '5', pattern: PCT.source })
  @IsOptional()
  @Matches(PCT)
  overReceiptPct?: string;

  @ApiPropertyOptional({ example: '2', pattern: PCT.source })
  @IsOptional()
  @Matches(PCT)
  priceTolerancePct?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  requireRequestApproval?: boolean;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string', pattern: '^[A-Z0-9]{1,6}$' },
    example: { po: 'PO' },
  })
  @IsOptional()
  prefixes?: Record<string, string>;
}

// ----------------------------------------------------------------------------- trading partners

export class ErpTradingPartnerDto {
  @ApiProperty({ format: 'uuid', example: ERP_IDS.supplier })
  id!: string;

  @ApiProperty({ example: 'S0001' })
  code!: string;

  @ApiProperty({ enum: ERP_PARTNER_KINDS, enumName: 'ErpPartnerKind', example: 'supplier' })
  kind!: string;

  @ApiProperty({ example: 'บจก. กระดาษไทย (ทดสอบ)' })
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: '0000500000001' })
  taxId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '00000' })
  branchCode!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'คุณสมชาย ทดสอบ' })
  contactName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '020000000' })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'sales@supplier.example.invalid' })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '99 ถนนทดสอบ แขวงทดสอบ เขตทดสอบ กรุงเทพฯ 10000' })
  address!: string | null;

  @ApiProperty({ example: 30 })
  paymentTermDays!: number;

  @ApiProperty({ type: String, nullable: true, example: '500000.00' })
  creditLimit!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ enum: ERP_RECORD_STATUSES, enumName: 'BrandKitStatus', example: 'active' })
  status!: string;

  @ApiProperty({ example: 1 })
  version!: number;

  @ApiProperty({ format: 'date-time', example: '2026-10-10T09:00:00+07:00' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-10T09:00:00+07:00' })
  updatedAt!: string;
}

export class ErpCreateTradingPartnerDto {
  @ApiPropertyOptional({
    example: 'S0001',
    maxLength: 20,
    description: 'Unique in the factory; omitted → the next `S0001` / `C0001` / `P0001` by kind',
  })
  @IsOptional()
  @Transform(trim)
  @Matches(/^[A-Za-z0-9-_]{1,20}$/)
  code?: string;

  @ApiProperty({ enum: ERP_PARTNER_KINDS, enumName: 'ErpPartnerKind', example: 'supplier' })
  @IsIn(ERP_PARTNER_KINDS)
  kind!: string;

  @ApiProperty({ example: 'บจก. กระดาษไทย (ทดสอบ)', maxLength: 200 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '0000500000001', pattern: '^\\d{13}$' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(/^\d{13}$/)
  taxId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '00000', pattern: '^\\d{5}$' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(/^\d{5}$/)
  branchCode?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'คุณสมชาย ทดสอบ', maxLength: 120 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(120)
  contactName?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '020000000', maxLength: 30 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'sales@supplier.example.invalid' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsEmail()
  email?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '99 ถนนทดสอบ กรุงเทพฯ 10000',
    maxLength: 500,
  })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @ApiPropertyOptional({ example: 30, minimum: 0, maximum: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermDays?: number;

  @ApiPropertyOptional({ type: String, nullable: true, example: '500000.00', pattern: AMOUNT.source })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(AMOUNT)
  creditLimit?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 1000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class ErpUpdateTradingPartnerDto {
  @ApiPropertyOptional({ enum: ERP_PARTNER_KINDS, enumName: 'ErpPartnerKind', example: 'both' })
  @IsOptional()
  @IsIn(ERP_PARTNER_KINDS)
  kind?: string;

  @ApiPropertyOptional({ example: 'บจก. กระดาษไทย (ทดสอบ)', maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '0000500000001' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(/^\d{13}$/)
  taxId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '00000' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(/^\d{5}$/)
  branchCode?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'คุณสมชาย ทดสอบ' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(120)
  contactName?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '020000000' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'sales@supplier.example.invalid' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsEmail()
  email?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '99 ถนนทดสอบ กรุงเทพฯ 10000' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @ApiPropertyOptional({ example: 45 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermDays?: number;

  @ApiPropertyOptional({ type: String, nullable: true, example: '500000.00' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(AMOUNT)
  creditLimit?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @ApiPropertyOptional({ enum: ERP_RECORD_STATUSES, enumName: 'BrandKitStatus', example: 'archived' })
  @IsOptional()
  @IsIn(ERP_RECORD_STATUSES)
  status?: string;
}

export class ErpTradingPartnerListQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: ['supplier', 'customer'],
    enumName: 'ErpPartnerRole',
    description: '`supplier` lists suppliers and both; `customer` lists customers and both',
  })
  @IsOptional()
  @IsIn(['supplier', 'customer'])
  role?: 'supplier' | 'customer';

  @ApiPropertyOptional({ enum: ERP_RECORD_STATUSES, enumName: 'BrandKitStatus', default: 'active' })
  @IsOptional()
  @IsIn(ERP_RECORD_STATUSES)
  status?: string;
}

// ----------------------------------------------------------------------------------- warehouses

export class ErpWarehouseDto {
  @ApiProperty({ format: 'uuid', example: ERP_IDS.warehouse })
  id!: string;

  @ApiProperty({ example: 'MAIN' })
  code!: string;

  @ApiProperty({ example: 'คลังหลัก' })
  name!: string;

  @ApiProperty({ example: true })
  isDefault!: boolean;

  @ApiProperty({ enum: ERP_RECORD_STATUSES, enumName: 'BrandKitStatus', example: 'active' })
  status!: string;

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ErpCreateWarehouseDto {
  @ApiProperty({ example: 'WH2', pattern: '^[A-Za-z0-9-_]{1,20}$' })
  @Transform(trim)
  @Matches(/^[A-Za-z0-9-_]{1,20}$/)
  code!: string;

  @ApiProperty({ example: 'คลังกระดาษ', maxLength: 120 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class ErpUpdateWarehouseDto {
  @ApiPropertyOptional({ example: 'คลังกระดาษ' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: true, description: 'Becoming the default unsets the previous default' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ enum: ERP_RECORD_STATUSES, enumName: 'BrandKitStatus', example: 'active' })
  @IsOptional()
  @IsIn(ERP_RECORD_STATUSES)
  status?: string;
}

// ---------------------------------------------------------------------------------------- items

export class ErpStockSummaryDto {
  @ApiProperty({ example: '12500.000', description: 'In the base unit, every warehouse' })
  onHand!: string;

  @ApiProperty({ example: '0.000' })
  reserved!: string;

  @ApiProperty({ example: '3000.000', description: 'On order: issued purchase orders not yet received' })
  onOrder!: string;

  @ApiProperty({ example: '12500.000', description: 'onHand − reserved' })
  available!: string;

  @ApiProperty({ example: '2.850000', description: 'Average cost per base unit (D-321)' })
  avgCost!: string;

  @ApiProperty({ example: '35625.00' })
  value!: string;

  @ApiProperty({ example: false, description: 'available + onOrder at or below the reorder point (D-326)' })
  low!: boolean;
}

export class ErpItemDto {
  @ApiProperty({ format: 'uuid', example: ERP_IDS.item })
  id!: string;

  @ApiProperty({ example: 'PAP-KA-350' })
  sku!: string;

  @ApiProperty({ example: 'กระดาษคราฟท์ 350 แกรม 31×43 นิ้ว' })
  name!: string;

  @ApiProperty({ enum: ERP_ITEM_KINDS, enumName: 'ErpItemKind', example: 'raw_material' })
  kind!: string;

  @ApiProperty({
    type: ErpRefDto,
    nullable: true,
    description: 'The platform material it stocks (Packio jobs map to it)',
  })
  material!: ErpRefDto | null;

  @ApiProperty({ enum: ERP_UNITS, enumName: 'ErpUnit', example: 'sheet' })
  baseUnit!: string;

  @ApiProperty({ enum: ERP_UNITS, enumName: 'ErpUnit', nullable: true, example: 'ream' })
  purchaseUnit!: string | null;

  @ApiProperty({ example: '500.000000', description: 'Base units per purchase unit' })
  purchaseFactor!: string;

  @ApiProperty({ type: String, nullable: true, example: '5000.000' })
  reorderPoint!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '10000.000' })
  reorderQty!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 7 })
  leadTimeDays!: number | null;

  @ApiProperty({ type: ErpRefDto, nullable: true })
  defaultSupplier!: ErpRefDto | null;

  @ApiProperty({ example: false, description: 'Receipts and issues name a lot / roll number (D-327)' })
  trackLots!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '1425.000000',
    description: 'Per purchase unit, without VAT',
  })
  lastPurchasePrice!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ enum: ERP_RECORD_STATUSES, enumName: 'BrandKitStatus', example: 'active' })
  status!: string;

  @ApiProperty({ type: ErpStockSummaryDto })
  stock!: ErpStockSummaryDto;

  @ApiProperty({ example: 1 })
  version!: number;
}

export class CreateErpItemDto {
  @ApiProperty({ example: 'PAP-KA-350', pattern: '^[A-Za-z0-9-_./]{1,40}$' })
  @Transform(trim)
  @Matches(/^[A-Za-z0-9-_./]{1,40}$/)
  sku!: string;

  @ApiProperty({ example: 'กระดาษคราฟท์ 350 แกรม 31×43 นิ้ว', maxLength: 200 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ enum: ERP_ITEM_KINDS, enumName: 'ErpItemKind', example: 'raw_material' })
  @IsIn(ERP_ITEM_KINDS)
  kind!: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid', example: ERP_IDS.material })
  @IsOptional()
  @IsUUID()
  materialId?: string | null;

  @ApiProperty({ enum: ERP_UNITS, enumName: 'ErpUnit', example: 'sheet' })
  @IsIn(ERP_UNITS)
  baseUnit!: string;

  @ApiPropertyOptional({ enum: ERP_UNITS, enumName: 'ErpUnit', nullable: true, example: 'ream' })
  @IsOptional()
  @IsIn(ERP_UNITS)
  purchaseUnit?: string | null;

  @ApiPropertyOptional({
    example: '500',
    pattern: PRICE.source,
    description: 'Required with a purchase unit',
  })
  @IsOptional()
  @Matches(PRICE)
  purchaseFactor?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '5000', pattern: QTY.source })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(QTY)
  reorderPoint?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '10000', pattern: QTY.source })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(QTY)
  reorderQty?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  leadTimeDays?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid', example: ERP_IDS.supplier })
  @IsOptional()
  @IsUUID()
  defaultSupplierId?: string | null;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  trackLots?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 1000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class UpdateErpItemDto {
  @ApiPropertyOptional({ example: 'กระดาษคราฟท์ 350 แกรม 31×43 นิ้ว' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ enum: ERP_ITEM_KINDS, enumName: 'ErpItemKind' })
  @IsOptional()
  @IsIn(ERP_ITEM_KINDS)
  kind?: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  materialId?: string | null;

  @ApiPropertyOptional({
    enum: ERP_UNITS,
    enumName: 'ErpUnit',
    nullable: true,
    description: 'The base unit cannot change once the item has stock movements',
  })
  @IsOptional()
  @IsIn(ERP_UNITS)
  purchaseUnit?: string | null;

  @ApiPropertyOptional({ example: '500' })
  @IsOptional()
  @Matches(PRICE)
  purchaseFactor?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '5000' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(QTY)
  reorderPoint?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '10000' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(QTY)
  reorderQty?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  leadTimeDays?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  defaultSupplierId?: string | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  trackLots?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @ApiPropertyOptional({ enum: ERP_RECORD_STATUSES, enumName: 'BrandKitStatus' })
  @IsOptional()
  @IsIn(ERP_RECORD_STATUSES)
  status?: string;
}

export class ErpItemListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ERP_ITEM_KINDS, enumName: 'ErpItemKind' })
  @IsOptional()
  @IsIn(ERP_ITEM_KINDS)
  kind?: string;

  @ApiPropertyOptional({ enum: ERP_RECORD_STATUSES, enumName: 'BrandKitStatus', default: 'active' })
  @IsOptional()
  @IsIn(ERP_RECORD_STATUSES)
  status?: string;

  @ApiPropertyOptional({ type: Boolean, description: 'Only items at or below their reorder point (D-326)' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  low?: boolean;
}

// ---------------------------------------------------------------------------------------- stock

export class ErpStockBalanceDto {
  @ApiProperty({ type: ErpItemRefDto })
  item!: ErpItemRefDto;

  @ApiProperty({ type: ErpRefDto })
  warehouse!: ErpRefDto;

  @ApiProperty({ example: '12500.000' })
  onHand!: string;

  @ApiProperty({ example: '0.000' })
  reserved!: string;

  @ApiProperty({ example: '12500.000' })
  available!: string;

  @ApiProperty({ example: '2.850000' })
  avgCost!: string;

  @ApiProperty({ example: '35625.00' })
  value!: string;

  @ApiProperty({ type: String, nullable: true, example: '5000.000' })
  reorderPoint!: string | null;

  @ApiProperty({ example: false })
  low!: boolean;
}

export class ErpStockListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ enum: ERP_ITEM_KINDS, enumName: 'ErpItemKind' })
  @IsOptional()
  @IsIn(ERP_ITEM_KINDS)
  kind?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Only balances of items at or below their reorder point',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  low?: boolean;
}

export class ErpStockOverviewDto {
  @ApiProperty({ example: 42, description: 'Active items' })
  items!: number;

  @ApiProperty({ example: 3, description: 'Active items at or below their reorder point (D-326)' })
  low!: number;

  @ApiProperty({ example: 2, description: 'Items with less than nothing on hand (D-322 relaxed)' })
  negative!: number;

  @ApiProperty({ example: '1250000.00', description: 'Stock value at average cost (D-321)' })
  value!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ example: 4, description: 'Purchase orders issued and not yet fully received' })
  openPurchaseOrders!: number;

  @ApiProperty({ example: 1, description: 'Open purchase orders past their expected date' })
  latePurchaseOrders!: number;
}

export class ErpStockMovementDto {
  @ApiProperty({ format: 'uuid', example: ERP_IDS.movement })
  id!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-10T09:15:00+07:00' })
  occurredAt!: string;

  @ApiProperty({ enum: ERP_MOVEMENT_KINDS, enumName: 'ErpMovementKind', example: 'receipt' })
  kind!: string;

  @ApiProperty({ type: ErpItemRefDto })
  item!: ErpItemRefDto;

  @ApiProperty({ type: ErpRefDto })
  warehouse!: ErpRefDto;

  @ApiProperty({ example: '5000.000', description: 'Signed, in the base unit' })
  quantity!: string;

  @ApiProperty({ example: '2.850000' })
  unitCost!: string;

  @ApiProperty({ example: '14250.00', description: 'Signed' })
  value!: string;

  @ApiProperty({ example: '12500.000' })
  balanceAfter!: string;

  @ApiProperty({ type: String, nullable: true, example: 'R-2610-018' })
  lotNo!: string | null;

  @ApiProperty({ example: 'GR-2610-0003' })
  documentNo!: string;

  @ApiProperty({
    enum: ['goods_receipt', 'adjustment', 'issue', 'transfer'],
    enumName: 'ErpMovementSource',
    example: 'goods_receipt',
  })
  sourceType!: string;

  @ApiProperty({ format: 'uuid', example: ERP_IDS.gr })
  sourceId!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  reason!: string | null;

  @ApiProperty({ example: 'คลัง ทดสอบ', description: 'Who posted it' })
  by!: string;
}

export class ErpMovementListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ enum: ERP_MOVEMENT_KINDS, enumName: 'ErpMovementKind' })
  @IsOptional()
  @IsIn(ERP_MOVEMENT_KINDS)
  kind?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-01' })
  @IsOptional()
  @Matches(DAY)
  from?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-31' })
  @IsOptional()
  @Matches(DAY)
  to?: string;
}

export class ErpStockLineInput {
  @ApiProperty({ format: 'uuid', example: ERP_IDS.item })
  @IsUUID()
  itemId!: string;

  @ApiProperty({
    example: '250',
    pattern: SIGNED_QTY.source,
    description:
      'In the base unit. Adjustment: the signed change; count: the counted quantity; opening, issue, return and ' +
      'transfer: a positive quantity',
  })
  @Matches(SIGNED_QTY)
  quantity!: string;

  @ApiPropertyOptional({
    example: '2.85',
    pattern: PRICE.source,
    description: 'Opening balances only: the cost per base unit (else the last purchase price)',
  })
  @IsOptional()
  @Matches(PRICE)
  unitCost?: string;

  @ApiPropertyOptional({ example: 'R-2610-018', maxLength: 60 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(60)
  lotNo?: string | null;
}

export class ErpStockAdjustDto {
  @ApiProperty({ enum: ['opening', 'adjustment', 'count'], enumName: 'ErpAdjustKind', example: 'count' })
  @IsIn(['opening', 'adjustment', 'count'])
  kind!: 'opening' | 'adjustment' | 'count';

  @ApiPropertyOptional({ format: 'uuid', description: 'Default: the default warehouse' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({
    example: 'นับสต็อกสิ้นเดือน',
    maxLength: 500,
    description: 'Required for adjustments and counts (D-324)',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  reason?: string | null;

  @ApiProperty({ type: [ErpStockLineInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ErpStockLineInput)
  lines!: ErpStockLineInput[];
}

export class ErpStockIssueDto {
  @ApiProperty({
    enum: ['issue', 'return'],
    enumName: 'ErpIssueKind',
    example: 'issue',
    description: '`issue` takes stock out to production or use; `return` brings unused stock back',
  })
  @IsIn(['issue', 'return'])
  kind!: 'issue' | 'return';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({
    example: 'JOB-2610-00012',
    maxLength: 60,
    description: 'What it was for (a job number…)',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(60)
  reference?: string | null;

  @ApiPropertyOptional({ example: 'เบิกไปเครื่องพิมพ์ 1', maxLength: 500 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  reason?: string | null;

  @ApiProperty({ type: [ErpStockLineInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ErpStockLineInput)
  lines!: ErpStockLineInput[];
}

export class ErpStockTransferDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  fromWarehouseId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  toWarehouseId!: string;

  @ApiPropertyOptional({ example: 'ย้ายไปคลังหน้าเครื่อง', maxLength: 500 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  reason?: string | null;

  @ApiProperty({ type: [ErpStockLineInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ErpStockLineInput)
  lines!: ErpStockLineInput[];
}

export class ErpStockPostingDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'ADJ-2610-0001',
    description: 'Null when nothing changed (a count that matched the books) — no number is used',
  })
  documentNo!: string | null;

  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: [ErpStockMovementDto] })
  movements!: ErpStockMovementDto[];
}

export class ErpReorderSuggestionDto {
  @ApiProperty({ type: ErpItemRefDto })
  item!: ErpItemRefDto;

  @ApiProperty({ type: ErpRefDto, nullable: true, description: 'The default supplier; null → choose one' })
  supplier!: ErpRefDto | null;

  @ApiProperty({ example: '3200.000' })
  available!: string;

  @ApiProperty({ example: '0.000' })
  onOrder!: string;

  @ApiProperty({ example: '5000.000' })
  reorderPoint!: string;

  @ApiProperty({ example: '10000.000', description: 'In the base unit (D-326)' })
  toOrderQty!: string;

  @ApiProperty({ example: '20.000', description: 'In the purchase unit' })
  toOrderPurchaseQty!: string;

  @ApiProperty({ enum: ERP_UNITS, enumName: 'ErpUnit', example: 'ream' })
  purchaseUnit!: string;

  @ApiProperty({ type: String, nullable: true, example: '1425.000000' })
  lastPurchasePrice!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date', example: '2026-10-17' })
  needBy!: string | null;
}

// ------------------------------------------------------------------------------ purchase orders

export class ErpPurchaseOrderLineDto {
  @ApiProperty({ format: 'uuid', example: ERP_IDS.poLine })
  id!: string;

  @ApiProperty({ example: 1 })
  lineNo!: number;

  @ApiProperty({ type: ErpItemRefDto })
  item!: ErpItemRefDto;

  @ApiProperty({ type: String, nullable: true, example: null })
  description!: string | null;

  @ApiProperty({ example: '20.000' })
  quantity!: string;

  @ApiProperty({ enum: ERP_UNITS, enumName: 'ErpUnit', example: 'ream' })
  unit!: string;

  @ApiProperty({ example: '500.000000', description: 'Base units per `unit`' })
  factor!: string;

  @ApiProperty({ example: '1425.000000' })
  unitPrice!: string;

  @ApiProperty({ example: '0.0000' })
  discountPct!: string;

  @ApiProperty({ example: '28500.00' })
  amount!: string;

  @ApiProperty({ example: '10.000' })
  receivedQty!: string;

  @ApiProperty({ example: '10.000' })
  remainingQty!: string;
}

export class ErpPurchaseOrderReceiptRefDto {
  @ApiProperty({ format: 'uuid', example: ERP_IDS.gr })
  id!: string;

  @ApiProperty({ example: 'GR-2610-0003' })
  grNo!: string;

  @ApiProperty({ format: 'date', example: '2026-10-12' })
  receivedOn!: string;

  @ApiProperty({ example: '14250.00' })
  total!: string;
}

export class ErpPurchaseOrderDto {
  @ApiProperty({ format: 'uuid', example: ERP_IDS.po })
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'PO-2610-0007', description: 'Null while a draft' })
  poNo!: string | null;

  @ApiProperty({ enum: ERP_PO_STATUSES, enumName: 'ErpPurchaseOrderStatus', example: 'issued' })
  status!: string;

  @ApiProperty({ type: ErpRefDto })
  supplier!: ErpRefDto;

  @ApiProperty({ format: 'date', example: '2026-10-10' })
  orderedOn!: string;

  @ApiProperty({ type: String, nullable: true, format: 'date', example: '2026-10-17' })
  expectedOn!: string | null;

  @ApiProperty({ example: false, description: 'Open and past the expected date' })
  late!: boolean;

  @ApiProperty({ enum: ERP_VAT_MODES, enumName: 'ErpVatMode', example: 'exclusive' })
  vatMode!: string;

  @ApiProperty({ example: '7.0000' })
  vatRatePct!: string;

  @ApiProperty({ example: '28500.00' })
  subtotal!: string;

  @ApiProperty({ example: '1995.00' })
  vatAmount!: string;

  @ApiProperty({ example: '30495.00' })
  total!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ type: String, nullable: true, example: 'QT-6610-112' })
  supplierRef!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'ส่งที่คลังหลัก ประตู 2' })
  deliverTo!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: '2026-10-10T10:00:00+07:00' })
  issuedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: null })
  closedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  cancelReason!: string | null;

  @ApiProperty({ type: [ErpPurchaseOrderLineDto] })
  lines!: ErpPurchaseOrderLineDto[];

  @ApiProperty({ type: [ErpPurchaseOrderReceiptRefDto] })
  receipts!: ErpPurchaseOrderReceiptRefDto[];

  @ApiProperty({
    type: [NextActionDto],
    description:
      'Offered: `erp_po.edit`, `erp_po.issue` (irreversible), `erp_po.receive`, `erp_po.close`, `erp_po.cancel` (irreversible)',
  })
  nextActions!: NextActionDto[];

  @ApiProperty({ example: 2 })
  version!: number;
}

export class ErpPurchaseOrderSummaryDto {
  @ApiProperty({ format: 'uuid', example: ERP_IDS.po })
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'PO-2610-0007' })
  poNo!: string | null;

  @ApiProperty({ enum: ERP_PO_STATUSES, enumName: 'ErpPurchaseOrderStatus', example: 'issued' })
  status!: string;

  @ApiProperty({ type: ErpRefDto })
  supplier!: ErpRefDto;

  @ApiProperty({ format: 'date', example: '2026-10-10' })
  orderedOn!: string;

  @ApiProperty({ type: String, nullable: true, format: 'date', example: '2026-10-17' })
  expectedOn!: string | null;

  @ApiProperty({ example: false })
  late!: boolean;

  @ApiProperty({ example: '30495.00' })
  total!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ example: 2 })
  lineCount!: number;

  @ApiProperty({ example: '50.00', description: 'Share of ordered base quantity received, %' })
  receivedPct!: string;
}

export class ErpPurchaseOrderListQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: [...ERP_PO_STATUSES, 'open'],
    enumName: 'ErpPurchaseOrderFilter',
    description: '`open` = issued or partially received',
  })
  @IsOptional()
  @IsIn([...ERP_PO_STATUSES, 'open'])
  status?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;
}

export class ErpPurchaseOrderLineInput {
  @ApiProperty({ format: 'uuid', example: ERP_IDS.item })
  @IsUUID()
  itemId!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 300 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @ApiProperty({ example: '20', pattern: QTY.source })
  @Matches(QTY)
  quantity!: string;

  @ApiPropertyOptional({
    enum: ERP_UNITS,
    enumName: 'ErpUnit',
    example: 'ream',
    description: "The item's purchase unit or base unit; default the purchase unit",
  })
  @IsOptional()
  @IsIn(ERP_UNITS)
  unit?: string;

  @ApiProperty({ example: '1425', pattern: PRICE.source })
  @Matches(PRICE)
  unitPrice!: string;

  @ApiPropertyOptional({ example: '0', pattern: PCT.source })
  @IsOptional()
  @Matches(PCT)
  discountPct?: string;
}

export class ErpSavePurchaseOrderDto {
  @ApiProperty({ format: 'uuid', example: ERP_IDS.supplier })
  @IsUUID()
  supplierId!: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-10',
    description: 'Default: today (Asia/Bangkok)',
  })
  @IsOptional()
  @Matches(DAY)
  orderedOn?: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date', example: '2026-10-17' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(DAY)
  expectedOn?: string | null;

  @ApiPropertyOptional({ enum: ERP_VAT_MODES, enumName: 'ErpVatMode', example: 'exclusive' })
  @IsOptional()
  @IsIn(ERP_VAT_MODES)
  vatMode?: string;

  @ApiPropertyOptional({ example: '7', pattern: PCT.source })
  @IsOptional()
  @Matches(PCT)
  vatRatePct?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'QT-6610-112', maxLength: 60 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(60)
  supplierRef?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'ส่งที่คลังหลัก ประตู 2', maxLength: 300 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  deliverTo?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 1000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @ApiProperty({ type: [ErpPurchaseOrderLineInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ErpPurchaseOrderLineInput)
  lines!: ErpPurchaseOrderLineInput[];
}

export class ErpDraftFromReorderDto {
  @ApiProperty({ type: [String], format: 'uuid', example: [ERP_IDS.item] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  itemIds!: string[];
}

export class ErpDraftFromReorderResultDto {
  @ApiProperty({ type: [ErpPurchaseOrderSummaryDto] })
  created!: ErpPurchaseOrderSummaryDto[];

  @ApiProperty({ type: [ErpItemRefDto], description: 'Items with no default supplier or no need right now' })
  skipped!: ErpItemRefDto[];
}

// ------------------------------------------------------------------------------- goods receipts

export class ErpGoodsReceiptLineDto {
  @ApiProperty({ example: 1 })
  lineNo!: number;

  @ApiProperty({ type: ErpItemRefDto })
  item!: ErpItemRefDto;

  @ApiProperty({ example: '10.000' })
  quantity!: string;

  @ApiProperty({ enum: ERP_UNITS, enumName: 'ErpUnit', example: 'ream' })
  unit!: string;

  @ApiProperty({ example: '5000.000' })
  baseQuantity!: string;

  @ApiProperty({ example: '2.850000', description: 'Per base unit (D-321)' })
  unitCost!: string;

  @ApiProperty({ example: '14250.00' })
  amount!: string;

  @ApiProperty({ type: String, nullable: true, example: 'R-2610-018' })
  lotNo!: string | null;
}

export class ErpGoodsReceiptDto {
  @ApiProperty({ format: 'uuid', example: ERP_IDS.gr })
  id!: string;

  @ApiProperty({ example: 'GR-2610-0003' })
  grNo!: string;

  @ApiProperty({ type: ErpRefDto, nullable: true, description: 'The purchase order (code = PO number)' })
  purchaseOrder!: ErpRefDto | null;

  @ApiProperty({ type: ErpRefDto })
  supplier!: ErpRefDto;

  @ApiProperty({ type: ErpRefDto })
  warehouse!: ErpRefDto;

  @ApiProperty({ format: 'date', example: '2026-10-12' })
  receivedOn!: string;

  @ApiProperty({ type: String, nullable: true, example: 'DO-55012' })
  deliveryNoteNo!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ example: '14250.00' })
  total!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ example: 'คลัง ทดสอบ' })
  by!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-12T14:02:00+07:00' })
  createdAt!: string;

  @ApiProperty({ type: [ErpGoodsReceiptLineDto] })
  lines!: ErpGoodsReceiptLineDto[];
}

export class ErpGoodsReceiptListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;
}

export class ErpGoodsReceiptLineInput {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'The purchase-order line received (with `purchaseOrderId`)',
  })
  @IsOptional()
  @IsUUID()
  purchaseOrderLineId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Required without a purchase-order line' })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiProperty({
    example: '10',
    pattern: QTY.source,
    description: 'In `unit` (default the line / purchase unit)',
  })
  @Matches(QTY)
  quantity!: string;

  @ApiPropertyOptional({ enum: ERP_UNITS, enumName: 'ErpUnit' })
  @IsOptional()
  @IsIn(ERP_UNITS)
  unit?: string;

  @ApiPropertyOptional({
    example: '1425',
    pattern: PRICE.source,
    description: 'Price per `unit` without a purchase-order line (with one, the line price is used)',
  })
  @IsOptional()
  @Matches(PRICE)
  unitPrice?: string;

  @ApiPropertyOptional({
    example: 'R-2610-018',
    maxLength: 60,
    description: 'Required for items that track lots',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(60)
  lotNo?: string | null;
}

export class ErpCreateGoodsReceiptDto {
  @ApiPropertyOptional({ format: 'uuid', example: ERP_IDS.po })
  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Required without a purchase order' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Default: the default warehouse' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-12',
    description: 'Default: today (Asia/Bangkok)',
  })
  @IsOptional()
  @Matches(DAY)
  receivedOn?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'DO-55012', maxLength: 60 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(60)
  deliveryNoteNo?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 1000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @ApiProperty({ type: [ErpGoodsReceiptLineInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ErpGoodsReceiptLineInput)
  lines!: ErpGoodsReceiptLineInput[];
}
