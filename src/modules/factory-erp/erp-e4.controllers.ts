import { CurrentActor, Public } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { ReasonDto } from '@common/dto/reason.dto';
import { type ErrorCode } from '@common/errors/error-codes';
import { etagOf } from '@common/etag/etag';
import { IfMatch, UseEtag } from '@common/etag/etag.interceptor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiConcurrency, ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { permissionsOf } from '@modules/iam/actor-permissions';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { type PermissionKey } from '@modules/iam/permissions.catalog';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  type Type,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ERP_IDS } from './erp.dto';
import { ErpCrmService } from './erp-crm.service';
import {
  E4_IDS,
  ErpActivityDto,
  ErpActivityListQuery,
  ErpArAgingDto,
  ErpBillingNoteDto,
  ErpBillingNoteListQuery,
  ErpCompleteActivityDto,
  ErpConfirmSalesOrderDto,
  ErpConvertLeadDto,
  ErpConvertLeadResultDto,
  ErpCreateBillingNoteDto,
  ErpCreateDeliveryNoteDto,
  ErpCreateReceiptDto,
  ErpCreateSalesInvoiceDto,
  ErpCreateSalesNoteDto,
  ErpCreateWhtCertificateDto,
  ErpCustomerReceiptDto,
  ErpDeliveredDto,
  ErpDeliveryNoteDto,
  ErpDeliveryNoteListQuery,
  ErpDeliveryNoteSummaryDto,
  ErpIssueSalesInvoiceDto,
  ErpLeadDto,
  ErpLeadListQuery,
  ErpLoseDto,
  ErpMonthQuery,
  ErpOpportunityDto,
  ErpOpportunityListQuery,
  ErpPdfLinkDto,
  ErpPipelineDto,
  ErpQuotationDto,
  ErpQuotationLinkDto,
  ErpQuotationListQuery,
  ErpQuotationSummaryDto,
  ErpReceiptListQuery,
  ErpRecordAcceptanceDto,
  ErpSalesInvoiceDto,
  ErpSalesInvoiceListQuery,
  ErpSalesInvoiceSummaryDto,
  ErpSalesNoteDto,
  ErpSalesNoteListQuery,
  ErpSalesOrderDto,
  ErpSalesOrderListQuery,
  ErpSalesOrderSummaryDto,
  ErpSalespersonOptionDto,
  ErpSalesReportDto,
  ErpSaveActivityDto,
  ErpSaveLeadDto,
  ErpSaveOpportunityDto,
  ErpSaveQuotationDto,
  ErpSaveSalesOrderDto,
  ErpSaveSalesTargetDto,
  ErpTaxExportDto,
  ErpTaxExportResultDto,
  ErpUpdateSalesInvoiceDto,
  ErpVat30Dto,
  ErpVatReportDto,
  ErpVoidDto,
  ErpWhtCertificateDto,
  ErpWhtCertificateListQuery,
  ErpWhtReportDto,
  ErpWhtReportQuery,
  ErpWhtSuggestionDto,
  PublicAcceptQuotationDto,
  PublicDeclineQuotationDto,
  PublicQuotationDto,
} from './erp-e4.dto';
import { type ErpPdfKind, ErpPdfService } from './erp-pdf.service';
import { ErpQuotationsService } from './erp-quotations.service';
import { ErpReceivablesService } from './erp-receivables.service';
import { ErpSalesOrdersService } from './erp-sales-orders.service';
import { ErpTaxService } from './erp-tax.service';
import { ErpWorkspace } from './erp-workspace.service';

/**
 * Packio Factory ERP E4 (docs/prompts/E1-factory-erp.md §11, D-359 – D-371): CRM, quotations, sales orders,
 * delivery notes, the factory's own invoices / tax invoices, credit and debit notes, receipts, billing notes,
 * receivables, 50 ทวิ certificates and tax reports — under `/v1/partner/factories/{factoryId}/erp/*`,
 * factory-private (D-317); and the customer's quotation link under `/v1/store/quote-links/{token}`.
 */

const factoryParam = ApiParam({ name: 'factoryId', format: 'uuid' });
const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;
const byVersion = (b: { id: string; version: number }) => etagOf(b.id, b.version);
const ACTION = (key: string, irreversible = false) => ({ key, irreversible, disabledReason: null });
const perms = (resolver: PermissionResolver, actor: Actor) => permissionsOf(resolver, actor);

/** One endpoint's documentation and guards in one place. */
function Op(o: {
  id: string;
  summary: string;
  description: string;
  implements: string[];
  can?: PermissionKey;
  params?: string[];
  success?: { status: 200 | 201 | 204; description: string; type?: Type<unknown> | [Type<unknown>]; example?: unknown };
  paginated?: { type: Type<unknown>; example: unknown };
  body?: { type: Type<unknown>; example: unknown };
  errors?: readonly ErrorCode[];
  idempotent?: boolean;
  etag?: boolean;
  concurrency?: boolean;
  status?: 200 | 204;
}) {
  return applyDecorators(
    ...(o.status ? [HttpCode(o.status)] : []),
    ...(o.idempotent ? [Idempotent()] : []),
    ...(o.can ? [Can(o.can)] : []),
    factoryParam,
    ...(o.params ?? []).map((name) => ApiParam({ name, format: 'uuid' })),
    ...(o.concurrency ? [ApiConcurrency()] : []),
    ...(o.etag ? [UseEtag(byVersion)] : []),
    ApiEndpoint({ id: o.id, summary: o.summary, description: o.description, implements: o.implements }),
    ...(o.body ? [ApiBody({ type: o.body.type, examples: { default: { value: o.body.example } } })] : []),
    ...(o.paginated
      ? [
          ApiPaginated(o.paginated.type, {
            example: Array.isArray(o.paginated.example) ? (o.paginated.example as unknown[])[0] : o.paginated.example,
          }),
        ]
      : []),
    ...(o.success ? [ApiSuccess(o.success.status, o.success)] : []),
    ApiStandardErrors(...((o.errors ?? ['http.not_found']) as ErrorCode[])),
  );
}

// ------------------------------------------------------------------------------------- examples

const CUSTOMER = { id: E4_IDS.customer, code: 'C0007', name: 'ร้านขนมบ้านสวน' };
const SALESPERSON = { id: E4_IDS.salesperson, name: 'ฝ่ายขาย ทดสอบ' };
const ITEM = { id: E4_IDS.productItem, sku: 'BOX-RSC-302015', name: 'กล่องลูกฟูก RSC 30×20×15', kind: 'finished_good', baseUnit: 'pcs' };
const LINE_DTO = {
  id: E4_IDS.quotationLine,
  lineNo: 1,
  item: ITEM,
  description: 'กล่องลูกฟูก RSC 30×20×15 ซม. พิมพ์ 2 สี',
  quantity: '5000.000',
  unit: 'pcs',
  unitPrice: '12.500000',
  discountPct: '0.0000',
  amount: '62500.00',
};
const PARTY = {
  name: 'ร้านขนมบ้านสวน',
  address: '12 ซ.งามวงศ์วาน 23 ต.บางกระสอ อ.เมืองนนทบุรี จ.นนทบุรี 11000',
  taxId: '0000556123469',
  branchCode: '00000',
  phone: '080-000-1234',
};
const SELLER = {
  name: 'บริษัท กล่องดี แพคเกจจิ้ง จำกัด',
  address: '99/9 หมู่ 5 ต.บางพลีใหญ่ อ.บางพลี จ.สมุทรปราการ 10540',
  taxId: '0000556123451',
  branchCode: '00000',
  phone: null,
};

const LEAD: ErpLeadDto = {
  id: E4_IDS.lead,
  name: 'ร้านขนมบ้านสวน',
  contactName: 'คุณสมศรี',
  phone: '080-000-1234',
  email: null,
  lineId: '@bansuan',
  address: 'นนทบุรี',
  source: 'line',
  stage: 'qualified',
  expectedValue: '45000.00',
  salesperson: SALESPERSON,
  customer: null,
  lostReason: null,
  note: 'สนใจกล่องเค้ก 2 ขนาด',
  openActivities: 1,
  convertedAt: null,
  createdAt: '2026-10-12T09:00:00+07:00',
  nextActions: [ACTION('erp_lead.edit'), ACTION('erp_lead.convert'), ACTION('erp_lead.lose')],
  version: 2,
};
const OPPORTUNITY: ErpOpportunityDto = {
  id: E4_IDS.opportunity,
  title: 'กล่องเค้ก 2 ขนาด — ล็อตแรก',
  stage: 'proposal',
  value: '62500.00',
  probabilityPct: 40,
  weightedValue: '25000.00',
  expectedCloseOn: '2026-11-15',
  customer: CUSTOMER,
  lead: { id: E4_IDS.lead, code: '0192f3a0', name: 'ร้านขนมบ้านสวน' },
  salesperson: SALESPERSON,
  lostReason: null,
  note: null,
  quotations: 1,
  wonAt: null,
  closedAt: null,
  createdAt: '2026-10-12T09:30:00+07:00',
  nextActions: [ACTION('erp_opportunity.edit'), ACTION('erp_opportunity.quote'), ACTION('erp_opportunity.win'), ACTION('erp_opportunity.lose')],
  version: 1,
};
const ACTIVITY: ErpActivityDto = {
  id: E4_IDS.activity,
  kind: 'call',
  subject: 'โทรตามใบเสนอราคา',
  detail: null,
  about: { type: 'opportunity', id: E4_IDS.opportunity, name: 'กล่องเค้ก 2 ขนาด — ล็อตแรก' },
  assignee: SALESPERSON,
  dueAt: '2026-10-14T10:00:00+07:00',
  doneAt: null,
  outcome: null,
  overdue: false,
  createdBy: 'ฝ่ายขาย ทดสอบ',
  createdAt: '2026-10-12T09:35:00+07:00',
  version: 1,
};
const PIPELINE: ErpPipelineDto = {
  stages: [
    { stage: 'prospecting', count: 3, value: '120000.00', weighted: '12000.00' },
    { stage: 'proposal', count: 2, value: '90000.00', weighted: '36000.00' },
    { stage: 'negotiation', count: 1, value: '40000.00', weighted: '28000.00' },
    { stage: 'won', count: 1, value: '62500.00', weighted: '62500.00' },
    { stage: 'lost', count: 0, value: '0.00', weighted: '0.00' },
  ],
  openValue: '250000.00',
  openWeighted: '76000.00',
  closingSoon: 2,
  salespeople: [{ salesperson: SALESPERSON, open: 6, value: '250000.00', weighted: '76000.00' }],
  myDue: 3,
};
const QUOTE_SUMMARY: ErpQuotationSummaryDto = {
  id: E4_IDS.quotation,
  quoteNo: 'QT-2610-0003',
  revision: 1,
  status: 'sent',
  customer: CUSTOMER,
  salesperson: SALESPERSON,
  quoteDate: '2026-10-12',
  validUntil: '2026-11-11',
  total: '66875.00',
  createdAt: '2026-10-12T09:40:00+07:00',
};
const QUOTE: ErpQuotationDto = {
  ...QUOTE_SUMMARY,
  opportunity: { id: E4_IDS.opportunity, code: 'กล่องเค้ก 2 ขนาด — ล็อตแรก', name: 'กล่องเค้ก 2 ขนาด — ล็อตแรก' },
  paymentTermDays: 30,
  leadTimeDays: 14,
  terms: 'ราคานี้รวมค่าขนส่งในกรุงเทพฯ และปริมณฑล',
  note: null,
  vatMode: 'exclusive',
  vatRatePct: '7.0000',
  subtotal: '62500.00',
  vatAmount: '4375.00',
  lines: [LINE_DTO],
  sentAt: '2026-10-12T10:00:00+07:00',
  linkActive: true,
  acceptedAt: null,
  acceptedName: null,
  acceptedPosition: null,
  acceptedVia: null,
  customerPoNo: null,
  rejectedAt: null,
  rejectReason: null,
  cancelReason: null,
  salesOrder: null,
  revisions: [{ id: E4_IDS.quotation, revision: 1, status: 'sent', total: '66875.00' }],
  nextActions: [ACTION('erp_quote.send'), ACTION('erp_quote.revise'), ACTION('erp_quote.accept'), ACTION('erp_quote.reject'), ACTION('erp_quote.cancel', true), ACTION('erp_quote.pdf')],
  version: 2,
};
const SAVE_QUOTE = {
  customerId: E4_IDS.customer,
  opportunityId: E4_IDS.opportunity,
  validUntil: '2026-11-11',
  paymentTermDays: 30,
  leadTimeDays: 14,
  terms: 'ราคานี้รวมค่าขนส่งในกรุงเทพฯ และปริมณฑล',
  lines: [{ itemId: E4_IDS.productItem, quantity: '5000', unitPrice: '12.5' }],
};
const PUBLIC_QUOTE: PublicQuotationDto = {
  seller: SELLER,
  sellerLogoUrl: null,
  buyer: PARTY,
  quoteNo: 'QT-2610-0003',
  revision: 1,
  status: 'sent',
  quoteDate: '2026-10-12',
  validUntil: '2026-11-11',
  paymentTermDays: 30,
  leadTimeDays: 14,
  terms: 'ราคานี้รวมค่าขนส่งในกรุงเทพฯ และปริมณฑล',
  vatMode: 'exclusive',
  vatRatePct: '7.0000',
  lines: [LINE_DTO],
  subtotal: '62500.00',
  vatAmount: '4375.00',
  total: '66875.00',
  totalInWords: 'หกหมื่นหกพันแปดร้อยเจ็ดสิบห้าบาทถ้วน',
  acceptedAt: null,
  acceptedName: null,
  sellerContact: 'โทร 02-123-4567',
};
const SO_SUMMARY: ErpSalesOrderSummaryDto = {
  id: E4_IDS.salesOrder,
  soNo: 'SO-2610-0004',
  status: 'confirmed',
  customer: CUSTOMER,
  customerPoNo: 'PO-6610-015',
  orderDate: '2026-10-13',
  deliveryDate: '2026-10-28',
  total: '66875.00',
  deliveredPct: '0.0',
  late: false,
  salesperson: SALESPERSON,
};
const SO: ErpSalesOrderDto = {
  ...SO_SUMMARY,
  quotation: { id: E4_IDS.quotation, code: 'QT-2610-0003', name: 'QT-2610-0003' },
  opportunity: null,
  warehouse: { id: ERP_IDS.warehouse, code: 'MAIN', name: 'คลังหลัก' },
  paymentTermDays: 30,
  shipToAddress: '12 ซ.งามวงศ์วาน 23 นนทบุรี',
  note: null,
  vatMode: 'exclusive',
  vatRatePct: '7.0000',
  subtotal: '62500.00',
  vatAmount: '4375.00',
  lines: [
    {
      ...LINE_DTO,
      id: E4_IDS.salesOrderLine,
      fulfilment: 'make',
      reservedQty: '0.000',
      deliveredQty: '0.000',
      invoicedQty: '0.000',
      productionOrder: { id: ERP_IDS.item, code: 'MO-2610-0006', name: 'planned' },
    },
  ],
  deliveryNotes: [],
  invoices: [],
  credit: { limit: '100000.00', receivables: '0.00', openOrders: '66875.00', over: false },
  confirmedAt: '2026-10-13T11:00:00+07:00',
  creditOverrideReason: null,
  closeReason: null,
  cancelReason: null,
  nextActions: [ACTION('erp_so.deliver'), ACTION('erp_so.invoice'), ACTION('erp_so.cancel', true), ACTION('erp_so.pdf')],
  version: 2,
};
const SAVE_SO = {
  customerId: E4_IDS.customer,
  customerPoNo: 'PO-6610-015',
  deliveryDate: '2026-10-28',
  lines: [{ itemId: E4_IDS.productItem, quantity: '5000', unitPrice: '12.5', fulfilment: 'make' }],
};
const DO_SUMMARY: ErpDeliveryNoteSummaryDto = {
  id: E4_IDS.deliveryNote,
  doNo: 'DO-2610-0002',
  status: 'delivered',
  deliverOn: '2026-10-20',
  customer: CUSTOMER,
  salesOrder: { id: E4_IDS.salesOrder, code: 'SO-2610-0004', name: 'SO-2610-0004' },
  invoiced: false,
};
const DO: ErpDeliveryNoteDto = {
  ...DO_SUMMARY,
  warehouse: { id: ERP_IDS.warehouse, code: 'MAIN', name: 'คลังหลัก' },
  shipToAddress: '12 ซ.งามวงศ์วาน 23 นนทบุรี',
  vehicle: 'กระบะ 2กข-1234 / คุณสมชาย',
  note: null,
  lines: [
    {
      id: E4_IDS.deliveryNoteLine,
      lineNo: 1,
      salesOrderLineId: E4_IDS.salesOrderLine,
      item: ITEM,
      description: 'กล่องลูกฟูก RSC 30×20×15 ซม. พิมพ์ 2 สี',
      quantity: '2000.000',
      unit: 'pcs',
      unitCost: '6.420000',
      costAmount: '12840.00',
      invoicedQty: '0.000',
    },
  ],
  issuedAt: '2026-10-20T08:30:00+07:00',
  deliveredAt: '2026-10-20T14:10:00+07:00',
  receivedBy: 'คุณสมศรี',
  podFileId: null,
  cancelReason: null,
  costTotal: '12840.00',
  nextActions: [ACTION('erp_do.invoice'), ACTION('erp_do.cancel', true), ACTION('erp_do.pdf')],
  version: 3,
};
const IV_SUMMARY: ErpSalesInvoiceSummaryDto = {
  id: E4_IDS.invoice,
  invoiceNo: 'IV-2610-0005',
  form: 'invoice',
  isTaxInvoice: true,
  status: 'issued',
  customer: CUSTOMER,
  issueDate: '2026-10-20',
  dueDate: '2026-11-19',
  total: '26750.00',
  openAmount: '26750.00',
  overdue: false,
  salesperson: SALESPERSON,
};
const IV: ErpSalesInvoiceDto = {
  ...IV_SUMMARY,
  salesOrder: { id: E4_IDS.salesOrder, code: 'SO-2610-0004', name: 'SO-2610-0004' },
  paymentTermDays: 30,
  customerPoNo: 'PO-6610-015',
  note: null,
  vatMode: 'exclusive',
  vatRatePct: '7.0000',
  subtotal: '25000.00',
  vatAmount: '1750.00',
  creditedAmount: '0.00',
  debitedAmount: '0.00',
  receivedAmount: '0.00',
  lines: [{ ...LINE_DTO, id: E4_IDS.invoiceLine, quantity: '2000.000', amount: '25000.00' }],
  deliveryNotes: [{ id: E4_IDS.deliveryNote, doNo: 'DO-2610-0002', status: 'delivered', deliverOn: '2026-10-20' }],
  notes: [],
  receipts: [],
  seller: SELLER,
  buyer: PARTY,
  totalInWords: 'สองหมื่นหกพันเจ็ดร้อยห้าสิบบาทถ้วน',
  issuedAt: '2026-10-20T15:00:00+07:00',
  voidedAt: null,
  voidReason: null,
  nextActions: [ACTION('erp_iv.receive'), ACTION('erp_iv.credit'), ACTION('erp_iv.debit'), ACTION('erp_iv.void', true), ACTION('erp_iv.pdf')],
  version: 2,
};
const NOTE: ErpSalesNoteDto = {
  id: E4_IDS.creditNote,
  kind: 'credit',
  noteNo: 'CN-2610-0001',
  status: 'issued',
  total: '1070.00',
  invoice: { id: E4_IDS.invoice, invoiceNo: 'IV-2610-0005', status: 'issued', total: '26750.00' },
  customer: CUSTOMER,
  issueDate: '2026-10-25',
  reason: 'defective',
  reasonText: 'พิมพ์สีเพี้ยน 80 ใบ',
  originalValue: '25000.00',
  correctValue: '24000.00',
  difference: '1000.00',
  vatRatePct: '7.0000',
  vatAmount: '70.00',
  isTaxDocument: true,
  warehouse: { id: ERP_IDS.warehouse, code: 'MAIN', name: 'คลังหลัก' },
  lines: [{ lineNo: 1, description: 'รับคืนกล่องพิมพ์สีเพี้ยน 80 ใบ', amount: '1000.00', item: ITEM, returnQty: '80.000' }],
  seller: SELLER,
  buyer: PARTY,
  issuedAt: '2026-10-25T10:00:00+07:00',
  voidReason: null,
  nextActions: [ACTION('erp_note.void', true), ACTION('erp_note.pdf')],
  version: 2,
};
const RECEIPT: ErpCustomerReceiptDto = {
  id: E4_IDS.receipt,
  receiptNo: 'RC-2611-0001',
  kind: 'receipt',
  status: 'issued',
  customer: CUSTOMER,
  receivedOn: '2026-11-10',
  method: 'transfer',
  amount: '24840.00',
  whtAmount: '840.00',
  reference: 'KBank 10/11 15:22',
  chequeNo: null,
  chequeBank: null,
  chequeDate: null,
  whtCertNo: '0001/2569',
  whtCertDate: '2026-11-10',
  whtFileId: null,
  note: null,
  allocations: [{ invoice: { id: E4_IDS.invoice, invoiceNo: 'IV-2610-0005', status: 'paid', total: '26750.00' }, amount: '25680.00' }],
  amountInWords: 'สองหมื่นสี่พันแปดร้อยสี่สิบบาทถ้วน',
  cancelReason: null,
  createdBy: 'บัญชี ทดสอบ',
  createdAt: '2026-11-10T15:30:00+07:00',
  nextActions: [ACTION('erp_rc.cancel', true), ACTION('erp_rc.pdf')],
};
const BILLING: ErpBillingNoteDto = {
  id: E4_IDS.billingNote,
  billingNo: 'BN-2610-0001',
  status: 'issued',
  customer: CUSTOMER,
  billingDate: '2026-10-25',
  collectOn: '2026-11-05',
  total: '25680.00',
  note: null,
  lines: [
    {
      invoice: { id: E4_IDS.invoice, invoiceNo: 'IV-2610-0005', status: 'issued', total: '26750.00' },
      issueDate: '2026-10-20',
      dueDate: '2026-11-19',
      amount: '25680.00',
    },
  ],
  cancelReason: null,
  nextActions: [ACTION('erp_bn.cancel', true), ACTION('erp_bn.pdf')],
};
const AGING: ErpArAgingDto = {
  asOf: '2026-10-25',
  currency: 'THB',
  dueSoon: '0.00',
  refundsDue: '0.00',
  totals: { current: '25680.00', d1_30: '0.00', d31_60: '0.00', d61_90: '0.00', over90: '0.00', total: '25680.00' },
  customers: [
    {
      customer: CUSTOMER,
      invoices: 1,
      buckets: { current: '25680.00', d1_30: '0.00', d31_60: '0.00', d61_90: '0.00', over90: '0.00', total: '25680.00' },
      creditLimit: '100000.00',
    },
  ],
};
const WHT_LINE = { lineNo: 1, incomeType: 'hire_of_work', description: 'ค่าจ้างพิมพ์', ratePct: '3.0000', baseAmount: '20000.00', whtAmount: '600.00' };
const CERT: ErpWhtCertificateDto = {
  id: E4_IDS.certificate,
  certNo: 'WHT-2610-0001',
  status: 'issued',
  form: 'pnd53',
  payment: { id: E4_IDS.payment, code: 'PV-2610-0004', name: 'PV-2610-0004' },
  supplier: { id: ERP_IDS.supplier, code: 'S0001', name: 'บจก. กระดาษไทย (ทดสอบ)' },
  paidOn: '2026-10-31',
  baseAmount: '20000.00',
  whtAmount: '600.00',
  payer: SELLER,
  payee: { name: 'บจก. กระดาษไทย (ทดสอบ)', address: 'กรุงเทพฯ', taxId: '0000555123457', branchCode: '00000', phone: null },
  lines: [WHT_LINE],
  voidReason: null,
  createdAt: '2026-10-31T16:00:00+07:00',
  nextActions: [ACTION('erp_wht.void', true), ACTION('erp_wht.pdf')],
};
const PDF_LINK: ErpPdfLinkDto = {
  url: 'https://files.packio.example/erp/IV-2610-0005.pdf?sig=example',
  fileName: 'IV-2610-0005.pdf',
  expiresAt: '2026-10-20T15:05:00+07:00',
};
const VAT_REPORT: ErpVatReportDto = {
  month: '2026-10',
  kind: 'sales',
  rows: [
    {
      date: '2026-10-20',
      docNo: 'IV-2610-0005',
      kind: 'tax_invoice',
      partyName: 'ร้านขนมบ้านสวน',
      partyTaxId: '0000556123469',
      partyBranch: '00000',
      net: '25000.00',
      vat: '1750.00',
      voided: false,
      sourceId: E4_IDS.invoice,
    },
  ],
  net: '25000.00',
  vat: '1750.00',
};
const SALES_REPORT: ErpSalesReportDto = {
  month: '2026-10',
  rows: [
    {
      salesperson: SALESPERSON,
      month: '2026-10',
      targetNet: '300000.00',
      invoicedNet: '245000.00',
      collected: '180000.00',
      achievementPct: '81.7',
      commissionPct: '2.0000',
      commission: '4900.00',
      invoices: 12,
      targetId: E4_IDS.target,
    },
  ],
  invoicedNet: '245000.00',
  targetNet: '300000.00',
  commission: '4900.00',
  grossProfit: '58000.00',
};

// ========================================================================================= CRM

@ApiSurface('partner', 'erpCrm')
@Controller('factories/:factoryId/erp')
export class PartnerErpCrmController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly crm: ErpCrmService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get('salespeople')
  @Op({
    id: 'partner.erpCrm.salespeople',
    summary: 'People who can own customers and deals',
    description: 'The users holding a role at this factory, for salesperson and assignee pickers (D-359).',
    implements: ['D-359'],
    can: 'factory_sales.read',
    success: { status: 200, description: 'People', type: [ErpSalespersonOptionDto], example: [{ ...SALESPERSON, roles: ['factory_sales'] }] },
  })
  async salespeople(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.crm.salespeople(await this.workspace.open(actor, factoryId));
  }

  @Get('leads')
  @Op({
    id: 'partner.erpCrm.listLeads',
    summary: 'Leads',
    description: 'Newest activity first; `stage=open` = new, contacted or qualified (D-359).',
    implements: ['D-359'],
    can: 'factory_sales.read',
    paginated: { type: ErpLeadDto, example: [LEAD] },
    errors: ['http.not_found', 'validation.failed'],
  })
  async listLeads(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpLeadListQuery) {
    return this.crm.listLeads(await this.workspace.open(actor, factoryId), q, await perms(this.permissions, actor));
  }

  @Post('leads')
  @Op({
    id: 'partner.erpCrm.createLead',
    summary: 'Add a lead',
    description: 'A prospect with its source and salesperson (default: the caller), D-359.',
    implements: ['D-359'],
    can: 'factory_sales.manage',
    etag: true,
    body: { type: ErpSaveLeadDto, example: { name: 'ร้านขนมบ้านสวน', contactName: 'คุณสมศรี', phone: '080-000-1234', source: 'line' } },
    success: { status: 201, description: 'Added', type: ErpLeadDto, example: LEAD },
    errors: WRITE,
  })
  async createLead(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpSaveLeadDto) {
    return this.crm.createLead(await this.workspace.open(actor, factoryId), body, await perms(this.permissions, actor));
  }

  @Get('leads/:leadId')
  @Op({
    id: 'partner.erpCrm.getLead',
    summary: 'One lead',
    description: 'With its ETag for `PUT` (D-359).',
    implements: ['D-359'],
    can: 'factory_sales.read',
    params: ['leadId'],
    etag: true,
    success: { status: 200, description: 'The lead', type: ErpLeadDto, example: LEAD },
  })
  async getLead(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('leadId', ParseUUIDPipe) leadId: string) {
    return this.crm.getLead(await this.workspace.open(actor, factoryId), leadId, await perms(this.permissions, actor));
  }

  @Put('leads/:leadId')
  @Op({
    id: 'partner.erpCrm.updateLead',
    summary: 'Edit a lead',
    description: 'Open leads only (D-359).',
    implements: ['D-359'],
    can: 'factory_sales.manage',
    params: ['leadId'],
    concurrency: true,
    etag: true,
    body: { type: ErpSaveLeadDto, example: { name: 'ร้านขนมบ้านสวน', stage: 'qualified', expectedValue: '45000' } },
    success: { status: 200, description: 'Saved', type: ErpLeadDto, example: LEAD },
    errors: [...WRITE, 'erp.invalid_status'],
  })
  async updateLead(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ErpSaveLeadDto,
  ) {
    return this.crm.updateLead(await this.workspace.open(actor, factoryId), leadId, ifMatch, body, await perms(this.permissions, actor));
  }

  @Post('leads/:leadId/actions/convert')
  @Op({
    id: 'partner.erpCrm.convertLead',
    summary: 'Make a lead a customer',
    description:
      'Creates a trading partner of kind customer (or links an existing one, made a customer too), optionally with an ' +
      'opportunity; the lead is converted (D-359).',
    implements: ['D-359'],
    can: 'factory_sales.manage',
    params: ['leadId'],
    idempotent: true,
    status: 200,
    body: { type: ErpConvertLeadDto, example: { taxId: '0000556123469', paymentTermDays: 30, openOpportunity: true } },
    success: {
      status: 200,
      description: 'Converted',
      type: ErpConvertLeadResultDto,
      example: { lead: { ...LEAD, stage: 'converted', customer: CUSTOMER, nextActions: [] }, customer: CUSTOMER, opportunityId: E4_IDS.opportunity },
    },
    errors: [...WRITE, 'erp.invalid_status', 'erp.code_taken', 'erp.archived'],
  })
  async convertLead(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() body: ErpConvertLeadDto,
  ) {
    return this.crm.convertLead(await this.workspace.open(actor, factoryId), leadId, body, await perms(this.permissions, actor));
  }

  @Post('leads/:leadId/actions/lose')
  @Op({
    id: 'partner.erpCrm.loseLead',
    summary: 'Mark a lead lost',
    description: 'With the reason (D-359).',
    implements: ['D-359'],
    can: 'factory_sales.manage',
    params: ['leadId'],
    idempotent: true,
    status: 200,
    body: { type: ErpLoseDto, example: { reason: 'ลูกค้าเลือกเจ้าอื่นที่ถูกกว่า' } },
    success: { status: 200, description: 'Lost', type: ErpLeadDto, example: { ...LEAD, stage: 'lost', lostReason: 'ลูกค้าเลือกเจ้าอื่นที่ถูกกว่า', nextActions: [] } },
    errors: [...WRITE, 'erp.invalid_status'],
  })
  async loseLead(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() body: ErpLoseDto,
  ) {
    return this.crm.loseLead(await this.workspace.open(actor, factoryId), leadId, body.reason, await perms(this.permissions, actor));
  }

  @Get('opportunities')
  @Op({
    id: 'partner.erpCrm.listOpportunities',
    summary: 'Opportunities',
    description: 'By expected close date; `stage=open` = prospecting, proposal or negotiation (D-359).',
    implements: ['D-359'],
    can: 'factory_sales.read',
    paginated: { type: ErpOpportunityDto, example: [OPPORTUNITY] },
    errors: ['http.not_found', 'validation.failed'],
  })
  async listOpportunities(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpOpportunityListQuery) {
    return this.crm.listOpportunities(await this.workspace.open(actor, factoryId), q, await perms(this.permissions, actor));
  }

  @Post('opportunities')
  @Op({
    id: 'partner.erpCrm.createOpportunity',
    summary: 'Open an opportunity',
    description: 'For a customer or a lead, with value, stage and expected close; probability defaults by stage (D-359).',
    implements: ['D-359'],
    can: 'factory_sales.manage',
    etag: true,
    body: { type: ErpSaveOpportunityDto, example: { title: 'กล่องเค้ก 2 ขนาด — ล็อตแรก', customerId: E4_IDS.customer, value: '62500', expectedCloseOn: '2026-11-15' } },
    success: { status: 201, description: 'Opened', type: ErpOpportunityDto, example: OPPORTUNITY },
    errors: [...WRITE, 'erp.customer_required'],
  })
  async createOpportunity(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpSaveOpportunityDto) {
    return this.crm.createOpportunity(await this.workspace.open(actor, factoryId), body, await perms(this.permissions, actor));
  }

  @Get('opportunities/:opportunityId')
  @Op({
    id: 'partner.erpCrm.getOpportunity',
    summary: 'One opportunity',
    description: 'With its ETag for `PUT` (D-359).',
    implements: ['D-359'],
    can: 'factory_sales.read',
    params: ['opportunityId'],
    etag: true,
    success: { status: 200, description: 'The opportunity', type: ErpOpportunityDto, example: OPPORTUNITY },
  })
  async getOpportunity(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
  ) {
    return this.crm.getOpportunity(await this.workspace.open(actor, factoryId), opportunityId, await perms(this.permissions, actor));
  }

  @Put('opportunities/:opportunityId')
  @Op({
    id: 'partner.erpCrm.updateOpportunity',
    summary: 'Edit an opportunity',
    description: 'Open ones; moving the stage resets the probability unless one is given (D-359).',
    implements: ['D-359'],
    can: 'factory_sales.manage',
    params: ['opportunityId'],
    concurrency: true,
    etag: true,
    body: { type: ErpSaveOpportunityDto, example: { title: 'กล่องเค้ก 2 ขนาด — ล็อตแรก', stage: 'negotiation' } },
    success: { status: 200, description: 'Saved', type: ErpOpportunityDto, example: OPPORTUNITY },
    errors: [...WRITE, 'erp.invalid_status', 'erp.customer_required'],
  })
  async updateOpportunity(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ErpSaveOpportunityDto,
  ) {
    return this.crm.updateOpportunity(await this.workspace.open(actor, factoryId), opportunityId, ifMatch, body, await perms(this.permissions, actor));
  }

  @Post('opportunities/:opportunityId/actions/win')
  @Op({
    id: 'partner.erpCrm.winOpportunity',
    summary: 'Mark an opportunity won',
    description: 'Also happens when a quotation of it is accepted (D-359, D-360).',
    implements: ['D-359', 'D-360'],
    can: 'factory_sales.manage',
    params: ['opportunityId'],
    idempotent: true,
    status: 200,
    success: { status: 200, description: 'Won', type: ErpOpportunityDto, example: { ...OPPORTUNITY, stage: 'won', probabilityPct: 100, nextActions: [] } },
    errors: ['http.not_found'],
  })
  async winOpportunity(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
  ) {
    return this.crm.winOpportunity(await this.workspace.open(actor, factoryId), opportunityId, await perms(this.permissions, actor));
  }

  @Post('opportunities/:opportunityId/actions/lose')
  @Op({
    id: 'partner.erpCrm.loseOpportunity',
    summary: 'Mark an opportunity lost',
    description: 'With the reason (D-359).',
    implements: ['D-359'],
    can: 'factory_sales.manage',
    params: ['opportunityId'],
    idempotent: true,
    status: 200,
    body: { type: ErpLoseDto, example: { reason: 'ลูกค้าเลื่อนโครงการ' } },
    success: { status: 200, description: 'Lost', type: ErpOpportunityDto, example: { ...OPPORTUNITY, stage: 'lost', probabilityPct: 0, nextActions: [] } },
    errors: [...WRITE, 'erp.invalid_status'],
  })
  async loseOpportunity(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @Body() body: ErpLoseDto,
  ) {
    return this.crm.loseOpportunity(await this.workspace.open(actor, factoryId), opportunityId, body.reason, await perms(this.permissions, actor));
  }

  @Get('pipeline')
  @Op({
    id: 'partner.erpCrm.pipeline',
    summary: 'The sales pipeline',
    description: 'Open opportunities by stage with value and probability-weighted value, this month’s won and lost, by salesperson (D-359).',
    implements: ['D-359'],
    can: 'factory_sales.read',
    success: { status: 200, description: 'The pipeline', type: ErpPipelineDto, example: PIPELINE },
  })
  async pipeline(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.crm.pipeline(await this.workspace.open(actor, factoryId));
  }

  @Get('activities')
  @Op({
    id: 'partner.erpCrm.listActivities',
    summary: 'Activities and follow-ups',
    description: 'Calls, visits, tasks and notes; `view=due` = not done and due today or earlier (D-359).',
    implements: ['D-359'],
    can: 'factory_sales.read',
    paginated: { type: ErpActivityDto, example: [ACTIVITY] },
    errors: ['http.not_found', 'validation.failed'],
  })
  async listActivities(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpActivityListQuery) {
    return this.crm.listActivities(await this.workspace.open(actor, factoryId), q);
  }

  @Post('activities')
  @Op({
    id: 'partner.erpCrm.createActivity',
    summary: 'Log an activity or plan a follow-up',
    description: 'About exactly one lead, opportunity or customer; assigned to a user of this factory (D-359).',
    implements: ['D-359'],
    can: 'factory_sales.manage',
    body: { type: ErpSaveActivityDto, example: { kind: 'call', subject: 'โทรตามใบเสนอราคา', opportunityId: E4_IDS.opportunity, dueAt: '2026-10-14T10:00:00+07:00' } },
    success: { status: 201, description: 'Logged', type: ErpActivityDto, example: ACTIVITY },
    errors: WRITE,
  })
  async createActivity(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpSaveActivityDto) {
    return this.crm.createActivity(await this.workspace.open(actor, factoryId), body);
  }

  @Post('activities/:activityId/actions/complete')
  @Op({
    id: 'partner.erpCrm.completeActivity',
    summary: 'Mark a follow-up done',
    description: 'With its outcome; a new lead contacted moves to `contacted` (D-359).',
    implements: ['D-359'],
    can: 'factory_sales.manage',
    params: ['activityId'],
    idempotent: true,
    status: 200,
    body: { type: ErpCompleteActivityDto, example: { outcome: 'ลูกค้าขอส่งตัวอย่างก่อน' } },
    success: { status: 200, description: 'Done', type: ErpActivityDto, example: { ...ACTIVITY, doneAt: '2026-10-14T10:20:00+07:00', outcome: 'ลูกค้าขอส่งตัวอย่างก่อน' } },
    errors: [...WRITE, 'erp.invalid_status'],
  })
  async completeActivity(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Body() body: ErpCompleteActivityDto,
  ) {
    return this.crm.completeActivity(await this.workspace.open(actor, factoryId), activityId, body);
  }
}

// ==================================================================================== quotations

@ApiSurface('partner', 'erpQuotations')
@Controller('factories/:factoryId/erp/quotations')
export class PartnerErpQuotationsController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly quotes: ErpQuotationsService,
    private readonly orders: ErpSalesOrdersService,
    private readonly pdfs: ErpPdfService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get()
  @Op({
    id: 'partner.erpQuotations.list',
    summary: 'Quotations',
    description: 'Newest first, superseded revisions left out; `status=open` = draft or sent (D-360).',
    implements: ['D-360'],
    can: 'factory_sales.read',
    paginated: { type: ErpQuotationSummaryDto, example: [QUOTE_SUMMARY] },
    errors: ['http.not_found', 'validation.failed'],
  })
  async list(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpQuotationListQuery) {
    return this.quotes.list(await this.workspace.open(actor, factoryId), q);
  }

  @Post()
  @Op({
    id: 'partner.erpQuotations.create',
    summary: 'Draft a quotation',
    description: '`QT-YYMM-NNNN`, for a customer, priced line by line; valid for `settings.quoteValidDays` by default (D-360).',
    implements: ['D-360'],
    can: 'factory_sales.manage',
    etag: true,
    body: { type: ErpSaveQuotationDto, example: SAVE_QUOTE },
    success: { status: 201, description: 'Drafted', type: ErpQuotationDto, example: { ...QUOTE, status: 'draft', sentAt: null, linkActive: false } },
    errors: [...WRITE, 'erp.customer_required', 'erp.archived'],
  })
  async create(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpSaveQuotationDto) {
    return this.quotes.create(await this.workspace.open(actor, factoryId), body, await perms(this.permissions, actor));
  }

  @Get(':quotationId')
  @Op({
    id: 'partner.erpQuotations.get',
    summary: 'One quotation',
    description: 'Lines, totals, every revision of its number and the actions offered (D-360).',
    implements: ['D-360'],
    can: 'factory_sales.read',
    params: ['quotationId'],
    etag: true,
    success: { status: 200, description: 'The quotation', type: ErpQuotationDto, example: QUOTE },
  })
  async get(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('quotationId', ParseUUIDPipe) quotationId: string) {
    return this.quotes.get(await this.workspace.open(actor, factoryId), quotationId, await perms(this.permissions, actor));
  }

  @Put(':quotationId')
  @Op({
    id: 'partner.erpQuotations.update',
    summary: 'Edit a draft quotation',
    description: 'Replaces its lines and terms; drafts only (D-360).',
    implements: ['D-360'],
    can: 'factory_sales.manage',
    params: ['quotationId'],
    concurrency: true,
    etag: true,
    body: { type: ErpSaveQuotationDto, example: SAVE_QUOTE },
    success: { status: 200, description: 'Saved', type: ErpQuotationDto, example: { ...QUOTE, status: 'draft' } },
    errors: [...WRITE, 'erp.invalid_status', 'erp.customer_required', 'erp.archived'],
  })
  async update(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('quotationId', ParseUUIDPipe) quotationId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ErpSaveQuotationDto,
  ) {
    return this.quotes.update(await this.workspace.open(actor, factoryId), quotationId, ifMatch, body, await perms(this.permissions, actor));
  }

  @Post(':quotationId/actions/send')
  @Op({
    id: 'partner.erpQuotations.send',
    summary: 'Send a quotation',
    description:
      'Freezes the buyer and makes a new customer link (valid until the quotation expires; an earlier link stops ' +
      'working) for the factory to share by e-mail or LINE; the opportunity moves to proposal (D-360).',
    implements: ['D-360'],
    can: 'factory_sales.manage',
    params: ['quotationId'],
    idempotent: true,
    status: 200,
    success: {
      status: 200,
      description: 'Sent',
      type: ErpQuotationLinkDto,
      example: { quotation: QUOTE, url: 'https://www.packio.example/q/q3J9f0T1xYk8Zb2mR4sW6uE7vN0aLcDh', expiresAt: '2026-11-11T23:59:59+07:00' },
    },
    errors: ['http.not_found', 'erp.invalid_status', 'erp.quotation_expired'],
  })
  async send(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('quotationId', ParseUUIDPipe) quotationId: string) {
    return this.quotes.send(await this.workspace.open(actor, factoryId), quotationId, await perms(this.permissions, actor));
  }

  @Post(':quotationId/actions/revise')
  @Op({
    id: 'partner.erpQuotations.revise',
    summary: 'Revise a quotation',
    description: 'A new draft under the same number with the next revision, dated today; this one is superseded (D-360).',
    implements: ['D-360'],
    can: 'factory_sales.manage',
    params: ['quotationId'],
    idempotent: true,
    success: { status: 201, description: 'The new revision', type: ErpQuotationDto, example: { ...QUOTE, revision: 2, status: 'draft' } },
    errors: ['http.not_found', 'erp.invalid_status'],
  })
  async revise(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('quotationId', ParseUUIDPipe) quotationId: string) {
    return this.quotes.revise(await this.workspace.open(actor, factoryId), quotationId, await perms(this.permissions, actor));
  }

  @Post(':quotationId/actions/accept')
  @Op({
    id: 'partner.erpQuotations.accept',
    summary: 'Record the customer’s acceptance',
    description: 'Received another way (phone, the customer’s PO); wins its opportunity (D-360).',
    implements: ['D-360'],
    can: 'factory_sales.manage',
    params: ['quotationId'],
    idempotent: true,
    status: 200,
    body: { type: ErpRecordAcceptanceDto, example: { name: 'คุณสมศรี ใจดี', position: 'เจ้าของร้าน', customerPoNo: 'PO-6610-015' } },
    success: { status: 200, description: 'Accepted', type: ErpQuotationDto, example: { ...QUOTE, status: 'accepted', acceptedVia: 'factory' } },
    errors: [...WRITE, 'erp.invalid_status', 'erp.quotation_expired'],
  })
  async accept(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('quotationId', ParseUUIDPipe) quotationId: string,
    @Body() body: ErpRecordAcceptanceDto,
  ) {
    return this.quotes.accept(await this.workspace.open(actor, factoryId), quotationId, body, await perms(this.permissions, actor));
  }

  @Post(':quotationId/actions/reject')
  @Op({
    id: 'partner.erpQuotations.reject',
    summary: 'Record that the customer declined',
    description: 'With the reason (D-360).',
    implements: ['D-360'],
    can: 'factory_sales.manage',
    params: ['quotationId'],
    idempotent: true,
    status: 200,
    body: { type: ReasonDto, example: { reason: 'งบประมาณไม่พอในรอบนี้' } },
    success: { status: 200, description: 'Declined', type: ErpQuotationDto, example: { ...QUOTE, status: 'rejected' } },
    errors: [...WRITE, 'erp.invalid_status'],
  })
  async reject(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('quotationId', ParseUUIDPipe) quotationId: string,
    @Body() body: ReasonDto,
  ) {
    return this.quotes.reject(await this.workspace.open(actor, factoryId), quotationId, body.reason, await perms(this.permissions, actor));
  }

  @Post(':quotationId/actions/cancel')
  @Op({
    id: 'partner.erpQuotations.cancel',
    summary: 'Cancel a quotation',
    description: 'A draft or a sent one, with a reason; its link stops working (D-360).',
    implements: ['D-360'],
    can: 'factory_sales.manage',
    params: ['quotationId'],
    idempotent: true,
    status: 200,
    body: { type: ReasonDto, example: { reason: 'ลูกค้าขอเปลี่ยนสเปกทั้งหมด' } },
    success: { status: 200, description: 'Cancelled', type: ErpQuotationDto, example: { ...QUOTE, status: 'cancelled' } },
    errors: [...WRITE, 'erp.invalid_status'],
  })
  async cancel(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('quotationId', ParseUUIDPipe) quotationId: string,
    @Body() body: ReasonDto,
  ) {
    return this.quotes.cancel(await this.workspace.open(actor, factoryId), quotationId, body.reason, await perms(this.permissions, actor));
  }

  @Post(':quotationId/actions/order')
  @Op({
    id: 'partner.erpQuotations.order',
    summary: 'Make a sales order from an accepted quotation',
    description: 'A draft `SO` with its lines, prices, terms and the customer’s PO; the existing one when already made (D-361).',
    implements: ['D-360', 'D-361'],
    can: 'factory_sales.manage',
    params: ['quotationId'],
    idempotent: true,
    success: { status: 201, description: 'Drafted', type: ErpSalesOrderDto, example: { ...SO, status: 'draft', nextActions: [ACTION('erp_so.edit'), ACTION('erp_so.confirm')] } },
    errors: ['http.not_found', 'erp.invalid_status'],
  })
  async order(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('quotationId', ParseUUIDPipe) quotationId: string) {
    return this.orders.fromQuotation(await this.workspace.open(actor, factoryId), quotationId, await perms(this.permissions, actor));
  }

  @Get(':quotationId/pdf')
  @Op({
    id: 'partner.erpQuotations.pdf',
    summary: 'The quotation as a PDF',
    description: 'Under the factory’s name and logo; a short-lived link (D-368).',
    implements: ['D-368'],
    can: 'factory_sales.read',
    params: ['quotationId'],
    success: { status: 200, description: 'The link', type: ErpPdfLinkDto, example: { ...PDF_LINK, fileName: 'QT-2610-0003.pdf' } },
  })
  async pdf(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('quotationId', ParseUUIDPipe) quotationId: string) {
    return this.pdfs.pdf(await this.workspace.open(actor, factoryId), 'quotation', quotationId);
  }
}

// ============================================================================== the customer's link

export const QUOTE_LINK_THROTTLE = {
  default: { limit: () => Number(process.env.QUOTE_LINK_THROTTLE_LIMIT ?? 30), ttl: 60_000 },
};

@ApiSurface('store', 'quoteLinks')
@Controller('quote-links/:token')
export class PublicQuotationLinksController {
  constructor(private readonly quotes: ErpQuotationsService) {}

  @Get()
  @Public()
  @Throttle(QUOTE_LINK_THROTTLE)
  @ApiParam({ name: 'token', example: 'q3J9f0T1xYk8Zb2mR4sW6uE7vN0aLcDh' })
  @ApiEndpoint({
    id: 'store.quoteLinks.get',
    summary: 'A factory’s quotation, opened by its customer',
    description:
      'From the link the factory sent. The factory as seller, the buyer, lines and totals — nothing else of the ' +
      'factory. Unknown or replaced links are 404; past its date 410. Rate-limited per client.',
    implements: ['D-360'],
  })
  @ApiSuccess(200, { description: 'The quotation', type: PublicQuotationDto, example: PUBLIC_QUOTE })
  @ApiStandardErrors('http.not_found', 'erp.quotation_expired', 'http.too_many_requests')
  get(@Param('token') token: string) {
    return this.quotes.publicView(token);
  }

  @Post('actions/accept')
  @HttpCode(200)
  @Public()
  @Throttle(QUOTE_LINK_THROTTLE)
  @ApiParam({ name: 'token', example: 'q3J9f0T1xYk8Zb2mR4sW6uE7vN0aLcDh' })
  @ApiEndpoint({
    id: 'store.quoteLinks.accept',
    summary: 'Accept the quotation',
    description: 'The customer’s name, position and PO number are recorded with the acceptance; the factory is told (D-360).',
    implements: ['D-360'],
  })
  @ApiBody({ type: PublicAcceptQuotationDto, examples: { default: { value: { name: 'คุณสมศรี ใจดี', position: 'เจ้าของร้าน', customerPoNo: 'PO-6610-015', agree: true } } } })
  @ApiSuccess(200, { description: 'Accepted', type: PublicQuotationDto, example: { ...PUBLIC_QUOTE, status: 'accepted', acceptedAt: '2026-10-13T09:00:00+07:00', acceptedName: 'คุณสมศรี ใจดี' } })
  @ApiStandardErrors(...WRITE, 'erp.quotation_expired', 'erp.invalid_status', 'http.too_many_requests')
  accept(@Param('token') token: string, @Body() body: PublicAcceptQuotationDto) {
    return this.quotes.publicAccept(token, body);
  }

  @Post('actions/decline')
  @HttpCode(200)
  @Public()
  @Throttle(QUOTE_LINK_THROTTLE)
  @ApiParam({ name: 'token', example: 'q3J9f0T1xYk8Zb2mR4sW6uE7vN0aLcDh' })
  @ApiEndpoint({
    id: 'store.quoteLinks.decline',
    summary: 'Decline the quotation',
    description: 'With a reason for the factory (D-360).',
    implements: ['D-360'],
  })
  @ApiBody({ type: PublicDeclineQuotationDto, examples: { default: { value: { reason: 'งบประมาณไม่พอในรอบนี้' } } } })
  @ApiSuccess(200, { description: 'Declined', type: PublicQuotationDto, example: { ...PUBLIC_QUOTE, status: 'rejected' } })
  @ApiStandardErrors(...WRITE, 'erp.quotation_expired', 'erp.invalid_status', 'http.too_many_requests')
  decline(@Param('token') token: string, @Body() body: PublicDeclineQuotationDto) {
    return this.quotes.publicDecline(token, body.reason);
  }
}

// ================================================================================== sales orders

@ApiSurface('partner', 'erpSalesOrders')
@Controller('factories/:factoryId/erp/sales-orders')
export class PartnerErpSalesOrdersController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly orders: ErpSalesOrdersService,
    private readonly pdfs: ErpPdfService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get()
  @Op({
    id: 'partner.erpSalesOrders.list',
    summary: 'Sales orders',
    description: 'Newest first; `status=open` = confirmed or partially delivered (D-361).',
    implements: ['D-361'],
    can: 'factory_sales.read',
    paginated: { type: ErpSalesOrderSummaryDto, example: [SO_SUMMARY] },
    errors: ['http.not_found', 'validation.failed'],
  })
  async list(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpSalesOrderListQuery) {
    return this.orders.list(await this.workspace.open(actor, factoryId), q);
  }

  @Post()
  @Op({
    id: 'partner.erpSalesOrders.create',
    summary: 'Enter a sales order',
    description: 'A draft `SO-YYMM-NNNN`; each goods line from stock or made to order, service lines without goods (D-361).',
    implements: ['D-361'],
    can: 'factory_sales.manage',
    etag: true,
    body: { type: ErpSaveSalesOrderDto, example: SAVE_SO },
    success: { status: 201, description: 'Drafted', type: ErpSalesOrderDto, example: { ...SO, status: 'draft' } },
    errors: [...WRITE, 'erp.customer_required', 'erp.archived'],
  })
  async create(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpSaveSalesOrderDto) {
    return this.orders.create(await this.workspace.open(actor, factoryId), body, await perms(this.permissions, actor));
  }

  @Get(':salesOrderId')
  @Op({
    id: 'partner.erpSalesOrders.get',
    summary: 'One sales order',
    description: 'Lines with reserved, delivered and invoiced quantities, its deliveries and invoices, the customer’s credit position (D-361).',
    implements: ['D-361'],
    can: 'factory_sales.read',
    params: ['salesOrderId'],
    etag: true,
    success: { status: 200, description: 'The order', type: ErpSalesOrderDto, example: SO },
  })
  async get(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('salesOrderId', ParseUUIDPipe) salesOrderId: string) {
    return this.orders.get(await this.workspace.open(actor, factoryId), salesOrderId, await perms(this.permissions, actor));
  }

  @Put(':salesOrderId')
  @Op({
    id: 'partner.erpSalesOrders.update',
    summary: 'Edit a draft sales order',
    description: 'Drafts only (D-361).',
    implements: ['D-361'],
    can: 'factory_sales.manage',
    params: ['salesOrderId'],
    concurrency: true,
    etag: true,
    body: { type: ErpSaveSalesOrderDto, example: SAVE_SO },
    success: { status: 200, description: 'Saved', type: ErpSalesOrderDto, example: { ...SO, status: 'draft' } },
    errors: [...WRITE, 'erp.invalid_status', 'erp.customer_required', 'erp.archived'],
  })
  async update(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('salesOrderId', ParseUUIDPipe) salesOrderId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ErpSaveSalesOrderDto,
  ) {
    return this.orders.update(await this.workspace.open(actor, factoryId), salesOrderId, ifMatch, body, await perms(this.permissions, actor));
  }

  @Post(':salesOrderId/actions/confirm')
  @Op({
    id: 'partner.erpSalesOrders.confirm',
    summary: 'Confirm a sales order',
    description:
      'Checks the customer’s credit limit (over it: refused, unless `factory_sales.approve` gives a reason), reserves ' +
      'stock lines and plans a production order per make-to-order line from its item’s active recipe (D-361).',
    implements: ['D-361'],
    can: 'factory_sales.manage',
    params: ['salesOrderId'],
    idempotent: true,
    status: 200,
    body: { type: ErpConfirmSalesOrderDto, example: {} },
    success: { status: 200, description: 'Confirmed', type: ErpSalesOrderDto, example: SO },
    errors: [...WRITE, 'erp.invalid_status', 'erp.credit_limit_exceeded', 'erp.recipe_required'],
  })
  async confirm(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('salesOrderId', ParseUUIDPipe) salesOrderId: string,
    @Body() body: ErpConfirmSalesOrderDto,
  ) {
    return this.orders.confirm(await this.workspace.open(actor, factoryId), salesOrderId, body, await perms(this.permissions, actor));
  }

  @Post(':salesOrderId/actions/close')
  @Op({
    id: 'partner.erpSalesOrders.close',
    summary: 'Close a sales order short',
    description: 'What is left will not be delivered; its reservations are released (D-361).',
    implements: ['D-361'],
    can: 'factory_sales.manage',
    params: ['salesOrderId'],
    idempotent: true,
    status: 200,
    body: { type: ReasonDto, example: { reason: 'ลูกค้าขอรับเท่าที่ส่งแล้ว' } },
    success: { status: 200, description: 'Closed', type: ErpSalesOrderDto, example: { ...SO, status: 'closed' } },
    errors: [...WRITE, 'erp.invalid_status'],
  })
  async close(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('salesOrderId', ParseUUIDPipe) salesOrderId: string,
    @Body() body: ReasonDto,
  ) {
    return this.orders.close(await this.workspace.open(actor, factoryId), salesOrderId, body.reason, await perms(this.permissions, actor));
  }

  @Post(':salesOrderId/actions/cancel')
  @Op({
    id: 'partner.erpSalesOrders.cancel',
    summary: 'Cancel a sales order',
    description: 'Nothing delivered yet; reservations are released and its planned production orders cancelled (D-361).',
    implements: ['D-361'],
    can: 'factory_sales.manage',
    params: ['salesOrderId'],
    idempotent: true,
    status: 200,
    body: { type: ReasonDto, example: { reason: 'ลูกค้ายกเลิกคำสั่งซื้อ' } },
    success: { status: 200, description: 'Cancelled', type: ErpSalesOrderDto, example: { ...SO, status: 'cancelled' } },
    errors: [...WRITE, 'erp.invalid_status', 'erp.materials_issued'],
  })
  async cancel(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('salesOrderId', ParseUUIDPipe) salesOrderId: string,
    @Body() body: ReasonDto,
  ) {
    return this.orders.cancel(await this.workspace.open(actor, factoryId), salesOrderId, body.reason, await perms(this.permissions, actor));
  }

  @Get(':salesOrderId/pdf')
  @Op({
    id: 'partner.erpSalesOrders.pdf',
    summary: 'The order confirmation as a PDF',
    description: 'A short-lived link (D-368).',
    implements: ['D-368'],
    can: 'factory_sales.read',
    params: ['salesOrderId'],
    success: { status: 200, description: 'The link', type: ErpPdfLinkDto, example: { ...PDF_LINK, fileName: 'SO-2610-0004.pdf' } },
  })
  async pdf(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('salesOrderId', ParseUUIDPipe) salesOrderId: string) {
    return this.pdfs.pdf(await this.workspace.open(actor, factoryId), 'sales_order', salesOrderId);
  }
}

// ================================================================================= delivery notes

@ApiSurface('partner', 'erpDeliveryNotes')
@Controller('factories/:factoryId/erp/delivery-notes')
export class PartnerErpDeliveryNotesController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly orders: ErpSalesOrdersService,
    private readonly pdfs: ErpPdfService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get()
  @Op({
    id: 'partner.erpDeliveryNotes.list',
    summary: 'Delivery notes',
    description: 'Newest first; `status=uninvoiced` = issued or delivered with lines not yet invoiced (D-362).',
    implements: ['D-362'],
    can: 'factory_sales.read',
    paginated: { type: ErpDeliveryNoteSummaryDto, example: [DO_SUMMARY] },
    errors: ['http.not_found', 'validation.failed'],
  })
  async list(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpDeliveryNoteListQuery) {
    return this.orders.listDeliveries(await this.workspace.open(actor, factoryId), q);
  }

  @Post()
  @Op({
    id: 'partner.erpDeliveryNotes.create',
    summary: 'Prepare a delivery',
    description: 'A draft `DO-YYMM-NNNN` from one sales order’s remaining quantities (all of them by default), D-362.',
    implements: ['D-362'],
    can: 'factory_delivery.manage',
    etag: true,
    body: { type: ErpCreateDeliveryNoteDto, example: { salesOrderId: E4_IDS.salesOrder, deliverOn: '2026-10-20', lines: [{ salesOrderLineId: E4_IDS.salesOrderLine, quantity: '2000' }] } },
    success: { status: 201, description: 'Prepared', type: ErpDeliveryNoteDto, example: { ...DO, status: 'draft', issuedAt: null, deliveredAt: null, receivedBy: null } },
    errors: [...WRITE, 'erp.invalid_status', 'erp.over_delivery', 'erp.nothing_to_deliver', 'erp.archived'],
  })
  async create(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpCreateDeliveryNoteDto) {
    return this.orders.createDelivery(await this.workspace.open(actor, factoryId), body, await perms(this.permissions, actor));
  }

  @Get(':deliveryNoteId')
  @Op({
    id: 'partner.erpDeliveryNotes.get',
    summary: 'One delivery note',
    description: 'Its lines with the stock cost they left with (D-362).',
    implements: ['D-362'],
    can: 'factory_sales.read',
    params: ['deliveryNoteId'],
    etag: true,
    success: { status: 200, description: 'The delivery note', type: ErpDeliveryNoteDto, example: DO },
  })
  async get(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('deliveryNoteId', ParseUUIDPipe) deliveryNoteId: string) {
    return this.orders.getDelivery(await this.workspace.open(actor, factoryId), deliveryNoteId, await perms(this.permissions, actor));
  }

  @Post(':deliveryNoteId/actions/issue')
  @Op({
    id: 'partner.erpDeliveryNotes.issue',
    summary: 'Issue the goods',
    description: '`sales_issue` movements at the moving average, consuming the order’s reservation; the order’s delivered quantities move (D-362).',
    implements: ['D-362', 'D-321'],
    can: 'factory_delivery.manage',
    params: ['deliveryNoteId'],
    idempotent: true,
    status: 200,
    success: { status: 200, description: 'Issued', type: ErpDeliveryNoteDto, example: { ...DO, status: 'issued', deliveredAt: null, receivedBy: null } },
    errors: ['http.not_found', 'erp.invalid_status', 'erp.over_delivery', 'erp.stock_insufficient', 'erp.lot_required'],
  })
  async issue(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('deliveryNoteId', ParseUUIDPipe) deliveryNoteId: string) {
    return this.orders.issueDelivery(await this.workspace.open(actor, factoryId), deliveryNoteId, await perms(this.permissions, actor));
  }

  @Post(':deliveryNoteId/actions/deliver')
  @Op({
    id: 'partner.erpDeliveryNotes.deliver',
    summary: 'Record the delivery',
    description: 'Who received it and when, optionally a photo of the signed copy (an uploaded file of this factory), D-362.',
    implements: ['D-362'],
    can: 'factory_delivery.manage',
    params: ['deliveryNoteId'],
    idempotent: true,
    status: 200,
    body: { type: ErpDeliveredDto, example: { receivedBy: 'คุณสมศรี' } },
    success: { status: 200, description: 'Delivered', type: ErpDeliveryNoteDto, example: DO },
    errors: [...WRITE, 'erp.invalid_status', 'erp.file_not_usable'],
  })
  async deliver(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('deliveryNoteId', ParseUUIDPipe) deliveryNoteId: string,
    @Body() body: ErpDeliveredDto,
  ) {
    return this.orders.deliverDelivery(await this.workspace.open(actor, factoryId), deliveryNoteId, body, await perms(this.permissions, actor));
  }

  @Post(':deliveryNoteId/actions/cancel')
  @Op({
    id: 'partner.erpDeliveryNotes.cancel',
    summary: 'Cancel a delivery note',
    description: 'A draft, or an issued note not yet invoiced — its goods come back at the cost they left with (D-362).',
    implements: ['D-362'],
    can: 'factory_delivery.manage',
    params: ['deliveryNoteId'],
    idempotent: true,
    status: 200,
    body: { type: ReasonDto, example: { reason: 'ลูกค้าขอเลื่อนรับสินค้า' } },
    success: { status: 200, description: 'Cancelled', type: ErpDeliveryNoteDto, example: { ...DO, status: 'cancelled', cancelReason: 'ลูกค้าขอเลื่อนรับสินค้า', nextActions: [] } },
    errors: [...WRITE, 'erp.invalid_status'],
  })
  async cancel(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('deliveryNoteId', ParseUUIDPipe) deliveryNoteId: string,
    @Body() body: ReasonDto,
  ) {
    return this.orders.cancelDelivery(await this.workspace.open(actor, factoryId), deliveryNoteId, body.reason, await perms(this.permissions, actor));
  }

  @Get(':deliveryNoteId/pdf')
  @Op({
    id: 'partner.erpDeliveryNotes.pdf',
    summary: 'The delivery note as a PDF',
    description: 'Original and copy for signing; a short-lived link (D-368).',
    implements: ['D-368'],
    can: 'factory_sales.read',
    params: ['deliveryNoteId'],
    success: { status: 200, description: 'The link', type: ErpPdfLinkDto, example: { ...PDF_LINK, fileName: 'DO-2610-0002.pdf' } },
    errors: ['http.not_found', 'erp.invalid_status'],
  })
  async pdf(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('deliveryNoteId', ParseUUIDPipe) deliveryNoteId: string) {
    return this.pdfs.pdf(await this.workspace.open(actor, factoryId), 'delivery_note', deliveryNoteId);
  }
}

// ============================================================================= invoices and notes

@ApiSurface('partner', 'erpSalesInvoices')
@Controller('factories/:factoryId/erp')
export class PartnerErpSalesInvoicesController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly receivables: ErpReceivablesService,
    private readonly pdfs: ErpPdfService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get('sales-invoices')
  @Op({
    id: 'partner.erpSalesInvoices.list',
    summary: 'Invoices and tax invoices',
    description: 'Newest first; `status=open` = something left to receive, `overdue` = open past due (D-363).',
    implements: ['D-363'],
    can: 'factory_receivables.read',
    paginated: { type: ErpSalesInvoiceSummaryDto, example: [IV_SUMMARY] },
    errors: ['http.not_found', 'validation.failed'],
  })
  async list(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpSalesInvoiceListQuery) {
    return this.receivables.listInvoices(await this.workspace.open(actor, factoryId), q);
  }

  @Post('sales-invoices')
  @Op({
    id: 'partner.erpSalesInvoices.create',
    summary: 'Draft an invoice',
    description:
      'From issued delivery notes (their uninvoiced lines), a sales order (its service lines, or goods when nothing was ' +
      'delivered) and free lines; a tax invoice when the factory is VAT-registered. The quantities are held for it (D-363).',
    implements: ['D-363'],
    can: 'factory_receivables.manage',
    etag: true,
    body: { type: ErpCreateSalesInvoiceDto, example: { customerId: E4_IDS.customer, deliveryNoteIds: [E4_IDS.deliveryNote] } },
    success: { status: 201, description: 'Drafted', type: ErpSalesInvoiceDto, example: { ...IV, invoiceNo: null, status: 'draft', seller: null, issuedAt: null } },
    errors: [...WRITE, 'erp.invalid_status', 'erp.nothing_to_invoice', 'erp.customer_required', 'erp.archived'],
  })
  async create(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpCreateSalesInvoiceDto) {
    return this.receivables.createInvoice(await this.workspace.open(actor, factoryId), body, await perms(this.permissions, actor));
  }

  @Get('sales-invoices/:invoiceId')
  @Op({
    id: 'partner.erpSalesInvoices.get',
    summary: 'One invoice',
    description: 'Lines, the seller and buyer as printed, notes and receipts against it, what is open (D-363).',
    implements: ['D-363'],
    can: 'factory_receivables.read',
    params: ['invoiceId'],
    etag: true,
    success: { status: 200, description: 'The invoice', type: ErpSalesInvoiceDto, example: IV },
  })
  async get(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('invoiceId', ParseUUIDPipe) invoiceId: string) {
    return this.receivables.getInvoice(await this.workspace.open(actor, factoryId), invoiceId, await perms(this.permissions, actor));
  }

  @Patch('sales-invoices/:invoiceId')
  @Op({
    id: 'partner.erpSalesInvoices.update',
    summary: 'Edit a draft invoice',
    description: 'Its free lines, date, terms, VAT mode and note; lines from deliveries stay (D-363).',
    implements: ['D-363'],
    can: 'factory_receivables.manage',
    params: ['invoiceId'],
    concurrency: true,
    etag: true,
    body: { type: ErpUpdateSalesInvoiceDto, example: { issueDate: '2026-10-21', note: 'ชำระภายใน 30 วัน' } },
    success: { status: 200, description: 'Saved', type: ErpSalesInvoiceDto, example: { ...IV, invoiceNo: null, status: 'draft' } },
    errors: [...WRITE, 'erp.invalid_status', 'erp.nothing_to_invoice'],
  })
  async update(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ErpUpdateSalesInvoiceDto,
  ) {
    return this.receivables.updateInvoice(await this.workspace.open(actor, factoryId), invoiceId, ifMatch, body, await perms(this.permissions, actor));
  }

  @Delete('sales-invoices/:invoiceId')
  @Op({
    id: 'partner.erpSalesInvoices.delete',
    summary: 'Delete a draft invoice',
    description: 'A draft has no number yet; its held quantities are free again (D-363).',
    implements: ['D-363'],
    can: 'factory_receivables.manage',
    params: ['invoiceId'],
    status: 204,
    success: { status: 204, description: 'Deleted' },
    errors: ['http.not_found', 'erp.invalid_status'],
  })
  async remove(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('invoiceId', ParseUUIDPipe) invoiceId: string) {
    await this.receivables.deleteInvoice(await this.workspace.open(actor, factoryId), invoiceId);
  }

  @Post('sales-invoices/:invoiceId/actions/issue')
  @Op({
    id: 'partner.erpSalesInvoices.issue',
    summary: 'Issue an invoice',
    description:
      'Numbers it `IV-YYMM-NNNN` for its date (the tax point — not in the future, not before the last issued), freezes ' +
      'the seller and buyer, sets the due date; a cash sale is receipted at once (D-363).',
    implements: ['D-363'],
    can: 'factory_receivables.manage',
    params: ['invoiceId'],
    idempotent: true,
    status: 200,
    body: { type: ErpIssueSalesInvoiceDto, example: { issueDate: '2026-10-20' } },
    success: { status: 200, description: 'Issued', type: ErpSalesInvoiceDto, example: IV },
    errors: [...WRITE, 'erp.invalid_status', 'erp.invoice_date_order', 'erp.seller_incomplete'],
  })
  async issue(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() body: ErpIssueSalesInvoiceDto,
  ) {
    return this.receivables.issueInvoice(await this.workspace.open(actor, factoryId), invoiceId, body, await perms(this.permissions, actor));
  }

  @Post('sales-invoices/:invoiceId/actions/void')
  @Op({
    id: 'partner.erpSalesInvoices.void',
    summary: 'Void an issued invoice',
    description: 'Nothing received or noted against it; the number stays (shown voided in the VAT report), its quantities are free again (D-363).',
    implements: ['D-363'],
    can: 'factory_receivables.manage',
    params: ['invoiceId'],
    idempotent: true,
    status: 200,
    body: { type: ErpVoidDto, example: { reason: 'ออกผิดชื่อผู้ซื้อ จะออกฉบับใหม่แทน' } },
    success: { status: 200, description: 'Voided', type: ErpSalesInvoiceDto, example: { ...IV, status: 'voided', voidReason: 'ออกผิดชื่อผู้ซื้อ จะออกฉบับใหม่แทน', nextActions: [ACTION('erp_iv.pdf')] } },
    errors: [...WRITE, 'erp.invalid_status', 'erp.document_settled'],
  })
  async voidInvoice(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() body: ErpVoidDto,
  ) {
    return this.receivables.voidInvoice(await this.workspace.open(actor, factoryId), invoiceId, body.reason, await perms(this.permissions, actor));
  }

  @Get('sales-invoices/:invoiceId/pdf')
  @Op({
    id: 'partner.erpSalesInvoices.pdf',
    summary: 'The invoice as a PDF',
    description: 'Original and copy, Thai, amount in words; kept once issued; a short-lived link (D-368).',
    implements: ['D-368'],
    can: 'factory_receivables.read',
    params: ['invoiceId'],
    success: { status: 200, description: 'The link', type: ErpPdfLinkDto, example: PDF_LINK },
    errors: ['http.not_found', 'erp.invalid_status'],
  })
  async pdf(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('invoiceId', ParseUUIDPipe) invoiceId: string) {
    return this.pdfs.pdf(await this.workspace.open(actor, factoryId), 'invoice', invoiceId);
  }

  @Get('sales-notes')
  @Op({
    id: 'partner.erpSalesInvoices.listNotes',
    summary: 'Credit and debit notes',
    description: 'Newest first (D-364).',
    implements: ['D-364'],
    can: 'factory_receivables.read',
    paginated: { type: ErpSalesNoteDto, example: [NOTE] },
    errors: ['http.not_found', 'validation.failed'],
  })
  async listNotes(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpSalesNoteListQuery) {
    return this.receivables.listNotes(await this.workspace.open(actor, factoryId), q);
  }

  @Post('sales-notes')
  @Op({
    id: 'partner.erpSalesInvoices.createNote',
    summary: 'Draft a credit or debit note',
    description:
      'Against one issued invoice, with the Revenue Department reason; a credit note cannot take more than the invoice is ' +
      'worth after earlier notes; returned goods may come back into a warehouse (D-364).',
    implements: ['D-364'],
    can: 'factory_receivables.manage',
    etag: true,
    body: {
      type: ErpCreateSalesNoteDto,
      example: {
        kind: 'credit',
        invoiceId: E4_IDS.invoice,
        reason: 'defective',
        reasonText: 'พิมพ์สีเพี้ยน 80 ใบ',
        lines: [{ description: 'รับคืนกล่องพิมพ์สีเพี้ยน 80 ใบ', amount: '1000', itemId: E4_IDS.productItem, returnQty: '80' }],
      },
    },
    success: { status: 201, description: 'Drafted', type: ErpSalesNoteDto, example: { ...NOTE, noteNo: null, status: 'draft' } },
    errors: [...WRITE, 'erp.invalid_status', 'erp.note_exceeds_invoice'],
  })
  async createNote(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpCreateSalesNoteDto) {
    return this.receivables.createNote(await this.workspace.open(actor, factoryId), body, await perms(this.permissions, actor));
  }

  @Get('sales-notes/:noteId')
  @Op({
    id: 'partner.erpSalesInvoices.getNote',
    summary: 'One credit or debit note',
    description: 'Original, correct and difference values with VAT (D-364).',
    implements: ['D-364'],
    can: 'factory_receivables.read',
    params: ['noteId'],
    etag: true,
    success: { status: 200, description: 'The note', type: ErpSalesNoteDto, example: NOTE },
  })
  async getNote(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('noteId', ParseUUIDPipe) noteId: string) {
    return this.receivables.getNote(await this.workspace.open(actor, factoryId), noteId, await perms(this.permissions, actor));
  }

  @Delete('sales-notes/:noteId')
  @Op({
    id: 'partner.erpSalesInvoices.deleteNote',
    summary: 'Delete a draft note',
    description: 'Drafts only (D-364).',
    implements: ['D-364'],
    can: 'factory_receivables.manage',
    params: ['noteId'],
    status: 204,
    success: { status: 204, description: 'Deleted' },
    errors: ['http.not_found', 'erp.invalid_status'],
  })
  async removeNote(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('noteId', ParseUUIDPipe) noteId: string) {
    await this.receivables.deleteNote(await this.workspace.open(actor, factoryId), noteId);
  }

  @Post('sales-notes/:noteId/actions/issue')
  @Op({
    id: 'partner.erpSalesInvoices.issueNote',
    summary: 'Issue a credit or debit note',
    description: 'Numbers it `CN`/`DR`, freezes it, changes what the invoice is worth and brings returned goods back (D-364).',
    implements: ['D-364'],
    can: 'factory_receivables.manage',
    params: ['noteId'],
    idempotent: true,
    status: 200,
    success: { status: 200, description: 'Issued', type: ErpSalesNoteDto, example: NOTE },
    errors: ['http.not_found', 'erp.invalid_status', 'erp.note_exceeds_invoice', 'erp.invoice_date_order', 'erp.seller_incomplete'],
  })
  async issueNote(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('noteId', ParseUUIDPipe) noteId: string) {
    return this.receivables.issueNote(await this.workspace.open(actor, factoryId), noteId, await perms(this.permissions, actor));
  }

  @Post('sales-notes/:noteId/actions/void')
  @Op({
    id: 'partner.erpSalesInvoices.voidNote',
    summary: 'Void a credit or debit note',
    description: 'The invoice’s value is restored; returned goods go out again (D-364).',
    implements: ['D-364'],
    can: 'factory_receivables.manage',
    params: ['noteId'],
    idempotent: true,
    status: 200,
    body: { type: ErpVoidDto, example: { reason: 'ออกซ้ำ' } },
    success: { status: 200, description: 'Voided', type: ErpSalesNoteDto, example: { ...NOTE, status: 'voided', voidReason: 'ออกซ้ำ' } },
    errors: [...WRITE, 'erp.invalid_status', 'erp.document_settled', 'erp.stock_insufficient'],
  })
  async voidNote(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() body: ErpVoidDto,
  ) {
    return this.receivables.voidNote(await this.workspace.open(actor, factoryId), noteId, body.reason, await perms(this.permissions, actor));
  }

  @Get('sales-notes/:noteId/pdf')
  @Op({
    id: 'partner.erpSalesInvoices.notePdf',
    summary: 'The note as a PDF',
    description: 'A short-lived link (D-368).',
    implements: ['D-368'],
    can: 'factory_receivables.read',
    params: ['noteId'],
    success: { status: 200, description: 'The link', type: ErpPdfLinkDto, example: { ...PDF_LINK, fileName: 'CN-2610-0001.pdf' } },
    errors: ['http.not_found', 'erp.invalid_status'],
  })
  async notePdf(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('noteId', ParseUUIDPipe) noteId: string) {
    return this.pdfs.pdf(await this.workspace.open(actor, factoryId), 'note', noteId);
  }
}

// ============================================================================ receipts and billing

@ApiSurface('partner', 'erpReceivables')
@Controller('factories/:factoryId/erp')
export class PartnerErpReceivablesController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly receivables: ErpReceivablesService,
    private readonly pdfs: ErpPdfService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get('receipts')
  @Op({
    id: 'partner.erpReceivables.listReceipts',
    summary: 'Receipts and refunds',
    description: 'Newest first (D-365).',
    implements: ['D-365'],
    can: 'factory_receivables.read',
    paginated: { type: ErpCustomerReceiptDto, example: [RECEIPT] },
    errors: ['http.not_found', 'validation.failed'],
  })
  async listReceipts(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpReceiptListQuery) {
    return this.receivables.listReceipts(await this.workspace.open(actor, factoryId), q, await perms(this.permissions, actor));
  }

  @Post('receipts')
  @Op({
    id: 'partner.erpReceivables.receive',
    summary: 'Record money received (or refunded)',
    description:
      '`RC-YYMM-NNNN`; allocations are gross — cash plus the WHT the customer deducted (with its 50 ทวิ) — never beyond ' +
      'what is open; a refund pays back a credit balance (D-365).',
    implements: ['D-365'],
    can: 'factory_receivables.manage',
    idempotent: true,
    body: {
      type: ErpCreateReceiptDto,
      example: {
        customerId: E4_IDS.customer,
        receivedOn: '2026-11-10',
        method: 'transfer',
        amount: '24840',
        whtAmount: '840',
        whtCertNo: '0001/2569',
        allocations: [{ invoiceId: E4_IDS.invoice, amount: '25680' }],
      },
    },
    success: { status: 201, description: 'Recorded', type: ErpCustomerReceiptDto, example: RECEIPT },
    errors: [...WRITE, 'erp.invalid_status', 'erp.allocation_exceeds_open', 'erp.file_not_usable', 'erp.customer_required'],
  })
  async receive(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpCreateReceiptDto) {
    return this.receivables.receive(await this.workspace.open(actor, factoryId), body, await perms(this.permissions, actor));
  }

  @Get('receipts/:receiptId')
  @Op({
    id: 'partner.erpReceivables.getReceipt',
    summary: 'One receipt',
    description: 'With its allocations (D-365).',
    implements: ['D-365'],
    can: 'factory_receivables.read',
    params: ['receiptId'],
    success: { status: 200, description: 'The receipt', type: ErpCustomerReceiptDto, example: RECEIPT },
  })
  async getReceipt(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('receiptId', ParseUUIDPipe) receiptId: string) {
    return this.receivables.getReceipt(await this.workspace.open(actor, factoryId), receiptId, await perms(this.permissions, actor));
  }

  @Post('receipts/:receiptId/actions/cancel')
  @Op({
    id: 'partner.erpReceivables.cancelReceipt',
    summary: 'Cancel a receipt',
    description: 'The number stays; its invoices are open again (D-365).',
    implements: ['D-365'],
    can: 'factory_receivables.manage',
    params: ['receiptId'],
    idempotent: true,
    status: 200,
    body: { type: ReasonDto, example: { reason: 'เช็คคืน' } },
    success: { status: 200, description: 'Cancelled', type: ErpCustomerReceiptDto, example: { ...RECEIPT, status: 'cancelled', cancelReason: 'เช็คคืน', nextActions: [ACTION('erp_rc.pdf')] } },
    errors: [...WRITE, 'erp.invalid_status'],
  })
  async cancelReceipt(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('receiptId', ParseUUIDPipe) receiptId: string,
    @Body() body: ReasonDto,
  ) {
    return this.receivables.cancelReceipt(await this.workspace.open(actor, factoryId), receiptId, body.reason, await perms(this.permissions, actor));
  }

  @Get('receipts/:receiptId/pdf')
  @Op({
    id: 'partner.erpReceivables.receiptPdf',
    summary: 'The receipt as a PDF',
    description: 'A short-lived link (D-368).',
    implements: ['D-368'],
    can: 'factory_receivables.read',
    params: ['receiptId'],
    success: { status: 200, description: 'The link', type: ErpPdfLinkDto, example: { ...PDF_LINK, fileName: 'RC-2611-0001.pdf' } },
  })
  async receiptPdf(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('receiptId', ParseUUIDPipe) receiptId: string) {
    return this.pdfs.pdf(await this.workspace.open(actor, factoryId), 'receipt', receiptId);
  }

  @Get('billing-notes')
  @Op({
    id: 'partner.erpReceivables.listBillingNotes',
    summary: 'Billing notes',
    description: 'Newest first (D-365).',
    implements: ['D-365'],
    can: 'factory_receivables.read',
    paginated: { type: ErpBillingNoteDto, example: [BILLING] },
    errors: ['http.not_found', 'validation.failed'],
  })
  async listBillingNotes(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpBillingNoteListQuery) {
    return this.receivables.listBillingNotes(await this.workspace.open(actor, factoryId), q, await perms(this.permissions, actor));
  }

  @Post('billing-notes')
  @Op({
    id: 'partner.erpReceivables.createBillingNote',
    summary: 'Issue a billing note',
    description: '`BN-YYMM-NNNN` listing a customer’s open invoices with a collection date (D-365).',
    implements: ['D-365'],
    can: 'factory_receivables.manage',
    idempotent: true,
    body: { type: ErpCreateBillingNoteDto, example: { customerId: E4_IDS.customer, invoiceIds: [E4_IDS.invoice], collectOn: '2026-11-05' } },
    success: { status: 201, description: 'Issued', type: ErpBillingNoteDto, example: BILLING },
    errors: [...WRITE, 'erp.invalid_status', 'erp.customer_required'],
  })
  async createBillingNote(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpCreateBillingNoteDto) {
    return this.receivables.createBillingNote(await this.workspace.open(actor, factoryId), body, await perms(this.permissions, actor));
  }

  @Get('billing-notes/:billingNoteId')
  @Op({
    id: 'partner.erpReceivables.getBillingNote',
    summary: 'One billing note',
    description: 'Its invoices as billed (D-365).',
    implements: ['D-365'],
    can: 'factory_receivables.read',
    params: ['billingNoteId'],
    success: { status: 200, description: 'The billing note', type: ErpBillingNoteDto, example: BILLING },
  })
  async getBillingNote(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('billingNoteId', ParseUUIDPipe) billingNoteId: string) {
    return this.receivables.getBillingNote(await this.workspace.open(actor, factoryId), billingNoteId, await perms(this.permissions, actor));
  }

  @Post('billing-notes/:billingNoteId/actions/cancel')
  @Op({
    id: 'partner.erpReceivables.cancelBillingNote',
    summary: 'Cancel a billing note',
    description: 'With a reason (D-365).',
    implements: ['D-365'],
    can: 'factory_receivables.manage',
    params: ['billingNoteId'],
    idempotent: true,
    status: 200,
    body: { type: ReasonDto, example: { reason: 'วางบิลใหม่รวมใบแจ้งหนี้งวดถัดไป' } },
    success: { status: 200, description: 'Cancelled', type: ErpBillingNoteDto, example: { ...BILLING, status: 'cancelled' } },
    errors: [...WRITE, 'erp.invalid_status'],
  })
  async cancelBillingNote(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('billingNoteId', ParseUUIDPipe) billingNoteId: string,
    @Body() body: ReasonDto,
  ) {
    return this.receivables.cancelBillingNote(await this.workspace.open(actor, factoryId), billingNoteId, body.reason, await perms(this.permissions, actor));
  }

  @Get('billing-notes/:billingNoteId/pdf')
  @Op({
    id: 'partner.erpReceivables.billingNotePdf',
    summary: 'The billing note as a PDF',
    description: 'A short-lived link (D-368).',
    implements: ['D-368'],
    can: 'factory_receivables.read',
    params: ['billingNoteId'],
    success: { status: 200, description: 'The link', type: ErpPdfLinkDto, example: { ...PDF_LINK, fileName: 'BN-2610-0001.pdf' } },
  })
  async billingNotePdf(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('billingNoteId', ParseUUIDPipe) billingNoteId: string) {
    return this.pdfs.pdf(await this.workspace.open(actor, factoryId), 'billing_note', billingNoteId);
  }

  @Get('receivables/aging')
  @Op({
    id: 'partner.erpReceivables.aging',
    summary: 'What customers owe, by age',
    description: 'Open invoices per customer: not due, 1–30, 31–60, 61–90, over 90 days past due; refunds due (D-365).',
    implements: ['D-365'],
    can: 'factory_receivables.read',
    success: { status: 200, description: 'The aging', type: ErpArAgingDto, example: AGING },
  })
  async aging(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.receivables.aging(await this.workspace.open(actor, factoryId));
  }
}

// ======================================================================= withholding tax, tax reports

@ApiSurface('partner', 'erpTax')
@Controller('factories/:factoryId/erp')
export class PartnerErpTaxController {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly tax: ErpTaxService,
    private readonly pdfs: ErpPdfService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get('supplier-payments/:paymentId/wht')
  @Op({
    id: 'partner.erpTax.whtSuggestion',
    summary: 'The 50 ทวิ a supplier payment calls for',
    description: 'Its share of each paid invoice’s WHT, one line per rate, the return (ภ.ง.ด.3 / 53) and the certificate in force (D-366).',
    implements: ['D-366'],
    can: 'factory_ap.read',
    params: ['paymentId'],
    success: {
      status: 200,
      description: 'The suggestion',
      type: ErpWhtSuggestionDto,
      example: { payment: CERT.payment, supplier: CERT.supplier, entityType: 'juristic', form: 'pnd53', paidOn: '2026-10-31', lines: [WHT_LINE], certificate: null },
    },
    errors: ['http.not_found', 'erp.no_withholding'],
  })
  async suggestion(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('paymentId', ParseUUIDPipe) paymentId: string) {
    return this.tax.suggest(await this.workspace.open(actor, factoryId), paymentId);
  }

  @Get('wht-certificates')
  @Op({
    id: 'partner.erpTax.listCertificates',
    summary: '50 ทวิ certificates issued',
    description: 'Newest first; by month, return or supplier (D-366).',
    implements: ['D-366'],
    can: 'factory_ap.read',
    paginated: { type: ErpWhtCertificateDto, example: [CERT] },
    errors: ['http.not_found', 'validation.failed'],
  })
  async listCertificates(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpWhtCertificateListQuery) {
    return this.tax.listCertificates(await this.workspace.open(actor, factoryId), q, await perms(this.permissions, actor));
  }

  @Post('wht-certificates')
  @Op({
    id: 'partner.erpTax.createCertificate',
    summary: 'Issue a 50 ทวิ',
    description: '`WHT-YYMM-NNNN` for a supplier payment that withheld tax; one in force per payment (D-366).',
    implements: ['D-366'],
    can: 'factory_ap.manage',
    idempotent: true,
    body: { type: ErpCreateWhtCertificateDto, example: { paymentId: E4_IDS.payment, lines: [{ incomeType: 'hire_of_work', ratePct: '3', baseAmount: '20000', whtAmount: '600' }] } },
    success: { status: 201, description: 'Issued', type: ErpWhtCertificateDto, example: CERT },
    errors: [...WRITE, 'erp.no_withholding', 'erp.invalid_status'],
  })
  async createCertificate(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpCreateWhtCertificateDto) {
    return this.tax.createCertificate(await this.workspace.open(actor, factoryId), body, await perms(this.permissions, actor));
  }

  @Get('wht-certificates/:certificateId')
  @Op({
    id: 'partner.erpTax.getCertificate',
    summary: 'One 50 ทวิ',
    description: 'Payer, payee, the income lines and the tax (D-366).',
    implements: ['D-366'],
    can: 'factory_ap.read',
    params: ['certificateId'],
    success: { status: 200, description: 'The certificate', type: ErpWhtCertificateDto, example: CERT },
  })
  async getCertificate(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('certificateId', ParseUUIDPipe) certificateId: string) {
    return this.tax.getCertificate(await this.workspace.open(actor, factoryId), certificateId, await perms(this.permissions, actor));
  }

  @Post('wht-certificates/:certificateId/actions/void')
  @Op({
    id: 'partner.erpTax.voidCertificate',
    summary: 'Void a 50 ทวิ',
    description: 'With a reason; a new one may then be issued for the payment (D-366).',
    implements: ['D-366'],
    can: 'factory_ap.manage',
    params: ['certificateId'],
    idempotent: true,
    status: 200,
    body: { type: ErpVoidDto, example: { reason: 'ประเภทเงินได้ผิด' } },
    success: { status: 200, description: 'Voided', type: ErpWhtCertificateDto, example: { ...CERT, status: 'voided', voidReason: 'ประเภทเงินได้ผิด', nextActions: [ACTION('erp_wht.pdf')] } },
    errors: [...WRITE, 'erp.invalid_status'],
  })
  async voidCertificate(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('certificateId', ParseUUIDPipe) certificateId: string,
    @Body() body: ErpVoidDto,
  ) {
    return this.tax.voidCertificate(await this.workspace.open(actor, factoryId), certificateId, body.reason, await perms(this.permissions, actor));
  }

  @Get('wht-certificates/:certificateId/pdf')
  @Op({
    id: 'partner.erpTax.certificatePdf',
    summary: 'The 50 ทวิ as a PDF',
    description: 'Copies 1 and 2 in the Revenue Department layout; a short-lived link (D-368).',
    implements: ['D-366', 'D-368'],
    can: 'factory_ap.read',
    params: ['certificateId'],
    success: { status: 200, description: 'The link', type: ErpPdfLinkDto, example: { ...PDF_LINK, fileName: 'WHT-2610-0001.pdf' } },
  })
  async certificatePdf(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Param('certificateId', ParseUUIDPipe) certificateId: string) {
    return this.pdfs.pdf(await this.workspace.open(actor, factoryId), 'wht_certificate', certificateId);
  }

  @Get('tax/sales-vat')
  @Op({
    id: 'partner.erpTax.salesVat',
    summary: 'Sales tax report (รายงานภาษีขาย)',
    description: 'The month’s tax invoices and credit / debit notes in date and number order; voided ones with no value (D-367).',
    implements: ['D-367'],
    can: 'factory_tax.read',
    success: { status: 200, description: 'The report', type: ErpVatReportDto, example: VAT_REPORT },
    errors: ['http.not_found', 'validation.failed'],
  })
  async salesVat(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpMonthQuery) {
    return this.tax.salesVat(await this.workspace.open(actor, factoryId), q.month);
  }

  @Get('tax/purchase-vat')
  @Op({
    id: 'partner.erpTax.purchaseVat',
    summary: 'Purchase tax report (รายงานภาษีซื้อ)',
    description: 'Supplier tax invoices dated in the month, not cancelled (D-367).',
    implements: ['D-367'],
    can: 'factory_tax.read',
    success: { status: 200, description: 'The report', type: ErpVatReportDto, example: { ...VAT_REPORT, kind: 'purchase' } },
    errors: ['http.not_found', 'validation.failed'],
  })
  async purchaseVat(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpMonthQuery) {
    return this.tax.purchaseVat(await this.workspace.open(actor, factoryId), q.month);
  }

  @Get('tax/vat30')
  @Op({
    id: 'partner.erpTax.vat30',
    summary: 'ภ.พ.30 summary',
    description: 'Output VAT, input VAT and what is payable or carried forward for the month, with the due date (D-367).',
    implements: ['D-367'],
    can: 'factory_tax.read',
    success: {
      status: 200,
      description: 'The summary',
      type: ErpVat30Dto,
      example: { month: '2026-10', vatRegistered: true, salesNet: '25000.00', outputVat: '1750.00', purchaseNet: '12000.00', inputVat: '840.00', vatPayable: '910.00', dueOn: '2026-11-15' },
    },
    errors: ['http.not_found', 'validation.failed'],
  })
  async vat30(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpMonthQuery) {
    return this.tax.vat30(await this.workspace.open(actor, factoryId), q.month);
  }

  @Get('tax/wht')
  @Op({
    id: 'partner.erpTax.wht',
    summary: 'ภ.ง.ด.3 / ภ.ง.ด.53 lines',
    description: 'From the certificates issued for payments in the month, not voided (D-367).',
    implements: ['D-366', 'D-367'],
    can: 'factory_tax.read',
    success: {
      status: 200,
      description: 'The lines',
      type: ErpWhtReportDto,
      example: {
        month: '2026-10',
        form: 'pnd53',
        rows: [{ certNo: 'WHT-2610-0001', paidOn: '2026-10-31', payeeName: 'บจก. กระดาษไทย (ทดสอบ)', payeeTaxId: '0000555123457', payeeBranch: '00000', payeeAddress: 'กรุงเทพฯ', incomeType: 'hire_of_work', ratePct: '3.0000', baseAmount: '20000.00', whtAmount: '600.00' }],
        baseAmount: '20000.00',
        whtAmount: '600.00',
        dueOn: '2026-11-07',
      },
    },
    errors: ['http.not_found', 'validation.failed'],
  })
  async wht(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpWhtReportQuery) {
    return this.tax.wht(await this.workspace.open(actor, factoryId), q.month, q.form === 'pnd3' ? 'pnd3' : 'pnd53');
  }

  @Post('tax/exports')
  @Op({
    id: 'partner.erpTax.export',
    summary: 'Export a tax report or the accounting journal',
    description: 'CSV (UTF-8 with BOM) or XLSX of the month, stored for the factory, behind a short-lived link (D-367).',
    implements: ['D-367'],
    can: 'factory_tax.read',
    status: 200,
    body: { type: ErpTaxExportDto, example: { report: 'sales_vat', month: '2026-10', format: 'csv' } },
    success: { status: 200, description: 'The file', type: ErpTaxExportResultDto, example: { ...PDF_LINK, fileName: 'sales_vat-2026-10.csv', rows: 12 } },
    errors: WRITE,
  })
  async export(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpTaxExportDto) {
    return this.tax.export(await this.workspace.open(actor, factoryId), body);
  }

  @Get('sales/report')
  @Op({
    id: 'partner.erpTax.salesReport',
    summary: 'Sales by salesperson',
    description: 'Net invoiced, collected, target, achievement and commission for the month; gross profit over delivered stock cost (D-369).',
    implements: ['D-369'],
    can: 'factory_sales.read',
    success: { status: 200, description: 'The report', type: ErpSalesReportDto, example: SALES_REPORT },
    errors: ['http.not_found', 'validation.failed'],
  })
  async salesReport(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Query() q: ErpMonthQuery) {
    return this.tax.salesReport(await this.workspace.open(actor, factoryId), q.month);
  }

  @Put('sales/targets')
  @Op({
    id: 'partner.erpTax.saveTarget',
    summary: 'Set a salesperson’s monthly target',
    description: 'Net sales target and commission rate; returns the month’s report (D-369).',
    implements: ['D-369'],
    can: 'factory_sales.approve',
    body: { type: ErpSaveSalesTargetDto, example: { salespersonId: E4_IDS.salesperson, month: '2026-10', targetNet: '300000', commissionPct: '2' } },
    success: { status: 200, description: 'Saved', type: ErpSalesReportDto, example: SALES_REPORT },
    errors: WRITE,
  })
  async saveTarget(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string, @Body() body: ErpSaveSalesTargetDto) {
    return this.tax.saveTarget(await this.workspace.open(actor, factoryId), body);
  }
}

export type { ErpPdfKind };
