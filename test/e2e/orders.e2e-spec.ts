import { systemActor } from '@common/context/actor';
import { OrdersService } from '@modules/orders/orders.service';

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
  staffToken,
} from '../support/commerce-e2e';

/** Orders: reads, fact-driven status, cancellation, unpaid expiry (B3.1 slice 5, D-060, D-073). */
describe('orders (e2e, B3.1)', () => {
  let ctx: CommerceApp;
  let fixture: DevFolding;
  let postcode: string;
  let orders: OrdersService;
  let cs: string;
  let prepress: string;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    fixture = await foldingReady(ctx);
    postcode = postcodes(ctx, 1)[0]!;
    await seedShipping(ctx, fixture.factoryPublicId, [postcode]);
    orders = ctx.app.get(OrdersService);
    cs = await staffToken(ctx, 'cs');
    prepress = await staffToken(ctx, 'prepress');
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  const fact = (orderPublicId: string, f: Parameters<OrdersService['applyFact']>[2]) =>
    ctx.prisma.withTx(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { publicId: orderPublicId } });
      return orders.applyFact(tx, order.id, f, systemActor('e2e'));
    });

  it('lets the owner read groups and orders (by id and by code); others get 404', async () => {
    const { token } = await customerToken(ctx, 1);
    const group = await placeOrder(ctx, token, fixture, postcode);
    const list = await as(ctx, token).get('/v1/store/order-groups').expect(200);
    expect((list.body.data as { id: string }[]).map((g) => g.id)).toContain(group.id);
    const got = await as(ctx, token).get(`/v1/store/order-groups/${group.id}`).expect(200);
    expect(got.headers['etag']).toBeDefined();
    const order = group.orders[0]!;
    await as(ctx, token).get(`/v1/store/orders/${order.id}`).expect(200);
    const byCode = await as(ctx, token).get(`/v1/store/orders/by-code/${order.orderCode}`).expect(200);
    expect(byCode.body.id).toBe(order.id);

    const other = await customerToken(ctx, 2);
    await as(ctx, other.token).get(`/v1/store/order-groups/${group.id}`).expect(404);
    await as(ctx, other.token).get(`/v1/store/orders/by-code/${order.orderCode}`).expect(404);

    const staff = await as(ctx, prepress).get(`/v1/admin/order-groups/${group.id}`).expect(200);
    expect(staff.body.orders[0].internal).toMatchObject({ buyCostNet: null, marginPct: null });
    const pm = await staffToken(ctx, 'partner-manager');
    await as(ctx, pm).get(`/v1/admin/order-groups/${group.id}`).expect(403);
    const found = await as(ctx, cs).get(`/v1/admin/order-groups?q=${order.orderCode}`).expect(200);
    expect((found.body.data as { id: string }[]).map((g) => g.id)).toEqual([group.id]);
  });

  it('moves the status only through facts, refusing missing prerequisites (D-073)', async () => {
    const { token } = await customerToken(ctx, 3);
    const group = await placeOrder(ctx, token, fixture, postcode);
    const orderId = group.orders[0]!.id;

    await expect(fact(orderId, { kind: 'production_started', mode: 'auto' })).rejects.toMatchObject({
      code: 'order.invalid_transition',
    });
    expect(await fact(orderId, { kind: 'paid_for_production' })).toBe(true);
    expect(await fact(orderId, { kind: 'paid_for_production' })).toBe(false);
    let read = await as(ctx, token).get(`/v1/store/order-groups/${group.id}`).expect(200);
    expect(read.body).toMatchObject({ status: 'in_progress', expiresAt: null });
    expect(read.body.orders[0].status).toBe('paid_for_production');

    await expect(fact(orderId, { kind: 'production_started', mode: 'auto' })).rejects.toMatchObject({
      code: 'order.invalid_transition',
    });
    await fact(orderId, { kind: 'artwork_approved' });
    await fact(orderId, { kind: 'production_started', mode: 'auto' });
    read = await as(ctx, token).get(`/v1/store/orders/${orderId}`).expect(200);
    expect(read.body).toMatchObject({ status: 'in_production', artworkStatus: 'approved' });

    await as(ctx, token)
      .post(`/v1/store/order-groups/${group.id}/actions/cancel`, { reasonCode: 'customer_request' })
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('order.cancel_not_allowed'));
    await as(ctx, cs)
      .post(`/v1/admin/order-groups/${group.id}/actions/cancel`, { reasonCode: 'duplicate_order' })
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('order.invalid_transition'));
    const events = await ctx.prisma.domainEvent.findMany({
      where: { type: 'order.status_changed', aggregateId: orderId },
      orderBy: { occurredAt: 'asc' },
    });
    expect(events.map((e) => (e.payload as { to: string }).to)).toEqual([
      'paid_for_production',
      'artwork_approved',
      'in_production',
    ]);
  });

  it('cancels with a reason: the customer an unpaid group, staff one order at a time', async () => {
    const { token } = await customerToken(ctx, 4);
    const unpaid = await placeOrder(ctx, token, fixture, postcode);
    await as(ctx, token)
      .post(`/v1/store/order-groups/${unpaid.id}/actions/cancel`, { reasonCode: 'duplicate_order' })
      .expect(422);
    const cancelled = await as(ctx, token)
      .post(`/v1/store/order-groups/${unpaid.id}/actions/cancel`, { reasonCode: 'customer_request', note: 'เปลี่ยนแบบ' })
      .expect(200);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', orders: [{ status: 'cancelled' }] });
    await as(ctx, token)
      .post(`/v1/store/order-groups/${unpaid.id}/actions/cancel`, { reasonCode: 'customer_request' })
      .expect(409);

    const two = await placeOrder(ctx, token, fixture, postcode, [1000, 2000]);
    await as(ctx, prepress)
      .post(`/v1/admin/orders/${two.orders[0]!.id}/actions/cancel`, { reasonCode: 'cannot_produce' })
      .expect(403);
    const one = await as(ctx, cs)
      .post(`/v1/admin/orders/${two.orders[0]!.id}/actions/cancel`, { reasonCode: 'cannot_produce' })
      .expect(200);
    expect(one.body.status).toBe('cancelled');
    let group = await as(ctx, cs).get(`/v1/admin/order-groups/${two.id}`).expect(200);
    expect(group.body.status).toBe('waiting_payment');
    await as(ctx, cs)
      .post(`/v1/admin/orders/${two.orders[1]!.id}/actions/cancel`, { reasonCode: 'cannot_produce' })
      .expect(200);
    group = await as(ctx, cs).get(`/v1/admin/order-groups/${two.id}`).expect(200);
    expect(group.body).toMatchObject({ status: 'cancelled', expiresAt: null });
  });

  it('cancels unpaid groups past their expiry every run of the job (D-060)', async () => {
    const { token } = await customerToken(ctx, 5);
    const group = await placeOrder(ctx, token, fixture, postcode);
    const paidToo = await placeOrder(ctx, token, fixture, postcode);
    await fact(paidToo.orders[0]!.id, { kind: 'paid_for_production' });
    const past = new Date(Date.now() - 60_000);
    await ctx.prisma.orderGroup.updateMany({
      where: { publicId: { in: [group.id, paidToo.id] } },
      data: { expiresAt: past },
    });
    expect(await orders.expireUnpaid()).toBeGreaterThanOrEqual(1);
    const row = await ctx.prisma.orderGroup.findUniqueOrThrow({
      where: { publicId: group.id },
      include: { cancelReason: true, orders: true },
    });
    expect(row).toMatchObject({ status: 'cancelled', cancelReason: { code: 'payment_expired' } });
    expect(row.orders.every((o) => o.status === 'cancelled')).toBe(true);
    expect(await ctx.prisma.domainEvent.count({ where: { type: 'order_group.expired', aggregateId: group.id } })).toBe(1);
    const paid = await ctx.prisma.orderGroup.findUniqueOrThrow({ where: { publicId: paidToo.id } });
    expect(paid.status).toBe('in_progress');
  });
});
