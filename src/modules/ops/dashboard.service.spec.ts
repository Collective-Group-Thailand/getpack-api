import { type PrismaService } from '@database/prisma.service';
import { bankLineWhere, unidentifiedWhere } from '@modules/banking/banking-queues';
import { CLAIM_QUEUE_WHERE } from '@modules/claims/claim-queues';
import { companyListWhere } from '@modules/companies/company-queues';
import { PERMISSIONS } from '@modules/iam/permissions.catalog';
import { SHIPMENT_QUEUE_WHERE } from '@modules/logistics/shipment-queues';
import { orderQueueWhere } from '@modules/orders/order-operations.service';
import { STATEMENT_QUEUE_WHERE } from '@modules/payables/statement-queues';
import { refundListWhere, SLIP_QUEUE_WHERE } from '@modules/payments/payment-queues';
import { payoutRunWhere } from '@modules/payouts/payouts.dto';
import { JOB_QUEUE_WHERE } from '@modules/production/job-queues';
import { receivableListWhere } from '@modules/receivables/receivables.dto';
import { whtCertificateWhere } from '@modules/receivables/wht-certificates.service';
import { RFQ_QUEUE_WHERE } from '@modules/rfq/rfq-queues';

import { CLOSE_TASK_QUEUE_WHERE, DashboardService } from './dashboard.service';

describe('admin dashboard queues (U-B0.3)', () => {
  const definitions = new DashboardService({} as PrismaService).definitions();

  it('has unique keys, each gated on a permission of the catalogue', () => {
    const known = new Set(PERMISSIONS.map((p) => p.key));
    expect(new Set(definitions.map((d) => d.key)).size).toBe(definitions.length);
    for (const d of definitions) expect(known.has(d.permission)).toBe(true);
  });

  it('carries every finance queue the finance home reads (F6)', () => {
    expect(definitions.map((d) => d.key)).toEqual(
      expect.arrayContaining([
        'finance.slips',
        'finance.unmatched_bank_lines',
        'finance.unidentified_receipts',
        'finance.payout_runs_awaiting_approval',
        'finance.deliveries_without_gr',
        'finance.bills_missing_tax_invoice',
        'finance.wht_certificates_missing',
        'finance.overdue_b2b_invoices',
        'finance.refunds_to_pay',
        'finance.close_tasks',
      ]),
    );
  });

  /**
   * Each card's count is the total of the list it opens: the count query takes the list's own where builder with the
   * filter in the card's path (the bug: "รอชำระ" counted order groups while its list shows orders; "waiting factory"
   * and the board's awaiting column were separate queries).
   */
  describe('counts with the filter of the list each card opens', () => {
    const now = new Date('2026-10-31T03:00:00Z');
    const seen = new Map<string, unknown[]>();
    const model = (name: string) => ({
      count: jest.fn((args: { where: unknown }) => {
        seen.set(name, [...(seen.get(name) ?? []), args.where]);
        return Promise.resolve(4);
      }),
      findFirst: jest.fn().mockResolvedValue(null),
    });
    const db = Object.fromEntries(
      [
        'order',
        'rfq',
        'productionJob',
        'shipment',
        'claim',
        'company',
        'slip',
        'bankStatementLine',
        'unidentifiedReceipt',
        'payoutRun',
        'billingStatement',
        'customerWhtCertificate',
        'receivableItem',
        'refund',
        'closeTask',
      ].map((n) => [n, model(n)]),
    );
    let queues: Awaited<ReturnType<DashboardService['queuesFor']>> = [];

    beforeAll(async () => {
      const service = new DashboardService(db as unknown as PrismaService);
      queues = await service.queuesFor(new Set(PERMISSIONS.map((p) => p.key)), now);
    });

    const first = (name: string) => seen.get(name)?.[0];
    const all = (name: string) => seen.get(name) ?? [];

    it('orders: the order work queues (orders, not order groups)', () => {
      expect(all('order')).toEqual(
        expect.arrayContaining([
          orderQueueWhere('waiting_payment', 3, now),
          orderQueueWhere('artwork_review', 3, now),
          orderQueueWhere('waiting_production', 3, now),
          orderQueueWhere('late', 3, now),
        ]),
      );
      expect(queues.find((q) => q.key === 'orders.waiting_payment')).toMatchObject({
        path: '/orders?queue=waiting_payment',
        count: 4,
      });
    });

    it('RFQs, production, shipments, claims, companies', () => {
      expect(first('rfq')).toEqual(RFQ_QUEUE_WHERE.awaiting_first_response);
      expect(all('productionJob')).toEqual(
        expect.arrayContaining([JOB_QUEUE_WHERE.awaiting_acceptance, JOB_QUEUE_WHERE.at_risk]),
      );
      expect(all('shipment')).toEqual(
        expect.arrayContaining([
          SHIPMENT_QUEUE_WHERE.exceptions,
          SHIPMENT_QUEUE_WHERE.pod_review,
          SHIPMENT_QUEUE_WHERE.without_goods_receipt,
        ]),
      );
      expect(first('claim')).toEqual(CLAIM_QUEUE_WHERE.open);
      expect(first('company')).toEqual(companyListWhere({ status: 'kyc_review' }));
    });

    it('finance', () => {
      expect(first('slip')).toEqual(SLIP_QUEUE_WHERE);
      expect(first('bankStatementLine')).toEqual(bankLineWhere({ matchStatus: 'unmatched' }));
      expect(first('unidentifiedReceipt')).toEqual(unidentifiedWhere('open'));
      expect(first('payoutRun')).toEqual(payoutRunWhere({ status: 'proposed' }));
      expect(first('billingStatement')).toEqual(STATEMENT_QUEUE_WHERE.missing_tax_invoice);
      expect(first('customerWhtCertificate')).toEqual(whtCertificateWhere({ status: 'pending' }, now));
      expect(first('receivableItem')).toEqual(receivableListWhere({ overdue: true, b2b: true }, now));
      expect(first('refund')).toEqual(refundListWhere({ status: 'approved' }));
      expect(first('closeTask')).toEqual(CLOSE_TASK_QUEUE_WHERE);
    });

    it('opens each card on the list filter it counts', () => {
      const path = (key: string) => definitions.find((d) => d.key === key)?.path;
      expect(path('rfqs.awaiting_first_response')).toBe('/rfq?queue=awaiting_first_response');
      expect(path('claims.open')).toBe('/claims?queue=open');
      expect(path('finance.deliveries_without_gr')).toBe('/shipments?queue=without_goods_receipt');
      expect(path('finance.bills_missing_tax_invoice')).toBe(
        '/finance/payables/statements?queue=missing_tax_invoice',
      );
      expect(path('finance.overdue_b2b_invoices')).toBe('/finance/receivables?overdue=true&b2b=true');
    });
  });
});
