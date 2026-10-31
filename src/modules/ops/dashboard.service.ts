import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { bankLineWhere, unidentifiedWhere } from '@modules/banking/banking-queues';
import { CLAIM_QUEUE_WHERE } from '@modules/claims/claim-queues';
import { companyListWhere } from '@modules/companies/company-queues';
import { type PermissionKey } from '@modules/iam/permissions.catalog';
import { SHIPMENT_QUEUE_WHERE } from '@modules/logistics/shipment-queues';
import { orderQueueWhere } from '@modules/orders/order-operations.service';
import { STATEMENT_QUEUE_WHERE } from '@modules/payables/statement-queues';
import { refundListWhere, SLIP_QUEUE_WHERE } from '@modules/payments/payment-queues';
import { payoutRunWhere } from '@modules/payouts/payouts.dto';
import { JOB_QUEUE_WHERE } from '@modules/production/job-queues';
import { receivableListWhere } from '@modules/receivables/receivables.dto';
import { whtCertificateWhere } from '@modules/receivables/wht-certificates.service';
import { RFQ_QUEUE_WHERE } from '@modules/rfq/rfq-queues';
import { Injectable } from '@nestjs/common';

export interface QueueCount {
  count: number;
  overdueCount: number;
  nextDueAt: Date | null;
}

/** Close tasks still to do in a checklist that is open or in review (the dashboard card; no list spans periods). */
export const CLOSE_TASK_QUEUE_WHERE: Prisma.CloseTaskWhereInput = {
  status: { in: ['pending', 'blocked'] },
  checklist: { status: { in: ['open', 'in_review'] } },
};

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
    // Each card counts with the very filter of the list it opens (`path`): the same exported where builder, so the
    // number on the card is the list's `meta.total`. Staff read every factory (scope `all`), so no scope applies.
    this.queues = [
      {
        // admin.orderOperations.queue `waiting_payment` (orderQueueWhere): orders, not order groups — a group of
        // two orders is two rows on the list, so it counts two here (it used to count groups).
        key: 'orders.waiting_payment',
        path: '/orders?queue=waiting_payment',
        permission: 'orders.manage',
        count: (now) => {
          const where = orderQueueWhere('waiting_payment', 3, now);
          return timed(
            db.order.count({ where }),
            db.order.count({ where: { AND: [where, { orderGroup: { expiresAt: { lt: now } } }] } }),
            db.order
              .findFirst({
                where: { AND: [where, { orderGroup: { expiresAt: { gte: now } } }] },
                orderBy: { orderGroup: { expiresAt: 'asc' } },
                select: { orderGroup: { select: { expiresAt: true } } },
              })
              .then((r) => r?.orderGroup.expiresAt),
          );
        },
      },
      {
        // admin.orderOperations.queue `artwork_review` (orderQueueWhere).
        key: 'orders.artwork_review',
        path: '/orders?queue=artwork_review',
        permission: 'orders.manage',
        count: (now) => plain(db.order.count({ where: orderQueueWhere('artwork_review', 3, now) })),
      },
      {
        // admin.orderOperations.queue `waiting_production` (orderQueueWhere).
        key: 'orders.waiting_production',
        path: '/orders?queue=waiting_production',
        permission: 'orders.manage',
        count: (now) => plain(db.order.count({ where: orderQueueWhere('waiting_production', 3, now) })),
      },
      {
        // admin.orderOperations.queue `late` (orderQueueWhere).
        key: 'orders.late',
        path: '/orders?queue=late',
        permission: 'orders.manage',
        count: (now) => allOverdue(db.order.count({ where: orderQueueWhere('late', 3, now) })),
      },
      {
        // admin.rfqs.list `queue=awaiting_first_response` (RFQ_QUEUE_WHERE); overdue = its `overdue=true`.
        key: 'rfqs.awaiting_first_response',
        path: '/rfq?queue=awaiting_first_response',
        permission: 'rfqs.manage',
        count: (now) => {
          const where = RFQ_QUEUE_WHERE.awaiting_first_response;
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
        // admin.production.list `queue=awaiting_acceptance` (JOB_QUEUE_WHERE) = the board's awaiting column.
        key: 'production.awaiting_acceptance',
        path: '/production?queue=awaiting_acceptance',
        permission: 'production.manage',
        count: (now) => {
          const where = JOB_QUEUE_WHERE.awaiting_acceptance;
          return timed(
            db.productionJob.count({ where }),
            db.productionJob.count({ where: { AND: [where, { acceptDueAt: { lt: now } }] } }),
            db.productionJob
              .findFirst({
                where: { AND: [where, { acceptDueAt: { gte: now } }] },
                orderBy: { acceptDueAt: 'asc' },
              })
              .then((r) => r?.acceptDueAt),
          );
        },
      },
      {
        // admin.production.list `queue=at_risk` (JOB_QUEUE_WHERE).
        key: 'production.at_risk',
        path: '/production?queue=at_risk',
        permission: 'production.manage',
        count: () => plain(db.productionJob.count({ where: JOB_QUEUE_WHERE.at_risk })),
      },
      {
        // admin.shipments.list `queue=exceptions` (SHIPMENT_QUEUE_WHERE).
        key: 'shipments.exceptions',
        path: '/shipments?queue=exceptions',
        permission: 'shipments.manage',
        count: () => plain(db.shipment.count({ where: SHIPMENT_QUEUE_WHERE.exceptions })),
      },
      {
        // admin.shipments.list `queue=pod_review` (SHIPMENT_QUEUE_WHERE).
        key: 'shipments.pod_review',
        path: '/shipments?queue=pod_review',
        permission: 'shipments.manage',
        count: () => plain(db.shipment.count({ where: SHIPMENT_QUEUE_WHERE.pod_review })),
      },
      {
        // admin.claims.list `queue=open` (CLAIM_QUEUE_WHERE).
        key: 'claims.open',
        path: '/claims?queue=open',
        permission: 'claims.manage',
        count: () => plain(db.claim.count({ where: CLAIM_QUEUE_WHERE.open })),
      },
      {
        // admin.companies.list `status=kyc_review` (companyListWhere).
        key: 'companies.kyc_review',
        path: '/companies?status=kyc_review',
        permission: 'companies.kyc_review',
        count: () => plain(db.company.count({ where: companyListWhere({ status: 'kyc_review' }) })),
      },
      // --- finance (F6)
      {
        // admin.payments.slipQueue (SLIP_QUEUE_WHERE).
        key: 'finance.slips',
        path: '/finance/slips',
        permission: 'payments.verify_slip',
        count: (now) => {
          const where = SLIP_QUEUE_WHERE;
          return timed(
            db.slip.count({ where }),
            db.slip.count({ where: { AND: [where, { slaDueAt: { lt: now } }] } }),
            db.slip
              .findFirst({
                where: { AND: [where, { slaDueAt: { gte: now } }] },
                orderBy: { slaDueAt: 'asc' },
              })
              .then((r) => r?.slaDueAt),
          );
        },
      },
      {
        // admin.banking.listLines `matchStatus=unmatched` (bankLineWhere).
        key: 'finance.unmatched_bank_lines',
        path: '/finance/banking/lines?matchStatus=unmatched',
        permission: 'banking.read',
        count: () =>
          plain(db.bankStatementLine.count({ where: bankLineWhere({ matchStatus: 'unmatched' }) })),
      },
      {
        // admin.banking.listUnidentified `status=open` (unidentifiedWhere). The list returns at most 200 rows.
        key: 'finance.unidentified_receipts',
        path: '/finance/banking/unidentified?status=open',
        permission: 'banking.read',
        count: () => plain(db.unidentifiedReceipt.count({ where: unidentifiedWhere('open') })),
      },
      {
        // admin.payouts.list `status=proposed` (payoutRunWhere).
        key: 'finance.payout_runs_awaiting_approval',
        path: '/finance/payouts?status=proposed',
        permission: 'payouts.manage',
        count: () => plain(db.payoutRun.count({ where: payoutRunWhere({ status: 'proposed' }) })),
      },
      {
        // admin.shipments.list `queue=without_goods_receipt` (SHIPMENT_QUEUE_WHERE): the deliveries themselves —
        // the goods-receipt list cannot show a receipt that does not exist.
        key: 'finance.deliveries_without_gr',
        path: '/shipments?queue=without_goods_receipt',
        permission: 'payables.read',
        count: () => plain(db.shipment.count({ where: SHIPMENT_QUEUE_WHERE.without_goods_receipt })),
      },
      {
        // admin.payables.listStatements `queue=missing_tax_invoice` (STATEMENT_QUEUE_WHERE).
        key: 'finance.bills_missing_tax_invoice',
        path: '/finance/payables/statements?queue=missing_tax_invoice',
        permission: 'payables.read',
        count: () => plain(db.billingStatement.count({ where: STATEMENT_QUEUE_WHERE.missing_tax_invoice })),
      },
      {
        // admin.receivables.whtCertificates `status=pending` (whtCertificateWhere).
        key: 'finance.wht_certificates_missing',
        path: '/finance/receivables/wht?status=pending',
        permission: 'receivables.manage',
        count: (now) =>
          plain(db.customerWhtCertificate.count({ where: whtCertificateWhere({ status: 'pending' }, now) })),
      },
      {
        // admin.receivables.list `overdue=true&b2b=true` (receivableListWhere); the aging report is per customer,
        // not per item, so the card opens the list.
        key: 'finance.overdue_b2b_invoices',
        path: '/finance/receivables?overdue=true&b2b=true',
        permission: 'receivables.manage',
        count: (now) =>
          allOverdue(
            db.receivableItem.count({ where: receivableListWhere({ overdue: true, b2b: true }, now) }),
          ),
      },
      {
        // admin.refunds.list `status=approved` (refundListWhere).
        key: 'finance.refunds_to_pay',
        path: '/finance/refunds?status=approved',
        permission: 'refunds.complete',
        count: () => plain(db.refund.count({ where: refundListWhere({ status: 'approved' }) })),
      },
      {
        // No list endpoint spans checklists: admin.close.get shows one period's tasks. The card counts the
        // pending / blocked tasks of every checklist still open or in review (CLOSE_TASK_QUEUE_WHERE).
        key: 'finance.close_tasks',
        path: '/finance/close',
        permission: 'close.read',
        count: () => plain(db.closeTask.count({ where: CLOSE_TASK_QUEUE_WHERE })),
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

  /** The queue keys, the list each opens and their permissions (for the contract and tests). */
  definitions(): { key: string; path: string; permission: PermissionKey }[] {
    return this.queues.map(({ key, path, permission }) => ({ key, path, permission }));
  }
}
