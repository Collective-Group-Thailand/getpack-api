import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch } from '@common/etag/etag';
import { type MoneyValue } from '@common/money/money';
import { paginated, toSkipTake } from '@common/pagination/pagination';
import { addCalendarDays, bangkokDate } from '@common/time/bangkok';
import { type Tx } from '@database/prisma.service';
import {
  type ErpItem,
  type ErpPurchaseOrderLine,
  type ErpPurchaseOrderStatus,
  type ErpTradingPartner,
  type ErpUnit,
  type ErpVatMode,
  type Prisma,
} from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';

import {
  type ErpCreateGoodsReceiptDto,
  type ErpDraftFromReorderResultDto,
  type ErpGoodsReceiptDto,
  type ErpGoodsReceiptListQuery,
  type ErpPurchaseOrderListQuery,
  type ErpReorderSuggestionDto,
  type ErpSavePurchaseOrderDto,
} from './erp.dto';
import {
  dec,
  documentTotals,
  fmtCost,
  fmtMoney,
  fmtQty,
  lineAmount,
  money2,
  purchaseUnitCost,
  receivableUpTo,
  reorderQuantity,
  toBase,
} from './erp.math';
import { ErpStockService, type StockEntry } from './erp-stock.service';
import { grDto, itemRef, partnerRef, poEtag as etagOfPo, type PoRow, poSummaryDto } from './erp-views';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

export const PO_INCLUDE = {
  supplier: true,
  lines: { include: { item: true } },
  goodsReceipts: true,
} as const;

const GR_INCLUDE = {
  purchaseOrder: true,
  supplier: true,
  warehouse: true,
  createdBy: { select: { displayName: true } },
  lines: { include: { item: true } },
} as const;

const OPEN: ErpPurchaseOrderStatus[] = ['issued', 'partially_received'];
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const today = () => bangkokDate(new Date());

/**
 * Purchasing (M3; D-325, D-326): purchase orders drafted, issued, received in goods receipts and closed; the
 * reorder list and its one-click draft orders. Goods receipts post stock at cost (D-321).
 */
@Injectable()
export class ErpPurchasingService {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly stock: ErpStockService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------------- purchase orders

  async list(scope: ErpScope, q: ErpPurchaseOrderListQuery) {
    const factoryId = scope.factory.id;
    const where: Prisma.ErpPurchaseOrderWhereInput = { factoryId };
    if (q.status === 'open') where.status = { in: OPEN };
    else if (q.status) where.status = q.status as ErpPurchaseOrderStatus;
    if (q.supplierId) {
      const s = await this.workspace.db.erpTradingPartner.findFirst({
        where: { factoryId, publicId: q.supplierId },
      });
      if (!s) throw new DomainException('http.not_found');
      where.supplierId = s.id;
    }
    const search = q.q?.trim();
    if (search)
      where.OR = [
        { poNo: { contains: search, mode: 'insensitive' } },
        { supplier: { name: { contains: search, mode: 'insensitive' } } },
        { supplierRef: { contains: search, mode: 'insensitive' } },
        { lines: { some: { item: { name: { contains: search, mode: 'insensitive' } } } } },
      ];
    const [rows, total] = await Promise.all([
      this.workspace.db.erpPurchaseOrder.findMany({
        where,
        include: { supplier: true, lines: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpPurchaseOrder.count({ where }),
    ]);
    return paginated(rows.map(poSummaryDto), total, q);
  }

  async get(scope: ErpScope, publicId: string): Promise<PoRow> {
    const row = await this.workspace.db.erpPurchaseOrder.findFirst({
      where: { factoryId: scope.factory.id, publicId },
      include: PO_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  private async supplier(tx: Tx, scope: ErpScope, publicId: string): Promise<ErpTradingPartner> {
    const s = await tx.erpTradingPartner.findFirst({ where: { factoryId: scope.factory.id, publicId } });
    if (!s) throw new DomainException('http.not_found');
    if (s.kind === 'customer') throw new DomainException('erp.not_a_supplier', { params: { name: s.name } });
    if (s.status === 'archived') throw new DomainException('erp.archived', { params: { name: s.name } });
    return s;
  }

  /** The unit a line is bought in and its factor: the item's purchase unit by default, or its base unit. */
  private unitOf(
    item: ErpItem,
    unit: string | undefined,
    path: string,
  ): { unit: ErpUnit; factor: MoneyValue } {
    const purchase = item.purchaseUnit ?? item.baseUnit;
    const chosen = (unit ?? purchase) as ErpUnit;
    if (chosen === item.baseUnit) return { unit: chosen, factor: dec(1) };
    if (chosen === item.purchaseUnit) return { unit: chosen, factor: dec(item.purchaseFactor) };
    throw new DomainException('erp.unit_not_allowed', {
      params: { item: item.name, units: [item.baseUnit, item.purchaseUnit].filter(Boolean).join(', ') },
      errors: [{ path, code: 'unit_not_allowed', message: 'Use the purchase unit or the base unit' }],
    });
  }

  private async lines(tx: Tx, scope: ErpScope, body: ErpSavePurchaseOrderDto) {
    const items = await this.stock.items(
      tx,
      scope.factory.id,
      body.lines.map((l) => l.itemId),
    );
    return body.lines.map((l, i) => {
      const item = items[i]!;
      const { unit, factor } = this.unitOf(item, l.unit, `lines.${i}.unit`);
      const quantity = dec(l.quantity);
      if (!quantity.gt(0))
        throw new DomainException('validation.failed', {
          errors: [{ path: `lines.${i}.quantity`, code: 'invalid', message: 'Must be more than zero' }],
        });
      const unitPrice = dec(l.unitPrice);
      const discountPct = dec(l.discountPct ?? '0');
      if (discountPct.gt(100))
        throw new DomainException('validation.failed', {
          errors: [{ path: `lines.${i}.discountPct`, code: 'invalid', message: 'At most 100' }],
        });
      return {
        lineNo: i + 1,
        itemId: item.id,
        description: l.description ?? null,
        quantity: fmtQty(quantity),
        unit,
        factor: fmtCost(factor),
        unitPrice: fmtCost(unitPrice),
        discountPct: discountPct.toFixed(4),
        amount: fmtMoney(lineAmount(quantity, unitPrice, discountPct)),
      };
    });
  }

  private header(body: ErpSavePurchaseOrderDto, amounts: string[]) {
    const vatMode = (body.vatMode ?? 'exclusive') as ErpVatMode;
    const vatRatePct = dec(body.vatRatePct ?? '7');
    if (vatRatePct.gte(100))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'vatRatePct', code: 'invalid', message: 'Below 100' }],
      });
    const orderedOn = body.orderedOn ?? today();
    if (body.expectedOn && body.expectedOn < orderedOn)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'expectedOn', code: 'invalid', message: 'On or after the order date' }],
      });
    const totals = documentTotals(amounts.map(dec), vatMode, vatRatePct);
    return {
      orderedOn: day(orderedOn),
      expectedOn: body.expectedOn ? day(body.expectedOn) : null,
      vatMode,
      vatRatePct: vatRatePct.toFixed(4),
      subtotal: fmtMoney(totals.subtotal),
      vatAmount: fmtMoney(totals.vatAmount),
      total: fmtMoney(totals.total),
      supplierRef: body.supplierRef ?? null,
      deliverTo: body.deliverTo ?? null,
      note: body.note ?? null,
    };
  }

  /** A new draft purchase order (D-325): editable, unnumbered until issued. */
  async create(scope: ErpScope, body: ErpSavePurchaseOrderDto): Promise<PoRow> {
    const id = await this.workspace.tx(async (tx) => {
      const supplier = await this.supplier(tx, scope, body.supplierId);
      const lines = await this.lines(tx, scope, body);
      const po = await tx.erpPurchaseOrder.create({
        data: {
          factoryId: scope.factory.id,
          supplierId: supplier.id,
          ...this.header(
            body,
            lines.map((l) => l.amount),
          ),
          createdById: scope.actor.userId,
          lines: { create: lines },
        },
      });
      await this.workspace.record(tx, scope, 'erp_purchase_order.drafted', 'erp_purchase_order', po.publicId);
      return po.publicId;
    });
    return this.get(scope, id);
  }

  /** Replaces a draft's header and lines (D-325: only drafts are edited). */
  async update(
    scope: ErpScope,
    publicId: string,
    ifMatch: string | undefined,
    body: ErpSavePurchaseOrderDto,
  ) {
    await this.workspace.tx(async (tx) => {
      const current = await this.lock(tx, scope, publicId);
      assertIfMatch(ifMatch, etagOfPo(current));
      if (current.status !== 'draft')
        throw new DomainException('erp.invalid_status', { params: { status: current.status } });
      const supplier = await this.supplier(tx, scope, body.supplierId);
      const lines = await this.lines(tx, scope, body);
      await tx.erpPurchaseOrderLine.deleteMany({ where: { purchaseOrderId: current.id } });
      await tx.erpPurchaseOrder.update({
        where: { id: current.id },
        data: {
          supplierId: supplier.id,
          ...this.header(
            body,
            lines.map((l) => l.amount),
          ),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
          lines: { create: lines },
        },
      });
      await this.workspace.record(tx, scope, 'erp_purchase_order.updated', 'erp_purchase_order', publicId);
    });
    return this.get(scope, publicId);
  }

  private async lock(tx: Tx, scope: ErpScope, publicId: string) {
    const found = await tx.erpPurchaseOrder.findFirst({ where: { factoryId: scope.factory.id, publicId } });
    if (!found) throw new DomainException('http.not_found');
    await tx.$queryRaw`SELECT id FROM erp_purchase_orders WHERE id = ${found.id} FOR UPDATE`;
    return (await tx.erpPurchaseOrder.findUnique({ where: { id: found.id } }))!;
  }

  /** Issues a draft (D-325): numbered `PO-YYMM-NNNN`, frozen; the order can now be sent and received. */
  async issue(scope: ErpScope, publicId: string, ifMatch: string | undefined) {
    await this.workspace.tx(async (tx) => {
      const current = await this.lock(tx, scope, publicId);
      assertIfMatch(ifMatch, etagOfPo(current), { required: false });
      if (current.status !== 'draft')
        throw new DomainException('erp.invalid_status', { params: { status: current.status } });
      const supplier = await tx.erpTradingPartner.findUniqueOrThrow({ where: { id: current.supplierId } });
      if (supplier.status === 'archived')
        throw new DomainException('erp.archived', { params: { name: supplier.name } });
      const poNo = await this.workspace.nextNumber(tx, scope.factory.id, 'po');
      await tx.erpPurchaseOrder.update({
        where: { id: current.id },
        data: {
          status: 'issued',
          poNo,
          issuedAt: new Date(),
          issuedById: scope.actor.userId,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        category: 'approval',
        action: 'erp.purchase_order_issued',
        resourceType: 'erp_purchase_order',
        resourcePublicId: publicId,
        data: { poNo },
      });
      await this.workspace.record(tx, scope, 'erp_purchase_order.issued', 'erp_purchase_order', publicId, {
        poNo,
      });
    });
    return this.get(scope, publicId);
  }

  /** Cancels a draft or an issued order with nothing received (D-325). */
  async cancel(scope: ErpScope, publicId: string, reason: string) {
    await this.workspace.tx(async (tx) => {
      const current = await this.lock(tx, scope, publicId);
      if (current.status !== 'draft' && current.status !== 'issued')
        throw new DomainException('erp.invalid_status', { params: { status: current.status } });
      await tx.erpPurchaseOrder.update({
        where: { id: current.id },
        data: {
          status: 'cancelled',
          cancelReason: reason,
          closedAt: new Date(),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(tx, scope, 'erp_purchase_order.cancelled', 'erp_purchase_order', publicId, {
        poNo: current.poNo,
      });
    });
    return this.get(scope, publicId);
  }

  /** Closes a partly received order: the rest will not come (D-325). */
  async close(scope: ErpScope, publicId: string, reason: string) {
    await this.workspace.tx(async (tx) => {
      const current = await this.lock(tx, scope, publicId);
      if (current.status !== 'partially_received')
        throw new DomainException('erp.invalid_status', { params: { status: current.status } });
      await tx.erpPurchaseOrder.update({
        where: { id: current.id },
        data: {
          status: 'closed',
          cancelReason: reason,
          closedAt: new Date(),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(tx, scope, 'erp_purchase_order.closed', 'erp_purchase_order', publicId, {
        poNo: current.poNo,
      });
    });
    return this.get(scope, publicId);
  }

  // ------------------------------------------------------------------------------------ reorder

  /** Items at or below their reorder point with what to buy (D-326), most urgent first. */
  async reorder(scope: ErpScope): Promise<ErpReorderSuggestionDto[]> {
    const factoryId = scope.factory.id;
    const items = await this.workspace.db.erpItem.findMany({
      where: { factoryId, status: 'active', reorderPoint: { not: null } },
      include: { defaultSupplier: true },
      orderBy: { sku: 'asc' },
    });
    const [totals, onOrder] = await Promise.all([
      this.stock.totals(
        factoryId,
        items.map((i) => i.id),
      ),
      this.stock.onOrder(factoryId),
    ]);
    const out: (ErpReorderSuggestionDto & { gap: MoneyValue })[] = [];
    for (const item of items) {
      const t = totals.get(item.id);
      const available = dec(t?.onHand ?? 0).minus(dec(t?.reserved ?? 0));
      const ordered = onOrder.get(item.id) ?? dec(0);
      const factor = dec(item.purchaseFactor);
      const suggested = reorderQuantity(
        available.plus(ordered),
        dec(item.reorderPoint!),
        item.reorderQty === null ? null : dec(item.reorderQty),
        factor,
      );
      if (suggested.isZero()) continue;
      out.push({
        item: itemRef(item),
        supplier: item.defaultSupplier ? partnerRef(item.defaultSupplier) : null,
        available: fmtQty(available),
        onOrder: fmtQty(ordered),
        reorderPoint: fmtQty(item.reorderPoint!),
        toOrderQty: fmtQty(suggested),
        toOrderPurchaseQty: fmtQty(suggested.div(factor)),
        purchaseUnit: item.purchaseUnit ?? item.baseUnit,
        lastPurchasePrice: item.lastPurchasePrice === null ? null : fmtCost(item.lastPurchasePrice),
        needBy: item.leadTimeDays === null ? null : addCalendarDays(today(), item.leadTimeDays),
        gap: available.plus(ordered).div(dec(item.reorderPoint!).gt(0) ? dec(item.reorderPoint!) : dec(1)),
      });
    }
    return out.sort((a, b) => a.gap.comparedTo(b.gap)).map(({ gap: _gap, ...rest }) => rest);
  }

  /** One draft purchase order per default supplier from the chosen reorder suggestions (D-326). */
  async draftFromReorder(scope: ErpScope, itemIds: string[]): Promise<ErpDraftFromReorderResultDto> {
    const suggestions = new Map((await this.reorder(scope)).map((s) => [s.item.id, s]));
    const items = await this.stock.items(this.workspace.db, scope.factory.id, itemIds);
    const bySupplier = new Map<string, { item: ErpItem; s: ErpReorderSuggestionDto }[]>();
    const skipped: ReturnType<typeof itemRef>[] = [];
    for (const item of items) {
      const s = suggestions.get(item.publicId);
      if (!s || !s.supplier) {
        skipped.push(itemRef(item));
        continue;
      }
      bySupplier.set(s.supplier.id, [...(bySupplier.get(s.supplier.id) ?? []), { item, s }]);
    }
    const created = [];
    for (const [supplierId, rows] of bySupplier) {
      const lead = Math.max(0, ...rows.map((r) => r.item.leadTimeDays ?? 0));
      const po = await this.create(scope, {
        supplierId,
        expectedOn: lead > 0 ? addCalendarDays(today(), lead) : null,
        note: 'สร้างจากรายการของใกล้หมด',
        lines: rows.map(({ item, s }) => ({
          itemId: item.publicId,
          quantity: s.toOrderPurchaseQty,
          unit: s.purchaseUnit,
          unitPrice: item.lastPurchasePrice === null ? '0' : dec(item.lastPurchasePrice).toFixed(6),
        })),
      });
      created.push(poSummaryDto(po));
    }
    return { created, skipped };
  }

  // ----------------------------------------------------------------------------- goods receipts

  async listReceipts(scope: ErpScope, q: ErpGoodsReceiptListQuery) {
    const factoryId = scope.factory.id;
    const where: Prisma.ErpGoodsReceiptWhereInput = { factoryId };
    if (q.purchaseOrderId) {
      const po = await this.workspace.db.erpPurchaseOrder.findFirst({
        where: { factoryId, publicId: q.purchaseOrderId },
      });
      if (!po) throw new DomainException('http.not_found');
      where.purchaseOrderId = po.id;
    }
    if (q.supplierId) {
      const s = await this.workspace.db.erpTradingPartner.findFirst({
        where: { factoryId, publicId: q.supplierId },
      });
      if (!s) throw new DomainException('http.not_found');
      where.supplierId = s.id;
    }
    const search = q.q?.trim();
    if (search)
      where.OR = [
        { grNo: { contains: search, mode: 'insensitive' } },
        { deliveryNoteNo: { contains: search, mode: 'insensitive' } },
        { supplier: { name: { contains: search, mode: 'insensitive' } } },
        { purchaseOrder: { poNo: { contains: search, mode: 'insensitive' } } },
      ];
    const [rows, total] = await Promise.all([
      this.workspace.db.erpGoodsReceipt.findMany({
        where,
        include: GR_INCLUDE,
        orderBy: [{ receivedOn: 'desc' }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpGoodsReceipt.count({ where }),
    ]);
    return paginated(rows.map(grDto), total, q);
  }

  async getReceipt(scope: ErpScope, publicId: string): Promise<ErpGoodsReceiptDto> {
    const row = await this.workspace.db.erpGoodsReceipt.findFirst({
      where: { factoryId: scope.factory.id, publicId },
      include: GR_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return grDto(row);
  }

  /**
   * Posts a goods receipt (D-325): against an open purchase order (lines by PO line, at the order's price) or
   * without one (item and price per line). Stock comes in at cost (D-321); the order becomes partly received,
   * or received when every line is in; the item remembers its last price. Final once posted.
   */
  async receive(scope: ErpScope, body: ErpCreateGoodsReceiptDto): Promise<ErpGoodsReceiptDto> {
    const publicId = await this.workspace.tx(async (tx) => {
      const settings = await this.workspace.settings(tx, scope.factory.id);
      const warehouse = await this.workspace.warehouse(tx, scope, body.warehouseId);
      const receivedOn = body.receivedOn ?? today();
      let po:
        | (Awaited<ReturnType<ErpPurchasingService['lock']>> & {
            lines: (ErpPurchaseOrderLine & { item: ErpItem })[];
          })
        | null = null;
      let supplier: ErpTradingPartner;
      if (body.purchaseOrderId) {
        const locked = await this.lock(tx, scope, body.purchaseOrderId);
        if (!OPEN.includes(locked.status))
          throw new DomainException('erp.invalid_status', { params: { status: locked.status } });
        po = {
          ...locked,
          lines: await tx.erpPurchaseOrderLine.findMany({
            where: { purchaseOrderId: locked.id },
            include: { item: true },
          }),
        };
        supplier = await tx.erpTradingPartner.findUniqueOrThrow({ where: { id: locked.supplierId } });
      } else {
        if (!body.supplierId)
          throw new DomainException('validation.failed', {
            errors: [
              { path: 'supplierId', code: 'required', message: 'A supplier or a purchase order is required' },
            ],
          });
        supplier = await this.supplier(tx, scope, body.supplierId);
      }
      const vatRegistered = scope.factory.isVatRegistered;
      const overPct = dec(settings.overReceiptPct);
      const receivedNow = new Map<bigint, MoneyValue>();
      const freeItems = await this.stock.items(
        tx,
        scope.factory.id,
        body.lines.filter((l) => !l.purchaseOrderLineId).map((l) => l.itemId ?? ''),
      );
      let free = 0;
      const lines = body.lines.map((l, i) => {
        const quantity = dec(l.quantity);
        if (!quantity.gt(0))
          throw new DomainException('validation.failed', {
            errors: [{ path: `lines.${i}.quantity`, code: 'invalid', message: 'Must be more than zero' }],
          });
        if (l.purchaseOrderLineId) {
          if (!po)
            throw new DomainException('validation.failed', {
              errors: [
                { path: `lines.${i}.purchaseOrderLineId`, code: 'invalid', message: 'Needs purchaseOrderId' },
              ],
            });
          const line = po.lines.find((x) => x.publicId === l.purchaseOrderLineId);
          if (!line) throw new DomainException('http.not_found');
          if (l.unit && l.unit !== line.unit)
            throw new DomainException('erp.unit_not_allowed', {
              params: { item: line.item.name, units: line.unit },
            });
          const already = dec(line.receivedQty).plus(receivedNow.get(line.id) ?? dec(0));
          const max = receivableUpTo(dec(line.quantity), already, overPct);
          if (quantity.gt(max))
            throw new DomainException('erp.over_receipt', {
              params: {
                item: line.item.name,
                max: fmtQty(max.isNegative() ? 0 : max),
                ordered: fmtQty(line.quantity),
                unit: line.unit,
              },
            });
          receivedNow.set(line.id, (receivedNow.get(line.id) ?? dec(0)).plus(quantity));
          const unitCostPurchase = purchaseUnitCost(
            dec(line.unitPrice),
            dec(line.discountPct),
            po.vatMode,
            dec(po.vatRatePct),
            vatRegistered,
          );
          const factor = dec(line.factor);
          return {
            line: {
              lineNo: i + 1,
              purchaseOrderLineId: line.id,
              itemId: line.itemId,
              quantity: fmtQty(quantity),
              unit: line.unit,
              factor: fmtCost(factor),
              baseQuantity: fmtQty(toBase(quantity, factor)),
              unitCost: fmtCost(unitCostPurchase.div(factor)),
              amount: fmtMoney(money2(quantity.times(unitCostPurchase))),
              lotNo: l.lotNo ?? null,
            },
            item: line.item,
            lastPrice: purchaseUnitCost(
              dec(line.unitPrice),
              dec(line.discountPct),
              po.vatMode,
              dec(po.vatRatePct),
              true,
            ),
            purchaseUnit: line.unit === line.item.purchaseUnit,
          };
        }
        const item = freeItems[free++]!;
        if (!l.unitPrice)
          throw new DomainException('validation.failed', {
            errors: [
              {
                path: `lines.${i}.unitPrice`,
                code: 'required',
                message: 'A price is required without a PO line',
              },
            ],
          });
        const { unit, factor } = this.unitOf(item, l.unit, `lines.${i}.unit`);
        const price = dec(l.unitPrice);
        return {
          line: {
            lineNo: i + 1,
            purchaseOrderLineId: null,
            itemId: item.id,
            quantity: fmtQty(quantity),
            unit,
            factor: fmtCost(factor),
            baseQuantity: fmtQty(toBase(quantity, factor)),
            unitCost: fmtCost(price.div(factor)),
            amount: fmtMoney(money2(quantity.times(price))),
            lotNo: l.lotNo ?? null,
          },
          item,
          lastPrice: price,
          purchaseUnit: unit === item.purchaseUnit || !item.purchaseUnit,
        };
      });

      const grNo = await this.workspace.nextNumber(tx, scope.factory.id, 'gr', day(receivedOn));
      const total = lines.reduce((a, l) => a.plus(dec(l.line.amount)), dec(0));
      const gr = await tx.erpGoodsReceipt.create({
        data: {
          factoryId: scope.factory.id,
          grNo,
          purchaseOrderId: po?.id ?? null,
          supplierId: supplier.id,
          warehouseId: warehouse.id,
          receivedOn: day(receivedOn),
          deliveryNoteNo: body.deliveryNoteNo ?? null,
          note: body.note ?? null,
          total: fmtMoney(total),
          createdById: scope.actor.userId,
          lines: { create: lines.map((l) => l.line) },
        },
      });

      const entries: StockEntry[] = lines.map((l) => ({
        item: l.item,
        warehouse,
        kind: 'receipt',
        quantity: dec(l.line.baseQuantity),
        unitCost: dec(l.line.unitCost),
        lotNo: l.line.lotNo,
        reason: body.deliveryNoteNo ? `ใบส่งของ ${body.deliveryNoteNo}` : null,
      }));
      await this.stock.post(tx, scope, settings, entries, {
        type: 'goods_receipt',
        publicId: gr.publicId,
        documentNo: grNo,
        occurredAt: receivedOn === today() ? new Date() : day(receivedOn),
      });

      for (const l of lines) {
        if (!l.purchaseUnit) continue;
        await tx.erpItem.update({
          where: { id: l.item.id },
          data: { lastPurchasePrice: fmtCost(l.lastPrice) },
        });
      }
      if (po) {
        for (const [lineId, qty] of receivedNow)
          await tx.erpPurchaseOrderLine.update({
            where: { id: lineId },
            data: { receivedQty: { increment: fmtQty(qty) } },
          });
        const after = await tx.erpPurchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
        const complete = after.every((x) => dec(x.receivedQty).gte(dec(x.quantity)));
        await tx.erpPurchaseOrder.update({
          where: { id: po.id },
          data: {
            status: complete ? 'received' : 'partially_received',
            ...(complete && { closedAt: new Date() }),
            rowVersion: { increment: 1 },
          },
        });
      }
      await this.workspace.record(tx, scope, 'erp_goods_receipt.posted', 'erp_goods_receipt', gr.publicId, {
        grNo,
        poNo: po?.poNo ?? null,
      });
      return gr.publicId;
    });
    return this.getReceipt(scope, publicId);
  }
}
