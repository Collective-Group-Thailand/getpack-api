import { ADMIN_CLAIM_ACTIONS, PARTNER_CLAIM_ACTIONS } from '@modules/claims/claim-actions';
import { ADMIN_SHIPMENT_ACTIONS, PARTNER_SHIPMENT_ACTIONS } from '@modules/logistics/shipment-actions';
import { ADMIN_ORDER_ACTIONS, type OrderFacts, STORE_ORDER_ACTIONS } from '@modules/orders/order-actions';
import { PARTNER_STATEMENT_ACTIONS } from '@modules/payables/statement-actions';
import { RUN_ACTIONS } from '@modules/payouts/run-actions';
import { ADMIN_JOB_ACTIONS, PARTNER_JOB_ACTIONS } from '@modules/production/job-actions';
import { ADMIN_DOCUMENT_ACTIONS } from '@modules/receivables/document-actions';
import { ADMIN_RFQ_ACTIONS, STORE_RFQ_ACTIONS } from '@modules/rfq/rfq-actions';

import { type ActionRule, nextActions } from './next-actions';

const ALL = new Set([
  'claims.manage',
  'claims.override_liability',
  'claims.resolve',
  'factory_claims.respond',
  'shipments.manage',
  'factory_shipments.manage',
  'orders.cancel',
  'orders.reprice',
  'production.start_manual',
  'artwork.submit_on_behalf',
  'mockups.manage',
  'factory_payables.manage',
  'payouts.manage',
  'payouts.execute',
  'factory_jobs.respond',
  'factory_milestones.update',
  'factory_qc.record',
  'factory_issues.raise',
  'production.manage',
  'receivables.manage',
  'rfqs.manage',
]);
const keys = <T>(e: T, rules: ActionRule<T>[], perms: ReadonlySet<string> = ALL) =>
  nextActions(e, rules, perms).map((a) => (a.disabledReason ? `${a.key}!${a.disabledReason}` : a.key));

describe('entity next actions (U-B0.3)', () => {
  it('claims follow the claim transitions and liability rules', () => {
    const claim = { status: 'under_review', liability: 'undetermined', factoryId: null };
    expect(keys(claim, ADMIN_CLAIM_ACTIONS)).toEqual([
      'claim.request_info',
      'claim.send_to_factory!claims.no_factory',
      'claim.override_liability',
      'claim.approve!claims.liability_undetermined',
      'claim.reject',
    ]);
    expect(keys({ ...claim, status: 'approved' }, ADMIN_CLAIM_ACTIONS)).toEqual(['claim.resolve']);
    expect(keys({ ...claim, status: 'factory_review' }, PARTNER_CLAIM_ACTIONS)).toEqual(['claim.respond']);
    expect(keys({ ...claim, status: 'factory_review' }, PARTNER_CLAIM_ACTIONS, new Set())).toEqual([]);
  });

  it('shipments offer the gate as a blocked action while an instalment is unpaid', () => {
    const ready = {
      status: 'ready',
      carrier: 'factory_fleet',
      carrierRequested: false,
      blockedByPayment: true,
      podReview: null,
      exceptionResolved: false,
    };
    expect(keys(ready, PARTNER_SHIPMENT_ACTIONS)).toEqual([
      'shipment.dispatch!shipments.payment_pending',
      'shipment.request_carrier',
      'shipment.record_pod!shipments.payment_pending',
      'shipment.cancel',
    ]);
    expect(
      keys({ ...ready, status: 'delivered', podReview: 'pending' as const }, ADMIN_SHIPMENT_ACTIONS),
    ).toEqual(['shipment.review_pod']);
  });

  it('orders: the customer uploads, approves, confirms and claims; staff start, reprice and cancel', () => {
    const order: OrderFacts = {
      status: 'paid_for_production',
      artworkStatus: 'proof_sent',
      designOption: 'own_file',
      mockupOption: 'none',
      productionStartedAt: null,
      paidForProductionAt: new Date(),
      deliveredAt: null,
      completedAt: null,
      cancelledAt: null,
      claimWindowEndsAt: null,
      discountAmount: '0.00',
      lines: [{ lineType: 'product' }],
    };
    expect(keys(order, STORE_ORDER_ACTIONS)).toEqual(['order.upload_artwork', 'order.approve_proof']);
    expect(keys({ ...order, discountAmount: '10.00' }, ADMIN_ORDER_ACTIONS)).toEqual([
      'order.start_production',
      'order.submit_artwork',
      'order.add_mockup',
      'order.reprice!order.reprice_has_discounts',
      'order.cancel',
    ]);
    const delivered = {
      ...order,
      status: 'shipping',
      artworkStatus: 'approved',
      productionStartedAt: new Date(),
      deliveredAt: new Date(),
      claimWindowEndsAt: new Date(Date.now() - 1000),
    };
    expect(keys(delivered, STORE_ORDER_ACTIONS)).toEqual([
      'order.confirm_receipt',
      'order.open_claim!claims.window_closed',
      'order.reorder',
    ]);
  });

  it('statements, payout runs, jobs, documents and RFQs follow their endpoints’ checks', () => {
    expect(keys({ status: 'confirmed', invoiceStatuses: ['rejected'] }, PARTNER_STATEMENT_ACTIONS)).toEqual([
      'billing_statement.submit_tax_invoice',
    ]);
    expect(keys({ status: 'draft', items: [{ status: 'excluded' }] }, RUN_ACTIONS)).toEqual([
      'payout_run.propose!payouts.nothing_eligible',
      'payout_run.cancel',
    ]);
    expect(keys({ status: 'released', jobKind: 'production' }, PARTNER_JOB_ACTIONS)).toEqual([
      'job.accept',
      'job.reject',
      'job.raise_issue',
    ]);
    expect(keys({ status: 'on_hold', jobKind: 'production' }, ADMIN_JOB_ACTIONS)).toEqual(['job.resume']);
    const doc = {
      status: 'issued',
      docType: 'iv',
      receivableItem: { status: 'partially_paid', openAmount: '10.00', amount: '20.00' },
    };
    expect(keys(doc, ADMIN_DOCUMENT_ACTIONS)).toEqual([
      'customer_document.resend',
      'customer_document.void!receivables.document_settled',
    ]);
    const now = new Date();
    const rfq = {
      status: 'quoted',
      now,
      quotes: [{ status: 'sent', validUntil: new Date(now.getTime() + 60_000), lines: [1] }],
    };
    expect(keys(rfq, STORE_RFQ_ACTIONS)).toEqual(['rfq.accept', 'rfq.post_message', 'rfq.decline']);
    expect(
      keys({ ...rfq, quotes: [{ status: 'draft', validUntil: null, lines: [] }] }, ADMIN_RFQ_ACTIONS),
    ).toEqual(['rfq.assign', 'rfq.request_factory_cost', 'rfq.send_quote!rfq.quote_empty', 'rfq.decline']);
  });
});
