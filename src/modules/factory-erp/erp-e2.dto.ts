import { NextActionDto } from '@common/next-actions/next-action.dto';
import { PageQuery } from '@common/pagination/pagination.dto';
import { PersonRefDto } from '@modules/financial-reports/financial-reports.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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

import {
  AMOUNT,
  DAY,
  ERP_IDS,
  ERP_RECORD_STATUSES,
  ERP_UNITS,
  ERP_VAT_MODES,
  ErpItemRefDto,
  ErpRefDto,
  PCT,
  PRICE,
  QTY,
} from './erp.dto';

/**
 * Packio Factory ERP E1.1 + E2 (docs/prompts/E1-factory-erp.md, D-333 – D-345): supplier price lists and price
 * history, purchase requests, supplier invoices and payments (AP), recipes, production orders and MRP.
 */

export const ERP_PRICE_SOURCES = ['goods_receipt', 'purchase_order', 'quotation', 'manual'] as const;
export const ERP_PR_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'ordered',
  'cancelled',
] as const;
export const ERP_REQUEST_SOURCES = ['manual', 'reorder', 'mrp'] as const;
export const ERP_AP_STATUSES = [
  'matched',
  'variance',
  'approved',
  'partially_paid',
  'paid',
  'cancelled',
] as const;
export const ERP_PAYMENT_METHODS = ['transfer', 'cash', 'cheque', 'other'] as const;
export const ERP_MO_SOURCES = ['packio_job', 'stock', 'sales_order'] as const;
export const ERP_MO_STATUSES = [
  'planned',
  'released',
  'in_progress',
  'completed',
  'closed',
  'cancelled',
] as const;
export const ERP_OPERATION_STATUSES = ['pending', 'in_progress', 'done', 'skipped'] as const;
export const ERP_LINE_VARIANCES = ['price', 'quantity', 'price_quantity', 'unordered'] as const;
export const ERP_MATERIAL_ORIGINS = ['recipe', 'packio_spec', 'manual'] as const;

export const E2_IDS = {
  link: '0192f3a0-7c1e-7d2a-9b1f-00000000e601',
  price: '0192f3a0-7c1e-7d2a-9b1f-00000000e602',
  pr: '0192f3a0-7c1e-7d2a-9b1f-00000000e701',
  prLine: '0192f3a0-7c1e-7d2a-9b1f-00000000e702',
  invoice: '0192f3a0-7c1e-7d2a-9b1f-00000000e801',
  payment: '0192f3a0-7c1e-7d2a-9b1f-00000000e802',
  recipe: '0192f3a0-7c1e-7d2a-9b1f-00000000e901',
  mo: '0192f3a0-7c1e-7d2a-9b1f-00000000ea01',
  moMaterial: '0192f3a0-7c1e-7d2a-9b1f-00000000ea02',
  moOperation: '0192f3a0-7c1e-7d2a-9b1f-00000000ea03',
  machine: '0192f3a0-7c1e-7d2a-9b1f-00000000eb01',
  job: '0192f3a0-7c1e-7d2a-9b1f-00000000ec01',
  file: '0192f3a0-7c1e-7d2a-9b1f-00000000ed01',
} as const;

const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;

/** A machine of the factory: `{ id, name }`. */
export const ErpMachineRefDto = PersonRefDto;
export type ErpMachineRefDto = PersonRefDto;

// ===================================================================== E1.1 supplier prices (D-333 – D-335)

export class ErpPriceStatsDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '2.800000',
    description: 'Lowest price per base unit paid in the last 12 months',
  })
  minBaseUnitPrice!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2.950000',
    description: 'Quantity-weighted average paid, 12 months',
  })
  avgBaseUnitPrice!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '3.000000' })
  maxBaseUnitPrice!: string | null;

  @ApiProperty({
    example: 4,
    description: 'Goods receipts from this supplier for this item in the last 12 months',
  })
  purchases!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '4.91',
    description: 'Last paid price against the one before, %',
  })
  changePct!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '75.00',
    description: 'Receipts on or before the order’s expected date, %',
  })
  onTimePct!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '6.5',
    description: 'Average days from order to receipt',
  })
  avgLeadDays!: string | null;
}

export class ErpItemSupplierDto {
  @ApiProperty({ format: 'uuid', example: E2_IDS.link })
  id!: string;

  @ApiProperty({ type: ErpItemRefDto })
  item!: ErpItemRefDto;

  @ApiProperty({ type: ErpRefDto })
  supplier!: ErpRefDto;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'KA350-3143',
    description: 'The supplier’s own code',
  })
  supplierSku!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Kraft 350g 31x43' })
  supplierName!: string | null;

  @ApiProperty({
    enum: ERP_UNITS,
    enumName: 'ErpUnit',
    example: 'ream',
    description: 'The unit this supplier sells in',
  })
  purchaseUnit!: string;

  @ApiProperty({ example: '500.000000', description: 'Base units per purchase unit' })
  purchaseFactor!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '10.000',
    description: 'Minimum order, purchase units',
  })
  minOrderQty!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 7 })
  leadTimeDays!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '1425.000000',
    description: 'Latest price per purchase unit, net, without VAT (D-334)',
  })
  lastPrice!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2.850000',
    description: 'The latest price per base unit',
  })
  lastBaseUnitPrice!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date', example: '2026-10-12' })
  lastPricedOn!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date', example: '2026-10-12' })
  lastPurchasedOn!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date',
    example: null,
    description: 'Until when the latest quotation holds',
  })
  quoteValidUntil!: string | null;

  @ApiProperty({ example: true, description: 'The usual supplier of the item (one per item)' })
  preferred!: boolean;

  @ApiProperty({
    example: false,
    description: 'Lowest latest price per base unit among the item’s active suppliers',
  })
  cheapest!: boolean;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ enum: ERP_RECORD_STATUSES, enumName: 'BrandKitStatus', example: 'active' })
  status!: string;

  @ApiProperty({ type: ErpPriceStatsDto })
  stats!: ErpPriceStatsDto;

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ErpCreateItemSupplierDto {
  @ApiProperty({ format: 'uuid', example: ERP_IDS.supplier })
  @IsUUID()
  supplierId!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'KA350-3143', maxLength: 60 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(60)
  supplierSku?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Kraft 350g 31x43', maxLength: 200 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(200)
  supplierName?: string | null;

  @ApiPropertyOptional({
    enum: ERP_UNITS,
    enumName: 'ErpUnit',
    example: 'ream',
    description: 'Default: the item’s purchase unit',
  })
  @IsOptional()
  @IsIn(ERP_UNITS)
  purchaseUnit?: string;

  @ApiPropertyOptional({
    example: '500',
    pattern: PRICE.source,
    description: 'Required when the unit is not the item’s own',
  })
  @IsOptional()
  @Matches(PRICE)
  purchaseFactor?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '10', pattern: QTY.source })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(QTY)
  minOrderQty?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 7, minimum: 0, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  leadTimeDays?: number | null;

  @ApiPropertyOptional({
    example: false,
    description: 'Make it the usual supplier (the item’s default supplier follows)',
  })
  @IsOptional()
  @IsBoolean()
  preferred?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 500 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @ApiPropertyOptional({
    example: '1425',
    pattern: PRICE.source,
    description: 'A quoted price per purchase unit (net, without VAT): recorded as a quotation',
  })
  @IsOptional()
  @Matches(PRICE)
  price?: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date', example: '2026-12-31' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(DAY)
  validUntil?: string | null;
}

export class ErpUpdateItemSupplierDto {
  @ApiPropertyOptional({ type: String, nullable: true, example: 'KA350-3143', maxLength: 60 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(60)
  supplierSku?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Kraft 350g 31x43', maxLength: 200 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(200)
  supplierName?: string | null;

  @ApiPropertyOptional({ enum: ERP_UNITS, enumName: 'ErpUnit', example: 'ream' })
  @IsOptional()
  @IsIn(ERP_UNITS)
  purchaseUnit?: string;

  @ApiPropertyOptional({ example: '500', pattern: PRICE.source })
  @IsOptional()
  @Matches(PRICE)
  purchaseFactor?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '10', pattern: QTY.source })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(QTY)
  minOrderQty?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 7, minimum: 0, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  leadTimeDays?: number | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  preferred?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 500 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @ApiPropertyOptional({ enum: ERP_RECORD_STATUSES, enumName: 'BrandKitStatus', example: 'active' })
  @IsOptional()
  @IsIn(ERP_RECORD_STATUSES)
  status?: string;
}

export class ErpPriceRecordDto {
  @ApiProperty({ format: 'uuid', example: E2_IDS.price })
  id!: string;

  @ApiProperty({ type: ErpItemRefDto })
  item!: ErpItemRefDto;

  @ApiProperty({ type: ErpRefDto })
  supplier!: ErpRefDto;

  @ApiProperty({ enum: ERP_PRICE_SOURCES, enumName: 'ErpPriceSource', example: 'goods_receipt' })
  source!: string;

  @ApiProperty({ enum: ERP_UNITS, enumName: 'ErpUnit', example: 'ream' })
  unit!: string;

  @ApiProperty({ example: '500.000000' })
  factor!: string;

  @ApiProperty({ example: '1425.000000', description: 'Per `unit`, net of discount, without VAT' })
  unitPrice!: string;

  @ApiProperty({ example: '2.850000' })
  baseUnitPrice!: string;

  @ApiProperty({ type: String, nullable: true, example: '10.000', description: 'In `unit`' })
  quantity!: string | null;

  @ApiProperty({ format: 'date', example: '2026-10-12' })
  pricedOn!: string;

  @ApiProperty({ type: String, nullable: true, format: 'date', example: null })
  validUntil!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'GR-2610-0003' })
  documentNo!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'uuid', example: ERP_IDS.gr })
  sourceId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ example: 'คลัง ทดสอบ' })
  by!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-12T14:02:00+07:00' })
  createdAt!: string;
}

export class ErpRecordPriceDto {
  @ApiProperty({ format: 'uuid', example: ERP_IDS.supplier })
  @IsUUID()
  supplierId!: string;

  @ApiProperty({ enum: ['quotation', 'manual'], enumName: 'ErpPriceEntrySource', example: 'quotation' })
  @IsIn(['quotation', 'manual'])
  source!: string;

  @ApiPropertyOptional({
    enum: ERP_UNITS,
    enumName: 'ErpUnit',
    example: 'ream',
    description: 'Default: the supplier’s unit for the item',
  })
  @IsOptional()
  @IsIn(ERP_UNITS)
  unit?: string;

  @ApiProperty({ example: '1450', pattern: PRICE.source, description: 'Net of discount, without VAT' })
  @Matches(PRICE)
  unitPrice!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '20',
    pattern: QTY.source,
    description: 'The quantity the price is for',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(QTY)
  quantity?: string | null;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-15', description: 'Default: today' })
  @IsOptional()
  @Matches(DAY)
  pricedOn?: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date', example: '2026-12-31' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(DAY)
  validUntil?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'QT-6610-120', maxLength: 60 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(60)
  documentNo?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 500 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class ErpPriceListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ enum: ERP_PRICE_SOURCES, enumName: 'ErpPriceSource' })
  @IsOptional()
  @IsIn(ERP_PRICE_SOURCES)
  source?: string;
}

// ============================================================================ purchase requests (D-336)

export class ErpPurchaseRequestLineDto {
  @ApiProperty({ format: 'uuid', example: E2_IDS.prLine })
  id!: string;

  @ApiProperty({ example: 1 })
  lineNo!: number;

  @ApiProperty({ type: ErpItemRefDto })
  item!: ErpItemRefDto;

  @ApiProperty({ example: '10000.000', description: 'In the item’s base unit' })
  quantity!: string;

  @ApiProperty({ type: ErpRefDto, nullable: true, description: 'Null → the item’s usual supplier' })
  supplier!: ErpRefDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2.850000',
    description: 'Per base unit, without VAT',
  })
  estimatedUnitCost!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '28500.00' })
  estimatedAmount!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date', example: '2026-10-20' })
  neededBy!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({
    type: ErpRefDto,
    nullable: true,
    description: 'The purchase order it became (`code` = PO number)',
  })
  purchaseOrder!: ErpRefDto | null;
}

export class ErpPurchaseRequestSummaryDto {
  @ApiProperty({ format: 'uuid', example: E2_IDS.pr })
  id!: string;

  @ApiProperty({ example: 'PR-2610-0004' })
  prNo!: string;

  @ApiProperty({ enum: ERP_PR_STATUSES, enumName: 'ErpPurchaseRequestStatus', example: 'submitted' })
  status!: string;

  @ApiProperty({ enum: ERP_REQUEST_SOURCES, enumName: 'ErpRequestSource', example: 'manual' })
  source!: string;

  @ApiProperty({ type: String, nullable: true, format: 'date', example: '2026-10-20' })
  neededBy!: string | null;

  @ApiProperty({ example: '28500.00' })
  estimatedTotal!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ example: 1 })
  lineCount!: number;

  @ApiProperty({ example: 'คลัง ทดสอบ' })
  requestedBy!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-12T09:00:00+07:00' })
  createdAt!: string;
}

export class ErpPurchaseRequestDto extends ErpPurchaseRequestSummaryDto {
  @ApiProperty({ type: String, nullable: true, example: 'ใช้กับงาน JOB-2610-0012' })
  note!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: '2026-10-12T09:05:00+07:00' })
  submittedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: null })
  decidedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  decidedBy!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  decisionNote!: string | null;

  @ApiProperty({ type: [ErpPurchaseRequestLineDto] })
  lines!: ErpPurchaseRequestLineDto[];

  @ApiProperty({ type: [NextActionDto] })
  nextActions!: NextActionDto[];

  @ApiProperty({ example: 2 })
  version!: number;
}

export class ErpPurchaseRequestListQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: [...ERP_PR_STATUSES, 'open'],
    enumName: 'ErpPurchaseRequestStatusFilter',
    description: '`open` = submitted or approved',
  })
  @IsOptional()
  @IsIn([...ERP_PR_STATUSES, 'open'])
  status?: string;
}

export class ErpPurchaseRequestLineInput {
  @ApiProperty({ format: 'uuid', example: ERP_IDS.item })
  @IsUUID()
  itemId!: string;

  @ApiProperty({ example: '10000', pattern: QTY.source, description: 'In the item’s base unit' })
  @Matches(QTY)
  quantity!: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid', example: null })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  supplierId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date', example: '2026-10-20' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(DAY)
  neededBy?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 300 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class ErpSavePurchaseRequestDto {
  @ApiPropertyOptional({ type: String, nullable: true, format: 'date', example: '2026-10-20' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(DAY)
  neededBy?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'ใช้กับงาน JOB-2610-0012', maxLength: 1000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @ApiProperty({ type: [ErpPurchaseRequestLineInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ErpPurchaseRequestLineInput)
  lines!: ErpPurchaseRequestLineInput[];
}

// ======================================================================== supplier invoices (D-337)

export class ErpSupplierInvoiceLineDto {
  @ApiProperty({ example: 1 })
  lineNo!: number;

  @ApiProperty({ type: String, nullable: true, format: 'uuid', example: ERP_IDS.poLine })
  purchaseOrderLineId!: string | null;

  @ApiProperty({ type: ErpItemRefDto, nullable: true })
  item!: ErpItemRefDto | null;

  @ApiProperty({ example: 'กระดาษคราฟท์ 350 แกรม' })
  description!: string;

  @ApiProperty({ example: '10.000' })
  quantity!: string;

  @ApiProperty({ example: '1425.000000' })
  unitPrice!: string;

  @ApiProperty({ example: '14250.00' })
  amount!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '10.000',
    description: 'Received on the order line when matched',
  })
  receivedQty!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '1425.000000', description: 'The order’s net price' })
  orderedPrice!: string | null;

  @ApiProperty({ enum: ERP_LINE_VARIANCES, enumName: 'ErpLineVariance', nullable: true, example: null })
  variance!: string | null;
}

export class ErpInvoicePaymentRefDto {
  @ApiProperty({ format: 'uuid', example: E2_IDS.payment })
  id!: string;

  @ApiProperty({ example: 'PV-2610-0002' })
  paymentNo!: string;

  @ApiProperty({ format: 'date', example: '2026-11-10' })
  paidOn!: string;

  @ApiProperty({ example: '14820.00', description: 'Allocated to this invoice; negative for a reversal' })
  amount!: string;
}

export class ErpSupplierInvoiceSummaryDto {
  @ApiProperty({ format: 'uuid', example: E2_IDS.invoice })
  id!: string;

  @ApiProperty({ example: 'AP-2610-0003', description: 'The factory’s own number' })
  docNo!: string;

  @ApiProperty({ type: ErpRefDto })
  supplier!: ErpRefDto;

  @ApiProperty({ example: 'IV-55012', description: 'The supplier’s invoice number' })
  invoiceNo!: string;

  @ApiProperty({ format: 'date', example: '2026-10-12' })
  invoiceDate!: string;

  @ApiProperty({ format: 'date', example: '2026-11-11' })
  dueDate!: string;

  @ApiProperty({ example: false })
  overdue!: boolean;

  @ApiProperty({ example: '15247.50' })
  total!: string;

  @ApiProperty({ example: '14820.00', description: 'Total less withholding tax' })
  payableAmount!: string;

  @ApiProperty({ example: '14820.00' })
  outstanding!: string;

  @ApiProperty({ enum: ERP_AP_STATUSES, enumName: 'ErpSupplierInvoiceStatus', example: 'approved' })
  status!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;
}

export class ErpSupplierInvoiceDto extends ErpSupplierInvoiceSummaryDto {
  @ApiProperty({ type: ErpRefDto, nullable: true, description: '`code` = PO number' })
  purchaseOrder!: ErpRefDto | null;

  @ApiProperty({ type: String, nullable: true, example: 'IV-55012' })
  taxInvoiceNo!: string | null;

  @ApiProperty({ enum: ERP_VAT_MODES, enumName: 'ErpVatMode', example: 'exclusive' })
  vatMode!: string;

  @ApiProperty({ example: '7.0000' })
  vatRatePct!: string;

  @ApiProperty({ example: '14250.00' })
  subtotal!: string;

  @ApiProperty({ example: '997.50' })
  vatAmount!: string;

  @ApiProperty({ example: '3.0000' })
  whtRatePct!: string;

  @ApiProperty({ example: '427.50' })
  whtAmount!: string;

  @ApiProperty({ example: '0.00' })
  paidAmount!: string;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Why it did not match (D-337)' })
  matchNote!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'uuid',
    example: null,
    description: 'The scanned invoice',
  })
  fileId!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: '2026-10-12T15:00:00+07:00' })
  approvedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'เจ้าของ ทดสอบ' })
  approvedBy!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  cancelReason!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-12T14:30:00+07:00' })
  createdAt!: string;

  @ApiProperty({ type: [ErpSupplierInvoiceLineDto] })
  lines!: ErpSupplierInvoiceLineDto[];

  @ApiProperty({ type: [ErpInvoicePaymentRefDto] })
  payments!: ErpInvoicePaymentRefDto[];

  @ApiProperty({ type: [NextActionDto] })
  nextActions!: NextActionDto[];

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ErpSupplierInvoiceListQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: [...ERP_AP_STATUSES, 'open'],
    enumName: 'ErpSupplierInvoiceStatusFilter',
    description: '`open` = not paid and not cancelled',
  })
  @IsOptional()
  @IsIn([...ERP_AP_STATUSES, 'open'])
  status?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ example: true, description: 'Only open invoices past their due date' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  overdue?: boolean;
}

export class ErpSupplierInvoiceLineInput {
  @ApiPropertyOptional({
    format: 'uuid',
    example: ERP_IDS.poLine,
    description: 'Matches the line to the order (3-way)',
  })
  @IsOptional()
  @IsUUID()
  purchaseOrderLineId?: string;

  @ApiPropertyOptional({ format: 'uuid', example: ERP_IDS.item })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({
    example: 'ค่าขนส่ง',
    maxLength: 300,
    description: 'Required without an item or order line',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiProperty({ example: '10', pattern: QTY.source, description: 'In the order line’s unit' })
  @Matches(QTY)
  quantity!: string;

  @ApiProperty({ example: '1425', pattern: PRICE.source, description: 'Net per unit, as the VAT mode says' })
  @Matches(PRICE)
  unitPrice!: string;
}

export class ErpCreateSupplierInvoiceDto {
  @ApiProperty({ format: 'uuid', example: ERP_IDS.supplier })
  @IsUUID()
  supplierId!: string;

  @ApiPropertyOptional({ format: 'uuid', example: ERP_IDS.po })
  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string;

  @ApiProperty({ example: 'IV-55012', maxLength: 40 })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  invoiceNo!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'IV-55012', maxLength: 40 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(40)
  taxInvoiceNo?: string | null;

  @ApiProperty({ format: 'date', example: '2026-10-12' })
  @Matches(DAY)
  invoiceDate!: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-11-11',
    description: 'Default: invoice date + the supplier’s credit days',
  })
  @IsOptional()
  @Matches(DAY)
  dueDate?: string;

  @ApiPropertyOptional({ enum: ERP_VAT_MODES, enumName: 'ErpVatMode', example: 'exclusive' })
  @IsOptional()
  @IsIn(ERP_VAT_MODES)
  vatMode?: string;

  @ApiPropertyOptional({ example: '7', pattern: PCT.source })
  @IsOptional()
  @Matches(PCT)
  vatRatePct?: string;

  @ApiPropertyOptional({
    example: '3',
    pattern: PCT.source,
    description: 'Withholding tax on the amount before VAT',
  })
  @IsOptional()
  @Matches(PCT)
  whtRatePct?: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid', example: null })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  fileId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 1000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @ApiProperty({ type: [ErpSupplierInvoiceLineInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ErpSupplierInvoiceLineInput)
  lines!: ErpSupplierInvoiceLineInput[];
}

// ========================================================================= supplier payments (D-338)

export class ErpPaymentAllocationDto {
  @ApiProperty({
    type: ErpRefDto,
    description: '`code` = the factory’s AP number, `name` = the supplier’s invoice number',
  })
  invoice!: ErpRefDto;

  @ApiProperty({ example: '14820.00' })
  amount!: string;
}

export class ErpSupplierPaymentDto {
  @ApiProperty({ format: 'uuid', example: E2_IDS.payment })
  id!: string;

  @ApiProperty({ example: 'PV-2610-0002' })
  paymentNo!: string;

  @ApiProperty({ type: ErpRefDto })
  supplier!: ErpRefDto;

  @ApiProperty({ format: 'date', example: '2026-11-10' })
  paidOn!: string;

  @ApiProperty({ enum: ERP_PAYMENT_METHODS, enumName: 'ErpPaymentMethod', example: 'transfer' })
  method!: string;

  @ApiProperty({ type: String, nullable: true, example: 'KBANK 1234' })
  reference!: string | null;

  @ApiProperty({ example: '14820.00', description: 'Negative on a reversal' })
  amount!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ type: ErpRefDto, nullable: true, description: 'The payment this one reverses' })
  reverses!: ErpRefDto | null;

  @ApiProperty({ type: ErpRefDto, nullable: true, description: 'The reversal of this payment' })
  reversedBy!: ErpRefDto | null;

  @ApiProperty({ type: [ErpPaymentAllocationDto] })
  allocations!: ErpPaymentAllocationDto[];

  @ApiProperty({ example: 'บัญชี ทดสอบ' })
  by!: string;

  @ApiProperty({ format: 'date-time', example: '2026-11-10T10:00:00+07:00' })
  createdAt!: string;

  @ApiProperty({ type: [NextActionDto] })
  nextActions!: NextActionDto[];
}

export class ErpPaymentAllocationInput {
  @ApiProperty({ format: 'uuid', example: E2_IDS.invoice })
  @IsUUID()
  supplierInvoiceId!: string;

  @ApiProperty({ example: '14820', pattern: AMOUNT.source })
  @Matches(AMOUNT)
  amount!: string;
}

export class ErpCreateSupplierPaymentDto {
  @ApiProperty({ format: 'uuid', example: ERP_IDS.supplier })
  @IsUUID()
  supplierId!: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-11-10', description: 'Default: today' })
  @IsOptional()
  @Matches(DAY)
  paidOn?: string;

  @ApiProperty({ enum: ERP_PAYMENT_METHODS, enumName: 'ErpPaymentMethod', example: 'transfer' })
  @IsIn(ERP_PAYMENT_METHODS)
  method!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'KBANK 1234', maxLength: 100 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(100)
  reference?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 500 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @ApiProperty({ type: [ErpPaymentAllocationInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ErpPaymentAllocationInput)
  allocations!: ErpPaymentAllocationInput[];
}

export class ErpSupplierPaymentListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;
}

export class ErpAgingBucketsDto {
  @ApiProperty({ example: '14820.00', description: 'Not yet due' })
  current!: string;

  @ApiProperty({ example: '0.00' })
  d1_30!: string;

  @ApiProperty({ example: '0.00' })
  d31_60!: string;

  @ApiProperty({ example: '0.00' })
  d61_90!: string;

  @ApiProperty({ example: '0.00' })
  over90!: string;

  @ApiProperty({ example: '14820.00' })
  total!: string;
}

export class ErpSupplierAgingDto {
  @ApiProperty({ type: ErpRefDto })
  supplier!: ErpRefDto;

  @ApiProperty({ example: 1 })
  invoices!: number;

  @ApiProperty({ type: ErpAgingBucketsDto })
  buckets!: ErpAgingBucketsDto;
}

export class ErpApAgingDto {
  @ApiProperty({ format: 'date', example: '2026-10-15' })
  asOf!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ example: '14820.00', description: 'Due within the next 7 days' })
  dueSoon!: string;

  @ApiProperty({ type: ErpAgingBucketsDto })
  totals!: ErpAgingBucketsDto;

  @ApiProperty({ type: [ErpSupplierAgingDto] })
  suppliers!: ErpSupplierAgingDto[];
}

// ================================================================================== recipes (D-339)

export class ErpRecipeMaterialDto {
  @ApiProperty({ example: 1 })
  lineNo!: number;

  @ApiProperty({ type: ErpItemRefDto })
  item!: ErpItemRefDto;

  @ApiProperty({ example: '0.125000', description: 'Base units per batch' })
  quantity!: string;

  @ApiProperty({ example: '5.0000' })
  scrapPct!: string;
}

export class ErpRecipeOperationDto {
  @ApiProperty({ example: 10 })
  seq!: number;

  @ApiProperty({ example: 'พิมพ์ออฟเซ็ท 4 สี' })
  name!: string;

  @ApiProperty({ type: ErpMachineRefDto, nullable: true })
  machine!: ErpMachineRefDto | null;

  @ApiProperty({ example: 30 })
  setupMinutes!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '3000.000',
    description: 'Product base units per hour',
  })
  runRatePerHour!: string | null;
}

export class ErpRecipeDto {
  @ApiProperty({ format: 'uuid', example: E2_IDS.recipe })
  id!: string;

  @ApiProperty({ type: ErpItemRefDto, description: 'The product it makes' })
  item!: ErpItemRefDto;

  @ApiProperty({ example: 'กล่องครีม 30 ml — มาตรฐาน' })
  name!: string;

  @ApiProperty({ example: '1.000', description: 'Product base units one batch makes' })
  batchQty!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ enum: ERP_RECORD_STATUSES, enumName: 'BrandKitStatus', example: 'active' })
  status!: string;

  @ApiProperty({ type: [ErpRecipeMaterialDto] })
  materials!: ErpRecipeMaterialDto[];

  @ApiProperty({ type: [ErpRecipeOperationDto] })
  operations!: ErpRecipeOperationDto[];

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ErpRecipeMaterialInput {
  @ApiProperty({ format: 'uuid', example: ERP_IDS.item })
  @IsUUID()
  itemId!: string;

  @ApiProperty({ example: '0.125', pattern: '^\\d{1,8}(\\.\\d{1,6})?$' })
  @Matches(/^\d{1,8}(\.\d{1,6})?$/)
  quantity!: string;

  @ApiPropertyOptional({ example: '5', pattern: PCT.source })
  @IsOptional()
  @Matches(PCT)
  scrapPct?: string;
}

export class ErpRecipeOperationInput {
  @ApiProperty({ example: 'พิมพ์ออฟเซ็ท 4 สี', maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid', example: E2_IDS.machine })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  machineId?: string | null;

  @ApiPropertyOptional({ example: 30, minimum: 0, maximum: 1440 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  setupMinutes?: number;

  @ApiPropertyOptional({ type: String, nullable: true, example: '3000', pattern: QTY.source })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(QTY)
  runRatePerHour?: string | null;
}

export class ErpSaveRecipeDto {
  @ApiProperty({ format: 'uuid', example: ERP_IDS.item })
  @IsUUID()
  itemId!: string;

  @ApiProperty({ example: 'กล่องครีม 30 ml — มาตรฐาน', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: '1', pattern: QTY.source })
  @IsOptional()
  @Matches(QTY)
  batchQty?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 1000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @ApiPropertyOptional({ enum: ERP_RECORD_STATUSES, enumName: 'BrandKitStatus', example: 'active' })
  @IsOptional()
  @IsIn(ERP_RECORD_STATUSES)
  status?: string;

  @ApiProperty({ type: [ErpRecipeMaterialInput] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ErpRecipeMaterialInput)
  materials!: ErpRecipeMaterialInput[];

  @ApiProperty({ type: [ErpRecipeOperationInput] })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ErpRecipeOperationInput)
  operations!: ErpRecipeOperationInput[];
}

export class ErpRecipeListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({ enum: ERP_RECORD_STATUSES, enumName: 'BrandKitStatus' })
  @IsOptional()
  @IsIn(ERP_RECORD_STATUSES)
  status?: string;
}

// ==================================================================== production orders (D-340, D-341)

export class ErpProductionMaterialDto {
  @ApiProperty({ format: 'uuid', example: E2_IDS.moMaterial })
  id!: string;

  @ApiProperty({ example: 1 })
  lineNo!: number;

  @ApiProperty({ type: ErpItemRefDto })
  item!: ErpItemRefDto;

  @ApiProperty({ example: '1053.000', description: 'Base units' })
  requiredQty!: string;

  @ApiProperty({ example: '1053.000', description: 'Held for this order in its warehouse' })
  reservedQty!: string;

  @ApiProperty({ example: '0.000' })
  issuedQty!: string;

  @ApiProperty({ example: '1053.000', description: 'Required less issued' })
  remainingQty!: string;

  @ApiProperty({ example: '0.000', description: 'What is still missing: remaining less reserved' })
  shortQty!: string;

  @ApiProperty({ enum: ERP_MATERIAL_ORIGINS, enumName: 'ErpMaterialOrigin', example: 'recipe' })
  origin!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;
}

export class ErpProductionOperationDto {
  @ApiProperty({ format: 'uuid', example: E2_IDS.moOperation })
  id!: string;

  @ApiProperty({ example: 10 })
  seq!: number;

  @ApiProperty({ example: 'พิมพ์ออฟเซ็ท 4 สี' })
  name!: string;

  @ApiProperty({ type: ErpMachineRefDto, nullable: true })
  machine!: ErpMachineRefDto | null;

  @ApiProperty({ example: 50 })
  plannedMinutes!: number;

  @ApiProperty({ enum: ERP_OPERATION_STATUSES, enumName: 'ErpOperationStatus', example: 'pending' })
  status!: string;

  @ApiProperty({ example: '0.000' })
  goodQty!: string;

  @ApiProperty({ example: '0.000' })
  scrapQty!: string;
}

export class ErpProductionOrderSummaryDto {
  @ApiProperty({ format: 'uuid', example: E2_IDS.mo })
  id!: string;

  @ApiProperty({ example: 'MO-2610-0005' })
  moNo!: string;

  @ApiProperty({ enum: ERP_MO_SOURCES, enumName: 'ErpProductionSource', example: 'packio_job' })
  source!: string;

  @ApiProperty({ example: 'JOB-2610-0012 · กล่องพับ' })
  title!: string;

  @ApiProperty({ type: ErpItemRefDto, nullable: true })
  item!: ErpItemRefDto | null;

  @ApiProperty({ example: '1000.000' })
  quantity!: string;

  @ApiProperty({ example: 'pcs' })
  unit!: string;

  @ApiProperty({ type: String, nullable: true, format: 'date', example: '2026-10-25' })
  dueOn!: string | null;

  @ApiProperty({ example: 0, description: 'Higher first' })
  priority!: number;

  @ApiProperty({ enum: ERP_MO_STATUSES, enumName: 'ErpProductionStatus', example: 'released' })
  status!: string;

  @ApiProperty({ example: false })
  late!: boolean;

  @ApiProperty({ example: '33.33', description: 'Operations done or skipped, %' })
  progressPct!: string;

  @ApiProperty({ example: false, description: 'A material is still missing' })
  short!: boolean;
}

export class ErpProductionOrderDto extends ErpProductionOrderSummaryDto {
  @ApiProperty({ type: ErpRefDto, nullable: true, description: 'The Packio job (`code` = job number)' })
  job!: ErpRefDto | null;

  @ApiProperty({ type: ErpRefDto, nullable: true, description: '`code` = the product SKU' })
  recipe!: ErpRefDto | null;

  @ApiProperty({ type: String, nullable: true, format: 'date', example: '2026-10-20' })
  plannedStartOn!: string | null;

  @ApiProperty({ type: ErpRefDto })
  warehouse!: ErpRefDto;

  @ApiProperty({ example: '0.000' })
  goodQty!: string;

  @ApiProperty({ example: '0.000' })
  scrapQty!: string;

  @ApiProperty({ example: '0.00', description: 'Value of the materials consumed (issued less returned)' })
  materialCost!: string;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Per good unit once completed' })
  unitCost!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: '2026-10-18T08:00:00+07:00' })
  releasedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: null })
  completedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  cancelReason!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-17T10:00:00+07:00' })
  createdAt!: string;

  @ApiProperty({ type: [ErpProductionMaterialDto] })
  materials!: ErpProductionMaterialDto[];

  @ApiProperty({ type: [ErpProductionOperationDto] })
  operations!: ErpProductionOperationDto[];

  @ApiProperty({ type: [NextActionDto] })
  nextActions!: NextActionDto[];

  @ApiProperty({ example: 2 })
  version!: number;
}

export class ErpProductionOrderListQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: [...ERP_MO_STATUSES, 'open'],
    enumName: 'ErpProductionStatusFilter',
    description: '`open` = planned, released or in progress',
  })
  @IsOptional()
  @IsIn([...ERP_MO_STATUSES, 'open'])
  status?: string;

  @ApiPropertyOptional({ enum: ERP_MO_SOURCES, enumName: 'ErpProductionSource' })
  @IsOptional()
  @IsIn(ERP_MO_SOURCES)
  source?: string;
}

export class ErpProductionMaterialInput {
  @ApiProperty({ format: 'uuid', example: ERP_IDS.item })
  @IsUUID()
  itemId!: string;

  @ApiProperty({ example: '1053', pattern: QTY.source, description: 'Base units' })
  @Matches(QTY)
  requiredQty!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 300 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class ErpProductionOperationInput {
  @ApiProperty({ example: 'ไดคัท', maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid', example: E2_IDS.machine })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  machineId?: string | null;

  @ApiPropertyOptional({ example: 60, minimum: 0, maximum: 100000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  plannedMinutes?: number;
}

export class ErpCreateProductionOrderDto {
  @ApiProperty({ enum: ['stock', 'sales_order'], enumName: 'ErpOwnProductionSource', example: 'stock' })
  @IsIn(['stock', 'sales_order'])
  source!: string;

  @ApiProperty({ format: 'uuid', example: ERP_IDS.item, description: 'The product to make' })
  @IsUUID()
  itemId!: string;

  @ApiProperty({ example: '1000', pattern: QTY.source, description: 'In the product’s base unit' })
  @Matches(QTY)
  quantity!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: E2_IDS.recipe,
    description: 'Default: the product’s active recipe',
  })
  @IsOptional()
  @IsUUID()
  recipeId?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 200 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(200)
  title?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date', example: '2026-10-25' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(DAY)
  dueOn?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date', example: '2026-10-20' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(DAY)
  plannedStartOn?: string | null;

  @ApiPropertyOptional({ example: 0, minimum: 0, maximum: 9 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9)
  priority?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    example: ERP_IDS.warehouse,
    description: 'Default: the main warehouse',
  })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 1000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @ApiPropertyOptional({ type: [ErpProductionMaterialInput], description: 'Default: from the recipe' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ErpProductionMaterialInput)
  materials?: ErpProductionMaterialInput[];

  @ApiPropertyOptional({ type: [ErpProductionOperationInput], description: 'Default: from the recipe' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ErpProductionOperationInput)
  operations?: ErpProductionOperationInput[];
}

export class ErpUpdateProductionOrderDto {
  @ApiPropertyOptional({ example: 'JOB-2610-0012 · กล่องพับ', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ example: '1200', pattern: QTY.source })
  @IsOptional()
  @Matches(QTY)
  quantity?: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date', example: '2026-10-25' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(DAY)
  dueOn?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date', example: '2026-10-20' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(DAY)
  plannedStartOn?: string | null;

  @ApiPropertyOptional({ example: 5, minimum: 0, maximum: 9 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9)
  priority?: number;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 1000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @ApiPropertyOptional({
    type: [ErpProductionMaterialInput],
    description: 'Replaces the materials (planned orders only)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ErpProductionMaterialInput)
  materials?: ErpProductionMaterialInput[];

  @ApiPropertyOptional({
    type: [ErpProductionOperationInput],
    description: 'Replaces the operations (planned orders only)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ErpProductionOperationInput)
  operations?: ErpProductionOperationInput[];
}

export class ErpMaterialMoveLineInput {
  @ApiProperty({ format: 'uuid', example: E2_IDS.moMaterial })
  @IsUUID()
  materialId!: string;

  @ApiProperty({ example: '1053', pattern: QTY.source, description: 'Base units' })
  @Matches(QTY)
  quantity!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 60 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(60)
  lotNo?: string | null;
}

export class ErpMaterialMoveDto {
  @ApiPropertyOptional({
    type: [ErpMaterialMoveLineInput],
    description: 'Issue: default every material’s remaining quantity. Return: required.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ErpMaterialMoveLineInput)
  lines?: ErpMaterialMoveLineInput[];

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 300 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class ErpCompleteProductionDto {
  @ApiProperty({ example: '980', pattern: QTY.source })
  @Matches(QTY)
  goodQty!: string;

  @ApiPropertyOptional({ example: '20', pattern: QTY.source })
  @IsOptional()
  @Matches(QTY)
  scrapQty?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 300 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class ErpOperationOutputDto {
  @ApiPropertyOptional({ example: '1000', pattern: QTY.source })
  @IsOptional()
  @Matches(QTY)
  goodQty?: string;

  @ApiPropertyOptional({ example: '12', pattern: QTY.source })
  @IsOptional()
  @Matches(QTY)
  scrapQty?: string;
}

// ========================================================================== planning and MRP (D-342)

export class ErpMachineLoadDto {
  @ApiProperty({ type: ErpMachineRefDto })
  machine!: ErpMachineRefDto;

  @ApiProperty({ example: 3, description: 'Operations still to do on released orders' })
  operations!: number;

  @ApiProperty({ example: 420 })
  plannedMinutes!: number;
}

export class ErpPlanningOverviewDto {
  @ApiProperty({ example: 2 })
  planned!: number;

  @ApiProperty({ example: 3 })
  released!: number;

  @ApiProperty({ example: 1 })
  inProgress!: number;

  @ApiProperty({ example: 1 })
  late!: number;

  @ApiProperty({ example: 2, description: 'Open orders due within 7 days' })
  dueThisWeek!: number;

  @ApiProperty({ example: 1, description: 'Items the open orders still miss (MRP)' })
  shortItems!: number;

  @ApiProperty({ type: [ErpMachineLoadDto] })
  machines!: ErpMachineLoadDto[];
}

export class ErpMrpRowDto {
  @ApiProperty({ type: ErpItemRefDto })
  item!: ErpItemRefDto;

  @ApiProperty({ example: '1053.000', description: 'Still to issue to open production orders' })
  required!: string;

  @ApiProperty({ example: '500.000', description: 'Of it, already reserved' })
  reserved!: string;

  @ApiProperty({ example: '200.000', description: 'Free stock (on hand less every reservation)' })
  available!: string;

  @ApiProperty({ example: '0.000' })
  onOrder!: string;

  @ApiProperty({
    example: '353.000',
    description: 'required − reserved − available − on order, when positive',
  })
  shortage!: string;

  @ApiProperty({ example: '500.000', description: 'Base units to buy, rounded to purchase units (D-335)' })
  toOrderQty!: string;

  @ApiProperty({ example: '1.000' })
  toOrderPurchaseQty!: string;

  @ApiProperty({ enum: ERP_UNITS, enumName: 'ErpUnit', example: 'ream' })
  purchaseUnit!: string;

  @ApiProperty({ type: ErpRefDto, nullable: true })
  supplier!: ErpRefDto | null;

  @ApiProperty({ type: String, nullable: true, example: '1425.000000', description: 'Per purchase unit' })
  unitPrice!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date',
    example: '2026-10-20',
    description: 'Earliest due production order',
  })
  neededBy!: string | null;

  @ApiProperty({ example: 2 })
  orders!: number;
}

export class ErpOperationQueueItemDto {
  @ApiProperty({ type: ErpProductionOperationDto })
  operation!: ErpProductionOperationDto;

  @ApiProperty({ type: ErpProductionOrderSummaryDto })
  order!: ErpProductionOrderSummaryDto;
}

export class ErpOperationQueueQuery {
  @ApiPropertyOptional({ format: 'uuid', description: 'One machine’s queue' })
  @IsOptional()
  @IsUUID()
  machineId?: string;
}
