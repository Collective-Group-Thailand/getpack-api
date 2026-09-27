import { randomUUID } from 'node:crypto';

import { systemActor } from '@common/context/actor';
import { MoneyDecimal } from '@common/money/money';
import { OrdersService } from '@modules/orders/orders.service';
import { PaymentSchedulesService } from '@modules/payment-schedules/payment-schedules.service';
import { envelopeFromRow } from '@platform/domain-events/domain-event';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  addAddress,
  as,
  bootCommerceApp,
  type CommerceApp,
  customerToken,
  foldingBackToRfq,
  foldingReady,
  placeOrder,
  postcodes,
  saveQuote,
  seedShipping,
  staffToken,
} from '../support/commerce-e2e';

interface ScheduleBody {
  templateKey: string;
  productionGateOpen: boolean;
  shippingGateOpen: boolean;
  instalments: { seq: number; status: string; cashAmount: string; dueTrigger: string; requiredBefore: string; dueAt: string | null }[];
}

/** Payment schedules: choice at checkout, gates, due dates from facts, override, rebalance (B3.2 slice 2, D-020). */
describe('payment schedules (e2e, B3.2)', () => {
  let ctx: CommerceApp;
  let fixture: DevFolding;
  let postcode: string;
  let schedules: PaymentSchedulesService;
  let orders: OrdersService;
  let csLead: string;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    fixture = await foldingReady(ctx);
    postcode = postcodes(ctx, 1)[0]!;
    await seedShipping(ctx, fixture.factoryPublicId, [postcode]);
    schedules = ctx.app.get(PaymentSchedulesService);
    orders = ctx.app.get(OrdersService);
    csLead = await staffToken(ctx, 'cs-lead');
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  const groupRow = (publicId: string) => ctx.prisma.orderGroup.findUniqueOrThrow({ where: { publicId } });
  const pay = async (groupPublicId: string, cash: string) =>
    ctx.prisma.withTx(async (tx) => {
      const group = await tx.orderGroup.findUniqueOrThrow({ where: { publicId: groupPublicId } });
      const payment = await tx.payment.create({
        data: {
          entityId: group.entityId,
          orderGroupId: group.id,
          method: 'bank_transfer_slip',
          provider: 'slip',
          status: 'succeeded',
          referenceCode: `E2E${randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()}`,
          amount: cash,
          cashAmount: cash,
          paidAt: new Date(),
        },
      });
      return schedules.applyPayment(tx, group.id, payment.id, cash, systemActor('e2e'));
    });
  const fact = (orderPublicId: string, f: Parameters<OrdersService['applyFact']>[2]) =>
    ctx.prisma.withTx(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { publicId: orderPublicId } });
      await orders.applyFact(tx, order.id, f, systemActor('e2e'));
    });
  /** Runs the schedule subscribers on the events an order produced (the worker does this in production). */
  const deliver = async (types: string[], aggregateId: string) => {
    const events = await ctx.prisma.domainEvent.findMany({ where: { type: { in: types }, aggregateId }, orderBy: { occurredAt: 'asc' } });
    for (const e of events) {
      await ctx.prisma.withTx((tx) =>
        e.type === 'order.fact_recorded'
          ? schedules.onFact(envelopeFromRow(e), tx)
          : schedules.onOrderChanged(envelopeFromRow(e), tx),
      );
    }
  };

  it('gives a small order 100 % upfront and opens production only once paid (D-020, D-073)', async () => {
    const { token } = await customerToken(ctx, 1);
    const group = await placeOrder(ctx, token, fixture, postcode, [1000]);
    expect(new MoneyDecimal(group.totals.grossAmount).lt(20_000)).toBe(true);
    let schedule = (await as(ctx, token).get(`/v1/store/order-groups/${group.id}/payment-schedule`).expect(200))
      .body as ScheduleBody;
    expect(schedule).toMatchObject({ templateKey: 'full_upfront', productionGateOpen: false });
    expect(schedule.instalments).toEqual([
      expect.objectContaining({ seq: 1, status: 'due', cashAmount: group.totals.cashAmount, requiredBefore: 'production' }),
    ]);
    await pay(group.id, group.totals.cashAmount);
    schedule = (await as(ctx, token).get(`/v1/store/order-groups/${group.id}/payment-schedule`).expect(200)).body;
    expect(schedule.productionGateOpen).toBe(true);
    const read = await as(ctx, token).get(`/v1/store/order-groups/${group.id}`).expect(200);
    expect(read.body).toMatchObject({ status: 'in_progress', orders: [{ status: 'paid_for_production' }] });
  });

  it('splits a large order 50/50: deposit gates production, the balance becomes due at production and gates shipping', async () => {
    const { token } = await customerToken(ctx, 2);
    const address = await addAddress(ctx, token, postcode);
    const quote = await saveQuote(ctx, token, fixture, [5000]);
    await as(ctx, token)
      .post('/v1/store/cart/items', {
        quoteId: quote.id,
        quoteOptionId: quote.options[0]!.id,
        designOption: 'own_file',
        destinations: [{ addressId: address.id, quantity: 5000 }],
      })
      .expect(201);
    const preview = await as(ctx, token).post('/v1/store/checkout/actions/preview', {}).expect(200);
    expect(new MoneyDecimal(preview.body.totals.grossAmount).gte(20_000)).toBe(true);
    expect(preview.body.paymentSchedule.templateKey).toBe('deposit_50_before_shipping_50');
    const placed = await as(ctx, token).post('/v1/store/checkout', {}).set('Idempotency-Key', randomUUID()).expect(201);
    const orderId = placed.body.orders[0].id as string;

    let schedule = (await as(ctx, csLead).get(`/v1/admin/order-groups/${placed.body.id}/payment-schedule`).expect(200))
      .body as ScheduleBody & { instalments: { allocations: { orderId: string }[] }[] };
    const [deposit, balance] = schedule.instalments;
    expect(deposit).toMatchObject({ status: 'due', requiredBefore: 'production' });
    expect(balance).toMatchObject({ status: 'pending', requiredBefore: 'shipping', dueAt: null });
    expect(new MoneyDecimal(deposit!.cashAmount).add(balance!.cashAmount).toFixed(2)).toBe(placed.body.totals.cashAmount);
    expect(schedule.instalments[0]!.allocations[0]!.orderId).toBe(orderId);

    await pay(placed.body.id, deposit!.cashAmount);
    await fact(orderId, { kind: 'artwork_approved' });
    await fact(orderId, { kind: 'production_started', mode: 'auto' });
    await deliver(['order.fact_recorded'], orderId);
    schedule = (await as(ctx, csLead).get(`/v1/admin/order-groups/${placed.body.id}/payment-schedule`).expect(200)).body;
    expect(schedule).toMatchObject({ productionGateOpen: true, shippingGateOpen: false });
    expect(schedule.instalments[1]).toMatchObject({ status: 'due' });
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { publicId: orderId } });
    expect(await schedules.canShip(order.id)).toBe(false);
    await pay(placed.body.id, balance!.cashAmount);
    expect(await schedules.canShip(order.id)).toBe(true);
    expect(
      await ctx.prisma.domainEvent.count({ where: { type: 'instalment.paid', aggregateId: placed.body.id } }),
    ).toBe(2);
  });

  it('lets CS replace the schedule before any payment, with a reason (D-020)', async () => {
    const { token } = await customerToken(ctx, 3);
    const group = await placeOrder(ctx, token, fixture, postcode, [1000]);
    const url = `/v1/admin/order-groups/${group.id}/payment-schedule`;
    const cs = await staffToken(ctx, 'cs');
    const read = await as(ctx, csLead).get(url).expect(200);
    await as(ctx, cs)
      .post(`${url}/actions/override`, { templateKey: 'deposit_50_before_shipping_50', reason: 'x' })
      .expect(403);
    const replaced = await as(ctx, csLead)
      .post(`${url}/actions/override`, { templateKey: 'deposit_50_before_shipping_50', reason: 'ลูกค้าขอแบ่งจ่าย' })
      .set('If-Match', read.headers['etag'] as string)
      .expect(200);
    expect(replaced.body).toMatchObject({ templateKey: 'deposit_50_before_shipping_50', isOverride: true });
    expect((replaced.body.instalments as { status: string }[]).map((i) => i.status)).toEqual(['cancelled', 'due', 'pending']);
    await pay(group.id, (replaced.body.instalments as { cashAmount: string }[])[1]!.cashAmount);
    await as(ctx, csLead)
      .post(`${url}/actions/override`, { templateKey: 'full_upfront', reason: 'x' })
      .set('If-Match', replaced.headers['etag'] as string)
      .expect((res) => expect([409, 412]).toContain(res.status));
  });

  it('rebalances the unpaid part when an order of the group is cancelled (ADR-0008)', async () => {
    const { token } = await customerToken(ctx, 4);
    const group = await placeOrder(ctx, token, fixture, postcode, [1000, 2000]);
    const before = await groupRow(group.id);
    const cs = await staffToken(ctx, 'cs');
    await as(ctx, cs)
      .post(`/v1/admin/orders/${group.orders[0]!.id}/actions/cancel`, { reasonCode: 'cannot_produce' })
      .expect(200);
    await deliver(['order.cancelled'], group.orders[0]!.id);
    const schedule = (await as(ctx, cs).get(`/v1/admin/order-groups/${group.id}/payment-schedule`).expect(200))
      .body as ScheduleBody;
    const remaining = schedule.instalments.filter((i) => i.status !== 'cancelled');
    const total = remaining.reduce((a, i) => a.add(i.cashAmount), new MoneyDecimal(0));
    expect(total.toFixed(2)).toBe(group.orders[1]!.totals.grossAmount);
    expect(total.lt(before.cashAmount.toString())).toBe(true);
  });

  it('lists templates and lets a Superadmin add a version adding up to 100 % (D-063)', async () => {
    const superadmin = await staffToken(ctx, 'superadmin');
    const list = await as(ctx, csLead).get('/v1/admin/payment-schedule-templates').expect(200);
    expect((list.body as { key: string }[]).map((t) => t.key)).toEqual([
      'credit_term',
      'deposit_50_before_shipping_50',
      'full_upfront',
    ]);
    const body = {
      effectiveFrom: new Date(Date.now() + 86_400_000 * 365 * 5).toISOString(),
      selectionRule: { orderValue: { gte: { setting: 'payments.schedule_split_threshold' } } },
      priority: 100,
      instalments: [
        { labelTh: 'งวด 1', labelEn: 'First', pct: '30', dueTrigger: 'at_checkout', requiredBefore: 'production' },
        { labelTh: 'งวด 2', labelEn: 'Second', pct: '30', dueTrigger: 'before_shipping', requiredBefore: 'shipping' },
      ],
      reason: 'e2e (future version)',
    };
    await as(ctx, csLead).post('/v1/admin/payment-schedule-templates/deposit_50_before_shipping_50/versions', body).expect(403);
    await as(ctx, superadmin)
      .post('/v1/admin/payment-schedule-templates/deposit_50_before_shipping_50/versions', body)
      .expect(422);
    const ok = await as(ctx, superadmin)
      .post('/v1/admin/payment-schedule-templates/deposit_50_before_shipping_50/versions', {
        ...body,
        instalments: [
          ...body.instalments,
          { labelTh: 'งวด 3', labelEn: 'Third', pct: '40', dueTrigger: 'on_delivery', requiredBefore: 'none' },
        ],
      })
      .expect(201);
    // A future version does not replace the one in force.
    expect(ok.body.instalments).toHaveLength(2);
  });
});
