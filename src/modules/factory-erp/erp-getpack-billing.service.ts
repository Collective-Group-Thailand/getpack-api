import { DomainException } from '@common/errors/domain.exception';
import { type ErpTx } from '@database/erp-prisma.service';
import { PrismaService } from '@database/prisma.service';
import { type ErpTradingPartner } from '@generated/prisma-erp/client';
import { invoiceDto as vendorInvoiceDto } from '@modules/payables/payables-views';
import { VendorInvoicesService } from '@modules/payables/vendor-invoices.service';
import { CustomerDocumentsService } from '@modules/receivables/customer-documents.service';
import { Injectable } from '@nestjs/common';

import { dec, fmtMoney } from './erp.math';
import { ErpPdfService } from './erp-pdf.service';
import { ErpReceivablesService } from './erp-receivables.service';
import { iso } from './erp-sales.shared';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

const notAllowed = (reason: string) =>
  new DomainException('payables.erp_invoice_not_allowed', { params: { reason } });

/**
 * D-433: a factory that runs its books in getpack's ERP issues its tax invoice to getpack from there and hands it
 * over in the same step — no second document to key in and upload. From a confirmed billing statement the ERP
 * drafts an invoice to getpack (the statement's lines, getpack as a customer of the factory, created once from
 * getpack's registered data), issues it under the factory's own number, renders its PDF and submits it to getpack
 * Finance as the statement's tax invoice (source `erp`, linked to the ERP invoice). An invoice already issued in the
 * ERP can be handed over the same way. Finance validates it as any other factory tax invoice.
 */
@Injectable()
export class ErpGetpackBillingService {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly receivables: ErpReceivablesService,
    private readonly pdf: ErpPdfService,
    private readonly vendorInvoices: VendorInvoicesService,
    private readonly documents: CustomerDocumentsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Drafts, issues and submits the tax invoice of a confirmed statement. */
  async issueFromStatement(
    scope: ErpScope,
    statementPublicId: string,
    body: { issueDate?: string },
    perms: ReadonlySet<string>,
  ) {
    const { statement, customer } = await this.workspace.tx(async (tx) => {
      const statement = await this.statement(tx, scope, statementPublicId);
      return { statement, customer: await this.getpackCustomer(tx, scope, statement.entityId) };
    });
    const positive = statement.lines.filter((l) => dec(l.netAmount).gte(0));
    const itemised =
      positive.length === statement.lines.length &&
      positive.reduce((a, l) => a.plus(dec(l.netAmount)), dec(0)).eq(dec(statement.netAmount));
    const lines = itemised
      ? statement.lines.map((l) => ({
          description: l.description,
          quantity: '1',
          unit: 'job',
          unitPrice: fmtMoney(l.netAmount),
        }))
      : [
          {
            description: `ค่าสินค้า/ค่าจ้างผลิตตามใบวางบิลเลขที่ ${statement.bsNumber} (${statement.lines.length} รายการ)`,
            quantity: '1',
            unit: 'job',
            unitPrice: fmtMoney(statement.netAmount),
          },
        ];
    const draft = await this.receivables.createInvoice(
      scope,
      {
        customerId: customer.publicId,
        form: 'invoice',
        lines,
        vatMode: scope.factory.isVatRegistered ? 'exclusive' : 'none',
        customerPoNo: statement.bsNumber,
        note: `ตามใบวางบิล getpack เลขที่ ${statement.bsNumber} (${iso(statement.periodFrom)} – ${iso(statement.periodTo)})`,
        ...(body.issueDate ? { issueDate: body.issueDate } : {}),
      },
      perms,
    );
    const issued = await this.receivables.issueInvoice(
      scope,
      draft.id,
      body.issueDate ? { issueDate: body.issueDate } : {},
      perms,
    );
    return this.handOver(scope, statementPublicId, issued.id);
  }

  /** Hands an issued ERP invoice to getpack as the statement's tax invoice. */
  async handOver(scope: ErpScope, statementPublicId: string, erpInvoicePublicId: string) {
    const { invoice } = await this.workspace.tx(async (tx) => {
      const statement = await this.statement(tx, scope, statementPublicId);
      const invoice = await tx.erpSalesInvoice.findFirst({
        where: { publicId: erpInvoicePublicId, factoryId: scope.factory.id },
        include: { customer: true, vendorInvoice: true },
      });
      if (!invoice) throw new DomainException('http.not_found');
      if (invoice.status === 'draft' || invoice.status === 'voided' || !invoice.invoiceNo)
        throw notAllowed('the ERP invoice is not issued');
      if (invoice.vendorInvoice) throw notAllowed('this ERP invoice was handed over already');
      const seller = await this.documents.seller(this.prisma, statement.entityId, new Date());
      if (seller.taxId && invoice.customer.taxId !== seller.taxId)
        throw notAllowed('the ERP invoice is not made out to getpack (tax id)');
      if (scope.factory.isVatRegistered && !invoice.isTaxInvoice)
        throw notAllowed('the ERP invoice is not a tax invoice');
      if (
        !dec(invoice.subtotal).eq(dec(statement.netAmount)) ||
        !dec(invoice.vatAmount).eq(dec(statement.vatAmount))
      )
        throw notAllowed(
          `amounts ${fmtMoney(invoice.subtotal)} + VAT ${fmtMoney(invoice.vatAmount)} differ from the statement ${fmtMoney(statement.netAmount)} + VAT ${fmtMoney(statement.vatAmount)}`,
        );
      return { invoice };
    });
    const link = await this.pdf.pdf(scope, 'invoice', invoice.publicId);
    void link;
    const withPdf = await this.workspace.db.erpSalesInvoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: { pdfFile: true },
    });
    const row = await this.vendorInvoices.captureFactoryInvoice(
      scope.actor,
      statementPublicId,
      scope.factory.id,
      {
        vendorInvoiceNo: invoice.invoiceNo!,
        invoiceDate: iso(invoice.issueDate)!,
        sellerTaxId: scope.factory.taxId ?? '',
        sellerBranchCode: scope.factory.branchCode ?? '00000',
        netAmount: fmtMoney(invoice.subtotal),
        vatAmount: fmtMoney(invoice.vatAmount),
        source: 'erp',
        fileId: withPdf.pdfFile?.publicId ?? null,
        erpSalesInvoiceId: invoice.id,
      },
    );
    return vendorInvoiceDto(row);
  }

  private async statement(tx: ErpTx, scope: ErpScope, publicId: string) {
    const statement = await tx.billingStatement.findFirst({
      where: { publicId, factoryId: scope.factory.id },
      include: { lines: { orderBy: { lineNo: 'asc' } }, vendorInvoices: true },
    });
    if (!statement) throw new DomainException('http.not_found');
    if (statement.status !== 'confirmed') throw notAllowed('confirm the billing statement first');
    if (statement.vendorInvoices.some((v) => v.status !== 'rejected'))
      throw notAllowed('a tax invoice for this statement was submitted already');
    return statement;
  }

  /** getpack as a customer of the factory: found by getpack's tax id, else created from its registered data. */
  private async getpackCustomer(tx: ErpTx, scope: ErpScope, entityId: bigint): Promise<ErpTradingPartner> {
    const seller = await this.documents.seller(this.prisma, entityId, new Date());
    if (!seller.taxId) throw notAllowed('getpack’s registered data (tax id) is not set');
    const found = await tx.erpTradingPartner.findFirst({
      where: { factoryId: scope.factory.id, taxId: seller.taxId, branchCode: seller.branchCode ?? '00000' },
      orderBy: { id: 'asc' },
    });
    if (found) {
      if (found.kind === 'supplier')
        return tx.erpTradingPartner.update({
          where: { id: found.id },
          data: { kind: 'both', updatedById: scope.actor.userId, rowVersion: { increment: 1 } },
        });
      return found;
    }
    let code = 'GETPACK';
    for (
      let n = 2;
      await tx.erpTradingPartner.findUnique({
        where: { factoryId_code: { factoryId: scope.factory.id, code } },
      });
      n++
    )
      code = `GETPACK${n}`;
    return tx.erpTradingPartner.create({
      data: {
        factoryId: scope.factory.id,
        code,
        kind: 'customer',
        name: seller.legalNameTh ?? seller.legalNameEn ?? 'getpack',
        taxId: seller.taxId,
        branchCode: seller.branchCode ?? '00000',
        address: seller.addressTh,
        phone: seller.phone,
        paymentTermDays: 0,
        note: 'getpack — ผู้ว่าจ้างผลิตผ่านแพลตฟอร์ม (สร้างอัตโนมัติจากใบวางบิล)',
        createdById: scope.actor.userId,
      },
    });
  }
}
