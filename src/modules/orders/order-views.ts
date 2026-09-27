import { bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { type Prisma } from '@generated/prisma/client';

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

export function orderDto(row: OrderRow): OrderDto {
  return {
    id: row.publicId,
    orderCode: row.orderCode,
    status: row.status,
    artworkStatus: row.artworkStatus,
    productTypeCode: row.productType.code,
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

export function orderGroupDto(row: OrderGroupRow): OrderGroupDto {
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
    orders: row.orders.map(orderDto),
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
