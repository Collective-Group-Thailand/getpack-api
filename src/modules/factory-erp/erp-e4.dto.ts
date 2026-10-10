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
  IsEmail,
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

import { AMOUNT, DAY, ERP_UNITS, ErpItemRefDto, ErpRefDto, PCT, PRICE, QTY } from './erp.dto';
import { ERP_PAYMENT_METHODS, ErpAgingBucketsDto } from './erp-e2.dto';

/** Every reason body (lose, void, decline) is the common `ReasonDto`. */
export {
  ReasonDto as ErpLoseDto,
  ReasonDto as ErpVoidDto,
  ReasonDto as PublicDeclineQuotationDto,
} from '@common/dto/reason.dto';

/**
 * Packio Factory ERP E4 (docs/prompts/E1-factory-erp.md §11, D-359 – D-371): CRM, quotations with a customer
 * link, sales orders, delivery notes, the factory's own invoices / tax invoices, credit and debit notes,
 * receipts, billing notes, receivables aging, 50 ทวิ certificates, VAT / WHT reports and sales targets.
 */

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  value === '' || (typeof value === 'string' && value.trim() === '') ? null : value;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const E4_IDS = {
  lead: '0192f3a0-7c1e-7d2a-9b1f-00000000ef01',
  opportunity: '0192f3a0-7c1e-7d2a-9b1f-00000000ef02',
  activity: '0192f3a0-7c1e-7d2a-9b1f-00000000ef03',
  customer: '0192f3a0-7c1e-7d2a-9b1f-00000000ef04',
  quotation: '0192f3a0-7c1e-7d2a-9b1f-00000000ef05',
  quotationLine: '0192f3a0-7c1e-7d2a-9b1f-00000000ef06',
  salesOrder: '0192f3a0-7c1e-7d2a-9b1f-00000000ef07',
  salesOrderLine: '0192f3a0-7c1e-7d2a-9b1f-00000000ef08',
  deliveryNote: '0192f3a0-7c1e-7d2a-9b1f-00000000ef09',
  deliveryNoteLine: '0192f3a0-7c1e-7d2a-9b1f-00000000ef10',
  invoice: '0192f3a0-7c1e-7d2a-9b1f-00000000ef11',
  invoiceLine: '0192f3a0-7c1e-7d2a-9b1f-00000000ef12',
  creditNote: '0192f3a0-7c1e-7d2a-9b1f-00000000ef13',
  receipt: '0192f3a0-7c1e-7d2a-9b1f-00000000ef14',
  billingNote: '0192f3a0-7c1e-7d2a-9b1f-00000000ef15',
  certificate: '0192f3a0-7c1e-7d2a-9b1f-00000000ef16',
  target: '0192f3a0-7c1e-7d2a-9b1f-00000000ef17',
  salesperson: '0192f3a0-7c1e-7d2a-9b1f-00000000ef18',
  payment: '0192f3a0-7c1e-7d2a-9b1f-00000000ef19',
  file: '0192f3a0-7c1e-7d2a-9b1f-00000000ef20',
  productItem: '0192f3a0-7c1e-7d2a-9b1f-00000000ef21',
} as const;

export const ERP_LEAD_SOURCES = [
  'walk_in',
  'phone',
  'line',
  'facebook',
  'website',
  'referral',
  'exhibition',
  'packio',
  'other',
] as const;
export const ERP_LEAD_STAGES = ['new', 'contacted', 'qualified', 'converted', 'lost'] as const;
export const ERP_OPPORTUNITY_STAGES = ['prospecting', 'proposal', 'negotiation', 'won', 'lost'] as const;
export const ERP_ACTIVITY_KINDS = ['call', 'visit', 'meeting', 'email', 'line', 'task', 'note'] as const;
export const ERP_QUOTATION_STATUSES = [
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
  'superseded',
  'cancelled',
] as const;
export const ERP_SALES_ORDER_STATUSES = [
  'draft',
  'confirmed',
  'partially_delivered',
  'delivered',
  'closed',
  'cancelled',
] as const;
export const ERP_FULFILMENTS = ['stock', 'make', 'service'] as const;
export const ERP_DELIVERY_STATUSES = ['draft', 'issued', 'delivered', 'cancelled'] as const;
export const ERP_INVOICE_FORMS = ['invoice', 'invoice_receipt'] as const;
export const ERP_SALES_INVOICE_STATUSES = ['draft', 'issued', 'partially_paid', 'paid', 'voided'] as const;
export const ERP_SALES_NOTE_KINDS = ['credit', 'debit'] as const;
export const ERP_CREDIT_REASONS = [
  'price_reduced',
  'goods_returned',
  'defective',
  'discount_after_sale',
  'overcharged',
  'other',
] as const;
export const ERP_DEBIT_REASONS = ['price_increased', 'undercharged', 'extra_goods', 'other'] as const;
export const ERP_SALES_NOTE_REASONS = [
  'price_reduced',
  'goods_returned',
  'defective',
  'discount_after_sale',
  'overcharged',
  'price_increased',
  'undercharged',
  'extra_goods',
  'other',
] as const;
export const ERP_ISSUED_STATUSES = ['draft', 'issued', 'voided'] as const;
export const ERP_RECEIPT_KINDS = ['receipt', 'refund'] as const;
export const ERP_RECEIPT_STATUSES = ['issued', 'cancelled'] as const;
export const ERP_BILLING_STATUSES = ['issued', 'cancelled'] as const;
export const ERP_ENTITY_TYPES = ['juristic', 'individual'] as const;
export const ERP_WHT_FORMS = ['pnd3', 'pnd53'] as const;
export const ERP_WHT_INCOME_TYPES = [
  'fees_commission',
  'rent',
  'hire_of_work',
  'transport',
  'advertising',
  'service',
  'prize',
  'other',
] as const;
export const ERP_VAT_MODES_E4 = ['exclusive', 'inclusive', 'none'] as const;
export const ERP_SUBJECT_TYPES = ['lead', 'opportunity', 'customer'] as const;
export const ERP_TAX_REPORTS = ['sales_vat', 'purchase_vat', 'pnd3', 'pnd53', 'accounting'] as const;

// ===================================================================================== shared

export class ErpSalesLineInput {
  @ApiPropertyOptional({
    format: 'uuid',
    example: E4_IDS.productItem,
    description: 'An item of the factory (sold in its base unit); none for a free-text line',
  })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({
    example: 'กล่องลูกฟูก RSC 30×20×15 ซม. พิมพ์ 2 สี',
    maxLength: 300,
    description: 'Default: the item’s name; required without an item',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiProperty({ example: '5000', pattern: QTY.source })
  @Matches(QTY)
  quantity!: string;

  @ApiPropertyOptional({
    enum: ERP_UNITS,
    enumName: 'ErpUnit',
    description: 'Free-text lines only (default `pcs`); an item line is in its base unit',
  })
  @IsOptional()
  @IsIn(ERP_UNITS)
  unit?: string;

  @ApiProperty({ example: '12.5', pattern: PRICE.source, description: 'Per unit, before discount' })
  @Matches(PRICE)
  unitPrice!: string;

  @ApiPropertyOptional({ example: '0', pattern: PCT.source })
  @IsOptional()
  @Matches(PCT)
  discountPct?: string;
}

export class ErpSalesLineDto {
  @ApiProperty({ format: 'uuid', example: E4_IDS.quotationLine })
  id!: string;

  @ApiProperty({ example: 1 })
  lineNo!: number;

  @ApiProperty({ type: ErpItemRefDto, nullable: true })
  item!: ErpItemRefDto | null;

  @ApiProperty({ example: 'กล่องลูกฟูก RSC 30×20×15 ซม. พิมพ์ 2 สี' })
  description!: string;

  @ApiProperty({ example: '5000.000' })
  quantity!: string;

  @ApiProperty({ enum: ERP_UNITS, enumName: 'ErpUnit', example: 'pcs' })
  unit!: string;

  @ApiProperty({ example: '12.500000' })
  unitPrice!: string;

  @ApiProperty({ example: '0.0000' })
  discountPct!: string;

  @ApiProperty({ example: '62500.00', description: 'Quantity × price less the discount' })
  amount!: string;
}

/** The seller or buyer as printed on a document (frozen when it was issued). */
export class ErpDocPartyDto {
  @ApiProperty({ example: 'บริษัท กล่องดี แพคเกจจิ้ง จำกัด' })
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: '99/9 ถ.บางนา-ตราด ต.บางพลีใหญ่ อ.บางพลี จ.สมุทรปราการ 10540' })
  address!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '0000556123451' })
  taxId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '00000', description: '`00000` = head office' })
  branchCode!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '02-123-4567' })
  phone!: string | null;
}

export class ErpPdfLinkDto {
  @ApiProperty({ example: 'https://files.packio.example/erp/IV-2610-0001.pdf?sig=...' })
  url!: string;

  @ApiProperty({ example: 'IV-2610-0001.pdf' })
  fileName!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-15T10:05:00+07:00' })
  expiresAt!: string;
}

export class ErpMonthQuery {
  @ApiProperty({ example: '2026-10', pattern: MONTH.source, description: 'A Bangkok calendar month' })
  @Matches(MONTH)
  month!: string;
}

export class ErpWhtReportQuery extends ErpMonthQuery {
  @ApiPropertyOptional({ enum: ERP_WHT_FORMS, enumName: 'WhtForm', default: 'pnd53' })
  @IsOptional()
  @IsIn(ERP_WHT_FORMS)
  form?: string;
}

// =========================================================================================== CRM

export class ErpLeadDto {
  @ApiProperty({ format: 'uuid', example: E4_IDS.lead })
  id!: string;

  @ApiProperty({ example: 'ร้านขนมบ้านสวน' })
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: 'คุณสมศรี' })
  contactName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '080-000-1234' })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'somsri@example.com' })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '@bansuan' })
  lineId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'นนทบุรี' })
  address!: string | null;

  @ApiProperty({ enum: ERP_LEAD_SOURCES, enumName: 'ErpLeadSource', example: 'line' })
  source!: string;

  @ApiProperty({ enum: ERP_LEAD_STAGES, enumName: 'ErpLeadStage', example: 'qualified' })
  stage!: string;

  @ApiProperty({ type: String, nullable: true, example: '45000.00', description: 'Net, without VAT' })
  expectedValue!: string | null;

  @ApiProperty({ type: PersonRefDto, nullable: true })
  salesperson!: PersonRefDto | null;

  @ApiProperty({ type: ErpRefDto, nullable: true, description: 'The customer it became' })
  customer!: ErpRefDto | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  lostReason!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'สนใจกล่องเค้ก 2 ขนาด' })
  note!: string | null;

  @ApiProperty({ example: 2, description: 'Open activities' })
  openActivities!: number;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: null })
  convertedAt!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-12T09:00:00+07:00' })
  createdAt!: string;

  @ApiProperty({
    type: [NextActionDto],
    description: 'Offered: `erp_lead.edit`, `erp_lead.convert`, `erp_lead.lose`',
  })
  nextActions!: NextActionDto[];

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ErpSaveLeadDto {
  @ApiProperty({ example: 'ร้านขนมบ้านสวน', maxLength: 200 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'คุณสมศรี', maxLength: 120 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(120)
  contactName?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '080-000-1234', maxLength: 40 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'somsri@example.com', maxLength: 200 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsEmail()
  @MaxLength(200)
  email?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '@bansuan', maxLength: 60 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(60)
  lineId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'นนทบุรี', maxLength: 500 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @ApiPropertyOptional({ enum: ERP_LEAD_SOURCES, enumName: 'ErpLeadSource', example: 'line' })
  @IsOptional()
  @IsIn(ERP_LEAD_SOURCES)
  source?: string;

  @ApiPropertyOptional({
    enum: ['new', 'contacted', 'qualified'],
    enumName: 'ErpLeadOpenStage',
    example: 'contacted',
    description: 'Converting and losing have their own actions',
  })
  @IsOptional()
  @IsIn(['new', 'contacted', 'qualified'])
  stage?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '45000', pattern: AMOUNT.source })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(AMOUNT)
  expectedValue?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'uuid',
    example: E4_IDS.salesperson,
    description: 'A user of this factory; default: whoever creates the lead',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  salespersonId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'สนใจกล่องเค้ก 2 ขนาด', maxLength: 2000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export class ErpLeadListQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: [...ERP_LEAD_STAGES, 'open'],
    enumName: 'ErpLeadStageFilter',
    example: 'open',
    description: '`open` = new, contacted or qualified',
  })
  @IsOptional()
  @IsIn([...ERP_LEAD_STAGES, 'open'])
  stage?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Only this salesperson’s' })
  @IsOptional()
  @IsUUID()
  salespersonId?: string;

}

export class ErpConvertLeadDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'An existing trading partner to link (made a customer if it was a supplier only); none = create one',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    example: 'C0012',
    maxLength: 20,
    description: 'Code of the new customer (default: the next `C` number)',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{1,20}$/)
  code?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '0000556123451', pattern: '^\\d{13}$' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(/^\d{13}$/)
  taxId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '00000', pattern: '^\\d{5}$' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(/^\d{5}$/)
  branchCode?: string | null;

  @ApiPropertyOptional({ example: 30, minimum: 0, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermDays?: number;

  @ApiPropertyOptional({ type: Boolean, example: true, description: 'Also open an opportunity for it' })
  @IsOptional()
  @IsBoolean()
  openOpportunity?: boolean;
}

export class ErpConvertLeadResultDto {
  @ApiProperty({ type: ErpLeadDto })
  lead!: ErpLeadDto;

  @ApiProperty({ type: ErpRefDto })
  customer!: ErpRefDto;

  @ApiProperty({ type: String, nullable: true, format: 'uuid', example: E4_IDS.opportunity })
  opportunityId!: string | null;
}

export class ErpOpportunityDto {
  @ApiProperty({ format: 'uuid', example: E4_IDS.opportunity })
  id!: string;

  @ApiProperty({ example: 'กล่องเค้ก 2 ขนาด — ล็อตแรก' })
  title!: string;

  @ApiProperty({ enum: ERP_OPPORTUNITY_STAGES, enumName: 'ErpOpportunityStage', example: 'proposal' })
  stage!: string;

  @ApiProperty({ example: '45000.00', description: 'Net, without VAT' })
  value!: string;

  @ApiProperty({ example: 40, minimum: 0, maximum: 100 })
  probabilityPct!: number;

  @ApiProperty({ example: '18000.00', description: 'value × probability' })
  weightedValue!: string;

  @ApiProperty({ type: String, nullable: true, format: 'date', example: '2026-11-15' })
  expectedCloseOn!: string | null;

  @ApiProperty({ type: ErpRefDto, nullable: true })
  customer!: ErpRefDto | null;

  @ApiProperty({ type: ErpRefDto, nullable: true, description: 'code = lead id prefix' })
  lead!: ErpRefDto | null;

  @ApiProperty({ type: PersonRefDto, nullable: true })
  salesperson!: PersonRefDto | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  lostReason!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ example: 1, description: 'Quotations made for it' })
  quotations!: number;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: null })
  wonAt!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: null })
  closedAt!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-12T09:00:00+07:00' })
  createdAt!: string;

  @ApiProperty({
    type: [NextActionDto],
    description: 'Offered: `erp_opportunity.edit`, `erp_opportunity.quote`, `erp_opportunity.win`, `erp_opportunity.lose`',
  })
  nextActions!: NextActionDto[];

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ErpSaveOpportunityDto {
  @ApiProperty({ example: 'กล่องเค้ก 2 ขนาด — ล็อตแรก', maxLength: 200 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ format: 'uuid', example: E4_IDS.customer, description: 'A customer, or…' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: '…a lead (one of the two is required)' })
  @IsOptional()
  @IsUUID()
  leadId?: string;

  @ApiPropertyOptional({
    enum: ['prospecting', 'proposal', 'negotiation'],
    enumName: 'ErpOpportunityOpenStage',
    example: 'proposal',
  })
  @IsOptional()
  @IsIn(['prospecting', 'proposal', 'negotiation'])
  stage?: string;

  @ApiPropertyOptional({ example: '45000', pattern: AMOUNT.source })
  @IsOptional()
  @Matches(AMOUNT)
  value?: string;

  @ApiPropertyOptional({ example: 40, minimum: 0, maximum: 100, description: 'Default: by stage (10 / 40 / 70)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probabilityPct?: number;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date', example: '2026-11-15' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(DAY)
  expectedCloseOn?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid', example: E4_IDS.salesperson })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  salespersonId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 2000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export class ErpOpportunityListQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: [...ERP_OPPORTUNITY_STAGES, 'open'],
    enumName: 'ErpOpportunityStageFilter',
    example: 'open',
    description: '`open` = prospecting, proposal or negotiation',
  })
  @IsOptional()
  @IsIn([...ERP_OPPORTUNITY_STAGES, 'open'])
  stage?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  salespersonId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

}

export class ErpPipelineStageDto {
  @ApiProperty({ enum: ERP_OPPORTUNITY_STAGES, enumName: 'ErpOpportunityStage', example: 'proposal' })
  stage!: string;

  @ApiProperty({ example: 4 })
  count!: number;

  @ApiProperty({ example: '180000.00' })
  value!: string;

  @ApiProperty({ example: '72000.00' })
  weighted!: string;
}

export class ErpPipelineSalespersonDto {
  @ApiProperty({ type: PersonRefDto, nullable: true })
  salesperson!: PersonRefDto | null;

  @ApiProperty({ example: 6 })
  open!: number;

  @ApiProperty({ example: '240000.00' })
  value!: string;

  @ApiProperty({ example: '96000.00' })
  weighted!: string;
}

export class ErpPipelineDto {
  @ApiProperty({ type: [ErpPipelineStageDto], description: 'Open stages, then won and lost this month' })
  stages!: ErpPipelineStageDto[];

  @ApiProperty({ example: '240000.00', description: 'Open opportunities' })
  openValue!: string;

  @ApiProperty({ example: '96000.00' })
  openWeighted!: string;

  @ApiProperty({ example: 3, description: 'Open opportunities expected to close within 30 days' })
  closingSoon!: number;

  @ApiProperty({ type: [ErpPipelineSalespersonDto] })
  salespeople!: ErpPipelineSalespersonDto[];

  @ApiProperty({ example: 5, description: 'Activities due today or overdue for the caller' })
  myDue!: number;
}

export class ErpActivitySubjectDto {
  @ApiProperty({ enum: ERP_SUBJECT_TYPES, enumName: 'ErpActivitySubjectType', example: 'lead' })
  type!: string;

  @ApiProperty({ format: 'uuid', example: E4_IDS.lead })
  id!: string;

  @ApiProperty({ example: 'ร้านขนมบ้านสวน' })
  name!: string;
}

export class ErpActivityDto {
  @ApiProperty({ format: 'uuid', example: E4_IDS.activity })
  id!: string;

  @ApiProperty({ enum: ERP_ACTIVITY_KINDS, enumName: 'ErpActivityKind', example: 'call' })
  kind!: string;

  @ApiProperty({ example: 'โทรตามใบเสนอราคา' })
  subject!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  detail!: string | null;

  @ApiProperty({ type: ErpActivitySubjectDto })
  about!: ErpActivitySubjectDto;

  @ApiProperty({ type: PersonRefDto })
  assignee!: PersonRefDto;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: '2026-10-14T10:00:00+07:00' })
  dueAt!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: null })
  doneAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  outcome!: string | null;

  @ApiProperty({ example: false, description: 'Not done and past its due time' })
  overdue!: boolean;

  @ApiProperty({ example: 'ฝ่ายขาย ทดสอบ' })
  createdBy!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-12T09:00:00+07:00' })
  createdAt!: string;

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ErpSaveActivityDto {
  @ApiProperty({ enum: ERP_ACTIVITY_KINDS, enumName: 'ErpActivityKind', example: 'call' })
  @IsIn(ERP_ACTIVITY_KINDS)
  kind!: string;

  @ApiProperty({ example: 'โทรตามใบเสนอราคา', maxLength: 200 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 2000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(2000)
  detail?: string | null;

  @ApiPropertyOptional({ format: 'uuid', description: 'One of `leadId`, `opportunityId`, `customerId`' })
  @IsOptional()
  @IsUUID()
  leadId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  opportunityId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'A user of this factory; default: the caller' })
  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date-time', example: '2026-10-14T10:00:00+07:00' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsISO8601({ strict: true })
  dueAt?: string | null;

  @ApiPropertyOptional({ type: Boolean, example: false, description: 'Logged as already done (a call made, a note)' })
  @IsOptional()
  @IsBoolean()
  done?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 1000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  outcome?: string | null;
}

export class ErpCompleteActivityDto {
  @ApiPropertyOptional({ type: String, nullable: true, example: 'ลูกค้าขอส่งตัวอย่างก่อน', maxLength: 1000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  outcome?: string | null;
}

export class ErpActivityListQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: ['open', 'due', 'overdue', 'done', 'all'],
    enumName: 'ErpActivityFilter',
    example: 'due',
    description: '`due` = not done, due today or earlier; `open` = not done',
  })
  @IsOptional()
  @IsIn(['open', 'due', 'overdue', 'done', 'all'])
  view?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Default: everyone’s; `me` is the caller' })
  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional({ type: Boolean, description: 'Only the caller’s' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  mine?: boolean;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  leadId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  opportunityId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;
}

// ===================================================================================== quotations

export class ErpQuotationSummaryDto {
  @ApiProperty({ format: 'uuid', example: E4_IDS.quotation })
  id!: string;

  @ApiProperty({ example: 'QT-2610-0003' })
  quoteNo!: string;

  @ApiProperty({ example: 1 })
  revision!: number;

  @ApiProperty({ enum: ERP_QUOTATION_STATUSES, enumName: 'ErpQuotationStatus', example: 'sent' })
  status!: string;

  @ApiProperty({ type: ErpRefDto })
  customer!: ErpRefDto;

  @ApiProperty({ type: PersonRefDto, nullable: true })
  salesperson!: PersonRefDto | null;

  @ApiProperty({ format: 'date', example: '2026-10-12' })
  quoteDate!: string;

  @ApiProperty({ format: 'date', example: '2026-11-11' })
  validUntil!: string;

  @ApiProperty({ example: '66875.00' })
  total!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-12T09:00:00+07:00' })
  createdAt!: string;
}

export class ErpQuotationRevisionDto {
  @ApiProperty({ format: 'uuid', example: E4_IDS.quotation })
  id!: string;

  @ApiProperty({ example: 1 })
  revision!: number;

  @ApiProperty({ enum: ERP_QUOTATION_STATUSES, enumName: 'ErpQuotationStatus', example: 'superseded' })
  status!: string;

  @ApiProperty({ example: '70000.00' })
  total!: string;
}

export class ErpQuotationDto extends ErpQuotationSummaryDto {
  @ApiProperty({ type: ErpRefDto, nullable: true, description: 'The opportunity (code = its title)' })
  opportunity!: ErpRefDto | null;

  @ApiProperty({ example: 30 })
  paymentTermDays!: number;

  @ApiProperty({ type: Number, nullable: true, example: 14 })
  leadTimeDays!: number | null;

  @ApiProperty({ type: String, nullable: true, example: 'ราคานี้รวมค่าขนส่งในกรุงเทพฯ และปริมณฑล' })
  terms!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ enum: ERP_VAT_MODES_E4, enumName: 'ErpVatMode', example: 'exclusive' })
  vatMode!: string;

  @ApiProperty({ example: '7.0000' })
  vatRatePct!: string;

  @ApiProperty({ example: '62500.00' })
  subtotal!: string;

  @ApiProperty({ example: '4375.00' })
  vatAmount!: string;

  @ApiProperty({ type: [ErpSalesLineDto] })
  lines!: ErpSalesLineDto[];

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: '2026-10-12T10:00:00+07:00' })
  sentAt!: string | null;

  @ApiProperty({ example: true, description: 'The customer link works (sent, not expired)' })
  linkActive!: boolean;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: null })
  acceptedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  acceptedName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  acceptedPosition!: string | null;

  @ApiProperty({
    nullable: true,
    enum: ['link', 'factory'],
    enumName: 'ErpQuotationAcceptedVia',
    example: null,
    description: '`link` = the customer accepted online; `factory` = recorded by the factory',
  })
  acceptedVia!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  customerPoNo!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: null })
  rejectedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  rejectReason!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  cancelReason!: string | null;

  @ApiProperty({ type: ErpRefDto, nullable: true, description: 'The sales order made from it (code = SO no.)' })
  salesOrder!: ErpRefDto | null;

  @ApiProperty({ type: [ErpQuotationRevisionDto], description: 'Every revision of this number, oldest first' })
  revisions!: ErpQuotationRevisionDto[];

  @ApiProperty({
    type: [NextActionDto],
    description:
      'Offered: `erp_quote.edit`, `erp_quote.send`, `erp_quote.revise`, `erp_quote.accept`, `erp_quote.reject`, ' +
      '`erp_quote.order`, `erp_quote.cancel`, `erp_quote.pdf`',
  })
  nextActions!: NextActionDto[];

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ErpSaveQuotationDto {
  @ApiProperty({ format: 'uuid', example: E4_IDS.customer, description: 'A customer (or both)' })
  @IsUUID()
  customerId!: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid', example: E4_IDS.opportunity })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  opportunityId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid', example: E4_IDS.salesperson })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  salespersonId?: string | null;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-12', description: 'Default: today' })
  @IsOptional()
  @Matches(DAY)
  quoteDate?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-11-11', description: 'Default: + settings.quoteValidDays' })
  @IsOptional()
  @Matches(DAY)
  validUntil?: string;

  @ApiPropertyOptional({ example: 30, minimum: 0, maximum: 365, description: 'Default: the customer’s terms' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermDays?: number;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 14, minimum: 0, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  leadTimeDays?: number | null;

  @ApiPropertyOptional({ enum: ERP_VAT_MODES_E4, enumName: 'ErpVatMode', example: 'exclusive' })
  @IsOptional()
  @IsIn(ERP_VAT_MODES_E4)
  vatMode?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(2000)
  terms?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000, description: 'Internal; not printed' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(2000)
  note?: string | null;

  @ApiProperty({ type: [ErpSalesLineInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ErpSalesLineInput)
  lines!: ErpSalesLineInput[];
}

export class ErpQuotationListQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: [...ERP_QUOTATION_STATUSES, 'open'],
    enumName: 'ErpQuotationStatusFilter',
    example: 'open',
    description: '`open` = draft or sent; superseded revisions are left out unless asked for',
  })
  @IsOptional()
  @IsIn([...ERP_QUOTATION_STATUSES, 'open'])
  status?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  opportunityId?: string;

}

export class ErpQuotationLinkDto {
  @ApiProperty({ type: ErpQuotationDto })
  quotation!: ErpQuotationDto;

  @ApiProperty({
    example: 'https://www.packio.example/q/q3J9f0T1xYk8Zb2mR4sW6uE7vN0aLcDh',
    description: 'For the customer; shown once — sending again makes a new one',
  })
  url!: string;

  @ApiProperty({ format: 'date-time', example: '2026-11-11T23:59:59+07:00' })
  expiresAt!: string;
}

export class ErpRecordAcceptanceDto {
  @ApiProperty({ example: 'คุณสมศรี ใจดี', maxLength: 120 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'เจ้าของร้าน', maxLength: 120 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(120)
  position?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'PO-6610-015', maxLength: 60 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(60)
  customerPoNo?: string | null;
}

/** What the customer sees through the quotation link (D-360): the factory's quotation, nothing else. */
export class PublicQuotationDto {
  @ApiProperty({ type: ErpDocPartyDto, description: 'The factory, as the seller' })
  seller!: ErpDocPartyDto;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Short-lived link to its logo' })
  sellerLogoUrl!: string | null;

  @ApiProperty({ type: ErpDocPartyDto })
  buyer!: ErpDocPartyDto;

  @ApiProperty({ example: 'QT-2610-0003' })
  quoteNo!: string;

  @ApiProperty({ example: 1 })
  revision!: number;

  @ApiProperty({
    enum: ['sent', 'accepted', 'rejected', 'expired', 'superseded', 'cancelled'],
    enumName: 'PublicQuotationStatus',
    example: 'sent',
  })
  status!: string;

  @ApiProperty({ format: 'date', example: '2026-10-12' })
  quoteDate!: string;

  @ApiProperty({ format: 'date', example: '2026-11-11' })
  validUntil!: string;

  @ApiProperty({ example: 30 })
  paymentTermDays!: number;

  @ApiProperty({ type: Number, nullable: true, example: 14 })
  leadTimeDays!: number | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  terms!: string | null;

  @ApiProperty({ enum: ERP_VAT_MODES_E4, enumName: 'ErpVatMode', example: 'exclusive' })
  vatMode!: string;

  @ApiProperty({ example: '7.0000' })
  vatRatePct!: string;

  @ApiProperty({ type: [ErpSalesLineDto] })
  lines!: ErpSalesLineDto[];

  @ApiProperty({ example: '62500.00' })
  subtotal!: string;

  @ApiProperty({ example: '4375.00' })
  vatAmount!: string;

  @ApiProperty({ example: '66875.00' })
  total!: string;

  @ApiProperty({ example: 'หกหมื่นหกพันแปดร้อยเจ็ดสิบห้าบาทถ้วน' })
  totalInWords!: string;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: null })
  acceptedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  acceptedName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  sellerContact!: string | null;
}

export class PublicAcceptQuotationDto extends ErpRecordAcceptanceDto {
  @ApiProperty({ example: true, description: 'Agrees to the quotation and its terms' })
  @IsBoolean()
  agree!: boolean;
}

// ===================================================================================== sales orders

export class ErpSalesOrderLineInput extends ErpSalesLineInput {
  @ApiPropertyOptional({
    enum: ERP_FULFILMENTS,
    enumName: 'ErpFulfilment',
    example: 'make',
    description: '`stock` (reserved on confirm), `make` (a production order) or `service` (no goods). Default: stock with an item, service without',
  })
  @IsOptional()
  @IsIn(ERP_FULFILMENTS)
  fulfilment?: string;
}

export class ErpSalesOrderLineDto extends ErpSalesLineDto {
  @ApiProperty({ enum: ERP_FULFILMENTS, enumName: 'ErpFulfilment', example: 'make' })
  fulfilment!: string;

  @ApiProperty({ example: '0.000' })
  reservedQty!: string;

  @ApiProperty({ example: '2000.000' })
  deliveredQty!: string;

  @ApiProperty({ example: '2000.000' })
  invoicedQty!: string;

  @ApiProperty({ type: ErpRefDto, nullable: true, description: 'Its production order (code = MO no., name = status)' })
  productionOrder!: ErpRefDto | null;
}

export class ErpSalesOrderSummaryDto {
  @ApiProperty({ format: 'uuid', example: E4_IDS.salesOrder })
  id!: string;

  @ApiProperty({ example: 'SO-2610-0004' })
  soNo!: string;

  @ApiProperty({ enum: ERP_SALES_ORDER_STATUSES, enumName: 'ErpSalesOrderStatus', example: 'confirmed' })
  status!: string;

  @ApiProperty({ type: ErpRefDto })
  customer!: ErpRefDto;

  @ApiProperty({ type: String, nullable: true, example: 'PO-6610-015' })
  customerPoNo!: string | null;

  @ApiProperty({ format: 'date', example: '2026-10-13' })
  orderDate!: string;

  @ApiProperty({ type: String, nullable: true, format: 'date', example: '2026-10-28' })
  deliveryDate!: string | null;

  @ApiProperty({ example: '66875.00' })
  total!: string;

  @ApiProperty({ example: '40.0', description: 'Delivered share of the goods lines' })
  deliveredPct!: string;

  @ApiProperty({ example: false, description: 'Not fully delivered after its delivery date' })
  late!: boolean;

  @ApiProperty({ type: PersonRefDto, nullable: true })
  salesperson!: PersonRefDto | null;
}

export class ErpDeliveryNoteRefDto {
  @ApiProperty({ format: 'uuid', example: E4_IDS.deliveryNote })
  id!: string;

  @ApiProperty({ example: 'DO-2610-0002' })
  doNo!: string;

  @ApiProperty({ enum: ERP_DELIVERY_STATUSES, enumName: 'ErpDeliveryStatus', example: 'delivered' })
  status!: string;

  @ApiProperty({ format: 'date', example: '2026-10-20' })
  deliverOn!: string;
}

export class ErpInvoiceRefDto {
  @ApiProperty({ format: 'uuid', example: E4_IDS.invoice })
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'IV-2610-0005', description: 'null while a draft' })
  invoiceNo!: string | null;

  @ApiProperty({ enum: ERP_SALES_INVOICE_STATUSES, enumName: 'ErpSalesInvoiceStatus', example: 'issued' })
  status!: string;

  @ApiProperty({ example: '26750.00' })
  total!: string;
}

export class ErpCreditExposureDto {
  @ApiProperty({ type: String, nullable: true, example: '100000.00', description: 'null = no limit' })
  limit!: string | null;

  @ApiProperty({ example: '42800.00', description: 'Open receivables of the customer' })
  receivables!: string;

  @ApiProperty({ example: '66875.00', description: 'Confirmed orders not yet invoiced (this one included)' })
  openOrders!: string;

  @ApiProperty({ example: true })
  over!: boolean;
}

export class ErpSalesOrderDto extends ErpSalesOrderSummaryDto {
  @ApiProperty({ type: ErpRefDto, nullable: true, description: 'code = QT no. with revision' })
  quotation!: ErpRefDto | null;

  @ApiProperty({ type: ErpRefDto, nullable: true })
  opportunity!: ErpRefDto | null;

  @ApiProperty({ type: ErpRefDto })
  warehouse!: ErpRefDto;

  @ApiProperty({ example: 30 })
  paymentTermDays!: number;

  @ApiProperty({ type: String, nullable: true, example: 'ส่งที่ร้าน ซ.งามวงศ์วาน 23' })
  shipToAddress!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ enum: ERP_VAT_MODES_E4, enumName: 'ErpVatMode', example: 'exclusive' })
  vatMode!: string;

  @ApiProperty({ example: '7.0000' })
  vatRatePct!: string;

  @ApiProperty({ example: '62500.00' })
  subtotal!: string;

  @ApiProperty({ example: '4375.00' })
  vatAmount!: string;

  @ApiProperty({ type: [ErpSalesOrderLineDto] })
  lines!: ErpSalesOrderLineDto[];

  @ApiProperty({ type: [ErpDeliveryNoteRefDto] })
  deliveryNotes!: ErpDeliveryNoteRefDto[];

  @ApiProperty({ type: [ErpInvoiceRefDto] })
  invoices!: ErpInvoiceRefDto[];

  @ApiProperty({ type: ErpCreditExposureDto, description: 'The customer’s credit position (D-361)' })
  credit!: ErpCreditExposureDto;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: '2026-10-13T11:00:00+07:00' })
  confirmedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  creditOverrideReason!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  closeReason!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  cancelReason!: string | null;

  @ApiProperty({
    type: [NextActionDto],
    description:
      'Offered: `erp_so.edit`, `erp_so.confirm`, `erp_so.deliver`, `erp_so.invoice`, `erp_so.close`, `erp_so.cancel`, `erp_so.pdf`',
  })
  nextActions!: NextActionDto[];

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ErpSaveSalesOrderDto {
  @ApiProperty({ format: 'uuid', example: E4_IDS.customer })
  @IsUUID()
  customerId!: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid', example: null })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  opportunityId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid', example: E4_IDS.salesperson })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  salespersonId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'PO-6610-015', maxLength: 60 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(60)
  customerPoNo?: string | null;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-13', description: 'Default: today' })
  @IsOptional()
  @Matches(DAY)
  orderDate?: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date', example: '2026-10-28' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(DAY)
  deliveryDate?: string | null;

  @ApiPropertyOptional({ format: 'uuid', description: 'Default: the default warehouse' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ example: 30, minimum: 0, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermDays?: number;

  @ApiPropertyOptional({ enum: ERP_VAT_MODES_E4, enumName: 'ErpVatMode', example: 'exclusive' })
  @IsOptional()
  @IsIn(ERP_VAT_MODES_E4)
  vatMode?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  shipToAddress?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(2000)
  note?: string | null;

  @ApiProperty({ type: [ErpSalesOrderLineInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ErpSalesOrderLineInput)
  lines!: ErpSalesOrderLineInput[];
}

export class ErpConfirmSalesOrderDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'ลูกค้าประจำ จ่ายตรงเวลา',
    maxLength: 500,
    description: 'Required to confirm over the credit limit (`factory_sales.approve`)',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  overrideReason?: string | null;
}

export class ErpSalesOrderListQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: [...ERP_SALES_ORDER_STATUSES, 'open'],
    enumName: 'ErpSalesOrderStatusFilter',
    example: 'open',
    description: '`open` = confirmed or partially delivered',
  })
  @IsOptional()
  @IsIn([...ERP_SALES_ORDER_STATUSES, 'open'])
  status?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

}

// ===================================================================================== delivery notes

export class ErpDeliveryLineInput {
  @ApiProperty({ format: 'uuid', example: E4_IDS.salesOrderLine })
  @IsUUID()
  salesOrderLineId!: string;

  @ApiProperty({ example: '2000', pattern: QTY.source, description: 'In the line’s unit' })
  @Matches(QTY)
  quantity!: string;
}

export class ErpCreateDeliveryNoteDto {
  @ApiProperty({ format: 'uuid', example: E4_IDS.salesOrder })
  @IsUUID()
  salesOrderId!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Default: the order’s warehouse' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-20', description: 'Default: today' })
  @IsOptional()
  @Matches(DAY)
  deliverOn?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500, description: 'Default: the order’s' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  shipToAddress?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'กระบะ 2กข-1234 / คุณสมชาย', maxLength: 200 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(200)
  vehicle?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 1000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @ApiPropertyOptional({
    type: [ErpDeliveryLineInput],
    description: 'Default: every goods line’s remaining quantity',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ErpDeliveryLineInput)
  lines?: ErpDeliveryLineInput[];
}

export class ErpDeliveryNoteLineDto {
  @ApiProperty({ format: 'uuid', example: E4_IDS.deliveryNoteLine })
  id!: string;

  @ApiProperty({ example: 1 })
  lineNo!: number;

  @ApiProperty({ format: 'uuid', example: E4_IDS.salesOrderLine })
  salesOrderLineId!: string;

  @ApiProperty({ type: ErpItemRefDto, nullable: true })
  item!: ErpItemRefDto | null;

  @ApiProperty({ example: 'กล่องลูกฟูก RSC 30×20×15 ซม. พิมพ์ 2 สี' })
  description!: string;

  @ApiProperty({ example: '2000.000' })
  quantity!: string;

  @ApiProperty({ enum: ERP_UNITS, enumName: 'ErpUnit', example: 'pcs' })
  unit!: string;

  @ApiProperty({ type: String, nullable: true, example: '6.420000', description: 'Stock cost per unit once issued' })
  unitCost!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '12840.00' })
  costAmount!: string | null;

  @ApiProperty({ example: '0.000' })
  invoicedQty!: string;
}

export class ErpDeliveryNoteSummaryDto extends ErpDeliveryNoteRefDto {
  @ApiProperty({ type: ErpRefDto })
  customer!: ErpRefDto;

  @ApiProperty({ type: ErpRefDto, description: 'code = SO no.' })
  salesOrder!: ErpRefDto;

  @ApiProperty({ example: false, description: 'Every line invoiced' })
  invoiced!: boolean;
}

export class ErpDeliveryNoteDto extends ErpDeliveryNoteSummaryDto {
  @ApiProperty({ type: ErpRefDto })
  warehouse!: ErpRefDto;

  @ApiProperty({ type: String, nullable: true, example: 'ส่งที่ร้าน ซ.งามวงศ์วาน 23' })
  shipToAddress!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'กระบะ 2กข-1234 / คุณสมชาย' })
  vehicle!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ type: [ErpDeliveryNoteLineDto] })
  lines!: ErpDeliveryNoteLineDto[];

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: '2026-10-20T08:30:00+07:00' })
  issuedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: '2026-10-20T14:10:00+07:00' })
  deliveredAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'คุณสมศรี' })
  receivedBy!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'uuid', example: null, description: 'Photo of the signed copy' })
  podFileId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  cancelReason!: string | null;

  @ApiProperty({ example: '12840.00', description: 'Stock cost of what was delivered' })
  costTotal!: string;

  @ApiProperty({
    type: [NextActionDto],
    description: 'Offered: `erp_do.issue`, `erp_do.deliver`, `erp_do.invoice`, `erp_do.cancel`, `erp_do.pdf`',
  })
  nextActions!: NextActionDto[];

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ErpDeliveredDto {
  @ApiProperty({ example: 'คุณสมศรี', maxLength: 120 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  receivedBy!: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date-time', description: 'Default: now' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsISO8601({ strict: true })
  deliveredAt?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid', description: 'An uploaded photo of the signed copy' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  podFileId?: string | null;
}

export class ErpDeliveryNoteListQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: [...ERP_DELIVERY_STATUSES, 'uninvoiced'],
    enumName: 'ErpDeliveryStatusFilter',
    example: 'uninvoiced',
    description: '`uninvoiced` = issued or delivered with lines not invoiced',
  })
  @IsOptional()
  @IsIn([...ERP_DELIVERY_STATUSES, 'uninvoiced'])
  status?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  salesOrderId?: string;

}

// ===================================================================================== invoices

export class ErpNoteRefDto {
  @ApiProperty({ format: 'uuid', example: E4_IDS.creditNote })
  id!: string;

  @ApiProperty({ enum: ERP_SALES_NOTE_KINDS, enumName: 'CnDirection', example: 'credit' })
  kind!: string;

  @ApiProperty({ type: String, nullable: true, example: 'CN-2610-0001' })
  noteNo!: string | null;

  @ApiProperty({ enum: ERP_ISSUED_STATUSES, enumName: 'ErpIssuedStatus', example: 'issued' })
  status!: string;

  @ApiProperty({ example: '1070.00' })
  total!: string;
}

export class ErpReceiptRefDto {
  @ApiProperty({ format: 'uuid', example: E4_IDS.receipt })
  id!: string;

  @ApiProperty({ example: 'RC-2610-0003' })
  receiptNo!: string;

  @ApiProperty({ enum: ERP_RECEIPT_STATUSES, enumName: 'ErpReceiptStatus', example: 'issued' })
  status!: string;

  @ApiProperty({ format: 'date', example: '2026-11-10' })
  receivedOn!: string;

  @ApiProperty({ example: '25000.00', description: 'Gross amount settled on this invoice (cash + WHT)' })
  amount!: string;
}

export class ErpSalesInvoiceSummaryDto {
  @ApiProperty({ format: 'uuid', example: E4_IDS.invoice })
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'IV-2610-0005', description: 'null while a draft' })
  invoiceNo!: string | null;

  @ApiProperty({ enum: ERP_INVOICE_FORMS, enumName: 'ErpInvoiceForm', example: 'invoice' })
  form!: string;

  @ApiProperty({ example: true, description: 'A tax invoice (the factory is VAT-registered)' })
  isTaxInvoice!: boolean;

  @ApiProperty({ enum: ERP_SALES_INVOICE_STATUSES, enumName: 'ErpSalesInvoiceStatus', example: 'issued' })
  status!: string;

  @ApiProperty({ type: ErpRefDto })
  customer!: ErpRefDto;

  @ApiProperty({ format: 'date', example: '2026-10-20' })
  issueDate!: string;

  @ApiProperty({ format: 'date', example: '2026-11-19' })
  dueDate!: string;

  @ApiProperty({ example: '26750.00' })
  total!: string;

  @ApiProperty({ example: '26750.00', description: 'total + debit notes − credit notes − received' })
  openAmount!: string;

  @ApiProperty({ example: false })
  overdue!: boolean;

  @ApiProperty({ type: PersonRefDto, nullable: true })
  salesperson!: PersonRefDto | null;
}

export class ErpSalesInvoiceDto extends ErpSalesInvoiceSummaryDto {
  @ApiProperty({ type: ErpRefDto, nullable: true, description: 'code = SO no.' })
  salesOrder!: ErpRefDto | null;

  @ApiProperty({ example: 30 })
  paymentTermDays!: number;

  @ApiProperty({ type: String, nullable: true, example: 'PO-6610-015' })
  customerPoNo!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ enum: ERP_VAT_MODES_E4, enumName: 'ErpVatMode', example: 'exclusive' })
  vatMode!: string;

  @ApiProperty({ example: '7.0000' })
  vatRatePct!: string;

  @ApiProperty({ example: '25000.00' })
  subtotal!: string;

  @ApiProperty({ example: '1750.00' })
  vatAmount!: string;

  @ApiProperty({ example: '0.00' })
  creditedAmount!: string;

  @ApiProperty({ example: '0.00' })
  debitedAmount!: string;

  @ApiProperty({ example: '0.00' })
  receivedAmount!: string;

  @ApiProperty({ type: [ErpSalesLineDto] })
  lines!: ErpSalesLineDto[];

  @ApiProperty({ type: [ErpDeliveryNoteRefDto], description: 'Delivery notes it invoices' })
  deliveryNotes!: ErpDeliveryNoteRefDto[];

  @ApiProperty({ type: [ErpNoteRefDto] })
  notes!: ErpNoteRefDto[];

  @ApiProperty({ type: [ErpReceiptRefDto] })
  receipts!: ErpReceiptRefDto[];

  @ApiProperty({ type: ErpDocPartyDto, nullable: true, description: 'As printed (set when issued)' })
  seller!: ErpDocPartyDto | null;

  @ApiProperty({ type: ErpDocPartyDto, description: 'As printed once issued; the customer now while a draft' })
  buyer!: ErpDocPartyDto;

  @ApiProperty({ example: 'สองหมื่นหกพันเจ็ดร้อยห้าสิบบาทถ้วน' })
  totalInWords!: string;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: '2026-10-20T15:00:00+07:00' })
  issuedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: null })
  voidedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  voidReason!: string | null;

  @ApiProperty({
    type: [NextActionDto],
    description:
      'Offered: `erp_iv.edit`, `erp_iv.issue`, `erp_iv.receive`, `erp_iv.credit`, `erp_iv.debit`, `erp_iv.void`, `erp_iv.delete`, `erp_iv.pdf`',
  })
  nextActions!: NextActionDto[];

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ErpCreateSalesInvoiceDto {
  @ApiProperty({ format: 'uuid', example: E4_IDS.customer })
  @IsUUID()
  customerId!: string;

  @ApiPropertyOptional({ enum: ERP_INVOICE_FORMS, enumName: 'ErpInvoiceForm', example: 'invoice' })
  @IsOptional()
  @IsIn(ERP_INVOICE_FORMS)
  form?: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    example: [E4_IDS.deliveryNote],
    description: 'Issued delivery notes of this customer: their uninvoiced lines become the invoice’s lines',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsUUID('all', { each: true })
  deliveryNoteIds?: string[];

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'A confirmed sales order: its uninvoiced **service** lines are added (and goods lines when it has no delivery notes)',
  })
  @IsOptional()
  @IsUUID()
  salesOrderId?: string;

  @ApiPropertyOptional({ type: [ErpSalesLineInput], description: 'Free lines (with or without an item)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ErpSalesLineInput)
  lines?: ErpSalesLineInput[];

  @ApiPropertyOptional({ format: 'date', example: '2026-10-20', description: 'The planned issue date (default: today)' })
  @IsOptional()
  @Matches(DAY)
  issueDate?: string;

  @ApiPropertyOptional({ example: 30, minimum: 0, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermDays?: number;

  @ApiPropertyOptional({ enum: ERP_VAT_MODES_E4, enumName: 'ErpVatMode', description: 'Default: the order’s, else exclusive (none when not VAT-registered)' })
  @IsOptional()
  @IsIn(ERP_VAT_MODES_E4)
  vatMode?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 60 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(60)
  customerPoNo?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 1000, description: 'Printed on the invoice' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class ErpUpdateSalesInvoiceDto {
  @ApiPropertyOptional({ type: [ErpSalesLineInput], description: 'Replaces the free lines; delivery lines stay' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ErpSalesLineInput)
  lines?: ErpSalesLineInput[];

  @ApiPropertyOptional({ format: 'date', example: '2026-10-20' })
  @IsOptional()
  @Matches(DAY)
  issueDate?: string;

  @ApiPropertyOptional({ example: 30, minimum: 0, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermDays?: number;

  @ApiPropertyOptional({ enum: ERP_VAT_MODES_E4, enumName: 'ErpVatMode' })
  @IsOptional()
  @IsIn(ERP_VAT_MODES_E4)
  vatMode?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 60 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(60)
  customerPoNo?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 1000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class ErpCashReceiptInput {
  @ApiProperty({ enum: ERP_PAYMENT_METHODS, enumName: 'ErpPaymentMethod', example: 'cash' })
  @IsIn(ERP_PAYMENT_METHODS)
  method!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 120 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(120)
  reference?: string | null;
}

export class ErpIssueSalesInvoiceDto {
  @ApiPropertyOptional({ format: 'date', example: '2026-10-20', description: 'The tax point; default: the draft’s date' })
  @IsOptional()
  @Matches(DAY)
  issueDate?: string;

  @ApiPropertyOptional({
    type: ErpCashReceiptInput,
    description: 'Form `invoice_receipt`: how the cash sale was paid (default: cash)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ErpCashReceiptInput)
  receipt?: ErpCashReceiptInput;
}

export class ErpSalesInvoiceListQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: [...ERP_SALES_INVOICE_STATUSES, 'open', 'overdue'],
    enumName: 'ErpSalesInvoiceStatusFilter',
    example: 'open',
    description: '`open` = issued or partially paid with something left to receive; `overdue` = open past due',
  })
  @IsOptional()
  @IsIn([...ERP_SALES_INVOICE_STATUSES, 'open', 'overdue'])
  status?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ format: 'date', description: 'Issued on or after' })
  @IsOptional()
  @Matches(DAY)
  from?: string;

  @ApiPropertyOptional({ format: 'date', description: 'Issued on or before' })
  @IsOptional()
  @Matches(DAY)
  to?: string;

}

// ===================================================================================== credit / debit notes

export class ErpSalesNoteLineInput {
  @ApiProperty({ example: 'ลดราคากล่อง 1,000 ใบ ใบละ 1 บาท', maxLength: 300 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  description!: string;

  @ApiProperty({ example: '1000', pattern: AMOUNT.source, description: 'Net value of the line, without VAT' })
  @Matches(AMOUNT)
  amount!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Goods returned: the item…' })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({ example: '100', pattern: QTY.source, description: '…and how many come back into stock (base units)' })
  @IsOptional()
  @Matches(QTY)
  returnQty?: string;
}

export class ErpCreateSalesNoteDto {
  @ApiProperty({ enum: ERP_SALES_NOTE_KINDS, enumName: 'CnDirection', example: 'credit' })
  @IsIn(ERP_SALES_NOTE_KINDS)
  kind!: string;

  @ApiProperty({ format: 'uuid', example: E4_IDS.invoice, description: 'An issued invoice of the factory' })
  @IsUUID()
  invoiceId!: string;

  @ApiProperty({
    enum: ERP_SALES_NOTE_REASONS,
    enumName: 'ErpSalesNoteReason',
    example: 'price_reduced',
    description: 'Credit: price_reduced, goods_returned, defective, discount_after_sale, overcharged, other; debit: price_increased, undercharged, extra_goods, other',
  })
  @IsIn(ERP_SALES_NOTE_REASONS)
  reason!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'สินค้าพิมพ์สีเพี้ยน 100 ใบ', maxLength: 500 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  reasonText?: string | null;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-25', description: 'Default: today' })
  @IsOptional()
  @Matches(DAY)
  issueDate?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Where returned goods go (default: the default warehouse)' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiProperty({ type: [ErpSalesNoteLineInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ErpSalesNoteLineInput)
  lines!: ErpSalesNoteLineInput[];
}

export class ErpSalesNoteLineDto {
  @ApiProperty({ example: 1 })
  lineNo!: number;

  @ApiProperty({ example: 'ลดราคากล่อง 1,000 ใบ ใบละ 1 บาท' })
  description!: string;

  @ApiProperty({ example: '1000.00' })
  amount!: string;

  @ApiProperty({ type: ErpItemRefDto, nullable: true })
  item!: ErpItemRefDto | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  returnQty!: string | null;
}

export class ErpSalesNoteDto extends ErpNoteRefDto {
  @ApiProperty({ type: ErpInvoiceRefDto })
  invoice!: ErpInvoiceRefDto;

  @ApiProperty({ type: ErpRefDto })
  customer!: ErpRefDto;

  @ApiProperty({ format: 'date', example: '2026-10-25' })
  issueDate!: string;

  @ApiProperty({ enum: ERP_SALES_NOTE_REASONS, enumName: 'ErpSalesNoteReason', example: 'price_reduced' })
  reason!: string;

  @ApiProperty({ type: String, nullable: true, example: 'สินค้าพิมพ์สีเพี้ยน 100 ใบ' })
  reasonText!: string | null;

  @ApiProperty({ example: '25000.00', description: 'The invoice’s value (net) before this note' })
  originalValue!: string;

  @ApiProperty({ example: '24000.00', description: 'The value it should be (net)' })
  correctValue!: string;

  @ApiProperty({ example: '1000.00', description: 'The difference (net)' })
  difference!: string;

  @ApiProperty({ example: '7.0000' })
  vatRatePct!: string;

  @ApiProperty({ example: '70.00' })
  vatAmount!: string;

  @ApiProperty({ example: true, description: 'A tax document (the invoice was a tax invoice)' })
  isTaxDocument!: boolean;

  @ApiProperty({ type: ErpRefDto, nullable: true })
  warehouse!: ErpRefDto | null;

  @ApiProperty({ type: [ErpSalesNoteLineDto] })
  lines!: ErpSalesNoteLineDto[];

  @ApiProperty({ type: ErpDocPartyDto, nullable: true })
  seller!: ErpDocPartyDto | null;

  @ApiProperty({ type: ErpDocPartyDto, nullable: true })
  buyer!: ErpDocPartyDto | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time', example: null })
  issuedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  voidReason!: string | null;

  @ApiProperty({
    type: [NextActionDto],
    description: 'Offered: `erp_note.issue`, `erp_note.void`, `erp_note.delete`, `erp_note.pdf`',
  })
  nextActions!: NextActionDto[];

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ErpSalesNoteListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ERP_SALES_NOTE_KINDS, enumName: 'CnDirection' })
  @IsOptional()
  @IsIn(ERP_SALES_NOTE_KINDS)
  kind?: string;

  @ApiPropertyOptional({ enum: ERP_ISSUED_STATUSES, enumName: 'ErpIssuedStatus' })
  @IsOptional()
  @IsIn(ERP_ISSUED_STATUSES)
  status?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  invoiceId?: string;
}

// ===================================================================================== receipts

export class ErpReceiptAllocationInput {
  @ApiProperty({ format: 'uuid', example: E4_IDS.invoice })
  @IsUUID()
  invoiceId!: string;

  @ApiProperty({ example: '26750', pattern: AMOUNT.source, description: 'Gross amount settled (cash + WHT share)' })
  @Matches(AMOUNT)
  amount!: string;
}

export class ErpCreateReceiptDto {
  @ApiProperty({ format: 'uuid', example: E4_IDS.customer })
  @IsUUID()
  customerId!: string;

  @ApiPropertyOptional({
    enum: ERP_RECEIPT_KINDS,
    enumName: 'ErpReceiptKind',
    example: 'receipt',
    description: '`refund` pays back a credit balance (amounts are entered positive)',
  })
  @IsOptional()
  @IsIn(ERP_RECEIPT_KINDS)
  kind?: string;

  @ApiProperty({ format: 'date', example: '2026-11-10' })
  @Matches(DAY)
  receivedOn!: string;

  @ApiProperty({ enum: ERP_PAYMENT_METHODS, enumName: 'ErpPaymentMethod', example: 'transfer' })
  @IsIn(ERP_PAYMENT_METHODS)
  method!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'KBank 10/11 15:22', maxLength: 120 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(120)
  reference?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 30 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(30)
  chequeNo?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 80 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(80)
  chequeBank?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date', example: null })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(DAY)
  chequeDate?: string | null;

  @ApiProperty({ example: '25947.50', pattern: AMOUNT.source, description: 'Money received (or refunded)' })
  @Matches(AMOUNT)
  amount!: string;

  @ApiPropertyOptional({ example: '802.50', pattern: AMOUNT.source, description: 'Withholding tax the customer deducted' })
  @IsOptional()
  @Matches(AMOUNT)
  whtAmount?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '0001/2569', maxLength: 40, description: 'The customer’s 50 ทวิ number' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(40)
  whtCertNo?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date', example: null })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(DAY)
  whtCertDate?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid', example: null, description: 'An uploaded scan of the 50 ทวิ' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  whtFileId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 1000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @ApiProperty({
    type: [ErpReceiptAllocationInput],
    description: 'Gross amounts per invoice; they add up to amount + whtAmount',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ErpReceiptAllocationInput)
  allocations!: ErpReceiptAllocationInput[];
}

export class ErpReceiptAllocationDto {
  @ApiProperty({ type: ErpInvoiceRefDto })
  invoice!: ErpInvoiceRefDto;

  @ApiProperty({ example: '26750.00', description: 'Negative on a refund' })
  amount!: string;
}

export class ErpCustomerReceiptSummaryDto {
  @ApiProperty({ format: 'uuid', example: E4_IDS.receipt })
  id!: string;

  @ApiProperty({ example: 'RC-2610-0003' })
  receiptNo!: string;

  @ApiProperty({ enum: ERP_RECEIPT_KINDS, enumName: 'ErpReceiptKind', example: 'receipt' })
  kind!: string;

  @ApiProperty({ enum: ERP_RECEIPT_STATUSES, enumName: 'ErpReceiptStatus', example: 'issued' })
  status!: string;

  @ApiProperty({ type: ErpRefDto })
  customer!: ErpRefDto;

  @ApiProperty({ format: 'date', example: '2026-11-10' })
  receivedOn!: string;

  @ApiProperty({ enum: ERP_PAYMENT_METHODS, enumName: 'ErpPaymentMethod', example: 'transfer' })
  method!: string;

  @ApiProperty({ example: '25947.50', description: 'Negative on a refund' })
  amount!: string;

  @ApiProperty({ example: '802.50' })
  whtAmount!: string;
}

export class ErpCustomerReceiptDto extends ErpCustomerReceiptSummaryDto {
  @ApiProperty({ type: String, nullable: true, example: 'KBank 10/11 15:22' })
  reference!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  chequeNo!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  chequeBank!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date', example: null })
  chequeDate!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '0001/2569' })
  whtCertNo!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date', example: '2026-11-10' })
  whtCertDate!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'uuid', example: null })
  whtFileId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ type: [ErpReceiptAllocationDto] })
  allocations!: ErpReceiptAllocationDto[];

  @ApiProperty({ example: 'สองหมื่นห้าพันเก้าร้อยสี่สิบเจ็ดบาทห้าสิบสตางค์' })
  amountInWords!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  cancelReason!: string | null;

  @ApiProperty({ example: 'บัญชี ทดสอบ' })
  createdBy!: string;

  @ApiProperty({ format: 'date-time', example: '2026-11-10T15:30:00+07:00' })
  createdAt!: string;

  @ApiProperty({ type: [NextActionDto], description: 'Offered: `erp_rc.cancel`, `erp_rc.pdf`' })
  nextActions!: NextActionDto[];
}

export class ErpReceiptListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ enum: ERP_RECEIPT_STATUSES, enumName: 'ErpReceiptStatus' })
  @IsOptional()
  @IsIn(ERP_RECEIPT_STATUSES)
  status?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Matches(DAY)
  from?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Matches(DAY)
  to?: string;
}

// ===================================================================================== billing notes

export class ErpCreateBillingNoteDto {
  @ApiProperty({ format: 'uuid', example: E4_IDS.customer })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ type: [String], format: 'uuid', example: [E4_IDS.invoice], description: 'Open invoices of the customer' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  invoiceIds!: string[];

  @ApiPropertyOptional({ format: 'date', example: '2026-10-25', description: 'Default: today' })
  @IsOptional()
  @Matches(DAY)
  billingDate?: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date', example: '2026-11-05', description: 'When to collect' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(DAY)
  collectOn?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 1000 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class ErpBillingNoteLineDto {
  @ApiProperty({ type: ErpInvoiceRefDto })
  invoice!: ErpInvoiceRefDto;

  @ApiProperty({ format: 'date', example: '2026-10-20' })
  issueDate!: string;

  @ApiProperty({ format: 'date', example: '2026-11-19' })
  dueDate!: string;

  @ApiProperty({ example: '26750.00', description: 'Open when billed' })
  amount!: string;
}

export class ErpBillingNoteDto {
  @ApiProperty({ format: 'uuid', example: E4_IDS.billingNote })
  id!: string;

  @ApiProperty({ example: 'BN-2610-0001' })
  billingNo!: string;

  @ApiProperty({ enum: ERP_BILLING_STATUSES, enumName: 'ErpReceiptStatus', example: 'issued' })
  status!: string;

  @ApiProperty({ type: ErpRefDto })
  customer!: ErpRefDto;

  @ApiProperty({ format: 'date', example: '2026-10-25' })
  billingDate!: string;

  @ApiProperty({ type: String, nullable: true, format: 'date', example: '2026-11-05' })
  collectOn!: string | null;

  @ApiProperty({ example: '26750.00' })
  total!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ type: [ErpBillingNoteLineDto] })
  lines!: ErpBillingNoteLineDto[];

  @ApiProperty({ type: String, nullable: true, example: null })
  cancelReason!: string | null;

  @ApiProperty({ type: [NextActionDto], description: 'Offered: `erp_bn.cancel`, `erp_bn.pdf`' })
  nextActions!: NextActionDto[];
}

export class ErpBillingNoteListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ enum: ERP_BILLING_STATUSES, enumName: 'ErpReceiptStatus' })
  @IsOptional()
  @IsIn(ERP_BILLING_STATUSES)
  status?: string;
}

// ===================================================================================== aging, statements

export class ErpCustomerAgingDto {
  @ApiProperty({ type: ErpRefDto })
  customer!: ErpRefDto;

  @ApiProperty({ example: 3 })
  invoices!: number;

  @ApiProperty({ type: ErpAgingBucketsDto })
  buckets!: ErpAgingBucketsDto;

  @ApiProperty({ type: String, nullable: true, example: '100000.00' })
  creditLimit!: string | null;
}

export class ErpArAgingDto {
  @ApiProperty({ format: 'date', example: '2026-10-15' })
  asOf!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ example: '26750.00', description: 'Due within the next 7 days' })
  dueSoon!: string;

  @ApiProperty({ example: '0.00', description: 'Credit balances owed back to customers (refunds due)' })
  refundsDue!: string;

  @ApiProperty({ type: ErpAgingBucketsDto })
  totals!: ErpAgingBucketsDto;

  @ApiProperty({ type: [ErpCustomerAgingDto] })
  customers!: ErpCustomerAgingDto[];
}

// ===================================================================================== WHT certificates

export class ErpWhtLineInput {
  @ApiProperty({ enum: ERP_WHT_INCOME_TYPES, enumName: 'ErpWhtIncomeType', example: 'hire_of_work' })
  @IsIn(ERP_WHT_INCOME_TYPES)
  incomeType!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'ค่าจ้างพิมพ์', maxLength: 200 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(200)
  description?: string | null;

  @ApiProperty({ example: '3', pattern: PCT.source })
  @Matches(PCT)
  ratePct!: string;

  @ApiProperty({ example: '20000', pattern: AMOUNT.source, description: 'Amount paid before tax' })
  @Matches(AMOUNT)
  baseAmount!: string;

  @ApiProperty({ example: '600', pattern: AMOUNT.source })
  @Matches(AMOUNT)
  whtAmount!: string;
}

export class ErpCreateWhtCertificateDto {
  @ApiProperty({ format: 'uuid', example: E4_IDS.payment, description: 'A supplier payment (E2) that withheld tax' })
  @IsUUID()
  paymentId!: string;

  @ApiPropertyOptional({
    type: [ErpWhtLineInput],
    description: 'Default: the suggestion (one line per rate, from the paid invoices’ WHT)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => ErpWhtLineInput)
  lines?: ErpWhtLineInput[];
}

export class ErpWhtLineDto {
  @ApiProperty({ example: 1 })
  lineNo!: number;

  @ApiProperty({ enum: ERP_WHT_INCOME_TYPES, enumName: 'ErpWhtIncomeType', example: 'hire_of_work' })
  incomeType!: string;

  @ApiProperty({ type: String, nullable: true, example: 'ค่าจ้างพิมพ์' })
  description!: string | null;

  @ApiProperty({ example: '3.0000' })
  ratePct!: string;

  @ApiProperty({ example: '20000.00' })
  baseAmount!: string;

  @ApiProperty({ example: '600.00' })
  whtAmount!: string;
}

export class ErpWhtSuggestionDto {
  @ApiProperty({ type: ErpRefDto, description: 'code = PV no.' })
  payment!: ErpRefDto;

  @ApiProperty({ type: ErpRefDto })
  supplier!: ErpRefDto;

  @ApiProperty({ enum: ERP_ENTITY_TYPES, enumName: 'ErpEntityType', example: 'juristic' })
  entityType!: string;

  @ApiProperty({ enum: ERP_WHT_FORMS, enumName: 'WhtForm', example: 'pnd53' })
  form!: string;

  @ApiProperty({ format: 'date', example: '2026-10-31' })
  paidOn!: string;

  @ApiProperty({ type: [ErpWhtLineDto] })
  lines!: ErpWhtLineDto[];

  @ApiProperty({ type: ErpRefDto, nullable: true, description: 'The certificate in force for it, if any' })
  certificate!: ErpRefDto | null;
}

export class ErpWhtCertificateDto {
  @ApiProperty({ format: 'uuid', example: E4_IDS.certificate })
  id!: string;

  @ApiProperty({ example: 'WHT-2610-0001' })
  certNo!: string;

  @ApiProperty({ enum: ['issued', 'voided'], enumName: 'ErpWhtCertificateStatus', example: 'issued' })
  status!: string;

  @ApiProperty({ enum: ERP_WHT_FORMS, enumName: 'WhtForm', example: 'pnd53' })
  form!: string;

  @ApiProperty({ type: ErpRefDto, description: 'code = PV no.' })
  payment!: ErpRefDto;

  @ApiProperty({ type: ErpRefDto })
  supplier!: ErpRefDto;

  @ApiProperty({ format: 'date', example: '2026-10-31' })
  paidOn!: string;

  @ApiProperty({ example: '20000.00' })
  baseAmount!: string;

  @ApiProperty({ example: '600.00' })
  whtAmount!: string;

  @ApiProperty({ type: ErpDocPartyDto })
  payer!: ErpDocPartyDto;

  @ApiProperty({ type: ErpDocPartyDto })
  payee!: ErpDocPartyDto;

  @ApiProperty({ type: [ErpWhtLineDto] })
  lines!: ErpWhtLineDto[];

  @ApiProperty({ type: String, nullable: true, example: null })
  voidReason!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-31T16:00:00+07:00' })
  createdAt!: string;

  @ApiProperty({ type: [NextActionDto], description: 'Offered: `erp_wht.void`, `erp_wht.pdf`' })
  nextActions!: NextActionDto[];
}

export class ErpWhtCertificateListQuery extends PageQuery {
  @ApiPropertyOptional({ example: '2026-10', pattern: MONTH.source })
  @IsOptional()
  @Matches(MONTH)
  month?: string;

  @ApiPropertyOptional({ enum: ERP_WHT_FORMS, enumName: 'WhtForm' })
  @IsOptional()
  @IsIn(ERP_WHT_FORMS)
  form?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;
}

// ===================================================================================== tax reports

export class ErpVatReportRowDto {
  @ApiProperty({ format: 'date', example: '2026-10-20' })
  date!: string;

  @ApiProperty({ example: 'IV-2610-0005' })
  docNo!: string;

  @ApiProperty({
    enum: ['tax_invoice', 'credit_note', 'debit_note', 'supplier_tax_invoice'],
    enumName: 'ErpVatRowKind',
    example: 'tax_invoice',
  })
  kind!: string;

  @ApiProperty({ example: 'ร้านขนมบ้านสวน' })
  partyName!: string;

  @ApiProperty({ type: String, nullable: true, example: '0000556123451' })
  partyTaxId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '00000' })
  partyBranch!: string | null;

  @ApiProperty({ example: '25000.00', description: 'Net; negative for a credit note' })
  net!: string;

  @ApiProperty({ example: '1750.00' })
  vat!: string;

  @ApiProperty({ example: false, description: 'Voided: listed with no value' })
  voided!: boolean;

  @ApiProperty({ format: 'uuid', example: E4_IDS.invoice })
  sourceId!: string;
}

export class ErpVatReportDto {
  @ApiProperty({ example: '2026-10' })
  month!: string;

  @ApiProperty({ enum: ['sales', 'purchase'], enumName: 'ErpVatReportKind', example: 'sales' })
  kind!: string;

  @ApiProperty({ type: [ErpVatReportRowDto] })
  rows!: ErpVatReportRowDto[];

  @ApiProperty({ example: '25000.00' })
  net!: string;

  @ApiProperty({ example: '1750.00' })
  vat!: string;
}

export class ErpVat30Dto {
  @ApiProperty({ example: '2026-10' })
  month!: string;

  @ApiProperty({ example: true })
  vatRegistered!: boolean;

  @ApiProperty({ example: '25000.00', description: 'Sales (net) on tax documents' })
  salesNet!: string;

  @ApiProperty({ example: '1750.00' })
  outputVat!: string;

  @ApiProperty({ example: '12000.00', description: 'Purchases (net) on supplier tax invoices' })
  purchaseNet!: string;

  @ApiProperty({ example: '840.00' })
  inputVat!: string;

  @ApiProperty({ example: '910.00', description: 'output − input; negative = carried forward' })
  vatPayable!: string;

  @ApiProperty({ format: 'date', example: '2026-11-15', description: 'Due date of ภ.พ.30 (paper; e-filing usually +8 days)' })
  dueOn!: string;
}

export class ErpWhtReportRowDto {
  @ApiProperty({ example: 'WHT-2610-0001' })
  certNo!: string;

  @ApiProperty({ format: 'date', example: '2026-10-31' })
  paidOn!: string;

  @ApiProperty({ example: 'บจก. กระดาษไทย (ทดสอบ)' })
  payeeName!: string;

  @ApiProperty({ type: String, nullable: true, example: '0000555123457' })
  payeeTaxId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '00000' })
  payeeBranch!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'กรุงเทพฯ' })
  payeeAddress!: string | null;

  @ApiProperty({ enum: ERP_WHT_INCOME_TYPES, enumName: 'ErpWhtIncomeType', example: 'hire_of_work' })
  incomeType!: string;

  @ApiProperty({ example: '3.0000' })
  ratePct!: string;

  @ApiProperty({ example: '20000.00' })
  baseAmount!: string;

  @ApiProperty({ example: '600.00' })
  whtAmount!: string;
}

export class ErpWhtReportDto {
  @ApiProperty({ example: '2026-10' })
  month!: string;

  @ApiProperty({ enum: ERP_WHT_FORMS, enumName: 'WhtForm', example: 'pnd53' })
  form!: string;

  @ApiProperty({ type: [ErpWhtReportRowDto] })
  rows!: ErpWhtReportRowDto[];

  @ApiProperty({ example: '20000.00' })
  baseAmount!: string;

  @ApiProperty({ example: '600.00' })
  whtAmount!: string;

  @ApiProperty({ format: 'date', example: '2026-11-07', description: 'Due date of the paper return (e-filing usually +8 days)' })
  dueOn!: string;
}

export class ErpTaxExportDto {
  @ApiProperty({ enum: ERP_TAX_REPORTS, enumName: 'ErpTaxExportReport', example: 'sales_vat' })
  @IsIn(ERP_TAX_REPORTS)
  report!: string;

  @ApiProperty({ example: '2026-10', pattern: MONTH.source })
  @Matches(MONTH)
  month!: string;

  @ApiPropertyOptional({ enum: ['csv', 'xlsx'], enumName: 'ErpExportFormat', example: 'csv' })
  @IsOptional()
  @IsIn(['csv', 'xlsx'])
  format?: string;
}

export class ErpTaxExportResultDto extends ErpPdfLinkDto {
  @ApiProperty({ example: 12 })
  rows!: number;
}

// ===================================================================================== targets, reports

export class ErpSaveSalesTargetDto {
  @ApiProperty({ format: 'uuid', example: E4_IDS.salesperson, description: 'A user of this factory' })
  @IsUUID()
  salespersonId!: string;

  @ApiProperty({ example: '2026-10', pattern: MONTH.source })
  @Matches(MONTH)
  month!: string;

  @ApiProperty({ example: '300000', pattern: AMOUNT.source, description: 'Net sales, without VAT' })
  @Matches(AMOUNT)
  targetNet!: string;

  @ApiPropertyOptional({ example: '2', pattern: PCT.source })
  @IsOptional()
  @Matches(PCT)
  commissionPct?: string;
}

export class ErpSalesPerformanceDto {
  @ApiProperty({ type: PersonRefDto, nullable: true, description: 'null = invoices without a salesperson' })
  salesperson!: PersonRefDto | null;

  @ApiProperty({ example: '2026-10' })
  month!: string;

  @ApiProperty({ type: String, nullable: true, example: '300000.00' })
  targetNet!: string | null;

  @ApiProperty({ example: '245000.00', description: 'Invoices − credit notes + debit notes, net' })
  invoicedNet!: string;

  @ApiProperty({ example: '180000.00', description: 'Received in the month (gross) on its invoices' })
  collected!: string;

  @ApiProperty({ type: String, nullable: true, example: '81.7' })
  achievementPct!: string | null;

  @ApiProperty({ example: '2.0000' })
  commissionPct!: string;

  @ApiProperty({ example: '4900.00' })
  commission!: string;

  @ApiProperty({ example: 12 })
  invoices!: number;

  @ApiProperty({ type: String, nullable: true, format: 'uuid', example: E4_IDS.target })
  targetId!: string | null;
}

export class ErpSalesReportDto {
  @ApiProperty({ example: '2026-10' })
  month!: string;

  @ApiProperty({ type: [ErpSalesPerformanceDto] })
  rows!: ErpSalesPerformanceDto[];

  @ApiProperty({ example: '245000.00' })
  invoicedNet!: string;

  @ApiProperty({ example: '300000.00' })
  targetNet!: string;

  @ApiProperty({ example: '4900.00' })
  commission!: string;

  @ApiProperty({ example: '58000.00', description: 'Invoiced net − stock cost of what was delivered on those invoices' })
  grossProfit!: string;
}

export class ErpSalespersonOptionDto extends PersonRefDto {
  @ApiProperty({ type: [String], example: ['factory_sales'] })
  roles!: string[];
}
