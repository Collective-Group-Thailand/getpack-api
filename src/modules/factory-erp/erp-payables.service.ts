import { DomainException } from '@common/errors/domain.exception';
import { type MoneyValue } from '@common/money/money';
import { type ActionRule, nextActions } from '@common/next-actions/next-actions';
import { paginated, toSkipTake } from '@common/pagination/pagination';
import { addCalendarDays, bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { type Tx } from '@database/prisma.service';
import {
  type ErpPaymentMethod,
  type ErpSupplierInvoiceStatus,
  type ErpVatMode,
  type Prisma,
} from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';

import {
  AGING_BUCKETS,
  type AgingBucket,
  agingBucket,
  dec,
  documentTotals,
  fmtCost,
  fmtMoney,
  fmtQty,
  type LineVariance,
  matchLine,
  money2,
  purchaseUnitCost,
  withholding,
} from './erp.math';
import {
  type ErpAgingBucketsDto,
  type ErpApAgingDto,
  type ErpCreateSupplierInvoiceDto,
  type ErpCreateSupplierPaymentDto,
  type ErpSupplierInvoiceDto,
  type ErpSupplierInvoiceListQuery,
  type ErpSupplierInvoiceSummaryDto,
  type ErpSupplierPaymentDto,
  type ErpSupplierPaymentListQuery,
} from './erp-e2.dto';
import { itemRef, partnerRef } from './erp-views';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const today = () => bangkokDate(new Date());

/** Statuses an invoice can be paid in; `variance` waits for an approval first (D-337). */
const PAYABLE: ErpSupplierInvoiceStatus[] = ['matched', 'approved', 'partially_paid'];
const OPEN: ErpSupplierInvoiceStatus[] = ['matched', 'variance', 'approved', 'partially_paid'];

const INVOICE_INCLUDE = {
  supplier: true,
  purchaseOrder: true,
  file: { select: { publicId: true } },
  approvedBy: { select: { displayName: true } },
  lines: { include: { item: true, purchaseOrderLine: true }, orderBy: { lineNo: 'asc' } },
  allocations: { include: { payment: true }, orderBy: { id: 'asc' } },
} as const;

const PAYMENT_INCLUDE = {
  supplier: true,
  reverses: true,
  reversedBy: true,
  createdBy: { select: { displayName: true } },
  allocations: { include: { supplierInvoice: true }, orderBy: { id: 'asc' } },
} as const;

type InvoiceRow = Prisma.ErpSupplierInvoiceGetPayload<{ include: typeof INVOICE_INCLUDE }>;
type PaymentRow = Prisma.ErpSupplierPaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

interface InvoiceFacts {
  status: string;
  paid: boolean;
}

/** The factory's actions on a supplier invoice (D-337). */
export const INVOICE_ACTIONS: ActionRule<InvoiceFacts>[] = [
  { key: 'erp_ap.approve', permissions: ['factory_ap.approve'], when: (f) => f.status === 'variance' },
  { key: 'erp_ap.pay', permissions: ['factory_ap.manage'], when: (f) => PAYABLE.includes(f.status as never) },
  {
    key: 'erp_ap.cancel',
    permissions: ['factory_ap.manage'],
    irreversible: true,
    when: (f) => OPEN.includes(f.status as never) && !f.paid,
  },
];

/** The factory's actions on a supplier payment (D-338). */
export const PAYMENT_ACTIONS: ActionRule<{ reversible: boolean }>[] = [
  {
    key: 'erp_pay.reverse',
    permissions: ['factory_ap.manage'],
    irreversible: true,
    when: (f) => f.reversible,
  },
];

const VARIANCE_TH: Record<Exclude<LineVariance, null>, string> = {
  price: 'ราคาไม่ตรงใบสั่งซื้อ',
  quantity: 'จำนวนเกินที่รับเข้า',
  price_quantity: 'ราคาและจำนวนไม่ตรง',
  unordered: 'ไม่มีในใบสั่งซื้อ',
};

/**
 * What the factory owes its suppliers (E2 AP; D-337, D-338): supplier invoices matched 3-way against the
 * purchase order and the goods received, withholding tax, due dates from the supplier's credit days, payments
 * allocated to invoices (append-only — a wrong one is reversed) and the aging of what is still open.
 */
@Injectable()
export class ErpPayablesService {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------------------- invoices

  async listInvoices(scope: ErpScope, q: ErpSupplierInvoiceListQuery) {
    const where: Prisma.ErpSupplierInvoiceWhereInput = { factoryId: scope.factory.id };
    if (q.status === 'open' || q.overdue) where.status = { in: OPEN };
    else if (q.status) where.status = q.status as ErpSupplierInvoiceStatus;
    if (q.overdue) where.dueDate = { lt: day(today()) };
    if (q.supplierId) where.supplier = { publicId: q.supplierId };
    const search = q.q?.trim();
    if (search)
      where.OR = [
        { docNo: { contains: search, mode: 'insensitive' } },
        { invoiceNo: { contains: search, mode: 'insensitive' } },
        { supplier: { name: { contains: search, mode: 'insensitive' } } },
      ];
    const [rows, total] = await Promise.all([
      this.workspace.db.erpSupplierInvoice.findMany({
        where,
        include: { supplier: true },
        orderBy: [{ dueDate: 'asc' }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpSupplierInvoice.count({ where }),
    ]);
    return paginated(rows.map(invoiceSummary), total, q);
  }

  async getInvoice(
    scope: ErpScope,
    publicId: string,
    perms: ReadonlySet<string>,
  ): Promise<ErpSupplierInvoiceDto> {
    const row = await this.workspace.db.erpSupplierInvoice.findFirst({
      where: { factoryId: scope.factory.id, publicId },
      include: INVOICE_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return invoiceDto(row, perms);
  }

  /**
   * Records a supplier invoice and matches it (D-337): each line against its purchase-order line — the
   * quantity invoiced so far may not pass what was received, and the net price may not differ from the
   * order's by more than the factory's tolerance. All lines matching → `matched` (payable); otherwise
   * `variance`, which an approver must approve before it can be paid.
   */
  async createInvoice(
    scope: ErpScope,
    body: ErpCreateSupplierInvoiceDto,
    perms: ReadonlySet<string>,
  ): Promise<ErpSupplierInvoiceDto> {
    const id = await this.workspace.tx(async (tx) => {
      const settings = await this.workspace.settings(tx, scope.factory.id);
      const supplier = await tx.erpTradingPartner.findFirst({
        where: { factoryId: scope.factory.id, publicId: body.supplierId },
      });
      if (!supplier) throw new DomainException('http.not_found');
      if (supplier.kind === 'customer')
        throw new DomainException('erp.not_a_supplier', { params: { name: supplier.name } });
      const duplicate = await tx.erpSupplierInvoice.findFirst({
        where: { supplierId: supplier.id, invoiceNo: body.invoiceNo.trim(), status: { not: 'cancelled' } },
      });
      if (duplicate)
        throw new DomainException('erp.invoice_duplicate', {
          params: { invoiceNo: body.invoiceNo, docNo: duplicate.docNo },
        });
      let po: Prisma.ErpPurchaseOrderGetPayload<{ include: { lines: { include: { item: true } } } }> | null =
        null;
      if (body.purchaseOrderId) {
        po = await tx.erpPurchaseOrder.findFirst({
          where: { factoryId: scope.factory.id, publicId: body.purchaseOrderId },
          include: { lines: { include: { item: true } } },
        });
        if (!po) throw new DomainException('http.not_found');
        if (po.supplierId !== supplier.id || po.status === 'draft' || po.status === 'cancelled')
          throw new DomainException('erp.invalid_status', { params: { status: po.status } });
      }
      const vatMode = (body.vatMode ?? po?.vatMode ?? 'exclusive') as ErpVatMode;
      const vatRate = dec(body.vatRatePct ?? po?.vatRatePct?.toString() ?? '7');
      if (vatRate.gte(100))
        throw new DomainException('validation.failed', {
          errors: [{ path: 'vatRatePct', code: 'invalid', message: 'Below 100' }],
        });
      const tolerance = dec(settings.priceTolerancePct);
      const itemIds = body.lines.filter((l) => l.itemId && !l.purchaseOrderLineId).map((l) => l.itemId!);
      const items = new Map(
        (
          await tx.erpItem.findMany({ where: { factoryId: scope.factory.id, publicId: { in: itemIds } } })
        ).map((i) => [i.publicId, i]),
      );
      const lines = [];
      for (const [i, l] of body.lines.entries()) {
        const quantity = dec(l.quantity);
        const unitPrice = dec(l.unitPrice);
        if (!quantity.gt(0))
          throw new DomainException('validation.failed', {
            errors: [{ path: `lines.${i}.quantity`, code: 'invalid', message: 'Must be more than zero' }],
          });
        const amount = money2(quantity.times(unitPrice));
        if (l.purchaseOrderLineId) {
          const line = po?.lines.find((x) => x.publicId === l.purchaseOrderLineId);
          if (!line)
            throw new DomainException('validation.failed', {
              errors: [
                {
                  path: `lines.${i}.purchaseOrderLineId`,
                  code: 'invalid',
                  message: 'Not a line of the purchase order',
                },
              ],
            });
          const previous = await tx.erpSupplierInvoiceLine.aggregate({
            where: { purchaseOrderLineId: line.id, supplierInvoice: { status: { not: 'cancelled' } } },
            _sum: { quantity: true },
          });
          const ordered = purchaseUnitCost(
            dec(line.unitPrice),
            dec(line.discountPct),
            po!.vatMode,
            dec(po!.vatRatePct),
            true,
          );
          const invoiced = purchaseUnitCost(unitPrice, dec(0), vatMode, vatRate, true);
          const variance = matchLine({
            invoicedQty: quantity,
            previouslyInvoiced: dec(previous._sum.quantity ?? 0),
            receivedQty: dec(line.receivedQty),
            unitPrice: invoiced,
            orderedPrice: ordered,
            tolerancePct: tolerance,
          });
          lines.push({
            lineNo: i + 1,
            purchaseOrderLineId: line.id,
            itemId: line.itemId,
            description: l.description?.trim() || line.description || line.item.name,
            quantity: fmtQty(quantity),
            unitPrice: fmtCost(unitPrice),
            amount: fmtMoney(amount),
            receivedQty: fmtQty(line.receivedQty),
            orderedPrice: fmtCost(ordered),
            variance,
          });
          continue;
        }
        const item = l.itemId ? items.get(l.itemId) : undefined;
        if (l.itemId && !item) throw new DomainException('http.not_found');
        const description = l.description?.trim() || item?.name;
        if (!description)
          throw new DomainException('validation.failed', {
            errors: [{ path: `lines.${i}.description`, code: 'required', message: 'Describe the line' }],
          });
        lines.push({
          lineNo: i + 1,
          purchaseOrderLineId: null,
          itemId: item?.id ?? null,
          description,
          quantity: fmtQty(quantity),
          unitPrice: fmtCost(unitPrice),
          amount: fmtMoney(amount),
          receivedQty: null,
          orderedPrice: null,
          variance: 'unordered' as const,
        });
      }
      const totals = documentTotals(
        lines.map((l) => dec(l.amount)),
        vatMode,
        vatRate,
      );
      const whtRate = dec(body.whtRatePct ?? '0');
      const wht = withholding(totals.subtotal, whtRate);
      const off = lines.filter((l) => l.variance !== null);
      const invoiceDate = body.invoiceDate;
      const dueDate = body.dueDate ?? addCalendarDays(invoiceDate, supplier.paymentTermDays);
      if (dueDate < invoiceDate)
        throw new DomainException('validation.failed', {
          errors: [{ path: 'dueDate', code: 'invalid', message: 'On or after the invoice date' }],
        });
      let fileId: bigint | null = null;
      if (body.fileId) {
        const file = await tx.fileObject.findUnique({ where: { publicId: body.fileId } });
        if (!file) throw new DomainException('http.not_found');
        fileId = file.id;
      }
      const docNo = await this.workspace.nextNumber(tx, scope.factory.id, 'ap', day(invoiceDate));
      const inv = await tx.erpSupplierInvoice.create({
        data: {
          factoryId: scope.factory.id,
          docNo,
          supplierId: supplier.id,
          purchaseOrderId: po?.id ?? null,
          invoiceNo: body.invoiceNo.trim(),
          taxInvoiceNo: body.taxInvoiceNo ?? null,
          invoiceDate: day(invoiceDate),
          dueDate: day(dueDate),
          vatMode,
          vatRatePct: vatRate.toFixed(4),
          subtotal: fmtMoney(totals.subtotal),
          vatAmount: fmtMoney(totals.vatAmount),
          total: fmtMoney(totals.total),
          whtRatePct: whtRate.toFixed(4),
          whtAmount: fmtMoney(wht),
          payableAmount: fmtMoney(totals.total.minus(wht)),
          status: off.length ? 'variance' : 'matched',
          matchNote: off.length
            ? off.map((l) => `#${l.lineNo} ${VARIANCE_TH[l.variance!]}`).join(' · ')
            : null,
          note: body.note ?? null,
          fileId,
          createdById: scope.actor.userId,
          lines: { create: lines },
        },
      });
      await this.workspace.record(
        tx,
        scope,
        'erp_supplier_invoice.recorded',
        'erp_supplier_invoice',
        inv.publicId,
        {
          docNo,
          matched: off.length === 0,
        },
      );
      return inv.publicId;
    });
    return this.getInvoice(scope, id, perms);
  }

  private async lockInvoice(tx: Tx, scope: ErpScope, publicId: string) {
    const found = await tx.erpSupplierInvoice.findFirst({ where: { factoryId: scope.factory.id, publicId } });
    if (!found) throw new DomainException('http.not_found');
    await tx.$queryRaw`SELECT id FROM erp_supplier_invoices WHERE id = ${found.id} FOR UPDATE`;
    return (await tx.erpSupplierInvoice.findUnique({ where: { id: found.id } }))!;
  }

  /** Approves an invoice that did not match (D-337), with the approver's note; audited. */
  async approveInvoice(scope: ErpScope, publicId: string, note: string | null, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const inv = await this.lockInvoice(tx, scope, publicId);
      if (inv.status !== 'variance')
        throw new DomainException('erp.invalid_status', { params: { status: inv.status } });
      await tx.erpSupplierInvoice.update({
        where: { id: inv.id },
        data: {
          status: 'approved',
          approvedAt: new Date(),
          approvedById: scope.actor.userId,
          ...(note && { note: inv.note ? `${inv.note}\n${note}` : note }),
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        category: 'approval',
        action: 'erp.supplier_invoice_approved',
        resourceType: 'erp_supplier_invoice',
        resourcePublicId: publicId,
        data: { docNo: inv.docNo, matchNote: inv.matchNote },
      });
      await this.workspace.record(
        tx,
        scope,
        'erp_supplier_invoice.approved',
        'erp_supplier_invoice',
        publicId,
        {
          docNo: inv.docNo,
        },
      );
    });
    return this.getInvoice(scope, publicId, perms);
  }

  /** Cancels an invoice nothing was paid on (entered twice, the supplier withdrew it). */
  async cancelInvoice(scope: ErpScope, publicId: string, reason: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const inv = await this.lockInvoice(tx, scope, publicId);
      if (!OPEN.includes(inv.status) || !dec(inv.paidAmount).isZero())
        throw new DomainException('erp.invalid_status', { params: { status: inv.status } });
      await tx.erpSupplierInvoice.update({
        where: { id: inv.id },
        data: { status: 'cancelled', cancelReason: reason, rowVersion: { increment: 1 } },
      });
      await this.workspace.record(
        tx,
        scope,
        'erp_supplier_invoice.cancelled',
        'erp_supplier_invoice',
        publicId,
        {
          docNo: inv.docNo,
        },
      );
    });
    return this.getInvoice(scope, publicId, perms);
  }

  // ------------------------------------------------------------------------------- payments

  async listPayments(scope: ErpScope, q: ErpSupplierPaymentListQuery, perms: ReadonlySet<string>) {
    const where: Prisma.ErpSupplierPaymentWhereInput = { factoryId: scope.factory.id };
    if (q.supplierId) where.supplier = { publicId: q.supplierId };
    const search = q.q?.trim();
    if (search)
      where.OR = [
        { paymentNo: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
        { supplier: { name: { contains: search, mode: 'insensitive' } } },
      ];
    const [rows, total] = await Promise.all([
      this.workspace.db.erpSupplierPayment.findMany({
        where,
        include: PAYMENT_INCLUDE,
        orderBy: [{ paidOn: 'desc' }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpSupplierPayment.count({ where }),
    ]);
    return paginated(
      rows.map((r) => paymentDto(r, perms)),
      total,
      q,
    );
  }

  async getPayment(
    scope: ErpScope,
    publicId: string,
    perms: ReadonlySet<string>,
  ): Promise<ErpSupplierPaymentDto> {
    const row = await this.workspace.db.erpSupplierPayment.findFirst({
      where: { factoryId: scope.factory.id, publicId },
      include: PAYMENT_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return paymentDto(row, perms);
  }

  /** Pays a supplier (D-338): numbered `PV`, allocated to its payable invoices, none beyond what is open. */
  async pay(scope: ErpScope, body: ErpCreateSupplierPaymentDto, perms: ReadonlySet<string>) {
    const ids = body.allocations.map((a) => a.supplierInvoiceId);
    if (new Set(ids).size !== ids.length)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'allocations', code: 'duplicate', message: 'One allocation per invoice' }],
      });
    const paidOn = body.paidOn ?? today();
    const id = await this.workspace.tx(async (tx) => {
      const supplier = await tx.erpTradingPartner.findFirst({
        where: { factoryId: scope.factory.id, publicId: body.supplierId },
      });
      if (!supplier) throw new DomainException('http.not_found');
      let total = dec(0);
      const allocations = [];
      for (const [i, a] of body.allocations.entries()) {
        const inv = await this.lockInvoice(tx, scope, a.supplierInvoiceId);
        if (inv.supplierId !== supplier.id) throw new DomainException('http.not_found');
        if (!PAYABLE.includes(inv.status))
          throw new DomainException('erp.invoice_not_payable', {
            params: { docNo: inv.docNo, status: inv.status },
          });
        const amount = dec(a.amount);
        const open = dec(inv.payableAmount).minus(dec(inv.paidAmount));
        if (!amount.gt(0) || amount.gt(open))
          throw new DomainException('erp.overpayment', {
            params: { docNo: inv.docNo, open: fmtMoney(open) },
            errors: [
              { path: `allocations.${i}.amount`, code: 'invalid', message: `At most ${fmtMoney(open)}` },
            ],
          });
        total = total.plus(amount);
        const paid = dec(inv.paidAmount).plus(amount);
        await tx.erpSupplierInvoice.update({
          where: { id: inv.id },
          data: {
            paidAmount: fmtMoney(paid),
            status: paid.gte(dec(inv.payableAmount)) ? 'paid' : 'partially_paid',
            rowVersion: { increment: 1 },
          },
        });
        allocations.push({ supplierInvoiceId: inv.id, amount: fmtMoney(amount) });
      }
      const paymentNo = await this.workspace.nextNumber(tx, scope.factory.id, 'pv', day(paidOn));
      const payment = await tx.erpSupplierPayment.create({
        data: {
          factoryId: scope.factory.id,
          paymentNo,
          supplierId: supplier.id,
          paidOn: day(paidOn),
          method: body.method as ErpPaymentMethod,
          reference: body.reference ?? null,
          amount: fmtMoney(total),
          note: body.note ?? null,
          createdById: scope.actor.userId,
          allocations: { create: allocations },
        },
      });
      await this.audit.record(tx, {
        category: 'data_access',
        action: 'erp.supplier_paid',
        resourceType: 'erp_supplier_payment',
        resourcePublicId: payment.publicId,
        data: { paymentNo, invoices: allocations.length },
      });
      await this.workspace.record(
        tx,
        scope,
        'erp_supplier_payment.recorded',
        'erp_supplier_payment',
        payment.publicId,
        {
          paymentNo,
        },
      );
      return payment.publicId;
    });
    return this.getPayment(scope, id, perms);
  }

  /** Reverses a payment (D-338): a negative payment names it, and its invoices are open again. */
  async reverse(scope: ErpScope, publicId: string, reason: string, perms: ReadonlySet<string>) {
    const id = await this.workspace.tx(async (tx) => {
      const found = await tx.erpSupplierPayment.findFirst({
        where: { factoryId: scope.factory.id, publicId },
        include: { allocations: true, reversedBy: true },
      });
      if (!found) throw new DomainException('http.not_found');
      await tx.$queryRaw`SELECT id FROM erp_supplier_payments WHERE id = ${found.id} FOR UPDATE`;
      if (found.reversesId !== null || found.reversedBy)
        throw new DomainException('erp.invalid_status', { params: { status: 'reversed' } });
      for (const a of found.allocations) {
        const inv = await tx.erpSupplierInvoice.findUniqueOrThrow({ where: { id: a.supplierInvoiceId } });
        await tx.$queryRaw`SELECT id FROM erp_supplier_invoices WHERE id = ${inv.id} FOR UPDATE`;
        const paid = dec(inv.paidAmount).minus(dec(a.amount));
        await tx.erpSupplierInvoice.update({
          where: { id: inv.id },
          data: {
            paidAmount: fmtMoney(paid.isNegative() ? 0 : paid),
            status: paid.gt(0) ? 'partially_paid' : inv.approvedAt ? 'approved' : 'matched',
            rowVersion: { increment: 1 },
          },
        });
      }
      const paymentNo = await this.workspace.nextNumber(tx, scope.factory.id, 'pv');
      const reversal = await tx.erpSupplierPayment.create({
        data: {
          factoryId: scope.factory.id,
          paymentNo,
          supplierId: found.supplierId,
          paidOn: day(today()),
          method: found.method,
          reference: found.paymentNo,
          amount: fmtMoney(dec(found.amount).negated()),
          reversesId: found.id,
          note: reason,
          createdById: scope.actor.userId,
          allocations: {
            create: found.allocations.map((a) => ({
              supplierInvoiceId: a.supplierInvoiceId,
              amount: fmtMoney(dec(a.amount).negated()),
            })),
          },
        },
      });
      await this.audit.record(tx, {
        category: 'data_access',
        action: 'erp.supplier_payment_reversed',
        resourceType: 'erp_supplier_payment',
        resourcePublicId: publicId,
        data: { paymentNo: found.paymentNo, reversal: paymentNo, reason },
      });
      await this.workspace.record(
        tx,
        scope,
        'erp_supplier_payment.reversed',
        'erp_supplier_payment',
        publicId,
        {
          paymentNo: found.paymentNo,
          reversal: paymentNo,
        },
      );
      return reversal.publicId;
    });
    return this.getPayment(scope, id, perms);
  }

  // ---------------------------------------------------------------------------------- aging

  /** What is still open per supplier by days past due (D-338). */
  async aging(scope: ErpScope): Promise<ErpApAgingDto> {
    const asOf = today();
    const soon = addCalendarDays(asOf, 7);
    const rows = await this.workspace.db.erpSupplierInvoice.findMany({
      where: { factoryId: scope.factory.id, status: { in: OPEN } },
      include: { supplier: true },
    });
    const zero = () =>
      Object.fromEntries(AGING_BUCKETS.map((b) => [b, dec(0)])) as Record<AgingBucket, MoneyValue>;
    const totals = zero();
    let dueSoon = dec(0);
    const bySupplier = new Map<
      bigint,
      { supplier: (typeof rows)[number]['supplier']; n: number; b: Record<AgingBucket, MoneyValue> }
    >();
    for (const r of rows) {
      const open = dec(r.payableAmount).minus(dec(r.paidAmount));
      if (!open.gt(0)) continue;
      const due = iso(r.dueDate)!;
      const bucket = agingBucket(due, asOf);
      totals[bucket] = totals[bucket].plus(open);
      if (due >= asOf && due <= soon) dueSoon = dueSoon.plus(open);
      const s = bySupplier.get(r.supplierId) ?? { supplier: r.supplier, n: 0, b: zero() };
      s.n += 1;
      s.b[bucket] = s.b[bucket].plus(open);
      bySupplier.set(r.supplierId, s);
    }
    const dto = (b: Record<AgingBucket, MoneyValue>): ErpAgingBucketsDto => ({
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
      totals: dto(totals),
      suppliers: [...bySupplier.values()]
        .map((s) => ({ supplier: partnerRef(s.supplier), invoices: s.n, buckets: dto(s.b) }))
        .sort((a, b) => dec(b.buckets.total).comparedTo(dec(a.buckets.total))),
    };
  }
}

function invoiceSummary(
  r: Prisma.ErpSupplierInvoiceGetPayload<{ include: { supplier: true } }>,
): ErpSupplierInvoiceSummaryDto {
  const outstanding = r.status === 'cancelled' ? dec(0) : dec(r.payableAmount).minus(dec(r.paidAmount));
  return {
    id: r.publicId,
    docNo: r.docNo,
    supplier: partnerRef(r.supplier),
    invoiceNo: r.invoiceNo,
    invoiceDate: iso(r.invoiceDate)!,
    dueDate: iso(r.dueDate)!,
    overdue: OPEN.includes(r.status) && outstanding.gt(0) && iso(r.dueDate)! < today(),
    total: fmtMoney(r.total),
    payableAmount: fmtMoney(r.payableAmount),
    outstanding: fmtMoney(outstanding),
    status: r.status,
    currency: 'THB',
  };
}

export function invoiceDto(r: InvoiceRow, perms: ReadonlySet<string>): ErpSupplierInvoiceDto {
  return {
    ...invoiceSummary(r),
    purchaseOrder: r.purchaseOrder
      ? { id: r.purchaseOrder.publicId, code: r.purchaseOrder.poNo ?? '', name: r.purchaseOrder.poNo ?? '' }
      : null,
    taxInvoiceNo: r.taxInvoiceNo,
    vatMode: r.vatMode,
    vatRatePct: dec(r.vatRatePct).toFixed(4),
    subtotal: fmtMoney(r.subtotal),
    vatAmount: fmtMoney(r.vatAmount),
    whtRatePct: dec(r.whtRatePct).toFixed(4),
    whtAmount: fmtMoney(r.whtAmount),
    paidAmount: fmtMoney(r.paidAmount),
    matchNote: r.matchNote,
    note: r.note,
    fileId: r.file?.publicId ?? null,
    approvedAt: r.approvedAt ? toBangkokIso(r.approvedAt) : null,
    approvedBy: r.approvedBy?.displayName ?? null,
    cancelReason: r.cancelReason,
    createdAt: toBangkokIso(r.createdAt),
    lines: r.lines.map((l) => ({
      lineNo: l.lineNo,
      purchaseOrderLineId: l.purchaseOrderLine?.publicId ?? null,
      item: l.item ? itemRef(l.item) : null,
      description: l.description,
      quantity: fmtQty(l.quantity),
      unitPrice: fmtCost(l.unitPrice),
      amount: fmtMoney(l.amount),
      receivedQty: l.receivedQty === null ? null : fmtQty(l.receivedQty),
      orderedPrice: l.orderedPrice === null ? null : fmtCost(l.orderedPrice),
      variance: l.variance,
    })),
    payments: r.allocations.map((a) => ({
      id: a.payment.publicId,
      paymentNo: a.payment.paymentNo,
      paidOn: iso(a.payment.paidOn)!,
      amount: fmtMoney(a.amount),
    })),
    nextActions: nextActions({ status: r.status, paid: !dec(r.paidAmount).isZero() }, INVOICE_ACTIONS, perms),
    version: r.rowVersion,
  };
}

export function paymentDto(r: PaymentRow, perms: ReadonlySet<string>): ErpSupplierPaymentDto {
  const ref = (p: { publicId: string; paymentNo: string } | null) =>
    p ? { id: p.publicId, code: p.paymentNo, name: p.paymentNo } : null;
  return {
    id: r.publicId,
    paymentNo: r.paymentNo,
    supplier: partnerRef(r.supplier),
    paidOn: iso(r.paidOn)!,
    method: r.method,
    reference: r.reference,
    amount: fmtMoney(r.amount),
    currency: 'THB',
    note: r.note,
    reverses: ref(r.reverses),
    reversedBy: ref(r.reversedBy),
    allocations: r.allocations.map((a) => ({
      invoice: {
        id: a.supplierInvoice.publicId,
        code: a.supplierInvoice.docNo,
        name: a.supplierInvoice.invoiceNo,
      },
      amount: fmtMoney(a.amount),
    })),
    by: r.createdBy.displayName,
    createdAt: toBangkokIso(r.createdAt),
    nextActions: nextActions({ reversible: r.reversesId === null && !r.reversedBy }, PAYMENT_ACTIONS, perms),
  };
}
