import { NextActionDto } from '@common/next-actions/next-action.dto';
import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
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
  DAY,
  ERP_IDS,
  ERP_RECORD_STATUSES,
  ERP_UNITS,
  ErpItemRefDto,
  ErpRefDto,
  PRICE,
  QTY,
} from './erp.dto';
import {
  E2_IDS,
  ERP_GRADES,
  ERP_SUPPLIER_APPROVALS,
  ErpMachineRefDto,
  ErpOperationQueueItemDto,
  ErpSupplierScoreDto,
} from './erp-e2.dto';
export { ERP_CHARGE_ALLOCATIONS, ERP_CHARGE_KINDS, ErpChargeInput, ErpLandedChargeDto } from './erp.dto';

/**
 * getpack Factory ERP E2.1 + E3 (docs/prompts/E1-factory-erp.md §10, D-346 – D-358): quantity breaks, alerts,
 * requests for quotation, receiving inspection, landed cost, approved suppliers; machine schedule, shop-floor
 * kiosk, maintenance and documents.
 */

export const ERP_APPROVAL_POLICIES = ['off', 'warn', 'enforce'] as const;
export const ERP_ALERT_KINDS = [
  'price_rise',
  'quote_expiring',
  'supplier_review_due',
  'maintenance_due',
  'machine_breakdown',
  'document_expiring',
  'quote_follow_up',
  'invoice_overdue',
  'activity_overdue',
  'ncr_overdue',
  'oee_low',
] as const;
export const ERP_ALERT_STATUSES = ['open', 'acknowledged'] as const;
export const ERP_RFQ_STATUSES = ['draft', 'sent', 'awarded', 'cancelled'] as const;
export const ERP_RFQ_SUPPLIER_STATUSES = ['invited', 'quoted', 'declined'] as const;
export const ERP_OPERATION_EVENT_KINDS = ['start', 'pause', 'resume', 'finish', 'skip'] as const;
export const ERP_PAUSE_REASONS = [
  'material_shortage',
  'machine_breakdown',
  'setup',
  'quality_issue',
  'waiting_approval',
  'break',
  'other',
] as const;
export const ERP_MILESTONE_SYNCS = ['none', 'synced', 'failed'] as const;
export const ERP_MAINTENANCE_KINDS = ['breakdown', 'preventive'] as const;
export const ERP_MAINTENANCE_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const ERP_MAINTENANCE_STATUSES = ['open', 'scheduled', 'in_progress', 'done', 'cancelled'] as const;
export const ERP_MACHINE_STATES = ['running', 'idle', 'down', 'maintenance'] as const;
export const ERP_DOC_CATEGORIES = [
  'certificate',
  'permit',
  'contract',
  'drawing',
  'specification',
  'manual',
  'procedure',
  'other',
] as const;
export const ERP_DOC_LINKS = [
  'trading_partner',
  'item',
  'machine',
  'purchase_order',
  'production_order',
  'maintenance_order',
] as const;
export const ERP_DOC_EXPIRY = ['none', 'valid', 'expiring', 'expired'] as const;

export const E3_IDS = {
  alert: '0192f3a0-7c1e-7d2a-9b1f-00000000ee01',
  rfq: '0192f3a0-7c1e-7d2a-9b1f-00000000ee11',
  rfqLine: '0192f3a0-7c1e-7d2a-9b1f-00000000ee12',
  rfqSupplier: '0192f3a0-7c1e-7d2a-9b1f-00000000ee13',
  rfqQuote: '0192f3a0-7c1e-7d2a-9b1f-00000000ee14',
  charge: '0192f3a0-7c1e-7d2a-9b1f-00000000ee21',
  event: '0192f3a0-7c1e-7d2a-9b1f-00000000ee31',
  plan: '0192f3a0-7c1e-7d2a-9b1f-00000000ee41',
  mt: '0192f3a0-7c1e-7d2a-9b1f-00000000ee42',
  mtPart: '0192f3a0-7c1e-7d2a-9b1f-00000000ee43',
  folder: '0192f3a0-7c1e-7d2a-9b1f-00000000ee51',
  doc: '0192f3a0-7c1e-7d2a-9b1f-00000000ee52',
  docVersion: '0192f3a0-7c1e-7d2a-9b1f-00000000ee53',
  file: '0192f3a0-7c1e-7d2a-9b1f-00000000ee54',
  milestone: '0192f3a0-7c1e-7d2a-9b1f-00000000ee61',
} as const;

const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;

// ================================================================= sourcing (D-346, D-349, D-351)

export class ErpPriceBreakInput {
  @ApiProperty({ example: '50', pattern: QTY.source })
  @Matches(QTY)
  minQty!: string;

  @ApiProperty({ example: '1380', pattern: PRICE.source })
  @Matches(PRICE)
  unitPrice!: string;
}

export class ErpSavePriceBreaksDto {
  @ApiProperty({ type: [ErpPriceBreakInput], description: 'Replaces the set; empty clears it (D-346)' })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ErpPriceBreakInput)
  breaks!: ErpPriceBreakInput[];

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date', example: '2026-12-31' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(DAY)
  validUntil?: string | null;
}

export class ErpApproveSupplierDto {
  @ApiPropertyOptional({ type: String, nullable: true, example: 'ผ่านการตรวจโรงงาน ได้ FSC', maxLength: 500 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'date',
    example: '2027-10-01',
    description: 'When to review the approval again',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(DAY)
  reviewOn?: string | null;
}

export class ErpRejectionDto {
  @ApiProperty({ type: ErpRefDto, description: 'The goods receipt (code = GR number)' })
  goodsReceipt!: ErpRefDto;

  @ApiProperty({ format: 'date', example: '2026-10-12' })
  receivedOn!: string;

  @ApiProperty({ type: ErpItemRefDto })
  item!: ErpItemRefDto;

  @ApiProperty({ example: '2.000' })
  rejectedQuantity!: string;

  @ApiProperty({ enum: ERP_UNITS, enumName: 'ErpUnit', example: 'ream' })
  unit!: string;

  @ApiProperty({ type: String, nullable: true, example: 'กระดาษชื้น ขอบยับ' })
  reason!: string | null;
}

export class ErpSupplierScorecardDto extends ErpSupplierScoreDto {
  @ApiProperty({ type: ErpRefDto })
  supplier!: ErpRefDto;

  @ApiProperty({ example: 4, description: 'Items approved from this supplier' })
  approvedItems!: number;

  @ApiProperty({ example: 1, description: 'Items still pending approval' })
  pendingItems!: number;

  @ApiProperty({ type: [ErpRejectionDto], description: 'Latest rejections, 12 months' })
  rejections!: ErpRejectionDto[];
}

// ============================================================================ alerts (D-347, D-358)

export class ErpAlertDto {
  @ApiProperty({ format: 'uuid', example: E3_IDS.alert })
  id!: string;

  @ApiProperty({ enum: ERP_ALERT_KINDS, enumName: 'ErpAlertKind', example: 'price_rise' })
  kind!: string;

  @ApiProperty({ enum: ERP_ALERT_STATUSES, enumName: 'ErpAlertStatus', example: 'open' })
  status!: string;

  @ApiProperty({
    example: 'item',
    description: 'What it is about: item, trading_partner, machine, maintenance_order, document',
  })
  subjectType!: string;

  @ApiProperty({ format: 'uuid', example: ERP_IDS.item })
  subjectId!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: {
      item: 'กระดาษคราฟท์ 350 แกรม',
      supplier: 'บจก. กระดาษไทย',
      changePct: '7.02',
      documentNo: 'GR-2610-0004',
    },
    description: 'Names, numbers and dates to show, by kind',
  })
  payload!: Record<string, unknown>;

  @ApiProperty({ type: String, nullable: true, format: 'date', example: null })
  dueOn!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-12T14:02:00+07:00' })
  createdAt!: string;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: null })
  acknowledgedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  acknowledgedBy!: string | null;
}

export class ErpAlertListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ERP_ALERT_STATUSES, enumName: 'ErpAlertStatus', example: 'open' })
  @IsOptional()
  @IsIn(ERP_ALERT_STATUSES)
  status?: string;

  @ApiPropertyOptional({ enum: ERP_ALERT_KINDS, enumName: 'ErpAlertKind' })
  @IsOptional()
  @IsIn(ERP_ALERT_KINDS)
  kind?: string;
}

export class ErpAlertCountDto {
  @ApiProperty({ example: 3 })
  open!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'integer' },
    example: { price_rise: 1, maintenance_due: 2 },
  })
  byKind!: Record<string, number>;
}

// ======================================================================= requests for quotation (D-348)

export class ErpRfqLineDto {
  @ApiProperty({ format: 'uuid', example: E3_IDS.rfqLine })
  id!: string;

  @ApiProperty({ example: 1 })
  lineNo!: number;

  @ApiProperty({ type: ErpItemRefDto })
  item!: ErpItemRefDto;

  @ApiProperty({ example: '25000.000', description: 'Base units wanted' })
  quantity!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;
}

export class ErpRfqQuoteDto {
  @ApiProperty({ format: 'uuid', example: E3_IDS.rfqQuote })
  id!: string;

  @ApiProperty({ format: 'uuid', example: E3_IDS.rfqLine })
  rfqLineId!: string;

  @ApiProperty({ enum: ERP_UNITS, enumName: 'ErpUnit', example: 'ream' })
  unit!: string;

  @ApiProperty({ example: '500.000000' })
  factor!: string;

  @ApiProperty({ example: '1390.000000', description: 'Per `unit`, net, without VAT' })
  unitPrice!: string;

  @ApiProperty({ example: '2.780000' })
  baseUnitPrice!: string;

  @ApiProperty({ type: String, nullable: true, example: '10.000' })
  minOrderQty!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 5 })
  leadTimeDays!: number | null;

  @ApiProperty({ type: String, nullable: true, format: 'date', example: '2026-11-30' })
  validUntil!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ example: false })
  awarded!: boolean;

  @ApiProperty({
    type: ErpRefDto,
    nullable: true,
    description: 'The purchase order it became (code = PO no.)',
  })
  purchaseOrder!: ErpRefDto | null;
}

export class ErpRfqSupplierDto {
  @ApiProperty({ format: 'uuid', example: E3_IDS.rfqSupplier })
  id!: string;

  @ApiProperty({ type: ErpRefDto })
  supplier!: ErpRefDto;

  @ApiProperty({ enum: ERP_RFQ_SUPPLIER_STATUSES, enumName: 'ErpRfqSupplierStatus', example: 'quoted' })
  status!: string;

  @ApiProperty({ type: String, nullable: true, format: 'date', example: '2026-10-14' })
  respondedOn!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'QT-6610-220',
    description: 'Their quotation number',
  })
  reference!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ type: [ErpRfqQuoteDto] })
  quotes!: ErpRfqQuoteDto[];
}

export class ErpRfqSummaryDto {
  @ApiProperty({ format: 'uuid', example: E3_IDS.rfq })
  id!: string;

  @ApiProperty({ example: 'RFQ-2610-0002' })
  rfqNo!: string;

  @ApiProperty({ enum: ERP_RFQ_STATUSES, enumName: 'ErpRfqStatus', example: 'sent' })
  status!: string;

  @ApiProperty({ example: 'กระดาษคราฟท์ ไตรมาส 4' })
  title!: string;

  @ApiProperty({ type: String, nullable: true, format: 'date', example: '2026-10-16' })
  quoteBy!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date', example: '2026-10-25' })
  neededBy!: string | null;

  @ApiProperty({ example: 2 })
  lineCount!: number;

  @ApiProperty({ example: 3 })
  supplierCount!: number;

  @ApiProperty({ example: 2, description: 'Suppliers who answered (quoted or declined)' })
  answered!: number;

  @ApiProperty({ example: 'จัดซื้อ ทดสอบ' })
  createdBy!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-12T09:00:00+07:00' })
  createdAt!: string;
}

export class ErpRfqDto extends ErpRfqSummaryDto {
  @ApiProperty({ type: String, nullable: true, example: 'ส่งราคารวมค่าขนส่งถึงโรงงาน' })
  note!: string | null;

  @ApiProperty({
    type: ErpRefDto,
    nullable: true,
    description: 'The purchase request it came from (code = PR no.)',
  })
  purchaseRequest!: ErpRefDto | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: '2026-10-12T09:30:00+07:00' })
  sentAt!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: null })
  awardedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  cancelReason!: string | null;

  @ApiProperty({ type: [ErpRfqLineDto] })
  lines!: ErpRfqLineDto[];

  @ApiProperty({ type: [ErpRfqSupplierDto] })
  suppliers!: ErpRfqSupplierDto[];

  @ApiProperty({
    type: [NextActionDto],
    description:
      'Offered: `erp_rfq.edit`, `erp_rfq.send`, `erp_rfq.record`, `erp_rfq.award`, `erp_rfq.cancel`',
  })
  nextActions!: NextActionDto[];

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ErpRfqListQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: [...ERP_RFQ_STATUSES, 'open'],
    enumName: 'ErpRfqStatusFilter',
    example: 'open',
    description: '`open` = draft or sent',
  })
  @IsOptional()
  @IsIn([...ERP_RFQ_STATUSES, 'open'])
  status?: string;
}

export class ErpRfqLineInput {
  @ApiProperty({ format: 'uuid', example: ERP_IDS.item })
  @IsUUID()
  itemId!: string;

  @ApiProperty({ example: '25000', pattern: QTY.source, description: 'Base units' })
  @Matches(QTY)
  quantity!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 300 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class ErpSaveRfqDto {
  @ApiProperty({ example: 'กระดาษคราฟท์ ไตรมาส 4', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date', example: '2026-10-16' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(DAY)
  quoteBy?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date', example: '2026-10-25' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(DAY)
  neededBy?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 1000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'An approved purchase request: its open lines are used when `lines` is empty',
  })
  @IsOptional()
  @IsUUID()
  purchaseRequestId?: string;

  @ApiPropertyOptional({ type: [ErpRfqLineInput] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ErpRfqLineInput)
  lines?: ErpRfqLineInput[];

  @ApiProperty({ type: [String], format: 'uuid', example: [ERP_IDS.supplier], description: '1–20 suppliers' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  supplierIds!: string[];
}

export class ErpQuoteInput {
  @ApiProperty({ format: 'uuid', example: E3_IDS.rfqLine })
  @IsUUID()
  rfqLineId!: string;

  @ApiProperty({ example: '1390', pattern: PRICE.source, description: 'Per `unit`, net, without VAT' })
  @Matches(PRICE)
  unitPrice!: string;

  @ApiPropertyOptional({
    enum: ERP_UNITS,
    enumName: 'ErpUnit',
    description: 'Default: the supplier’s unit for the item',
  })
  @IsOptional()
  @IsIn(ERP_UNITS)
  unit?: string;

  @ApiPropertyOptional({ example: '500', pattern: PRICE.source, description: 'Base units per `unit`' })
  @IsOptional()
  @Matches(PRICE)
  factor?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '10', pattern: QTY.source })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(QTY)
  minOrderQty?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 5, minimum: 0, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  leadTimeDays?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date', example: '2026-11-30' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(DAY)
  validUntil?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 300 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class ErpRecordQuoteDto {
  @ApiPropertyOptional({ type: String, nullable: true, example: 'QT-6610-220', maxLength: 60 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(60)
  reference?: string | null;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-14', description: 'Default: today' })
  @IsOptional()
  @Matches(DAY)
  respondedOn?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 500 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @ApiProperty({
    type: [ErpQuoteInput],
    description: 'One per line the supplier priced (replaces earlier ones)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ErpQuoteInput)
  quotes!: ErpQuoteInput[];
}

export class ErpRfqOfferDto {
  @ApiProperty({ format: 'uuid', example: E3_IDS.rfqQuote })
  quoteId!: string;

  @ApiProperty({ type: ErpRefDto })
  supplier!: ErpRefDto;

  @ApiProperty({ enum: ERP_UNITS, enumName: 'ErpUnit', example: 'ream' })
  unit!: string;

  @ApiProperty({ example: '1390.000000' })
  unitPrice!: string;

  @ApiProperty({ example: '2.780000' })
  baseUnitPrice!: string;

  @ApiProperty({
    example: '50.000',
    description: 'Units to order: the quantity rounded to whole units and the minimum',
  })
  orderQty!: string;

  @ApiProperty({ example: '25000.000' })
  orderBaseQty!: string;

  @ApiProperty({ example: '69500.00', description: 'orderQty × unitPrice, without VAT' })
  amount!: string;

  @ApiProperty({ type: Number, nullable: true, example: 5 })
  leadTimeDays!: number | null;

  @ApiProperty({ type: String, nullable: true, format: 'date', example: '2026-11-30' })
  validUntil!: string | null;

  @ApiProperty({ example: false })
  expired!: boolean;

  @ApiProperty({ enum: ERP_SUPPLIER_APPROVALS, enumName: 'ErpSupplierApproval', example: 'approved' })
  approval!: string;

  @ApiProperty({ type: String, nullable: true, example: '92.73' })
  score!: string | null;

  @ApiProperty({ enum: ERP_GRADES, enumName: 'ErpSupplierGrade', nullable: true, example: 'B' })
  grade!: string | null;

  @ApiProperty({ example: true, description: 'Lowest price per base unit of the line' })
  cheapest!: boolean;

  @ApiProperty({ example: false, description: 'Shortest lead time of the line' })
  fastest!: boolean;

  @ApiProperty({ example: false })
  awarded!: boolean;
}

export class ErpRfqComparisonLineDto {
  @ApiProperty({ type: ErpRfqLineDto })
  line!: ErpRfqLineDto;

  @ApiProperty({ type: [ErpRfqOfferDto], description: 'Cheapest per base unit first' })
  offers!: ErpRfqOfferDto[];
}

export class ErpRfqComparisonDto {
  @ApiProperty({ type: ErpRfqSummaryDto })
  rfq!: ErpRfqSummaryDto;

  @ApiProperty({ type: [ErpRfqComparisonLineDto] })
  lines!: ErpRfqComparisonLineDto[];

  @ApiProperty({ example: '69500.00', description: 'Sum of the cheapest offer per line' })
  cheapestTotal!: string;
}

export class ErpAwardInput {
  @ApiProperty({ format: 'uuid', example: E3_IDS.rfqLine })
  @IsUUID()
  rfqLineId!: string;

  @ApiProperty({ format: 'uuid', example: E3_IDS.rfqQuote })
  @IsUUID()
  quoteId!: string;
}

export class ErpAwardRfqDto {
  @ApiProperty({
    type: [ErpAwardInput],
    description: 'One quote per line to buy; lines left out are not bought',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ErpAwardInput)
  awards!: ErpAwardInput[];
}

// ================================================================ receiving: inspection, landed cost

// ========================================================================== machine schedule (D-352)

export class ErpScheduleOrderRefDto {
  @ApiProperty({ format: 'uuid', example: E2_IDS.mo })
  id!: string;

  @ApiProperty({ example: 'MO-2610-0005' })
  moNo!: string;

  @ApiProperty({ example: 'JOB-2610-0012 · กล่องพับ' })
  title!: string;

  @ApiProperty({ example: 5 })
  priority!: number;

  @ApiProperty({ type: String, nullable: true, format: 'date', example: '2026-10-20' })
  dueOn!: string | null;

  @ApiProperty({ example: 'released' })
  status!: string;
}

export class ErpScheduleSlotDto {
  @ApiProperty({ format: 'uuid', example: E2_IDS.moOperation })
  operationId!: string;

  @ApiProperty({ example: 10 })
  seq!: number;

  @ApiProperty({ example: 'พิมพ์ออฟเซ็ท 4 สี' })
  name!: string;

  @ApiProperty({ type: ErpScheduleOrderRefDto })
  order!: ErpScheduleOrderRefDto;

  @ApiProperty({ example: 'pending' })
  status!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-13T08:30:00+07:00' })
  start!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-13T09:20:00+07:00' })
  end!: string;

  @ApiProperty({ example: false })
  locked!: boolean;

  @ApiProperty({ example: 50 })
  plannedMinutes!: number;

  @ApiProperty({ example: false, description: 'Ends after the order’s due date' })
  late!: boolean;
}

export class ErpScheduleBlockDto {
  @ApiProperty({ type: ErpRefDto, description: 'The maintenance order (code = MT number)' })
  maintenanceOrder!: ErpRefDto;

  @ApiProperty({ enum: ERP_MAINTENANCE_KINDS, enumName: 'ErpMaintenanceKind', example: 'preventive' })
  kind!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-14T13:00:00+07:00' })
  start!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-14T15:00:00+07:00' })
  end!: string;
}

export class ErpScheduleMachineDto {
  @ApiProperty({ type: ErpMachineRefDto })
  machine!: ErpMachineRefDto;

  @ApiProperty({ enum: ERP_MACHINE_STATES, enumName: 'ErpMachineState', example: 'running' })
  state!: string;

  @ApiProperty({ type: [ErpScheduleSlotDto] })
  slots!: ErpScheduleSlotDto[];

  @ApiProperty({ type: [ErpScheduleBlockDto] })
  blocks!: ErpScheduleBlockDto[];

  @ApiProperty({ example: 420, description: 'Planned minutes within the window' })
  loadMinutes!: number;
}

export class ErpScheduleDto {
  @ApiProperty({ format: 'date-time', example: '2026-10-13T00:00:00+07:00' })
  from!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-20T00:00:00+07:00' })
  to!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { '2026-10-13': { from: '08:00', to: '17:00' }, '2026-10-18': null },
    description: 'Opening hours per day in the window (`YYYY-MM-DD` → from/to, or null when closed)',
  })
  hours!: Record<string, { from: string; to: string } | null>;

  @ApiProperty({ type: [ErpScheduleMachineDto] })
  machines!: ErpScheduleMachineDto[];

  @ApiProperty({ type: [ErpScheduleSlotDto], description: 'Operations without a machine' })
  unassigned!: ErpScheduleSlotDto[];

  @ApiProperty({ example: 2, description: 'Open operations with no planned time yet (run auto-plan)' })
  unscheduled!: number;
}

export class ErpScheduleQuery {
  @ApiPropertyOptional({ format: 'date', example: '2026-10-13', description: 'Default: today' })
  @IsOptional()
  @Matches(DAY)
  from?: string;

  @ApiPropertyOptional({ example: 7, minimum: 1, maximum: 31 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  days?: number;
}

export class ErpLateOrderDto {
  @ApiProperty({ type: ErpScheduleOrderRefDto })
  order!: ErpScheduleOrderRefDto;

  @ApiProperty({ format: 'date-time', example: '2026-10-21T11:00:00+07:00' })
  finishesAt!: string;
}

export class ErpAutoPlanResultDto {
  @ApiProperty({ example: 6, description: 'Operations given a new time' })
  placed!: number;

  @ApiProperty({ example: 2, description: 'Operations kept: running, paused or locked' })
  kept!: number;

  @ApiProperty({ type: [ErpLateOrderDto] })
  late!: ErpLateOrderDto[];
}

export class ErpMoveOperationDto {
  @ApiProperty({ format: 'date-time', example: '2026-10-13T13:00:00+07:00' })
  @IsISO8601()
  start!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'uuid',
    description: 'Another machine (or none)',
  })
  @IsOptional()
  @IsUUID()
  machineId?: string | null;

  @ApiPropertyOptional({ example: true, description: 'Default true: a hand-placed operation stays put' })
  @IsOptional()
  @IsBoolean()
  locked?: boolean;

  @ApiPropertyOptional({ example: 50, minimum: 1, maximum: 10080 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10080)
  plannedMinutes?: number;
}

export class ErpLockOperationDto {
  @ApiProperty({ example: false })
  @IsBoolean()
  locked!: boolean;
}

// ============================================================================= shop floor (D-353, D-354)

export class ErpPauseOperationDto {
  @ApiProperty({ enum: ERP_PAUSE_REASONS, enumName: 'ErpPauseReason', example: 'material_shortage' })
  @IsIn(ERP_PAUSE_REASONS)
  reason!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'รอกระดาษจากคลัง', maxLength: 300 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class ErpFinishOperationDto {
  @ApiPropertyOptional({ example: '1000', pattern: QTY.source, description: 'Default: the order quantity' })
  @IsOptional()
  @Matches(QTY)
  goodQty?: string;

  @ApiPropertyOptional({ example: '12', pattern: QTY.source })
  @IsOptional()
  @Matches(QTY)
  scrapQty?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 300 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'Photos for a getpack job step that needs them (D-354)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  photoFileIds?: string[];
}

export class ErpOperationEventDto {
  @ApiProperty({ format: 'uuid', example: E3_IDS.event })
  id!: string;

  @ApiProperty({ enum: ERP_OPERATION_EVENT_KINDS, enumName: 'ErpOperationEventKind', example: 'pause' })
  kind!: string;

  @ApiProperty({
    nullable: true,
    enum: ERP_PAUSE_REASONS,
    enumName: 'ErpPauseReason',
    example: 'setup',
  })
  reason!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  goodQty!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  scrapQty!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-13T09:02:00+07:00' })
  at!: string;

  @ApiProperty({ example: 'ช่างพิมพ์ ทดสอบ' })
  by!: string;
}

export class ErpMaintenanceRefDto {
  @ApiProperty({ format: 'uuid', example: E3_IDS.mt })
  id!: string;

  @ApiProperty({ example: 'MT-2610-0003' })
  mtNo!: string;

  @ApiProperty({ example: 'ลูกกลิ้งหมึกมีเสียงดัง' })
  title!: string;

  @ApiProperty({ enum: ERP_MAINTENANCE_STATUSES, enumName: 'ErpMaintenanceStatus', example: 'open' })
  status!: string;

  @ApiProperty({ enum: ERP_MAINTENANCE_PRIORITIES, enumName: 'ErpMaintenancePriority', example: 'high' })
  priority!: string;
}

export class ErpPlanDueDto {
  @ApiProperty({ format: 'uuid', example: E3_IDS.plan })
  planId!: string;

  @ApiProperty({ example: 'ล้างระบบหมึก + อัดจาระบี' })
  title!: string;

  @ApiProperty({ type: Number, nullable: true, example: 4 })
  daysLeft!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 12000 })
  impressionsLeft!: number | null;

  @ApiProperty({ example: false })
  due!: boolean;
}

export class ErpMachineDto {
  @ApiProperty({ format: 'uuid', example: E2_IDS.machine })
  id!: string;

  @ApiProperty({ example: 'Heidelberg SM 74 (ทดสอบ)' })
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: 'ออฟเซ็ท 4 สี' })
  details!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 520 })
  maxWidthMm!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 740 })
  maxLengthMm!: number | null;

  @ApiProperty({ enum: ['active', 'inactive'], enumName: 'CapabilityStatus', example: 'active' })
  status!: string;

  @ApiProperty({
    enum: ERP_MACHINE_STATES,
    enumName: 'ErpMachineState',
    example: 'running',
    description: 'down = an open breakdown; maintenance = a maintenance order in progress',
  })
  state!: string;

  @ApiProperty({ type: ErpOperationQueueItemDto, nullable: true, description: 'What runs on it now' })
  running!: ErpOperationQueueItemDto | null;

  @ApiProperty({ example: 3, description: 'Operations queued for it' })
  queued!: number;

  @ApiProperty({ type: ErpMaintenanceRefDto, nullable: true })
  openMaintenance!: ErpMaintenanceRefDto | null;

  @ApiProperty({ type: [ErpPlanDueDto] })
  plans!: ErpPlanDueDto[];

  @ApiProperty({ example: '182000', description: 'Impressions (good + scrap) finished on it, 30 days' })
  impressions30d!: string;
}

export class ErpDispatchDto {
  @ApiProperty({ type: ErpMachineDto })
  machine!: ErpMachineDto;

  @ApiProperty({ type: ErpOperationQueueItemDto, nullable: true, description: 'Running or paused now' })
  current!: ErpOperationQueueItemDto | null;

  @ApiProperty({ type: [ErpOperationQueueItemDto], description: 'Next, in planned order' })
  next!: ErpOperationQueueItemDto[];
}

export class ErpDispatchQuery {
  @ApiPropertyOptional({
    example: 'MO-2610-0005',
    maxLength: 40,
    description: 'An order number typed or scanned',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  q?: string;
}

// ============================================================================== maintenance (D-355)

export class ErpPlanPartDto {
  @ApiProperty({ type: ErpItemRefDto })
  item!: ErpItemRefDto;

  @ApiProperty({ example: '1.000', description: 'Base units' })
  quantity!: string;
}

export class ErpMaintenancePlanDto {
  @ApiProperty({ format: 'uuid', example: E3_IDS.plan })
  id!: string;

  @ApiProperty({ type: ErpMachineRefDto })
  machine!: ErpMachineRefDto;

  @ApiProperty({ example: 'ล้างระบบหมึก + อัดจาระบี' })
  title!: string;

  @ApiProperty({ type: String, nullable: true, example: '1) ล้างลูกกลิ้ง 2) อัดจาระบีจุด A–F' })
  instructions!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 30 })
  everyDays!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 500000 })
  everyImpressions!: number | null;

  @ApiProperty({ example: 120 })
  durationMinutes!: number;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: '2026-09-15T16:00:00+07:00' })
  lastDoneAt!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 4 })
  daysLeft!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 120000 })
  impressionsLeft!: number | null;

  @ApiProperty({ example: false })
  due!: boolean;

  @ApiProperty({ type: [ErpPlanPartDto] })
  parts!: ErpPlanPartDto[];

  @ApiProperty({ enum: ERP_RECORD_STATUSES, enumName: 'BrandKitStatus', example: 'active' })
  status!: string;

  @ApiProperty({ type: ErpMaintenanceRefDto, nullable: true, description: 'Its order still open' })
  openOrder!: ErpMaintenanceRefDto | null;

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ErpPlanPartInput {
  @ApiProperty({ format: 'uuid', example: ERP_IDS.item })
  @IsUUID()
  itemId!: string;

  @ApiProperty({ example: '1', pattern: QTY.source })
  @Matches(QTY)
  quantity!: string;
}

export class ErpSaveMaintenancePlanDto {
  @ApiProperty({ format: 'uuid', example: E2_IDS.machine })
  @IsUUID()
  machineId!: string;

  @ApiProperty({ example: 'ล้างระบบหมึก + อัดจาระบี', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 4000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(4000)
  instructions?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 30, minimum: 1, maximum: 3650 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  everyDays?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 500000, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  everyImpressions?: number | null;

  @ApiPropertyOptional({ example: 120, minimum: 5, maximum: 10080 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(10080)
  durationMinutes?: number;

  @ApiPropertyOptional({ type: [ErpPlanPartInput] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ErpPlanPartInput)
  parts?: ErpPlanPartInput[];

  @ApiPropertyOptional({ enum: ERP_RECORD_STATUSES, enumName: 'BrandKitStatus', example: 'active' })
  @IsOptional()
  @IsIn(ERP_RECORD_STATUSES)
  status?: string;
}

export class ErpMaintenancePartDto {
  @ApiProperty({ format: 'uuid', example: E3_IDS.mtPart })
  id!: string;

  @ApiProperty({ type: ErpItemRefDto })
  item!: ErpItemRefDto;

  @ApiProperty({ type: ErpRefDto })
  warehouse!: ErpRefDto;

  @ApiProperty({ example: '2.000' })
  quantity!: string;

  @ApiProperty({ example: '350.000000' })
  unitCost!: string;

  @ApiProperty({ example: '700.00' })
  value!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-13T10:00:00+07:00' })
  at!: string;

  @ApiProperty({ example: 'ช่าง ทดสอบ' })
  by!: string;
}

export class ErpMaintenancePhotoDto {
  @ApiProperty({ format: 'uuid', example: E3_IDS.file })
  fileId!: string;

  @ApiProperty({ example: 'roller.jpg' })
  name!: string;

  @ApiProperty({ example: 'image/jpeg' })
  mimeType!: string;
}

export class ErpMaintenanceOrderSummaryDto extends ErpMaintenanceRefDto {
  @ApiProperty({ enum: ERP_MAINTENANCE_KINDS, enumName: 'ErpMaintenanceKind', example: 'breakdown' })
  kind!: string;

  @ApiProperty({ type: ErpMachineRefDto })
  machine!: ErpMachineRefDto;

  @ApiProperty({ format: 'date-time', example: '2026-10-13T09:05:00+07:00' })
  reportedAt!: string;

  @ApiProperty({ type: String, nullable: true, example: 'ช่างพิมพ์ ทดสอบ' })
  reportedBy!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: null })
  scheduledStart!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: null })
  scheduledEnd!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: null })
  downtimeMinutes!: number | null;
}

export class ErpMaintenanceOrderDto extends ErpMaintenanceOrderSummaryDto {
  @ApiProperty({ type: String, nullable: true, example: 'เสียงดังจากชุดหมึกหน่วยที่ 3' })
  description!: string | null;

  @ApiProperty({ type: ErpRefDto, nullable: true, description: 'The preventive plan (code = machine name)' })
  plan!: ErpRefDto | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  instructions!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: null })
  startedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: null })
  finishedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  resolution!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  cancelReason!: string | null;

  @ApiProperty({ type: [ErpMaintenancePhotoDto] })
  photos!: ErpMaintenancePhotoDto[];

  @ApiProperty({ type: [ErpMaintenancePartDto] })
  parts!: ErpMaintenancePartDto[];

  @ApiProperty({ example: '700.00' })
  partsValue!: string;

  @ApiProperty({ type: [ErpPlanPartDto], description: 'Parts the plan lists, for a preventive order' })
  plannedParts!: ErpPlanPartDto[];

  @ApiProperty({
    type: [NextActionDto],
    description:
      'Offered: `erp_mt.schedule`, `erp_mt.start`, `erp_mt.parts`, `erp_mt.finish`, `erp_mt.cancel` (irreversible)',
  })
  nextActions!: NextActionDto[];

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ErpMaintenanceListQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: [...ERP_MAINTENANCE_STATUSES, 'open_all'],
    enumName: 'ErpMaintenanceStatusFilter',
    example: 'open_all',
    description: '`open_all` = open, scheduled or in progress',
  })
  @IsOptional()
  @IsIn([...ERP_MAINTENANCE_STATUSES, 'open_all'])
  status?: string;

  @ApiPropertyOptional({ enum: ERP_MAINTENANCE_KINDS, enumName: 'ErpMaintenanceKind' })
  @IsOptional()
  @IsIn(ERP_MAINTENANCE_KINDS)
  kind?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  machineId?: string;
}

export class ErpReportBreakdownDto {
  @ApiProperty({ format: 'uuid', example: E2_IDS.machine })
  @IsUUID()
  machineId!: string;

  @ApiProperty({ example: 'ลูกกลิ้งหมึกมีเสียงดัง', maxLength: 200 })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'เสียงดังจากชุดหมึกหน่วยที่ 3',
    maxLength: 2000,
  })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({
    enum: ERP_MAINTENANCE_PRIORITIES,
    enumName: 'ErpMaintenancePriority',
    example: 'high',
  })
  @IsOptional()
  @IsIn(ERP_MAINTENANCE_PRIORITIES)
  priority?: string;

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  photoFileIds?: string[];
}

export class ErpScheduleMaintenanceDto {
  @ApiProperty({ format: 'date-time', example: '2026-10-14T13:00:00+07:00' })
  @IsISO8601()
  start!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-14T15:00:00+07:00' })
  @IsISO8601()
  end!: string;
}

export class ErpFinishMaintenanceDto {
  @ApiProperty({ example: 'เปลี่ยนลูกปืนลูกกลิ้ง ทดสอบเดินเครื่องปกติ', maxLength: 2000 })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  resolution!: string;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 95,
    description: 'Default: from start (or report, for a breakdown) to now',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  downtimeMinutes?: number | null;
}

export class ErpMaintenancePartsDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Default: the default warehouse' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiProperty({ type: [ErpPlanPartInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ErpPlanPartInput)
  lines!: ErpPlanPartInput[];
}

// ================================================================================ documents (D-356)

export class ErpDocFolderDto {
  @ApiProperty({ format: 'uuid', example: E3_IDS.folder })
  id!: string;

  @ApiProperty({ example: 'ใบรับรอง' })
  name!: string;

  @ApiProperty({ type: String, nullable: true, format: 'uuid', example: null })
  parentId!: string | null;

  @ApiProperty({ example: 4, description: 'Active documents directly in it' })
  docCount!: number;
}

export class ErpSaveFolderDto {
  @ApiProperty({ example: 'ใบรับรอง', maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}

export class ErpDocFileDto {
  @ApiProperty({ format: 'uuid', example: E3_IDS.file })
  id!: string;

  @ApiProperty({ example: 'FSC-certificate-2026.pdf' })
  name!: string;

  @ApiProperty({ example: 'application/pdf' })
  mimeType!: string;

  @ApiProperty({ example: 284311 })
  sizeBytes!: number;
}

export class ErpDocVersionDto {
  @ApiProperty({ format: 'uuid', example: E3_IDS.docVersion })
  id!: string;

  @ApiProperty({ example: 2 })
  version!: number;

  @ApiProperty({ type: ErpDocFileDto })
  file!: ErpDocFileDto;

  @ApiProperty({ type: String, nullable: true, example: 'ต่ออายุ 2026' })
  note!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-12T10:00:00+07:00' })
  createdAt!: string;

  @ApiProperty({ example: 'เจ้าของ ทดสอบ' })
  by!: string;
}

export class ErpDocLinkDto {
  @ApiProperty({ enum: ERP_DOC_LINKS, enumName: 'ErpDocLink', example: 'trading_partner' })
  type!: string;

  @ApiProperty({ format: 'uuid', example: ERP_IDS.supplier })
  id!: string;

  @ApiProperty({ example: 'S0001 · บจก. กระดาษไทย' })
  label!: string;
}

export class ErpDocSummaryDto {
  @ApiProperty({ format: 'uuid', example: E3_IDS.doc })
  id!: string;

  @ApiProperty({ example: 'ใบรับรอง FSC — กระดาษไทย' })
  title!: string;

  @ApiProperty({ enum: ERP_DOC_CATEGORIES, enumName: 'ErpDocCategory', example: 'certificate' })
  category!: string;

  @ApiProperty({ type: [String], example: ['FSC', 'supplier'] })
  tags!: string[];

  @ApiProperty({ type: ErpDocFolderDto, nullable: true })
  folder!: ErpDocFolderDto | null;

  @ApiProperty({ type: ErpDocLinkDto, nullable: true })
  link!: ErpDocLinkDto | null;

  @ApiProperty({ type: String, nullable: true, format: 'date', example: '2027-03-31' })
  expiresOn!: string | null;

  @ApiProperty({ enum: ERP_DOC_EXPIRY, enumName: 'ErpDocExpiry', example: 'valid' })
  expiry!: string;

  @ApiProperty({ example: 2 })
  currentVersion!: number;

  @ApiProperty({ type: ErpDocFileDto })
  file!: ErpDocFileDto;

  @ApiProperty({ enum: ERP_RECORD_STATUSES, enumName: 'BrandKitStatus', example: 'active' })
  status!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-12T10:00:00+07:00' })
  updatedAt!: string;
}

export class ErpDocDto extends ErpDocSummaryDto {
  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ example: 30 })
  remindDays!: number;

  @ApiProperty({ type: [ErpDocVersionDto], description: 'Newest first' })
  versions!: ErpDocVersionDto[];

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ErpDocListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid', description: 'Documents directly in this folder' })
  @IsOptional()
  @IsUUID()
  folderId?: string;

  @ApiPropertyOptional({ enum: ERP_DOC_LINKS, enumName: 'ErpDocLink' })
  @IsOptional()
  @IsIn(ERP_DOC_LINKS)
  linkType?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  linkId?: string;

  @ApiPropertyOptional({ enum: ERP_DOC_CATEGORIES, enumName: 'ErpDocCategory' })
  @IsOptional()
  @IsIn(ERP_DOC_CATEGORIES)
  category?: string;

  @ApiPropertyOptional({
    enum: ['expiring', 'expired'],
    enumName: 'ErpDocExpiryFilter',
    description: 'Within their reminder window, or past it',
  })
  @IsOptional()
  @IsIn(['expiring', 'expired'])
  expiry?: string;

  @ApiPropertyOptional({ enum: ERP_RECORD_STATUSES, enumName: 'BrandKitStatus', example: 'active' })
  @IsOptional()
  @IsIn(ERP_RECORD_STATUSES)
  status?: string;
}

export class ErpCreateDocDto {
  @ApiProperty({ example: 'ใบรับรอง FSC — กระดาษไทย', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ enum: ERP_DOC_CATEGORIES, enumName: 'ErpDocCategory', example: 'certificate' })
  @IsOptional()
  @IsIn(ERP_DOC_CATEGORIES)
  category?: string;

  @ApiPropertyOptional({ type: [String], example: ['FSC'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  folderId?: string | null;

  @ApiPropertyOptional({ enum: ERP_DOC_LINKS, enumName: 'ErpDocLink', nullable: true })
  @IsOptional()
  @IsIn(ERP_DOC_LINKS)
  linkType?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  linkId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date', example: '2027-03-31' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(DAY)
  expiresOn?: string | null;

  @ApiPropertyOptional({ example: 30, minimum: 0, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  remindDays?: number;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 1000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @ApiProperty({
    format: 'uuid',
    example: E3_IDS.file,
    description: 'An uploaded file (presign → upload → complete)',
  })
  @IsUUID()
  fileId!: string;
}

export class ErpUpdateDocDto {
  @ApiPropertyOptional({ example: 'ใบรับรอง FSC — กระดาษไทย', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ enum: ERP_DOC_CATEGORIES, enumName: 'ErpDocCategory' })
  @IsOptional()
  @IsIn(ERP_DOC_CATEGORIES)
  category?: string;

  @ApiPropertyOptional({ type: [String], example: ['FSC'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  @IsOptional()
  folderId?: string | null;

  @ApiPropertyOptional({ enum: ERP_DOC_LINKS, enumName: 'ErpDocLink', nullable: true })
  @IsOptional()
  linkType?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  @IsOptional()
  linkId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date', example: '2027-03-31' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(DAY)
  expiresOn?: string | null;

  @ApiPropertyOptional({ example: 30, minimum: 0, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  remindDays?: number;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 1000 })
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

export class ErpAddDocVersionDto {
  @ApiProperty({ format: 'uuid', example: E3_IDS.file })
  @IsUUID()
  fileId!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'ต่ออายุ 2027', maxLength: 300 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'date',
    example: '2028-03-31',
    description: 'The new version’s expiry (a renewed certificate)',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(DAY)
  expiresOn?: string | null;
}
