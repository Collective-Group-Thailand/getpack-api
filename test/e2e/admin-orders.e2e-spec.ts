import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  as,
  bootCommerceApp,
  type CommerceApp,
  customerToken,
  devGeo,
  foldingBackToRfq,
  foldingReady,
  placeOrder,
  postcodes,
  seedShipping,
  staffToken,
} from '../support/commerce-e2e';

/**
 * U-B0.2 slice 1: the staff order list with filters, customer / placer refs on the group, cancel reasons, note
 * mentions, payments by group, manual payment reminders (D-060, D-061, D-143).
 */
describe('admin orders (e2e, U-B0.2)', () => {
  let ctx: CommerceApp;
  let fixture: DevFolding;
  let postcode: string;
  let cs: string;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    fixture = await foldingReady(ctx);
    postcode = postcodes(ctx, 1)[0]!;
    await seedShipping(ctx, fixture.factoryPublicId, [postcode]);
    cs = await staffToken(ctx, 'cs');
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  it('lists orders with filters and refs, and shows who the group is for', async () => {
    const { token } = await customerToken(ctx, 1);
    const placed = await placeOrder(ctx, token, fixture, postcode);
    const order = placed.orders[0]!;
    const group = await as(ctx, cs).get(`/v1/admin/order-groups/${placed.id}`).expect(200);
    const customerId = group.body.customerId as string;
    expect(group.body).toMatchObject({
      customer: { id: customerId, displayName: expect.any(String), companyName: null },
      placedBy: { id: customerId },
      hasSlipToReview: false,
    });

    const listed = await as(ctx, cs).get(`/v1/admin/orders?customerId=${customerId}`).expect(200);
    expect(listed.body.meta.total).toBe(1);
    expect(listed.body.data[0]).toMatchObject({
      orderId: order.id,
      orderCode: order.orderCode,
      groupId: placed.id,
      channel: 'web',
      quantity: 1000,
      customer: { id: customerId },
      hasSlipToReview: false,
      nextInstalment: expect.objectContaining({ seq: 1, openAmount: expect.any(String) }),
    });
    expect(JSON.stringify(listed.body)).not.toMatch(/buyCost|margin/i);
    const byCode = await as(ctx, cs).get(`/v1/admin/orders?q=${order.orderCode.slice(0, -1)}`).expect(200);
    expect((byCode.body.data as { orderId: string }[]).map((o) => o.orderId)).toContain(order.id);
    expect((await as(ctx, cs).get(`/v1/admin/orders?customerId=${customerId}&status=completed`).expect(200)).body.meta.total).toBe(0);
    await as(ctx, cs).get('/v1/admin/orders?placedFrom=nope').expect(422);

    const payments = await as(ctx, cs).get(`/v1/admin/payments?groupId=${placed.id}`).expect(200);
    expect(payments.body.meta.total).toBe(0);
    const { token: customer2 } = await customerToken(ctx, 2);
    await as(ctx, customer2).get('/v1/admin/orders').expect((r) => expect([401, 403]).toContain(r.status));
  });

  it('lists the cancel reasons and keeps note mentions', async () => {
    const reasons = (await as(ctx, cs).get('/v1/admin/order-cancel-reasons?appliesTo=staff').expect(200)).body as {
      appliesTo: string;
    }[];
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.every((r) => r.appliesTo === 'staff')).toBe(true);

    const { token } = await customerToken(ctx, 3);
    const placed = await placeOrder(ctx, token, fixture, postcode);
    const orderId = placed.orders[0]!.id;
    const prepress = await ctx.prisma.user.findFirstOrThrow({ where: { kind: 'staff' } });
    const note = await as(ctx, cs)
      .post(`/v1/admin/orders/${orderId}/notes`, { body: 'ฝากตรวจไฟล์ (fake)', mentions: [prepress.publicId] })
      .expect(201);
    expect(note.body.mentions).toEqual([{ id: prepress.publicId, displayName: prepress.displayName }]);
    const notes = await as(ctx, cs).get(`/v1/admin/orders/${orderId}/notes`).expect(200);
    expect(notes.body.data[0].mentions).toEqual([{ id: prepress.publicId, displayName: prepress.displayName }]);
  });

  it('reminds the customer of the instalment due, at most once an hour (D-143)', async () => {
    const { token } = await customerToken(ctx, 4);
    const placed = await placeOrder(ctx, token, fixture, postcode);
    const orderId = placed.orders[0]!.id;
    await ctx.prisma.instalment.updateMany({
      where: { schedule: { orderGroup: { publicId: placed.id } }, seq: 1 },
      data: { status: 'due' },
    });
    await as(ctx, cs).post(`/v1/admin/orders/${orderId}/actions/send-payment-reminder`).set('Idempotency-Key', randomUUID()).expect(204);
    expect(
      (await as(ctx, cs).post(`/v1/admin/orders/${orderId}/actions/send-payment-reminder`).set('Idempotency-Key', randomUUID()).expect(409))
        .body.code,
    ).toBe('payments.reminder_recent');
    const event = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: { type: 'instalment.reminder', aggregateId: placed.id },
    });
    expect(event.payload).toMatchObject({ seq: 1, groupCode: placed.groupCode, orderId });

    const other = await placeOrder(ctx, (await customerToken(ctx, 5)).token, fixture, postcode);
    const bulk = await as(ctx, cs)
      .post('/v1/admin/orders/actions/send-payment-reminders', { orderIds: [orderId, other.orders[0]!.id, randomUUID()] })
      .expect(200);
    expect(bulk.body.sent + bulk.body.skipped.length).toBe(3);
    expect(bulk.body.skipped).toEqual(
      expect.arrayContaining([
        { orderId, reason: 'payments.reminder_recent' },
        expect.objectContaining({ reason: 'http.not_found' }),
      ]),
    );
  });

  it('shows staff the customer’s orders and company, filters customers, and looks postcodes up with ids', async () => {
    const { token } = await customerToken(ctx, 6);
    const placed = await placeOrder(ctx, token, fixture, postcode);
    const group = await as(ctx, cs).get(`/v1/admin/order-groups/${placed.id}`).expect(200);
    const customerId = group.body.customerId as string;
    const one = (await as(ctx, cs).get(`/v1/admin/customers/${customerId}`).expect(200)).body;
    expect(one).toMatchObject({ ordersCount: 1, lastOrderAt: expect.any(String), companyName: null });
    const self = (await as(ctx, cs).get('/v1/admin/customers?createdVia=self&perPage=100').expect(200)).body.data as {
      id: string;
      createdVia: string;
    }[];
    expect(self.every((c) => c.createdVia === 'self')).toBe(true);
    expect((await as(ctx, cs).get('/v1/admin/customers?createdVia=cs&perPage=100').expect(200)).body.data).not.toContainEqual(
      expect.objectContaining({ id: customerId }),
    );
    await as(ctx, cs).get('/v1/admin/customers?customerType=nope').expect(422);

    const geo = await devGeo(ctx.prisma);
    const areas = (await request(ctx.server).get(`/v1/store/catalog/geo/postcodes/${geo.postcode}`).expect(200)).body as {
      province: { id: string };
      subdistrict: { id: string };
    }[];
    expect(areas[0]).toMatchObject({ province: { id: geo.provinceId }, subdistrict: { id: geo.subdistrictId } });
    await as(ctx, cs)
      .post(`/v1/admin/customers/${customerId}/addresses`, {
        kind: 'delivery',
        label: 'ปลายทาง',
        recipientName: 'ผู้รับ ทดสอบ',
        phone: '0810001234',
        line1: '1 ถนนทดสอบ',
        postcode: geo.postcode,
        provinceId: areas[0]!.province.id,
        subdistrictId: areas[0]!.subdistrict.id,
      })
      .expect(201);
  });
});
