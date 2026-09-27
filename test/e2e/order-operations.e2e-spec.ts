import { systemActor } from '@common/context/actor';
import { OrdersService } from '@modules/orders/orders.service';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  as,
  bootCommerceApp,
  type CommerceApp,
  customerToken,
  foldingBackToRfq,
  foldingConfiguration,
  foldingReady,
  placeOrder,
  postcodes,
  seedShipping,
  staffToken,
} from '../support/commerce-e2e';

/** CS operations on orders and the admin work queues (B3.1 slice 6). */
describe('order operations (e2e, B3.1)', () => {
  let ctx: CommerceApp;
  let fixture: DevFolding;
  let postcode: string;
  let cs: string;
  let csLead: string;
  let orders: OrdersService;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    fixture = await foldingReady(ctx);
    postcode = postcodes(ctx, 1)[0]!;
    await seedShipping(ctx, fixture.factoryPublicId, [postcode]);
    cs = await staffToken(ctx, 'cs');
    csLead = await staffToken(ctx, 'cs-lead');
    orders = ctx.app.get(OrdersService);
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  const paid = (orderPublicId: string) =>
    ctx.prisma.withTx(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { publicId: orderPublicId } });
      await orders.applyFact(tx, order.id, { kind: 'paid_for_production' }, systemActor('e2e'));
    });

  it('edits & re-prices an order before production, keeping the previous pricing (D-051)', async () => {
    const { token } = await customerToken(ctx, 1);
    const me = await as(ctx, token).get('/v1/store/customer-profile').expect(200);
    const group = await placeOrder(ctx, token, fixture, postcode, [1000]);
    const orderId = group.orders[0]!.id;
    const quote = await as(ctx, cs)
      .post('/v1/admin/quotes', {
        productTypeCode: 'folding_carton',
        configuration: foldingConfiguration(fixture, [2000]),
        customerUserId: me.body.id,
      })
      .expect(201);
    const body = { quoteId: quote.body.id, quoteOptionId: quote.body.options[0].id, reason: 'ลูกค้าขอเพิ่มจำนวน' };
    const read = await as(ctx, csLead).get(`/v1/admin/orders/${orderId}`).expect(200);
    await as(ctx, cs).post(`/v1/admin/orders/${orderId}/actions/reprice`, body).expect(403);
    await as(ctx, csLead).post(`/v1/admin/orders/${orderId}/actions/reprice`, body).expect(428);
    const repriced = await as(ctx, csLead)
      .post(`/v1/admin/orders/${orderId}/actions/reprice`, body)
      .set('If-Match', read.headers['etag'] as string)
      .expect(200);
    expect(repriced.body).toMatchObject({ quantityOrdered: 2000, quoteId: quote.body.id });
    expect(repriced.body.destinations[0].quantity).toBe(2000);
    const revisions = await ctx.prisma.orderPriceRevision.findMany({ where: { order: { publicId: orderId } } });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]!.previousGross.toFixed(2)).toBe(group.orders[0]!.totals.grossAmount);
    const after = await as(ctx, cs).get(`/v1/admin/order-groups/${group.id}`).expect(200);
    expect(after.body.totals.grossAmount).toBe(repriced.body.totals.grossAmount);
    expect(await ctx.prisma.domainEvent.count({ where: { type: 'order.repriced', aggregateId: orderId } })).toBe(1);

    const other = await customerToken(ctx, 2);
    const foreign = await as(ctx, other.token)
      .post('/v1/store/quotes', { productTypeCode: 'folding_carton', configuration: foldingConfiguration(fixture, [3000]) })
      .expect(201);
    const etag = (await as(ctx, csLead).get(`/v1/admin/orders/${orderId}`).expect(200)).headers['etag'] as string;
    await as(ctx, csLead)
      .post(`/v1/admin/orders/${orderId}/actions/reprice`, {
        quoteId: foreign.body.id,
        quoteOptionId: foreign.body.options[0].id,
        reason: 'x',
      })
      .set('If-Match', etag)
      .expect(404);
  });

  it('moves an unpaid group to another customer, never a paid one', async () => {
    const { token } = await customerToken(ctx, 3);
    const group = await placeOrder(ctx, token, fixture, postcode);
    const target = await as(ctx, cs)
      .post('/v1/admin/customers', { phone: `08${String(ctx.run + 7).padStart(8, '0').slice(-8)}`, displayName: 'ลูกค้าใหม่' })
      .expect(201);
    const read = await as(ctx, cs).get(`/v1/admin/order-groups/${group.id}`).expect(200);
    const moved = await as(ctx, cs)
      .post(`/v1/admin/order-groups/${group.id}/actions/change-customer`, { customerId: target.body.customer.id })
      .set('If-Match', read.headers['etag'] as string)
      .expect(200);
    expect(moved.body.customerId).toBe(target.body.customer.id);
    await as(ctx, token).get(`/v1/store/order-groups/${group.id}`).expect(404);

    const second = await placeOrder(ctx, token, fixture, postcode);
    await paid(second.orders[0]!.id);
    const etag = (await as(ctx, cs).get(`/v1/admin/order-groups/${second.id}`).expect(200)).headers['etag'] as string;
    await as(ctx, cs)
      .post(`/v1/admin/order-groups/${second.id}/actions/change-customer`, { customerId: target.body.customer.id })
      .set('If-Match', etag)
      .expect(409);
  });

  it('keeps remarks, cc e-mails and internal notes', async () => {
    const { token } = await customerToken(ctx, 4);
    const group = await placeOrder(ctx, token, fixture, postcode);
    const read = await as(ctx, cs).get(`/v1/admin/order-groups/${group.id}`).expect(200);
    const updated = await as(ctx, cs)
      .patch(`/v1/admin/order-groups/${group.id}`, { csRemarks: 'ส่งด่วน', ccEmails: ['Buyer@Example.com'] })
      .set('If-Match', read.headers['etag'] as string)
      .expect(200);
    expect(updated.body).toMatchObject({ csRemarks: 'ส่งด่วน', ccEmails: ['buyer@example.com'] });
    const store = await as(ctx, token).get(`/v1/store/order-groups/${group.id}`).expect(200);
    expect(store.body.csRemarks).toBeUndefined();

    const orderId = group.orders[0]!.id;
    const me = await as(ctx, cs).get('/v1/admin/me').expect(200);
    await as(ctx, cs)
      .post(`/v1/admin/orders/${orderId}/notes`, { body: 'โทรยืนยันแล้ว', mentions: [me.body.id] })
      .expect(201);
    const customer = await as(ctx, token).get('/v1/store/customer-profile').expect(200);
    await as(ctx, cs)
      .post(`/v1/admin/orders/${orderId}/notes`, { body: 'x', mentions: [customer.body.id] })
      .expect(422);
    const notes = await as(ctx, cs).get(`/v1/admin/orders/${orderId}/notes`).expect(200);
    expect(notes.body.data).toHaveLength(1);
  });

  it('lists the work queues (รอชำระ, รอตรวจไฟล์, รอเริ่มผลิต, ใกล้ครบกำหนดส่ง, ล่าช้า)', async () => {
    const { token } = await customerToken(ctx, 5);
    const a = await placeOrder(ctx, token, fixture, postcode);
    const b = await placeOrder(ctx, token, fixture, postcode);
    const ids = (res: { body: { data: { orderId: string }[] } }) => res.body.data.map((i) => i.orderId);
    const queue = (name: string, extra = '') =>
      as(ctx, cs).get(`/v1/admin/order-queues/${name}?perPage=100${extra}`).expect(200);

    expect(ids(await queue('waiting_payment'))).toEqual(expect.arrayContaining([a.orders[0]!.id, b.orders[0]!.id]));
    await paid(b.orders[0]!.id);
    expect(ids(await queue('waiting_production'))).toContain(b.orders[0]!.id);
    expect(ids(await queue('waiting_payment'))).not.toContain(b.orders[0]!.id);

    await ctx.prisma.order.update({ where: { publicId: a.orders[0]!.id }, data: { artworkStatus: 'uploaded' } });
    expect(ids(await queue('artwork_review'))).toContain(a.orders[0]!.id);

    const today = new Date(`${new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)}T00:00:00Z`);
    await ctx.prisma.order.update({
      where: { publicId: a.orders[0]!.id },
      data: { promisedShipDate: new Date(today.getTime() + 86_400_000) },
    });
    await ctx.prisma.order.update({
      where: { publicId: b.orders[0]!.id },
      data: { promisedShipDate: new Date(today.getTime() - 86_400_000) },
    });
    expect(ids(await queue('due_soon', '&withinDays=2'))).toContain(a.orders[0]!.id);
    expect(ids(await queue('late'))).toContain(b.orders[0]!.id);
    expect(ids(await queue('late'))).not.toContain(a.orders[0]!.id);
    await as(ctx, cs).get('/v1/admin/order-queues/unknown').expect(422);
  });
});
