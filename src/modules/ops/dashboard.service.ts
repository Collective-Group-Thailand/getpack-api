import { bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { type PermissionKey } from '@modules/iam/permissions.catalog';
import { SHIPMENT_QUEUE_WHERE } from '@modules/logistics/shipment-queues';
import { orderQueueWhere } from '@modules/orders/order-operations.service';
import { Injectable } from '@nestjs/common';

export interface QueueCount {
  count: number;
  overdueCount: number;
  nextDueAt: Date | null;
}

interface QueueDefinition {
  key: string;
  path: string;
  permission: PermissionKey;
  count: (now: Date) => Promise<QueueCount>;
}

export interface DashboardQueue {
  key: string;
  path: string;
  count: number;
  overdueCount: number;
  nextDueAt: string | null;
}

/**
 * The staff dashboard (U-B0.3): one count per work queue the actor may work, with how many are past their due
 * time and the next due time. Due times are the SLA instants the modules store, already computed on the business
 * calendar (D-061 slips, D-074 factory acceptance, D-175 RFQ first response); queues without an SLA carry 0 / null.
 */
@Injectable()
export class DashboardService {
  private readonly queues: QueueDefinition[];

  constructor(private readonly prisma: PrismaService) {
    const db = this.prisma;
    const plain = async (n: Promise<number>): Promise<QueueCount> => ({
      count: await n,
      overdueCount: 0,
      nextDueAt: null,
    });
    const allOverdue = async (n: Promise<number>): Promise<QueueCount> => {
      const count = await n;
      return { count, overdueCount: count, nextDueAt: null };
    };
    /** count, those due before now, and the earliest due time still ahead. */
    const timed = async (
      count: Promise<number>,
      overdue: Promise<number>,
      next: Promise<Date | null | undefined>,
    ): Promise<QueueCount> => {
      const [c, o, n] = await Promise.all([count, overdue, next]);
      return { count: c, overdueCount: o, nextDueAt: n ?? null };
    };
    const today = (now: Date) => new Date(`${bangkokDate(now)}T00:00:00Z`);

    this.queues = [
      {
        key: 'orders.waiting_payment',
        path: '/orders?queue=waiting_payment',
        permission: 'orders.manage',
        count: (now) => {
          const where = { status: 'waiting_payment' as const };
          return timed(
            db.orderGroup.count({ where }),
            db.orderGroup.count({ where: { ...where, expiresAt: { lt: now } } }),
            db.orderGroup
              .findFirst({ where: { ...where, expiresAt: { gte: now } }, orderBy: { expiresAt: 'asc' } })
              .then((r) => r?.expiresAt),
          );
        },
      },
      {
        key: 'orders.artwork_review',
        path: '/orders?queue=artwork_review',
        permission: 'orders.manage',
        count: (now) => plain(db.order.count({ where: orderQueueWhere('artwork_review', 3, now) })),
      },
      {
        key: 'orders.waiting_production',
        path: '/orders?queue=waiting_production',
        permission: 'orders.manage',
        count: (now) => plain(db.order.count({ where: orderQueueWhere('waiting_production', 3, now) })),
      },
      {
        key: 'orders.late',
        path: '/orders?queue=late',
        permission: 'orders.manage',
        count: (now) => allOverdue(db.order.count({ where: orderQueueWhere('late', 3, now) })),
      },
      {
        key: 'rfqs.awaiting_first_response',
        path: '/rfq',
        permission: 'rfqs.manage',
        count: (now) => {
          const where: Prisma.RfqWhereInput = {
            status: { in: ['submitted', 'in_review', 'need_info'] },
            firstResponseAt: null,
          };
          return timed(
            db.rfq.count({ where }),
            db.rfq.count({ where: { ...where, slaDueAt: { lt: now } } }),
            db.rfq
              .findFirst({ where: { ...where, slaDueAt: { gte: now } }, orderBy: { slaDueAt: 'asc' } })
              .then((r) => r?.slaDueAt),
          );
        },
      },
      {
        key: 'production.awaiting_acceptance',
        path: '/production?queue=awaiting_acceptance',
        permission: 'production.manage',
        count: (now) => {
          const where = { status: 'released' as const };
          return timed(
            db.productionJob.count({ where }),
            db.productionJob.count({ where: { ...where, acceptDueAt: { lt: now } } }),
            db.productionJob
              .findFirst({ where: { ...where, acceptDueAt: { gte: now } }, orderBy: { acceptDueAt: 'asc' } })
              .then((r) => r?.acceptDueAt),
          );
        },
      },
      {
        key: 'production.at_risk',
        path: '/production?queue=at_risk',
        permission: 'production.manage',
        count: () =>
          plain(
            db.productionJob.count({
              where: { atRiskSince: { not: null }, status: { in: ['accepted', 'in_progress', 'on_hold'] } },
            }),
          ),
      },
      {
        key: 'shipments.exceptions',
        path: '/shipments?queue=exceptions',
        permission: 'shipments.manage',
        count: () => plain(db.shipment.count({ where: SHIPMENT_QUEUE_WHERE.exceptions })),
      },
      {
        key: 'shipments.pod_review',
        path: '/shipments?queue=pod_review',
        permission: 'shipments.manage',
        count: () => plain(db.shipment.count({ where: SHIPMENT_QUEUE_WHERE.pod_review })),
      },
      {
        key: 'claims.open',
        path: '/claims',
        permission: 'claims.manage',
        count: () =>
          plain(
            db.claim.count({
              where: { status: { in: ['submitted', 'under_review', 'need_info', 'factory_review'] } },
            }),
          ),
      },
      {
        key: 'companies.kyc_review',
        path: '/companies?status=kyc_review',
        permission: 'companies.kyc_review',
        count: () => plain(db.company.count({ where: { status: 'kyc_review' } })),
      },
      // --- finance (F6)
      {
        key: 'finance.slips',
        path: '/finance/slips',
        permission: 'payments.verify_slip',
        count: (now) => {
          const where = { verificationStatus: 'manual_review' as const };
          return timed(
            db.slip.count({ where }),
            db.slip.count({ where: { ...where, slaDueAt: { lt: now } } }),
            db.slip
              .findFirst({ where: { ...where, slaDueAt: { gte: now } }, orderBy: { slaDueAt: 'asc' } })
              .then((r) => r?.slaDueAt),
          );
        },
      },
      {
        key: 'finance.unmatched_bank_lines',
        path: '/finance/banking/lines',
        permission: 'banking.read',
        count: () => plain(db.bankStatementLine.count({ where: { matchStatus: 'unmatched' } })),
      },
      {
        key: 'finance.unidentified_receipts',
        path: '/finance/banking/unidentified',
        permission: 'banking.read',
        count: () => plain(db.unidentifiedReceipt.count({ where: { status: 'open' } })),
      },
      {
        key: 'finance.payout_runs_awaiting_approval',
        path: '/finance/payouts',
        permission: 'payouts.manage',
        count: () => plain(db.payoutRun.count({ where: { status: 'proposed' } })),
      },
      {
        key: 'finance.deliveries_without_gr',
        path: '/finance/payables/goods-receipts',
        permission: 'payables.read',
        count: () =>
          plain(db.shipment.count({ where: { status: 'delivered', goodsReceiptLines: { none: {} } } })),
      },
      {
        key: 'finance.bills_missing_tax_invoice',
        path: '/finance/payables/statements',
        permission: 'payables.read',
        count: () =>
          plain(
            db.billingStatement.count({
              where: {
                status: 'confirmed',
                vendorInvoices: { none: { status: { in: ['recorded', 'validated'] } } },
              },
            }),
          ),
      },
      {
        key: 'finance.wht_certificates_missing',
        path: '/finance/receivables/wht',
        permission: 'receivables.manage',
        count: () => plain(db.customerWhtCertificate.count({ where: { status: 'pending' } })),
      },
      {
        key: 'finance.overdue_b2b_invoices',
        path: '/finance/receivables/aging',
        permission: 'receivables.manage',
        count: (now) =>
          allOverdue(
            db.receivableItem.count({
              where: {
                companyId: { not: null },
                status: { in: ['open', 'partially_paid'] },
                dueDate: { lt: today(now) },
              },
            }),
          ),
      },
      {
        key: 'finance.refunds_to_pay',
        path: '/finance/refunds',
        permission: 'refunds.complete',
        count: () => plain(db.refund.count({ where: { status: 'approved' } })),
      },
      {
        key: 'finance.close_tasks',
        path: '/finance/close',
        permission: 'close.read',
        count: () =>
          plain(
            db.closeTask.count({
              where: {
                status: { in: ['pending', 'blocked'] },
                checklist: { status: { in: ['open', 'in_review'] } },
              },
            }),
          ),
      },
    ];
  }

  /** Every queue whose working permission the actor holds, in a stable order. */
  async queuesFor(permissions: ReadonlySet<string>, now = new Date()): Promise<DashboardQueue[]> {
    const mine = this.queues.filter((q) => permissions.has(q.permission));
    const counts = await Promise.all(mine.map((q) => q.count(now)));
    return mine.map((q, i) => ({
      key: q.key,
      path: q.path,
      count: counts[i]!.count,
      overdueCount: counts[i]!.overdueCount,
      nextDueAt: counts[i]!.nextDueAt ? toBangkokIso(counts[i]!.nextDueAt) : null,
    }));
  }

  /** The queue keys and their permissions (for the contract and tests). */
  definitions(): { key: string; permission: PermissionKey }[] {
    return this.queues.map(({ key, permission }) => ({ key, permission }));
  }
}
