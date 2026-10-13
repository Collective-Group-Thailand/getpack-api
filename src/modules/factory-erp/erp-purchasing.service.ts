import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch } from '@common/etag/etag';
import { type MoneyValue } from '@common/money/money';
import { paginated, toSkipTake } from '@common/pagination/pagination';
import { addCalendarDays, bangkokDate } from '@common/time/bangkok';
import { type PrismaService, type Tx } from '@database/prisma.service';
import {
  type ErpChargeAllocation,
  type ErpChargeKind,
  type ErpFactorySettings,
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
  type ErpChargeInput,
  type ErpCreateGoodsReceiptDto,
  type ErpDraftFromReorderResultDto,
  type ErpGoodsReceiptDto,
  type ErpGoodsReceiptListQuery,
  type ErpPoWarningDto,
  type ErpPurchaseOrderListQuery,
  type ErpReorderSuggestionDto,
  type ErpSavePurchaseOrderDto,
} from './erp.dto';
import {
  absorbable,
  allocate,
  dec,
  documentTotals,
  fmtCost,
  fmtMoney,
  fmtQty,
  lineAmount,
  money2,
  priceRise,
  purchaseUnitCost,
  receivableUpTo,
  reorderQuantity,
  roundToPurchase,
  toBase,
} from './erp.math';
import { ErpAlertsService } from './erp-alerts.service';
import { ErpPricingService } from './erp-pricing.service';
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
  landedCharges: {
    include: {
      partner: true,
      createdBy: { select: { displayName: true } },
      lines: { include: { goodsReceiptLine: { select: { lineNo: true } } } },
    },
  },
} as const;

const OPEN: ErpPurchaseOrderStatus[] = ['issued', 'partially_received'];

/** One line to buy: in the supplier's unit, at its price (per that unit). */
export interface DraftLine {
  item: ErpItem;
  supplierId: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  lead: number;
  /** The purchase-request line it comes from. */
  requestLineId?: bigint;
}
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
    private readonly pricing: ErpPricingService,
    private readonly alerts: ErpAlertsService,
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
    return { ...row, warnings: await this.warnings(this.workspace.db, scope, row) };
  }

  /**
   * What to look at before issuing (D-347, D-351): lines from a supplier not approved (or suspended) for the
   * item — unless the factory switched the list off — and lines priced above the last paid by more than the
   * alert threshold.
   */
  private async warnings(
    db: Tx | PrismaService,
    scope: ErpScope,
    po: Omit<PoRow, 'warnings'>,
  ): Promise<ErpPoWarningDto[]> {
    if (!['draft', 'issued', 'partially_received'].includes(po.status)) return [];
    const settings = await this.workspace.settings(db, scope.factory.id);
    const links = new Map(
      (
        await db.erpItemSupplier.findMany({
          where: { supplierId: po.supplierId, itemId: { in: po.lines.map((l) => l.itemId) } },
        })
      ).map((l) => [l.itemId, l]),
    );
    const out: ErpPoWarningDto[] = [];
    for (const line of [...po.lines].sort((a, b) => a.lineNo - b.lineNo)) {
      const link = links.get(line.itemId);
      if (settings.supplierApproval !== 'off' && link?.approval !== 'approved')
        out.push({
          lineNo: line.lineNo,
          code: link?.approval === 'suspended' ? 'supplier_suspended' : 'supplier_not_approved',
          changePct: null,
        });
      const net = purchaseUnitCost(
        dec(line.unitPrice),
        dec(line.discountPct),
        po.vatMode,
        dec(po.vatRatePct),
        true,
      ).div(dec(line.factor));
      const rise = priceRise(
        net,
        await this.pricing.lastPaid(db, line.itemId, po.supplierId),
        dec(settings.priceAlertPct),
      );
      if (rise && po.status === 'draft')
        out.push({ lineNo: line.lineNo, code: 'price_rise', changePct: rise.toFixed(2) });
    }
    return out;
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
    link?: { purchaseUnit: ErpUnit; purchaseFactor: Prisma.Decimal } | null,
  ): { unit: ErpUnit; factor: MoneyValue } {
    const purchase = link?.purchaseUnit ?? item.purchaseUnit ?? item.baseUnit;
    const chosen = (unit ?? purchase) as ErpUnit;
    if (chosen === item.baseUnit) return { unit: chosen, factor: dec(1) };
    // D-333: the unit this supplier sells the item in, else the item's own purchase unit.
    if (link && chosen === link.purchaseUnit) return { unit: chosen, factor: dec(link.purchaseFactor) };
    if (chosen === item.purchaseUnit) return { unit: chosen, factor: dec(item.purchaseFactor) };
    throw new DomainException('erp.unit_not_allowed', {
      params: {
        item: item.name,
        units: [...new Set([item.baseUnit, item.purchaseUnit, link?.purchaseUnit].filter(Boolean))].join(
          ', ',
        ),
      },
      errors: [{ path, code: 'unit_not_allowed', message: 'Use the purchase unit or the base unit' }],
    });
  }

  private async lines(tx: Tx, scope: ErpScope, body: ErpSavePurchaseOrderDto, supplierId: bigint) {
    const items = await this.stock.items(
      tx,
      scope.factory.id,
      body.lines.map((l) => l.itemId),
    );
    const links = new Map(
      (
        await tx.erpItemSupplier.findMany({
          where: { supplierId, itemId: { in: items.map((i) => i.id) } },
        })
      ).map((l) => [l.itemId, l]),
    );
    return body.lines.map((l, i) => {
      const item = items[i]!;
      const { unit, factor } = this.unitOf(item, l.unit, `lines.${i}.unit`, links.get(item.id));
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
      const lines = await this.lines(tx, scope, body, supplier.id);
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
      const lines = await this.lines(tx, scope, body, supplier.id);
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
      const settings = await this.workspace.settings(tx, scope.factory.id);
      if (settings.supplierApproval === 'enforce') {
        // D-351: every line's supplier must be approved for its item.
        const lines = await tx.erpPurchaseOrderLine.findMany({
          where: { purchaseOrderId: current.id },
          include: { item: true },
        });
        const approved = new Set(
          (
            await tx.erpItemSupplier.findMany({
              where: {
                supplierId: supplier.id,
                approval: 'approved',
                itemId: { in: lines.map((l) => l.itemId) },
              },
              select: { itemId: true },
            })
          ).map((l) => l.itemId),
        );
        const missing = lines.find((l) => !approved.has(l.itemId));
        if (missing)
          throw new DomainException('erp.supplier_not_approved', {
            params: { item: missing.item.name, supplier: supplier.name },
          });
      }
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
      // D-334: the agreed prices go into the price history (net, without VAT).
      const poLines = await tx.erpPurchaseOrderLine.findMany({
        where: { purchaseOrderId: current.id },
        include: { item: true },
      });
      for (const line of poLines) {
        const net = purchaseUnitCost(
          dec(line.unitPrice),
          dec(line.discountPct),
          current.vatMode,
          dec(current.vatRatePct),
          true,
        );
        await this.priceAlert(tx, scope, settings, {
          item: line.item,
          supplier,
          base: net.div(dec(line.factor)),
          documentNo: poNo,
          key: `po:${publicId}:${line.lineNo}`,
        });
        await this.pricing.note(tx, {
          factoryId: scope.factory.id,
          userId: scope.actor.userId,
          item: line.item,
          supplier,
          source: 'purchase_order',
          unit: line.unit,
          factor: dec(line.factor),
          unitPrice: purchaseUnitCost(
            dec(line.unitPrice),
            dec(line.discountPct),
            current.vatMode,
            dec(current.vatRatePct),
            true,
          ),
          quantity: dec(line.quantity),
          pricedOn: current.orderedOn.toISOString().slice(0, 10),
          sourcePublicId: publicId,
          documentNo: poNo,
        });
      }
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

  /**
   * Items at or below their reorder point with what to buy (D-326), most urgent first: from the preferred
   * supplier (D-333) in its unit, rounded up to whole units and its minimum order (D-335), at its latest price.
   */
  async reorder(scope: ErpScope): Promise<ErpReorderSuggestionDto[]> {
    const factoryId = scope.factory.id;
    const items = await this.workspace.db.erpItem.findMany({
      where: { factoryId, status: 'active', reorderPoint: { not: null } },
      include: { defaultSupplier: true },
      orderBy: { sku: 'asc' },
    });
    const [totals, onOrder, links] = await Promise.all([
      this.stock.totals(
        factoryId,
        items.map((i) => i.id),
      ),
      this.stock.onOrder(factoryId),
      this.pricing.preferred(
        this.workspace.db,
        factoryId,
        items.map((i) => i.id),
      ),
    ]);
    const out: (ErpReorderSuggestionDto & { gap: MoneyValue })[] = [];
    for (const item of items) {
      const t = totals.get(item.id);
      const available = dec(t?.onHand ?? 0).minus(dec(t?.reserved ?? 0));
      const ordered = onOrder.get(item.id) ?? dec(0);
      const link = links.get(item.id);
      const factor = link ? dec(link.purchaseFactor) : dec(item.purchaseFactor);
      const needed = reorderQuantity(
        available.plus(ordered),
        dec(item.reorderPoint!),
        item.reorderQty === null ? null : dec(item.reorderQty),
        factor,
      );
      if (needed.isZero()) continue;
      const rounded = roundToPurchase(
        needed,
        factor,
        link?.minOrderQty === null || !link ? null : dec(link.minOrderQty),
      );
      const supplier = link?.supplier ?? item.defaultSupplier;
      // D-346: the quantity break for what is ordered, else the latest price.
      const price = link
        ? await this.pricing.priceFor(this.workspace.db, link, rounded.purchaseQty)
        : item.lastPurchasePrice;
      const lead = link?.leadTimeDays ?? item.leadTimeDays;
      out.push({
        item: itemRef(item),
        supplier: supplier ? partnerRef(supplier) : null,
        available: fmtQty(available),
        onOrder: fmtQty(ordered),
        reorderPoint: fmtQty(item.reorderPoint!),
        toOrderQty: fmtQty(rounded.baseQty),
        toOrderPurchaseQty: fmtQty(rounded.purchaseQty),
        purchaseUnit: link?.purchaseUnit ?? item.purchaseUnit ?? item.baseUnit,
        lastPurchasePrice: price === null ? null : fmtCost(price),
        needBy: lead === null ? null : addCalendarDays(today(), lead),
        gap: available.plus(ordered).div(dec(item.reorderPoint!).gt(0) ? dec(item.reorderPoint!) : dec(1)),
      });
    }
    return out.sort((a, b) => a.gap.comparedTo(b.gap)).map(({ gap: _gap, ...rest }) => rest);
  }

  /** One draft purchase order per supplier from the chosen reorder suggestions (D-326). */
  async draftFromReorder(scope: ErpScope, itemIds: string[]): Promise<ErpDraftFromReorderResultDto> {
    const suggestions = new Map((await this.reorder(scope)).map((s) => [s.item.id, s]));
    const items = await this.stock.items(this.workspace.db, scope.factory.id, itemIds);
    const skipped: ReturnType<typeof itemRef>[] = [];
    const wanted: DraftLine[] = [];
    for (const item of items) {
      const s = suggestions.get(item.publicId);
      if (!s || !s.supplier) {
        skipped.push(itemRef(item));
        continue;
      }
      wanted.push({
        item,
        supplierId: s.supplier.id,
        quantity: s.toOrderPurchaseQty,
        unit: s.purchaseUnit,
        unitPrice: s.lastPurchasePrice ?? '0',
        lead: item.leadTimeDays ?? 0,
      });
    }
    const created = await this.draftOrders(scope, wanted, 'สร้างจากรายการของใกล้หมด');
    return { created: created.map((c) => c.summary), skipped };
  }

  /** Draft purchase orders, one per supplier, from priced lines (reorder, purchase requests, MRP). */
  async draftOrders(scope: ErpScope, lines: DraftLine[], note: string) {
    const bySupplier = new Map<string, DraftLine[]>();
    for (const l of lines) bySupplier.set(l.supplierId, [...(bySupplier.get(l.supplierId) ?? []), l]);
    const created = [];
    for (const [supplierId, rows] of bySupplier) {
      const lead = Math.max(0, ...rows.map((r) => r.lead));
      const po = await this.create(scope, {
        supplierId,
        expectedOn: lead > 0 ? addCalendarDays(today(), lead) : null,
        note,
        lines: rows.map((r) => ({
          itemId: r.item.publicId,
          quantity: r.quantity,
          unit: r.unit,
          unitPrice: dec(r.unitPrice).toFixed(6),
        })),
      });
      created.push({ summary: poSummaryDto(po), po, rows });
    }
    return created;
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
    return paginated(
      rows.map((r) => grDto(r)),
      total,
      q,
    );
  }

  async getReceipt(
    scope: ErpScope,
    publicId: string,
    perms: ReadonlySet<string> = new Set(),
  ): Promise<ErpGoodsReceiptDto> {
    const row = await this.workspace.db.erpGoodsReceipt.findFirst({
      where: { factoryId: scope.factory.id, publicId },
      include: GR_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return grDto(row, perms);
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
      const freeLinks = new Map(
        (
          await tx.erpItemSupplier.findMany({
            where: { supplierId: supplier.id, itemId: { in: freeItems.map((x) => x.id) } },
          })
        ).map((x) => [x.itemId, x]),
      );
      let free = 0;
      const lines = body.lines.map((l, i) => {
        const quantity = dec(l.quantity);
        // D-349: what was refused at inspection is recorded but neither stocked nor received.
        const rejected = dec(l.rejectedQuantity ?? '0');
        if (!quantity.plus(rejected).gt(0))
          throw new DomainException('validation.failed', {
            errors: [{ path: `lines.${i}.quantity`, code: 'invalid', message: 'Must be more than zero' }],
          });
        if (rejected.gt(0) && !l.rejectReason)
          throw new DomainException('validation.failed', {
            errors: [{ path: `lines.${i}.rejectReason`, code: 'required', message: 'Why it was refused' }],
          });
        const inspection = {
          rejectedQuantity: fmtQty(rejected),
          rejectReason: rejected.gt(0) ? (l.rejectReason ?? null) : null,
        };
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
              ...inspection,
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
        const { unit, factor } = this.unitOf(item, l.unit, `lines.${i}.unit`, freeLinks.get(item.id));
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
            ...inspection,
          },
          item,
          lastPrice: price,
          purchaseUnit: unit === item.purchaseUnit || !item.purchaseUnit,
        };
      });

      // D-350: charges entered with the receipt go into the stock cost of the accepted lines.
      const charges = await this.chargeParts(
        tx,
        scope,
        body.charges ?? [],
        lines.map((l) => ({ amount: dec(l.line.amount), base: dec(l.line.baseQuantity) })),
      );
      lines.forEach((l, i) => {
        const landed = charges.reduce((a, c) => a.plus(c.split[i]!), dec(0));
        Object.assign(l.line, { landedAmount: fmtMoney(landed) });
      });
      const chargesTotal = charges.reduce((a, c) => a.plus(c.amount), dec(0));
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
          chargesTotal: fmtMoney(chargesTotal),
          createdById: scope.actor.userId,
          lines: { create: lines.map((l) => l.line) },
        },
        include: { lines: true },
      });
      const grLines = [...gr.lines].sort((a, b) => a.lineNo - b.lineNo);
      for (const c of charges)
        await tx.erpLandedCharge.create({
          data: {
            factoryId: scope.factory.id,
            goodsReceiptId: gr.id,
            kind: c.kind,
            description: c.description,
            amount: fmtMoney(c.amount),
            allocation: c.allocation,
            partnerId: c.partnerId,
            reference: c.reference,
            atReceipt: true,
            absorbed: fmtMoney(c.amount),
            createdById: scope.actor.userId,
            lines: {
              create: grLines.map((gl, i) => ({
                goodsReceiptLineId: gl.id,
                amount: fmtMoney(c.split[i]!),
                absorbed: fmtMoney(c.split[i]!),
              })),
            },
          },
        });

      const entries: StockEntry[] = lines
        .filter((l) => dec(l.line.baseQuantity).gt(0))
        .map((l) => ({
          item: l.item,
          warehouse,
          kind: 'receipt',
          quantity: dec(l.line.baseQuantity),
          unitCost: dec(l.line.unitCost).plus(
            dec((l.line as { landedAmount?: string }).landedAmount ?? '0').div(dec(l.line.baseQuantity)),
          ),
          lotNo: l.line.lotNo,
          reason: body.deliveryNoteNo ? `ใบส่งของ ${body.deliveryNoteNo}` : null,
        }));
      if (entries.length)
        await this.stock.post(tx, scope, settings, entries, {
          type: 'goods_receipt',
          publicId: gr.publicId,
          documentNo: grNo,
          occurredAt: receivedOn === today() ? new Date() : day(receivedOn),
        });

      for (const l of lines) {
        if (!dec(l.line.quantity).gt(0)) continue;
        // D-347: a price more than the threshold above the last paid raises an alert.
        await this.priceAlert(tx, scope, settings, {
          item: l.item,
          supplier,
          base: l.lastPrice.div(dec(l.line.factor)),
          documentNo: grNo,
          key: `gr:${gr.publicId}:${l.line.lineNo}`,
        });
        // D-334: what was paid, per the unit it came in (net, without VAT), into the price history.
        await this.pricing.note(tx, {
          factoryId: scope.factory.id,
          userId: scope.actor.userId,
          item: l.item,
          supplier,
          source: 'goods_receipt',
          unit: l.line.unit,
          factor: dec(l.line.factor),
          unitPrice: l.lastPrice,
          quantity: dec(l.line.quantity),
          pricedOn: receivedOn,
          sourcePublicId: gr.publicId,
          documentNo: grNo,
        });
        await tx.erpItem.update({
          where: { id: l.item.id },
          data: {
            lastPurchasePrice: fmtCost(
              l.purchaseUnit
                ? l.lastPrice
                : l.lastPrice.div(dec(l.line.factor)).times(dec(l.item.purchaseFactor)),
            ),
          },
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

  /** D-347: raises a price-rise alert when `base` (per base unit) is above the last paid by the threshold. */
  private async priceAlert(
    tx: Tx,
    scope: ErpScope,
    settings: ErpFactorySettings,
    p: { item: ErpItem; supplier: ErpTradingPartner; base: MoneyValue; documentNo: string; key: string },
  ) {
    const before = await this.pricing.lastPaid(tx, p.item.id, p.supplier.id);
    const rise = priceRise(p.base, before, dec(settings.priceAlertPct));
    if (!rise) return;
    await this.alerts.raise(tx, {
      factoryId: scope.factory.id,
      factoryPublicId: scope.factory.publicId,
      kind: 'price_rise',
      dedupeKey: `price_rise:${p.key}`,
      subjectType: 'item',
      subjectPublicId: p.item.publicId,
      payload: {
        item: p.item.name,
        sku: p.item.sku,
        supplier: p.supplier.name,
        changePct: rise.toFixed(2),
        price: fmtCost(p.base),
        previous: fmtCost(before!),
        unit: p.item.baseUnit,
        documentNo: p.documentNo,
      },
    });
  }

  /** D-350: charges with their split over receipt lines (by value or by accepted base quantity). */
  private async chargeParts(
    tx: Tx,
    scope: ErpScope,
    inputs: ErpChargeInput[],
    lines: { amount: MoneyValue; base: MoneyValue }[],
  ) {
    const out = [];
    for (const [i, c] of inputs.entries()) {
      const amount = dec(c.amount);
      if (!amount.gt(0))
        throw new DomainException('validation.failed', {
          errors: [{ path: `charges.${i}.amount`, code: 'invalid', message: 'Must be more than zero' }],
        });
      let partnerId: bigint | null = null;
      if (c.partnerId) {
        const partner = await tx.erpTradingPartner.findFirst({
          where: { factoryId: scope.factory.id, publicId: c.partnerId },
        });
        if (!partner) throw new DomainException('http.not_found');
        partnerId = partner.id;
      }
      const allocation = (c.allocation ?? 'by_value') as ErpChargeAllocation;
      // Only accepted lines carry cost; a line refused in full takes none.
      const weights = lines.map((l) =>
        !l.base.gt(0) ? dec(0) : allocation === 'by_value' ? l.amount : l.base,
      );
      if (!weights.some((w) => w.gt(0)))
        throw new DomainException('validation.failed', {
          errors: [
            { path: `charges.${i}`, code: 'invalid', message: 'Nothing was accepted to carry the charge' },
          ],
        });
      out.push({
        kind: c.kind as ErpChargeKind,
        description: c.description ?? null,
        amount,
        allocation,
        partnerId,
        reference: c.reference ?? null,
        split: allocate(amount, weights),
      });
    }
    return out;
  }

  /**
   * D-350: a charge that arrives after the receipt (the carrier's invoice). Split over the receipt's lines; each
   * line's share goes into the stock value of what is still on hand of it (a `landed_cost` movement with no
   * quantity) and the rest is reported as not absorbed.
   */
  async addCharge(
    scope: ErpScope,
    publicId: string,
    body: ErpChargeInput,
    perms: ReadonlySet<string>,
  ): Promise<ErpGoodsReceiptDto> {
    await this.workspace.tx(async (tx) => {
      const gr = await tx.erpGoodsReceipt.findFirst({
        where: { factoryId: scope.factory.id, publicId },
        include: { lines: { include: { item: true } }, warehouse: true },
      });
      if (!gr) throw new DomainException('http.not_found');
      await tx.$queryRaw`SELECT id FROM erp_goods_receipts WHERE id = ${gr.id} FOR UPDATE`;
      const lines = [...gr.lines].sort((a, b) => a.lineNo - b.lineNo);
      const [charge] = await this.chargeParts(
        tx,
        scope,
        [body],
        lines.map((l) => ({ amount: dec(l.amount), base: dec(l.baseQuantity) })),
      );
      const settings = await this.workspace.settings(tx, scope.factory.id);
      const movementIds: string[] = [];
      const absorbedBy: MoneyValue[] = [];
      for (const [i, l] of lines.entries()) {
        const share = charge!.split[i]!;
        if (!share.gt(0)) {
          absorbedBy.push(dec(0));
          continue;
        }
        const balance = await tx.erpStockBalance.findUnique({
          where: { itemId_warehouseId: { itemId: l.itemId, warehouseId: gr.warehouseId } },
        });
        const take = absorbable(share, dec(balance?.onHand ?? 0), dec(l.baseQuantity));
        absorbedBy.push(take);
        if (take.gt(0)) {
          const moved = await this.stock.revalue(tx, scope, settings, {
            item: l.item,
            warehouse: gr.warehouse,
            value: take,
            source: { type: 'goods_receipt', publicId: gr.publicId, documentNo: gr.grNo },
            reason: `ต้นทุนแฝง ${body.kind}${body.reference ? ` ${body.reference}` : ''}`,
          });
          if (moved) movementIds.push(moved);
        }
      }
      const absorbed = absorbedBy.reduce((a, x) => a.plus(x), dec(0));
      const landed = await tx.erpLandedCharge.create({
        data: {
          factoryId: scope.factory.id,
          goodsReceiptId: gr.id,
          kind: charge!.kind,
          description: charge!.description,
          amount: fmtMoney(charge!.amount),
          allocation: charge!.allocation,
          partnerId: charge!.partnerId,
          reference: charge!.reference,
          atReceipt: false,
          absorbed: fmtMoney(absorbed),
          createdById: scope.actor.userId,
          lines: {
            create: lines.map((l, i) => ({
              goodsReceiptLineId: l.id,
              amount: fmtMoney(charge!.split[i]!),
              absorbed: fmtMoney(absorbedBy[i]!),
            })),
          },
        },
      });
      await this.workspace.record(
        tx,
        scope,
        'erp_goods_receipt.charge_added',
        'erp_goods_receipt',
        gr.publicId,
        {
          grNo: gr.grNo,
          kind: body.kind,
          chargeId: landed.publicId,
          movementIds,
        },
      );
    });
    return this.getReceipt(scope, publicId, perms);
  }
}
