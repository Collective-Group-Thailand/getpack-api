import { etagOf } from '@common/etag/etag';
import { type ActionRule, nextActions } from '@common/next-actions/next-actions';
import { bangkokDate, toBangkokIso } from '@common/time/bangkok';
import {
  type ErpGoodsReceipt,
  type ErpGoodsReceiptLine,
  type ErpItem,
  type ErpPurchaseOrder,
  type ErpPurchaseOrderLine,
  type ErpStockMovement,
  type ErpTradingPartner,
  type ErpWarehouse,
  type Material,
  type Prisma,
  type User,
} from '@generated/prisma/client';

import {
  type ErpGoodsReceiptDto,
  type ErpItemDto,
  type ErpItemRefDto,
  type ErpPurchaseOrderDto,
  type ErpPurchaseOrderSummaryDto,
  type ErpRefDto,
  type ErpStockMovementDto,
  type ErpTradingPartnerDto,
  type ErpWarehouseDto,
} from './erp.dto';
import { dec, fmtCost, fmtMoney, fmtQty } from './erp.math';

const day = (value: Date | null): string | null => (value ? value.toISOString().slice(0, 10) : null);
const pct = (value: Prisma.Decimal | string) => dec(value).toFixed(4);

export const partnerEtag = (p: { publicId: string; rowVersion: number }) => etagOf(p.publicId, p.rowVersion);

export function partnerRef(p: Pick<ErpTradingPartner, 'publicId' | 'code' | 'name'>): ErpRefDto {
  return { id: p.publicId, code: p.code, name: p.name };
}

export function warehouseRef(w: Pick<ErpWarehouse, 'publicId' | 'code' | 'name'>): ErpRefDto {
  return { id: w.publicId, code: w.code, name: w.name };
}

export function itemRef(i: Pick<ErpItem, 'publicId' | 'sku' | 'name' | 'kind' | 'baseUnit'>): ErpItemRefDto {
  return { id: i.publicId, sku: i.sku, name: i.name, kind: i.kind, baseUnit: i.baseUnit };
}

export function tradingPartnerDto(p: ErpTradingPartner): ErpTradingPartnerDto {
  return {
    id: p.publicId,
    code: p.code,
    kind: p.kind,
    name: p.name,
    taxId: p.taxId,
    branchCode: p.branchCode,
    contactName: p.contactName,
    phone: p.phone,
    email: p.email,
    address: p.address,
    paymentTermDays: p.paymentTermDays,
    creditLimit: p.creditLimit === null ? null : fmtMoney(p.creditLimit),
    note: p.note,
    status: p.status,
    version: p.rowVersion,
    createdAt: toBangkokIso(p.createdAt),
    updatedAt: toBangkokIso(p.updatedAt),
  };
}

export function warehouseDto(w: ErpWarehouse): ErpWarehouseDto {
  return {
    id: w.publicId,
    code: w.code,
    name: w.name,
    isDefault: w.isDefault,
    status: w.status,
    version: w.rowVersion,
  };
}

/** On hand, reserved, value and on order of one item across warehouses. */
export interface ItemStock {
  onHand: Prisma.Decimal | string;
  reserved: Prisma.Decimal | string;
  value: Prisma.Decimal | string;
  onOrder: Prisma.Decimal | string;
}

export const NO_STOCK: ItemStock = { onHand: '0', reserved: '0', value: '0', onOrder: '0' };

/** D-326: low when what is available plus on order is at or below the reorder point. */
export function isLow(item: Pick<ErpItem, 'reorderPoint'>, stock: ItemStock): boolean {
  if (item.reorderPoint === null) return false;
  return dec(stock.onHand).minus(dec(stock.reserved)).plus(dec(stock.onOrder)).lte(dec(item.reorderPoint));
}

export function itemDto(
  i: ErpItem & { material: Material | null; defaultSupplier: ErpTradingPartner | null },
  stock: ItemStock = NO_STOCK,
): ErpItemDto {
  const onHand = dec(stock.onHand);
  const value = dec(stock.value);
  return {
    id: i.publicId,
    sku: i.sku,
    name: i.name,
    kind: i.kind,
    material: i.material ? { id: i.material.publicId, code: i.material.code, name: i.material.nameTh } : null,
    baseUnit: i.baseUnit,
    purchaseUnit: i.purchaseUnit,
    purchaseFactor: fmtCost(i.purchaseFactor),
    reorderPoint: i.reorderPoint === null ? null : fmtQty(i.reorderPoint),
    reorderQty: i.reorderQty === null ? null : fmtQty(i.reorderQty),
    leadTimeDays: i.leadTimeDays,
    defaultSupplier: i.defaultSupplier ? partnerRef(i.defaultSupplier) : null,
    trackLots: i.trackLots,
    lastPurchasePrice: i.lastPurchasePrice === null ? null : fmtCost(i.lastPurchasePrice),
    note: i.note,
    status: i.status,
    stock: {
      onHand: fmtQty(onHand),
      reserved: fmtQty(stock.reserved),
      onOrder: fmtQty(stock.onOrder),
      available: fmtQty(onHand.minus(dec(stock.reserved))),
      avgCost: fmtCost(onHand.gt(0) ? value.div(onHand) : 0),
      value: fmtMoney(value),
      low: isLow(i, stock),
    },
    version: i.rowVersion,
  };
}

export type MovementRow = ErpStockMovement & {
  item: ErpItem;
  warehouse: ErpWarehouse;
  createdBy: Pick<User, 'displayName'>;
};

export function movementDto(m: MovementRow): ErpStockMovementDto {
  return {
    id: m.publicId,
    occurredAt: toBangkokIso(m.occurredAt),
    kind: m.kind,
    item: itemRef(m.item),
    warehouse: warehouseRef(m.warehouse),
    quantity: fmtQty(m.quantity),
    unitCost: fmtCost(m.unitCost),
    value: fmtMoney(m.value),
    balanceAfter: fmtQty(m.balanceAfter),
    lotNo: m.lotNo,
    documentNo: m.documentNo,
    sourceType: m.sourceType,
    sourceId: m.sourcePublicId,
    reason: m.reason,
    by: m.createdBy.displayName,
  };
}

// --------------------------------------------------------------------------------- purchasing

export interface PoFacts {
  status: string;
}

const OPEN = ['issued', 'partially_received'];

/** The factory's actions on its purchase order (D-325). */
export const PO_ACTIONS: ActionRule<PoFacts>[] = [
  { key: 'erp_po.edit', permissions: ['factory_procurement.manage'], when: (p) => p.status === 'draft' },
  {
    key: 'erp_po.issue',
    permissions: ['factory_procurement.approve'],
    irreversible: true,
    when: (p) => p.status === 'draft',
  },
  { key: 'erp_po.receive', permissions: ['factory_inventory.manage'], when: (p) => OPEN.includes(p.status) },
  {
    key: 'erp_po.close',
    permissions: ['factory_procurement.manage'],
    when: (p) => p.status === 'partially_received',
  },
  {
    key: 'erp_po.cancel',
    permissions: ['factory_procurement.manage'],
    irreversible: true,
    when: (p) => p.status === 'draft' || p.status === 'issued',
  },
];

export const poEtag = (p: { publicId: string; rowVersion: number }) => etagOf(p.publicId, p.rowVersion);

export type PoRow = ErpPurchaseOrder & {
  supplier: ErpTradingPartner;
  lines: (ErpPurchaseOrderLine & { item: ErpItem })[];
  goodsReceipts: ErpGoodsReceipt[];
};

export function isLate(
  p: Pick<ErpPurchaseOrder, 'status' | 'expectedOn'>,
  today = bangkokDate(new Date()),
): boolean {
  return OPEN.includes(p.status) && p.expectedOn !== null && day(p.expectedOn)! < today;
}

export function receivedPct(lines: Pick<ErpPurchaseOrderLine, 'quantity' | 'receivedQty'>[]): string {
  const ordered = lines.reduce((a, l) => a.plus(dec(l.quantity)), dec(0));
  if (ordered.isZero()) return '0.00';
  const received = lines.reduce(
    (a, l) => a.plus(dec(l.receivedQty).gt(dec(l.quantity)) ? dec(l.quantity) : dec(l.receivedQty)),
    dec(0),
  );
  return received.times(100).div(ordered).toFixed(2);
}

export function poSummaryDto(
  p: ErpPurchaseOrder & { supplier: ErpTradingPartner; lines: ErpPurchaseOrderLine[] },
): ErpPurchaseOrderSummaryDto {
  return {
    id: p.publicId,
    poNo: p.poNo,
    status: p.status,
    supplier: partnerRef(p.supplier),
    orderedOn: day(p.orderedOn)!,
    expectedOn: day(p.expectedOn),
    late: isLate(p),
    total: fmtMoney(p.total),
    currency: 'THB',
    lineCount: p.lines.length,
    receivedPct: receivedPct(p.lines),
  };
}

export function poDto(p: PoRow, perms: ReadonlySet<string>): ErpPurchaseOrderDto {
  return {
    id: p.publicId,
    poNo: p.poNo,
    status: p.status,
    supplier: partnerRef(p.supplier),
    orderedOn: day(p.orderedOn)!,
    expectedOn: day(p.expectedOn),
    late: isLate(p),
    vatMode: p.vatMode,
    vatRatePct: pct(p.vatRatePct),
    subtotal: fmtMoney(p.subtotal),
    vatAmount: fmtMoney(p.vatAmount),
    total: fmtMoney(p.total),
    currency: 'THB',
    supplierRef: p.supplierRef,
    deliverTo: p.deliverTo,
    note: p.note,
    issuedAt: p.issuedAt ? toBangkokIso(p.issuedAt) : null,
    closedAt: p.closedAt ? toBangkokIso(p.closedAt) : null,
    cancelReason: p.cancelReason,
    lines: [...p.lines]
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((l) => {
        const remaining = dec(l.quantity).minus(dec(l.receivedQty));
        return {
          id: l.publicId,
          lineNo: l.lineNo,
          item: itemRef(l.item),
          description: l.description,
          quantity: fmtQty(l.quantity),
          unit: l.unit,
          factor: fmtCost(l.factor),
          unitPrice: fmtCost(l.unitPrice),
          discountPct: pct(l.discountPct),
          amount: fmtMoney(l.amount),
          receivedQty: fmtQty(l.receivedQty),
          remainingQty: fmtQty(remaining.isNegative() ? 0 : remaining),
        };
      }),
    receipts: [...p.goodsReceipts]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((g) => ({
        id: g.publicId,
        grNo: g.grNo,
        receivedOn: day(g.receivedOn)!,
        total: fmtMoney(g.total),
      })),
    nextActions: nextActions({ status: p.status }, PO_ACTIONS, perms),
    version: p.rowVersion,
  };
}

export type GrRow = ErpGoodsReceipt & {
  purchaseOrder: ErpPurchaseOrder | null;
  supplier: ErpTradingPartner;
  warehouse: ErpWarehouse;
  createdBy: Pick<User, 'displayName'>;
  lines: (ErpGoodsReceiptLine & { item: ErpItem })[];
};

export function grDto(g: GrRow): ErpGoodsReceiptDto {
  return {
    id: g.publicId,
    grNo: g.grNo,
    purchaseOrder: g.purchaseOrder
      ? { id: g.purchaseOrder.publicId, code: g.purchaseOrder.poNo ?? '', name: g.purchaseOrder.poNo ?? '' }
      : null,
    supplier: partnerRef(g.supplier),
    warehouse: warehouseRef(g.warehouse),
    receivedOn: day(g.receivedOn)!,
    deliveryNoteNo: g.deliveryNoteNo,
    note: g.note,
    total: fmtMoney(g.total),
    currency: 'THB',
    by: g.createdBy.displayName,
    createdAt: toBangkokIso(g.createdAt),
    lines: [...g.lines]
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((l) => ({
        lineNo: l.lineNo,
        item: itemRef(l.item),
        quantity: fmtQty(l.quantity),
        unit: l.unit,
        baseQuantity: fmtQty(l.baseQuantity),
        unitCost: fmtCost(l.unitCost),
        amount: fmtMoney(l.amount),
        lotNo: l.lotNo,
      })),
  };
}
