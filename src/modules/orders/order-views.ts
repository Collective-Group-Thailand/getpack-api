import { statusLabels } from '@common/labels/status-labels';
import { STORE_VALUE_ALIASES } from '@common/labels/store-words';
import { nextActions, NO_PERMISSIONS } from '@common/next-actions/next-actions';
import { bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { type Prisma } from '@generated/prisma/client';
import { lineSummary, SUMMARY_INCLUDE } from '@modules/quotes/line-summary';
import { type SettingsService } from '@platform/settings/settings.service';

import { type AddressSnapshotDto } from '../carts/carts.dto';
import {
  actionOwnerOf,
  artworkOwner,
  customerArtworkNoteTh,
  customerArtworkStatus,
  customerStatusOf,
  OPEN_CLAIMS,
} from './customer-status';
import { ADMIN_ORDER_ACTIONS, STORE_ORDER_ACTIONS } from './order-actions';
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
  quoteOption: { select: { earliestShipDate: true, result: true } },
  selectedFactory: true,
  // D-437 / D-439: the group's payment terms and the open claims feed the customer status and the order's share.
  orderGroup: {
    select: {
      publicId: true,
      groupCode: true,
      status: true,
      expiresAt: true,
      grossAmount: true,
      cashAmount: true,
      orders: { where: { cancelledAt: null }, select: { id: true } },
    },
  },
  claims: OPEN_CLAIMS,
  lines: { orderBy: { lineNo: 'asc' } },
  destinations: {
    orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    include: { province: true, subdistrict: { include: { district: true } } },
  },
} as const satisfies Prisma.OrderInclude;

export const GROUP_INCLUDE = {
  customer: { include: { customerProfile: { select: { customerCode: true } } } },
  placedBy: true,
  company: { select: { legalName: true } },
  payments: { select: { slips: { where: { verificationStatus: 'manual_review' }, select: { id: true } } } },
  orders: { orderBy: { id: 'asc' }, include: ORDER_INCLUDE },
} as const satisfies Prisma.OrderGroupInclude;

export type OrderRow = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;
export type OrderGroupRow = Prisma.OrderGroupGetPayload<{ include: typeof GROUP_INCLUDE }>;

/** Cost and margin visibility of a staff reader (D-141). */
export interface CostGrants {
  cost: boolean;
  margin: boolean;
  /** The reader's permissions, for the staff `nextActions` (U-B0.3). */
  perms?: ReadonlySet<string>;
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

/** D-436: an unpaid group past its payment deadline — never cancelled; the customer re-quotes, then pays. */
export function paymentOverdue(
  group: { status: string; expiresAt: Date | null },
  now: Date = new Date(),
): boolean {
  return group.status === 'waiting_payment' && group.expiresAt !== null && group.expiresAt <= now;
}

function receipt(row: OrderRow, ctx: OrderViewContext) {
  const pending = row.deliveredAt && !row.completedAt && !row.cancelledAt;
  // Completion is held while a claim is open (B4.5): no automatic-completion date is promised meanwhile.
  const held = row.claims.length > 0;
  return {
    deliveredAt: row.deliveredAt ? toBangkokIso(row.deliveredAt) : null,
    completionHeldByClaim: Boolean(pending) && held,
    autoCompleteAt:
      pending && !held && ctx.autoCompleteDays !== null
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

/**
 * When the order should arrive: the quotation's earliest delivery date, moved by as many days as the promised ship
 * date moved from the quotation's earliest ship date (checkout re-plans a stale ship date). Null without a promise
 * or when the quotation had no delivery estimate (no zone lead time).
 */
export function estimatedDeliveryDate(
  promisedShipDate: Date | null,
  option: { earliestShipDate: Date | null; result: Prisma.JsonValue } | null,
): string | null {
  const delivery = (option?.result as { earliestDeliveryDate?: string | null } | null)?.earliestDeliveryDate;
  if (!promisedShipDate || !delivery) return null;
  const shift = Math.round(
    (promisedShipDate.getTime() - (option?.earliestShipDate ?? promisedShipDate).getTime()) / DAY_MS,
  );
  return new Date(Date.parse(`${delivery}T00:00:00Z`) + shift * DAY_MS).toISOString().slice(0, 10);
}

/** D-439: this order's share of what the group pays, next to the group's total and its deadline. */
function payment(row: OrderRow) {
  const group = row.orderGroup;
  return {
    groupId: group.publicId,
    groupCode: group.groupCode,
    groupOrderCount: group.orders.length,
    orderGrossAmount: row.grossAmount.toFixed(2),
    orderCashAmount: row.cashAmount.toFixed(2),
    groupGrossAmount: group.grossAmount.toFixed(2),
    groupCashAmount: group.cashAmount.toFixed(2),
    dueAt: group.status === 'waiting_payment' && group.expiresAt ? toBangkokIso(group.expiresAt) : null,
    overdue: paymentOverdue(group),
  };
}

export function orderDto(row: OrderRow, ctx: OrderViewContext = { autoCompleteDays: null }): OrderDto {
  // D-438 (B-API-4): an own-file order without a file reads "รอไฟล์จากคุณ" (customer), never the team's step.
  const artworkStatus = customerArtworkStatus(row.designOption, row.artworkStatus);
  const facts = { ...row, artworkStatus, openClaimCount: row.claims.length };
  const customerStatus = customerStatusOf(facts);
  return {
    id: row.publicId,
    orderCode: row.orderCode,
    status: row.status,
    ...statusLabels('OrderStatus', row.status),
    customerStatus,
    ...statusLabels('CustomerOrderStatus', customerStatus, 'customerStatus'),
    actionOwner: actionOwnerOf(customerStatus, facts),
    artworkStatus,
    ...statusLabels('ArtworkStatus', artworkStatus, 'artworkStatus'),
    artworkOwner: artworkOwner(artworkStatus),
    artworkNoteTh: customerArtworkNoteTh({ ...row, artworkStatus }),
    productTypeCode: row.productType.code,
    summary: lineSummary(
      {
        specSummary: row.quote.specSummary,
        productType: row.productType,
        catalogProduct: row.catalogProduct,
      },
      row.unit,
    ),
    quoteId: row.quote.publicId,
    quantityOrdered: row.quantityOrdered,
    designOption: row.designOption,
    mockupOption: row.mockupOption,
    toleranceShortagePct: row.toleranceShortagePct?.toFixed(4) ?? null,
    toleranceOveragePct: row.toleranceOveragePct?.toFixed(4) ?? null,
    toleranceDimensionalMm: row.toleranceDimensionalMm?.toFixed(2) ?? null,
    toleranceColourDeltaE: row.toleranceColourDeltaE?.toFixed(2) ?? null,
    leadTimeDays: row.leadTimeDays,
    promisedShipDate: row.promisedShipDate ? bangkokDate(row.promisedShipDate) : null,
    estimatedDeliveryDate: estimatedDeliveryDate(row.promisedShipDate, row.quoteOption),
    // D-439: before payment the dates are only the plan at placement — the storefront says "คำนวณหลังชำระเงิน".
    deliveryDateBasis: row.paidForProductionAt || row.cancelledAt ? 'planned' : 'after_payment',
    totals: totals(row),
    payment: payment(row),
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
    openClaims: row.claims.map((c) => {
      const status = STORE_VALUE_ALIASES[c.status] ?? c.status; // D-440: the customer's claim status
      return { id: c.publicId, claimNo: c.claimNo, status, ...statusLabels('ClaimStatus', status) };
    }),
    toleranceOutcome: toleranceOutcome(row),
    createdAt: toBangkokIso(row.createdAt),
    nextActions: nextActions(facts, STORE_ORDER_ACTIONS, NO_PERMISSIONS),
  };
}

export function adminOrderDto(row: OrderRow, grants: CostGrants): AdminOrderDto {
  return {
    ...orderDto(row),
    internal: {
      selectedFactoryId: row.selectedFactory?.publicId ?? null,
      buyPriceNet: grants.cost ? (row.buyCostNet?.toFixed(2) ?? null) : null,
      buyCostNet: grants.cost ? (row.buyCostNet?.toFixed(2) ?? null) : null,
      marginAmount: grants.margin ? (row.marginAmount?.toFixed(2) ?? null) : null,
      marginPct: grants.margin ? (row.marginPct?.toFixed(4) ?? null) : null,
      belowMarginFloor: row.belowMarginFloor,
    },
    nextActions: nextActions(row, ADMIN_ORDER_ACTIONS, grants.perms ?? NO_PERMISSIONS),
  };
}

export function orderGroupDto(row: OrderGroupRow, ctx?: OrderViewContext): OrderGroupDto {
  return {
    id: row.publicId,
    groupCode: row.groupCode,
    status: row.status,
    ...statusLabels('OrderGroupStatus', row.status),
    channel: row.channel,
    customerId: row.customer.publicId,
    poNumber: row.poNumber,
    totals: totals(row),
    expiresAt: row.expiresAt ? toBangkokIso(row.expiresAt) : null,
    paymentOverdue: paymentOverdue(row),
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
    customer: {
      id: row.customer.publicId,
      customerCode: row.customer.customerProfile?.customerCode ?? null,
      displayName: row.customer.displayName,
      companyName: row.company?.legalName ?? null,
    },
    placedBy: { id: row.placedBy.publicId, displayName: row.placedBy.displayName },
    taxProfile: (row.taxProfileSnapshot as Record<string, unknown> | null) ?? null,
    hasSlipToReview: row.payments.some((p) => p.slips.length > 0),
    utm: (row.utm as Record<string, string> | null) ?? null,
    orders: row.orders.map((o) => adminOrderDto(o, grants)),
  };
}
