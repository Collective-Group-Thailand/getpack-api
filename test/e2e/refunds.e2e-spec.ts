import { randomUUID } from 'node:crypto';

import {
  type FakeScbGateway,
  type FakeTwoC2PGateway,
  SCB_GATEWAY,
  TWOC2P_GATEWAY,
} from '@collective/integrations/payments/gateways';
import { RefundsService } from '@modules/payments/refunds.service';
import { envelopeFromRow } from '@platform/domain-events/domain-event';
import request from 'supertest';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  as,
  bootCommerceApp,
  type CommerceApp,
  customerToken,
  foldingBackToRfq,
  foldingReady,
  placeOrder,
  postcodes,
  seedShipping,
  setFlag,
  staffToken,
} from '../support/commerce-e2e';

/** Refunds: request, Finance Manager approval, bank transfer or gateway execution (B3.2 slice 5, D-169). */
describe('refunds (e2e, B3.2)', () => {
  let ctx: CommerceApp;
  let fixture: DevFolding;
  let postcode: string;
  let refunds: RefundsService;
  let csLead: string;
  let cs: string;
  let financeManager: string;
  let finance: string;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    fixture = await foldingReady(ctx);
    postcode = postcodes(ctx, 1)[0]!;
    await seedShipping(ctx, fixture.factoryPublicId, [postcode]);
    await setFlag(ctx, 'payments.scb', true);
    await setFlag(ctx, 'payments.twoc2p', true);
    refunds = ctx.app.get(RefundsService);
    csLead = await staffToken(ctx, 'cs-lead');
    cs = await staffToken(ctx, 'cs');
    financeManager = await staffToken(ctx, 'finance-manager');
    finance = await staffToken(ctx, 'finance');
  });

  afterAll(async () => {
    await setFlag(ctx, 'payments.scb', false);
    await setFlag(ctx, 'payments.twoc2p', false);
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  /** A group fully paid by SCB QR. */
  async function paidGroup(n: number, method: 'scb_qr' | 'card_2c2p' = 'scb_qr') {
    const { token } = await customerToken(ctx, n);
    const group = await placeOrder(ctx, token, fixture, postcode);
    const payment = (
      await as(ctx, token)
        .post(`/v1/store/order-groups/${group.id}/payments`, { method })
        .set('Idempotency-Key', randomUUID())
        .expect(201)
    ).body as { id: string; referenceCode: string; cashAmount: string };
    if (method === 'scb_qr') {
      const scb = ctx.app.get<FakeScbGateway>(SCB_GATEWAY);
      await request(ctx.server)
        .post('/webhooks/scb/payment-confirmation')
        .send(scb.settle(payment.referenceCode, payment.cashAmount))
        .expect(200);
    } else {
      const gw = ctx.app.get<FakeTwoC2PGateway>(TWOC2P_GATEWAY);
      await request(ctx.server)
        .post('/webhooks/2c2p/payment')
        .send(await gw.notification(payment.referenceCode))
        .expect(204);
    }
    return { token, group, payment };
  }

  const decide = async (approvalId: string) => {
    await as(ctx, financeManager)
      .post(`/v1/admin/approvals/${approvalId}/actions/approve`, { comment: 'ok' })
      .expect(200);
    const event = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: { type: 'approval.approved', aggregateId: approvalId },
    });
    await ctx.prisma.withTx((tx) => refunds.onApprovalOutcome(envelopeFromRow(event), tx));
  };

  it('refunds only money the schedule no longer needs', async () => {
    const { payment } = await paidGroup(1);
    await as(ctx, csLead)
      .post(`/v1/admin/payments/${payment.id}/refunds`, { amount: payment.cashAmount, reasonNote: 'x' })
      .set('Idempotency-Key', randomUUID())
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('refunds.not_refundable'));
    await as(ctx, cs)
      .post(`/v1/admin/payments/${payment.id}/refunds`, { amount: '1.00', reasonNote: 'x' })
      .set('Idempotency-Key', randomUUID())
      .expect(403);
  });

  it('refunds a cancelled paid group by bank transfer after Finance Manager approval (maker-checker)', async () => {
    const { group, payment } = await paidGroup(2);
    const cancelled = await as(ctx, cs)
      .post(`/v1/admin/order-groups/${group.id}/actions/cancel`, { reasonCode: 'customer_changed_mind' })
      .expect(200);
    expect(cancelled.body.status).toBe('cancelled');
    const event = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: { type: 'order_group.cancelled', aggregateId: group.id },
    });
    expect(event.payload).toMatchObject({ refundRequired: true, paidAmount: payment.cashAmount });

    await as(ctx, csLead)
      .post(`/v1/admin/payments/${payment.id}/refunds`, { amount: '999999.00', reasonNote: 'x' })
      .set('Idempotency-Key', randomUUID())
      .expect(409);
    const requested = await as(ctx, csLead)
      .post(`/v1/admin/payments/${payment.id}/refunds`, {
        amount: payment.cashAmount,
        reasonNote: 'ลูกค้ายกเลิกหลังชำระเงิน',
        cancelReasonCode: 'customer_changed_mind',
      })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    expect(requested.body).toMatchObject({ status: 'pending_approval', channel: 'bank_transfer' });
    await as(ctx, csLead)
      .post(`/v1/admin/approvals/${requested.body.approvalRequestId}/actions/approve`, { comment: 'self' })
      .expect((res) => expect([403, 409]).toContain(res.status));
    await decide(requested.body.approvalRequestId as string);
    const approved = await as(ctx, finance).get(`/v1/admin/refunds/${requested.body.id}`).expect(200);
    expect(approved.body.status).toBe('approved');

    const done = await as(ctx, finance)
      .post(`/v1/admin/refunds/${requested.body.id}/actions/complete`, { providerRef: 'TRF-E2E-0001' })
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    expect(done.body).toMatchObject({ status: 'succeeded', providerRef: 'TRF-E2E-0001' });
    const paymentRow = await ctx.prisma.payment.findUniqueOrThrow({ where: { publicId: payment.id } });
    expect(paymentRow.status).toBe('refunded');
    expect(
      await ctx.prisma.domainEvent.count({
        where: { type: 'refund.succeeded', aggregateId: requested.body.id },
      }),
    ).toBe(1);
  });

  it('sends an approved 2C2P refund through the gateway', async () => {
    const { group, payment } = await paidGroup(3, 'card_2c2p');
    await as(ctx, cs)
      .post(`/v1/admin/order-groups/${group.id}/actions/cancel`, { reasonCode: 'customer_changed_mind' })
      .expect(200);
    const requested = await as(ctx, csLead)
      .post(`/v1/admin/payments/${payment.id}/refunds`, { amount: payment.cashAmount, reasonNote: 'ยกเลิก' })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    expect(requested.body.channel).toBe('original_gateway');
    await decide(requested.body.approvalRequestId as string);
    await refunds.executeApproved();
    const read = await as(ctx, finance).get(`/v1/admin/refunds/${requested.body.id}`).expect(200);
    expect(read.body).toMatchObject({ status: 'succeeded', providerRef: `RF${payment.referenceCode}` });
    expect(ctx.app.get<FakeTwoC2PGateway>(TWOC2P_GATEWAY).refunds).toContainEqual({
      reference: payment.referenceCode,
      amount: payment.cashAmount,
    });
  });
});
