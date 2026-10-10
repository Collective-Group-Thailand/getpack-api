import { DomainException } from '@common/errors/domain.exception';
import { uuidv7 } from '@common/ids/uuidv7';
import { type MoneyValue } from '@common/money/money';
import { paginated, toSkipTake } from '@common/pagination/pagination';
import { addCalendarDays, bangkokDate, startOfBangkokDay } from '@common/time/bangkok';
import { type PrismaService, type Tx } from '@database/prisma.service';
import {
  type ErpDocumentType,
  type ErpFactorySettings,
  type ErpItem,
  type ErpMovementKind,
  type ErpWarehouse,
  Prisma,
} from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';

import {
  type ErpMovementListQuery,
  type ErpStockAdjustDto,
  type ErpStockBalanceDto,
  type ErpStockIssueDto,
  type ErpStockListQuery,
  type ErpStockOverviewDto,
  type ErpStockPostingDto,
  type ErpStockTransferDto,
} from './erp.dto';
import {
  applyMovement,
  type BalanceState,
  cost6,
  dec,
  fmtCost,
  fmtMoney,
  fmtQty,
  money2,
  type MovementEffect,
} from './erp.math';
import { isLow, itemRef, movementDto, type MovementRow, warehouseRef } from './erp-views';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

/** One stock change to post (D-324). `quantity` is signed, in the item's base unit. */
export interface StockEntry {
  item: ErpItem;
  warehouse: ErpWarehouse;
  kind: ErpMovementKind;
  quantity: MoneyValue;
  /** Incoming cost per base unit (receipt, opening); others take the average (D-321). */
  unitCost?: MoneyValue;
  /** Takes the unit cost the previous entry left at (a transfer's "in" after its "out"). */
  costOfPrevious?: boolean;
  lotNo?: string | null;
  reason?: string | null;
  /** Of an outgoing quantity, the part that was reserved for it and is released now (D-341). */
  releaseReserved?: MoneyValue;
}

export interface StockSource {
  type:
    | 'goods_receipt'
    | 'adjustment'
    | 'issue'
    | 'transfer'
    | 'production_order'
    | 'maintenance_order'
    | 'delivery_note'
    | 'sales_note';
  publicId: string;
  documentNo: string;
  occurredAt?: Date;
}

const MOVEMENT_INCLUDE = {
  item: true,
  warehouse: true,
  createdBy: { select: { displayName: true } },
} as const;

/** Fallback cost of an item without an average yet: its last purchase price per base unit. */
const fallbackCost = (item: ErpItem): MoneyValue =>
  item.lastPurchasePrice === null ? dec(0) : dec(item.lastPurchasePrice).div(dec(item.purchaseFactor));

/**
 * The stock ledger (M2; D-321, D-322, D-324): every change to on hand is an append-only movement written with
 * the balance it leaves, in the caller's transaction, with the balances row-locked in a fixed order.
 */
@Injectable()
export class ErpStockService {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly audit: AuditService,
  ) {}

  /** Posts entries in order; refuses an issue beyond what is available unless the factory allows it (D-322). */
  async post(
    tx: Tx,
    scope: ErpScope,
    settings: ErpFactorySettings,
    entries: StockEntry[],
    source: StockSource,
  ): Promise<MovementRow[]> {
    const key = (e: StockEntry) => `${e.item.id}:${e.warehouse.id}`;
    const pairs = [...new Map(entries.map((e) => [key(e), e])).values()].sort((a, b) =>
      a.item.id === b.item.id ? (a.warehouse.id < b.warehouse.id ? -1 : 1) : a.item.id < b.item.id ? -1 : 1,
    );
    const state = new Map<string, BalanceState & { id: bigint; reserved: MoneyValue }>();
    for (const e of pairs) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO erp_stock_balances (factory_id, item_id, warehouse_id)
        VALUES (${scope.factory.id}, ${e.item.id}, ${e.warehouse.id})
        ON CONFLICT (item_id, warehouse_id) DO NOTHING`);
      const [row] = await tx.$queryRaw<
        {
          id: bigint;
          on_hand: Prisma.Decimal;
          reserved: Prisma.Decimal;
          avg_cost: Prisma.Decimal;
          value: Prisma.Decimal;
        }[]
      >(Prisma.sql`
        SELECT id, on_hand, reserved, avg_cost, value FROM erp_stock_balances
         WHERE item_id = ${e.item.id} AND warehouse_id = ${e.warehouse.id} FOR UPDATE`);
      state.set(key(e), {
        id: row!.id,
        onHand: dec(row!.on_hand),
        reserved: dec(row!.reserved),
        avgCost: dec(row!.avg_cost),
        value: dec(row!.value),
      });
    }

    const occurredAt = source.occurredAt ?? new Date();
    const out: MovementRow[] = [];
    let previous: MovementEffect | null = null;
    for (const e of entries) {
      if (e.item.trackLots && !e.lotNo)
        throw new DomainException('erp.lot_required', { params: { item: e.item.name } });
      const before = state.get(key(e))!;
      const release = e.releaseReserved && e.releaseReserved.gt(0) ? e.releaseReserved : dec(0);
      if (release.gt(before.reserved)) throw new RangeError('Releasing more than is reserved');
      if (e.quantity.isNegative() && !settings.allowNegativeStock) {
        const available = before.onHand.minus(before.reserved).plus(release);
        if (available.plus(e.quantity).isNegative())
          throw new DomainException('erp.stock_insufficient', {
            params: {
              item: e.item.name,
              available: fmtQty(available),
              requested: fmtQty(e.quantity.negated()),
              unit: e.item.baseUnit,
            },
          });
      }
      const effect = applyMovement(before, e.quantity, {
        unitCost: e.costOfPrevious && previous ? previous.unitCost : e.unitCost,
        fallbackCost: fallbackCost(e.item),
      });
      previous = effect;
      state.set(key(e), { ...before, ...effect.after, reserved: before.reserved.minus(release) });
      await tx.erpStockBalance.update({
        where: { id: before.id },
        data: {
          ...(release.gt(0) && { reserved: fmtQty(before.reserved.minus(release)) }),
          onHand: fmtQty(effect.after.onHand),
          avgCost: fmtCost(effect.after.avgCost),
          value: fmtMoney(effect.after.value),
        },
      });
      const movement = await tx.erpStockMovement.create({
        data: {
          factoryId: scope.factory.id,
          itemId: e.item.id,
          warehouseId: e.warehouse.id,
          kind: e.kind,
          quantity: fmtQty(effect.quantity),
          unitCost: fmtCost(effect.unitCost),
          value: fmtMoney(effect.value),
          balanceAfter: fmtQty(effect.after.onHand),
          avgCostAfter: fmtCost(effect.after.avgCost),
          lotNo: e.lotNo ?? null,
          sourceType: source.type,
          sourcePublicId: source.publicId,
          documentNo: source.documentNo,
          reason: e.reason ?? null,
          occurredAt,
          createdById: scope.actor.userId,
        },
        include: MOVEMENT_INCLUDE,
      });
      out.push(movement);
    }
    return out;
  }

  /**
   * D-350: adds `value` to what is on hand of an item in a warehouse without changing the quantity — a
   * `landed_cost` movement — so the moving average carries a charge that came after the receipt.
   */
  async revalue(
    tx: Tx,
    scope: ErpScope,
    _settings: ErpFactorySettings,
    e: {
      item: ErpItem;
      warehouse: ErpWarehouse;
      value: MoneyValue;
      source: StockSource;
      reason: string | null;
    },
  ): Promise<void> {
    const [row] = await tx.$queryRaw<
      { id: bigint; on_hand: Prisma.Decimal; value: Prisma.Decimal; avg_cost: Prisma.Decimal }[]
    >(Prisma.sql`
      SELECT id, on_hand, value, avg_cost FROM erp_stock_balances
       WHERE item_id = ${e.item.id} AND warehouse_id = ${e.warehouse.id} FOR UPDATE`);
    if (!row || !dec(row.on_hand).gt(0)) return;
    const value = money2(dec(row.value).plus(e.value));
    const avgCost = cost6(value.div(dec(row.on_hand)));
    await tx.erpStockBalance.update({
      where: { id: row.id },
      data: { value: fmtMoney(value), avgCost: fmtCost(avgCost) },
    });
    await tx.erpStockMovement.create({
      data: {
        factoryId: scope.factory.id,
        itemId: e.item.id,
        warehouseId: e.warehouse.id,
        kind: 'landed_cost',
        quantity: '0',
        unitCost: fmtCost(avgCost),
        value: fmtMoney(e.value),
        balanceAfter: fmtQty(row.on_hand),
        avgCostAfter: fmtCost(avgCost),
        sourceType: e.source.type,
        sourcePublicId: e.source.publicId,
        documentNo: e.source.documentNo,
        reason: e.reason,
        occurredAt: new Date(),
        createdById: scope.actor.userId,
      },
    });
  }

  /**
   * Holds stock for a production order (D-341): up to `wanted`, never more than is free (on hand less what is
   * already reserved) in the warehouse; returns what was reserved. The balance row is locked.
   */
  async reserve(tx: Tx, factoryId: bigint, itemId: bigint, warehouseId: bigint, wanted: MoneyValue) {
    if (!wanted.gt(0)) return dec(0);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO erp_stock_balances (factory_id, item_id, warehouse_id)
      VALUES (${factoryId}, ${itemId}, ${warehouseId})
      ON CONFLICT (item_id, warehouse_id) DO NOTHING`);
    const [row] = await tx.$queryRaw<{ id: bigint; on_hand: Prisma.Decimal; reserved: Prisma.Decimal }[]>(
      Prisma.sql`SELECT id, on_hand, reserved FROM erp_stock_balances
                  WHERE item_id = ${itemId} AND warehouse_id = ${warehouseId} FOR UPDATE`,
    );
    const free = dec(row!.on_hand).minus(dec(row!.reserved));
    const take = free.gt(wanted) ? wanted : free;
    if (!take.gt(0)) return dec(0);
    await tx.erpStockBalance.update({
      where: { id: row!.id },
      data: { reserved: fmtQty(dec(row!.reserved).plus(take)) },
    });
    return take;
  }

  /** Gives back a reservation (an order cancelled, completed or reduced). */
  async unreserve(tx: Tx, itemId: bigint, warehouseId: bigint, quantity: MoneyValue) {
    if (!quantity.gt(0)) return;
    const [row] = await tx.$queryRaw<{ id: bigint; reserved: Prisma.Decimal }[]>(Prisma.sql`
      SELECT id, reserved FROM erp_stock_balances
       WHERE item_id = ${itemId} AND warehouse_id = ${warehouseId} FOR UPDATE`);
    if (!row) return;
    const left = dec(row.reserved).minus(quantity);
    await tx.erpStockBalance.update({
      where: { id: row.id },
      data: { reserved: fmtQty(left.isNegative() ? 0 : left) },
    });
  }

  /** Items of this factory by public id, in the order asked; unknown ids are 404, archived ones refused. */
  async items(
    db: Tx | PrismaService,
    factoryId: bigint,
    publicIds: string[],
    options: { allowArchived?: boolean } = {},
  ) {
    const rows = await db.erpItem.findMany({
      where: { factoryId, publicId: { in: [...new Set(publicIds)] } },
    });
    const byId = new Map(rows.map((r) => [r.publicId, r]));
    return publicIds.map((id) => {
      const item = byId.get(id);
      if (!item) throw new DomainException('http.not_found');
      if (item.status === 'archived' && !options.allowArchived)
        throw new DomainException('erp.archived', { params: { name: item.name } });
      return item;
    });
  }

  // ------------------------------------------------------------------------------- documents

  /** Opening balances, adjustments and counts (D-324): numbered `ADJ`, reason required except for openings. */
  async adjust(scope: ErpScope, body: ErpStockAdjustDto): Promise<ErpStockPostingDto> {
    if (body.kind !== 'opening' && !body.reason)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'reason', code: 'required', message: 'A reason is required' }],
      });
    return this.workspace.tx(async (tx) => {
      const settings = await this.workspace.settings(tx, scope.factory.id);
      const warehouse = await this.workspace.warehouse(tx, scope, body.warehouseId);
      const items = await this.items(
        tx,
        scope.factory.id,
        body.lines.map((l) => l.itemId),
      );
      const entries: StockEntry[] = [];
      for (const [i, line] of body.lines.entries()) {
        const item = items[i]!;
        const quantity = dec(line.quantity);
        if (body.kind === 'count') {
          if (quantity.isNegative()) throw this.lineError(i, 'quantity', 'A count cannot be negative');
          const balance = await tx.erpStockBalance.findUnique({
            where: { itemId_warehouseId: { itemId: item.id, warehouseId: warehouse.id } },
          });
          const delta = quantity.minus(dec(balance?.onHand ?? 0));
          if (delta.isZero()) continue;
          entries.push({
            item,
            warehouse,
            kind: 'count',
            quantity: delta,
            lotNo: line.lotNo,
            reason: body.reason,
          });
        } else if (body.kind === 'opening') {
          if (!quantity.gt(0)) throw this.lineError(i, 'quantity', 'An opening balance must be positive');
          entries.push({
            item,
            warehouse,
            kind: 'opening',
            quantity,
            unitCost: line.unitCost ? dec(line.unitCost) : fallbackCost(item),
            lotNo: line.lotNo,
            reason: body.reason,
          });
        } else {
          if (quantity.isZero()) throw this.lineError(i, 'quantity', 'An adjustment cannot be zero');
          entries.push({
            item,
            warehouse,
            kind: 'adjustment',
            quantity,
            lotNo: line.lotNo,
            reason: body.reason,
          });
        }
      }
      if (entries.length === 0) return { id: uuidv7(), documentNo: null, movements: [] };
      return this.document(
        tx,
        scope,
        settings,
        entries,
        'adjustment',
        'adj',
        async (documentNo, publicId) => {
          await this.audit.record(tx, {
            category: 'data_access',
            action: `erp.stock_${body.kind}`,
            resourceType: 'erp_stock_document',
            resourcePublicId: publicId,
            data: { documentNo, lines: entries.length },
          });
        },
      );
    });
  }

  /** Issues to production or use, and returns of unused stock (D-324), numbered `ISS`. */
  async issue(scope: ErpScope, body: ErpStockIssueDto): Promise<ErpStockPostingDto> {
    return this.workspace.tx(async (tx) => {
      const settings = await this.workspace.settings(tx, scope.factory.id);
      const warehouse = await this.workspace.warehouse(tx, scope, body.warehouseId);
      const items = await this.items(
        tx,
        scope.factory.id,
        body.lines.map((l) => l.itemId),
      );
      const reason = [body.reference, body.reason].filter(Boolean).join(' · ') || null;
      const entries = body.lines.map((line, i): StockEntry => {
        const quantity = dec(line.quantity);
        if (!quantity.gt(0)) throw this.lineError(i, 'quantity', 'The quantity must be positive');
        return {
          item: items[i]!,
          warehouse,
          kind: body.kind,
          quantity: body.kind === 'issue' ? quantity.negated() : quantity,
          lotNo: line.lotNo,
          reason,
        };
      });
      return this.document(tx, scope, settings, entries, 'issue', 'iss');
    });
  }

  /** Moves stock between two warehouses at its average cost (D-321), numbered `TRF`. */
  async transfer(scope: ErpScope, body: ErpStockTransferDto): Promise<ErpStockPostingDto> {
    if (body.fromWarehouseId === body.toWarehouseId) throw new DomainException('erp.same_warehouse');
    return this.workspace.tx(async (tx) => {
      const settings = await this.workspace.settings(tx, scope.factory.id);
      const from = await this.workspace.warehouse(tx, scope, body.fromWarehouseId);
      const to = await this.workspace.warehouse(tx, scope, body.toWarehouseId);
      const items = await this.items(
        tx,
        scope.factory.id,
        body.lines.map((l) => l.itemId),
      );
      const entries = body.lines.flatMap((line, i): StockEntry[] => {
        const quantity = dec(line.quantity);
        if (!quantity.gt(0)) throw this.lineError(i, 'quantity', 'The quantity must be positive');
        const item = items[i]!;
        const common = { item, lotNo: line.lotNo, reason: body.reason };
        return [
          { ...common, warehouse: from, kind: 'transfer_out', quantity: quantity.negated() },
          { ...common, warehouse: to, kind: 'transfer_in', quantity, costOfPrevious: true },
        ];
      });
      return this.document(tx, scope, settings, entries, 'transfer', 'trf');
    });
  }

  private async document(
    tx: Tx,
    scope: ErpScope,
    settings: ErpFactorySettings,
    entries: StockEntry[],
    type: StockSource['type'],
    docType: ErpDocumentType,
    after?: (documentNo: string, publicId: string) => Promise<void>,
  ): Promise<ErpStockPostingDto> {
    const publicId = uuidv7();
    const documentNo = await this.workspace.nextNumber(tx, scope.factory.id, docType);
    const movements = await this.post(tx, scope, settings, entries, { type, publicId, documentNo });
    await this.workspace.record(
      tx,
      scope,
      `erp_stock.${type === 'adjustment' ? 'adjusted' : type === 'issue' ? 'issued' : 'transferred'}`,
      'erp_stock_document',
      publicId,
      {
        documentNo,
        movements: movements.length,
      },
    );
    await after?.(documentNo, publicId);
    return { id: publicId, documentNo, movements: movements.map(movementDto) };
  }

  private lineError(index: number, field: string, message: string): DomainException {
    return new DomainException('validation.failed', {
      errors: [{ path: `lines.${index}.${field}`, code: 'invalid', message }],
    });
  }

  // ----------------------------------------------------------------------------------- reads

  /** Balances by item and warehouse (M2). */
  async balances(scope: ErpScope, q: ErpStockListQuery) {
    const factoryId = scope.factory.id;
    let warehouseId: bigint | undefined;
    if (q.warehouseId) {
      const w = await this.workspace.db.erpWarehouse.findFirst({
        where: { factoryId, publicId: q.warehouseId },
      });
      if (!w) throw new DomainException('http.not_found');
      warehouseId = w.id;
    }
    const search = q.q?.trim();
    const where: Prisma.ErpStockBalanceWhereInput = {
      factoryId,
      ...(warehouseId !== undefined && { warehouseId }),
      item: {
        status: 'active',
        ...(q.kind && { kind: q.kind as ErpItem['kind'] }),
        ...(search && {
          OR: [
            { sku: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
          ],
        }),
      },
    };
    const rows = await this.workspace.db.erpStockBalance.findMany({
      where,
      include: { item: true, warehouse: true },
      orderBy: [{ item: { sku: 'asc' } }, { warehouseId: 'asc' }],
    });
    const onOrder = await this.onOrder(factoryId);
    const totals = new Map<bigint, MoneyValue>();
    for (const r of rows)
      totals.set(r.itemId, (totals.get(r.itemId) ?? dec(0)).plus(dec(r.onHand)).minus(dec(r.reserved)));
    const dtos: ErpStockBalanceDto[] = rows.map((r) => {
      const low = isLow(r.item, {
        onHand: (totals.get(r.itemId) ?? dec(0)).toString(),
        reserved: '0',
        value: '0',
        onOrder: (onOrder.get(r.itemId) ?? dec(0)).toString(),
      });
      return {
        item: itemRef(r.item),
        warehouse: warehouseRef(r.warehouse),
        onHand: fmtQty(r.onHand),
        reserved: fmtQty(r.reserved),
        available: fmtQty(dec(r.onHand).minus(dec(r.reserved))),
        avgCost: fmtCost(r.avgCost),
        value: fmtMoney(r.value),
        reorderPoint: r.item.reorderPoint === null ? null : fmtQty(r.item.reorderPoint),
        low,
      };
    });
    const filtered = q.low ? dtos.filter((d) => d.low) : dtos;
    const { skip, take } = toSkipTake(q);
    return paginated(filtered.slice(skip, skip + take), filtered.length, q);
  }

  /** Base quantity on order per item: issued purchase orders not yet fully received. */
  async onOrder(
    factoryId: bigint,
    db: Tx | PrismaService = this.workspace.db,
  ): Promise<Map<bigint, MoneyValue>> {
    const rows = await db.$queryRaw<{ item_id: bigint; qty: Prisma.Decimal }[]>(Prisma.sql`
      SELECT l.item_id, SUM(GREATEST(l.quantity - l.received_qty, 0) * l.factor) AS qty
        FROM erp_purchase_order_lines l JOIN erp_purchase_orders p ON p.id = l.purchase_order_id
       WHERE p.factory_id = ${factoryId} AND p.status IN ('issued', 'partially_received')
       GROUP BY l.item_id`);
    return new Map(rows.map((r) => [r.item_id, dec(r.qty)]));
  }

  /** On hand, reserved and value per item across warehouses. */
  async totals(factoryId: bigint, itemIds?: bigint[]) {
    const rows = await this.workspace.db.erpStockBalance.groupBy({
      by: ['itemId'],
      where: { factoryId, ...(itemIds && { itemId: { in: itemIds } }) },
      _sum: { onHand: true, reserved: true, value: true },
    });
    return new Map(
      rows.map((r) => [
        r.itemId,
        { onHand: r._sum.onHand ?? '0', reserved: r._sum.reserved ?? '0', value: r._sum.value ?? '0' },
      ]),
    );
  }

  /** The stock page header (M2): items, low, negative, value, open and late purchase orders. */
  async overview(scope: ErpScope): Promise<ErpStockOverviewDto> {
    const factoryId = scope.factory.id;
    const [items, totals, onOrder, open, late] = await Promise.all([
      this.workspace.db.erpItem.findMany({ where: { factoryId, status: 'active' } }),
      this.totals(factoryId),
      this.onOrder(factoryId),
      this.workspace.db.erpPurchaseOrder.count({
        where: { factoryId, status: { in: ['issued', 'partially_received'] } },
      }),
      this.workspace.db.erpPurchaseOrder.count({
        where: {
          factoryId,
          status: { in: ['issued', 'partially_received'] },
          expectedOn: { lt: startOfBangkokDay(bangkokDate(new Date())) },
        },
      }),
    ]);
    let value = dec(0);
    let low = 0;
    let negative = 0;
    for (const item of items) {
      const t = totals.get(item.id) ?? { onHand: '0', reserved: '0', value: '0' };
      value = value.plus(dec(t.value));
      if (dec(t.onHand).isNegative()) negative += 1;
      if (isLow(item, { ...t, onOrder: (onOrder.get(item.id) ?? dec(0)).toString() })) low += 1;
    }
    return {
      items: items.length,
      low,
      negative,
      value: fmtMoney(value),
      currency: 'THB',
      openPurchaseOrders: open,
      latePurchaseOrders: late,
    };
  }

  /** The stock ledger, newest first (D-324). */
  async movements(scope: ErpScope, q: ErpMovementListQuery) {
    const factoryId = scope.factory.id;
    const where: Prisma.ErpStockMovementWhereInput = { factoryId };
    if (q.itemId) {
      const item = await this.workspace.db.erpItem.findFirst({ where: { factoryId, publicId: q.itemId } });
      if (!item) throw new DomainException('http.not_found');
      where.itemId = item.id;
    }
    if (q.warehouseId) {
      const w = await this.workspace.db.erpWarehouse.findFirst({
        where: { factoryId, publicId: q.warehouseId },
      });
      if (!w) throw new DomainException('http.not_found');
      where.warehouseId = w.id;
    }
    if (q.kind) where.kind = q.kind as ErpMovementKind;
    if (q.from || q.to)
      where.occurredAt = {
        ...(q.from && { gte: startOfBangkokDay(q.from) }),
        ...(q.to && { lt: startOfBangkokDay(addCalendarDays(q.to, 1)) }),
      };
    const search = q.q?.trim();
    if (search)
      where.OR = [
        { documentNo: { contains: search, mode: 'insensitive' } },
        { lotNo: { contains: search, mode: 'insensitive' } },
        { item: { name: { contains: search, mode: 'insensitive' } } },
        { item: { sku: { contains: search, mode: 'insensitive' } } },
      ];
    const [rows, total] = await Promise.all([
      this.workspace.db.erpStockMovement.findMany({
        where,
        include: MOVEMENT_INCLUDE,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpStockMovement.count({ where }),
    ]);
    return paginated(rows.map(movementDto), total, q);
  }
}
