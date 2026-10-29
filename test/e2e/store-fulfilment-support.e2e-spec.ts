import { randomUUID } from 'node:crypto';

import { REDIS } from '@database/redis.module';
import { type Redis } from 'ioredis';
import request from 'supertest';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  activeCompany,
  as,
  customerToken,
  foldingBackToRfq,
  foldingReady,
  placeOrder,
  postcodes,
  seedShipping,
  setFlag,
  staffToken,
} from '../support/commerce-e2e';
import {
  approveArtwork,
  bootFulfilmentApp,
  factoryToken,
  type FulfilmentApp,
  payDue,
  uploadBytes,
} from '../support/fulfilment-e2e';

const DAY = 86_400_000;

/**
 * U-B0.1 slice 10: per-step promised dates and the delivery estimate on tracking, the claim form, the reorder
 * preview with its token, and the support contact form / guided-help hand-off opening CS tickets (D-221).
 */
describe('store fulfilment & support gaps (e2e, U-B0.1)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let code: string;
  let owner: string;

  beforeAll(async () => {
    process.env['SUPPORT_THROTTLE_LIMIT'] = '1000';
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    [code] = postcodes(ctx, 1) as [string];
    await seedShipping(ctx, fixture.factoryPublicId, [code]);
    await setFlag(ctx, 'payments.scb', true);
    owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 61);
  });

  afterAll(async () => {
    delete process.env['SUPPORT_THROTTLE_LIMIT'];
    await setFlag(ctx, 'payments.scb', false);
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  const post = (token: string, path: string, body: Record<string, unknown> = {}) =>
    as(ctx, token).post(path, body).set('Idempotency-Key', randomUUID());
  const photo = (token: string) =>
    uploadBytes(ctx, token, Buffer.from(`photo ${randomUUID()}`), {
      purpose: 'evidence',
      fileName: 'photo.png',
      mimeType: 'image/png',
      surface: 'partner',
    });

  /** A paid order in production; `deliver` ships and delivers it (as the claims e2e). */
  async function paidOrder(n: number, known?: { token: string }, body: Record<string, unknown> = {}) {
    const { token } = known ?? (await customerToken(ctx, n));
    const prepress = await staffToken(ctx, 'prepress');
    const group = await placeOrder(ctx, token, fixture, code, [1000], body);
    const orderId = group.orders[0]!.id;
    await payDue(ctx, token, group.id);
    await approveArtwork(ctx, token, prepress, orderId);
    await ctx.pump();
    const job = await ctx.prisma.productionJob.findFirstOrThrow({ where: { order: { publicId: orderId } } });
    await post(owner, `/v1/partner/production-jobs/${job.publicId}/actions/accept`).expect(200);
    return { token, orderId, job };
  }

  async function deliver(o: Awaited<ReturnType<typeof paidOrder>>) {
    const at = new Date();
    await ctx.prisma.jobMilestone.updateMany({
      where: { jobId: o.job.id },
      data: { status: 'completed', startedAt: at, completedAt: at },
    });
    await ctx.prisma.productionJob.update({
      where: { id: o.job.id },
      data: {
        status: 'completed',
        actualFinishAt: at,
        quantityGood: 1000,
        quantityScrap: 0,
        inspectionRequired: false,
      },
    });
    const detail = await as(ctx, owner).get(`/v1/partner/production-jobs/${o.job.publicId}`).expect(200);
    const destinationId = (detail.body.destinations as { id: string }[])[0]!.id;
    const shipment = await post(owner, '/v1/partner/shipments', {
      items: [{ jobId: o.job.publicId, destinationId, quantity: 1000 }],
      cartonsCount: 1,
      weightG: 9000,
    }).expect(201);
    await post(owner, `/v1/partner/shipments/${shipment.body.id as string}/actions/ready`).expect(200);
    await post(owner, `/v1/partner/shipments/${shipment.body.id as string}/proof-of-delivery`, {
      receiverName: 'ผู้รับ ทดสอบ',
      signatureFileId: await photo(owner),
      photoFileIds: [await photo(owner)],
      items: [{ destinationId, deliveredQuantity: 1000 }],
    }).expect(201);
    await ctx.pump();
    return shipment.body.id as string;
  }

  it('shows per-step promised dates and the delivery estimate; opens the claim form after delivery', async () => {
    const o = await paidOrder(1);
    const due = new Date('2026-12-01T11:00:00Z');
    const milestone = await ctx.prisma.jobMilestone.findFirstOrThrow({
      where: { jobId: o.job.id, customerVisible: true },
      orderBy: { seq: 'asc' },
    });
    await ctx.prisma.jobMilestone.update({ where: { id: milestone.id }, data: { dueAt: due } });
    // The quotation's own delivery estimate, moved as far as the promised ship date moved from its ship date.
    const order = await ctx.prisma.order.findUniqueOrThrow({
      where: { publicId: o.orderId },
      include: { quoteOption: true },
    });
    const delivery = (order.quoteOption.result as { earliestDeliveryDate?: string | null })
      .earliestDeliveryDate;
    const shift =
      order.promisedShipDate!.getTime() -
      (order.quoteOption.earliestShipDate ?? order.promisedShipDate!).getTime();
    const expected = delivery
      ? new Date(Date.parse(`${delivery}T00:00:00Z`) + shift).toISOString().slice(0, 10)
      : null;

    const progress = (await as(ctx, o.token).get(`/v1/store/orders/${o.orderId}/progress`).expect(200)).body;
    expect(progress.estimatedDeliveryDate).toBe(expected);
    expect(progress.steps).toContainEqual(
      expect.objectContaining({ key: milestone.stepKey, promisedAt: '2026-12-01T18:00:00+07:00' }),
    );
    expect(
      (await as(ctx, o.token).get(`/v1/store/orders/${o.orderId}`).expect(200)).body.estimatedDeliveryDate,
    ).toBe(expected);
    const link = await post(o.token, `/v1/store/orders/${o.orderId}/tracking-links`).expect(201);
    const tracked = (
      await request(ctx.server)
        .get(`/v1/store/track/${link.body.token as string}`)
        .expect(200)
    ).body;
    expect(tracked).toMatchObject({ estimatedDeliveryDate: expected });
    expect(tracked).not.toHaveProperty('orderCode');

    const before = (await as(ctx, o.token).get(`/v1/store/orders/${o.orderId}/claim-form`).expect(200)).body;
    expect(before).toMatchObject({
      open: false,
      closedReason: 'not_delivered',
      shipments: [],
      windowEndsAt: null,
    });
    const { token: stranger } = await customerToken(ctx, 2);
    await as(ctx, stranger).get(`/v1/store/orders/${o.orderId}/claim-form`).expect(404);

    const shipmentId = await deliver(o);
    const form = (await as(ctx, o.token).get(`/v1/store/orders/${o.orderId}/claim-form`).expect(200)).body;
    expect(form).toMatchObject({
      open: true,
      closedReason: null,
      quantityOrdered: 1000,
      types: expect.arrayContaining(['damaged', 'quantity_short']),
      resolutions: expect.arrayContaining(['reprint']),
      evidence: { purpose: 'evidence', productPhotosMin: 1, cartonPhotosMin: 1, productPhotosMax: 10 },
    });
    expect(form.shipments).toEqual([
      expect.objectContaining({ id: shipmentId, quantity: 1000, deliveredQuantity: 1000, open: true }),
    ]);
    expect(Date.parse(form.windowEndsAt) - Date.parse(form.deliveredAt)).toBe(7 * DAY);

    const past = new Date(Date.now() - 8 * DAY);
    await ctx.prisma.order.update({ where: { publicId: o.orderId }, data: { deliveredAt: past } });
    await ctx.prisma.shipment.update({ where: { publicId: shipmentId }, data: { deliveredAt: past } });
    const closed = (await as(ctx, o.token).get(`/v1/store/orders/${o.orderId}/claim-form`).expect(200)).body;
    expect(closed).toMatchObject({ open: false, closedReason: 'window_closed' });
    expect(closed.shipments[0].open).toBe(false);
  });

  it('previews a reorder at today’s price and refuses a changed price with the preview token (D-153)', async () => {
    const o = await paidOrder(3);
    await as(ctx, o.token).get(`/v1/store/orders/${o.orderId}/reorder`).expect(409);
    await deliver(o);
    const preview = (await as(ctx, o.token).get(`/v1/store/orders/${o.orderId}/reorder`).expect(200)).body;
    expect(preview).toMatchObject({
      orderId: o.orderId,
      quantity: 1000,
      previousQuantity: 1000,
      proofSkipped: true,
      currency: 'THB',
      grossAmount: expect.stringMatching(/^\d+\.\d{2}$/),
      previewToken: expect.any(String),
    });
    const bigger = (
      await as(ctx, o.token)
        .get(`/v1/store/orders/${o.orderId}/reorder?quantity=2000&reuseArtwork=false`)
        .expect(200)
    ).body;
    expect(bigger).toMatchObject({ quantity: 2000, proofSkipped: false });

    // A token for another quantity or artwork choice does not fit.
    expect(
      (
        await post(o.token, `/v1/store/orders/${o.orderId}/actions/reorder`, {
          quantity: 1000,
          previewToken: bigger.previewToken,
        }).expect(409)
      ).body.code,
    ).toBe('orders.reorder_preview_expired');

    // Today's price differs from what the preview showed.
    const redis = ctx.app.get<Redis>(REDIS);
    const keys = await redis.keys('reorder:preview:*');
    for (const key of keys) {
      const bound = JSON.parse((await redis.get(key))!) as { grossAmount: string; quantity: number };
      if (bound.quantity === 1000)
        await redis.set(key, JSON.stringify({ ...bound, grossAmount: '1.00' }), 'EX', 600);
    }
    const repriced = await post(o.token, `/v1/store/orders/${o.orderId}/actions/reorder`, {
      previewToken: preview.previewToken,
    }).expect(409);
    expect(repriced.body.code).toBe('orders.reorder_repriced');

    const fresh = (await as(ctx, o.token).get(`/v1/store/orders/${o.orderId}/reorder`).expect(200)).body;
    const cart = await post(o.token, `/v1/store/orders/${o.orderId}/actions/reorder`, {
      previewToken: fresh.previewToken,
    }).expect(201);
    expect(cart.body.items).toContainEqual(
      expect.objectContaining({ reorderOf: expect.objectContaining({ orderId: o.orderId }) }),
    );
  });

  it('reorders several company orders from a sheet with a preview (D-153)', async () => {
    const admin = await customerToken(ctx, 5);
    const accountant = await customerToken(ctx, 6);
    const companyId = await activeCompany(ctx, admin.token, 5, [
      { ...accountant, roles: ['company_accountant'] },
    ]);
    const o = await paidOrder(5, admin, { companyId });
    await deliver(o);
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { publicId: o.orderId } });
    const rows = [
      { line: 2, orderCode: order.orderCode, quantity: 2000 },
      { line: 3, orderCode: 'PK-NOPE-0001-01' },
    ];
    await post(accountant.token, `/v1/store/companies/${companyId}/bulk-reorders/actions/preview`, {
      rows,
    }).expect(403);
    const preview = (
      await post(admin.token, `/v1/store/companies/${companyId}/bulk-reorders/actions/preview`, {
        rows,
      }).expect(200)
    ).body;
    expect(preview).toMatchObject({ okCount: 1, refusedCount: 1, previewToken: expect.any(String) });
    expect(preview.rows).toEqual([
      expect.objectContaining({
        line: 2,
        status: 'ok',
        orderId: o.orderId,
        quantity: 2000,
        proofSkipped: true,
      }),
      expect.objectContaining({ line: 3, status: 'refused', reason: 'orders.not_found' }),
    ]);
    expect(preview.grossAmount).toBe(preview.rows[0].grossAmount);
    expect(
      (
        await post(admin.token, `/v1/store/companies/${companyId}/bulk-reorders`, {
          previewToken: 'nope',
        }).expect(409)
      ).body.code,
    ).toBe('orders.reorder_preview_expired');
    const added = (
      await post(admin.token, `/v1/store/companies/${companyId}/bulk-reorders`, {
        previewToken: preview.previewToken,
      }).expect(201)
    ).body;
    expect(added).toMatchObject({
      added: [expect.objectContaining({ line: 2, cartItemId: expect.any(String) })],
      failed: [],
    });
    const cart = (await as(ctx, admin.token).get('/v1/store/cart').expect(200)).body;
    expect(cart.items).toContainEqual(
      expect.objectContaining({
        id: added.added[0].cartItemId,
        reorderOf: expect.objectContaining({ orderId: o.orderId }),
      }),
    );
  });

  it('opens CS tickets from the contact form and the hand-off, for guests and customers (D-221)', async () => {
    const pub = () => request(ctx.server);
    const cs = await staffToken(ctx, 'cs');
    const missing = await pub()
      .post('/v1/store/support/actions/contact')
      .set('Idempotency-Key', randomUUID())
      .send({ topic: 'order_status', message: 'สอบถามค่ะ', contact: { name: 'ลูกค้า ทดสอบ' } })
      .expect(422);
    expect(missing.body.code).toBe('support.contact_required');

    const guest = await pub()
      .post('/v1/store/support/actions/contact')
      .set('Idempotency-Key', randomUUID())
      .send({
        topic: 'order_status',
        orderCode: 'PK-FAKE-0001',
        message: 'สอบถามกำหนดส่งค่ะ',
        contact: { name: 'ลูกค้า ทดสอบ', phone: '0000000000' },
      })
      .expect(201);
    expect(guest.body).toMatchObject({
      ticketNo: expect.stringMatching(/^DEVCS-/),
      source: 'contact_form',
      conversationId: null,
      lineUrl: null,
    });
    expect(Date.parse(guest.body.respondBy)).toBeGreaterThan(Date.now());
    const ticket = await ctx.prisma.supportTicket.findUniqueOrThrow({
      where: { ticketNo: guest.body.ticketNo as string },
      include: { conversation: true },
    });
    expect(ticket).toMatchObject({
      customerUserId: null,
      contactPhone: '0000000000',
      orderRef: 'PK-FAKE-0001',
    });
    const event = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: { type: 'support.ticket_opened', aggregateId: ticket.conversation.publicId },
    });
    expect(JSON.stringify(event.payload)).not.toContain('0000000000');

    const inbox = (
      await as(ctx, cs).get(`/v1/admin/conversations/${ticket.conversation.publicId}`).expect(200)
    ).body;
    expect(inbox.ticket).toMatchObject({
      ticketNo: guest.body.ticketNo,
      contactName: 'ลูกค้า ทดสอบ',
      contactPhone: '0000000000',
      overdue: false,
      firstRespondedAt: null,
    });
    expect(inbox.lastMessage).toBe('สอบถามกำหนดส่งค่ะ');
    await post(cs, `/v1/admin/conversations/${ticket.conversation.publicId}/messages`, {
      body: 'โทรกลับแล้วค่ะ',
    }).expect(201);
    expect(
      (await ctx.prisma.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } })).firstRespondedAt,
    ).not.toBeNull();

    // A signed-in customer's ticket opens on their own chat; the hand-off carries the guided-help context.
    const { token } = await customerToken(ctx, 4);
    const mine = await post(token, '/v1/store/support/actions/handoff', {
      page: '/guided-help',
      answers: { use: 'food' },
      recommended: ['dev-tuck-end-box'],
      callback: true,
    }).expect(201);
    expect(mine.body).toMatchObject({ source: 'handoff', conversationId: expect.any(String) });
    const chat = await as(ctx, token).get('/v1/store/conversation').expect(200);
    expect(chat.body.id).toBe(mine.body.conversationId);
    const handoff = await ctx.prisma.supportTicket.findUniqueOrThrow({
      where: { ticketNo: mine.body.ticketNo as string },
    });
    expect(handoff).toMatchObject({
      topic: 'guided_help',
      callbackRequested: true,
      context: { page: '/guided-help', answers: { use: 'food' }, recommended: ['dev-tuck-end-box'] },
    });
  });

  it('routes contact tickets by topic, stores the intent details and lets the sender follow them (D-458)', async () => {
    const pub = () => request(ctx.server);
    const cs = await staffToken(ctx, 'cs');
    const lead = await pub()
      .post('/v1/store/support/actions/contact')
      .set('Idempotency-Key', randomUUID())
      .send({
        topic: 'business',
        message: 'สนใจเปิดบัญชีบริษัทค่ะ',
        contact: { name: 'ลูกค้า ทดสอบ', email: 'buyer@example.test' },
        details: {
          company: 'บริษัท ทดสอบ จำกัด',
          monthlyVolume: '1000_5000',
          interests: ['credit'],
          product: '',
        },
        replyChannel: 'email',
      })
      .expect(201);
    const stored = await ctx.prisma.supportTicket.findUniqueOrThrow({
      where: { ticketNo: lead.body.ticketNo as string },
      include: { conversation: true },
    });
    expect(stored).toMatchObject({
      queue: 'sales',
      callbackRequested: false,
      context: {
        details: { company: 'บริษัท ทดสอบ จำกัด', monthlyVolume: '1000_5000', interests: ['credit'] },
        replyChannel: 'email',
      },
    });
    const sales = await as(ctx, cs).get('/v1/admin/conversations?queue=sales').expect(200);
    const salesIds = (sales.body as { data: { id: string }[] }).data.map((c) => c.id);
    expect(salesIds).toContain(stored.conversation.publicId);

    // No call-back windows are set: a call back is refused.
    const options = await pub().get('/v1/store/support/contact-options').expect(200);
    expect(options.body).toMatchObject({ replyBusinessDays: expect.any(Number), callback: null });
    const refused = await pub()
      .post('/v1/store/support/actions/contact')
      .set('Idempotency-Key', randomUUID())
      .send({
        topic: 'payment',
        message: 'โทรกลับด้วยค่ะ',
        contact: { name: 'ลูกค้า ทดสอบ', phone: '0812345678' },
        replyChannel: 'callback',
        callback: { date: '2099-01-01', slot: 'morning' },
      })
      .expect(422);
    expect(refused.body.code).toBe('support.callback_unavailable');

    // The sender reads the stage with the e-mail they left; anyone else gets "not found".
    const lookup = (contact: Record<string, string>) =>
      pub().post('/v1/store/support/actions/lookup').send({ ticketNo: lead.body.ticketNo, contact });
    const status = await lookup({ name: '-', email: 'BUYER@example.test' }).expect(200);
    expect(status.body).toMatchObject({ ticketNo: lead.body.ticketNo, topic: 'business', stage: 'received' });
    expect((await lookup({ name: '-', email: 'other@example.test' }).expect(404)).body.code).toBe(
      'support.ticket_not_found',
    );
    const added = await pub()
      .post('/v1/store/support/actions/add-info')
      .set('Idempotency-Key', randomUUID())
      .send({
        ticketNo: lead.body.ticketNo,
        contact: { name: '-', email: 'buyer@example.test' },
        message: 'มี 4 สาขาค่ะ',
      })
      .expect(200);
    expect(added.body.stage).toBe('received');
    const inbox = (
      await as(ctx, cs).get(`/v1/admin/conversations/${stored.conversation.publicId}`).expect(200)
    ).body;
    expect(inbox.lastMessage).toBe('มี 4 สาขาค่ะ');
    expect(inbox.ticket).toMatchObject({ queue: 'sales' });
  });

  it('rate-limits the public support forms', async () => {
    process.env['SUPPORT_THROTTLE_LIMIT'] = '1';
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++)
      statuses.push(
        (
          await request(ctx.server)
            .post('/v1/store/support/actions/handoff')
            .set('Idempotency-Key', randomUUID())
            .send({ page: '/x', contact: { name: 'ลูกค้า ทดสอบ', email: 'someone@example.test' } })
        ).status,
      );
    expect(statuses).toContain(429);
    process.env['SUPPORT_THROTTLE_LIMIT'] = '1000';
  });
});
