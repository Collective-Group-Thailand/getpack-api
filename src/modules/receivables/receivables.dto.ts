import { ReasonDto } from '@common/dto/reason.dto';
import { NextActionDto } from '@common/next-actions/next-action.dto';
import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Receivables & customer documents (B5.2). Money: decimal strings, THB. */

const MONEY = /^\d{1,12}\.\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const CUSTOMER_DOCUMENT_TYPES = ['iv', 'tr', 'rc', 'cn', 'dn'] as const;
export const CUSTOMER_DOCUMENT_KINDS = [
  'instalment',
  'final',
  'delivery',
  'collection',
  'credit_note',
  'debit_note',
] as const;
export const CUSTOMER_DOCUMENT_STATUSES = ['issued', 'void'] as const;
export const RECEIPT_VIAS = ['scb', 'twoc2p', 'slip', 'bank', 'unidentified', 'store_credit'] as const;
export const TAX_NATURES = ['sale_of_goods', 'hire_of_work'] as const;
export const CREDIT_NOTE_KINDS = [
  'shortage',
  'claim',
  'cancellation',
  'price_reduction',
  'return',
  'discount',
] as const;
export const CREDIT_SETTLEMENTS = ['store_credit', 'receivable'] as const;
export const CREDIT_REQUEST_STATUSES = ['pending_approval', 'issued', 'rejected', 'withdrawn'] as const;
export const WHT_CERT_STATUSES = ['pending', 'received', 'waived'] as const;
export const AR_ITEM_STATUSES = ['open', 'partially_paid', 'paid', 'written_off', 'cancelled'] as const;
export const STORE_CREDIT_SOURCES = [
  'shortage_credit',
  'cancellation',
  'claim',
  'refund_alternative',
  'applied_to_order',
  'manual',
  'refunded',
] as const;

export const AR_IDS = {
  document: '0192f3a0-7c1e-7d2a-9b1f-000000520001',
  original: '0192f3a0-7c1e-7d2a-9b1f-000000520002',
  item: '0192f3a0-7c1e-7d2a-9b1f-000000520003',
  cert: '0192f3a0-7c1e-7d2a-9b1f-000000520004',
  request: '0192f3a0-7c1e-7d2a-9b1f-000000520005',
  statement: '0192f3a0-7c1e-7d2a-9b1f-000000520006',
  entry: '0192f3a0-7c1e-7d2a-9b1f-000000520007',
  approval: '0192f3a0-7c1e-7d2a-9b1f-000000520008',
  customer: '0192f3a0-7c1e-7d2a-9b1f-000000000101',
  company: '0192f3a0-7c1e-7d2a-9b1f-0000000e0001',
  group: '0192f3a0-7c1e-7d2a-9b1f-0000000d0001',
  order: '0192f3a0-7c1e-7d2a-9b1f-0000000c0001',
  payment: '0192f3a0-7c1e-7d2a-9b1f-0000000a0001',
};

export class DocumentRefDto {
  @ApiProperty({ format: 'uuid', example: AR_IDS.original })
  id!: string;

  @ApiProperty({ example: 'TR256910-00001' })
  docNumber!: string;
}

export class DocumentPartyDto {
  @ApiProperty({ example: 'บริษัท ตัวอย่าง จำกัด (fake)' })
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: '0000000000000' })
  taxId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '00000' })
  branchCode!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '99/9 ถนนตัวอย่าง แขวงทดสอบ เขตทดสอบ กรุงเทพมหานคร 10000',
  })
  address!: string | null;
}

export class CustomerDocumentLineDto {
  @ApiProperty({ type: 'integer', example: 1 })
  lineNo!: number;

  @ApiProperty({ example: 'งวดที่ 1 มัดจำ 50% — คำสั่งซื้อ O2610-00001' })
  description!: string;

  @ApiProperty({ example: '1.000', description: 'Quantity' })
  quantity!: string;

  @ApiProperty({ example: '1000.00' })
  netAmount!: string;

  @ApiProperty({ example: '0.00' })
  discountAmount!: string;

  @ApiProperty({ example: '70.00' })
  vatAmount!: string;

  @ApiProperty({ example: '1070.00' })
  grossAmount!: string;

  @ApiProperty({ example: '0.00' })
  whtAmount!: string;
}

export class DocumentReceivableDto {
  @ApiProperty({ format: 'uuid', example: AR_IDS.item })
  id!: string;

  @ApiProperty({ example: '535.00' })
  openAmount!: string;

  @ApiProperty({ enum: AR_ITEM_STATUSES, enumName: 'ArItemStatus', example: 'open' })
  status!: string;
}

export class CustomerDocumentDto {
  @ApiProperty({ format: 'uuid', example: AR_IDS.document })
  id!: string;

  @ApiProperty({ enum: CUSTOMER_DOCUMENT_TYPES, enumName: 'CustomerDocumentType', example: 'tr' })
  docType!: string;

  @ApiProperty({ enum: CUSTOMER_DOCUMENT_KINDS, enumName: 'CustomerDocumentKind', example: 'instalment' })
  docKind!: string;

  @ApiProperty({ example: 'TR256910-00001' })
  docNumber!: string;

  @ApiProperty({ enum: CUSTOMER_DOCUMENT_STATUSES, enumName: 'CustomerDocumentStatus', example: 'issued' })
  status!: string;

  @ApiProperty({ format: 'date', example: '2026-10-05' })
  documentDate!: string;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: null })
  dueDate!: string | null;

  @ApiProperty({ example: true, description: 'A tax invoice (tax point, accounting-design §2)' })
  isTaxInvoice!: boolean;

  @ApiProperty({ example: false, description: 'Full-form tax invoice (buyer tax id and branch)' })
  isFullForm!: boolean;

  @ApiProperty({ type: DocumentPartyDto })
  buyer!: DocumentPartyDto;

  @ApiProperty({ type: DocumentPartyDto, description: 'The issuing entity (D-092)' })
  seller!: DocumentPartyDto;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: AR_IDS.group })
  orderGroupId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'G2610-00001' })
  groupCode!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: AR_IDS.order })
  orderId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'O2610-00001' })
  orderCode!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: AR_IDS.payment })
  paymentId!: string | null;

  @ApiProperty({
    type: DocumentRefDto,
    nullable: true,
    description: 'The tax invoice a CN / DN / RC refers to',
  })
  originalDocument!: DocumentRefDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Credit / debit note reason (statutory list)',
  })
  reason!: string | null;

  @ApiProperty({ enum: CREDIT_NOTE_KINDS, enumName: 'CreditNoteKind', nullable: true, example: null })
  cnKind!: string | null;

  @ApiProperty({ enum: RECEIPT_VIAS, enumName: 'ReceiptVia', nullable: true, example: 'scb' })
  receiptVia!: string | null;

  @ApiProperty({ enum: TAX_NATURES, enumName: 'TaxNature', nullable: true, example: 'hire_of_work' })
  taxNature!: string | null;

  @ApiProperty({ example: '1000.00' })
  netAmount!: string;

  @ApiProperty({ example: '0.00' })
  discountAmount!: string;

  @ApiProperty({ example: '7.0000', description: 'Percent' })
  vatRatePct!: string;

  @ApiProperty({ example: '70.00' })
  vatAmount!: string;

  @ApiProperty({ example: '1070.00' })
  grossAmount!: string;

  @ApiProperty({ example: '0.00', description: 'Withheld by the customer (receipts)' })
  whtAmount!: string;

  @ApiProperty({ example: '1070.00', description: 'Cash received (receipts): gross − withholding' })
  cashAmount!: string;

  @ApiProperty({ example: '0.00', description: 'Final TR: instalments already taxed and deducted' })
  deductedPriorAmount!: string;

  @ApiProperty({ example: '0.00', description: 'Still owed on this document' })
  amountDue!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ type: [CustomerDocumentLineDto] })
  lines!: CustomerDocumentLineDto[];

  @ApiProperty({ type: DocumentReceivableDto, nullable: true })
  receivable!: DocumentReceivableDto | null;

  @ApiProperty({ example: true, description: 'The PDF is rendered and can be downloaded' })
  pdfReady!: boolean;

  @ApiProperty({ type: String, nullable: true, example: null })
  voidReason!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-05T10:00:00+07:00' })
  issuedAt!: string;

  @ApiProperty({
    type: [NextActionDto],
    description: 'What the signed-in staff member may do on it now; empty for customers (U-B0.3)',
  })
  nextActions!: NextActionDto[];
}

export const DOCUMENT_EXAMPLE: CustomerDocumentDto = {
  id: AR_IDS.document,
  docType: 'tr',
  docKind: 'instalment',
  docNumber: 'TR256910-00001',
  status: 'issued',
  documentDate: '2026-10-05',
  dueDate: null,
  isTaxInvoice: true,
  isFullForm: false,
  buyer: { name: 'ลูกค้า ตัวอย่าง (fake)', taxId: null, branchCode: null, address: null },
  seller: {
    name: 'บริษัท ตัวอย่าง จำกัด (fake)',
    taxId: '0000000000000',
    branchCode: '00000',
    address: '99/9 ถนนตัวอย่าง กรุงเทพมหานคร 10000',
  },
  orderGroupId: AR_IDS.group,
  groupCode: 'G2610-00001',
  orderId: AR_IDS.order,
  orderCode: 'O2610-00001',
  paymentId: AR_IDS.payment,
  originalDocument: null,
  reason: null,
  cnKind: null,
  receiptVia: 'scb',
  taxNature: 'hire_of_work',
  netAmount: '1000.00',
  discountAmount: '0.00',
  vatRatePct: '7.0000',
  vatAmount: '70.00',
  grossAmount: '1070.00',
  whtAmount: '0.00',
  cashAmount: '1070.00',
  deductedPriorAmount: '0.00',
  amountDue: '0.00',
  currency: 'THB',
  lines: [
    {
      lineNo: 1,
      description: 'งวดที่ 1 มัดจำ 50% — คำสั่งซื้อ O2610-00001',
      quantity: '1.000',
      netAmount: '1000.00',
      discountAmount: '0.00',
      vatAmount: '70.00',
      grossAmount: '1070.00',
      whtAmount: '0.00',
    },
  ],
  receivable: null,
  pdfReady: true,
  voidReason: null,
  issuedAt: '2026-10-05T10:00:00+07:00',
  nextActions: [{ key: 'customer_document.resend', irreversible: false, disabledReason: null }],
};

export class DocumentListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: CUSTOMER_DOCUMENT_TYPES, enumName: 'CustomerDocumentType' })
  @IsOptional()
  @IsIn(CUSTOMER_DOCUMENT_TYPES)
  docType?: (typeof CUSTOMER_DOCUMENT_TYPES)[number];

  @ApiPropertyOptional({ enum: CUSTOMER_DOCUMENT_STATUSES, enumName: 'CustomerDocumentStatus' })
  @IsOptional()
  @IsIn(CUSTOMER_DOCUMENT_STATUSES)
  status?: (typeof CUSTOMER_DOCUMENT_STATUSES)[number];

  @ApiPropertyOptional({ format: 'uuid', description: 'Order (all its documents)' })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Customer (user id)' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Company' })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-01' })
  @IsOptional()
  @Matches(DAY)
  from?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-31' })
  @IsOptional()
  @Matches(DAY)
  to?: string;
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Documents issued for this payment (receipts, tax invoices)',
  })
  @IsOptional()
  @IsUUID()
  paymentId?: string;
}

export const CN_DIRECTIONS = ['credit', 'debit'] as const;

/** Why a credit or debit note is issued, with its statutory category (D-092). */
export class CreditNoteReasonDto {
  @ApiProperty({ example: 'price_reduction' })
  code!: string;

  @ApiProperty({
    enum: ['price_reduction', 'defective_or_short', 'returns', 'cancellation', 'post_sale_discount', 'other'],
    enumName: 'CnStatutoryCategory',
    example: 'price_reduction',
  })
  statutoryCategory!: string;

  @ApiProperty({ example: 'ลดราคาสินค้า/บริการ' })
  nameTh!: string;

  @ApiProperty({ example: 'Price reduction' })
  nameEn!: string;

  @ApiProperty({ enum: ['item', 'service', 'both'], enumName: 'CnAppliesTo', example: 'both' })
  appliesTo!: string;

  @ApiProperty({
    enum: CN_DIRECTIONS,
    enumName: 'CnDirection',
    example: 'credit',
    description: '`credit` for credit-note requests, `debit` for debit notes',
  })
  direction!: string;
}

export const CREDIT_NOTE_REASON_EXAMPLE: CreditNoteReasonDto = {
  code: 'price_reduction',
  statutoryCategory: 'price_reduction',
  nameTh: 'ลดราคาสินค้า/บริการ',
  nameEn: 'Price reduction',
  appliesTo: 'both',
  direction: 'credit',
};

export class StoreDocumentListQuery extends PageQuery {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'A company the customer may read documents of (company_documents.read)',
  })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Only the documents of this order (all its instalments and notes)',
  })
  @IsOptional()
  @IsUUID()
  orderId?: string;
}

export { ReasonDto };

export class RequestCreditNoteDto {
  @ApiProperty({ example: '535.00', pattern: MONEY.source, description: 'Gross amount credited (incl. VAT)' })
  @Matches(MONEY)
  amount!: string;

  @ApiProperty({ enum: CREDIT_NOTE_KINDS, enumName: 'CreditNoteKind', example: 'price_reduction' })
  @IsIn(CREDIT_NOTE_KINDS)
  cnKind!: (typeof CREDIT_NOTE_KINDS)[number];

  @ApiPropertyOptional({
    example: 'price_reduction',
    description: 'Reason code (defaults to the kind’s statutory reason)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  reasonCode?: string;

  @ApiPropertyOptional({
    enum: CREDIT_SETTLEMENTS,
    enumName: 'CreditSettlement',
    description: 'Default: reduce what is owed, else the customer credit balance',
  })
  @IsOptional()
  @IsIn(CREDIT_SETTLEMENTS)
  settleTo?: (typeof CREDIT_SETTLEMENTS)[number];

  @ApiProperty({ example: 'ลดราคาตามข้อตกลงกับลูกค้า' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  note!: string;
}

export class CreditNoteRequestDto {
  @ApiProperty({ format: 'uuid', example: AR_IDS.request })
  id!: string;

  @ApiProperty({ format: 'uuid', example: AR_IDS.order })
  orderId!: string;

  @ApiProperty({ example: 'O2610-00001' })
  orderCode!: string;

  @ApiProperty({ enum: CREDIT_NOTE_KINDS, enumName: 'CreditNoteKind', example: 'price_reduction' })
  cnKind!: string;

  @ApiProperty({ example: 'price_reduction' })
  reasonCode!: string;

  @ApiProperty({ example: '535.00' })
  amount!: string;

  @ApiProperty({ enum: CREDIT_SETTLEMENTS, enumName: 'CreditSettlement', nullable: true, example: null })
  settleTo!: string | null;

  @ApiProperty({ example: 'ลดราคาตามข้อตกลงกับลูกค้า' })
  note!: string;

  @ApiProperty({
    enum: CREDIT_REQUEST_STATUSES,
    enumName: 'CreditNoteRequestStatus',
    example: 'pending_approval',
  })
  status!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: AR_IDS.approval })
  approvalRequestId!: string | null;

  @ApiProperty({ type: DocumentRefDto, nullable: true, description: 'The credit note once issued' })
  creditNote!: DocumentRefDto | null;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Claim the credit resolves' })
  claimNo!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-20T10:00:00+07:00' })
  createdAt!: string;
}

export const CN_REQUEST_EXAMPLE: CreditNoteRequestDto = {
  id: AR_IDS.request,
  orderId: AR_IDS.order,
  orderCode: 'O2610-00001',
  cnKind: 'price_reduction',
  reasonCode: 'price_reduction',
  amount: '535.00',
  settleTo: null,
  note: 'ลดราคาตามข้อตกลงกับลูกค้า',
  status: 'pending_approval',
  approvalRequestId: AR_IDS.approval,
  creditNote: null,
  claimNo: null,
  createdAt: '2026-10-20T10:00:00+07:00',
};

export class CreditNoteRequestListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: CREDIT_REQUEST_STATUSES, enumName: 'CreditNoteRequestStatus' })
  @IsOptional()
  @IsIn(CREDIT_REQUEST_STATUSES)
  status?: (typeof CREDIT_REQUEST_STATUSES)[number];
}

export class IssueDebitNoteDto {
  @ApiProperty({
    example: '500.00',
    pattern: MONEY.source,
    description: 'Net amount added (VAT at the invoice’s rate)',
  })
  @Matches(MONEY)
  net!: string;

  @ApiProperty({ example: 'additional_charge' })
  @IsString()
  @MaxLength(64)
  reasonCode!: string;

  @ApiProperty({ example: 'ค่าบริการเพิ่มเติมตามใบเสนอราคาแนบ' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  note!: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-11-30' })
  @IsOptional()
  @Matches(DAY)
  dueDate?: string;
}

export class ReceivableItemDto {
  @ApiProperty({ format: 'uuid', example: AR_IDS.item })
  id!: string;

  @ApiProperty({ type: DocumentRefDto })
  document!: DocumentRefDto;

  @ApiProperty({ format: 'uuid', example: AR_IDS.customer })
  customerId!: string;

  @ApiProperty({ example: 'ลูกค้า ตัวอย่าง (fake)' })
  customerName!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  companyId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  companyName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'O2610-00001' })
  orderCode!: string | null;

  @ApiProperty({ format: 'date', example: '2026-11-04' })
  dueDate!: string;

  @ApiProperty({ example: '535.00' })
  amount!: string;

  @ApiProperty({ example: '535.00' })
  openAmount!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ enum: AR_ITEM_STATUSES, enumName: 'ArItemStatus', example: 'open' })
  status!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'Pending or decided write-off approval',
  })
  writeOffApprovalId!: string | null;
}

export const ITEM_EXAMPLE: ReceivableItemDto = {
  id: AR_IDS.item,
  document: { id: AR_IDS.document, docNumber: 'IV2026-00001' },
  customerId: AR_IDS.customer,
  customerName: 'ลูกค้า ตัวอย่าง (fake)',
  companyId: null,
  companyName: null,
  orderCode: 'O2610-00001',
  dueDate: '2026-11-04',
  amount: '535.00',
  openAmount: '535.00',
  currency: 'THB',
  status: 'open',
  writeOffApprovalId: null,
};

export class ReceivableListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: AR_ITEM_STATUSES, enumName: 'ArItemStatus' })
  @IsOptional()
  @IsIn(AR_ITEM_STATUSES)
  status?: (typeof AR_ITEM_STATUSES)[number];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Customer (user id)' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ type: Boolean, example: true, description: 'Only items past their due date' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  overdue?: boolean;
}

export class AgingBucketsDto {
  @ApiProperty({ example: '1000.00', description: 'Not due yet' })
  current!: string;

  @ApiProperty({ example: '0.00' })
  d1_30!: string;

  @ApiProperty({ example: '0.00' })
  d31_60!: string;

  @ApiProperty({ example: '0.00' })
  d61_90!: string;

  @ApiProperty({ example: '0.00' })
  over_90!: string;
}

export class AgingPartyDto {
  @ApiProperty({ format: 'uuid', example: AR_IDS.customer })
  customerId!: string;

  @ApiProperty({ example: 'ลูกค้า ตัวอย่าง (fake)' })
  customerName!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  companyId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  companyName!: string | null;

  @ApiProperty({ type: AgingBucketsDto })
  buckets!: AgingBucketsDto;
}

export class AgingReportDto {
  @ApiProperty({ format: 'date', example: '2026-10-31' })
  asOf!: string;

  @ApiProperty({ type: [AgingPartyDto] })
  parties!: AgingPartyDto[];

  @ApiProperty({ type: AgingBucketsDto })
  totals!: AgingBucketsDto;

  @ApiProperty({ example: 'THB' })
  currency!: string;
}

const BUCKETS_EXAMPLE = {
  current: '1000.00',
  d1_30: '0.00',
  d31_60: '0.00',
  d61_90: '0.00',
  over_90: '0.00',
};
export const AGING_EXAMPLE: AgingReportDto = {
  asOf: '2026-10-31',
  parties: [
    {
      customerId: AR_IDS.customer,
      customerName: 'ลูกค้า ตัวอย่าง (fake)',
      companyId: null,
      companyName: null,
      buckets: BUCKETS_EXAMPLE,
    },
  ],
  totals: BUCKETS_EXAMPLE,
  currency: 'THB',
};

export class AgingQuery {
  @ApiPropertyOptional({ format: 'date', example: '2026-10-31', description: 'Default: today (Bangkok)' })
  @IsOptional()
  @Matches(DAY)
  asOf?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  companyId?: string;
}

export class ProvisionDto {
  @ApiProperty({ format: 'date', example: '2026-12-31' })
  @Matches(DAY)
  asOf!: string;

  @ApiPropertyOptional({
    example: '1000.00',
    pattern: MONEY.source,
    description: 'Target allowance; required while `receivables.allowance_rates` is not set',
  })
  @IsOptional()
  @Matches(MONEY)
  amount?: string;
}

export class ProvisionResultDto {
  @ApiProperty({ format: 'uuid', example: AR_IDS.entry })
  id!: string;

  @ApiProperty({ example: 'manual' })
  method!: string;

  @ApiProperty({ example: '1000.00', description: 'Allowance after the update' })
  targetAmount!: string;

  @ApiProperty({ example: '1000.00', description: 'Change posted (P30); negative releases allowance' })
  amount!: string;
}

export class WhtCertificateDto {
  @ApiProperty({ format: 'uuid', example: AR_IDS.cert })
  id!: string;

  @ApiProperty({ type: DocumentRefDto })
  receipt!: DocumentRefDto;

  @ApiProperty({ format: 'uuid', example: AR_IDS.customer })
  customerId!: string;

  @ApiProperty({ example: 'ลูกค้า ตัวอย่าง (fake)' })
  customerName!: string;

  @ApiProperty({ type: String, nullable: true, example: 'บริษัท ตัวอย่าง จำกัด (fake)' })
  companyName!: string | null;

  @ApiProperty({ example: '1000.00' })
  whtBase!: string;

  @ApiProperty({ example: '30.00' })
  whtAmount!: string;

  @ApiProperty({ enum: WHT_CERT_STATUSES, enumName: 'WhtCertStatus', example: 'pending' })
  status!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  certificateNo!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: null })
  certificateDate!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  fileId!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-05T10:00:00+07:00' })
  createdAt!: string;
}

export const CERT_EXAMPLE: WhtCertificateDto = {
  id: AR_IDS.cert,
  receipt: { id: AR_IDS.document, docNumber: 'TR256910-00001' },
  customerId: AR_IDS.customer,
  customerName: 'ลูกค้า ตัวอย่าง (fake)',
  companyName: 'บริษัท ตัวอย่าง จำกัด (fake)',
  whtBase: '1000.00',
  whtAmount: '30.00',
  status: 'pending',
  certificateNo: null,
  certificateDate: null,
  fileId: null,
  createdAt: '2026-10-05T10:00:00+07:00',
};

export class WhtCertificateListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: WHT_CERT_STATUSES, enumName: 'WhtCertStatus' })
  @IsOptional()
  @IsIn(WHT_CERT_STATUSES)
  status?: (typeof WHT_CERT_STATUSES)[number];

  @ApiPropertyOptional({
    type: 'integer',
    example: 30,
    description: 'Only certificates waiting longer than this (missing-certificate report)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  olderThanDays?: number;
}

export class RecordWhtCertificateDto {
  @ApiProperty({ example: 'WT-0001' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  certificateNo!: string;

  @ApiProperty({ format: 'date', example: '2026-10-10' })
  @Matches(DAY)
  certificateDate!: string;

  @ApiPropertyOptional({
    example: '0192f3a0-7c1e-7d2a-9b1f-0000000b2018',
    format: 'uuid',
    description: 'Uploaded copy (purpose `document`)',
  })
  @IsOptional()
  @IsUUID()
  fileId?: string;
}

export class StoreCreditEntryDto {
  @ApiProperty({ format: 'uuid', example: AR_IDS.entry })
  id!: string;

  @ApiProperty({ example: '10.70', description: 'Signed: credits positive, uses and refunds negative' })
  amount!: string;

  @ApiProperty({ enum: STORE_CREDIT_SOURCES, enumName: 'StoreCreditSource', example: 'shortage_credit' })
  source!: string;

  @ApiProperty({ type: String, nullable: true, example: 'CN256911-00001' })
  docNumber!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'O2610-00001' })
  orderCode!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-11-04T10:00:00+07:00' })
  createdAt!: string;
}

export class StoreCreditDto {
  @ApiProperty({ example: '10.70' })
  balance!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ type: [StoreCreditEntryDto] })
  entries!: StoreCreditEntryDto[];
}

export const STORE_CREDIT_EXAMPLE: StoreCreditDto = {
  balance: '10.70',
  currency: 'THB',
  entries: [
    {
      id: AR_IDS.entry,
      amount: '10.70',
      source: 'shortage_credit',
      docNumber: 'CN256911-00001',
      orderCode: 'O2610-00001',
      createdAt: '2026-11-04T10:00:00+07:00',
    },
  ],
};

export class CompanyStatementDto {
  @ApiProperty({ format: 'uuid', example: AR_IDS.statement })
  id!: string;

  @ApiProperty({ example: '2026-10' })
  month!: string;

  @ApiProperty({ example: '0.00' })
  opening!: string;

  @ApiProperty({ example: '1070.00' })
  invoiced!: string;

  @ApiProperty({ example: '0.00' })
  paid!: string;

  @ApiProperty({ example: '0.00' })
  credited!: string;

  @ApiProperty({ example: '1070.00' })
  closing!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ example: true })
  pdfReady!: boolean;
}

export const STATEMENT_EXAMPLE: CompanyStatementDto = {
  id: AR_IDS.statement,
  month: '2026-10',
  opening: '0.00',
  invoiced: '1070.00',
  paid: '0.00',
  credited: '0.00',
  closing: '1070.00',
  currency: 'THB',
  pdfReady: true,
};

export class StatementQuery {
  @ApiProperty({ example: '2026-10', pattern: '^\\d{4}-\\d{2}$' })
  @Matches(/^\d{4}-\d{2}$/)
  month!: string;
}

// --- resend, deliveries, dunning log (U-B0.3) ---------------------------------------------------------------

export const NOTIFICATION_STATUSES = [
  'queued',
  'deferred_quiet_hours',
  'suppressed_no_consent',
  'sent',
  'delivered',
  'failed',
  'bounced',
  'read',
] as const;

export class DocumentSendResultDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000d7001' })
  documentId!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-05T10:00:00+07:00' })
  requestedAt!: string;
}

export class DocumentDeliveryDto {
  @ApiProperty({
    enum: ['email', 'sms', 'line', 'web_push', 'in_app', 'teams'],
    enumName: 'NotificationChannel',
    example: 'email',
  })
  channel!: string;

  @ApiProperty({ type: String, nullable: true, example: 's***@example.com', description: 'Masked (PDPA)' })
  recipient!: string | null;

  @ApiProperty({ enum: NOTIFICATION_STATUSES, enumName: 'NotificationStatus', example: 'sent' })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-05T10:01:00+07:00' })
  sentAt!: string | null;

  @ApiProperty({ enum: ['issued', 'resent'], enumName: 'DocumentDeliveryKind', example: 'resent' })
  kind!: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-10-05T10:00:00+07:00',
    description: 'When it was asked for',
  })
  requestedAt!: string;
}

export class DunningLogQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  documentId?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-01',
    description: 'Reminders on or after (Bangkok)',
  })
  @IsOptional()
  @Matches(DAY)
  from?: string;
}

export class DunningEntryDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000d7001' })
  documentId!: string;

  @ApiProperty({ example: 'IV-2610-00012' })
  docNumber!: string;

  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000d7002' })
  customerId!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  companyId!: string | null;

  @ApiProperty({ enum: ['before_due', 'on_due', 'overdue'], enumName: 'DunningStage', example: 'before_due' })
  stage!: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-10-08T09:00:00+07:00',
    description: 'When the reminder was raised',
  })
  remindedAt!: string;

  @ApiProperty({
    enum: ['email', 'sms', 'line', 'web_push', 'in_app', 'teams'],
    enumName: 'NotificationChannel',
    nullable: true,
    example: 'email',
    description: 'Null when no route sent it',
  })
  channel!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 's***@example.com', description: 'Masked (PDPA)' })
  recipient!: string | null;

  @ApiProperty({
    enum: NOTIFICATION_STATUSES,
    enumName: 'NotificationStatus',
    nullable: true,
    example: 'sent',
  })
  status!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-08T09:00:05+07:00' })
  sentAt!: string | null;
}
