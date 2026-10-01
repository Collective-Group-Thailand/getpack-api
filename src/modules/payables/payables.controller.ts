import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { BankAccountDto, ProposeBankAccountDto } from '@modules/partners/bank-accounts/bank-accounts.dto';
import { BankAccountsService } from '@modules/partners/bank-accounts/bank-accounts.service';
import { staffOrPartner } from '@modules/partners/partner-actor';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  ApListQuery,
  BillingStatementDto,
  BS_EXAMPLE,
  CaptureTaxInvoiceDto,
  CreateVendorDto,
  DisputeStatementDto,
  GoodsReceiptDto,
  GR_EXAMPLE,
  PAYABLE_EXAMPLE,
  PayableDto,
  PayableListQuery,
  PO_EXAMPLE,
  PurchaseOrderDto,
  RecordBillDto,
  StatementListQuery,
  ValidateInvoiceDto,
  VENDOR_EXAMPLE,
  VendorDto,
  VendorInvoiceDto,
  VendorInvoiceListQuery,
  VendorListQuery,
  VI_EXAMPLE,
} from './payables.dto';
import { type BsRow, PayablesQueryService } from './payables-query.service';
import { bsDto, grDto, invoiceDto, payableDto, poDto, vendorDto } from './payables-views';
import { VendorInvoicesService } from './vendor-invoices.service';

const DOCS = ['D-090', 'D-022', 'D-165'];
const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;
const CAPTURE_BODY = {
  vendorInvoiceNo: 'IV2610-0099',
  invoiceDate: '2026-10-21',
  sellerTaxId: '0000000000001',
  sellerBranchCode: '00000',
  netAmount: '7960.00',
  vatAmount: '557.20',
  source: 'pdf_upload',
  fileId: '0192f3a0-7c1e-7d2a-9b1f-0000000a0003',
};
const BANK_EXAMPLE: BankAccountDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-000000000601',
  bankCode: '014',
  branchName: null,
  accountName: 'บริษัท ขนส่งตัวอย่าง จำกัด (fake)',
  accountNoLast4: '0009',
  status: 'pending_approval',
  effectiveFrom: null,
  approvalRequestId: '0192f3a0-7c1e-7d2a-9b1f-000000000602',
  verification: null,
  duplicateOfOtherVendor: false,
  createdAt: '2026-10-01T10:00:00+07:00',
};

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

// =====================================================================================================
// Admin
// =====================================================================================================

/** Statements with the money of their jobs (U-B0.3). */
async function statementViews(query: PayablesQueryService, rows: BsRow[]): Promise<BillingStatementDto[]> {
  const money = await query.statementMoney(rows);
  return rows.map((r) => bsDto(r, money.get(r.id)));
}

@ApiSurface('admin', 'payables')
@Controller()
export class AdminPayablesController {
  constructor(
    private readonly query: PayablesQueryService,
    private readonly invoices: VendorInvoicesService,
    private readonly bankAccounts: BankAccountsService,
  ) {}

  @Get('purchase-orders')
  @Can('payables.read')
  @ApiEndpoint({
    id: 'admin.payables.listPurchaseOrders',
    summary: 'List factory purchase orders',
    description:
      'One PO per released production job at the price and payout policy frozen at release (§6, D-022); newest first.',
    implements: DOCS,
  })
  @ApiPaginated(PurchaseOrderDto, { example: PO_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async purchaseOrders(@CurrentActor() actor: Actor, @Query() q: ApListQuery) {
    const { rows, total } = await this.query.purchaseOrders(actor, q);
    return { data: rows.map(poDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('purchase-orders/:poId')
  @Can('payables.read')
  @ApiParam({ name: 'poId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.payables.getPurchaseOrder',
    summary: 'Get a purchase order',
    description: 'With its lines (§6, D-022).',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Purchase order', type: PurchaseOrderDto, example: PO_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async purchaseOrder(
    @CurrentActor() actor: Actor,
    @Param('poId', ParseUUIDPipe) poId: string,
  ): Promise<PurchaseOrderDto> {
    return poDto(await this.query.purchaseOrder(actor, poId));
  }

  @Get('goods-receipts')
  @Can('payables.read')
  @ApiEndpoint({
    id: 'admin.payables.listGoodsReceipts',
    summary: 'List goods receipts',
    description:
      'Recorded from POD and the reconciled quantity: payable quantity = min(delivered, ordered) (D-165, P15).',
    implements: DOCS,
  })
  @ApiPaginated(GoodsReceiptDto, { example: GR_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async goodsReceipts(@CurrentActor() actor: Actor, @Query() q: ApListQuery) {
    const { rows, total } = await this.query.goodsReceipts(actor, q);
    return { data: rows.map(grDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('billing-statements')
  @Can('payables.read')
  @ApiEndpoint({
    id: 'admin.payables.listStatements',
    summary: 'List factory billing statements',
    description:
      'Generated by Packio for the factory to confirm (ใบวางบิล, D-090); the factory then issues its own tax invoice against it.',
    implements: DOCS,
  })
  @ApiPaginated(BillingStatementDto, { example: BS_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async statements(@CurrentActor() actor: Actor, @Query() q: StatementListQuery) {
    const { rows, total } = await this.query.statements(actor, q);
    return {
      data: await statementViews(this.query, rows),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Get('billing-statements/:statementId')
  @Can('payables.read')
  @ApiParam({ name: 'statementId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.payables.getStatement',
    summary: 'Get a billing statement',
    description: 'With its GR and deduction lines (D-090).',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Billing statement', type: BillingStatementDto, example: BS_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async statement(
    @CurrentActor() actor: Actor,
    @Param('statementId', ParseUUIDPipe) statementId: string,
  ): Promise<BillingStatementDto> {
    return (await statementViews(this.query, [await this.query.statement(actor, statementId)]))[0]!;
  }

  @Post('billing-statements/:statementId/tax-invoices')
  @Can('payables.manage')
  @Idempotent()
  @ApiParam({ name: 'statementId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.payables.captureTaxInvoice',
    summary: 'Capture a factory tax invoice on its behalf',
    description:
      'Finance keys in the factory’s own tax invoice (e-Tax or PDF + number, date, seller tax id and branch) when the factory sent it by other means (D-090). Validated separately. Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({ type: CaptureTaxInvoiceDto, examples: { default: { value: CAPTURE_BODY } } })
  @ApiSuccess(201, { description: 'Captured invoice', type: VendorInvoiceDto, example: VI_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'payables.invoice_duplicate', 'file.not_ready')
  async capture(
    @CurrentActor() actor: Actor,
    @Param('statementId', ParseUUIDPipe) statementId: string,
    @Body() body: CaptureTaxInvoiceDto,
  ): Promise<VendorInvoiceDto> {
    return invoiceDto(await this.invoices.captureFactoryInvoice(staff(actor), statementId, null, body));
  }

  @Get('vendor-invoices')
  @Can('payables.read')
  @ApiEndpoint({
    id: 'admin.payables.listInvoices',
    summary: 'List vendor invoices',
    description:
      'Factory tax invoices captured against statements and bills of other vendors; input VAT status per §2.',
    implements: ['D-090', 'D-033'],
  })
  @ApiPaginated(VendorInvoiceDto, { example: VI_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async invoicesList(@Query() q: VendorInvoiceListQuery) {
    const { rows, total } = await this.invoices.list(
      { ...(q.status && { status: q.status }), ...(q.vendorId && { vendor: { publicId: q.vendorId } }) },
      q.page,
      q.perPage,
    );
    return { data: rows.map(invoiceDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('vendor-invoices/:invoiceId')
  @Can('payables.read')
  @ApiParam({ name: 'invoiceId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.payables.getInvoice',
    summary: 'Get a vendor invoice',
    description: 'With its lines and file (§2).',
    implements: ['D-090'],
  })
  @ApiSuccess(200, { description: 'Vendor invoice', type: VendorInvoiceDto, example: VI_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async invoice(@Param('invoiceId', ParseUUIDPipe) invoiceId: string): Promise<VendorInvoiceDto> {
    return invoiceDto(await this.invoices.get(invoiceId));
  }

  @Post('vendor-invoices/:invoiceId/actions/validate')
  @HttpCode(200)
  @Can('payables.manage')
  @Idempotent()
  @ApiParam({ name: 'invoiceId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.payables.validateInvoice',
    summary: 'Validate or reject a factory tax invoice',
    description:
      'The seller must be the factory (tax id, branch) and the amounts the statement’s. A valid tax invoice makes input VAT claimable: VAT already paid while it was missing moves from pending to input VAT (P17V, §2). Requires `Idempotency-Key`.',
    implements: ['D-090', 'D-033'],
  })
  @ApiBody({
    type: ValidateInvoiceDto,
    examples: {
      valid: { value: { valid: true } },
      reject: { value: { valid: false, reason: 'เลขผู้เสียภาษีไม่ตรง' } },
    },
  })
  @ApiSuccess(200, {
    description: 'Invoice',
    type: VendorInvoiceDto,
    example: { ...VI_EXAMPLE, status: 'validated', inputVatStatus: 'claimable' },
  })
  @ApiStandardErrors(...WRITE, 'payables.invoice_mismatch', 'payables.invoice_duplicate')
  async validate(
    @CurrentActor() actor: Actor,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() body: ValidateInvoiceDto,
  ): Promise<VendorInvoiceDto> {
    if (!body.valid && !body.reason?.trim())
      throw new DomainException('validation.failed', {
        errors: [{ path: 'reason', code: 'required', message: 'a rejection needs a reason' }],
      });
    return invoiceDto(await this.invoices.validateFactoryInvoice(staff(actor), invoiceId, body));
  }

  @Get('payables')
  @Can('payables.read')
  @ApiEndpoint({
    id: 'admin.payables.list',
    summary: 'List payables',
    description:
      'AP open items (net and VAT separately) with the date they become payable under the frozen payout policy (§6, D-022, D-164).',
    implements: ['D-022', 'D-164'],
  })
  @ApiPaginated(PayableDto, { example: PAYABLE_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async payables(@Query() q: PayableListQuery) {
    const { rows, total } = await this.query.payables(q);
    return { data: rows.map(payableDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('vendors')
  @Can('payables.read')
  @ApiEndpoint({
    id: 'admin.payables.listVendors',
    summary: 'List vendors',
    description:
      'Factories (created with the factory) and other vendors — fallback carriers, freelance designers, services (§6).',
    implements: ['D-033'],
  })
  @ApiSuccess(200, { description: 'Vendors', type: [VendorDto], example: [VENDOR_EXAMPLE] })
  @ApiStandardErrors('validation.failed')
  async vendors(@Query() q: VendorListQuery): Promise<VendorDto[]> {
    return (await this.invoices.vendors(q.kind)).map(vendorDto);
  }

  @Post('vendors')
  @Can('payables.vendors.manage')
  @Idempotent()
  @ApiEndpoint({
    id: 'admin.payables.createVendor',
    summary: 'Create a vendor',
    description:
      'A carrier, freelancer or service vendor (factories come from onboarding). Its WHT form follows its juristic type (ภ.ง.ด.3 / 53). Requires `Idempotency-Key`.',
    implements: ['D-033'],
  })
  @ApiBody({
    type: CreateVendorDto,
    examples: {
      default: {
        value: {
          kind: 'carrier',
          legalName: 'บริษัท ขนส่งตัวอย่าง จำกัด (fake)',
          juristicType: 'company',
          taxId: '0000000000002',
          isVatRegistered: true,
          defaultWhtCategory: 'transport',
          paymentTermsDays: 30,
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Vendor', type: VendorDto, example: VENDOR_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed')
  async createVendor(@CurrentActor() actor: Actor, @Body() body: CreateVendorDto): Promise<VendorDto> {
    return vendorDto(await this.invoices.createVendor(staff(actor), body));
  }

  @Post('vendors/:vendorId/bills')
  @Can('payables.bills.record')
  @Idempotent()
  @ApiParam({ name: 'vendorId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.payables.recordBill',
    summary: 'Record a vendor bill',
    description:
      'A bill of a non-factory vendor (P25 / P26): expense, cost or asset lines, input VAT only on a valid tax invoice (§2), payable by the vendor’s terms. Whoever records a vendor’s bills cannot change its bank account (SoD, §8). Requires `Idempotency-Key`.',
    implements: ['D-033', 'D-169'],
  })
  @ApiBody({
    type: RecordBillDto,
    examples: {
      default: {
        value: {
          vendorInvoiceNo: 'FL-2610-0001',
          invoiceDate: '2026-10-21',
          isTaxInvoice: true,
          lines: [
            {
              description: 'ค่าขนส่ง',
              accountCode: '5130',
              netAmount: '100.00',
              vatAmount: '7.00',
              whtCategory: 'transport',
            },
          ],
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Recorded bill',
    type: VendorInvoiceDto,
    example: { ...VI_EXAMPLE, bsNumber: null, source: 'manual', inputVatStatus: 'claimable' },
  })
  @ApiStandardErrors(...WRITE, 'payables.invoice_duplicate', 'iam.sod_conflict', 'file.not_ready')
  async recordBill(
    @CurrentActor() actor: Actor,
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
    @Body() body: RecordBillDto,
  ): Promise<VendorInvoiceDto> {
    return invoiceDto(await this.invoices.recordBill(staff(actor), vendorId, body));
  }

  @Get('vendors/:vendorId/bank-accounts')
  @Can('payables.read')
  @ApiParam({ name: 'vendorId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.payables.listVendorBankAccounts',
    summary: 'List a vendor’s bank accounts',
    description:
      'Only the last 4 digits are returned (PDPA); includes the verification call and the duplicate-account flag (§8).',
    implements: ['D-033', 'D-169'],
  })
  @ApiSuccess(200, { description: 'Bank accounts', type: [BankAccountDto], example: [BANK_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async vendorAccounts(@Param('vendorId', ParseUUIDPipe) vendorId: string): Promise<BankAccountDto[]> {
    return this.bankAccounts.listForVendor(vendorId);
  }

  @Post('vendors/:vendorId/bank-accounts')
  @Can('payables.vendors.manage')
  @Idempotent()
  @ApiParam({ name: 'vendorId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.payables.proposeVendorBankAccount',
    summary: 'Propose a vendor bank account',
    description:
      'Dual approval (Finance → Finance Manager) and a logged verification call before it is used (§8, D-169); never by someone who recorded that vendor’s bills (SoD). The number is stored encrypted, never returned or logged. Requires `Idempotency-Key`.',
    implements: ['D-033', 'D-169'],
  })
  @ApiBody({
    type: ProposeBankAccountDto,
    examples: {
      default: {
        value: {
          bankCode: '014',
          accountName: 'บริษัท ขนส่งตัวอย่าง จำกัด (fake)',
          accountNo: '000-0-00000-9',
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Proposed', type: BankAccountDto, example: BANK_EXAMPLE })
  @ApiStandardErrors(
    ...WRITE,
    'partners.bank_account_pending',
    'approval.already_pending',
    'iam.sod_conflict',
  )
  async proposeVendorAccount(
    @CurrentActor() actor: Actor,
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
    @Body() body: ProposeBankAccountDto,
  ): Promise<BankAccountDto> {
    return this.bankAccounts.proposeForVendor(staff(actor), vendorId, body);
  }
}

// =====================================================================================================
// Partner (factory-scoped: other factories' documents are 404)
// =====================================================================================================

@ApiSurface('partner', 'payables')
@Controller()
export class PartnerPayablesController {
  constructor(
    private readonly query: PayablesQueryService,
    private readonly invoices: VendorInvoicesService,
  ) {}

  @Get('purchase-orders')
  @Can('factory_payables.read')
  @ApiEndpoint({
    id: 'partner.payables.listPurchaseOrders',
    summary: 'List my factory’s purchase orders',
    description: 'POs Packio issued at job release (§6, D-022).',
    implements: DOCS,
  })
  @ApiPaginated(PurchaseOrderDto, { example: PO_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async purchaseOrders(@CurrentActor() actor: Actor, @Query() q: ApListQuery) {
    const { rows, total } = await this.query.purchaseOrders(actor, q);
    return { data: rows.map(poDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('purchase-orders/:poId')
  @Can('factory_payables.read')
  @ApiParam({ name: 'poId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.payables.getPurchaseOrder',
    summary: 'Get one of my purchase orders',
    description: 'With its lines (§6).',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Purchase order', type: PurchaseOrderDto, example: PO_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async purchaseOrder(
    @CurrentActor() actor: Actor,
    @Param('poId', ParseUUIDPipe) poId: string,
  ): Promise<PurchaseOrderDto> {
    return poDto(await this.query.purchaseOrder(actor, poId));
  }

  @Get('goods-receipts')
  @Can('factory_payables.read')
  @ApiEndpoint({
    id: 'partner.payables.listGoodsReceipts',
    summary: 'List my goods receipts',
    description: 'Payable quantity = min(delivered, ordered) (D-165).',
    implements: DOCS,
  })
  @ApiPaginated(GoodsReceiptDto, { example: GR_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async goodsReceipts(@CurrentActor() actor: Actor, @Query() q: ApListQuery) {
    const { rows, total } = await this.query.goodsReceipts(actor, q);
    return { data: rows.map(grDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('billing-statements')
  @Can('factory_payables.read')
  @ApiEndpoint({
    id: 'partner.payables.listStatements',
    summary: 'List my billing statements',
    description: 'Statements to confirm or dispute, then invoice (D-090).',
    implements: DOCS,
  })
  @ApiPaginated(BillingStatementDto, { example: BS_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async statements(@CurrentActor() actor: Actor, @Query() q: StatementListQuery) {
    const { rows, total } = await this.query.statements(actor, q);
    return {
      data: await statementViews(this.query, rows),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Get('billing-statements/:statementId')
  @Can('factory_payables.read')
  @ApiParam({ name: 'statementId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.payables.getStatement',
    summary: 'Get one of my billing statements',
    description: 'With its lines (D-090).',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Billing statement', type: BillingStatementDto, example: BS_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async statement(
    @CurrentActor() actor: Actor,
    @Param('statementId', ParseUUIDPipe) statementId: string,
  ): Promise<BillingStatementDto> {
    return (await statementViews(this.query, [await this.query.statement(actor, statementId)]))[0]!;
  }

  @Post('billing-statements/:statementId/actions/confirm')
  @HttpCode(200)
  @Can('factory_payables.manage')
  @Idempotent()
  @ApiParam({ name: 'statementId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.payables.confirmStatement',
    summary: 'Confirm a billing statement',
    description:
      'The factory agrees with the statement and will issue its own tax invoice for these amounts (D-090). Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiSuccess(200, {
    description: 'Statement',
    type: BillingStatementDto,
    example: { ...BS_EXAMPLE, status: 'confirmed', confirmedAt: '2026-10-21T09:00:00+07:00' },
  })
  @ApiStandardErrors(...WRITE, 'payables.statement_not_confirmable')
  async confirm(
    @CurrentActor() actor: Actor,
    @Param('statementId', ParseUUIDPipe) statementId: string,
  ): Promise<BillingStatementDto> {
    const row = await this.query.statement(actor, statementId);
    await this.invoices.decideStatement(staffOrPartner(actor), statementId, row.factoryId, { confirm: true });
    return (await statementViews(this.query, [await this.query.statement(actor, statementId)]))[0]!;
  }

  @Post('billing-statements/:statementId/actions/dispute')
  @HttpCode(200)
  @Can('factory_payables.manage')
  @Idempotent()
  @ApiParam({ name: 'statementId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.payables.disputeStatement',
    summary: 'Dispute a billing statement',
    description:
      'With a note Packio Finance resolves; the statement can be confirmed afterwards (D-090). Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({
    type: DisputeStatementDto,
    examples: { default: { value: { note: 'ยอดขนส่งไม่ตรงกับใบส่งของ' } } },
  })
  @ApiSuccess(200, {
    description: 'Statement',
    type: BillingStatementDto,
    example: { ...BS_EXAMPLE, status: 'disputed', disputeNote: 'ยอดขนส่งไม่ตรงกับใบส่งของ' },
  })
  @ApiStandardErrors(...WRITE, 'payables.statement_not_confirmable')
  async dispute(
    @CurrentActor() actor: Actor,
    @Param('statementId', ParseUUIDPipe) statementId: string,
    @Body() body: DisputeStatementDto,
  ): Promise<BillingStatementDto> {
    const row = await this.query.statement(actor, statementId);
    await this.invoices.decideStatement(staffOrPartner(actor), statementId, row.factoryId, {
      confirm: false,
      note: body.note,
      ...(body.lineNos && { lineNos: body.lineNos }),
    });
    return (await statementViews(this.query, [await this.query.statement(actor, statementId)]))[0]!;
  }

  @Post('billing-statements/:statementId/tax-invoices')
  @Can('factory_payables.manage')
  @Idempotent()
  @ApiParam({ name: 'statementId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.payables.submitTaxInvoice',
    summary: 'Submit my tax invoice for a statement',
    description:
      'The factory’s own tax invoice (its number, its name — Packio never issues it): e-Tax file or PDF upload + number, date, seller tax id and branch. Packio Finance validates it; input VAT is claimed only then (§2, D-090). Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({ type: CaptureTaxInvoiceDto, examples: { default: { value: CAPTURE_BODY } } })
  @ApiSuccess(201, { description: 'Submitted invoice', type: VendorInvoiceDto, example: VI_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'payables.invoice_duplicate', 'file.not_ready')
  async submitInvoice(
    @CurrentActor() actor: Actor,
    @Param('statementId', ParseUUIDPipe) statementId: string,
    @Body() body: CaptureTaxInvoiceDto,
  ): Promise<VendorInvoiceDto> {
    const row = await this.query.statement(actor, statementId);
    return invoiceDto(
      await this.invoices.captureFactoryInvoice(staffOrPartner(actor), statementId, row.factoryId, body),
    );
  }
}
