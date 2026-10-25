import { randomUUID } from 'node:crypto';

import { bangkokDate } from '@common/time/bangkok';
import { CARRIER_ADAPTERS, type CarrierAdapters } from '@integrations/carriers/carrier-adapter.port';
import { type FakeCarrierAdapter } from '@integrations/carriers/fake-carrier.adapter';
import { type FakePdfRenderer } from '@integrations/pdf/fake-pdf-renderer';
import { PDF_RENDERER } from '@integrations/pdf/pdf-renderer.port';
import { DeliveryService } from '@modules/logistics/delivery.service';
import { ProductionOversightService } from '@modules/production/production-oversight.service';
import request from 'supertest';

import { SETTINGS } from '../../prisma/seed/data/settings';
import { type DevFolding } from '../../prisma/seed/dev-folding';
import { DEV_ENTITY } from '../../prisma/seed/dev-seed';
import {
  addAddress,
  as,
  customerToken,
  foldingBackToRfq,
  foldingReady,
  postcodes,
  saveQuote,
  seedShipping,
  setFlag,
  setSetting,
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

interface Shipment {
  id: string;
  status: string;
  carrier: string;
  labelFileId: string | null;
  packingListFileId: string | null;
  items: { destinationId: string; quantity: number; deliveredQuantity: number | null }[];
  events: { status: string; source: string }[];
  proofOfDelivery: { photoFileIds: string[]; deliveredQuantity: number } | null;
}

const SAMPLING = SETTINGS.find((s) => s.key === 'qc.inspection_sampling')!.value as Record<string, unknown>;
const THRESHOLD = SETTINGS.find((s) => s.key === 'payments.schedule_split_threshold')!.value;
const DAY = 86_400_000;

/**
 * Logistics (B4.3, D-013, D-021, D-080, D-081, D-114, D-142, D-165): shipments from completed jobs split over
 * trips and destinations, labels and packing lists, the shipping gate (instalments before shipping, getpack
 * inspection), POD, tolerance reconciliation, completion 7 days after delivery or on the customer's
 * confirmation, fallback carriers with their callbacks, and factory scoping (IDOR).
 */
describe('logistics: shipments, POD, tolerance and completion (e2e, B4.3)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let codes: [string, string];
  let owner: string;
  let shipper: string;
  let stranger: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    codes = postcodes(ctx, 2) as [string, string];
    await seedShipping(ctx, fixture.factoryPublicId, codes);
    await setFlag(ctx, 'payments.scb', true);
    owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 31);
    shipper = await factoryToken(ctx, fixture.factoryPublicId, 'factory_shipping', 32);
    const taxId = `08${String(ctx.run).padStart(11, '0').slice(-11)}`;
    const vendor = await ctx.prisma.vendor.create({
      data: { kind: 'factory', legalName: `[E2E] โรงงานอื่น ${ctx.run}`, juristicType: 'company', taxId },
    });
    const other = await ctx.prisma.factory.create({
      data: {
        code: `L${ctx.run}`,
        vendorId: vendor.id,
        legalName: vendor.legalName,
        juristicType: 'company',
        taxId,
      },
    });
    stranger = await factoryToken(ctx, other.publicId, 'factory_owner', 33);
  });

  afterAll(async () => {
    await ctx?.prisma.carrier.update({ where: { code: 'flash_express' }, data: { enabled: false } });
    await setSetting(ctx, 'qc.inspection_sampling', SAMPLING);
    await setSetting(ctx, 'payments.schedule_split_threshold', THRESHOLD);
    await setFlag(ctx, 'payments.scb', false);
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  /** An order of 1000 split 600 / 400 over two addresses, paid, approved, released and accepted. */
  async function acceptedOrder(n: number) {
    const { token } = await customerToken(ctx, n);
    const prepress = await staffToken(ctx, 'prepress');
    const [a, b] = [await addAddress(ctx, token, codes[0]), await addAddress(ctx, token, codes[1])];
    const quote = await saveQuote(ctx, token, fixture, [1000]);
    await as(ctx, token)
      .post('/v1/store/cart/items', {
        quoteId: quote.id,
        quoteOptionId: quote.options[0]!.id,
        designOption: 'own_file',
        destinations: [
          { addressId: a.id, quantity: 600 },
          { addressId: b.id, quantity: 400 },
        ],
      })
      .expect(201);
    const group = (
      await as(ctx, token).post('/v1/store/checkout', {}).set('Idempotency-Key', randomUUID()).expect(201)
    ).body as { id: string; orders: { id: string }[] };
    const orderId = group.orders[0]!.id;
    await payDue(ctx, token, group.id);
    await approveArtwork(ctx, token, prepress, orderId);
    await ctx.pump();
    const job = await ctx.prisma.productionJob.findFirstOrThrow({ where: { order: { publicId: orderId } } });
    await as(ctx, owner)
      .post(`/v1/partner/production-jobs/${job.publicId}/actions/accept`)
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    const detail = await as(ctx, owner).get(`/v1/partner/production-jobs/${job.publicId}`).expect(200);
    const destinations = detail.body.destinations as { id: string; postcode: string; quantity: number }[];
    return { token, groupId: group.id, orderId, jobId: job.publicId, jobRowId: job.id, destinations };
  }

  /** Production itself is covered by the B4.2 suites: here the job is simply finished with `good` pieces. */
  async function finish(jobRowId: bigint, good: number) {
    const at = new Date();
    await ctx.prisma.jobMilestone.updateMany({
      where: { jobId: jobRowId },
      data: { status: 'completed', startedAt: at, completedAt: at },
    });
    await ctx.prisma.productionJob.update({
      where: { id: jobRowId },
      data: {
        status: 'completed',
        actualStartAt: at,
        actualFinishAt: at,
        quantityGood: good,
        quantityScrap: 0,
      },
    });
  }

  const photo = (token: string) =>
    uploadBytes(ctx, token, Buffer.from(`photo ${randomUUID()}`), {
      purpose: 'evidence',
      fileName: 'pod.png',
      mimeType: 'image/png',
      surface: 'partner',
    });

  const post = (token: string, path: string, body: Record<string, unknown> = {}) =>
    as(ctx, token).post(path, body).set('Idempotency-Key', randomUUID());

  const createShipment = (token: string, jobId: string, items: [string, number][], cartonsCount = 2) =>
    post(token, '/v1/partner/shipments', {
      items: items.map(([destinationId, quantity]) => ({ jobId, destinationId, quantity })),
      cartonsCount,
      weightG: 12000,
    });

  async function pod(
    token: string,
    shipmentId: string,
    destinationId: string,
    delivered: number,
    status: number,
  ) {
    const [signatureFileId, shot] = [await photo(token), await photo(token)];
    return post(token, `/v1/partner/shipments/${shipmentId}/proof-of-delivery`, {
      receiverName: 'ผู้รับ ทดสอบ',
      signatureFileId,
      photoFileIds: [shot],
      items: [{ destinationId, deliveredQuantity: delivered }],
    }).expect(status);
  }

  /** getpack's inspection, when the risk rules asked for one (a new factory's first jobs, D-076), passes. */
  async function passInspection(jobRowId: bigint) {
    const job = await ctx.prisma.productionJob.findUniqueOrThrow({
      where: { id: jobRowId },
      include: { inspections: true },
    });
    if (!job.inspectionRequired) return;
    const partnerManager = await staffToken(ctx, 'partner_manager');
    await as(ctx, partnerManager)
      .post(`/v1/admin/inspections/${job.inspections[0]!.publicId}/actions/record`, {
        foundCritical: 0,
        foundMajor: 0,
        foundMinor: 0,
      })
      .expect(200);
  }

  it('ships in two trips to two addresses with POD, reconciles a shortage within tolerance and auto-completes', async () => {
    const o = await acceptedOrder(1);
    const [d1, d2] = [
      o.destinations.find((d) => d.quantity === 600)!,
      o.destinations.find((d) => d.quantity === 400)!,
    ];

    // Only completed jobs ship.
    expect((await createShipment(shipper, o.jobId, [[d1.id, 600]]).expect(409)).body.code).toBe(
      'shipments.job_not_shippable',
    );
    await finish(o.jobRowId, 1000);
    await passInspection(o.jobRowId);

    // IDOR: another factory neither sees the job nor can ship it.
    await createShipment(stranger, o.jobId, [[d1.id, 600]]).expect(404);
    // One trip, one address.
    expect(
      (
        await createShipment(shipper, o.jobId, [
          [d1.id, 600],
          [d2.id, 400],
        ]).expect(422)
      ).body.code,
    ).toBe('shipments.destinations_differ');

    const s1 = (await createShipment(shipper, o.jobId, [[d1.id, 600]]).expect(201)).body as Shipment;
    const s2 = (await createShipment(shipper, o.jobId, [[d2.id, 400]], 1).expect(201)).body as Shipment;
    expect(s1).toMatchObject({ status: 'draft', carrier: 'factory_fleet' });
    // Never more than the job made.
    expect((await createShipment(shipper, o.jobId, [[d2.id, 1]]).expect(422)).body.code).toBe(
      'shipments.quantity_exceeds',
    );
    await as(ctx, stranger).get(`/v1/partner/shipments/${s1.id}`).expect(404);
    await post(stranger, `/v1/partner/shipments/${s1.id}/actions/ready`).expect(404);
    expect(
      (
        (await as(ctx, stranger).get('/v1/partner/shipments?perPage=100').expect(200)).body.data as Shipment[]
      ).some((s) => s.id === s1.id),
    ).toBe(false);

    // Packed: labels (100 × 150 mm, QR, getpack brand only) and a packing list; payout frozen.
    const pdf = ctx.app.get<FakePdfRenderer>(PDF_RENDERER);
    const before = pdf.rendered.length;
    const ready = (await post(shipper, `/v1/partner/shipments/${s1.id}/actions/ready`).expect(200))
      .body as Shipment;
    expect(ready.status).toBe('ready');
    expect(ready.labelFileId).toEqual(expect.any(String));
    expect(ready.packingListFileId).toEqual(expect.any(String));
    const [labels, packing] = pdf.rendered.slice(before);
    const factory = await ctx.prisma.factory.findUniqueOrThrow({
      where: { publicId: fixture.factoryPublicId },
    });
    expect(labels).toContain('size: 100mm 150mm');
    expect(labels).toContain('<svg');
    expect(labels!.match(/class="label"/g)).toHaveLength(2);
    expect(labels).not.toContain(factory.legalName);
    expect(labels).not.toContain(factory.code);
    expect(packing).toContain('600');
    const row = await ctx.prisma.shipment.findUniqueOrThrow({
      where: { publicId: s1.id },
      include: { cartons: true, trackingLinks: true },
    });
    expect(row.cartons).toHaveLength(2);
    expect(row.trackingLinks).toHaveLength(1);
    expect(row.payoutAmount?.toFixed(2)).toBe('95.00');
    await as(ctx, owner).get(`/v1/partner/files/${ready.labelFileId}/download`).expect(200);
    await as(ctx, stranger).get(`/v1/partner/files/${ready.labelFileId}/download`).expect(404);
    await post(shipper, `/v1/partner/shipments/${s1.id}/actions/ready`).expect(409);

    // Pickup records the order's `shipped` fact; own-fleet steps follow.
    await post(shipper, `/v1/partner/shipments/${s1.id}/actions/dispatch`).expect(200);
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { publicId: o.orderId } })).status).toBe(
      'shipping',
    );
    await post(shipper, `/v1/partner/shipments/${s1.id}/events`, {
      status: 'in_transit',
      location: 'บางนา',
    }).expect(200);
    await post(shipper, `/v1/partner/shipments/${s1.id}/events`, { status: 'out_for_delivery' }).expect(200);
    await post(shipper, `/v1/partner/shipments/${s1.id}/actions/cancel`, {
      reason: 'ส่งแล้ว ยกเลิกไม่ได้',
    }).expect(409);

    // POD is mandatory: signature + photos, delivered ≤ shipped per destination.
    expect(
      (
        await post(shipper, `/v1/partner/shipments/${s1.id}/proof-of-delivery`, {
          receiverName: 'ผู้รับ ทดสอบ',
          items: [{ destinationId: d1.id, deliveredQuantity: 600 }],
        }).expect(409)
      ).body.code,
    ).toBe('shipments.pod_required');
    expect((await pod(shipper, s1.id, d1.id, 601, 422)).body.code).toBe(
      'shipments.delivered_quantity_invalid',
    );
    const delivered1 = (await pod(shipper, s1.id, d1.id, 600, 201)).body as Shipment;
    expect(delivered1).toMatchObject({ status: 'delivered', proofOfDelivery: { deliveredQuantity: 600 } });
    expect(
      (await ctx.prisma.order.findUniqueOrThrow({ where: { publicId: o.orderId } })).deliveredAt,
    ).toBeNull();

    // The second trip is delivered straight from packing (picked up on the way) with a shortage of 20.
    await post(shipper, `/v1/partner/shipments/${s2.id}/actions/ready`).expect(200);
    await pod(shipper, s2.id, d2.id, 380, 201);
    await post(shipper, `/v1/partner/shipments/${s2.id}/events`, { status: 'in_transit' }).expect(409);

    const order = await ctx.prisma.order.findUniqueOrThrow({
      where: { publicId: o.orderId },
      include: { lines: true, deliveryReconciliation: true },
    });
    expect(order.deliveredAt).not.toBeNull();
    expect(order.quantityDelivered).toBe(980);
    expect(order.claimWindowEndsAt!.getTime() - order.deliveredAt!.getTime()).toBe(7 * DAY);
    expect(Number(order.toleranceShortagePct)).toBeGreaterThanOrEqual(2);
    const product = order.lines.filter((l) => l.lineType === 'product');
    const net = product.reduce((a, l) => a + Number(l.netAmount) - Number(l.discountAmount), 0);
    expect(order.deliveryReconciliation).toMatchObject({
      outcome: 'shortage_within',
      orderedQuantity: 1000,
      deliveredQuantity: 980,
      payableQuantity: 980,
    });
    expect(order.deliveryReconciliation!.creditNetAmount!.toFixed(2)).toBe(
      (Math.round(net * 0.02 * 100) / 100).toFixed(2),
    );
    const reconciled = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: { type: 'delivery.reconciled', aggregateId: o.orderId },
    });
    expect(reconciled.payload).toMatchObject({ outcome: 'shortage_within', payableQuantity: 980 });
    expect(order.deliveryReconciliation!.domainEventId).toBe(reconciled.id);

    const logistics = await staffToken(ctx, 'logistics');
    const executive = await staffToken(ctx, 'c_level');
    const rec = await as(ctx, logistics)
      .get(`/v1/admin/orders/${o.orderId}/delivery-reconciliation`)
      .expect(200);
    expect(rec.body).toMatchObject({ outcome: 'shortage_within', deviationPct: '-2.0000' });
    // D-141: the payout is a buy price — Logistics does not see it.
    expect(
      (await as(ctx, logistics).get(`/v1/admin/shipments/${s1.id}`).expect(200)).body.payoutAmount,
    ).toBeNull();
    expect((await as(ctx, executive).get(`/v1/admin/shipments/${s1.id}`).expect(200)).body.payoutAmount).toBe(
      '95.00',
    );

    // The customer sees both trips, no factory, and the delivery photos.
    const mine = (await as(ctx, o.token).get(`/v1/store/orders/${o.orderId}/shipments`).expect(200))
      .body as (Shipment & Record<string, unknown>)[];
    expect(mine).toHaveLength(2);
    expect(mine.every((s) => s.carrier === 'getpack' && !('factoryId' in s) && !('payoutAmount' in s))).toBe(
      true,
    );
    // D-435: a pickup or line-haul step never carries its location to the customer.
    const steps = mine.flatMap(
      (s) => (s as unknown as { events: { status: string; location: string | null }[] }).events,
    );
    expect(steps.find((e) => e.status === 'in_transit')).toMatchObject({ location: null });
    expect(JSON.stringify(mine)).not.toContain('บางนา');
    const shared = mine[0]!.proofOfDelivery!.photoFileIds[0]!;
    await as(ctx, o.token).get(`/v1/store/files/${shared}/download`).expect(200);
    const { token: otherCustomer } = await customerToken(ctx, 2);
    await as(ctx, otherCustomer).get(`/v1/store/orders/${o.orderId}/shipments`).expect(404);
    await as(ctx, otherCustomer).get(`/v1/store/files/${shared}/download`).expect(404);

    // D-155: on-time shipping counts the job's first pickup against its promised ship date.
    const month = new Date(`${bangkokDate(new Date()).slice(0, 7)}-01T00:00:00+07:00`);
    const card = await ctx.app.get(ProductionOversightService).computeScorecard(factory.id, month);
    expect((card.inputs as { shipped: number }).shipped).toBeGreaterThanOrEqual(1);

    // D-081: complete 7 days after delivery (time travel), not before.
    const delivery = ctx.app.get(DeliveryService);
    await delivery.autoComplete(new Date(order.deliveredAt!.getTime() + 6 * DAY));
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).completedAt).toBeNull();
    await delivery.autoComplete(new Date(order.deliveredAt!.getTime() + 7 * DAY + 60_000));
    expect(await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      status: 'completed',
      completionMode: 'auto_after_days',
    });
  });

  it('blocks pickup until the balance before shipping is paid and the getpack inspection passed', async () => {
    await setSetting(ctx, 'payments.schedule_split_threshold', '1.00');
    await setSetting(ctx, 'qc.inspection_sampling', { ...SAMPLING, fullInspectionFromValue: '1.00' });
    const o = await acceptedOrder(3);
    await finish(o.jobRowId, 1000);
    const d1 = o.destinations.find((d) => d.quantity === 600)!;
    const s = (await createShipment(owner, o.jobId, [[d1.id, 600]]).expect(201)).body as Shipment;
    await post(owner, `/v1/partner/shipments/${s.id}/actions/ready`).expect(200);

    expect((await post(owner, `/v1/partner/shipments/${s.id}/actions/dispatch`).expect(409)).body.code).toBe(
      'shipments.payment_pending',
    );
    await ctx.pump();
    await payDue(ctx, o.token, o.groupId);
    expect((await post(owner, `/v1/partner/shipments/${s.id}/actions/dispatch`).expect(409)).body.code).toBe(
      'shipments.inspection_pending',
    );
    await passInspection(o.jobRowId);
    await post(owner, `/v1/partner/shipments/${s.id}/actions/dispatch`).expect(200);

    // The customer may confirm receipt only once delivered; then the order completes at once.
    expect(
      (await post(o.token, `/v1/store/orders/${o.orderId}/actions/confirm-receipt`).expect(409)).body.code,
    ).toBe('order.invalid_transition');
    await pod(owner, s.id, d1.id, 600, 201);
    const d2 = o.destinations.find((d) => d.quantity === 400)!;
    const s2 = (await createShipment(owner, o.jobId, [[d2.id, 400]], 1).expect(201)).body as Shipment;
    await post(owner, `/v1/partner/shipments/${s2.id}/actions/ready`).expect(200);
    await pod(owner, s2.id, d2.id, 400, 201);
    expect(
      await ctx.prisma.deliveryReconciliation.findFirstOrThrow({ where: { order: { publicId: o.orderId } } }),
    ).toMatchObject({ outcome: 'exact', creditAmount: null });
    // U-B0.1: the order view carries the receipt dates and the tolerance outcome (D-081, D-082, D-080).
    const delivered = (
      await request(ctx.server)
        .get(`/v1/store/orders/${o.orderId}`)
        .auth(o.token, { type: 'bearer' })
        .expect(200)
    ).body as {
      receipt: Record<string, string | null>;
      toleranceOutcome: { outcome: string; orderedQuantity: number; deliveredQuantity: number } | null;
    };
    const day = 86_400_000;
    const deliveredAt = Date.parse(delivered.receipt['deliveredAt']!);
    expect(Date.parse(delivered.receipt['autoCompleteAt']!) - deliveredAt).toBe(7 * day);
    expect(Date.parse(delivered.receipt['claimWindowEndsAt']!) - deliveredAt).toBe(7 * day);
    expect(delivered.receipt).toMatchObject({ completedAt: null, confirmedAt: null, completionMode: null });
    expect(delivered.toleranceOutcome).toMatchObject({
      outcome: 'exact',
      orderedQuantity: 1000,
      deliveredQuantity: 1000,
    });
    expect(delivered.toleranceOutcome).not.toHaveProperty('payableQuantity');
    const confirmed = await post(o.token, `/v1/store/orders/${o.orderId}/actions/confirm-receipt`).expect(
      200,
    );
    expect(confirmed.body.status).toBe('completed');
    expect(confirmed.body.receipt).toMatchObject({
      completionMode: 'customer_confirmed',
      autoCompleteAt: null,
      confirmedAt: confirmed.body.receipt.completedAt,
    });
    expect(
      (await ctx.prisma.order.findUniqueOrThrow({ where: { publicId: o.orderId } })).completionMode,
    ).toBe('customer_confirmed');
  });

  it('books a fallback carrier and follows its callbacks to a carrier POD; cancels before pickup', async () => {
    await setSetting(ctx, 'payments.schedule_split_threshold', THRESHOLD);
    await setSetting(ctx, 'qc.inspection_sampling', SAMPLING);
    const o = await acceptedOrder(4);
    await finish(o.jobRowId, 1000);
    await passInspection(o.jobRowId);
    const [d1, d2] = [
      o.destinations.find((d) => d.quantity === 600)!,
      o.destinations.find((d) => d.quantity === 400)!,
    ];
    const s = (await createShipment(owner, o.jobId, [[d1.id, 600]], 1).expect(201)).body as Shipment;
    await post(owner, `/v1/partner/shipments/${s.id}/actions/ready`).expect(200);

    // U-B0.3: the factory asks getpack for a carrier (once); its view shows the cartons and the request.
    const asked = await post(owner, `/v1/partner/shipments/${s.id}/actions/request-carrier`, {
      reason: 'รถโรงงานไม่วิ่งพื้นที่นี้',
    }).expect(200);
    expect(asked.body).toMatchObject({
      carrierRequest: { reason: 'รถโรงงานไม่วิ่งพื้นที่นี้' },
      blockedByPayment: false,
      cartons: [expect.objectContaining({ seq: 1 })],
    });
    await post(owner, `/v1/partner/shipments/${s.id}/actions/request-carrier`, {
      reason: 'ซ้ำอีกครั้ง',
    }).expect(409);
    const open = (await as(ctx, owner).get('/v1/partner/shipments?view=open&perPage=100').expect(200)).body
      .data as { id: string }[];
    expect(open.map((x) => x.id)).toContain(s.id);
    const plan = (
      await as(ctx, owner).get(`/v1/partner/factories/${fixture.factoryPublicId}/ship-plan`).expect(200)
    ).body as {
      jobId: string;
      destinations: { destinationId: string; shippedQuantity: number; remainingQuantity: number }[];
    }[];
    const planned = plan.find((p) => p.jobId === o.jobId)!;
    expect(planned.destinations.find((d) => d.destinationId === d1.id)).toMatchObject({
      shippedQuantity: 600,
      remainingQuantity: 0,
    });
    expect(planned.destinations.find((d) => d.destinationId === d2.id)).toMatchObject({ shippedQuantity: 0 });

    const logistics = await staffToken(ctx, 'logistics');
    await ctx.prisma.carrier.update({ where: { code: 'flash_express' }, data: { enabled: true } });
    await ensureCarrierAccount('flash_express');
    await ensureFactoryPickup(fixture.factoryPublicId);
    const booked = await post(logistics, `/v1/admin/shipments/${s.id}/actions/book-carrier`, {
      carrier: 'flash_express',
      reason: 'โรงงานไม่มีรถวิ่งพื้นที่นี้',
    }).expect(200);
    expect(booked.body).toMatchObject({ carrier: 'flash_express', status: 'ready' });
    expect((booked.body as { events: { note: string | null }[] }).events.at(-1)!.note).toBe(
      'booked with flash_express: โรงงานไม่มีรถวิ่งพื้นที่นี้',
    );
    const ref = booked.body.carrierBookingRef as string;
    // D-442: the carrier got getpack as the sender (entity settings) — never the factory's name, contact or address.
    const fakeFlash = ctx.app.get<CarrierAdapters>(CARRIER_ADAPTERS).get('flash_express') as FakeCarrierAdapter;
    const sent = fakeFlash.booked.get(ref)!;
    expect(sent.from).toMatchObject({ name: DEV_ENTITY.displayName, phone: DEV_ENTITY.phone, postcode: '10000' });
    const factoryRow = await ctx.prisma.factory.findUniqueOrThrow({
      where: { publicId: fixture.factoryPublicId },
      include: { addresses: true, contacts: true },
    });
    for (const leak of [
      factoryRow.legalName,
      factoryRow.code,
      ...factoryRow.addresses.map((a) => a.line1),
      ...factoryRow.contacts.flatMap((c) => [c.name, c.phone ?? '']),
    ].filter((v) => v && v.length > 3))
      expect(JSON.stringify(sent)).not.toContain(leak);
    // The factory no longer reports steps of a carrier-booked trip.
    await post(owner, `/v1/partner/shipments/${s.id}/events`, { status: 'in_transit' }).expect(409);

    const callback = (status: string, at: string) =>
      request(ctx.server)
        .post('/webhooks/carriers/flash-express')
        .set('x-fake-carrier-signature', 'valid')
        .send({ ref, status, at });
    await callback('in_transit', '1').expect(200);
    await callback('in_transit', '1').expect(200); // replay: stored once
    await ctx.pump();
    const include = { events: true, proofOfDelivery: true } as const;
    let row = await ctx.prisma.shipment.findUniqueOrThrow({ where: { publicId: s.id }, include });
    expect(row.status).toBe('in_transit');
    expect(row.pickedUpAt).not.toBeNull();
    expect(row.events.filter((e) => e.source === 'carrier_webhook')).toHaveLength(2); // pickup + in transit
    await callback('delivered', '2').expect(200);
    await ctx.pump();
    row = await ctx.prisma.shipment.findUniqueOrThrow({ where: { publicId: s.id }, include });
    expect(row.status).toBe('delivered');
    expect(row.proofOfDelivery).toMatchObject({ kind: 'carrier_pod', deliveredQuantity: 600 });

    // A packed trip can be cancelled; its goods count as unshipped again.
    const s2 = (await createShipment(owner, o.jobId, [[d2.id, 400]], 1).expect(201)).body as Shipment;
    await post(owner, `/v1/partner/shipments/${s2.id}/actions/ready`).expect(200);
    await post(owner, `/v1/partner/shipments/${s2.id}/actions/cancel`, { reason: 'รวมรอบใหม่' }).expect(200);
    expect(
      await ctx.prisma.trackingLink.count({ where: { shipment: { publicId: s2.id }, revokedAt: null } }),
    ).toBe(0);
    await createShipment(owner, o.jobId, [[d2.id, 400]], 1).expect(201);
  });

  it('U-B0.2: splits a draft, quotes carriers, resolves delivery exceptions and reviews a POD (D-229, D-230)', async () => {
    await setSetting(ctx, 'payments.schedule_split_threshold', THRESHOLD);
    await setSetting(ctx, 'qc.inspection_sampling', SAMPLING);
    const o = await acceptedOrder(5);
    await finish(o.jobRowId, 1000);
    await passInspection(o.jobRowId);
    const d1 = o.destinations.find((d) => d.quantity === 600)!;
    const s = (await createShipment(owner, o.jobId, [[d1.id, 600]], 2).expect(201)).body as Shipment;
    const logistics = await staffToken(ctx, 'logistics');
    const admin = (id: string) => as(ctx, logistics).get(`/v1/admin/shipments/${id}`).expect(200);

    // The staff view: ETag, province, cartons, payment block.
    const draft = await admin(s.id);
    expect(draft.headers['etag']).toEqual(expect.any(String));
    expect(draft.body).toMatchObject({
      destination: { province: { id: expect.any(String), nameTh: expect.any(String) } },
      cartons: [],
      blockedByPayment: false,
      exception: null,
      podReview: null,
      splitFrom: null,
    });

    // Split a draft (D-230): stale ETag, everything, then 200 pieces with a carton and 4 kg.
    const split = (body: Record<string, unknown>) =>
      post(logistics, `/v1/admin/shipments/${s.id}/actions/split`, {
        cartonsCount: 1,
        weightG: 4000,
        reason: 'แยกส่งสองรอบ',
        ...body,
      });
    await split({ items: [{ destinationId: d1.id, quantity: 200 }] })
      .set('If-Match', '"stale"')
      .expect(412);
    await split({ items: [{ destinationId: d1.id, quantity: 600 }] }).expect(422);
    const done = await split({ items: [{ destinationId: d1.id, quantity: 200 }] })
      .set('If-Match', draft.headers['etag'] as string)
      .expect(201);
    expect(done.body.shipment).toMatchObject({ cartonsCount: 1, weightG: 8000, items: [{ quantity: 400 }] });
    expect(done.body.created).toMatchObject({
      status: 'draft',
      cartonsCount: 1,
      weightG: 4000,
      items: [{ destinationId: d1.id, quantity: 200 }],
      splitFrom: { id: s.id },
    });
    const s2 = done.body.created.id as string;

    // Carrier quotes for a packed trip; the cost stays hidden without `factory_cost.read` (D-141).
    await post(owner, `/v1/partner/shipments/${s.id}/actions/ready`).expect(200);
    await split({ items: [{ destinationId: d1.id, quantity: 100 }] }).expect(409);
    expect((await admin(s.id)).body.cartons).toHaveLength(1);
    await ctx.prisma.carrier.update({ where: { code: 'flash_express' }, data: { enabled: true } });
    await ensureCarrierAccount('flash_express');
    await ensureFactoryPickup(fixture.factoryPublicId);
    const quotes = await post(logistics, `/v1/admin/shipments/${s.id}/carrier-quotes`).expect(200);
    expect(quotes.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ carrier: 'flash_express', available: true, amount: null, currency: 'THB' }),
      ]),
    );

    // A failed delivery: in the exceptions queue; retry puts it back in transit; a new failure reopens it.
    await post(owner, `/v1/partner/shipments/${s.id}/actions/dispatch`).expect(200);
    await post(owner, `/v1/partner/shipments/${s.id}/events`, {
      status: 'failed',
      note: 'ไม่มีผู้รับ',
    }).expect(200);
    const queue = async (name: string) =>
      (
        (await as(ctx, logistics).get(`/v1/admin/shipments?queue=${name}&perPage=100`).expect(200)).body
          .data as { id: string }[]
      ).map((x) => x.id);
    expect(await queue('exceptions')).toContain(s.id);
    expect((await admin(s.id)).body.exception).toMatchObject({
      status: 'failed',
      note: 'ไม่มีผู้รับ',
      resolution: null,
    });
    const resolve = (resolution: string) =>
      post(logistics, `/v1/admin/shipments/${s.id}/actions/resolve-exception`, {
        resolution,
        reason: 'ลูกค้านัดรับใหม่',
      });
    await resolve('cancel').expect(409);
    const retried = await resolve('retry').expect(200);
    expect(retried.body.status).toBe('in_transit');
    expect(await queue('exceptions')).not.toContain(s.id);
    await post(owner, `/v1/partner/shipments/${s.id}/events`, { status: 'failed', note: 'ปิดร้าน' }).expect(
      200,
    );
    expect((await admin(s.id)).body.exception).toMatchObject({ note: 'ปิดร้าน', resolution: null });
    const returned = await resolve('return').expect(200);
    expect(returned.body).toMatchObject({
      status: 'returned',
      exception: {
        status: 'returned',
        resolution: 'return',
        resolvedBy: expect.objectContaining({ id: expect.any(String) }),
      },
    });
    expect(await queue('exceptions')).not.toContain(s.id);
    await resolve('cancel').expect(409);
    expect(
      await ctx.prisma.domainEvent.count({
        where: { type: 'shipment.exception_resolved', aggregateId: s.id },
      }),
    ).toBe(2);

    // POD review of the split trip (D-229): pending in the queue; a rejection needs a note.
    await post(owner, `/v1/partner/shipments/${s2}/actions/ready`).expect(200);
    await post(owner, `/v1/partner/shipments/${s2}/actions/dispatch`).expect(200);
    await pod(owner, s2, d1.id, 200, 201);
    expect((await admin(s2)).body.podReview).toMatchObject({ state: 'pending', reviewedBy: null });
    expect(await queue('pod_review')).toContain(s2);
    await as(ctx, logistics).post(`/v1/admin/shipments/${s2}/pod/actions/reject`, {}).expect(422);
    await as(ctx, logistics).post(`/v1/admin/shipments/${s2}/pod/actions/approve`, {}).expect(404);
    const rejected = await as(ctx, logistics)
      .post(`/v1/admin/shipments/${s2}/pod/actions/reject`, { note: 'ลายเซ็นไม่ชัด' })
      .expect(200);
    expect(rejected.body).toMatchObject({
      status: 'delivered',
      podReview: {
        state: 'rejected',
        note: 'ลายเซ็นไม่ชัด',
        reviewedBy: expect.objectContaining({ id: expect.any(String) }),
      },
    });
    expect(await queue('pod_review')).not.toContain(s2);
    expect(
      await ctx.prisma.domainEvent.count({ where: { type: 'shipment.pod_rejected', aggregateId: s2 } }),
    ).toBe(1);
    await as(ctx, logistics).post(`/v1/admin/shipments/${s2}/pod/actions/accept`, {}).expect(200);
    expect((await admin(s2)).body.podReview.state).toBe('accepted');

    // Filters: carrier and factory.
    const byFactory = await as(ctx, logistics)
      .get(`/v1/admin/shipments?factoryId=${fixture.factoryPublicId}&carrier=factory_fleet&perPage=100`)
      .expect(200);
    expect((byFactory.body.data as { id: string }[]).map((x) => x.id)).toEqual(
      expect.arrayContaining([s.id, s2]),
    );
    const byCarrier = await as(ctx, logistics).get('/v1/admin/shipments?carrier=deliveree').expect(200);
    expect((byCarrier.body.data as { id: string }[]).map((x) => x.id)).not.toContain(s.id);
  });

  async function ensureCarrierAccount(code: 'flash_express') {
    const carrier = await ctx.prisma.carrier.findUniqueOrThrow({ where: { code } });
    const entity = await ctx.prisma.entity.findFirstOrThrow({ where: { isDefault: true } });
    const existing = await ctx.prisma.carrierAccount.findFirst({
      where: { carrierId: carrier.id, entityId: entity.id, status: 'active' },
    });
    if (!existing)
      await ctx.prisma.carrierAccount.create({
        data: {
          entityId: entity.id,
          carrierId: carrier.id,
          label: 'fake',
          credentialsSecretRef: 'getpack/fake/carrier',
          sandbox: true,
        },
      });
  }

  async function ensureFactoryPickup(factoryPublicId: string) {
    const factory = await ctx.prisma.factory.findUniqueOrThrow({
      where: { publicId: factoryPublicId },
      include: { addresses: true, contacts: true },
    });
    if (!factory.addresses.some((a) => a.kind === 'pickup' && a.postcode))
      await ctx.prisma.factoryAddress.create({
        data: { factoryId: factory.id, kind: 'pickup', line1: '9 ถนนโรงงาน (fake)', postcode: codes[0] },
      });
    if (!factory.contacts.some((c) => c.phone))
      await ctx.prisma.factoryContact.create({
        data: { factoryId: factory.id, name: 'ผู้ติดต่อ (fake)', phone: '+66810009999' },
      });
  }
});
