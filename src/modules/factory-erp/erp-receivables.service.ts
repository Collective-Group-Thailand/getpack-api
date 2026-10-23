import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { type ActionRule, nextActions } from '@common/next-actions/next-actions';
import { paginated, toSkipTake } from '@common/pagination/pagination';
import { type ErpTx } from '@database/erp-prisma.service';
import {
  type ErpIssuedStatus,
  type ErpSalesInvoice,
  type ErpSalesInvoiceStatus,
  type ErpSalesNote,
  type ErpSalesNoteReason,
  type ErpVatMode,
  Prisma,
} from '@generated/prisma-erp/client';
import { bahtText } from '@modules/receivables/thai-text';
import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import {
  AGING_BUCKETS,
  type AgingBucket,
  agingBucket,
  dec,
  fmtMoney,
  fmtQty,
  lineAmount,
  money2,
} from './erp.math';
import { ErpAlertsService } from './erp-alerts.service';
import {
  ERP_CREDIT_REASONS,
  ERP_DEBIT_REASONS,
  type ErpArAgingDto,
  type ErpBillingNoteDto,
  type ErpBillingNoteListQuery,
  type ErpCreateBillingNoteDto,
  type ErpCreateReceiptDto,
  type ErpCreateSalesInvoiceDto,
  type ErpCreateSalesNoteDto,
  type ErpCustomerReceiptDto,
  type ErpIssueSalesInvoiceDto,
  type ErpReceiptListQuery,
  type ErpSalesInvoiceDto,
  type ErpSalesInvoiceListQuery,
  type ErpSalesInvoiceSummaryDto,
  type ErpSalesNoteDto,
  type ErpSalesNoteListQuery,
  type ErpUpdateSalesInvoiceDto,
} from './erp-e4.dto';
import {
  addDays,
  assertSellerComplete,
  buyerOf,
  customerOf,
  day,
  iso,
  isoTs,
  LINE,
  partnerRef,
  party,
  priceLines,
  salesLineDto,
  sellerOf,
  today,
  totalsOf,
  userRef,
  vatModeFor,
} from './erp-sales.shared';
import { ErpSalesOrdersService } from './erp-sales-orders.service';
import { ErpStockService, type StockEntry } from './erp-stock.service';
import { itemRef, warehouseRef } from './erp-views';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

const OPEN: ErpSalesInvoiceStatus[] = ['issued', 'partially_paid'];
const LIVE: ErpSalesInvoiceStatus[] = ['issued', 'partially_paid', 'paid'];

const IV_INCLUDE = {
  customer: true,
  salesOrder: true,
  salesperson: true,
  lines: {
    include: { item: true, deliveryNoteLine: { include: { deliveryNote: true } } },
    orderBy: { lineNo: 'asc' },
  },
  notes: { orderBy: { id: 'asc' } },
  allocations: { include: { receipt: true }, orderBy: { id: 'asc' } },
} as const satisfies Prisma.ErpSalesInvoiceInclude;
type IvRow = Prisma.ErpSalesInvoiceGetPayload<{ include: typeof IV_INCLUDE }>;

const NOTE_INCLUDE = {
  invoice: true,
  customer: true,
  warehouse: true,
  lines: { include: { item: true }, orderBy: { lineNo: 'asc' } },
} as const satisfies Prisma.ErpSalesNoteInclude;
type NoteRow = Prisma.ErpSalesNoteGetPayload<{ include: typeof NOTE_INCLUDE }>;

const RC_INCLUDE = {
  customer: true,
  createdBy: true,
  whtFile: true,
  allocations: { include: { invoice: true }, orderBy: { id: 'asc' } },
} as const satisfies Prisma.ErpCustomerReceiptInclude;
type RcRow = Prisma.ErpCustomerReceiptGetPayload<{ include: typeof RC_INCLUDE }>;

const BN_INCLUDE = {
  customer: true,
  lines: { include: { invoice: true }, orderBy: { id: 'asc' } },
} as const satisfies Prisma.ErpBillingNoteInclude;
type BnRow = Prisma.ErpBillingNoteGetPayload<{ include: typeof BN_INCLUDE }>;

/** total + debit notes − credit notes − received. */
export const openOf = (
  i: Pick<ErpSalesInvoice, 'total' | 'debitedAmount' | 'creditedAmount' | 'receivedAmount'>,
) => dec(i.total).plus(dec(i.debitedAmount)).minus(dec(i.creditedAmount)).minus(dec(i.receivedAmount));

interface IvFacts {
  status: ErpSalesInvoiceStatus;
  open: Prisma.Decimal;
  settled: boolean;
}

export const IV_ACTIONS: ActionRule<IvFacts>[] = [
  { key: 'erp_iv.edit', permissions: ['factory_receivables.manage'], when: (i) => i.status === 'draft' },
  {
    key: 'erp_iv.issue',
    permissions: ['factory_receivables.manage'],
    irreversible: true,
    when: (i) => i.status === 'draft',
  },
  {
    key: 'erp_iv.receive',
    permissions: ['factory_receivables.manage'],
    when: (i) => LIVE.includes(i.status) && !i.open.isZero(),
  },
  { key: 'erp_iv.credit', permissions: ['factory_receivables.manage'], when: (i) => LIVE.includes(i.status) },
  { key: 'erp_iv.debit', permissions: ['factory_receivables.manage'], when: (i) => LIVE.includes(i.status) },
  {
    key: 'erp_iv.void',
    permissions: ['factory_receivables.manage'],
    irreversible: true,
    when: (i) =>
      i.status === 'issued'
        ? i.settled
          ? 'มีใบเสร็จหรือใบลด/เพิ่มหนี้แล้ว — ยกเลิกเอกสารเหล่านั้นก่อน'
          : true
        : false,
  },
  {
    key: 'erp_iv.delete',
    permissions: ['factory_receivables.manage'],
    irreversible: true,
    when: (i) => i.status === 'draft',
  },
  { key: 'erp_iv.pdf', permissions: ['factory_receivables.read'], when: (i) => i.status !== 'draft' },
];

export const NOTE_ACTIONS: ActionRule<{ status: ErpIssuedStatus }>[] = [
  {
    key: 'erp_note.issue',
    permissions: ['factory_receivables.manage'],
    irreversible: true,
    when: (n) => n.status === 'draft',
  },
  {
    key: 'erp_note.void',
    permissions: ['factory_receivables.manage'],
    irreversible: true,
    when: (n) => n.status === 'issued',
  },
  {
    key: 'erp_note.delete',
    permissions: ['factory_receivables.manage'],
    irreversible: true,
    when: (n) => n.status === 'draft',
  },
  { key: 'erp_note.pdf', permissions: ['factory_receivables.read'], when: (n) => n.status !== 'draft' },
];

export const RC_ACTIONS: ActionRule<{ status: string }>[] = [
  {
    key: 'erp_rc.cancel',
    permissions: ['factory_receivables.manage'],
    irreversible: true,
    when: (r) => r.status === 'issued',
  },
  { key: 'erp_rc.pdf', permissions: ['factory_receivables.read'], when: () => true },
];

export const BN_ACTIONS: ActionRule<{ status: string }>[] = [
  {
    key: 'erp_bn.cancel',
    permissions: ['factory_receivables.manage'],
    irreversible: true,
    when: (b) => b.status === 'issued',
  },
  { key: 'erp_bn.pdf', permissions: ['factory_receivables.read'], when: () => true },
];

/**
 * The factory's receivables (D-363 – D-365): invoices and tax invoices it issues in its own name and numbering,
 * credit and debit notes against them, receipts (with the customer's withholding tax) and refunds, billing notes
 * and the aging of what customers owe.
 */
@Injectable()
export class ErpReceivablesService {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly orders: ErpSalesOrdersService,
    private readonly stock: ErpStockService,
    private readonly alerts: ErpAlertsService,
  ) {}

  // ---------------------------------------------------------------------------------- invoices

  async listInvoices(scope: ErpScope, q: ErpSalesInvoiceListQuery) {
    const where: Prisma.ErpSalesInvoiceWhereInput = { factoryId: scope.factory.id };
    if (q.status === 'open' || q.status === 'overdue') where.status = { in: OPEN };
    else if (q.status) where.status = q.status as ErpSalesInvoiceStatus;
    if (q.status === 'overdue') where.dueDate = { lt: day(today()) };
    if (q.customerId) where.customer = { publicId: q.customerId };
    if (q.from || q.to)
      where.issueDate = { ...(q.from && { gte: day(q.from) }), ...(q.to && { lte: day(q.to) }) };
    if (q.q)
      where.OR = [
        { invoiceNo: { contains: q.q, mode: 'insensitive' } },
        { customerPoNo: { contains: q.q, mode: 'insensitive' } },
        { customer: { name: { contains: q.q, mode: 'insensitive' } } },
      ];
    const [rows, total] = await Promise.all([
      this.workspace.db.erpSalesInvoice.findMany({
        where,
        include: { customer: true, salesperson: true },
        orderBy: [{ issueDate: 'desc' }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpSalesInvoice.count({ where }),
    ]);
    return paginated(rows.map(invoiceSummary), total, q);
  }

  async getInvoice(
    scope: ErpScope,
    publicId: string,
    perms: ReadonlySet<string>,
  ): Promise<ErpSalesInvoiceDto> {
    const row = await this.workspace.db.erpSalesInvoice.findFirst({
      where: { publicId, factoryId: scope.factory.id },
      include: IV_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return invoiceDto(row, perms);
  }

  /**
   * A draft invoice (D-363) from issued delivery notes (their uninvoiced lines), a sales order (its uninvoiced
   * service lines; goods lines too when nothing was delivered), and free lines. The quantities it takes are
   * held for it until it is deleted or voided.
   */
  async createInvoice(scope: ErpScope, body: ErpCreateSalesInvoiceDto, perms: ReadonlySet<string>) {
    const id = await this.workspace.tx(async (tx) => {
      const customer = await customerOf(tx, scope, body.customerId);
      const settings = await this.workspace.settings(tx, scope.factory.id);
      void settings;
      type Draft = {
        itemId: bigint | null;
        description: string;
        quantity: Prisma.Decimal;
        unit: string;
        unitPrice: Prisma.Decimal;
        discountPct: Prisma.Decimal;
        deliveryNoteLineId: bigint | null;
        salesOrderLineId: bigint | null;
      };
      const drafts: Draft[] = [];
      let salesOrderId: bigint | null = null;
      let vatFromOrder: ErpVatMode | null = null;
      let salespersonId: bigint | null = customer.salespersonId;
      let customerPoNo: string | null = null;
      let terms = customer.paymentTermDays;
      for (const dnId of body.deliveryNoteIds ?? []) {
        const dn = await tx.erpDeliveryNote.findFirst({
          where: { publicId: dnId, factoryId: scope.factory.id },
          include: {
            salesOrder: true,
            lines: { include: { salesOrderLine: true }, orderBy: { lineNo: 'asc' } },
          },
        });
        if (!dn) throw new DomainException('http.not_found');
        if (dn.customerId !== customer.id)
          throw new DomainException('erp.invalid_status', { params: { status: 'other_customer' } });
        if (dn.status !== 'issued' && dn.status !== 'delivered')
          throw new DomainException('erp.invalid_status', { params: { status: dn.status } });
        salesOrderId ??= dn.salesOrderId;
        vatFromOrder ??= dn.salesOrder.vatMode;
        salespersonId = dn.salesOrder.salespersonId ?? salespersonId;
        customerPoNo ??= dn.salesOrder.customerPoNo;
        terms = dn.salesOrder.paymentTermDays;
        for (const l of dn.lines) {
          const left = dec(l.quantity).minus(dec(l.invoicedQty));
          if (!left.gt(0)) continue;
          drafts.push({
            itemId: l.itemId,
            description: l.description,
            quantity: left,
            unit: l.unit,
            unitPrice: l.salesOrderLine.unitPrice,
            discountPct: l.salesOrderLine.discountPct,
            deliveryNoteLineId: l.id,
            salesOrderLineId: l.salesOrderLineId,
          });
        }
      }
      if (body.salesOrderId) {
        const so = await tx.erpSalesOrder.findFirst({
          where: { publicId: body.salesOrderId, factoryId: scope.factory.id },
          include: { lines: { orderBy: { lineNo: 'asc' } }, deliveryNotes: true },
        });
        if (!so) throw new DomainException('http.not_found');
        if (so.customerId !== customer.id)
          throw new DomainException('erp.invalid_status', { params: { status: 'other_customer' } });
        if (!['confirmed', 'partially_delivered', 'delivered'].includes(so.status))
          throw new DomainException('erp.invalid_status', { params: { status: so.status } });
        salesOrderId ??= so.id;
        vatFromOrder ??= so.vatMode;
        salespersonId = so.salespersonId ?? salespersonId;
        customerPoNo ??= so.customerPoNo;
        terms = so.paymentTermDays;
        const delivered = so.deliveryNotes.some((d) => d.status !== 'cancelled' && d.status !== 'draft');
        for (const l of so.lines) {
          if (l.fulfilment !== 'service' && delivered) continue;
          if (drafts.some((d) => d.salesOrderLineId === l.id)) continue;
          const left = dec(l.quantity).minus(dec(l.invoicedQty));
          if (!left.gt(0)) continue;
          drafts.push({
            itemId: l.itemId,
            description: l.description,
            quantity: left,
            unit: l.unit,
            unitPrice: l.unitPrice,
            discountPct: l.discountPct,
            deliveryNoteLineId: null,
            salesOrderLineId: l.id,
          });
        }
      }
      const free = body.lines?.length ? await priceLines(tx, scope, body.lines) : [];
      if (!drafts.length && !free.length) throw new DomainException('erp.nothing_to_invoice');
      const vatMode = vatModeFor(scope.factory, body.vatMode ?? vatFromOrder ?? undefined);
      const lines = [
        ...drafts.map((d) => ({
          itemId: d.itemId,
          description: d.description,
          quantity: fmtQty(d.quantity),
          unit: d.unit as Prisma.ErpSalesInvoiceLineCreateWithoutInvoiceInput['unit'],
          unitPrice: d.unitPrice.toString(),
          discountPct: d.discountPct.toString(),
          amount: fmtMoney(lineAmount(d.quantity, dec(d.unitPrice), dec(d.discountPct))),
          deliveryNoteLineId: d.deliveryNoteLineId,
          salesOrderLineId: d.salesOrderLineId,
        })),
        ...free.map((l) => ({
          itemId: l.itemId,
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: l.unitPrice,
          discountPct: l.discountPct,
          amount: l.amount,
          deliveryNoteLineId: null,
          salesOrderLineId: null,
        })),
      ].map((l, i) => ({ ...l, lineNo: i + 1 }));
      // Hold the quantities for this invoice (D-363).
      for (const d of drafts) {
        if (d.deliveryNoteLineId)
          await tx.erpDeliveryNoteLine.update({
            where: { id: d.deliveryNoteLineId },
            data: { invoicedQty: { increment: fmtQty(d.quantity) } },
          });
        if (d.salesOrderLineId)
          await tx.erpSalesOrderLine.update({
            where: { id: d.salesOrderLineId },
            data: { invoicedQty: { increment: fmtQty(d.quantity) } },
          });
      }
      const issueDate = body.issueDate ?? today();
      const paymentTermDays = body.paymentTermDays ?? terms;
      const invoice = await tx.erpSalesInvoice.create({
        data: {
          factoryId: scope.factory.id,
          form: (body.form ?? 'invoice') as ErpSalesInvoice['form'],
          isTaxInvoice: scope.factory.isVatRegistered,
          customerId: customer.id,
          salesOrderId,
          salespersonId,
          issueDate: day(issueDate),
          dueDate: day(addDays(issueDate, paymentTermDays)),
          paymentTermDays,
          customerPoNo: body.customerPoNo === undefined ? customerPoNo : body.customerPoNo,
          note: body.note ?? null,
          vatMode,
          vatRatePct: '7',
          ...totalsOf(lines, vatMode, '7'),
          createdById: scope.actor.userId,
          lines: { create: lines },
        },
      });
      await this.workspace.record(
        tx,
        scope,
        'erp_sales_invoice.drafted',
        'erp_sales_invoice',
        invoice.publicId,
      );
      return invoice.publicId;
    });
    return this.getInvoice(scope, id, perms);
  }

  async updateInvoice(
    scope: ErpScope,
    publicId: string,
    ifMatch: string | undefined,
    body: ErpUpdateSalesInvoiceDto,
    perms: ReadonlySet<string>,
  ) {
    await this.workspace.tx(async (tx) => {
      const iv = await this.lockInvoice(tx, scope, publicId);
      assertIfMatch(ifMatch, etagOf(iv.publicId, iv.rowVersion));
      if (iv.status !== 'draft')
        throw new DomainException('erp.invalid_status', { params: { status: iv.status } });
      const kept = await tx.erpSalesInvoiceLine.findMany({
        where: {
          invoiceId: iv.id,
          OR: [{ deliveryNoteLineId: { not: null } }, { salesOrderLineId: { not: null } }],
        },
        orderBy: { lineNo: 'asc' },
      });
      let all = kept.map((l) => ({ amount: l.amount }));
      if (body.lines) {
        const free = await priceLines(tx, scope, body.lines);
        await tx.erpSalesInvoiceLine.deleteMany({
          where: { invoiceId: iv.id, deliveryNoteLineId: null, salesOrderLineId: null },
        });
        for (const [i, l] of kept.entries())
          await tx.erpSalesInvoiceLine.update({ where: { id: l.id }, data: { lineNo: 1000 + i } });
        for (const [i, l] of kept.entries())
          await tx.erpSalesInvoiceLine.update({ where: { id: l.id }, data: { lineNo: i + 1 } });
        await tx.erpSalesInvoiceLine.createMany({
          data: free.map((l, i) => ({
            invoiceId: iv.id,
            lineNo: kept.length + i + 1,
            itemId: l.itemId,
            description: l.description,
            quantity: l.quantity,
            unit: l.unit,
            unitPrice: l.unitPrice,
            discountPct: l.discountPct,
            amount: l.amount,
          })),
        });
        all = [...all, ...free.map((l) => ({ amount: new Prisma.Decimal(l.amount) }))];
      } else {
        all = (await tx.erpSalesInvoiceLine.findMany({ where: { invoiceId: iv.id } })).map((l) => ({
          amount: l.amount,
        }));
      }
      if (!all.length) throw new DomainException('erp.nothing_to_invoice');
      const vatMode = vatModeFor(scope.factory, body.vatMode ?? iv.vatMode);
      const issueDate = body.issueDate ?? iso(iv.issueDate)!;
      const terms = body.paymentTermDays ?? iv.paymentTermDays;
      await tx.erpSalesInvoice.update({
        where: { id: iv.id },
        data: {
          issueDate: day(issueDate),
          paymentTermDays: terms,
          dueDate: day(addDays(issueDate, terms)),
          vatMode,
          ...totalsOf(all, vatMode, iv.vatRatePct),
          ...(body.customerPoNo !== undefined && { customerPoNo: body.customerPoNo }),
          ...(body.note !== undefined && { note: body.note }),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
    });
    return this.getInvoice(scope, publicId, perms);
  }

  async deleteInvoice(scope: ErpScope, publicId: string): Promise<void> {
    await this.workspace.tx(async (tx) => {
      const iv = await this.lockInvoice(tx, scope, publicId);
      if (iv.status !== 'draft')
        throw new DomainException('erp.invalid_status', { params: { status: iv.status } });
      await this.releaseLines(tx, iv.id);
      await tx.erpSalesInvoiceLine.deleteMany({ where: { invoiceId: iv.id } });
      await tx.erpSalesInvoice.delete({ where: { id: iv.id } });
      await this.workspace.record(tx, scope, 'erp_sales_invoice.deleted', 'erp_sales_invoice', iv.publicId);
    });
  }

  /**
   * Issues a draft (D-363): the tax point is its date — never in the future, never before the last issued
   * invoice — it takes the next number of that month, the seller and buyer are frozen, and a cash sale
   * (`invoice_receipt`) is receipted in full at once.
   */
  async issueInvoice(
    scope: ErpScope,
    publicId: string,
    body: ErpIssueSalesInvoiceDto,
    perms: ReadonlySet<string>,
  ) {
    await this.workspace.tx(async (tx) => {
      const iv = await this.lockInvoice(tx, scope, publicId);
      if (iv.status !== 'draft')
        throw new DomainException('erp.invalid_status', { params: { status: iv.status } });
      const issueDate = body.issueDate ?? iso(iv.issueDate)!;
      await this.assertDateOrder(tx, scope.factory.id, issueDate);
      const customer = await tx.erpTradingPartner.findUniqueOrThrow({ where: { id: iv.customerId } });
      const seller = await sellerOf(tx, scope.factory);
      if (iv.isTaxInvoice) assertSellerComplete(seller);
      const invoiceNo = await this.workspace.nextNumber(
        tx,
        scope.factory.id,
        'iv',
        new Date(`${issueDate}T12:00:00+07:00`),
      );
      await tx.erpSalesInvoice.update({
        where: { id: iv.id },
        data: {
          invoiceNo,
          status: 'issued',
          issueDate: day(issueDate),
          dueDate: day(addDays(issueDate, iv.paymentTermDays)),
          sellerSnapshot: seller as unknown as Prisma.InputJsonValue,
          buyerSnapshot: buyerOf(customer) as unknown as Prisma.InputJsonValue,
          issuedAt: new Date(),
          issuedById: scope.actor.userId,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (iv.form === 'invoice_receipt') {
        const receiptNo = await this.workspace.nextNumber(
          tx,
          scope.factory.id,
          'rc',
          new Date(`${issueDate}T12:00:00+07:00`),
        );
        const receipt = await tx.erpCustomerReceipt.create({
          data: {
            factoryId: scope.factory.id,
            receiptNo,
            customerId: iv.customerId,
            receivedOn: day(issueDate),
            method: (body.receipt?.method ?? 'cash') as never,
            reference: body.receipt?.reference ?? null,
            amount: iv.total,
            sellerSnapshot: seller as unknown as Prisma.InputJsonValue,
            buyerSnapshot: buyerOf(customer) as unknown as Prisma.InputJsonValue,
            note: `รับชำระตาม ${invoiceNo}`,
            createdById: scope.actor.userId,
            allocations: { create: [{ invoiceId: iv.id, amount: iv.total }] },
          },
        });
        await tx.erpSalesInvoice.update({ where: { id: iv.id }, data: { receivedAmount: iv.total } });
        await this.workspace.record(tx, scope, 'erp_receipt.issued', 'erp_receipt', receipt.publicId, {
          receiptNo,
        });
      }
      await this.settle(tx, iv.id);
      for (const soId of await this.ordersOf(tx, iv.id)) await this.orders.refresh(tx, soId);
      await this.workspace.record(tx, scope, 'erp_sales_invoice.issued', 'erp_sales_invoice', iv.publicId, {
        invoiceNo,
        taxInvoice: iv.isTaxInvoice,
      });
    });
    return this.getInvoice(scope, publicId, perms);
  }

  /** Voids an issued invoice with nothing settled on it (D-363): the number stays, its quantities are free again. */
  async voidInvoice(scope: ErpScope, publicId: string, reason: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const iv = await this.lockInvoice(tx, scope, publicId);
      if (iv.status !== 'issued')
        throw new DomainException('erp.invalid_status', { params: { status: iv.status } });
      const notes = await tx.erpSalesNote.count({ where: { invoiceId: iv.id, status: { not: 'voided' } } });
      const allocations = await tx.erpReceiptAllocation.count({
        where: { invoiceId: iv.id, receipt: { status: 'issued' } },
      });
      if (notes || allocations || !dec(iv.receivedAmount).isZero())
        throw new DomainException('erp.document_settled', { params: { docNo: iv.invoiceNo ?? '' } });
      await this.releaseLines(tx, iv.id);
      await tx.erpSalesInvoice.update({
        where: { id: iv.id },
        data: {
          status: 'voided',
          voidedAt: new Date(),
          voidReason: reason,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      for (const soId of await this.ordersOf(tx, iv.id)) await this.reopenOrder(tx, soId);
      await this.workspace.record(tx, scope, 'erp_sales_invoice.voided', 'erp_sales_invoice', iv.publicId, {
        invoiceNo: iv.invoiceNo,
      });
    });
    return this.getInvoice(scope, publicId, perms);
  }

  // -------------------------------------------------------------------------- credit / debit notes

  async listNotes(scope: ErpScope, q: ErpSalesNoteListQuery) {
    const where: Prisma.ErpSalesNoteWhereInput = { factoryId: scope.factory.id };
    if (q.kind) where.kind = q.kind as ErpSalesNote['kind'];
    if (q.status) where.status = q.status as ErpIssuedStatus;
    if (q.customerId) where.customer = { publicId: q.customerId };
    if (q.invoiceId) where.invoice = { publicId: q.invoiceId };
    const [rows, total] = await Promise.all([
      this.workspace.db.erpSalesNote.findMany({
        where,
        include: NOTE_INCLUDE,
        orderBy: [{ issueDate: 'desc' }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpSalesNote.count({ where }),
    ]);
    return paginated(
      rows.map((r) => noteDto(r, new Set())),
      total,
      q,
    );
  }

  async getNote(scope: ErpScope, publicId: string, perms: ReadonlySet<string>): Promise<ErpSalesNoteDto> {
    const row = await this.workspace.db.erpSalesNote.findFirst({
      where: { publicId, factoryId: scope.factory.id },
      include: NOTE_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return noteDto(row, perms);
  }

  /** A draft credit or debit note against one issued invoice (D-364), its value checked against the invoice. */
  async createNote(scope: ErpScope, body: ErpCreateSalesNoteDto, perms: ReadonlySet<string>) {
    const credit = body.kind === 'credit';
    const allowed: readonly string[] = credit ? ERP_CREDIT_REASONS : ERP_DEBIT_REASONS;
    if (!allowed.includes(body.reason))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'reason', code: 'invalid', message: `Not a ${body.kind} note reason` }],
      });
    const returns = body.lines.some((l) => l.returnQty);
    if (returns && (!credit || !['goods_returned', 'defective'].includes(body.reason)))
      throw new DomainException('validation.failed', {
        errors: [
          {
            path: 'lines',
            code: 'invalid',
            message: 'Goods come back only on a credit note for returned or defective goods',
          },
        ],
      });
    const id = await this.workspace.tx(async (tx) => {
      const iv = await tx.erpSalesInvoice.findFirst({
        where: { publicId: body.invoiceId, factoryId: scope.factory.id },
      });
      if (!iv) throw new DomainException('http.not_found');
      if (!LIVE.includes(iv.status))
        throw new DomainException('erp.invalid_status', { params: { status: iv.status } });
      const original = await this.netValue(tx, iv);
      const difference = money2(body.lines.reduce((a, l) => a.plus(dec(l.amount)), dec(0)));
      if (!difference.gt(0))
        throw new DomainException('validation.failed', {
          errors: [{ path: 'lines', code: 'min', message: 'The difference must be more than 0' }],
        });
      if (credit && difference.gt(original))
        throw new DomainException('erp.note_exceeds_invoice', { params: { max: fmtMoney(original) } });
      const items = new Map<string, bigint>();
      for (const l of body.lines.filter((x) => x.itemId)) {
        const item = await tx.erpItem.findFirst({
          where: { publicId: l.itemId!, factoryId: scope.factory.id },
        });
        if (!item) throw new DomainException('http.not_found');
        items.set(l.itemId!, item.id);
      }
      const warehouse = returns ? await this.workspace.warehouse(tx, scope, body.warehouseId) : null;
      const rate = dec(iv.vatRatePct);
      const vat = iv.vatMode === 'none' ? dec(0) : money2(difference.times(rate).div(100));
      const note = await tx.erpSalesNote.create({
        data: {
          factoryId: scope.factory.id,
          kind: body.kind as ErpSalesNote['kind'],
          invoiceId: iv.id,
          customerId: iv.customerId,
          issueDate: day(body.issueDate ?? today()),
          reason: body.reason as ErpSalesNoteReason,
          reasonText: body.reasonText ?? null,
          originalValue: fmtMoney(original),
          correctValue: fmtMoney(credit ? original.minus(difference) : original.plus(difference)),
          difference: fmtMoney(difference),
          vatRatePct: iv.vatRatePct,
          vatAmount: fmtMoney(vat),
          total: fmtMoney(difference.plus(vat)),
          isTaxDocument: iv.isTaxInvoice,
          warehouseId: warehouse?.id ?? null,
          createdById: scope.actor.userId,
          lines: {
            create: body.lines.map((l, i) => ({
              lineNo: i + 1,
              description: l.description,
              amount: fmtMoney(dec(l.amount)),
              itemId: l.itemId ? items.get(l.itemId)! : null,
              returnQty: l.returnQty ? fmtQty(dec(l.returnQty)) : null,
            })),
          },
        },
      });
      await this.workspace.record(
        tx,
        scope,
        `erp_${body.kind}_note.drafted`,
        'erp_sales_note',
        note.publicId,
      );
      return note.publicId;
    });
    return this.getNote(scope, id, perms);
  }

  async issueNote(scope: ErpScope, publicId: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const note = await this.lockNote(tx, scope, publicId);
      if (note.status !== 'draft')
        throw new DomainException('erp.invalid_status', { params: { status: note.status } });
      const iv = await this.lockInvoiceById(tx, note.invoiceId);
      if (!LIVE.includes(iv.status))
        throw new DomainException('erp.invalid_status', { params: { status: iv.status } });
      const credit = note.kind === 'credit';
      const original = await this.netValue(tx, iv);
      if (credit && dec(note.difference).gt(original))
        throw new DomainException('erp.note_exceeds_invoice', { params: { max: fmtMoney(original) } });
      const issueDate = iso(note.issueDate)!;
      if (issueDate > today())
        throw new DomainException('erp.invoice_date_order', { params: { last: today() } });
      const customer = await tx.erpTradingPartner.findUniqueOrThrow({ where: { id: note.customerId } });
      const seller = await sellerOf(tx, scope.factory);
      if (note.isTaxDocument) assertSellerComplete(seller);
      const noteNo = await this.workspace.nextNumber(
        tx,
        scope.factory.id,
        credit ? 'cn' : 'dr',
        new Date(`${issueDate}T12:00:00+07:00`),
      );
      await tx.erpSalesNote.update({
        where: { id: note.id },
        data: {
          noteNo,
          status: 'issued',
          originalValue: fmtMoney(original),
          correctValue: fmtMoney(
            credit ? original.minus(dec(note.difference)) : original.plus(dec(note.difference)),
          ),
          sellerSnapshot: seller as unknown as Prisma.InputJsonValue,
          buyerSnapshot: buyerOf(customer) as unknown as Prisma.InputJsonValue,
          issuedAt: new Date(),
          issuedById: scope.actor.userId,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await tx.erpSalesInvoice.update({
        where: { id: iv.id },
        data: credit
          ? {
              creditedAmount: fmtMoney(dec(iv.creditedAmount).plus(dec(note.total))),
              rowVersion: { increment: 1 },
            }
          : {
              debitedAmount: fmtMoney(dec(iv.debitedAmount).plus(dec(note.total))),
              rowVersion: { increment: 1 },
            },
      });
      await this.returnGoods(tx, scope, note, noteNo, 1);
      await this.settle(tx, iv.id);
      await this.workspace.record(
        tx,
        scope,
        `erp_${note.kind}_note.issued`,
        'erp_sales_note',
        note.publicId,
        { noteNo },
      );
    });
    return this.getNote(scope, publicId, perms);
  }

  async voidNote(scope: ErpScope, publicId: string, reason: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const note = await this.lockNote(tx, scope, publicId);
      if (note.status !== 'issued')
        throw new DomainException('erp.invalid_status', { params: { status: note.status } });
      const iv = await this.lockInvoiceById(tx, note.invoiceId);
      const after =
        note.kind === 'credit'
          ? { ...iv, creditedAmount: dec(iv.creditedAmount).minus(dec(note.total)) }
          : { ...iv, debitedAmount: dec(iv.debitedAmount).minus(dec(note.total)) };
      if (openOf(after).isNegative() && note.kind === 'debit')
        throw new DomainException('erp.document_settled', { params: { docNo: note.noteNo ?? '' } });
      await tx.erpSalesInvoice.update({
        where: { id: iv.id },
        data: {
          creditedAmount: fmtMoney(after.creditedAmount),
          debitedAmount: fmtMoney(after.debitedAmount),
          rowVersion: { increment: 1 },
        },
      });
      await this.returnGoods(tx, scope, note, note.noteNo ?? '', -1);
      await tx.erpSalesNote.update({
        where: { id: note.id },
        data: {
          status: 'voided',
          voidedAt: new Date(),
          voidReason: reason,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.settle(tx, iv.id);
      await this.workspace.record(
        tx,
        scope,
        `erp_${note.kind}_note.voided`,
        'erp_sales_note',
        note.publicId,
        {
          noteNo: note.noteNo,
        },
      );
    });
    return this.getNote(scope, publicId, perms);
  }

  async deleteNote(scope: ErpScope, publicId: string): Promise<void> {
    await this.workspace.tx(async (tx) => {
      const note = await this.lockNote(tx, scope, publicId);
      if (note.status !== 'draft')
        throw new DomainException('erp.invalid_status', { params: { status: note.status } });
      await tx.erpSalesNoteLine.deleteMany({ where: { noteId: note.id } });
      await tx.erpSalesNote.delete({ where: { id: note.id } });
    });
  }

  /** Goods named on a credit note come back into stock (sign +1) — or go out again when it is voided (−1). */
  private async returnGoods(tx: ErpTx, scope: ErpScope, note: ErpSalesNote, docNo: string, sign: 1 | -1) {
    if (note.kind !== 'credit' || !note.warehouseId) return;
    const lines = await tx.erpSalesNoteLine.findMany({
      where: { noteId: note.id, returnQty: { not: null } },
      include: { item: true },
      orderBy: { lineNo: 'asc' },
    });
    if (!lines.length) return;
    const warehouse = await tx.erpWarehouse.findUniqueOrThrow({ where: { id: note.warehouseId } });
    const settings = await this.workspace.settings(tx, scope.factory.id);
    const entries: StockEntry[] = lines
      .filter((l) => l.item && l.returnQty)
      .map((l) => ({
        item: l.item!,
        warehouse,
        kind: sign > 0 ? ('sales_return' as const) : ('sales_issue' as const),
        quantity: sign > 0 ? dec(l.returnQty!) : dec(l.returnQty!).negated(),
        reason: sign > 0 ? `รับคืนตาม ${docNo}` : `ยกเลิกใบลดหนี้ ${docNo}`,
      }));
    await this.stock.post(tx, scope, settings, entries, {
      type: 'sales_note',
      publicId: note.publicId,
      documentNo: docNo,
    });
  }

  /** The invoice's value now (net, without VAT): its subtotal plus issued debit and less issued credit differences. */
  private async netValue(tx: ErpTx, iv: ErpSalesInvoice): Promise<Prisma.Decimal> {
    const notes = await tx.erpSalesNote.findMany({ where: { invoiceId: iv.id, status: 'issued' } });
    return notes.reduce(
      (a, n) => (n.kind === 'credit' ? a.minus(dec(n.difference)) : a.plus(dec(n.difference))),
      dec(iv.subtotal),
    );
  }

  // ---------------------------------------------------------------------------------- receipts

  async listReceipts(scope: ErpScope, q: ErpReceiptListQuery, perms: ReadonlySet<string>) {
    const where: Prisma.ErpCustomerReceiptWhereInput = { factoryId: scope.factory.id };
    if (q.customerId) where.customer = { publicId: q.customerId };
    if (q.status) where.status = q.status as never;
    if (q.from || q.to)
      where.receivedOn = { ...(q.from && { gte: day(q.from) }), ...(q.to && { lte: day(q.to) }) };
    const [rows, total] = await Promise.all([
      this.workspace.db.erpCustomerReceipt.findMany({
        where,
        include: RC_INCLUDE,
        orderBy: [{ receivedOn: 'desc' }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpCustomerReceipt.count({ where }),
    ]);
    return paginated(
      rows.map((r) => receiptDto(r, perms)),
      total,
      q,
    );
  }

  async getReceipt(
    scope: ErpScope,
    publicId: string,
    perms: ReadonlySet<string>,
  ): Promise<ErpCustomerReceiptDto> {
    const row = await this.workspace.db.erpCustomerReceipt.findFirst({
      where: { publicId, factoryId: scope.factory.id },
      include: RC_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return receiptDto(row, perms);
  }

  /**
   * Records money received — or refunded — (D-365), allocated gross (cash + the customer's WHT) to the customer's
   * invoices, never beyond what is open; a refund pays back a credit balance only.
   */
  async receive(scope: ErpScope, body: ErpCreateReceiptDto, perms: ReadonlySet<string>) {
    const refund = body.kind === 'refund';
    const amount = dec(body.amount);
    const wht = dec(body.whtAmount ?? '0');
    if (refund && wht.gt(0))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'whtAmount', code: 'invalid', message: 'A refund has no withholding tax' }],
      });
    const gross = amount.plus(wht);
    if (!gross.gt(0))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'amount', code: 'min', message: 'More than 0' }],
      });
    const allocated = money2(body.allocations.reduce((a, l) => a.plus(dec(l.amount)), dec(0)));
    if (!allocated.equals(gross))
      throw new DomainException('validation.failed', {
        errors: [
          {
            path: 'allocations',
            code: 'sum',
            message: `Allocations (${fmtMoney(allocated)}) must add up to amount + WHT (${fmtMoney(gross)})`,
          },
        ],
      });
    const id = await this.workspace.tx(async (tx) => {
      const customer = await customerOf(tx, scope, body.customerId);
      const ids = body.allocations.map((a) => a.invoiceId);
      if (new Set(ids).size !== ids.length)
        throw new DomainException('validation.failed', {
          errors: [{ path: 'allocations', code: 'duplicate', message: 'One allocation per invoice' }],
        });
      const rows: { invoice: ErpSalesInvoice; amount: Prisma.Decimal }[] = [];
      for (const a of body.allocations) {
        const found = await tx.erpSalesInvoice.findFirst({
          where: { publicId: a.invoiceId, factoryId: scope.factory.id },
        });
        if (!found || found.customerId !== customer.id) throw new DomainException('http.not_found');
        const iv = await this.lockInvoiceById(tx, found.id);
        if (!LIVE.includes(iv.status))
          throw new DomainException('erp.invalid_status', { params: { status: iv.status } });
        const open = openOf(iv);
        const want = dec(a.amount);
        if (refund ? !open.isNegative() || want.gt(open.negated()) : want.gt(open))
          throw new DomainException('erp.allocation_exceeds_open', {
            params: { docNo: iv.invoiceNo ?? '', open: fmtMoney(open), amount: fmtMoney(want) },
          });
        rows.push({ invoice: iv, amount: refund ? want.negated() : want });
      }
      let whtFileId: bigint | null = null;
      if (body.whtFileId) {
        const f = await tx.fileObject.findUnique({ where: { publicId: body.whtFileId } });
        if (
          !f ||
          f.ownerFactoryId !== scope.factory.id ||
          f.uploadStatus !== 'uploaded' ||
          f.scanStatus === 'infected'
        )
          throw new DomainException('erp.file_not_usable');
        whtFileId = f.id;
      }
      const receiptNo = await this.workspace.nextNumber(
        tx,
        scope.factory.id,
        'rc',
        new Date(`${body.receivedOn}T12:00:00+07:00`),
      );
      const receipt = await tx.erpCustomerReceipt.create({
        data: {
          factoryId: scope.factory.id,
          receiptNo,
          kind: refund ? 'refund' : 'receipt',
          customerId: customer.id,
          receivedOn: day(body.receivedOn),
          method: body.method as never,
          reference: body.reference ?? null,
          chequeNo: body.chequeNo ?? null,
          chequeBank: body.chequeBank ?? null,
          chequeDate: body.chequeDate ? day(body.chequeDate) : null,
          amount: fmtMoney(refund ? amount.negated() : amount),
          whtAmount: fmtMoney(wht),
          whtCertNo: body.whtCertNo ?? null,
          whtCertDate: body.whtCertDate ? day(body.whtCertDate) : null,
          whtFileId,
          note: body.note ?? null,
          sellerSnapshot: (await sellerOf(tx, scope.factory)) as unknown as Prisma.InputJsonValue,
          buyerSnapshot: buyerOf(customer) as unknown as Prisma.InputJsonValue,
          createdById: scope.actor.userId,
          allocations: { create: rows.map((r) => ({ invoiceId: r.invoice.id, amount: fmtMoney(r.amount) })) },
        },
      });
      for (const r of rows) {
        await tx.erpSalesInvoice.update({
          where: { id: r.invoice.id },
          data: {
            receivedAmount: fmtMoney(dec(r.invoice.receivedAmount).plus(r.amount)),
            rowVersion: { increment: 1 },
          },
        });
        await this.settle(tx, r.invoice.id);
      }
      await this.workspace.record(
        tx,
        scope,
        refund ? 'erp_refund.issued' : 'erp_receipt.issued',
        'erp_receipt',
        receipt.publicId,
        {
          receiptNo,
        },
      );
      return receipt.publicId;
    });
    return this.getReceipt(scope, id, perms);
  }

  /** Cancels a receipt with a reason (D-365): the number stays, its invoices are open again. */
  async cancelReceipt(scope: ErpScope, publicId: string, reason: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const r = await tx.erpCustomerReceipt.findFirst({
        where: { publicId, factoryId: scope.factory.id },
        include: { allocations: true },
      });
      if (!r) throw new DomainException('http.not_found');
      await tx.$queryRaw`SELECT id FROM erp_customer_receipts WHERE id = ${r.id} FOR UPDATE`;
      if (r.status !== 'issued')
        throw new DomainException('erp.invalid_status', { params: { status: r.status } });
      for (const a of r.allocations) {
        const iv = await this.lockInvoiceById(tx, a.invoiceId);
        await tx.erpSalesInvoice.update({
          where: { id: iv.id },
          data: {
            receivedAmount: fmtMoney(dec(iv.receivedAmount).minus(dec(a.amount))),
            rowVersion: { increment: 1 },
          },
        });
        await this.settle(tx, iv.id);
      }
      await tx.erpCustomerReceipt.update({
        where: { id: r.id },
        data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason },
      });
      await this.workspace.record(tx, scope, 'erp_receipt.cancelled', 'erp_receipt', r.publicId, {
        receiptNo: r.receiptNo,
      });
    });
    return this.getReceipt(scope, publicId, perms);
  }

  // ----------------------------------------------------------------------------- billing notes

  async listBillingNotes(scope: ErpScope, q: ErpBillingNoteListQuery, perms: ReadonlySet<string>) {
    const where: Prisma.ErpBillingNoteWhereInput = { factoryId: scope.factory.id };
    if (q.customerId) where.customer = { publicId: q.customerId };
    if (q.status) where.status = q.status as never;
    const [rows, total] = await Promise.all([
      this.workspace.db.erpBillingNote.findMany({
        where,
        include: BN_INCLUDE,
        orderBy: [{ billingDate: 'desc' }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpBillingNote.count({ where }),
    ]);
    return paginated(
      rows.map((r) => billingDto(r, perms)),
      total,
      q,
    );
  }

  async getBillingNote(
    scope: ErpScope,
    publicId: string,
    perms: ReadonlySet<string>,
  ): Promise<ErpBillingNoteDto> {
    const row = await this.workspace.db.erpBillingNote.findFirst({
      where: { publicId, factoryId: scope.factory.id },
      include: BN_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return billingDto(row, perms);
  }

  async createBillingNote(scope: ErpScope, body: ErpCreateBillingNoteDto, perms: ReadonlySet<string>) {
    const id = await this.workspace.tx(async (tx) => {
      const customer = await customerOf(tx, scope, body.customerId);
      const invoices = await tx.erpSalesInvoice.findMany({
        where: { factoryId: scope.factory.id, publicId: { in: [...new Set(body.invoiceIds)] } },
        orderBy: [{ issueDate: 'asc' }, { id: 'asc' }],
      });
      if (invoices.length !== new Set(body.invoiceIds).size) throw new DomainException('http.not_found');
      const lines = invoices.map((iv) => {
        if (iv.customerId !== customer.id) throw new DomainException('http.not_found');
        const open = openOf(iv);
        if (!OPEN.includes(iv.status) || !open.gt(0))
          throw new DomainException('erp.invalid_status', { params: { status: iv.status } });
        return { invoiceId: iv.id, amount: fmtMoney(open) };
      });
      const billingDate = body.billingDate ?? today();
      const billingNo = await this.workspace.nextNumber(
        tx,
        scope.factory.id,
        'bn',
        new Date(`${billingDate}T12:00:00+07:00`),
      );
      const bn = await tx.erpBillingNote.create({
        data: {
          factoryId: scope.factory.id,
          billingNo,
          customerId: customer.id,
          billingDate: day(billingDate),
          collectOn: body.collectOn ? day(body.collectOn) : null,
          total: fmtMoney(lines.reduce((a, l) => a.plus(dec(l.amount)), dec(0))),
          note: body.note ?? null,
          sellerSnapshot: (await sellerOf(tx, scope.factory)) as unknown as Prisma.InputJsonValue,
          buyerSnapshot: buyerOf(customer) as unknown as Prisma.InputJsonValue,
          createdById: scope.actor.userId,
          lines: { create: lines },
        },
      });
      await this.workspace.record(tx, scope, 'erp_billing_note.issued', 'erp_billing_note', bn.publicId, {
        billingNo,
      });
      return bn.publicId;
    });
    return this.getBillingNote(scope, id, perms);
  }

  async cancelBillingNote(scope: ErpScope, publicId: string, reason: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const bn = await tx.erpBillingNote.findFirst({ where: { publicId, factoryId: scope.factory.id } });
      if (!bn) throw new DomainException('http.not_found');
      if (bn.status !== 'issued')
        throw new DomainException('erp.invalid_status', { params: { status: bn.status } });
      await tx.erpBillingNote.update({
        where: { id: bn.id },
        data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason },
      });
    });
    return this.getBillingNote(scope, publicId, perms);
  }

  // ------------------------------------------------------------------------------------- aging

  async aging(scope: ErpScope): Promise<ErpArAgingDto> {
    const asOf = today();
    const soon = addDays(asOf, 7);
    const rows = await this.workspace.db.erpSalesInvoice.findMany({
      where: { factoryId: scope.factory.id, status: { in: LIVE } },
      include: { customer: true },
    });
    const zero = () =>
      Object.fromEntries(AGING_BUCKETS.map((b) => [b, dec(0)])) as Record<AgingBucket, Prisma.Decimal>;
    const totals = zero();
    let dueSoon = dec(0);
    let refunds = dec(0);
    const byCustomer = new Map<
      bigint,
      { customer: (typeof rows)[number]['customer']; n: number; b: Record<AgingBucket, Prisma.Decimal> }
    >();
    for (const r of rows) {
      const open = openOf(r);
      if (open.isNegative()) {
        refunds = refunds.plus(open.negated());
        continue;
      }
      if (!open.gt(0)) continue;
      const due = iso(r.dueDate)!;
      const bucket = agingBucket(due, asOf);
      totals[bucket] = totals[bucket].plus(open);
      if (due >= asOf && due <= soon) dueSoon = dueSoon.plus(open);
      const c = byCustomer.get(r.customerId) ?? { customer: r.customer, n: 0, b: zero() };
      c.n += 1;
      c.b[bucket] = c.b[bucket].plus(open);
      byCustomer.set(r.customerId, c);
    }
    const dto = (b: Record<AgingBucket, Prisma.Decimal>) => ({
      current: fmtMoney(b.current),
      d1_30: fmtMoney(b.d1_30),
      d31_60: fmtMoney(b.d31_60),
      d61_90: fmtMoney(b.d61_90),
      over90: fmtMoney(b.over90),
      total: fmtMoney(AGING_BUCKETS.reduce((a, k) => a.plus(b[k]), dec(0))),
    });
    return {
      asOf,
      currency: 'THB',
      dueSoon: fmtMoney(dueSoon),
      refundsDue: fmtMoney(refunds),
      totals: dto(totals),
      customers: [...byCustomer.values()]
        .map((c) => ({
          customer: partnerRef(c.customer),
          invoices: c.n,
          buckets: dto(c.b),
          creditLimit: c.customer.creditLimit === null ? null : fmtMoney(c.customer.creditLimit),
        }))
        .sort((a, b) => dec(b.buckets.total).comparedTo(dec(a.buckets.total))),
    };
  }

  /** D-371: open invoices past due raise an alert once a week each; activities overdue raise one each. */
  @ScheduledJob({ name: 'factory_erp.receivables_alerts', cron: '30 7 * * *' })
  async overdueCheck(): Promise<number> {
    const t = today();
    let raised = 0;
    const overdue = await this.workspace.db.erpSalesInvoice.findMany({
      where: {
        status: { in: OPEN },
        dueDate: { lt: day(t) },
        OR: [{ lastOverdueAlertOn: null }, { lastOverdueAlertOn: { lte: day(addDays(t, -7)) } }],
      },
      include: { customer: true, factory: true },
    });
    for (const iv of overdue) {
      if (!openOf(iv).gt(0)) continue;
      await this.workspace.tx(async (tx) => {
        await this.alerts.raise(tx, {
          factoryId: iv.factoryId,
          factoryPublicId: iv.factory.publicId,
          kind: 'invoice_overdue',
          dedupeKey: `invoice_overdue:${iv.publicId}:${t}`,
          subjectType: 'sales_invoice',
          subjectPublicId: iv.publicId,
          dueOn: iso(iv.dueDate),
          payload: {
            invoiceNo: iv.invoiceNo,
            customer: iv.customer.name,
            open: fmtMoney(openOf(iv)),
            dueDate: iso(iv.dueDate),
          },
        });
        await tx.erpSalesInvoice.update({ where: { id: iv.id }, data: { lastOverdueAlertOn: day(t) } });
      });
      raised += 1;
    }
    const activities = await this.workspace.db.erpActivity.findMany({
      where: { doneAt: null, dueAt: { lt: new Date() } },
      include: { factory: true, assignee: true },
      take: 500,
    });
    for (const a of activities) {
      await this.workspace.tx((tx) =>
        this.alerts.raise(tx, {
          factoryId: a.factoryId,
          factoryPublicId: a.factory.publicId,
          kind: 'activity_overdue',
          dedupeKey: `activity_overdue:${a.publicId}`,
          subjectType: 'activity',
          subjectPublicId: a.publicId,
          dueOn: a.dueAt ? a.dueAt.toISOString().slice(0, 10) : null,
          payload: { subject: a.subject, assignee: a.assignee.displayName, kind: a.kind },
        }),
      );
      raised += 1;
    }
    return raised;
  }

  // ----------------------------------------------------------------------------------- helpers

  /** Status from what is open: issued, partially paid, or paid (settled, by money or credit). */
  async settle(tx: ErpTx, invoiceId: bigint): Promise<void> {
    const iv = await tx.erpSalesInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (!LIVE.includes(iv.status)) return;
    const open = openOf(iv);
    const status: ErpSalesInvoiceStatus = !open.gt(0)
      ? 'paid'
      : dec(iv.receivedAmount).gt(0)
        ? 'partially_paid'
        : 'issued';
    if (status !== iv.status) await tx.erpSalesInvoice.update({ where: { id: iv.id }, data: { status } });
  }

  private async assertDateOrder(tx: ErpTx, factoryId: bigint, issueDate: string) {
    const t = today();
    const last = await tx.erpSalesInvoice.findFirst({
      where: { factoryId, invoiceNo: { not: null } },
      orderBy: [{ issueDate: 'desc' }],
      select: { issueDate: true },
    });
    const lastDay = last ? iso(last.issueDate)! : null;
    if (issueDate > t || (lastDay && issueDate < lastDay))
      throw new DomainException('erp.invoice_date_order', { params: { last: lastDay ?? t } });
  }

  private async releaseLines(tx: ErpTx, invoiceId: bigint) {
    const lines = await tx.erpSalesInvoiceLine.findMany({ where: { invoiceId } });
    for (const l of lines) {
      if (l.deliveryNoteLineId)
        await tx.erpDeliveryNoteLine.update({
          where: { id: l.deliveryNoteLineId },
          data: { invoicedQty: { decrement: fmtQty(l.quantity) } },
        });
      if (l.salesOrderLineId)
        await tx.erpSalesOrderLine.update({
          where: { id: l.salesOrderLineId },
          data: { invoicedQty: { decrement: fmtQty(l.quantity) } },
        });
    }
  }

  private async ordersOf(tx: ErpTx, invoiceId: bigint): Promise<bigint[]> {
    const lines = await tx.erpSalesInvoiceLine.findMany({
      where: { invoiceId, salesOrderLineId: { not: null } },
      include: { salesOrderLine: true },
    });
    return [...new Set(lines.map((l) => l.salesOrderLine!.salesOrderId))];
  }

  private async reopenOrder(tx: ErpTx, soId: bigint) {
    const so = await tx.erpSalesOrder.findUniqueOrThrow({ where: { id: soId } });
    if (so.status === 'closed' && !so.closeReason)
      await tx.erpSalesOrder.update({ where: { id: so.id }, data: { status: 'delivered', closedAt: null } });
    await this.orders.refresh(tx, soId);
  }

  private async lockInvoice(tx: ErpTx, scope: ErpScope, publicId: string): Promise<ErpSalesInvoice> {
    const iv = await tx.erpSalesInvoice.findFirst({ where: { publicId, factoryId: scope.factory.id } });
    if (!iv) throw new DomainException('http.not_found');
    return this.lockInvoiceById(tx, iv.id);
  }

  private async lockInvoiceById(tx: ErpTx, id: bigint): Promise<ErpSalesInvoice> {
    await tx.$queryRaw`SELECT id FROM erp_sales_invoices WHERE id = ${id} FOR UPDATE`;
    return tx.erpSalesInvoice.findUniqueOrThrow({ where: { id } });
  }

  private async lockNote(tx: ErpTx, scope: ErpScope, publicId: string): Promise<ErpSalesNote> {
    const n = await tx.erpSalesNote.findFirst({ where: { publicId, factoryId: scope.factory.id } });
    if (!n) throw new DomainException('http.not_found');
    await tx.$queryRaw`SELECT id FROM erp_sales_notes WHERE id = ${n.id} FOR UPDATE`;
    return n;
  }
}

// ------------------------------------------------------------------------------------- views

export function invoiceSummary(
  r: Prisma.ErpSalesInvoiceGetPayload<{ include: { customer: true; salesperson: true } }>,
): ErpSalesInvoiceSummaryDto {
  const open = r.status === 'draft' || r.status === 'voided' ? dec(0) : openOf(r);
  return {
    id: r.publicId,
    invoiceNo: r.invoiceNo,
    form: r.form,
    isTaxInvoice: r.isTaxInvoice,
    status: r.status,
    customer: partnerRef(r.customer),
    issueDate: iso(r.issueDate)!,
    dueDate: iso(r.dueDate)!,
    total: fmtMoney(r.total),
    openAmount: fmtMoney(open),
    overdue: OPEN.includes(r.status) && open.gt(0) && iso(r.dueDate)! < today(),
    salesperson: userRef(r.salesperson),
  };
}

function invoiceDto(r: IvRow, perms: ReadonlySet<string>): ErpSalesInvoiceDto {
  const open = r.status === 'draft' || r.status === 'voided' ? dec(0) : openOf(r);
  const dns = new Map<string, { id: string; doNo: string; status: string; deliverOn: string }>();
  for (const l of r.lines)
    if (l.deliveryNoteLine) {
      const d = l.deliveryNoteLine.deliveryNote;
      dns.set(d.publicId, { id: d.publicId, doNo: d.doNo, status: d.status, deliverOn: iso(d.deliverOn)! });
    }
  return {
    ...invoiceSummary(r),
    salesOrder: r.salesOrder
      ? { id: r.salesOrder.publicId, code: r.salesOrder.soNo, name: r.salesOrder.soNo }
      : null,
    paymentTermDays: r.paymentTermDays,
    customerPoNo: r.customerPoNo,
    note: r.note,
    vatMode: r.vatMode,
    vatRatePct: r.vatRatePct.toFixed(4),
    subtotal: fmtMoney(r.subtotal),
    vatAmount: fmtMoney(r.vatAmount),
    creditedAmount: fmtMoney(r.creditedAmount),
    debitedAmount: fmtMoney(r.debitedAmount),
    receivedAmount: fmtMoney(r.receivedAmount),
    lines: r.lines.map((l) => salesLineDto(l, LINE.iv)),
    deliveryNotes: [...dns.values()],
    notes: r.notes.map((n) => ({
      id: n.publicId,
      kind: n.kind,
      noteNo: n.noteNo,
      status: n.status,
      total: fmtMoney(n.total),
    })),
    receipts: r.allocations.map((a) => ({
      id: a.receipt.publicId,
      receiptNo: a.receipt.receiptNo,
      status: a.receipt.status,
      receivedOn: iso(a.receipt.receivedOn)!,
      amount: fmtMoney(a.amount),
    })),
    seller: party(r.sellerSnapshot),
    buyer: party(r.buyerSnapshot) ?? buyerOf(r.customer),
    totalInWords: bahtText(fmtMoney(r.total)),
    issuedAt: isoTs(r.issuedAt),
    voidedAt: isoTs(r.voidedAt),
    voidReason: r.voidReason,
    nextActions: nextActions(
      {
        status: r.status,
        open,
        settled:
          !dec(r.receivedAmount).isZero() ||
          r.notes.some((n) => n.status !== 'voided') ||
          r.allocations.some((a) => a.receipt.status === 'issued'),
      },
      IV_ACTIONS,
      perms,
    ),
    version: r.rowVersion,
  };
}

function noteDto(r: NoteRow, perms: ReadonlySet<string>): ErpSalesNoteDto {
  return {
    id: r.publicId,
    kind: r.kind,
    noteNo: r.noteNo,
    status: r.status,
    total: fmtMoney(r.total),
    invoice: {
      id: r.invoice.publicId,
      invoiceNo: r.invoice.invoiceNo,
      status: r.invoice.status,
      total: fmtMoney(r.invoice.total),
    },
    customer: partnerRef(r.customer),
    issueDate: iso(r.issueDate)!,
    reason: r.reason,
    reasonText: r.reasonText,
    originalValue: fmtMoney(r.originalValue),
    correctValue: fmtMoney(r.correctValue),
    difference: fmtMoney(r.difference),
    vatRatePct: r.vatRatePct.toFixed(4),
    vatAmount: fmtMoney(r.vatAmount),
    isTaxDocument: r.isTaxDocument,
    warehouse: r.warehouse ? warehouseRef(r.warehouse) : null,
    lines: r.lines.map((l) => ({
      lineNo: l.lineNo,
      description: l.description,
      amount: fmtMoney(l.amount),
      item: l.item ? itemRef(l.item) : null,
      returnQty: l.returnQty === null ? null : fmtQty(l.returnQty),
    })),
    seller: party(r.sellerSnapshot),
    buyer: party(r.buyerSnapshot),
    issuedAt: isoTs(r.issuedAt),
    voidReason: r.voidReason,
    nextActions: nextActions({ status: r.status }, NOTE_ACTIONS, perms),
    version: r.rowVersion,
  };
}

function receiptDto(r: RcRow, perms: ReadonlySet<string>): ErpCustomerReceiptDto {
  return {
    id: r.publicId,
    receiptNo: r.receiptNo,
    kind: r.kind,
    status: r.status,
    customer: partnerRef(r.customer),
    receivedOn: iso(r.receivedOn)!,
    method: r.method,
    amount: fmtMoney(r.amount),
    whtAmount: fmtMoney(r.whtAmount),
    reference: r.reference,
    chequeNo: r.chequeNo,
    chequeBank: r.chequeBank,
    chequeDate: iso(r.chequeDate),
    whtCertNo: r.whtCertNo,
    whtCertDate: iso(r.whtCertDate),
    whtFileId: r.whtFile?.publicId ?? null,
    note: r.note,
    allocations: r.allocations.map((a) => ({
      invoice: {
        id: a.invoice.publicId,
        invoiceNo: a.invoice.invoiceNo,
        status: a.invoice.status,
        total: fmtMoney(a.invoice.total),
      },
      amount: fmtMoney(a.amount),
    })),
    amountInWords: bahtText(fmtMoney(dec(r.amount).abs())),
    cancelReason: r.cancelReason,
    createdBy: r.createdBy.displayName,
    createdAt: isoTs(r.createdAt)!,
    nextActions: nextActions({ status: r.status }, RC_ACTIONS, perms),
  };
}

function billingDto(r: BnRow, perms: ReadonlySet<string>): ErpBillingNoteDto {
  return {
    id: r.publicId,
    billingNo: r.billingNo,
    status: r.status,
    customer: partnerRef(r.customer),
    billingDate: iso(r.billingDate)!,
    collectOn: iso(r.collectOn),
    total: fmtMoney(r.total),
    note: r.note,
    lines: r.lines.map((l) => ({
      invoice: {
        id: l.invoice.publicId,
        invoiceNo: l.invoice.invoiceNo,
        status: l.invoice.status,
        total: fmtMoney(l.invoice.total),
      },
      issueDate: iso(l.invoice.issueDate)!,
      dueDate: iso(l.invoice.dueDate)!,
      amount: fmtMoney(l.amount),
    })),
    cancelReason: r.cancelReason,
    nextActions: nextActions({ status: r.status }, BN_ACTIONS, perms),
  };
}
