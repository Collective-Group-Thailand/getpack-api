import { randomUUID } from 'node:crypto';

import { systemActor } from '@common/context/actor';
import { type FakeScbGateway, type FakeTwoC2PGateway } from '@integrations/payments/fake-payment-gateways';
import { SCB_GATEWAY, TWOC2P_GATEWAY } from '@integrations/payments/payment-gateways.port';
import { OrdersService } from '@modules/orders/orders.service';
import { PaymentSchedulesService } from '@modules/payment-schedules/payment-schedules.service';
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
  setSetting,
  staffToken,
  uploadSlipFile,
} from '../support/commerce-e2e';

interface PaymentBody {
  id: string;
  referenceCode: string;
  status: string;
  cashAmount: string;
  qrPayload: string | null;
  redirectUrl: string | null;
  slips: { id: string; status: string; slaDueAt: string | null; lastCheck: string | null }[];
}

/** Payments: SCB QR, 2C2P, slips, Finance queue, unidentified receipts (B3.2 slice 4, D-061, D-176). */
describe('payments (e2e, B3.2)', () => {
  let ctx: CommerceApp;
  let fixture: DevFolding;
  let postcode: string;
  let scb: FakeScbGateway;
  let twoc2p: FakeTwoC2PGateway;
  let finance: string;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    fixture = await foldingReady(ctx);
    postcode = postcodes(ctx, 1)[0]!;
    await seedShipping(ctx, fixture.factoryPublicId, [postcode]);
    scb = ctx.app.get(SCB_GATEWAY);
    twoc2p = ctx.app.get(TWOC2P_GATEWAY);
    finance = await staffToken(ctx, 'finance');
    await setSetting(ctx, 'payments.slip_receiver_accounts', [
      { accountType: '01014', accountNumber: '1234567890' },
    ]);
  });

  afterAll(async () => {
    for (const flag of ['payments.scb', 'payments.twoc2p', 'payments.slip_verify'])
      await setFlag(ctx, flag, false);
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  const initiate = (token: string, groupId: string, method: string) =>
    as(ctx, token)
      .post(`/v1/store/order-groups/${groupId}/payments`, { method })
      .set('Idempotency-Key', randomUUID());
  const webhook = (path: string, body: object) => request(ctx.server).post(`/webhooks/${path}`).send(body);

  it('refuses a method whose provider is off (D-176)', async () => {
    await setFlag(ctx, 'payments.scb', false);
    const { token } = await customerToken(ctx, 1);
    const group = await placeOrder(ctx, token, fixture, postcode);
    await initiate(token, group.id, 'scb_qr')
      .expect(422)
      .expect((res) => expect(res.body.code).toBe('payments.method_unavailable'));
    await initiate(token, group.id, 'card_instalment_2c2p').expect(422);
  });

  it('takes a deposit by SCB QR confirmed by inquiry, never twice, and opens production with the artwork (D-061, D-073)', async () => {
    await setFlag(ctx, 'payments.scb', true);
    const { token } = await customerToken(ctx, 2);
    const group = await placeOrder(ctx, token, fixture, postcode, [5000]);
    const started = await initiate(token, group.id, 'scb_qr').expect(201);
    const payment = started.body as PaymentBody;
    expect(payment).toMatchObject({
      status: 'pending',
      qrPayload: expect.stringContaining(payment.referenceCode),
    });
    const schedule = await as(ctx, token)
      .get(`/v1/store/order-groups/${group.id}/payment-schedule`)
      .expect(200);
    expect(payment.cashAmount).toBe(schedule.body.instalments[0].cashAmount);

    const forged = await webhook('scb/payment-confirmation', {
      transactionId: 'f'.repeat(32),
      amount: payment.cashAmount,
      billPaymentRef1: payment.referenceCode,
    }).expect(200);
    expect(forged.body.resCode).toBe('00');
    expect((await as(ctx, token).get(`/v1/store/payments/${payment.id}`).expect(200)).body.status).toBe(
      'pending',
    );

    const callback = scb.settle(payment.referenceCode, payment.cashAmount);
    const ack = await webhook('scb/payment-confirmation', callback).expect(200);
    expect(ack.body).toEqual({ resCode: '00', resDesc: 'success', transactionId: callback['transactionId'] });
    await webhook('scb/payment-confirmation', callback).expect(200);

    const paid = await as(ctx, token).get(`/v1/store/payments/${payment.id}`).expect(200);
    expect(paid.body.status).toBe('succeeded');
    const after = await as(ctx, token).get(`/v1/store/order-groups/${group.id}/payment-schedule`).expect(200);
    expect(after.body).toMatchObject({ productionGateOpen: true, shippingGateOpen: false });
    expect(after.body.instalments[0].status).toBe('paid');
    expect(
      await ctx.prisma.domainEvent.count({ where: { type: 'payment.received', aggregateId: payment.id } }),
    ).toBe(1);

    // Artwork approved + the deposit → production may start (D-073).
    const orders = ctx.app.get(OrdersService);
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { publicId: group.orders[0]!.id } });
    await ctx.prisma.withTx((tx) =>
      orders.applyFact(tx, order.id, { kind: 'artwork_approved' }, systemActor('e2e')),
    );
    expect(await ctx.app.get(PaymentSchedulesService).canStartProduction(order.id)).toBe(true);
    const read = await as(ctx, token).get(`/v1/store/orders/${order.publicId}`).expect(200);
    expect(read.body.status).toBe('artwork_approved');
  });

  it('accepts 2C2P only on a notification signed with the merchant secret', async () => {
    await setFlag(ctx, 'payments.twoc2p', true);
    const { token } = await customerToken(ctx, 3);
    const group = await placeOrder(ctx, token, fixture, postcode);
    const started = (await initiate(token, group.id, 'card_2c2p').expect(201)).body as PaymentBody;
    expect(started.redirectUrl).toContain(started.referenceCode);
    await webhook('2c2p/payment', { payload: 'not-a-jwt' }).expect(401);
    await webhook('2c2p/payment', await twoc2p.notification(started.referenceCode, '0000')).expect(204);
    const paid = await as(ctx, token).get(`/v1/store/payments/${started.id}`).expect(200);
    expect(paid.body.status).toBe('succeeded');
    const readGroup = await as(ctx, token).get(`/v1/store/order-groups/${group.id}`).expect(200);
    expect(readGroup.body.status).toBe('in_progress');
  });

  it('verifies slips: a pass is accepted, the same transfer is refused, a mismatch goes to Finance (D-061)', async () => {
    await setFlag(ctx, 'payments.slip_verify', true);
    const { token } = await customerToken(ctx, 4);
    const transRef = `TR${ctx.run}A`;

    const first = await placeOrder(ctx, token, fixture, postcode);
    const p1 = (await initiate(token, first.id, 'bank_transfer_slip').expect(201)).body as PaymentBody;
    let today = new Date().toISOString();
    const file1 = await uploadSlipFile(
      ctx,
      token,
      `FAKESLIP;transRef=${transRef};amount=${p1.cashAmount};date=${today};receiver=ok`,
    );
    const sent = await as(ctx, token)
      .post(`/v1/store/payments/${p1.id}/slips`, {
        fileId: file1,
        declaredAmount: p1.cashAmount,
        transferredAt: today,
      })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    expect(sent.body).toMatchObject({
      status: 'succeeded',
      slips: [{ status: 'passed', lastCheck: 'pass' }],
    });

    const second = await placeOrder(ctx, token, fixture, postcode);
    const p2 = (await initiate(token, second.id, 'bank_transfer_slip').expect(201)).body as PaymentBody;
    today = new Date().toISOString();
    const file2 = await uploadSlipFile(
      ctx,
      token,
      `FAKESLIP;transRef=${transRef};amount=${p2.cashAmount};date=${today};receiver=ok`,
    );
    const dup = await as(ctx, token)
      .post(`/v1/store/payments/${p2.id}/slips`, {
        fileId: file2,
        declaredAmount: p2.cashAmount,
        transferredAt: today,
      })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    expect(dup.body).toMatchObject({
      status: 'pending',
      slips: [{ status: 'failed', lastCheck: 'duplicate' }],
    });

    const file3 = await uploadSlipFile(
      ctx,
      token,
      `FAKESLIP;transRef=${transRef}B;amount=1.00;date=${today};receiver=ok`,
    );
    const review = await as(ctx, token)
      .post(`/v1/store/payments/${p2.id}/slips`, {
        fileId: file3,
        declaredAmount: p2.cashAmount,
        transferredAt: today,
      })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    const slip = (review.body as PaymentBody).slips[0]!;
    expect(review.body.status).toBe('awaiting_verification');
    expect(slip).toMatchObject({ status: 'manual_review', lastCheck: 'mismatch' });
    expect(slip.slaDueAt).not.toBeNull();

    const queue = await as(ctx, finance).get('/v1/admin/slips?perPage=100').expect(200);
    expect((queue.body.data as { id: string }[]).map((s) => s.id)).toContain(slip.id);
    await as(ctx, finance)
      .post(`/v1/admin/slips/${slip.id}/actions/review`, { approve: true, bankTransRef: transRef })
      .set('Idempotency-Key', randomUUID())
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('payments.slip_duplicate'));
    const approved = await as(ctx, finance)
      .post(`/v1/admin/slips/${slip.id}/actions/review`, {
        approve: true,
        bankTransRef: `${transRef}B`,
        note: 'ตรวจ statement แล้ว',
      })
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    expect(approved.body.status).toBe('succeeded');
  });

  it('keeps an unpaid group alive while its slip waits for Finance (D-060 / D-061)', async () => {
    await setFlag(ctx, 'payments.slip_verify', false);
    const { token } = await customerToken(ctx, 5);
    const group = await placeOrder(ctx, token, fixture, postcode);
    const cs = await staffToken(ctx, 'cs');
    await as(ctx, finance)
      .post(`/v1/admin/order-groups/${group.id}/payments`, { method: 'bank_transfer_slip' })
      .set('Idempotency-Key', randomUUID())
      .expect(403);
    const started = (
      await as(ctx, cs)
        .post(`/v1/admin/order-groups/${group.id}/payments`, { method: 'bank_transfer_slip' })
        .set('Idempotency-Key', randomUUID())
        .expect(201)
    ).body as PaymentBody;
    const now = new Date().toISOString();
    const fileId = await uploadSlipFile(
      ctx,
      cs,
      `FAKESLIP;transRef=TR${ctx.run}C;amount=${started.cashAmount};date=${now}`,
      'admin',
    );
    const sent = await as(ctx, cs)
      .post(`/v1/admin/payments/${started.id}/slips`, {
        fileId,
        declaredAmount: started.cashAmount,
        transferredAt: now,
      })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    expect(sent.body.slips[0].status).toBe('manual_review');

    await ctx.prisma.orderGroup.update({
      where: { publicId: group.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await ctx.app.get(OrdersService).expireUnpaid();
    expect((await ctx.prisma.orderGroup.findUniqueOrThrow({ where: { publicId: group.id } })).status).toBe(
      'waiting_payment',
    );

    const csLead = await staffToken(ctx, 'cs-lead');
    await as(ctx, csLead).get('/v1/admin/slips').expect(403);
  });

  it('parks an SCB receipt that matches no payment and lets Finance attach it (unidentified receipts)', async () => {
    await setFlag(ctx, 'payments.scb', true);
    const { token } = await customerToken(ctx, 6);
    const group = await placeOrder(ctx, token, fixture, postcode);
    const callback = scb.settle(`PKUNKNOWN${ctx.run}`.slice(0, 16), group.totals.cashAmount);
    await webhook('scb/payment-confirmation', callback).expect(200);
    const list = await as(ctx, finance).get('/v1/admin/payments?unidentified=true&perPage=100').expect(200);
    const receipt = (list.body.data as { id: string; providerRef: string }[]).find(
      (p) => p.providerRef === callback['transactionId'],
    )!;
    expect(receipt).toBeDefined();
    const allocated = await as(ctx, finance)
      .post(`/v1/admin/payments/${receipt.id}/actions/allocate`, { groupId: group.id })
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    expect(allocated.body.groupId).toBe(group.id);
    const read = await as(ctx, token).get(`/v1/store/order-groups/${group.id}`).expect(200);
    expect(read.body.status).toBe('in_progress');
  });
});
