import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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

/** Payables (B5.3): factory POs, GRs, billing statements, vendor invoices, payables, vendors. Money: strings, THB. */

const MONEY = /^\d{1,12}\.\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TAX_ID = /^\d{13}$/;
const BRANCH = /^\d{5}$/;

export const PO_KINDS = ['production', 'mockup', 'reproduction'] as const;
export const PO_STATUSES = ['issued', 'accepted', 'cancelled', 'received', 'closed'] as const;
export const PO_LINE_TYPES = ['production', 'shipping', 'mockup', 'design', 'reproduction'] as const;
export const WHT_CATEGORIES = ['hire_of_work', 'transport', 'service', 'none'] as const;
export const BS_STATUSES = ['generated', 'sent', 'confirmed', 'disputed', 'superseded'] as const;
export const VI_STATUSES = ['recorded', 'validated', 'rejected', 'void'] as const;
export const INPUT_VAT_STATUSES = ['claimable', 'pending_document', 'not_claimable'] as const;
export const VI_SOURCES = ['e_tax', 'pdf_upload', 'manual'] as const;
export const PAYABLE_SOURCES = ['advance', 'goods_receipt', 'vendor_invoice', 'retention'] as const;
export const PAYABLE_STATUSES = ['open', 'eligible', 'in_run', 'paid', 'cancelled'] as const;
export const VENDOR_KINDS = ['factory', 'carrier', 'freelancer', 'service', 'other'] as const;
export const JURISTIC_TYPES = ['company', 'partnership', 'individual'] as const;

export const AP_IDS = {
  po: '0192f3a0-7c1e-7d2a-9b1f-000000530001',
  gr: '0192f3a0-7c1e-7d2a-9b1f-000000530002',
  bs: '0192f3a0-7c1e-7d2a-9b1f-000000530003',
  vi: '0192f3a0-7c1e-7d2a-9b1f-000000530004',
  payable: '0192f3a0-7c1e-7d2a-9b1f-000000530005',
  vendor: '0192f3a0-7c1e-7d2a-9b1f-000000530006',
  factory: '0192f3a0-7c1e-7d2a-9b1f-000000000501',
  order: '0192f3a0-7c1e-7d2a-9b1f-0000000c0001',
  file: '0192f3a0-7c1e-7d2a-9b1f-0000000a0003',
};

export class ApLineDto {
  @ApiProperty({ type: 'integer', example: 1 })
  lineNo!: number;

  @ApiProperty({ enum: PO_LINE_TYPES, enumName: 'PoLineType', example: 'production' })
  lineType!: string;

  @ApiProperty({ example: 'กล่องพับ — JOB2610-00001' })
  description!: string;

  @ApiProperty({ type: 'integer', example: 1000 })
  quantity!: number;

  @ApiProperty({ example: '8.000000', description: 'Unit price (6 decimals)' })
  unitPrice!: string;

  @ApiProperty({ example: '8000.00' })
  netAmount!: string;

  @ApiProperty({ example: '560.00' })
  vatAmount!: string;

  @ApiProperty({ example: '8560.00' })
  grossAmount!: string;

  @ApiProperty({ enum: WHT_CATEGORIES, enumName: 'WhtCategory', example: 'hire_of_work' })
  whtCategory!: string;
}

export class PurchaseOrderDto {
  @ApiProperty({ format: 'uuid', example: AP_IDS.po })
  id!: string;

  @ApiProperty({ example: 'DEVPO-26-00001' })
  poNumber!: string;

  @ApiProperty({
    enum: PO_KINDS,
    enumName: 'JobKind',
    example: 'production',
    description: 'The kind of the released job',
  })
  poKind!: string;

  @ApiProperty({ enum: PO_STATUSES, enumName: 'PoStatus', example: 'accepted' })
  status!: string;

  @ApiProperty({ format: 'uuid', example: AP_IDS.factory })
  factoryId!: string;

  @ApiProperty({ example: 'JOB2610-00001' })
  jobNo!: string;

  @ApiProperty({ example: 'O2610-00001' })
  orderCode!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-05T10:00:00+07:00' })
  issuedAt!: string;

  @ApiProperty({ example: '8000.00' })
  netAmount!: string;

  @ApiProperty({ example: '560.00' })
  vatAmount!: string;

  @ApiProperty({ example: '8560.00' })
  grossAmount!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ type: [ApLineDto] })
  lines!: ApLineDto[];
}

const LINE_EXAMPLE: ApLineDto = {
  lineNo: 1,
  lineType: 'production',
  description: 'กล่องพับ — JOB2610-00001',
  quantity: 1000,
  unitPrice: '8.000000',
  netAmount: '8000.00',
  vatAmount: '560.00',
  grossAmount: '8560.00',
  whtCategory: 'hire_of_work',
};
export const PO_EXAMPLE: PurchaseOrderDto = {
  id: AP_IDS.po,
  poNumber: 'DEVPO-26-00001',
  poKind: 'production',
  status: 'accepted',
  factoryId: AP_IDS.factory,
  jobNo: 'JOB2610-00001',
  orderCode: 'O2610-00001',
  issuedAt: '2026-10-05T10:00:00+07:00',
  netAmount: '8000.00',
  vatAmount: '560.00',
  grossAmount: '8560.00',
  currency: 'THB',
  lines: [LINE_EXAMPLE],
};

export class ApListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid', description: 'Factory (staff only; factories see their own)' })
  @IsOptional()
  @IsUUID()
  factoryId?: string;

  @ApiPropertyOptional({ example: 'accepted', description: 'Status of the listed documents' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  status?: string;
}

export class GoodsReceiptDto {
  @ApiProperty({ format: 'uuid', example: AP_IDS.gr })
  id!: string;

  @ApiProperty({ example: 'DEVGR-26-00001' })
  grNumber!: string;

  @ApiProperty({ example: 'DEVPO-26-00001' })
  poNumber!: string;

  @ApiProperty({ format: 'date', example: '2026-10-20' })
  receivedOn!: string;

  @ApiProperty({ type: 'integer', example: 990 })
  receivedQuantity!: number;

  @ApiProperty({ type: 'integer', example: 990, description: 'min(delivered, ordered) (D-165)' })
  payableQuantity!: number;

  @ApiProperty({ example: '7960.00' })
  netAmount!: string;

  @ApiProperty({ example: '557.20' })
  vatAmount!: string;

  @ApiProperty({ example: '8517.20' })
  grossAmount!: string;

  @ApiProperty({ type: [ApLineDto] })
  lines!: ApLineDto[];
}

export const GR_EXAMPLE: GoodsReceiptDto = {
  id: AP_IDS.gr,
  grNumber: 'DEVGR-26-00001',
  poNumber: 'DEVPO-26-00001',
  receivedOn: '2026-10-20',
  receivedQuantity: 990,
  payableQuantity: 990,
  netAmount: '7960.00',
  vatAmount: '557.20',
  grossAmount: '8517.20',
  lines: [LINE_EXAMPLE],
};

export class BillingStatementLineDto {
  @ApiProperty({ type: 'integer', example: 1 })
  lineNo!: number;

  @ApiProperty({ example: 'DEVGR-26-00001 กล่องพับ' })
  description!: string;

  @ApiProperty({ example: '7920.00' })
  netAmount!: string;

  @ApiProperty({ example: '554.40' })
  vatAmount!: string;

  @ApiProperty({ example: '8474.40' })
  grossAmount!: string;
}

export class BillingStatementDto {
  @ApiProperty({ format: 'uuid', example: AP_IDS.bs })
  id!: string;

  @ApiProperty({ example: 'DEVBS-26-00001' })
  bsNumber!: string;

  @ApiProperty({ format: 'uuid', example: AP_IDS.factory })
  factoryId!: string;

  @ApiProperty({ enum: BS_STATUSES, enumName: 'BillingStatementStatus', example: 'sent' })
  status!: string;

  @ApiProperty({ format: 'date', example: '2026-10-05' })
  periodFrom!: string;

  @ApiProperty({ format: 'date', example: '2026-10-20' })
  periodTo!: string;

  @ApiProperty({ example: '7960.00' })
  netAmount!: string;

  @ApiProperty({ example: '557.20' })
  vatAmount!: string;

  @ApiProperty({ example: '8517.20' })
  grossAmount!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  disputeNote!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  confirmedAt!: string | null;

  @ApiProperty({ type: [BillingStatementLineDto] })
  lines!: BillingStatementLineDto[];
}

export const BS_EXAMPLE: BillingStatementDto = {
  id: AP_IDS.bs,
  bsNumber: 'DEVBS-26-00001',
  factoryId: AP_IDS.factory,
  status: 'sent',
  periodFrom: '2026-10-05',
  periodTo: '2026-10-20',
  netAmount: '7960.00',
  vatAmount: '557.20',
  grossAmount: '8517.20',
  disputeNote: null,
  confirmedAt: null,
  lines: [
    {
      lineNo: 1,
      description: 'DEVGR-26-00001 กล่องพับ',
      netAmount: '7920.00',
      vatAmount: '554.40',
      grossAmount: '8474.40',
    },
  ],
};

export class DisputeStatementDto {
  @ApiProperty({ example: 'ยอดขนส่งไม่ตรงกับใบส่งของ', description: 'What is wrong with the statement' })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note!: string;
}

export class CaptureTaxInvoiceDto {
  @ApiProperty({ example: 'IV2610-0099', description: 'The factory’s own tax invoice number' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  vendorInvoiceNo!: string;

  @ApiProperty({ format: 'date', example: '2026-10-21' })
  @Matches(DAY)
  invoiceDate!: string;

  @ApiProperty({ example: '0000000000001', pattern: TAX_ID.source })
  @Matches(TAX_ID)
  sellerTaxId!: string;

  @ApiProperty({ example: '00000', pattern: BRANCH.source })
  @Matches(BRANCH)
  sellerBranchCode!: string;

  @ApiProperty({ example: '7960.00', pattern: MONEY.source })
  @Matches(MONEY)
  netAmount!: string;

  @ApiProperty({ example: '557.20', pattern: MONEY.source })
  @Matches(MONEY)
  vatAmount!: string;

  @ApiProperty({ enum: ['e_tax', 'pdf_upload'], enumName: 'TaxInvoiceCaptureSource', example: 'pdf_upload' })
  @IsIn(['e_tax', 'pdf_upload'])
  source!: 'e_tax' | 'pdf_upload';

  @ApiPropertyOptional({ format: 'uuid', description: 'The uploaded PDF / e-Tax file (purpose `document`)' })
  @IsOptional()
  @IsUUID()
  fileId?: string;
}

export class ValidateInvoiceDto {
  @ApiProperty({ example: true, description: 'false rejects the invoice (reason required)' })
  @IsBoolean()
  valid!: boolean;

  @ApiPropertyOptional({ example: 'เลขผู้เสียภาษีไม่ตรง' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class VendorInvoiceLineDto {
  @ApiProperty({ example: 'ค่าขนส่ง Flash' })
  description!: string;

  @ApiProperty({ type: String, nullable: true, example: '5130' })
  accountCode!: string | null;

  @ApiProperty({ example: '100.00' })
  netAmount!: string;

  @ApiProperty({ example: '7.00' })
  vatAmount!: string;

  @ApiProperty({ enum: WHT_CATEGORIES, enumName: 'WhtCategory', example: 'transport' })
  whtCategory!: string;
}

export class VendorInvoiceDto {
  @ApiProperty({ format: 'uuid', example: AP_IDS.vi })
  id!: string;

  @ApiProperty({ format: 'uuid', example: AP_IDS.vendor })
  vendorId!: string;

  @ApiProperty({ example: 'บริษัท ขนส่งตัวอย่าง จำกัด (fake)' })
  vendorName!: string;

  @ApiProperty({ type: String, nullable: true, example: 'DEVBS-26-00001' })
  bsNumber!: string | null;

  @ApiProperty({ example: 'IV2610-0099' })
  vendorInvoiceNo!: string;

  @ApiProperty({ format: 'date', example: '2026-10-21' })
  invoiceDate!: string;

  @ApiProperty({ example: '0000000000001' })
  sellerTaxId!: string;

  @ApiProperty({ example: '00000' })
  sellerBranchCode!: string;

  @ApiProperty({ example: true })
  isTaxInvoice!: boolean;

  @ApiProperty({ enum: VI_SOURCES, enumName: 'VendorInvoiceSource', example: 'pdf_upload' })
  source!: string;

  @ApiProperty({ example: '7960.00' })
  netAmount!: string;

  @ApiProperty({ example: '557.20' })
  vatAmount!: string;

  @ApiProperty({ example: '8517.20' })
  grossAmount!: string;

  @ApiProperty({ enum: INPUT_VAT_STATUSES, enumName: 'InputVatStatus', example: 'pending_document' })
  inputVatStatus!: string;

  @ApiProperty({ enum: VI_STATUSES, enumName: 'VendorInvoiceStatus', example: 'recorded' })
  status!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  rejectionReason!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: AP_IDS.file })
  fileId!: string | null;

  @ApiProperty({ type: [VendorInvoiceLineDto] })
  lines!: VendorInvoiceLineDto[];
}

export const VI_EXAMPLE: VendorInvoiceDto = {
  id: AP_IDS.vi,
  vendorId: AP_IDS.vendor,
  vendorName: 'โรงพิมพ์ตัวอย่าง (fake)',
  bsNumber: 'DEVBS-26-00001',
  vendorInvoiceNo: 'IV2610-0099',
  invoiceDate: '2026-10-21',
  sellerTaxId: '0000000000001',
  sellerBranchCode: '00000',
  isTaxInvoice: true,
  source: 'pdf_upload',
  netAmount: '7960.00',
  vatAmount: '557.20',
  grossAmount: '8517.20',
  inputVatStatus: 'pending_document',
  status: 'recorded',
  rejectionReason: null,
  fileId: AP_IDS.file,
  lines: [],
};

export class VendorInvoiceListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: VI_STATUSES, enumName: 'VendorInvoiceStatus' })
  @IsOptional()
  @IsIn(VI_STATUSES)
  status?: (typeof VI_STATUSES)[number];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  vendorId?: string;
}

export class PayableDto {
  @ApiProperty({ format: 'uuid', example: AP_IDS.payable })
  id!: string;

  @ApiProperty({ format: 'uuid', example: AP_IDS.vendor })
  vendorId!: string;

  @ApiProperty({ example: 'โรงพิมพ์ตัวอย่าง (fake)' })
  vendorName!: string;

  @ApiProperty({ enum: PAYABLE_SOURCES, enumName: 'PayableSource', example: 'goods_receipt' })
  source!: string;

  @ApiProperty({ type: String, nullable: true, example: 'DEVPO-26-00001' })
  poNumber!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'O2610-00001' })
  orderCode!: string | null;

  @ApiProperty({ example: '5560.00', description: 'Net still to pay' })
  openNetAmount!: string;

  @ApiProperty({ example: '389.20', description: 'VAT still to pay' })
  openVatAmount!: string;

  @ApiProperty({ example: '5.0000', description: 'Retention % held on payment (D-164)' })
  retentionPct!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-27T10:00:00+07:00' })
  eligibleAt!: string | null;

  @ApiProperty({ enum: PAYABLE_STATUSES, enumName: 'PayableStatus', example: 'open' })
  status!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;
}

export const PAYABLE_EXAMPLE: PayableDto = {
  id: AP_IDS.payable,
  vendorId: AP_IDS.vendor,
  vendorName: 'โรงพิมพ์ตัวอย่าง (fake)',
  source: 'goods_receipt',
  poNumber: 'DEVPO-26-00001',
  orderCode: 'O2610-00001',
  openNetAmount: '5560.00',
  openVatAmount: '389.20',
  retentionPct: '5.0000',
  eligibleAt: '2026-10-27T10:00:00+07:00',
  status: 'open',
  currency: 'THB',
};

export class PayableListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: PAYABLE_STATUSES, enumName: 'PayableStatus' })
  @IsOptional()
  @IsIn(PAYABLE_STATUSES)
  status?: (typeof PAYABLE_STATUSES)[number];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  vendorId?: string;
}

export class VendorDto {
  @ApiProperty({ format: 'uuid', example: AP_IDS.vendor })
  id!: string;

  @ApiProperty({ enum: VENDOR_KINDS, enumName: 'VendorKind', example: 'carrier' })
  kind!: string;

  @ApiProperty({ example: 'บริษัท ขนส่งตัวอย่าง จำกัด (fake)' })
  legalName!: string;

  @ApiProperty({ enum: JURISTIC_TYPES, enumName: 'JuristicType', example: 'company' })
  juristicType!: string;

  @ApiProperty({ example: '0000000000002' })
  taxId!: string;

  @ApiProperty({ example: '00000' })
  branchCode!: string;

  @ApiProperty({ example: true })
  isVatRegistered!: boolean;

  @ApiProperty({ enum: WHT_CATEGORIES, enumName: 'WhtCategory', example: 'transport' })
  defaultWhtCategory!: string;

  @ApiProperty({ type: 'integer', example: 30 })
  paymentTermsDays!: number;
}

export const VENDOR_EXAMPLE: VendorDto = {
  id: AP_IDS.vendor,
  kind: 'carrier',
  legalName: 'บริษัท ขนส่งตัวอย่าง จำกัด (fake)',
  juristicType: 'company',
  taxId: '0000000000002',
  branchCode: '00000',
  isVatRegistered: true,
  defaultWhtCategory: 'transport',
  paymentTermsDays: 30,
};

export class CreateVendorDto {
  @ApiProperty({
    enum: ['carrier', 'freelancer', 'service', 'other'],
    enumName: 'OtherVendorKind',
    example: 'carrier',
  })
  @IsIn(['carrier', 'freelancer', 'service', 'other'])
  kind!: 'carrier' | 'freelancer' | 'service' | 'other';

  @ApiProperty({ example: 'บริษัท ขนส่งตัวอย่าง จำกัด (fake)' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  legalName!: string;

  @ApiProperty({
    enum: JURISTIC_TYPES,
    enumName: 'JuristicType',
    example: 'company',
    description: 'individual → ภ.ง.ด.3, else ภ.ง.ด.53',
  })
  @IsIn(JURISTIC_TYPES)
  juristicType!: (typeof JURISTIC_TYPES)[number];

  @ApiProperty({ example: '0000000000002', pattern: TAX_ID.source })
  @Matches(TAX_ID)
  taxId!: string;

  @ApiPropertyOptional({ example: '00000', pattern: BRANCH.source })
  @IsOptional()
  @Matches(BRANCH)
  branchCode?: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  isVatRegistered!: boolean;

  @ApiProperty({ enum: WHT_CATEGORIES, enumName: 'WhtCategory', example: 'transport' })
  @IsIn(WHT_CATEGORIES)
  defaultWhtCategory!: (typeof WHT_CATEGORIES)[number];

  @ApiProperty({ type: 'integer', example: 30 })
  @IsInt()
  @Min(0)
  @Max(180)
  paymentTermsDays!: number;
}

export class BillLineInputDto {
  @ApiProperty({ example: 'ค่าขนส่ง Flash ออเดอร์ O2610-00001' })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  description!: string;

  @ApiProperty({ example: '5130', description: 'Expense / cost / asset account (not a control account)' })
  @Matches(/^[0-9A-Z][0-9A-Z.-]*$/)
  accountCode!: string;

  @ApiProperty({ example: '100.00', pattern: MONEY.source })
  @Matches(MONEY)
  netAmount!: string;

  @ApiProperty({ example: '7.00', pattern: MONEY.source })
  @Matches(MONEY)
  vatAmount!: string;

  @ApiProperty({ enum: WHT_CATEGORIES, enumName: 'WhtCategory', example: 'transport' })
  @IsIn(WHT_CATEGORIES)
  whtCategory!: (typeof WHT_CATEGORIES)[number];
}

export class RecordBillDto {
  @ApiProperty({ example: 'FL-2610-0001' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  vendorInvoiceNo!: string;

  @ApiProperty({ format: 'date', example: '2026-10-21' })
  @Matches(DAY)
  invoiceDate!: string;

  @ApiProperty({ example: true, description: 'A valid tax invoice (input VAT claimable, §2)' })
  @IsBoolean()
  isTaxInvoice!: boolean;

  @ApiProperty({ type: [BillLineInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BillLineInputDto)
  lines!: BillLineInputDto[];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  shipmentId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  fileId?: string;
}

export class VendorListQuery {
  @ApiPropertyOptional({ enum: VENDOR_KINDS, enumName: 'VendorKind' })
  @IsOptional()
  @IsIn(VENDOR_KINDS)
  kind?: (typeof VENDOR_KINDS)[number];
}
