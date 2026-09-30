import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { CompaniesService } from '@modules/companies/companies.service';
import { CustomersService } from '@modules/customers/customers.service';
import { dateOnly } from '@modules/ledger/ledger-dates';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { DownloadUrlDto } from '@platform/files/files.dto';

import { CreditNotesService } from './credit-notes.service';
import { CustomerDocumentsService } from './customer-documents.service';
import { DocumentFilesService } from './document-files.service';
import {
  AGING_EXAMPLE,
  AgingQuery,
  AgingReportDto,
  CERT_EXAMPLE,
  CN_REQUEST_EXAMPLE,
  CompanyStatementDto,
  CreditNoteRequestDto,
  CreditNoteRequestListQuery,
  CustomerDocumentDto,
  DOCUMENT_EXAMPLE,
  DocumentListQuery,
  IssueDebitNoteDto,
  ITEM_EXAMPLE,
  ProvisionDto,
  ProvisionResultDto,
  ReasonDto,
  ReceivableItemDto,
  ReceivableListQuery,
  RecordWhtCertificateDto,
  RequestCreditNoteDto,
  STATEMENT_EXAMPLE,
  StatementQuery,
  STORE_CREDIT_EXAMPLE,
  StoreCreditDto,
  StoreDocumentListQuery,
  WhtCertificateDto,
  WhtCertificateListQuery,
} from './receivables.dto';
import { ReceivablesService } from './receivables.service';
import {
  agingDto,
  certDto,
  documentDto,
  itemDto,
  requestDto,
  statementDto,
  storeCreditDto,
} from './receivables-views';
import { StoreCreditService } from './store-credit.service';
import { WhtCertificatesService } from './wht-certificates.service';

const DOCS = ['D-010', 'D-092', 'D-033'];
const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;
const DOWNLOAD_EXAMPLE = {
  url: 'https://packio-files.s3.example.com/…&X-Amz-Expires=300',
  expiresAt: '2026-10-05T10:05:00+07:00',
};

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

const download = (d: { url: string; expiresAt: Date }): DownloadUrlDto => ({
  url: d.url,
  expiresAt: toBangkokIso(d.expiresAt),
});

@ApiSurface('admin', 'customerDocuments')
@Controller()
export class AdminCustomerDocumentsController {
  constructor(
    private readonly documents: CustomerDocumentsService,
    private readonly files: DocumentFilesService,
    private readonly creditNotes: CreditNotesService,
  ) {}

  @Get('customer-documents')
  @Can('receivables.read')
  @ApiEndpoint({
    id: 'admin.customerDocuments.list',
    summary: 'List customer documents',
    description:
      'IV, TR, RC, CN and DN issued by the entity under the Packio brand (D-010, D-092), newest first; filter by type, status, order, customer, company and date.',
    implements: DOCS,
  })
  @ApiPaginated(CustomerDocumentDto, { example: DOCUMENT_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: DocumentListQuery) {
    const where: Prisma.CustomerDocumentWhereInput = {
      ...(q.docType && { docType: q.docType }),
      ...(q.status && { status: q.status }),
      ...(q.orderId && { order: { publicId: q.orderId } }),
      ...(q.customerId && { customer: { publicId: q.customerId } }),
      ...(q.companyId && { company: { publicId: q.companyId } }),
      ...((q.from || q.to) && {
        documentDate: { ...(q.from && { gte: dateOnly(q.from) }), ...(q.to && { lte: dateOnly(q.to) }) },
      }),
      ...(q.q && { docNumber: { contains: q.q } }),
    };
    const { rows, total } = await this.documents.list(where, q.page, q.perPage);
    return { data: rows.map(documentDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('customer-documents/:documentId')
  @Can('receivables.read')
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.customerDocuments.get',
    summary: 'Get a customer document',
    description:
      'With its lines, the document it refers to, its open receivable and whether its PDF is ready.',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Document', type: CustomerDocumentDto, example: DOCUMENT_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('documentId', ParseUUIDPipe) documentId: string): Promise<CustomerDocumentDto> {
    return documentDto(await this.documents.get(documentId));
  }

  @Get('customer-documents/:documentId/pdf')
  @Can('receivables.read')
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.customerDocuments.pdf',
    summary: 'Download a customer document',
    description:
      'A short-lived signed URL of the PDF (Thai, Buddhist-era dates, amount in words; tax invoices carry the e-Tax XML inside, D-091). `file.not_ready` while it renders.',
    implements: [...DOCS, 'D-091'],
  })
  @ApiSuccess(200, { description: 'Signed URL', type: DownloadUrlDto, example: DOWNLOAD_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'file.not_ready')
  async pdf(@Param('documentId', ParseUUIDPipe) documentId: string): Promise<DownloadUrlDto> {
    const doc = await this.documents.get(documentId);
    return download(await this.files.downloadUrl(doc.pdfFileId));
  }

  @Post('customer-documents/:documentId/actions/void')
  @HttpCode(200)
  @Can('receivables.manage')
  @Idempotent()
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.customerDocuments.void',
    summary: 'Void an invoice or a debit note',
    description:
      'Only an IV or DN nothing was collected on: its number stays with the reason and its journals are reversed (§4). Tax invoices and receipts are corrected by credit notes. Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({ type: ReasonDto, examples: { default: { value: { reason: 'ออกผิดลูกค้า' } } } })
  @ApiSuccess(200, {
    description: 'Voided document',
    type: CustomerDocumentDto,
    example: { ...DOCUMENT_EXAMPLE, docType: 'iv', status: 'void', voidReason: 'ออกผิดลูกค้า' },
  })
  @ApiStandardErrors(...WRITE, 'receivables.document_not_voidable')
  async void(
    @CurrentActor() actor: Actor,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() body: ReasonDto,
  ): Promise<CustomerDocumentDto> {
    return documentDto(await this.documents.void(staff(actor), documentId, body.reason));
  }

  @Post('orders/:orderId/debit-notes')
  @Can('receivables.debit_notes.issue')
  @Idempotent()
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.customerDocuments.issueDebitNote',
    summary: 'Issue a debit note',
    description:
      'A debit note (ใบเพิ่มหนี้) against the order’s delivery document, with a reason from the controlled list; VAT at the invoice’s rate; collected like an invoice (§2, P07D). Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({
    type: IssueDebitNoteDto,
    examples: {
      default: { value: { net: '500.00', reasonCode: 'additional_charge', note: 'ค่าบริการเพิ่มเติม' } },
    },
  })
  @ApiSuccess(201, {
    description: 'Debit note',
    type: CustomerDocumentDto,
    example: { ...DOCUMENT_EXAMPLE, docType: 'dn', docKind: 'debit_note', amountDue: '535.00' },
  })
  @ApiStandardErrors(
    ...WRITE,
    'receivables.reason_invalid',
    'receivables.document_not_voidable',
    'numbering.series_missing',
  )
  async debitNote(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: IssueDebitNoteDto,
  ): Promise<CustomerDocumentDto> {
    const doc = await this.creditNotes.issueDebitNote(staff(actor), orderId, body);
    return documentDto(await this.documents.get(doc.publicId));
  }

  @Post('orders/:orderId/credit-notes')
  @Can('credit_notes.request')
  @Idempotent()
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.customerDocuments.requestCreditNote',
    summary: 'Request a credit note',
    description:
      'Price reduction, return, discount after sale or a claim credit, against the order’s tax invoice with a statutory reason. Issued only when a Finance Manager other than the requester approves it (policy `credit_note`, §8, D-169); never more than was invoiced or paid, less earlier credits. Requires `Idempotency-Key`.',
    implements: [...DOCS, 'D-169'],
  })
  @ApiBody({
    type: RequestCreditNoteDto,
    examples: {
      default: { value: { amount: '535.00', cnKind: 'price_reduction', note: 'ลดราคาตามข้อตกลงกับลูกค้า' } },
    },
  })
  @ApiSuccess(201, {
    description: 'Request awaiting approval',
    type: CreditNoteRequestDto,
    example: CN_REQUEST_EXAMPLE,
  })
  @ApiStandardErrors(...WRITE, 'receivables.reason_invalid', 'approval.no_matching_step')
  async requestCredit(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: RequestCreditNoteDto,
  ): Promise<CreditNoteRequestDto> {
    return requestDto(await this.creditNotes.request(staff(actor), orderId, body));
  }

  @Get('credit-note-requests')
  @Can('receivables.read')
  @ApiEndpoint({
    id: 'admin.customerDocuments.listCreditRequests',
    summary: 'List credit-note requests',
    description: 'Requests with their approval and the credit note issued (§8 maker-checker).',
    implements: [...DOCS, 'D-169'],
  })
  @ApiPaginated(CreditNoteRequestDto, { example: CN_REQUEST_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async creditRequests(@Query() q: CreditNoteRequestListQuery) {
    const { rows, total } = await this.creditNotes.listRequests(q.status, q.page, q.perPage);
    return { data: rows.map(requestDto), meta: { page: q.page, perPage: q.perPage, total } };
  }
}

@ApiSurface('admin', 'receivables')
@Controller()
export class AdminReceivablesController {
  constructor(
    private readonly receivables: ReceivablesService,
    private readonly certs: WhtCertificatesService,
    private readonly storeCredit: StoreCreditService,
    private readonly customers: CustomersService,
    private readonly files: DocumentFilesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('receivables')
  @Can('receivables.read')
  @ApiEndpoint({
    id: 'admin.receivables.list',
    summary: 'List receivables',
    description:
      'AR open items by due date: invoices and final tax invoices with a remainder, debit notes (§6).',
    implements: ['D-033', 'D-121'],
  })
  @ApiPaginated(ReceivableItemDto, { example: ITEM_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: ReceivableListQuery) {
    const where: Prisma.ReceivableItemWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.companyId && { company: { publicId: q.companyId } }),
      ...(q.customerId && { customer: { publicId: q.customerId } }),
      ...(q.overdue === true && {
        status: { in: ['open', 'partially_paid'] },
        dueDate: { lt: dateOnly(bangkokDate(new Date())) },
      }),
    };
    const { rows, total } = await this.receivables.items(where, q.page, q.perPage);
    return { data: rows.map(itemDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('receivables/aging')
  @Can('receivables.read')
  @ApiEndpoint({
    id: 'admin.receivables.aging',
    summary: 'Receivables aging',
    description:
      'Open receivables per customer / company in buckets of days past due (current, 1–30, 31–60, 61–90, over 90) at a date (§6).',
    implements: ['D-033'],
  })
  @ApiSuccess(200, { description: 'Aging report', type: AgingReportDto, example: AGING_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async aging(@Query() q: AgingQuery): Promise<AgingReportDto> {
    const company = q.companyId
      ? await this.prisma.company.findUnique({ where: { publicId: q.companyId } })
      : null;
    return agingDto(await this.receivables.aging(q.asOf ?? bangkokDate(new Date()), company?.id));
  }

  @Post('receivables/:itemId/actions/request-write-off')
  @HttpCode(200)
  @Can('receivables.write_off.request')
  @Idempotent()
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.receivables.requestWriteOff',
    summary: 'Request a bad-debt write-off',
    description:
      'Routes the open amount to a Finance Manager other than the requester (policy `write_off`, §8, D-169); the approval writes it off against the allowance (P30). Requires `Idempotency-Key`.',
    implements: ['D-033', 'D-169'],
  })
  @ApiBody({ type: ReasonDto, examples: { default: { value: { reason: 'ลูกค้าปิดกิจการ ติดตามไม่ได้' } } } })
  @ApiSuccess(200, {
    description: 'Item with its write-off request',
    type: ReceivableItemDto,
    example: { ...ITEM_EXAMPLE, writeOffApprovalId: '0192f3a0-7c1e-7d2a-9b1f-000000520008' },
  })
  @ApiStandardErrors(...WRITE, 'receivables.nothing_to_write_off', 'approval.no_matching_step')
  async writeOff(
    @CurrentActor() actor: Actor,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: ReasonDto,
  ) {
    return itemDto(await this.receivables.requestWriteOff(staff(actor), itemId, body.reason));
  }

  @Post('receivables/allowance')
  @HttpCode(200)
  @Can('receivables.manage')
  @Idempotent()
  @ApiEndpoint({
    id: 'admin.receivables.provision',
    summary: 'Update the allowance for doubtful accounts',
    description:
      'Brings the allowance to its target at a date: from the ⚖ setting `receivables.allowance_rates` (% per days-overdue band) when set, otherwise the amount Finance enters; posts the change (P30). Requires `Idempotency-Key`.',
    implements: ['D-033'],
  })
  @ApiBody({
    type: ProvisionDto,
    examples: { default: { value: { asOf: '2026-12-31', amount: '1000.00' } } },
  })
  @ApiSuccess(200, {
    description: 'Allowance update',
    type: ProvisionResultDto,
    example: {
      id: '0192f3a0-7c1e-7d2a-9b1f-000000520007',
      method: 'manual',
      targetAmount: '1000.00',
      amount: '1000.00',
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'receivables.allowance_rates_unset',
  )
  async provision(@CurrentActor() actor: Actor, @Body() body: ProvisionDto): Promise<ProvisionResultDto> {
    const row = await this.receivables.provision(staff(actor), body);
    return {
      id: row.publicId,
      method: row.method,
      targetAmount: row.targetAmount.toFixed(2),
      amount: row.amount.toFixed(2),
    };
  }

  @Get('customer-wht-certificates')
  @Can('receivables.read')
  @ApiEndpoint({
    id: 'admin.receivables.whtCertificates',
    summary: 'List customer withholding certificates',
    description:
      '50 ทวิ to collect for every receipt the customer withheld on (§2); `status=pending` with `olderThanDays` is the missing-certificate report.',
    implements: ['D-033', 'D-174'],
  })
  @ApiPaginated(WhtCertificateDto, { example: CERT_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async certificates(@Query() q: WhtCertificateListQuery) {
    const { rows, total } = await this.certs.list(
      { status: q.status, olderThanDays: q.olderThanDays },
      q.page,
      q.perPage,
    );
    return { data: rows.map(certDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Post('customer-wht-certificates/:certificateId/actions/record')
  @HttpCode(200)
  @Can('receivables.manage')
  @ApiParam({ name: 'certificateId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.receivables.recordWhtCertificate',
    summary: 'Record a received 50 ทวิ',
    description: 'Certificate number and date, with the uploaded copy kept as a financial record (audited).',
    implements: ['D-033'],
  })
  @ApiBody({
    type: RecordWhtCertificateDto,
    examples: { default: { value: { certificateNo: 'WT-0001', certificateDate: '2026-10-10' } } },
  })
  @ApiSuccess(200, {
    description: 'Certificate',
    type: WhtCertificateDto,
    example: { ...CERT_EXAMPLE, status: 'received', certificateNo: 'WT-0001', certificateDate: '2026-10-10' },
  })
  @ApiStandardErrors(...WRITE, 'receivables.certificate_invalid', 'file.not_ready')
  async record(
    @CurrentActor() actor: Actor,
    @Param('certificateId', ParseUUIDPipe) id: string,
    @Body() body: RecordWhtCertificateDto,
  ) {
    return certDto(await this.certs.record(staff(actor), id, body));
  }

  @Post('customer-wht-certificates/:certificateId/actions/waive')
  @HttpCode(200)
  @Can('receivables.manage')
  @ApiParam({ name: 'certificateId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.receivables.waiveWhtCertificate',
    summary: 'Stop chasing a 50 ทวิ',
    description: 'Closes a pending certificate with a reason (audited).',
    implements: ['D-033'],
  })
  @ApiBody({
    type: ReasonDto,
    examples: { default: { value: { reason: 'ลูกค้ายืนยันไม่ได้หักภาษี คืนเงินส่วนต่างแล้ว' } } },
  })
  @ApiSuccess(200, {
    description: 'Certificate',
    type: WhtCertificateDto,
    example: { ...CERT_EXAMPLE, status: 'waived' },
  })
  @ApiStandardErrors(...WRITE, 'receivables.certificate_invalid')
  async waive(
    @CurrentActor() actor: Actor,
    @Param('certificateId', ParseUUIDPipe) id: string,
    @Body() body: ReasonDto,
  ) {
    return certDto(await this.certs.waive(staff(actor), id, body.reason));
  }

  @Get('customers/:customerId/store-credit')
  @Can('receivables.read')
  @ApiParam({ name: 'customerId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.receivables.storeCredit',
    summary: 'A customer’s credit balance',
    description:
      'The store-credit wallet (customer credit balances, 2320): credit notes settled to it, refunds and uses.',
    implements: ['D-021', 'D-033'],
  })
  @ApiSuccess(200, {
    description: 'Balance and movements',
    type: StoreCreditDto,
    example: STORE_CREDIT_EXAMPLE,
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async storeCreditOf(@Param('customerId', ParseUUIDPipe) customerId: string): Promise<StoreCreditDto> {
    return storeCreditDto(this.storeCredit, await this.customers.customerIdOf(customerId));
  }

  @Get('companies/:companyId/statements')
  @Can('receivables.read')
  @ApiParam({ name: 'companyId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.receivables.companyStatement',
    summary: 'A company’s monthly statement',
    description:
      'Opening, invoiced, paid, credited and closing balance of the month from the receivables, with its PDF (D-125); generated on first request.',
    implements: ['D-125'],
  })
  @ApiSuccess(200, { description: 'Statement', type: CompanyStatementDto, example: STATEMENT_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async statement(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() q: StatementQuery,
  ): Promise<CompanyStatementDto> {
    const company = await this.prisma.company.findUnique({ where: { publicId: companyId } });
    if (!company) throw new DomainException('http.not_found');
    return statementDto(await this.prisma.withTx((tx) => this.files.statement(tx, company.id, q.month)));
  }
}

@ApiSurface('store', 'documents')
@Controller()
export class StoreDocumentsController {
  constructor(
    private readonly documents: CustomerDocumentsService,
    private readonly files: DocumentFilesService,
    private readonly storeCredit: StoreCreditService,
    private readonly companies: CompaniesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('documents')
  @ApiEndpoint({
    id: 'store.documents.list',
    summary: 'My tax invoices, receipts and notes',
    description:
      'Documents issued to me by the entity under the Packio brand (D-010), or with `companyId` those of a company I may read documents of (`company_documents.read`, D-125); `orderId` narrows them to one order.',
    implements: ['D-010', 'D-125'],
  })
  @ApiPaginated(CustomerDocumentDto, { example: DOCUMENT_EXAMPLE })
  @ApiStandardErrors('validation.failed', 'http.not_found')
  async list(@CurrentActor() actor: Actor, @Query() q: StoreDocumentListQuery) {
    const me = customer(actor);
    const company = q.companyId
      ? await this.companies.forMember(me, q.companyId, 'company_documents.read')
      : null;
    const { rows, total } = await this.documents.list(
      {
        ...(company ? { companyId: company.id } : { customerUserId: me.userId }),
        ...(q.orderId && { order: { publicId: q.orderId } }),
      },
      q.page,
      q.perPage,
    );
    return { data: rows.map(documentDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('documents/:documentId/pdf')
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.documents.pdf',
    summary: 'Download my document',
    description:
      'A short-lived signed URL of the PDF; my own documents or my company’s with `company_documents.read`.',
    implements: ['D-010', 'D-125'],
  })
  @ApiSuccess(200, { description: 'Signed URL', type: DownloadUrlDto, example: DOWNLOAD_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'file.not_ready')
  async pdf(
    @CurrentActor() actor: Actor,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<DownloadUrlDto> {
    const doc = await this.readable(customer(actor), documentId);
    return download(await this.files.downloadUrl(doc.pdfFileId));
  }

  @Get('documents/:documentId')
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.documents.get',
    summary: 'Get my document',
    description: 'One of my documents (or my company’s with `company_documents.read`).',
    implements: ['D-010', 'D-125'],
  })
  @ApiSuccess(200, { description: 'Document', type: CustomerDocumentDto, example: DOCUMENT_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<CustomerDocumentDto> {
    return documentDto(await this.readable(customer(actor), documentId));
  }

  @Get('store-credit')
  @ApiEndpoint({
    id: 'store.documents.storeCredit',
    summary: 'My credit balance',
    description:
      'Credits from credit notes (shortages within tolerance D-021, cancellations, claims) and their use or refund.',
    implements: ['D-021', 'D-033'],
  })
  @ApiSuccess(200, {
    description: 'Balance and movements',
    type: StoreCreditDto,
    example: STORE_CREDIT_EXAMPLE,
  })
  @ApiStandardErrors()
  async storeCreditOfMine(@CurrentActor() actor: Actor): Promise<StoreCreditDto> {
    return storeCreditDto(this.storeCredit, customer(actor).userId);
  }

  @Get('companies/:companyId/statements')
  @ApiParam({ name: 'companyId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.documents.companyStatement',
    summary: 'My company’s monthly statement',
    description:
      'For Company Admins and Accountants (`company_documents.read`): the month’s statement for consolidated payment (D-125).',
    implements: ['D-125'],
  })
  @ApiSuccess(200, { description: 'Statement', type: CompanyStatementDto, example: STATEMENT_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async statement(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() q: StatementQuery,
  ): Promise<CompanyStatementDto> {
    const company = await this.companies.forMember(customer(actor), companyId, 'company_documents.read');
    return statementDto(await this.prisma.withTx((tx) => this.files.statement(tx, company.id, q.month)));
  }

  @Get('companies/:companyId/statements/:month/pdf')
  @ApiParam({ name: 'companyId', format: 'uuid' })
  @ApiParam({ name: 'month', example: '2026-10' })
  @ApiEndpoint({
    id: 'store.documents.companyStatementPdf',
    summary: 'Download my company’s statement',
    description: 'A short-lived signed URL of the statement PDF (`company_documents.read`, D-125).',
    implements: ['D-125'],
  })
  @ApiSuccess(200, { description: 'Signed URL', type: DownloadUrlDto, example: DOWNLOAD_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'file.not_ready')
  async statementPdf(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('month') month: string,
  ): Promise<DownloadUrlDto> {
    const company = await this.companies.forMember(customer(actor), companyId, 'company_documents.read');
    if (!/^\d{4}-\d{2}$/.test(month)) throw new DomainException('http.not_found');
    const statement = await this.prisma.companyStatement.findUnique({
      where: { companyId_periodMonth: { companyId: company.id, periodMonth: dateOnly(`${month}-01`) } },
    });
    if (!statement) throw new DomainException('http.not_found');
    return download(await this.files.downloadUrl(statement.fileObjectId));
  }

  private async readable(me: UserActor, documentId: string) {
    const doc = await this.documents.get(documentId);
    if (doc.customerUserId === me.userId) return doc;
    if (doc.company) {
      await this.companies.forMember(me, doc.company.publicId, 'company_documents.read');
      return doc;
    }
    throw new DomainException('http.not_found');
  }
}
