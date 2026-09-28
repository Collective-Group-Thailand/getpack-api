import { bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { type Vendor } from '@generated/prisma/client';

import {
  type ApLineDto,
  type BillingStatementDto,
  type GoodsReceiptDto,
  type PayableDto,
  type PurchaseOrderDto,
  type VendorDto,
  type VendorInvoiceDto,
} from './payables.dto';
import { type BsRow, type GrRow, type PayableRow, type PoRow } from './payables-query.service';
import { type InvoiceRow } from './vendor-invoices.service';

type Amount = { toFixed(dp: number): string };
const m = (v: Amount) => v.toFixed(2);

const lineDto = (l: PoRow['lines'][number] | GrRow['lines'][number]): ApLineDto => ({
  lineNo: l.lineNo,
  lineType: l.lineType,
  description: l.description,
  quantity: l.quantity,
  unitPrice: l.unitPrice.toFixed(6),
  netAmount: m(l.netAmount),
  vatAmount: m(l.vatAmount),
  grossAmount: m(l.grossAmount),
  whtCategory: l.whtCategory,
});

export const poDto = (r: PoRow): PurchaseOrderDto => ({
  id: r.publicId,
  poNumber: r.poNumber,
  poKind: r.poKind,
  status: r.status,
  factoryId: r.factory.publicId,
  jobNo: r.productionJob.jobNo,
  orderCode: r.order.orderCode,
  issuedAt: toBangkokIso(r.issuedAt),
  netAmount: m(r.netAmount),
  vatAmount: m(r.vatAmount),
  grossAmount: m(r.grossAmount),
  currency: 'THB',
  lines: r.lines.map(lineDto),
});

export const grDto = (r: GrRow): GoodsReceiptDto => ({
  id: r.publicId,
  grNumber: r.grNumber,
  poNumber: r.po.poNumber,
  receivedOn: bangkokDate(r.receivedOn),
  receivedQuantity: r.receivedQuantity,
  payableQuantity: r.payableQuantity,
  netAmount: m(r.netAmount),
  vatAmount: m(r.vatAmount),
  grossAmount: m(r.grossAmount),
  lines: r.lines.map(lineDto),
});

export const bsDto = (r: BsRow): BillingStatementDto => ({
  id: r.publicId,
  bsNumber: r.bsNumber,
  factoryId: r.factory.publicId,
  status: r.status,
  periodFrom: bangkokDate(r.periodFrom),
  periodTo: bangkokDate(r.periodTo),
  netAmount: m(r.netAmount),
  vatAmount: m(r.vatAmount),
  grossAmount: m(r.grossAmount),
  disputeNote: r.disputeNote,
  confirmedAt: r.confirmedAt ? toBangkokIso(r.confirmedAt) : null,
  lines: r.lines.map((l) => ({
    lineNo: l.lineNo,
    description: l.description,
    netAmount: m(l.netAmount),
    vatAmount: m(l.vatAmount),
    grossAmount: m(l.grossAmount),
  })),
});

export const invoiceDto = (r: InvoiceRow): VendorInvoiceDto => ({
  id: r.publicId,
  vendorId: r.vendor.publicId,
  vendorName: r.vendor.legalName,
  bsNumber: r.billingStatement?.bsNumber ?? null,
  vendorInvoiceNo: r.vendorInvoiceNo,
  invoiceDate: bangkokDate(r.invoiceDate),
  sellerTaxId: r.sellerTaxId,
  sellerBranchCode: r.sellerBranchCode,
  isTaxInvoice: r.isTaxInvoice,
  source: r.source,
  netAmount: m(r.netAmount),
  vatAmount: m(r.vatAmount),
  grossAmount: m(r.grossAmount),
  inputVatStatus: r.inputVatStatus,
  status: r.status,
  rejectionReason: r.rejectionReason,
  fileId: r.file?.publicId ?? null,
  lines: r.lines.map((l) => ({
    description: l.description,
    accountCode: l.account?.code ?? null,
    netAmount: m(l.netAmount),
    vatAmount: m(l.vatAmount),
    whtCategory: l.whtCategory,
  })),
});

export const payableDto = (r: PayableRow): PayableDto => ({
  id: r.publicId,
  vendorId: r.vendor.publicId,
  vendorName: r.vendor.legalName,
  source: r.source,
  poNumber: r.purchaseOrder?.poNumber ?? null,
  orderCode: r.order?.orderCode ?? null,
  openNetAmount: m(r.openNetAmount),
  openVatAmount: m(r.openVatAmount),
  retentionPct: r.retentionPct.toFixed(4),
  eligibleAt: r.eligibleAt ? toBangkokIso(r.eligibleAt) : null,
  status: r.status,
  currency: 'THB',
});

export const vendorDto = (v: Vendor): VendorDto => ({
  id: v.publicId,
  kind: v.kind,
  legalName: v.legalName,
  juristicType: v.juristicType,
  taxId: v.taxId,
  branchCode: v.branchCode,
  isVatRegistered: v.isVatRegistered,
  defaultWhtCategory: v.defaultWhtCategory,
  paymentTermsDays: v.paymentTermsDays,
});
