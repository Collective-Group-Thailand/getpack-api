import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { type ActionRule, nextActions } from '@common/next-actions/next-actions';
import { paginated, toSkipTake } from '@common/pagination/pagination';
import { type ErpTx } from '@database/erp-prisma.service';
import {
  type ErpDeliveryStatus,
  type ErpFulfilment,
  type ErpSalesOrder,
  type ErpSalesOrderStatus,
  type ErpVatMode,
  type Prisma,
} from '@generated/prisma-erp/client';
import { Injectable } from '@nestjs/common';

import { dec, fmtCost, fmtMoney, fmtQty, money2 } from './erp.math';
import {
  type ErpConfirmSalesOrderDto,
  type ErpCreateDeliveryNoteDto,
  type ErpCreditExposureDto,
  type ErpDeliveredDto,
  type ErpDeliveryNoteDto,
  type ErpDeliveryNoteListQuery,
  type ErpDeliveryNoteSummaryDto,
  type ErpSalesOrderDto,
  type ErpSalesOrderListQuery,
  type ErpSalesOrderSummaryDto,
  type ErpSaveSalesOrderDto,
} from './erp-e4.dto';
import { ErpProductionService } from './erp-production.service';
import {
  customerOf,
  day,
  factoryUser,
  iso,
  isoTs,
  LINE,
  lineId,
  lineIdOf,
  partnerRef,
  priceLines,
  salesLineDto,
  today,
  totalsOf,
  userRef,
  vatModeFor,
} from './erp-sales.shared';
import { ErpStockService, type StockEntry } from './erp-stock.service';
import { itemRef, warehouseRef } from './erp-views';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

const OPEN_SO: ErpSalesOrderStatus[] = ['confirmed', 'partially_delivered'];
const LIVE_SO: ErpSalesOrderStatus[] = ['confirmed', 'partially_delivered', 'delivered'];
const OPEN_INVOICE = ['issued', 'partially_paid'] as const;

const SO_INCLUDE = {
  customer: true,
  quotation: true,
  opportunity: true,
  salesperson: true,
  warehouse: true,
  lines: { include: { item: true, productionOrder: true }, orderBy: { lineNo: 'asc' } },
  deliveryNotes: { orderBy: { id: 'asc' } },
  invoices: { orderBy: { id: 'asc' } },
} as const satisfies Prisma.ErpSalesOrderInclude;
type SoRow = Prisma.ErpSalesOrderGetPayload<{ include: typeof SO_INCLUDE }>;

const DO_INCLUDE = {
  customer: true,
  salesOrder: true,
  warehouse: true,
  lines: { include: { item: true, salesOrderLine: true }, orderBy: { lineNo: 'asc' } },
  podFile: true,
} as const satisfies Prisma.ErpDeliveryNoteInclude;
type DoRow = Prisma.ErpDeliveryNoteGetPayload<{ include: typeof DO_INCLUDE }>;

interface SoFacts {
  status: ErpSalesOrderStatus;
  toDeliver: boolean;
  toInvoice: boolean;
  delivered: boolean;
}

export const SO_ACTIONS: ActionRule<SoFacts>[] = [
  { key: 'erp_so.edit', permissions: ['factory_sales.manage'], when: (s) => s.status === 'draft' },
  { key: 'erp_so.confirm', permissions: ['factory_sales.manage'], when: (s) => s.status === 'draft' },
  {
    key: 'erp_so.deliver',
    permissions: ['factory_delivery.manage'],
    when: (s) => OPEN_SO.includes(s.status) && s.toDeliver,
  },
  {
    key: 'erp_so.invoice',
    permissions: ['factory_receivables.manage'],
    when: (s) => LIVE_SO.includes(s.status) && s.toInvoice,
  },
  {
    key: 'erp_so.close',
    permissions: ['factory_sales.manage'],
    when: (s) => s.status === 'partially_delivered' || s.status === 'delivered',
  },
  {
    key: 'erp_so.cancel',
    permissions: ['factory_sales.manage'],
    irreversible: true,
    when: (s) => (s.status === 'draft' || s.status === 'confirmed') && !s.delivered,
  },
  { key: 'erp_so.pdf', permissions: ['factory_sales.read'], when: (s) => s.status !== 'draft' },
];

interface DoFacts {
  status: ErpDeliveryStatus;
  invoiced: boolean;
  anyInvoiced: boolean;
}

export const DO_ACTIONS: ActionRule<DoFacts>[] = [
  {
    key: 'erp_do.issue',
    permissions: ['factory_delivery.manage'],
    irreversible: true,
    when: (d) => d.status === 'draft',
  },
  { key: 'erp_do.deliver', permissions: ['factory_delivery.manage'], when: (d) => d.status === 'issued' },
  {
    key: 'erp_do.invoice',
    permissions: ['factory_receivables.manage'],
    when: (d) => (d.status === 'issued' || d.status === 'delivered') && !d.invoiced,
  },
  {
    key: 'erp_do.cancel',
    permissions: ['factory_delivery.manage'],
    irreversible: true,
    when: (d) =>
      d.status === 'draft' || ((d.status === 'issued' || d.status === 'delivered') && !d.anyInvoiced)
        ? true
        : d.status === 'cancelled'
          ? false
          : 'ออกใบแจ้งหนี้แล้ว — ใช้ใบลดหนี้รับคืนสินค้าแทน',
  },
  { key: 'erp_do.pdf', permissions: ['factory_sales.read'], when: (d) => d.status !== 'draft' },
];

/**
 * Sales orders and delivery notes (D-361, D-362): an order confirmed against the customer's credit limit reserves
 * stock or plans production per line; deliveries take goods out of stock at the moving average, partial or whole,
 * and keep the order's delivered quantities; an order closes when everything is delivered and invoiced.
 */
@Injectable()
export class ErpSalesOrdersService {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly stock: ErpStockService,
    private readonly production: ErpProductionService,
  ) {}

  // ------------------------------------------------------------------------------ sales orders

  async list(scope: ErpScope, q: ErpSalesOrderListQuery) {
    const where: Prisma.ErpSalesOrderWhereInput = { factoryId: scope.factory.id };
    if (q.status === 'open') where.status = { in: OPEN_SO };
    else if (q.status) where.status = q.status as ErpSalesOrderStatus;
    if (q.customerId) where.customer = { publicId: q.customerId };
    if (q.q)
      where.OR = [
        { soNo: { contains: q.q, mode: 'insensitive' } },
        { customerPoNo: { contains: q.q, mode: 'insensitive' } },
        { customer: { name: { contains: q.q, mode: 'insensitive' } } },
      ];
    const [rows, total] = await Promise.all([
      this.workspace.db.erpSalesOrder.findMany({
        where,
        include: { customer: true, salesperson: true, lines: true },
        orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpSalesOrder.count({ where }),
    ]);
    return paginated(rows.map(soSummary), total, q);
  }

  async get(scope: ErpScope, publicId: string, perms: ReadonlySet<string>): Promise<ErpSalesOrderDto> {
    const row = await this.workspace.db.erpSalesOrder.findFirst({
      where: { publicId, factoryId: scope.factory.id },
      include: SO_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    const credit = await this.exposure(
      this.workspace.db,
      row.customerId,
      row.status === 'draft' ? row : null,
    );
    return soDto(row, credit, perms);
  }

  async create(
    scope: ErpScope,
    body: ErpSaveSalesOrderDto,
    perms: ReadonlySet<string>,
  ): Promise<ErpSalesOrderDto> {
    const id = await this.workspace.tx(async (tx) => {
      const data = await this.fields(tx, scope, body, null);
      const soNo = await this.workspace.nextNumber(tx, scope.factory.id, 'so');
      const so = await tx.erpSalesOrder.create({
        data: { factoryId: scope.factory.id, soNo, createdById: scope.actor.userId, ...data },
      });
      await this.workspace.record(tx, scope, 'erp_sales_order.drafted', 'erp_sales_order', so.publicId, {
        soNo,
      });
      return so.publicId;
    });
    return this.get(scope, id, perms);
  }

  /** A draft order from an accepted quotation (D-361): its lines, prices and terms. */
  async fromQuotation(scope: ErpScope, quotePublicId: string, perms: ReadonlySet<string>) {
    const id = await this.workspace.tx(async (tx) => {
      const q = await tx.erpQuotation.findFirst({
        where: { publicId: quotePublicId, factoryId: scope.factory.id },
        include: {
          lines: { include: { item: true }, orderBy: { lineNo: 'asc' } },
          customer: true,
          salesOrders: true,
        },
      });
      if (!q) throw new DomainException('http.not_found');
      if (q.status !== 'accepted')
        throw new DomainException('erp.invalid_status', { params: { status: q.status } });
      const existing = q.salesOrders.find((s) => s.status !== 'cancelled');
      if (existing) return existing.publicId;
      const warehouse = await this.workspace.defaultWarehouse(tx, scope.factory.id, scope.actor.userId);
      const soNo = await this.workspace.nextNumber(tx, scope.factory.id, 'so');
      const so = await tx.erpSalesOrder.create({
        data: {
          factoryId: scope.factory.id,
          soNo,
          customerId: q.customerId,
          quotationId: q.id,
          opportunityId: q.opportunityId,
          salespersonId: q.salespersonId,
          customerPoNo: q.customerPoNo,
          orderDate: day(today()),
          deliveryDate: q.leadTimeDays
            ? day(
                new Date(Date.parse(`${today()}T00:00:00Z`) + q.leadTimeDays * 86_400_000)
                  .toISOString()
                  .slice(0, 10),
              )
            : null,
          warehouseId: warehouse.id,
          paymentTermDays: q.paymentTermDays,
          shipToAddress: q.customer.address,
          vatMode: q.vatMode,
          vatRatePct: q.vatRatePct,
          subtotal: q.subtotal,
          vatAmount: q.vatAmount,
          total: q.total,
          createdById: scope.actor.userId,
          lines: {
            create: q.lines.map((l) => ({
              lineNo: l.lineNo,
              itemId: l.itemId,
              description: l.description,
              quantity: l.quantity,
              unit: l.unit,
              unitPrice: l.unitPrice,
              discountPct: l.discountPct,
              amount: l.amount,
              fulfilment: l.itemId ? 'stock' : 'service',
            })),
          },
        },
      });
      await this.workspace.record(tx, scope, 'erp_sales_order.drafted', 'erp_sales_order', so.publicId, {
        soNo,
        quoteNo: q.quoteNo,
      });
      return so.publicId;
    });
    return this.get(scope, id, perms);
  }

  async update(
    scope: ErpScope,
    publicId: string,
    ifMatch: string | undefined,
    body: ErpSaveSalesOrderDto,
    perms: ReadonlySet<string>,
  ): Promise<ErpSalesOrderDto> {
    await this.workspace.tx(async (tx) => {
      const so = await this.lock(tx, scope, publicId);
      assertIfMatch(ifMatch, etagOf(so.publicId, so.rowVersion));
      if (so.status !== 'draft')
        throw new DomainException('erp.invalid_status', { params: { status: so.status } });
      const data = await this.fields(tx, scope, body, so);
      await tx.erpSalesOrderLine.deleteMany({ where: { salesOrderId: so.id } });
      await tx.erpSalesOrder.update({
        where: { id: so.id },
        data: { ...data, updatedById: scope.actor.userId, rowVersion: { increment: 1 } },
      });
    });
    return this.get(scope, publicId, perms);
  }

  /**
   * Confirms a draft (D-361): checks the credit limit (an approver may override with a reason), reserves the
   * stock lines from the warehouse and plans a production order for each make-to-order line.
   */
  async confirm(
    scope: ErpScope,
    publicId: string,
    body: ErpConfirmSalesOrderDto,
    perms: ReadonlySet<string>,
  ) {
    await this.workspace.tx(async (tx) => {
      const so = await this.lock(tx, scope, publicId);
      if (so.status !== 'draft')
        throw new DomainException('erp.invalid_status', { params: { status: so.status } });
      const customer = await tx.erpTradingPartner.findUniqueOrThrow({ where: { id: so.customerId } });
      const credit = await this.exposure(tx, so.customerId, so);
      let override: string | null = null;
      if (credit.over) {
        if (!body.overrideReason || !perms.has('factory_sales.approve'))
          throw new DomainException('erp.credit_limit_exceeded', {
            params: {
              customer: customer.name,
              exposure: fmtMoney(dec(credit.receivables).plus(dec(credit.openOrders))),
              limit: credit.limit ?? '0.00',
            },
          });
        override = body.overrideReason;
      }
      const lines = await tx.erpSalesOrderLine.findMany({
        where: { salesOrderId: so.id },
        include: { item: true },
        orderBy: { lineNo: 'asc' },
      });
      for (const line of lines) {
        if (line.fulfilment === 'stock' && line.itemId) {
          const got = await this.stock.reserve(
            tx,
            scope.factory.id,
            line.itemId,
            so.warehouseId,
            dec(line.quantity),
          );
          await tx.erpSalesOrderLine.update({ where: { id: line.id }, data: { reservedQty: fmtQty(got) } });
        }
        if (line.fulfilment === 'make' && line.item) {
          const recipe = await tx.erpRecipe.findFirst({
            where: { factoryId: scope.factory.id, itemId: line.item.id, status: 'active' },
          });
          if (!recipe) throw new DomainException('erp.recipe_required', { params: { item: line.item.name } });
          const mo = await this.production.plan(tx, scope, {
            source: 'sales_order',
            itemId: line.item.publicId,
            quantity: fmtQty(line.quantity),
            title: `${so.soNo} · ${customer.name}`,
            dueOn: so.deliveryDate ? iso(so.deliveryDate) : null,
            warehouseId: undefined,
          });
          await tx.erpSalesOrderLine.update({ where: { id: line.id }, data: { productionOrderId: mo.id } });
        }
      }
      await tx.erpSalesOrder.update({
        where: { id: so.id },
        data: {
          status: 'confirmed',
          confirmedAt: new Date(),
          confirmedById: scope.actor.userId,
          creditOverrideReason: override,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(tx, scope, 'erp_sales_order.confirmed', 'erp_sales_order', so.publicId, {
        soNo: so.soNo,
        creditOverride: override !== null,
      });
    });
    return this.get(scope, publicId, perms);
  }

  async close(scope: ErpScope, publicId: string, reason: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const so = await this.lock(tx, scope, publicId);
      if (so.status !== 'partially_delivered' && so.status !== 'delivered')
        throw new DomainException('erp.invalid_status', { params: { status: so.status } });
      await this.releaseReservations(tx, so);
      await tx.erpSalesOrder.update({
        where: { id: so.id },
        data: {
          status: 'closed',
          closedAt: new Date(),
          closeReason: reason,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(tx, scope, 'erp_sales_order.closed', 'erp_sales_order', so.publicId, {
        soNo: so.soNo,
      });
    });
    return this.get(scope, publicId, perms);
  }

  /** Cancels an order with nothing delivered (D-361): reservations go back, planned production is cancelled. */
  async cancel(scope: ErpScope, publicId: string, reason: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const so = await this.lock(tx, scope, publicId);
      if (so.status !== 'draft' && so.status !== 'confirmed')
        throw new DomainException('erp.invalid_status', { params: { status: so.status } });
      const lines = await tx.erpSalesOrderLine.findMany({
        where: { salesOrderId: so.id },
        include: { productionOrder: true },
      });
      if (lines.some((l) => dec(l.deliveredQty).gt(0)))
        throw new DomainException('erp.invalid_status', { params: { status: 'partially_delivered' } });
      await this.releaseReservations(tx, so);
      for (const l of lines)
        if (l.productionOrder && ['planned', 'released'].includes(l.productionOrder.status))
          await this.production.cancelIn(
            tx,
            scope,
            l.productionOrder.publicId,
            `ยกเลิกใบสั่งขาย ${so.soNo}: ${reason}`,
          );
      await tx.erpSalesOrder.update({
        where: { id: so.id },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: reason,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(tx, scope, 'erp_sales_order.cancelled', 'erp_sales_order', so.publicId, {
        soNo: so.soNo,
      });
    });
    return this.get(scope, publicId, perms);
  }

  /** Delivered status from the lines; closes itself when everything is delivered and invoiced (D-361). */
  async refresh(tx: ErpTx, salesOrderId: bigint): Promise<void> {
    const so = await tx.erpSalesOrder.findUniqueOrThrow({
      where: { id: salesOrderId },
      include: { lines: true },
    });
    if (!LIVE_SO.includes(so.status)) return;
    const goods = so.lines.filter((l) => l.fulfilment !== 'service');
    const delivered = goods.reduce((a, l) => a.plus(dec(l.deliveredQty)), dec(0));
    const allDelivered = goods.every((l) => dec(l.deliveredQty).gte(dec(l.quantity)));
    const allInvoiced = so.lines.every((l) => dec(l.invoicedQty).gte(dec(l.quantity)));
    const status: ErpSalesOrderStatus =
      allDelivered && allInvoiced
        ? 'closed'
        : allDelivered
          ? 'delivered'
          : delivered.gt(0) || (goods.length === 0 && so.lines.some((l) => dec(l.invoicedQty).gt(0)))
            ? 'partially_delivered'
            : 'confirmed';
    if (status !== so.status)
      await tx.erpSalesOrder.update({
        where: { id: so.id },
        data: {
          status,
          ...(status === 'closed' && { closedAt: new Date() }),
          rowVersion: { increment: 1 },
        },
      });
  }

  /**
   * The customer's credit position (D-361): open receivables plus confirmed orders not yet invoiced, and — for a
   * draft being confirmed — that draft; over when a limit is set and the sum passes it.
   */
  async exposure(
    tx: ErpTx,
    customerId: bigint,
    including: ErpSalesOrder | null,
  ): Promise<ErpCreditExposureDto> {
    const customer = await tx.erpTradingPartner.findUniqueOrThrow({ where: { id: customerId } });
    const invoices = await tx.erpSalesInvoice.findMany({
      where: { customerId, status: { in: [...OPEN_INVOICE] } },
    });
    const receivables = invoices.reduce(
      (a, i) =>
        a.plus(
          dec(i.total).plus(dec(i.debitedAmount)).minus(dec(i.creditedAmount)).minus(dec(i.receivedAmount)),
        ),
      dec(0),
    );
    const orders = await tx.erpSalesOrder.findMany({
      where: { customerId, status: { in: LIVE_SO } },
      include: { lines: true },
    });
    const uninvoiced = (o: {
      total: Prisma.Decimal;
      subtotal: Prisma.Decimal;
      lines: { amount: Prisma.Decimal; quantity: Prisma.Decimal; invoicedQty: Prisma.Decimal }[];
    }) => {
      const net = o.lines.reduce(
        (a, l) =>
          a.plus(
            dec(l.amount)
              .times(dec(l.quantity).minus(dec(l.invoicedQty)))
              .div(dec(l.quantity)),
          ),
        dec(0),
      );
      return dec(o.subtotal).gt(0) ? money2(net.times(dec(o.total)).div(dec(o.subtotal))) : dec(0);
    };
    let open = orders.reduce((a, o) => a.plus(uninvoiced(o)), dec(0));
    if (including && including.status === 'draft') open = open.plus(dec(including.total));
    const limit = customer.creditLimit === null ? null : dec(customer.creditLimit);
    return {
      limit: limit === null ? null : fmtMoney(limit),
      receivables: fmtMoney(receivables),
      openOrders: fmtMoney(open),
      over: limit !== null && receivables.plus(open).gt(limit),
    };
  }

  private async releaseReservations(tx: ErpTx, so: ErpSalesOrder) {
    const lines = await tx.erpSalesOrderLine.findMany({ where: { salesOrderId: so.id } });
    for (const l of lines)
      if (l.itemId && dec(l.reservedQty).gt(0)) {
        await this.stock.unreserve(tx, l.itemId, so.warehouseId, dec(l.reservedQty));
        await tx.erpSalesOrderLine.update({ where: { id: l.id }, data: { reservedQty: '0' } });
      }
  }

  private async lock(tx: ErpTx, scope: ErpScope, publicId: string): Promise<ErpSalesOrder> {
    const so = await tx.erpSalesOrder.findFirst({ where: { publicId, factoryId: scope.factory.id } });
    if (!so) throw new DomainException('http.not_found');
    await tx.$queryRaw`SELECT id FROM erp_sales_orders WHERE id = ${so.id} FOR UPDATE`;
    return so;
  }

  private async fields(
    tx: ErpTx,
    scope: ErpScope,
    body: ErpSaveSalesOrderDto,
    current: ErpSalesOrder | null,
  ) {
    const customer = await customerOf(tx, scope, body.customerId);
    const opportunity = body.opportunityId
      ? await tx.erpOpportunity.findFirst({
          where: { publicId: body.opportunityId, factoryId: scope.factory.id },
        })
      : null;
    if (body.opportunityId && !opportunity) throw new DomainException('http.not_found');
    const salespersonId =
      body.salespersonId === undefined
        ? (current?.salespersonId ?? customer.salespersonId ?? scope.actor.userId)
        : body.salespersonId === null
          ? null
          : (await factoryUser(tx, scope.factory.id, body.salespersonId)).id;
    const warehouse = await this.workspace.warehouse(tx, scope, body.warehouseId);
    const orderDate = body.orderDate ?? (current ? iso(current.orderDate)! : today());
    const deliveryDate =
      body.deliveryDate === undefined
        ? current?.deliveryDate
          ? iso(current.deliveryDate)
          : null
        : body.deliveryDate;
    if (deliveryDate && deliveryDate < orderDate)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'deliveryDate', code: 'invalid', message: 'On or after the order date' }],
      });
    const vatMode: ErpVatMode = vatModeFor(scope.factory, body.vatMode ?? current?.vatMode);
    const lines = await priceLines(tx, scope, body.lines);
    const fulfilment = body.lines.map((l, i) => {
      const f = (l.fulfilment ?? (lines[i]!.itemId ? 'stock' : 'service')) as ErpFulfilment;
      if (f !== 'service' && !lines[i]!.itemId)
        throw new DomainException('validation.failed', {
          errors: [
            { path: `lines.${i}.itemId`, code: 'required', message: 'Stock and make lines need an item' },
          ],
        });
      return f;
    });
    return {
      customerId: customer.id,
      opportunityId: opportunity?.id ?? null,
      salespersonId,
      customerPoNo: body.customerPoNo === undefined ? (current?.customerPoNo ?? null) : body.customerPoNo,
      orderDate: day(orderDate),
      deliveryDate: deliveryDate ? day(deliveryDate) : null,
      warehouseId: warehouse.id,
      paymentTermDays: body.paymentTermDays ?? current?.paymentTermDays ?? customer.paymentTermDays,
      shipToAddress:
        body.shipToAddress === undefined ? (current?.shipToAddress ?? customer.address) : body.shipToAddress,
      note: body.note === undefined ? (current?.note ?? null) : body.note,
      vatMode,
      vatRatePct: '7',
      ...totalsOf(lines, vatMode, '7'),
      lines: {
        create: lines.map((l, i) => ({
          lineNo: l.lineNo,
          itemId: l.itemId,
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: l.unitPrice,
          discountPct: l.discountPct,
          amount: l.amount,
          fulfilment: fulfilment[i]!,
        })),
      },
    };
  }

  // ---------------------------------------------------------------------------- delivery notes

  async listDeliveries(scope: ErpScope, q: ErpDeliveryNoteListQuery) {
    const where: Prisma.ErpDeliveryNoteWhereInput = { factoryId: scope.factory.id };
    if (q.status && q.status !== 'uninvoiced') where.status = q.status as ErpDeliveryStatus;
    if (q.customerId) where.customer = { publicId: q.customerId };
    if (q.salesOrderId) where.salesOrder = { publicId: q.salesOrderId };
    if (q.q)
      where.OR = [
        { doNo: { contains: q.q, mode: 'insensitive' } },
        { customer: { name: { contains: q.q, mode: 'insensitive' } } },
        { salesOrder: { soNo: { contains: q.q, mode: 'insensitive' } } },
      ];
    if (q.status === 'uninvoiced') {
      // Prisma cannot compare two columns: pick the ids first.
      const ids = await this.workspace.db.$queryRaw<{ id: bigint }[]>`
        SELECT DISTINCT d.id FROM erp_delivery_notes d JOIN erp_delivery_note_lines l ON l.delivery_note_id = d.id
         WHERE d.factory_id = ${scope.factory.id} AND d.status IN ('issued', 'delivered') AND l.invoiced_qty < l.quantity`;
      where.id = { in: ids.map((r) => r.id) };
    }
    const [rows, total] = await Promise.all([
      this.workspace.db.erpDeliveryNote.findMany({
        where,
        include: { customer: true, salesOrder: true, lines: true },
        orderBy: [{ deliverOn: 'desc' }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpDeliveryNote.count({ where }),
    ]);
    return paginated(rows.map(doSummary), total, q);
  }

  async getDelivery(
    scope: ErpScope,
    publicId: string,
    perms: ReadonlySet<string>,
  ): Promise<ErpDeliveryNoteDto> {
    const row = await this.workspace.db.erpDeliveryNote.findFirst({
      where: { publicId, factoryId: scope.factory.id },
      include: DO_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return doDto(row, perms);
  }

  /** A draft delivery note from one order's remaining quantities (D-362). */
  async createDelivery(scope: ErpScope, body: ErpCreateDeliveryNoteDto, perms: ReadonlySet<string>) {
    const id = await this.workspace.tx(async (tx) => {
      const so = await tx.erpSalesOrder.findFirst({
        where: { publicId: body.salesOrderId, factoryId: scope.factory.id },
        include: { lines: { include: { item: true }, orderBy: { lineNo: 'asc' } } },
      });
      if (!so) throw new DomainException('http.not_found');
      if (!OPEN_SO.includes(so.status))
        throw new DomainException('erp.invalid_status', { params: { status: so.status } });
      const goods = so.lines.filter((l) => l.fulfilment !== 'service' && l.itemId);
      const wanted = body.lines?.length
        ? body.lines.map((l) => {
            const lid = lineIdOf(LINE.so, l.salesOrderLineId);
            const line = goods.find((g) => g.id === lid);
            if (!line) throw new DomainException('http.not_found');
            return { line, quantity: dec(l.quantity) };
          })
        : goods
            .map((line) => ({ line, quantity: dec(line.quantity).minus(dec(line.deliveredQty)) }))
            .filter((w) => w.quantity.gt(0));
      if (!wanted.length) throw new DomainException('erp.nothing_to_deliver', { params: { soNo: so.soNo } });
      for (const w of wanted) {
        const left = dec(w.line.quantity).minus(dec(w.line.deliveredQty));
        if (!w.quantity.gt(0) || w.quantity.gt(left))
          throw new DomainException('erp.over_delivery', {
            params: { item: w.line.description, remaining: fmtQty(left), requested: fmtQty(w.quantity) },
          });
      }
      const warehouse = body.warehouseId
        ? await this.workspace.warehouse(tx, scope, body.warehouseId)
        : await tx.erpWarehouse.findUniqueOrThrow({ where: { id: so.warehouseId } });
      const doNo = await this.workspace.nextNumber(tx, scope.factory.id, 'do');
      const dn = await tx.erpDeliveryNote.create({
        data: {
          factoryId: scope.factory.id,
          doNo,
          salesOrderId: so.id,
          customerId: so.customerId,
          warehouseId: warehouse.id,
          deliverOn: day(body.deliverOn ?? today()),
          shipToAddress: body.shipToAddress === undefined ? so.shipToAddress : body.shipToAddress,
          vehicle: body.vehicle ?? null,
          note: body.note ?? null,
          createdById: scope.actor.userId,
          lines: {
            create: wanted.map((w, i) => ({
              lineNo: i + 1,
              salesOrderLineId: w.line.id,
              itemId: w.line.itemId,
              description: w.line.description,
              quantity: fmtQty(w.quantity),
              unit: w.line.unit,
            })),
          },
        },
      });
      await this.workspace.record(tx, scope, 'erp_delivery_note.drafted', 'erp_delivery_note', dn.publicId, {
        doNo,
        soNo: so.soNo,
      });
      return dn.publicId;
    });
    return this.getDelivery(scope, id, perms);
  }

  /** Issues the goods (D-362): `sales_issue` movements at the moving average, consuming the order's reservation. */
  async issueDelivery(scope: ErpScope, publicId: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const dn = await this.lockDelivery(tx, scope, publicId);
      if (dn.status !== 'draft')
        throw new DomainException('erp.invalid_status', { params: { status: dn.status } });
      const lines = await tx.erpDeliveryNoteLine.findMany({
        where: { deliveryNoteId: dn.id },
        include: { item: true, salesOrderLine: true },
        orderBy: { lineNo: 'asc' },
      });
      const warehouse = await tx.erpWarehouse.findUniqueOrThrow({ where: { id: dn.warehouseId } });
      const so = await tx.erpSalesOrder.findUniqueOrThrow({ where: { id: dn.salesOrderId } });
      const settings = await this.workspace.settings(tx, scope.factory.id);
      const entries: StockEntry[] = [];
      for (const l of lines) {
        const sol = await tx.erpSalesOrderLine.findUniqueOrThrow({ where: { id: l.salesOrderLineId } });
        const left = dec(sol.quantity).minus(dec(sol.deliveredQty));
        if (dec(l.quantity).gt(left))
          throw new DomainException('erp.over_delivery', {
            params: { item: l.description, remaining: fmtQty(left), requested: fmtQty(l.quantity) },
          });
        const release =
          warehouse.id === so.warehouseId
            ? dec(sol.reservedQty).gt(dec(l.quantity))
              ? dec(l.quantity)
              : dec(sol.reservedQty)
            : dec(0);
        if (l.item)
          entries.push({
            item: l.item,
            warehouse,
            kind: 'sales_issue',
            quantity: dec(l.quantity).negated(),
            releaseReserved: release,
            reason: `${dn.doNo} (${so.soNo})`,
          });
        await tx.erpSalesOrderLine.update({
          where: { id: sol.id },
          data: {
            deliveredQty: fmtQty(dec(sol.deliveredQty).plus(dec(l.quantity))),
            reservedQty: fmtQty(dec(sol.reservedQty).minus(release)),
          },
        });
      }
      const movements = await this.stock.post(tx, scope, settings, entries, {
        type: 'delivery_note',
        publicId: dn.publicId,
        documentNo: dn.doNo,
      });
      let m = 0;
      for (const l of lines) {
        if (!l.item) continue;
        const mv = movements[m++]!;
        await tx.erpDeliveryNoteLine.update({
          where: { id: l.id },
          data: { unitCost: fmtCost(mv.unitCost), costAmount: fmtMoney(dec(mv.value).abs()) },
        });
      }
      await tx.erpDeliveryNote.update({
        where: { id: dn.id },
        data: {
          status: 'issued',
          issuedAt: new Date(),
          issuedById: scope.actor.userId,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.refresh(tx, so.id);
      await this.workspace.record(tx, scope, 'erp_delivery_note.issued', 'erp_delivery_note', dn.publicId, {
        doNo: dn.doNo,
      });
    });
    return this.getDelivery(scope, publicId, perms);
  }

  async deliverDelivery(
    scope: ErpScope,
    publicId: string,
    body: ErpDeliveredDto,
    perms: ReadonlySet<string>,
  ) {
    await this.workspace.tx(async (tx) => {
      const dn = await this.lockDelivery(tx, scope, publicId);
      if (dn.status !== 'issued')
        throw new DomainException('erp.invalid_status', { params: { status: dn.status } });
      let podFileId: bigint | null = null;
      if (body.podFileId) {
        const f = await tx.fileObject.findUnique({ where: { publicId: body.podFileId } });
        if (
          !f ||
          f.ownerFactoryId !== scope.factory.id ||
          f.uploadStatus !== 'uploaded' ||
          f.scanStatus === 'infected'
        )
          throw new DomainException('erp.file_not_usable');
        podFileId = f.id;
      }
      await tx.erpDeliveryNote.update({
        where: { id: dn.id },
        data: {
          status: 'delivered',
          deliveredAt: body.deliveredAt ? new Date(body.deliveredAt) : new Date(),
          receivedBy: body.receivedBy,
          podFileId,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(
        tx,
        scope,
        'erp_delivery_note.delivered',
        'erp_delivery_note',
        dn.publicId,
        {
          doNo: dn.doNo,
        },
      );
    });
    return this.getDelivery(scope, publicId, perms);
  }

  /** A draft is dropped; an issued note not yet invoiced brings its goods back at the cost they left with (D-362). */
  async cancelDelivery(scope: ErpScope, publicId: string, reason: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const dn = await this.lockDelivery(tx, scope, publicId);
      if (dn.status === 'cancelled')
        throw new DomainException('erp.invalid_status', { params: { status: dn.status } });
      const lines = await tx.erpDeliveryNoteLine.findMany({
        where: { deliveryNoteId: dn.id },
        include: { item: true },
        orderBy: { lineNo: 'asc' },
      });
      if (dn.status !== 'draft') {
        if (lines.some((l) => dec(l.invoicedQty).gt(0)))
          throw new DomainException('erp.invalid_status', { params: { status: 'invoiced' } });
        const warehouse = await tx.erpWarehouse.findUniqueOrThrow({ where: { id: dn.warehouseId } });
        const settings = await this.workspace.settings(tx, scope.factory.id);
        const entries: StockEntry[] = lines
          .filter((l) => l.item)
          .map((l) => ({
            item: l.item!,
            warehouse,
            kind: 'sales_return' as const,
            quantity: dec(l.quantity),
            unitCost: dec(l.unitCost ?? 0),
            reason: `ยกเลิก ${dn.doNo}: ${reason}`,
          }));
        if (entries.length)
          await this.stock.post(tx, scope, settings, entries, {
            type: 'delivery_note',
            publicId: dn.publicId,
            documentNo: dn.doNo,
          });
        for (const l of lines) {
          const sol = await tx.erpSalesOrderLine.findUniqueOrThrow({ where: { id: l.salesOrderLineId } });
          await tx.erpSalesOrderLine.update({
            where: { id: sol.id },
            data: { deliveredQty: fmtQty(dec(sol.deliveredQty).minus(dec(l.quantity))) },
          });
        }
      }
      await tx.erpDeliveryNote.update({
        where: { id: dn.id },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: reason,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (dn.status !== 'draft') await this.reopen(tx, dn.salesOrderId);
      await this.workspace.record(
        tx,
        scope,
        'erp_delivery_note.cancelled',
        'erp_delivery_note',
        dn.publicId,
        {
          doNo: dn.doNo,
        },
      );
    });
    return this.getDelivery(scope, publicId, perms);
  }

  /** After a delivery is taken back the order may be open again. */
  private async reopen(tx: ErpTx, salesOrderId: bigint) {
    const so = await tx.erpSalesOrder.findUniqueOrThrow({ where: { id: salesOrderId } });
    if (so.status === 'delivered' || so.status === 'closed' || so.status === 'partially_delivered') {
      await tx.erpSalesOrder.update({ where: { id: so.id }, data: { status: 'confirmed', closedAt: null } });
      await this.refresh(tx, so.id);
    }
  }

  private async lockDelivery(tx: ErpTx, scope: ErpScope, publicId: string) {
    const dn = await tx.erpDeliveryNote.findFirst({ where: { publicId, factoryId: scope.factory.id } });
    if (!dn) throw new DomainException('http.not_found');
    await tx.$queryRaw`SELECT id FROM erp_delivery_notes WHERE id = ${dn.id} FOR UPDATE`;
    return dn;
  }
}

// ------------------------------------------------------------------------------------- views

function soFacts(
  lines: {
    fulfilment: ErpFulfilment;
    quantity: Prisma.Decimal;
    deliveredQty: Prisma.Decimal;
    invoicedQty: Prisma.Decimal;
  }[],
  status: ErpSalesOrderStatus,
): SoFacts {
  return {
    status,
    toDeliver: lines.some((l) => l.fulfilment !== 'service' && dec(l.deliveredQty).lt(dec(l.quantity))),
    toInvoice: lines.some((l) => dec(l.invoicedQty).lt(dec(l.quantity))),
    delivered: lines.some((l) => dec(l.deliveredQty).gt(0)),
  };
}

export function soSummary(
  r: Prisma.ErpSalesOrderGetPayload<{ include: { customer: true; salesperson: true; lines: true } }>,
): ErpSalesOrderSummaryDto {
  const goods = r.lines.filter((l) => l.fulfilment !== 'service');
  const ordered = goods.reduce((a, l) => a.plus(dec(l.quantity)), dec(0));
  const delivered = goods.reduce((a, l) => a.plus(dec(l.deliveredQty)), dec(0));
  const pct = ordered.gt(0) ? delivered.times(100).div(ordered) : dec(0);
  return {
    id: r.publicId,
    soNo: r.soNo,
    status: r.status,
    customer: partnerRef(r.customer),
    customerPoNo: r.customerPoNo,
    orderDate: iso(r.orderDate)!,
    deliveryDate: iso(r.deliveryDate),
    total: fmtMoney(r.total),
    deliveredPct: pct.toFixed(1),
    late: OPEN_SO.includes(r.status) && !!r.deliveryDate && iso(r.deliveryDate)! < today(),
    salesperson: userRef(r.salesperson),
  };
}

function soDto(r: SoRow, credit: ErpCreditExposureDto, perms: ReadonlySet<string>): ErpSalesOrderDto {
  return {
    ...soSummary(r),
    quotation: r.quotation
      ? {
          id: r.quotation.publicId,
          code: `${r.quotation.quoteNo}${r.quotation.revision > 1 ? ` R${r.quotation.revision}` : ''}`,
          name: r.quotation.quoteNo,
        }
      : null,
    opportunity: r.opportunity
      ? { id: r.opportunity.publicId, code: r.opportunity.title, name: r.opportunity.title }
      : null,
    warehouse: warehouseRef(r.warehouse),
    paymentTermDays: r.paymentTermDays,
    shipToAddress: r.shipToAddress,
    note: r.note,
    vatMode: r.vatMode,
    vatRatePct: r.vatRatePct.toFixed(4),
    subtotal: fmtMoney(r.subtotal),
    vatAmount: fmtMoney(r.vatAmount),
    lines: r.lines.map((l) => ({
      ...salesLineDto(l, LINE.so),
      fulfilment: l.fulfilment,
      reservedQty: fmtQty(l.reservedQty),
      deliveredQty: fmtQty(l.deliveredQty),
      invoicedQty: fmtQty(l.invoicedQty),
      productionOrder: l.productionOrder
        ? { id: l.productionOrder.publicId, code: l.productionOrder.moNo, name: l.productionOrder.status }
        : null,
    })),
    deliveryNotes: r.deliveryNotes.map((d) => ({
      id: d.publicId,
      doNo: d.doNo,
      status: d.status,
      deliverOn: iso(d.deliverOn)!,
    })),
    invoices: r.invoices.map((i) => ({
      id: i.publicId,
      invoiceNo: i.invoiceNo,
      status: i.status,
      total: fmtMoney(i.total),
    })),
    credit,
    confirmedAt: isoTs(r.confirmedAt),
    creditOverrideReason: r.creditOverrideReason,
    closeReason: r.closeReason,
    cancelReason: r.cancelReason,
    nextActions: nextActions(soFacts(r.lines, r.status), SO_ACTIONS, perms),
    version: r.rowVersion,
  };
}

function doSummary(
  r: Prisma.ErpDeliveryNoteGetPayload<{ include: { customer: true; salesOrder: true; lines: true } }>,
): ErpDeliveryNoteSummaryDto {
  return {
    id: r.publicId,
    doNo: r.doNo,
    status: r.status,
    deliverOn: iso(r.deliverOn)!,
    customer: partnerRef(r.customer),
    salesOrder: { id: r.salesOrder.publicId, code: r.salesOrder.soNo, name: r.salesOrder.soNo },
    invoiced:
      r.status !== 'draft' &&
      r.status !== 'cancelled' &&
      r.lines.every((l) => dec(l.invoicedQty).gte(dec(l.quantity))),
  };
}

function doDto(r: DoRow, perms: ReadonlySet<string>): ErpDeliveryNoteDto {
  const summary = doSummary(r);
  return {
    ...summary,
    warehouse: warehouseRef(r.warehouse),
    shipToAddress: r.shipToAddress,
    vehicle: r.vehicle,
    note: r.note,
    lines: r.lines.map((l) => ({
      id: lineId(LINE.do, l.id),
      lineNo: l.lineNo,
      salesOrderLineId: lineId(LINE.so, l.salesOrderLineId),
      item: l.item ? itemRef(l.item) : null,
      description: l.description,
      quantity: fmtQty(l.quantity),
      unit: l.unit,
      unitCost: l.unitCost === null ? null : fmtCost(l.unitCost),
      costAmount: l.costAmount === null ? null : fmtMoney(l.costAmount),
      invoicedQty: fmtQty(l.invoicedQty),
    })),
    issuedAt: isoTs(r.issuedAt),
    deliveredAt: isoTs(r.deliveredAt),
    receivedBy: r.receivedBy,
    podFileId: r.podFile?.publicId ?? null,
    cancelReason: r.cancelReason,
    costTotal: fmtMoney(r.lines.reduce((a, l) => a.plus(dec(l.costAmount ?? 0)), dec(0))),
    nextActions: nextActions(
      {
        status: r.status,
        invoiced: summary.invoiced,
        anyInvoiced: r.lines.some((l) => dec(l.invoicedQty).gt(0)),
      },
      DO_ACTIONS,
      perms,
    ),
    version: r.rowVersion,
  };
}
