import { formatMoney, MoneyDecimal } from '@common/money/money';
import { addCalendarDays, bangkokDate, startOfBangkokDay, toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';

import {
  type AdminOrderListItemDto,
  type AdminOrderListQuery,
  type CancelReasonDto,
} from './admin-orders.dto';
import { type OrderCustomerRefDto } from './orders.dto';

const OPEN_INSTALMENT = ['pending', 'due', 'overdue', 'partially_paid'] as const;

export const CUSTOMER_REF_SELECT = {
  publicId: true,
  displayName: true,
  customerProfile: { select: { customerCode: true } },
} satisfies Prisma.UserSelect;

export function customerRef(
  user: { publicId: string; displayName: string; customerProfile: { customerCode: string | null } | null },
  company: { legalName: string } | null,
): OrderCustomerRefDto {
  return {
    id: user.publicId,
    customerCode: user.customerProfile?.customerCode ?? null,
    displayName: user.displayName,
    companyName: company?.legalName ?? null,
  };
}

const LIST_INCLUDE = {
  productType: { select: { code: true } },
  selectedFactory: { select: { publicId: true, code: true, legalName: true, tradeName: true } },
  orderGroup: {
    include: {
      customer: { select: CUSTOMER_REF_SELECT },
      company: { select: { legalName: true } },
      paymentSchedule: { include: { instalments: { orderBy: { seq: 'asc' } } } },
      payments: {
        select: { slips: { where: { verificationStatus: 'manual_review' }, select: { slaDueAt: true } } },
      },
    },
  },
} satisfies Prisma.OrderInclude;
type ListRow = Prisma.OrderGetPayload<{ include: typeof LIST_INCLUDE }>;

/**
 * Staff order reads for the customer and company screens (U-B0.2): every order, filterable, with the customer and
 * factory refs, the next unpaid instalment and whether a slip waits for Finance. Costs and margins stay out (D-141).
 */
@Injectable()
export class AdminOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: AdminOrderListQuery) {
    const where: Prisma.OrderWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.artworkStatus && { artworkStatus: q.artworkStatus }),
      ...(q.productTypeCode && { productType: { code: q.productTypeCode } }),
      ...(q.factoryId && { selectedFactory: { publicId: q.factoryId } }),
      ...(q.q && {
        OR: [
          { orderCode: { startsWith: q.q, mode: 'insensitive' as const } },
          { orderGroup: { groupCode: { startsWith: q.q, mode: 'insensitive' as const } } },
        ],
      }),
      orderGroup: {
        ...(q.channel && { channel: q.channel }),
        ...(q.customerId && { customer: { publicId: q.customerId } }),
        ...(q.companyId && { company: { publicId: q.companyId } }),
        ...((q.placedFrom || q.placedTo) && {
          placedAt: {
            ...(q.placedFrom && { gte: startOfBangkokDay(q.placedFrom) }),
            ...(q.placedTo && { lt: startOfBangkokDay(addCalendarDays(q.placedTo, 1)) }),
          },
        }),
      },
    };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy: [{ orderGroup: { placedAt: 'desc' } }, { id: 'desc' }],
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { rows: rows.map((r) => this.row(r)), total };
  }

  async cancelReasons(appliesTo?: 'customer' | 'staff' | 'system'): Promise<CancelReasonDto[]> {
    const rows = await this.prisma.orderCancelReason.findMany({
      where: { active: true, ...(appliesTo && { appliesTo }) },
      orderBy: [{ sort: 'asc' }, { code: 'asc' }],
    });
    return rows.map((r) => ({
      code: r.code,
      nameTh: r.nameTh,
      nameEn: r.nameEn,
      appliesTo: r.appliesTo,
      requiresCreditNote: r.requiresCreditNote,
    }));
  }

  private row(o: ListRow): AdminOrderListItemDto {
    const g = o.orderGroup;
    const next = g.paymentSchedule?.instalments.find((i) =>
      (OPEN_INSTALMENT as readonly string[]).includes(i.status),
    );
    const reviewDue = g.payments
      .flatMap((p) => p.slips)
      .map((s) => s.slaDueAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const hasSlip = g.payments.some((p) => p.slips.length > 0);
    return {
      orderId: o.publicId,
      orderCode: o.orderCode,
      groupId: g.publicId,
      groupCode: g.groupCode,
      status: o.status,
      artworkStatus: o.artworkStatus,
      channel: g.channel,
      productTypeCode: o.productType.code,
      quantity: o.quantityOrdered,
      unit: o.unit,
      customer: customerRef(g.customer, g.company),
      factory: o.selectedFactory
        ? {
            id: o.selectedFactory.publicId,
            code: o.selectedFactory.code,
            name: o.selectedFactory.tradeName ?? o.selectedFactory.legalName,
          }
        : null,
      grossAmount: o.grossAmount.toFixed(2),
      currency: 'THB',
      promisedShipDate: o.promisedShipDate ? bangkokDate(o.promisedShipDate) : null,
      placedAt: toBangkokIso(g.placedAt),
      hasSlipToReview: hasSlip,
      slipReviewDueAt: reviewDue ? toBangkokIso(reviewDue) : null,
      nextInstalment: next
        ? {
            seq: next.seq,
            dueAt: next.dueAt ? toBangkokIso(next.dueAt) : null,
            openAmount: formatMoney(
              new MoneyDecimal(next.cashAmount.toString()).sub(next.paidAmount.toString()),
            ),
          }
        : null,
    };
  }
}
