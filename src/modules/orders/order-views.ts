import { bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { type Prisma } from '@generated/prisma/client';
import { lineSummary, SUMMARY_INCLUDE } from '@modules/quotes/line-summary';
import { type SettingsService } from '@platform/settings/settings.service';

import { type AddressSnapshotDto } from '../carts/carts.dto';
import {
  type AdminOrderDto,
  type AdminOrderGroupDto,
  type MoneyTotalsDto,
  type OrderDto,
  type OrderGroupDto,
} from './orders.dto';

export const ORDER_INCLUDE = {
  productType: true,
  cancelReason: { select: { code: true, nameTh: true, nameEn: true } },
  deliveryReconciliation: true,
  catalogProduct: SUMMARY_INCLUDE.catalogProduct,
  quote: true,
  selectedFactory: true,
  lines: { orderBy: { lineNo: 'asc' } },
  destinations: {
    orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    include: { province: true, subdistrict: { include: { district: true } } },
  },
} as const satisfies Prisma.OrderInclude;

export const GROUP_INCLUDE = {
  customer: true,
  placedBy: true,
  orders: { orderBy: { id: 'asc' }, include: ORDER_INCLUDE },
} as const satisfies Prisma.OrderGroupInclude;

export type OrderRow = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;
export type OrderGroupRow = Prisma.OrderGroupGetPayload<{ include: typeof GROUP_INCLUDE }>;

/** Cost and margin visibility of a staff reader (D-141). */
export interface CostGrants {
  cost: boolean;
  margin: boolean;
}

type Money = Prisma.Decimal;
function totals(row: {
  netAmount: Money;
  discountAmount: Money;
  shippingNetAmount: Money;
  vatAmount: Money;
  grossAmount: Money;
  whtAmount: Money;
  cashAmount: Money;
}): MoneyTotalsDto {
  return {
    netAmount: row.netAmount.toFixed(2),
    discountAmount: row.discountAmount.toFixed(2),
    shippingNetAmount: row.shippingNetAmount.toFixed(2),
    vatAmount: row.vatAmount.toFixed(2),
    grossAmount: row.grossAmount.toFixed(2),
    whtAmount: row.whtAmount.toFixed(2),
    cashAmount: row.cashAmount.toFixed(2),
    currency: 'THB',
  };
}

export function destinationSnapshot(d: OrderRow['destinations'][number]): AddressSnapshotDto {
  return {
    recipientName: d.recipientName,
    phone: d.phone,
    line1: d.line1,
    line2: d.line2,
    subdistrictId: d.subdistrict?.publicId ?? null,
    subdistrictNameTh: d.subdistrict?.nameTh ?? null,
    districtNameTh: d.subdistrict?.district.nameTh ?? null,
    provinceId: d.province.publicId,
    provinceNameTh: d.province.nameTh,
    postcode: d.postcode,
  };
}

/** What the order views read besides the row: the current `orders.auto_complete_days` (as the job uses it). */
export interface OrderViewContext {
  autoCompleteDays: number | null;
}

export async function orderViewContext(settings: SettingsService): Promise<OrderViewContext> {
  return { autoCompleteDays: Number((await settings.at('orders.auto_complete_days')).value) };
}

const DAY_MS = 86_400_000;

function receipt(row: OrderRow, ctx: OrderViewContext) {
  const pending = row.deliveredAt && !row.completedAt && !row.cancelledAt;
  return {
    deliveredAt: row.deliveredAt ? toBangkokIso(row.deliveredAt) : null,
    autoCompleteAt:
      pending && ctx.autoCompleteDays !== null
        ? toBangkokIso(new Date(row.deliveredAt!.getTime() + ctx.autoCompleteDays * DAY_MS))
        : null,
    claimWindowEndsAt: row.claimWindowEndsAt ? toBangkokIso(row.claimWindowEndsAt) : null,
    completedAt: row.completedAt ? toBangkokIso(row.completedAt) : null,
    completionMode: row.completionMode,
    confirmedAt:
      row.completionMode === 'customer_confirmed' && row.completedAt ? toBangkokIso(row.completedAt) : null,
  };
}

/** The customer's view of the latest tolerance reconciliation; the factory's payable quantity stays internal. */
function toleranceOutcome(row: OrderRow) {
  const r = row.deliveryReconciliation;
  return r
    ? {
        outcome: r.outcome,
        orderedQuantity: r.orderedQuantity,
        deliveredQuantity: r.deliveredQuantity,
        creditAmount: r.creditAmount?.toFixed(2) ?? null,
        evaluatedAt: toBangkokIso(r.evaluatedAt),
      }
    : null;
}

export function orderDto(row: OrderRow, ctx: OrderViewContext = { autoCompleteDays: null }): OrderDto {
  return {
    id: row.publicId,
    orderCode: row.orderCode,
    status: row.status,
    artworkStatus: row.artworkStatus,
    productTypeCode: row.productType.code,
    summary: lineSummary(
      { specSummary: row.quote.specSummary, productType: row.productType, catalogProduct: row.catalogProduct },
      row.unit,
    ),
    quoteId: row.quote.publicId,
    quantityOrdered: row.quantityOrdered,
    designOption: row.designOption,
    mockupOption: row.mockupOption,
    toleranceShortagePct: row.toleranceShortagePct?.toFixed(4) ?? null,
    toleranceOveragePct: row.toleranceOveragePct?.toFixed(4) ?? null,
    leadTimeDays: row.leadTimeDays,
    promisedShipDate: row.promisedShipDate ? bangkokDate(row.promisedShipDate) : null,
    totals: totals(row),
    lines: row.lines.map((l) => ({
      id: l.publicId,
      lineNo: l.lineNo,
      lineType: l.lineType,
      descriptionTh: l.descriptionTh,
      descriptionEn: l.descriptionEn,
      quantity: l.quantity.toString(),
      unitPrice: l.unitPrice.toFixed(6),
      netAmount: l.netAmount.toFixed(2),
      discountAmount: l.discountAmount.toFixed(2),
      vatRatePct: l.vatRatePct.toFixed(4),
      vatAmount: l.vatAmount.toFixed(2),
      grossAmount: l.grossAmount.toFixed(2),
      whtCategory: l.whtCategory,
      whtAmount: l.whtAmount.toFixed(2),
    })),
    destinations: row.destinations.map((d) => ({
      id: d.publicId,
      address: destinationSnapshot(d),
      quantity: d.quantity,
      shippingNetAmount: d.shippingNetAmount.toFixed(2),
    })),
    statusChangedAt: toBangkokIso(row.statusChangedAt),
    cancelledAt: row.cancelledAt ? toBangkokIso(row.cancelledAt) : null,
    cancelReasonCode: row.cancelReason?.code ?? null,
    cancelReasonNameTh: row.cancelReason?.nameTh ?? null,
    cancelReasonNameEn: row.cancelReason?.nameEn ?? null,
    receipt: receipt(row, ctx),
    toleranceOutcome: toleranceOutcome(row),
    createdAt: toBangkokIso(row.createdAt),
  };
}

export function adminOrderDto(row: OrderRow, grants: CostGrants): AdminOrderDto {
  return {
    ...orderDto(row),
    internal: {
      selectedFactoryId: row.selectedFactory?.publicId ?? null,
      buyCostNet: grants.cost ? (row.buyCostNet?.toFixed(2) ?? null) : null,
      marginAmount: grants.margin ? (row.marginAmount?.toFixed(2) ?? null) : null,
      marginPct: grants.margin ? (row.marginPct?.toFixed(4) ?? null) : null,
      belowMarginFloor: row.belowMarginFloor,
    },
  };
}

export function orderGroupDto(row: OrderGroupRow, ctx?: OrderViewContext): OrderGroupDto {
  return {
    id: row.publicId,
    groupCode: row.groupCode,
    status: row.status,
    channel: row.channel,
    customerId: row.customer.publicId,
    poNumber: row.poNumber,
    totals: totals(row),
    expiresAt: row.expiresAt ? toBangkokIso(row.expiresAt) : null,
    placedAt: toBangkokIso(row.placedAt),
    cancelledAt: row.cancelledAt ? toBangkokIso(row.cancelledAt) : null,
    ccEmails: row.ccEmails,
    orders: row.orders.map((o) => orderDto(o, ctx)),
  };
}

export function adminOrderGroupDto(row: OrderGroupRow, grants: CostGrants): AdminOrderGroupDto {
  return {
    ...orderGroupDto(row),
    csRemarks: row.csRemarks,
    placedById: row.placedBy.publicId,
    utm: (row.utm as Record<string, string> | null) ?? null,
    orders: row.orders.map((o) => adminOrderDto(o, grants)),
  };
}
