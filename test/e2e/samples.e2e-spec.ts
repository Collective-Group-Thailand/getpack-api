import { randomUUID } from 'node:crypto';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import { seedDevService } from '../../prisma/seed/dev-service';
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

interface Milestone {
  id: string;
  seq: number;
  evidence: 'none' | 'photo' | 'qc_form' | 'photo_and_qc_form';
  tracksQuantity: boolean;
}
interface Sample {
  id: string;
  kind: string;
  status: string;
  orderId: string | null;
  quotation: { quoteId: string; optionId: string } | null;
  decision: { evidencePhotoSha256: string[] } | null;
  approvedProofId: string | null;
  evidence: { photos: { sha256: string | null }[] };
  credit: { creditOrderId: string | null; bulkQuoteId: string | null } | null;
  buyNetAmount?: string | null;
}

/**
 * Samples (U2.4, D-253–D-259): an attached sample holds its bulk order, ships with evidence without touching the bulk
 * order and is approved by the customer (finding F4, pre-launch); changes requested lead to a new sample; a
 * standalone sample is quoted, bought as an order of kind `sample`, priced to the factory at its buy amount, and
 * credited on the bulk order made from it — released again when that order is cancelled.
 */
describe('samples (e2e, U2.4)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let mockupItem: string;
  let codes: string[];
  let cs: string;
  let owner: string;
  let operator: string;
  let qc: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    mockupItem = (await ctx.prisma.$transaction((tx) => seedDevService(tx), { timeout: 60_000 })).fixture
      .mockupPublicId;
    codes = postcodes(ctx, 2);
    await seedShipping(ctx, fixture.factoryPublicId, codes);
    await setFlag(ctx, 'payments.scb', true);
    cs = await staffToken(ctx, 'cs_lead');
    owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 81);
    operator = await factoryToken(ctx, fixture.factoryPublicId, 'factory_operator', 82);
    qc = await factoryToken(ctx, fixture.factoryPublicId, 'factory_qc', 83);
  });

  afterAll(async () => {
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

  async function placed(token: string, postcode: string) {
    const address = await addAddress(ctx, token, postcode);
    const quote = await saveQuote(ctx, token, fixture, [1000]);
    await as(ctx, token)
      .post('/v1/store/cart/items', {
        quoteId: quote.id,
        quoteOptionId: quote.options[0]!.id,
        designOption: 'own_file',
        destinations: [{ addressId: address.id, quantity: 1000 }],
      })
      .expect(201);
    const group = (await post(token, '/v1/store/checkout').expect(201)).body as {
      id: string;
      orders: { id: string }[];
    };
    return { groupId: group.id, orderId: group.orders[0]!.id };
  }

  /** The factory accepts the sample's job and walks its route to completion. */
  async function makeJob(jobPublicId: string) {
    await post(owner, `/v1/partner/production-jobs/${jobPublicId}/actions/accept`).expect(200);
    const detail = await as(ctx, owner).get(`/v1/partner/production-jobs/${jobPublicId}`).expect(200);
    for (const m of (detail.body.milestones as Milestone[]).sort((a, b) => a.seq - b.seq)) {
      const url = `/v1/partner/production-jobs/${jobPublicId}/milestones/${m.id}`;
      await post(operator, url, {
        action: 'start',
        clientRef: randomUUID(),
        ...(m.tracksQuantity && { quantityIn: 1 }),
      }).expect(200);
      const shot = m.evidence.includes('photo') ? [await photo(operator)] : [];
      if (m.evidence.includes('qc_form'))
        await post(qc, `/v1/partner/production-jobs/${jobPublicId}/qc-checks`, {
          checklistVersion: 'sample-v1',
          checklist: { colour: 'ok' },
          result: 'pass',
          quantityChecked: 1,
          photoFileIds: shot.length ? shot : [await photo(qc)],
        }).expect(201);
      await post(operator, url, {
        action: 'complete',
        clientRef: randomUUID(),
        ...(m.tracksQuantity && { quantityOut: 1, quantityScrap: 0 }),
        ...(shot.length && { photoFileIds: shot }),
      }).expect(200);
    }
    return detail.body.destinations as { id: string }[];
  }

  async function evidence(sampleId: string) {
    return post(owner, `/v1/partner/factories/${fixture.factoryPublicId}/samples/${sampleId}/evidence`, {
      lengthMm: 300,
      widthMm: 200,
      depthMm: 50,
      basis: 'internal',
      materialUsed: 'อาร์ตการ์ด 350 แกรม (fake)',
      photoFileIds: [await photo(owner)],
    });
  }

  async function shipAndDeliver(jobPublicId: string, destinationId: string) {
    const shipment = (
      await post(owner, '/v1/partner/shipments', {
        items: [{ jobId: jobPublicId, destinationId, quantity: 1 }],
        cartonsCount: 1,
        weightG: 800,
      }).expect(201)
    ).body.id as string;
    await post(owner, `/v1/partner/shipments/${shipment}/actions/ready`).expect(200);
    await post(owner, `/v1/partner/shipments/${shipment}/actions/dispatch`).expect(200);
    await ctx.pump();
    await post(owner, `/v1/partner/shipments/${shipment}/proof-of-delivery`, {
      receiverName: 'ผู้รับ ทดสอบ',
      signatureFileId: await photo(owner),
      photoFileIds: [await photo(owner)],
      items: [{ destinationId, deliveredQuantity: 1 }],
    }).expect(201);
    await ctx.pump();
    return shipment;
  }

  const attach = (orderId: string, extra: Record<string, unknown> = {}) =>
    post(cs, `/v1/admin/orders/${orderId}/samples`, {
      serviceItemId: mockupItem,
      basis: 'buy_cost_net',
      amount: 600,
      mockupOption: 'with_print',
      reason: 'ลูกค้าขอตัวอย่างจริงก่อนผลิต (fake)',
      ...extra,
    });

  it('holds the bulk order until the customer approves its attached sample, shipped with evidence (F4, D-255, D-256, D-258)', async () => {
    const { token } = await customerToken(ctx, 1);
    const prepress = await staffToken(ctx, 'prepress');
    const { groupId, orderId } = await placed(token, codes[0]!);
    const sample = (await attach(orderId).expect(201)).body as Sample;
    expect(sample).toMatchObject({ kind: 'attached', status: 'quoted', orderId });
    // CS Lead does not see buy prices (D-141); the factory's buy amount is kept for its purchase order.
    expect(sample.buyNetAmount).toBeNull();
    expect(
      (await ctx.prisma.sample.findFirstOrThrow({ where: { publicId: sample.id } })).buyNetAmount!.toFixed(2),
    ).toBe('600.00');
    await attach(orderId).expect(409);

    await payDue(ctx, token, groupId);
    await approveArtwork(ctx, token, prepress, orderId);
    await ctx.pump();
    // Bulk production waits (D-256); the sample job was released on its payment at the buy amount (D-254, T2).
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { publicId: orderId } });
    expect(
      await ctx.prisma.productionJob.count({ where: { orderId: order.id, jobKind: 'production' } }),
    ).toBe(0);
    const blocked = await ctx.prisma.domainEvent.findFirst({
      where: { type: 'production.release_blocked', aggregateId: orderId },
      orderBy: { occurredAt: 'desc' },
    });
    expect(blocked?.payload).toMatchObject({ reason: 'sample_not_approved' });
    const job = await ctx.prisma.productionJob.findFirstOrThrow({
      where: { orderId: order.id, jobKind: 'mockup' },
    });
    const po = await ctx.prisma.purchaseOrder.findFirstOrThrow({ where: { productionJobId: job.id } });
    expect(po.netAmount.toFixed(2)).toBe('600.00');
    expect((await as(ctx, token).get(`/v1/store/samples/${sample.id}`).expect(200)).body.status).toBe(
      'in_production',
    );
    // Not even CS starts it before the sample is approved (D-256).
    const manual = await post(cs, `/v1/admin/orders/${orderId}/actions/start-production`, {
      reason: 'ด่วน (fake)',
    }).expect(409);
    expect(manual.body.code).toBe('production.gate_closed');

    const destinations = await makeJob(job.publicId);
    // No evidence, no shipping (D-255).
    const early = await post(owner, '/v1/partner/shipments', {
      items: [{ jobId: job.publicId, destinationId: destinations[0]!.id, quantity: 1 }],
      cartonsCount: 1,
      weightG: 800,
    }).expect(409);
    expect(early.body.code).toBe('samples.evidence_missing');
    expect((await evidence(sample.id)).status).toBe(201);
    expect((await evidence(sample.id)).body.code).toBe('samples.evidence_recorded');
    await shipAndDeliver(job.publicId, destinations[0]!.id);
    // The bulk order is neither shipped nor delivered by its sample (D-258, T5).
    const after = await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.shippedAt).toBeNull();
    expect(after.deliveredAt).toBeNull();

    const delivered = (await as(ctx, token).get(`/v1/store/samples/${sample.id}`).expect(200)).body as Sample;
    expect(delivered.status).toBe('delivered');
    expect(delivered.evidence.photos).toHaveLength(1);
    const other = await customerToken(ctx, 2);
    await post(other.token, `/v1/store/samples/${sample.id}/actions/approve`).expect(404);
    const approved = (
      await post(token, `/v1/store/samples/${sample.id}/actions/approve`)
        .set('User-Agent', 'getpack-e2e (fake)')
        .expect(200)
    ).body as Sample;
    expect(approved.status).toBe('approved');
    expect(approved.decision!.evidencePhotoSha256).toEqual([delivered.evidence.photos[0]!.sha256]);
    expect(approved.approvedProofId).not.toBeNull();
    await post(token, `/v1/store/samples/${sample.id}/actions/approve`).expect(409);
    const row = await ctx.prisma.sample.findFirstOrThrow({ where: { publicId: sample.id } });
    expect(row.decisionUserAgent).not.toBeNull();
    expect(row.approvedSpec).not.toBeNull();

    await ctx.pump();
    expect(
      await ctx.prisma.productionJob.count({ where: { orderId: order.id, jobKind: 'production' } }),
    ).toBe(1);
  });

  it('asks for changes, quotes a new sample after it, and lifts the hold when CS cancels (D-253, D-256)', async () => {
    const { token } = await customerToken(ctx, 3);
    const prepress = await staffToken(ctx, 'prepress');
    const { groupId, orderId } = await placed(token, codes[1]!);
    const first = (await attach(orderId).expect(201)).body as Sample;
    await payDue(ctx, token, groupId);
    await approveArtwork(ctx, token, prepress, orderId);
    await ctx.pump();
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { publicId: orderId } });
    const job = await ctx.prisma.productionJob.findFirstOrThrow({
      where: { orderId: order.id, jobKind: 'mockup' },
    });
    const destinations = await makeJob(job.publicId);
    expect((await evidence(first.id)).status).toBe(201);
    await shipAndDeliver(job.publicId, destinations[0]!.id);
    await post(token, `/v1/store/samples/${first.id}/actions/request-changes`).expect(422);
    expect(
      (
        await post(token, `/v1/store/samples/${first.id}/actions/request-changes`, {
          note: 'สีเข้มไป (fake)',
        }).expect(200)
      ).body.status,
    ).toBe('changes_requested');
    await ctx.pump();
    expect(
      await ctx.prisma.productionJob.count({ where: { orderId: order.id, jobKind: 'production' } }),
    ).toBe(0);

    const second = (await attach(orderId, { previousSampleId: first.id }).expect(201)).body as Sample;
    expect(second.status).toBe('quoted');
    const cancelled = await post(cs, `/v1/admin/samples/${second.id}/actions/cancel`, {
      reason: 'ลูกค้าไม่ต้องการแล้ว (fake)',
    }).expect(200);
    expect(cancelled.body.status).toBe('cancelled');
    // The earlier sample is still the latest not cancelled, so the hold stays until its replacement is approved.
    await ctx.pump();
    expect(
      await ctx.prisma.productionJob.count({ where: { orderId: order.id, jobKind: 'production' } }),
    ).toBe(0);
    await post(cs, `/v1/admin/samples/${first.id}/actions/cancel`, { reason: 'ผลิตตามไฟล์ (fake)' }).expect(
      409,
    );
  });

  it('quotes a standalone sample, makes it as an order of kind sample, and credits it once on the bulk order (D-254, D-257)', async () => {
    const { token } = await customerToken(ctx, 4);
    const address = await addAddress(ctx, token, codes[0]!);
    const quote = await saveQuote(ctx, token, fixture, [1000]);
    const requested = (
      await post(token, '/v1/store/samples', {
        quoteId: quote.id,
        mockupOption: 'without_print',
        deliveryPostcode: codes[0],
      }).expect(201)
    ).body as Sample;
    expect(requested).toMatchObject({ kind: 'standalone', status: 'requested', quotation: null });
    const quoted = (
      await post(cs, `/v1/admin/samples/${requested.id}/actions/quote`, {
        serviceItemId: mockupItem,
        basis: 'buy_cost_net',
        amount: 600,
        leadTimeDays: 5,
        parcelWeightG: 800,
      }).expect(200)
    ).body as Sample;
    expect(quoted.status).toBe('quoted');
    await post(cs, `/v1/admin/samples/${requested.id}/actions/quote`, {
      serviceItemId: mockupItem,
      basis: 'buy_cost_net',
      amount: 600,
      leadTimeDays: 5,
      parcelWeightG: 800,
    }).expect(409);

    await as(ctx, token)
      .post('/v1/store/cart/items', {
        quoteId: quoted.quotation!.quoteId,
        quoteOptionId: quoted.quotation!.optionId,
        designOption: 'own_file',
        destinations: [{ addressId: address.id, quantity: 1 }],
      })
      .expect(201);
    const group = (await post(token, '/v1/store/checkout').expect(201)).body as {
      id: string;
      orders: { id: string }[];
    };
    const sampleOrder = await ctx.prisma.order.findUniqueOrThrow({
      where: { publicId: group.orders[0]!.id },
      include: { lines: true },
    });
    expect(sampleOrder.kind).toBe('sample');
    expect(sampleOrder.lines.find((l) => l.lineType === 'product')!.revenueCategory).toBe('mockup');
    await payDue(ctx, token, group.id);
    await ctx.pump();
    const job = await ctx.prisma.productionJob.findFirstOrThrow({ where: { orderId: sampleOrder.id } });
    expect(job.jobKind).toBe('mockup');
    const po = await ctx.prisma.purchaseOrder.findFirstOrThrow({ where: { productionJobId: job.id } });
    expect(po.netAmount.toFixed(2)).toBe('600.00');
    const destinations = await makeJob(job.publicId);
    expect((await evidence(requested.id)).status).toBe(201);
    await shipAndDeliver(job.publicId, destinations[0]!.id);
    const deliveredOrder = await ctx.prisma.order.findUniqueOrThrow({
      where: { id: sampleOrder.id },
      include: { deliveryReconciliation: true },
    });
    expect(deliveredOrder.deliveredAt).not.toBeNull();
    expect(deliveredOrder.deliveryReconciliation).toBeNull();
    await post(token, `/v1/store/samples/${requested.id}/actions/approve`).expect(200);

    // Bulk order from the sample: the credit applies once (D-257).
    const bulk = await post(token, `/v1/store/samples/${requested.id}/actions/order-bulk`, {
      quantity: 2000,
    }).expect(200);
    expect(bulk.body.creditAvailable).toBe(true);
    const cart = await as(ctx, token).get('/v1/store/cart').expect(200);
    const item = (cart.body.items as { id: string; quoteId: string }[]).find(
      (i) => i.quoteId === bulk.body.quoteId,
    )!;
    expect(item).toBeDefined();
    const bulkGroup = (await post(token, '/v1/store/checkout').expect(201)).body as {
      id: string;
      orders: { id: string }[];
    };
    const bulkOrder = await ctx.prisma.order.findUniqueOrThrow({
      where: { publicId: bulkGroup.orders[0]!.id },
      include: { discounts: true },
    });
    const credit = bulkOrder.discounts.find((d) => d.source === 'sample_credit')!;
    const row = await ctx.prisma.sample.findFirstOrThrow({ where: { publicId: requested.id } });
    // 100 % of the sample's product price excl. VAT and freight (`samples.credit_pct`).
    expect(credit.amount.toFixed(2)).toBe(row.sellNetAmount!.toFixed(2));
    let sample = (await as(ctx, token).get(`/v1/store/samples/${requested.id}`).expect(200)).body as Sample;
    expect(sample.credit!.creditOrderId).toBe(bulkOrder.publicId);

    // Cancelling the bulk order releases the credit within the window.
    await post(token, `/v1/store/order-groups/${bulkGroup.id}/actions/cancel`, {
      reasonCode: 'customer_request',
    }).expect(200);
    await ctx.pump();
    sample = (await as(ctx, token).get(`/v1/store/samples/${requested.id}`).expect(200)).body as Sample;
    expect(sample.credit!.creditOrderId).toBeNull();
  });
});
