import { randomUUID } from 'node:crypto';

import { RealtimePublisher } from '@platform/realtime/realtime.publisher';
import request from 'supertest';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
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

interface Entry {
  id: string;
  type: string;
  params: Record<string, unknown>;
  photoFileIds: string[];
  shipment: { shipmentNo: string; carrier: string } | null;
  source?: string;
  body?: string | null;
  mentions?: { id: string; displayName: string }[];
}

/**
 * Timelines, promised vs actual, public tracking and the realtime fan-out (B4.4, D-050, D-143): the
 * customer's chronological story with shared photos and shipment steps and nothing of the factory; the
 * staff timeline with factory steps and @mentioned notes; anonymous tracking without personal data.
 */
describe('order timeline, public tracking and realtime (e2e, B4.4)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let code: string;
  let owner: string;
  let operator: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    [code] = postcodes(ctx, 1) as [string];
    await seedShipping(ctx, fixture.factoryPublicId, [code]);
    await setFlag(ctx, 'payments.scb', true);
    owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 41);
    operator = await factoryToken(ctx, fixture.factoryPublicId, 'factory_operator', 42);
  });

  afterAll(async () => {
    delete process.env['TRACKING_THROTTLE_LIMIT'];
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

  async function all(token: string, path: string): Promise<Entry[]> {
    const out: Entry[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 50; i++) {
      const res = await as(ctx, token)
        .get(`${path}?limit=3${cursor ? `&cursor=${cursor}` : ''}`)
        .expect(200);
      out.push(...(res.body.data as Entry[]));
      cursor = res.body.meta.nextCursor as string | null;
      if (!cursor) return out;
    }
    throw new Error('timeline did not end');
  }

  it('tells the customer the story without the factory, staff everything, and tracks anonymously', async () => {
    const publish = jest.spyOn(ctx.app.get(RealtimePublisher), 'publish');
    const { token } = await customerToken(ctx, 1);
    const prepress = await staffToken(ctx, 'prepress');
    const group = await placeOrder(ctx, token, fixture, code);
    const orderId = group.orders[0]!.id;
    await payDue(ctx, token, group.id);
    await approveArtwork(ctx, token, prepress, orderId);
    await ctx.pump();
    const job = await ctx.prisma.productionJob.findFirstOrThrow({
      where: { order: { publicId: orderId } },
      include: { milestones: true },
    });
    await post(owner, `/v1/partner/production-jobs/${job.publicId}/actions/accept`).expect(200);
    const milestone = (key: string) => job.milestones.find((m) => m.stepKey === key)!.publicId;
    const step = (key: string, body: Record<string, unknown>) =>
      post(operator, `/v1/partner/production-jobs/${job.publicId}/milestones/${milestone(key)}`, {
        clientRef: randomUUID(),
        ...body,
      }).expect(200);
    await step('job_received', { action: 'start' });
    await step('job_received', { action: 'complete' });
    for (const key of ['prepress_ready', 'materials_ready']) {
      await step(key, { action: 'start' });
      await step(key, { action: 'complete' });
    }
    const shared = await photo(operator);
    const internal = await photo(operator);
    await step('printing', { action: 'start', quantityIn: 1000 });
    await step('printing', {
      action: 'complete',
      quantityOut: 1000,
      quantityScrap: 0,
      photoFileIds: [shared],
      shareWithCustomer: true,
    });
    await step('finishing', { action: 'start' });
    await step('finishing', {
      action: 'complete',
      quantityOut: 1000,
      quantityScrap: 0,
      photoFileIds: [internal],
    });

    // Production itself is covered by B4.2: finish the job, then ship it with a POD.
    const at = new Date();
    await ctx.prisma.jobMilestone.updateMany({
      where: { jobId: job.id, status: { not: 'completed' } },
      data: { status: 'completed', startedAt: at, completedAt: at },
    });
    await ctx.prisma.productionJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        actualFinishAt: at,
        quantityGood: 1000,
        quantityScrap: 0,
        inspectionRequired: false,
      },
    });
    const detail = await as(ctx, owner).get(`/v1/partner/production-jobs/${job.publicId}`).expect(200);
    const destinationId = (detail.body.destinations as { id: string }[])[0]!.id;
    const shipment = await post(owner, '/v1/partner/shipments', {
      items: [{ jobId: job.publicId, destinationId, quantity: 1000 }],
      cartonsCount: 1,
      weightG: 9000,
    }).expect(201);
    const shipmentId = shipment.body.id as string;
    await post(owner, `/v1/partner/shipments/${shipmentId}/actions/ready`).expect(200);
    await post(owner, `/v1/partner/shipments/${shipmentId}/actions/dispatch`).expect(200);
    await post(owner, `/v1/partner/shipments/${shipmentId}/events`, {
      status: 'in_transit',
      location: 'บางนา',
    }).expect(200);
    const podPhoto = await photo(owner);
    await post(owner, `/v1/partner/shipments/${shipmentId}/proof-of-delivery`, {
      receiverName: 'ผู้รับ ทดสอบ',
      signatureFileId: await photo(owner),
      photoFileIds: [podPhoto],
      items: [{ destinationId, deliveredQuantity: 1000 }],
    }).expect(201);

    const cs = await staffToken(ctx, 'cs');
    const logistics = await ctx.prisma.user.findFirstOrThrow({
      where: { email: 'logistics@example.invalid' },
    });
    await as(ctx, cs)
      .post(`/v1/admin/orders/${orderId}/notes`, {
        body: 'ลูกค้าขอส่งช่วงเช้า @logistics',
        mentions: [logistics.publicId],
      })
      .expect(201);
    await ctx.pump();

    // --- customer: chronological, cursor-paged, no factory ---
    const mine = await all(token, `/v1/store/orders/${orderId}/timeline`);
    const types = mine.map((e) => e.type);
    expect(new Set(mine.map((e) => e.id)).size).toBe(mine.length);
    const order = (t: string) => types.indexOf(t);
    expect(order('production.queued')).toBeGreaterThan(-1);
    expect(order('production.milestone_reached')).toBeGreaterThan(order('production.queued'));
    expect(order('shipment.picked_up')).toBeGreaterThan(order('production.milestone_reached'));
    expect(order('shipment.delivered')).toBeGreaterThan(order('shipment.picked_up'));
    expect(types).not.toContain('shipment.draft');
    expect(types).not.toContain('order.note_added');
    const printing = mine.find(
      (e) => e.type === 'production.milestone_reached' && e.params['stepKey'] === 'printing',
    )!;
    expect(printing.photoFileIds).toEqual([shared]);
    const delivered = mine.find((e) => e.type === 'shipment.delivered')!;
    expect(delivered).toMatchObject({ photoFileIds: [podPhoto], shipment: { carrier: 'packio' } });
    const factory = await ctx.prisma.factory.findUniqueOrThrow({
      where: { publicId: fixture.factoryPublicId },
    });
    const text = JSON.stringify(mine);
    for (const secret of [factory.publicId, factory.code, factory.legalName, internal])
      expect(text).not.toContain(secret);
    await as(ctx, token).get(`/v1/store/orders/${orderId}/timeline?cursor=not-a-cursor`).expect(422);

    // Shared photos are readable by that customer only; unshared ones by nobody outside Packio and the factory.
    await as(ctx, token).get(`/v1/store/files/${shared}/download`).expect(200);
    await as(ctx, token).get(`/v1/store/files/${internal}/download`).expect(404);
    const { token: stranger } = await customerToken(ctx, 2);
    await as(ctx, stranger).get(`/v1/store/files/${shared}/download`).expect(404);
    await as(ctx, stranger).get(`/v1/store/orders/${orderId}/timeline`).expect(404);

    // Promised vs actual.
    const progress = await as(ctx, token).get(`/v1/store/orders/${orderId}/progress`).expect(200);
    expect(progress.body).toMatchObject({ orderId, status: 'shipping' });
    expect(progress.body.deliveredAt).toEqual(expect.any(String));
    expect(
      (progress.body.steps as { key: string; status: string }[]).find((s) => s.key === 'printing'),
    ).toMatchObject({
      status: 'completed',
    });

    // --- staff: everything, notes with @mentions ---
    const staffView = await all(cs, `/v1/admin/orders/${orderId}/timeline`);
    expect(staffView.some((e) => e.source === 'production_job' && e.type === 'production_job.accepted')).toBe(
      true,
    );
    expect(staffView.some((e) => e.source === 'shipment' && e.type === 'shipment.draft')).toBe(true);
    const note = staffView.find((e) => e.source === 'note')!;
    expect(note).toMatchObject({
      body: 'ลูกค้าขอส่งช่วงเช้า @logistics',
      mentions: [{ id: logistics.publicId }],
    });
    expect(
      staffView.find((e) => e.type === 'production.milestone_reached' && e.params['stepKey'] === 'printing')!
        .photoFileIds,
    ).toEqual([shared]);
    await as(ctx, token).get(`/v1/admin/orders/${orderId}/timeline`).expect(403);

    // --- realtime fan-out: customer, factory and the mentioned staff member ---
    const customer = await ctx.prisma.order.findUniqueOrThrow({
      where: { publicId: orderId },
      include: { customer: true },
    });
    const calls = publish.mock.calls.map(([channel, signal]) => `${channel} ${signal.type}`);
    expect(calls).toContain(`user:${customer.customer.publicId} order.updated`);
    expect(calls).toContain(`factory:${fixture.factoryPublicId} production_job.updated`);
    expect(calls).toContain(`factory:${fixture.factoryPublicId} shipment.updated`);
    expect(calls).toContain(`user:${logistics.publicId} order.note_mentioned`);
    expect(
      calls
        .filter((c) => c.startsWith(`user:${customer.customer.publicId}`))
        .every((c) => !c.includes('note')),
    ).toBe(true);

    // --- public tracking: anonymous, no personal data, rate-limited ---
    const link = await post(token, `/v1/store/orders/${orderId}/tracking-links`).expect(201);
    const tokenValue = link.body.token as string;
    expect(link.body.url).toContain(`/track/${tokenValue}`);
    const tracked = await request(ctx.server).get(`/v1/store/track/${tokenValue}`).expect(200);
    expect(tracked.body).toMatchObject({ status: 'shipping' });
    expect(tracked.body.shipments[0]).toMatchObject({ carrier: 'packio', status: 'delivered' });
    const publicText = JSON.stringify(tracked.body);
    for (const pii of ['ผู้รับ ทดสอบ', '+6681', 'ถนนทดสอบ', 'บางนา', podPhoto, factory.code])
      expect(publicText).not.toContain(pii);
    expect(
      (
        await ctx.prisma.trackingLink.findFirstOrThrow({
          where: { order: { publicId: orderId }, shipmentId: null },
        })
      ).views,
    ).toBe(1);
    await request(ctx.server).get('/v1/store/track/unknown-token-000000000000').expect(404);
    await ctx.prisma.trackingLink.updateMany({
      where: { shipment: { publicId: shipmentId } },
      data: { revokedAt: new Date() },
    });

    process.env['TRACKING_THROTTLE_LIMIT'] = '2';
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++)
      statuses.push((await request(ctx.server).get(`/v1/store/track/${tokenValue}`)).status);
    expect(statuses).toContain(429);
    publish.mockRestore();
  });
});
