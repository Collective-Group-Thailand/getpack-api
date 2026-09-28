import { toBangkokIso } from '@common/time/bangkok';
import { type CompanyStatement } from '@generated/prisma/client';
import { dayOf } from '@modules/ledger/ledger-dates';

import { type CreditNoteRequestRow } from './credit-notes.service';
import { type BuyerSnapshot, type DocumentRow, type SellerSnapshot } from './customer-documents.service';
import {
  type AgingReportDto,
  type CompanyStatementDto,
  type CreditNoteRequestDto,
  type CustomerDocumentDto,
  type ReceivableItemDto,
  type StoreCreditDto,
  type WhtCertificateDto,
} from './receivables.dto';
import { type AGING_BUCKETS, type ItemRow, type ReceivablesService } from './receivables.service';
import { type StoreCreditService } from './store-credit.service';
import { type CertRow } from './wht-certificates.service';

export function documentDto(d: DocumentRow): CustomerDocumentDto {
  const buyer = d.buyerSnapshot as unknown as BuyerSnapshot;
  const seller = d.sellerSnapshot as unknown as SellerSnapshot;
  return {
    id: d.publicId,
    docType: d.docType,
    docKind: d.docKind,
    docNumber: d.docNumber,
    status: d.status,
    documentDate: dayOf(d.documentDate),
    dueDate: d.dueDate ? dayOf(d.dueDate) : null,
    isTaxInvoice: d.isTaxInvoice,
    isFullForm: d.isFullForm,
    buyer: { name: buyer.name, taxId: d.isFullForm ? buyer.taxId : null, branchCode: d.isFullForm ? buyer.branchCode : null, address: buyer.address },
    seller: { name: seller.legalNameTh ?? seller.legalNameEn ?? '', taxId: seller.taxId, branchCode: seller.branchCode, address: seller.addressTh },
    orderGroupId: d.orderGroup?.publicId ?? null,
    groupCode: d.orderGroup?.groupCode ?? null,
    orderId: d.order?.publicId ?? null,
    orderCode: d.order?.orderCode ?? null,
    paymentId: d.payment?.publicId ?? null,
    originalDocument: d.originalDocument ? { id: d.originalDocument.publicId, docNumber: d.originalDocument.docNumber } : null,
    reason: d.creditNoteReason?.nameTh ?? null,
    cnKind: d.cnKind,
    receiptVia: d.receiptVia,
    taxNature: d.taxNature,
    netAmount: d.netAmount.toFixed(2),
    discountAmount: d.discountAmount.toFixed(2),
    vatRatePct: d.vatRatePct.toFixed(4),
    vatAmount: d.vatAmount.toFixed(2),
    grossAmount: d.grossAmount.toFixed(2),
    whtAmount: d.whtAmount.toFixed(2),
    cashAmount: d.cashAmount.toFixed(2),
    deductedPriorAmount: d.deductedPriorAmount.toFixed(2),
    amountDue: d.amountDue.toFixed(2),
    currency: 'THB',
    lines: d.lines.map((l) => ({
      lineNo: l.lineNo,
      description: l.description,
      quantity: l.quantity.toFixed(3),
      netAmount: l.netAmount.toFixed(2),
      discountAmount: l.discountAmount.toFixed(2),
      vatAmount: l.vatAmount.toFixed(2),
      grossAmount: l.grossAmount.toFixed(2),
      whtAmount: l.whtAmount.toFixed(2),
    })),
    receivable: d.receivableItem
      ? { id: d.receivableItem.publicId, openAmount: d.receivableItem.openAmount.toFixed(2), status: d.receivableItem.status }
      : null,
    pdfReady: d.pdfFileId !== null,
    voidReason: d.voidReason,
    issuedAt: toBangkokIso(d.issuedAt),
  };
}

export const requestDto = (r: CreditNoteRequestRow): CreditNoteRequestDto => ({
  id: r.publicId,
  orderId: r.order.publicId,
  orderCode: r.order.orderCode,
  cnKind: r.cnKind,
  reasonCode: r.reason.code,
  amount: r.amount.toFixed(2),
  settleTo: r.settleTo,
  note: r.note,
  status: r.status,
  approvalRequestId: r.approvalRequest?.publicId ?? null,
  creditNote: r.customerDocument ? { id: r.customerDocument.publicId, docNumber: r.customerDocument.docNumber } : null,
  claimNo: r.claim?.claimNo ?? null,
  createdAt: toBangkokIso(r.createdAt),
});

export const itemDto = (i: ItemRow): ReceivableItemDto => ({
  id: i.publicId,
  document: { id: i.customerDocument.publicId, docNumber: i.customerDocument.docNumber },
  customerId: i.customer.publicId,
  customerName: i.customer.displayName,
  companyId: i.company?.publicId ?? null,
  companyName: i.company?.legalName ?? null,
  orderCode: i.order?.orderCode ?? null,
  dueDate: dayOf(i.dueDate),
  amount: i.amount.toFixed(2),
  openAmount: i.openAmount.toFixed(2),
  currency: 'THB',
  status: i.status,
  writeOffApprovalId: i.writeOffApproval?.publicId ?? null,
});

export function agingDto(report: Awaited<ReturnType<ReceivablesService['aging']>>): AgingReportDto {
  const buckets = (b: Record<(typeof AGING_BUCKETS)[number], { toFixed(n: number): string }>) => ({
    current: b.current.toFixed(2),
    d1_30: b.d1_30.toFixed(2),
    d31_60: b.d31_60.toFixed(2),
    d61_90: b.d61_90.toFixed(2),
    over_90: b.over_90.toFixed(2),
  });
  return {
    asOf: report.asOf,
    parties: report.parties.map((p) => ({
      customerId: p.customer.publicId,
      customerName: p.customer.displayName,
      companyId: p.company?.publicId ?? null,
      companyName: p.company?.legalName ?? null,
      buckets: buckets(p.buckets),
    })),
    totals: buckets(report.totals),
    currency: 'THB',
  };
}

export const certDto = (c: CertRow): WhtCertificateDto => ({
  id: c.publicId,
  receipt: { id: c.customerDocument.publicId, docNumber: c.customerDocument.docNumber },
  customerId: c.customer.publicId,
  customerName: c.customer.displayName,
  companyName: c.company?.legalName ?? null,
  whtBase: c.whtBase.toFixed(2),
  whtAmount: c.whtAmount.toFixed(2),
  status: c.status,
  certificateNo: c.certificateNo,
  certificateDate: c.certificateDate ? dayOf(c.certificateDate) : null,
  fileId: c.file?.publicId ?? null,
  createdAt: toBangkokIso(c.createdAt),
});

export async function storeCreditDto(service: StoreCreditService, userId: bigint): Promise<StoreCreditDto> {
  const [balance, entries] = await Promise.all([service.balance(userId), service.entries(userId)]);
  return {
    balance: balance.toFixed(2),
    currency: 'THB',
    entries: entries.map((e) => ({
      id: e.publicId,
      amount: e.amount.toFixed(2),
      source: e.source,
      docNumber: e.customerDocument?.docNumber ?? null,
      orderCode: e.order?.orderCode ?? null,
      createdAt: toBangkokIso(e.createdAt),
    })),
  };
}

export const statementDto = (s: CompanyStatement): CompanyStatementDto => ({
  id: s.publicId,
  month: dayOf(s.periodMonth).slice(0, 7),
  opening: s.opening.toFixed(2),
  invoiced: s.invoiced.toFixed(2),
  paid: s.paid.toFixed(2),
  credited: s.credited.toFixed(2),
  closing: s.closing.toFixed(2),
  currency: 'THB',
  pdfReady: s.fileObjectId !== null,
});
