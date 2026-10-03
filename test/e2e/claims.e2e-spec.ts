import { randomUUID } from 'node:crypto';

import { DeliveryService } from '@modules/logistics/delivery.service';
import { ProductionOversightService } from '@modules/production/production-oversight.service';

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

const DAY = 86_400_000;

interface Claim {
  id: string;
  status: string;
  origin: string;
  liability?: string;
  liabilityByRule?: string;
  photos: { product: string[]; carton: string[] };
  resolutions: { action: string; jobNo: string | null; quantity: number | null }[];
}

/**
 * Claims and reorder (B4.5, D-080, D-082, D-083, D-153): a customer claim within the window with product and
 * carton photos, factory review, decision, resolution through a re-production job and a credit request, the
 * completion hold; the window and undetermined liability; automatic claims from a tolerance breach; reorder
 * at today's price with the approved artwork carried over.
 */
describe('claims and reorder (e2e, B4.5)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let code: string;
  let owner: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    [code] = postcodes(ctx, 1) as [string];
    await seedShipping(ctx, fixture.factoryPublicId, [code]);
    await setFlag(ctx, 'payments.scb', true);
    owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 51);
  });

  afterAll(async () => {
    await setFlag(ctx, 'payments.scb', false);
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  const post = (token: string, path: string, body: Record<string, unknown> = {}) =>
    as(ctx, token).post(path, body).set('Idempotency-Key', randomUUID());
  const photo = (token: string, surface: 'store' | 'partner' = 'store') =>
    uploadBytes(ctx, token, Buffer.from(`photo ${randomUUID()}`), {
      purpose: 'evidence',
      fileName: 'photo.png',
      mimeType: 'image/png',
      surface,
    });

  /** A paid, produced, shipped and delivered order (production itself is covered by B4.2). */
  async function deliveredOrder(n: number, delivered = 1000) {
    const { token } = await customerToken(ctx, n);
    const prepress = await staffToken(ctx, 'prepress');
    const group = await placeOrder(ctx, token, fixture, code);
    const orderId = group.orders[0]!.id;
    await payDue(ctx, token, group.id);
    await approveArtwork(ctx, token, prepress, orderId);
    await ctx.pump();
    const job = await ctx.prisma.productionJob.findFirstOrThrow({ where: { order: { publicId: orderId } } });
    await post(owner, `/v1/partner/production-jobs/${job.publicId}/actions/accept`).expect(200);
    const at = new Date();
    await ctx.prisma.jobMilestone.updateMany({
      where: { jobId: job.id },
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
    await post(owner, `/v1/partner/shipments/${shipment.body.id as string}/actions/ready`).expect(200);
    await post(owner, `/v1/partner/shipments/${shipment.body.id as string}/proof-of-delivery`, {
      receiverName: 'ผู้รับ ทดสอบ',
      signatureFileId: await photo(owner, 'partner'),
      photoFileIds: [await photo(owner, 'partner')],
      items: [{ destinationId, deliveredQuantity: delivered }],
    }).expect(201);
    await ctx.pump();
    return { token, orderId, groupId: group.id, job, shipmentId: shipment.body.id as string };
  }

  it('takes a claim with photos through factory review, decision and a re-production; holds completion meanwhile', async () => {
    const o = await deliveredOrder(1);
    const claimBody = async (extra: Record<string, unknown> = {}) => ({
      type: 'damaged',
      description: 'กล่องบุบ สินค้าเสียหาย 120 ชิ้น',
      requestedResolution: 'reprint',
      shipmentId: o.shipmentId,
      claimedQuantity: 120,
      productPhotoFileIds: [await photo(o.token)],
      cartonPhotoFileIds: [await photo(o.token)],
      ...extra,
    });
    await post(
      o.token,
      `/v1/store/orders/${o.orderId}/claims`,
      await claimBody({ cartonPhotoFileIds: [] }),
    ).expect(422);
    const { token: stranger } = await customerToken(ctx, 2);
    await post(stranger, `/v1/store/orders/${o.orderId}/claims`, await claimBody()).expect(404);
    const submitted = (
      await post(o.token, `/v1/store/orders/${o.orderId}/claims`, await claimBody()).expect(201)
    ).body as Claim;
    expect(submitted).toMatchObject({ status: 'submitted', origin: 'customer' });
    expect(submitted.photos.product).toHaveLength(1);
    expect(submitted.photos.carton).toHaveLength(1);
    expect(submitted).not.toHaveProperty('liability');

    // D-081 + claims: an open claim holds the automatic completion.
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { publicId: o.orderId } });
    const delivery = ctx.app.get(DeliveryService);
    await delivery.autoComplete(new Date(order.deliveredAt!.getTime() + 8 * DAY));
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).completedAt).toBeNull();

    // The factory sees the claim only once Packio sends it.
    await as(ctx, owner).get(`/v1/partner/claims/${submitted.id}`).expect(404);
    const cs = await staffToken(ctx, 'cs');
    const adminRes = await as(ctx, cs).get(`/v1/admin/claims/${submitted.id}`).expect(200);
    const admin = adminRes.body as Claim;
    expect(admin).toMatchObject({ liabilityByRule: 'factory', liability: 'factory' });
    // U-B0.2: customer ref, the D-083 rule, the approved proof, ETag; list filters.
    expect(adminRes.headers['etag']).toEqual(expect.any(String));
    expect(adminRes.body).toMatchObject({
      customer: { id: expect.any(String), displayName: expect.any(String) },
      liabilityRule: expect.stringMatching(/^factory_/),
      decidedBy: null,
      liabilityOverriddenBy: null,
      approvedProof: {
        id: expect.any(String),
        versionNo: expect.any(Number),
        approvedFileId: expect.any(String),
      },
    });
    const listed = async (query: string) =>
      (
        (await as(ctx, cs).get(`/v1/admin/claims?${query}&perPage=100`).expect(200)).body.data as {
          id: string;
        }[]
      ).map((c) => c.id);
    expect(await listed(`origin=customer&type=${adminRes.body.type as string}`)).toContain(submitted.id);
    expect(await listed('origin=staff')).not.toContain(submitted.id);
    expect(await listed(`customerId=${adminRes.body.customer.id as string}`)).toContain(submitted.id);
    await post(cs, `/v1/admin/claims/${submitted.id}/actions/decide`, {
      decision: 'approved',
      note: 'ยังไม่ตรวจ',
    }).expect(409);
    await post(cs, `/v1/admin/claims/${submitted.id}/actions/review`).expect(200);
    await post(cs, `/v1/admin/claims/${submitted.id}/actions/request-info`, {
      note: 'โปรดส่งรูปฉลากกล่อง',
    }).expect(200);
    await post(o.token, `/v1/store/claims/${submitted.id}/info`, {
      response: 'แนบรูปแล้ว',
      photoFileIds: [await photo(o.token)],
    }).expect(200);
    await post(cs, `/v1/admin/claims/${submitted.id}/actions/send-to-factory`).expect(200);
    const forFactory = (await as(ctx, owner).get(`/v1/partner/claims/${submitted.id}`).expect(200))
      .body as Claim;
    await as(ctx, owner).get(`/v1/partner/files/${forFactory.photos.carton[0]}/download`).expect(200);
    const operator = await factoryToken(ctx, fixture.factoryPublicId, 'factory_operator', 52);
    // U-B0.3: the actions offered are the endpoints' own checks and the reader's permissions.
    expect(
      (forFactory as unknown as { nextActions: { key: string }[] }).nextActions.map((a) => a.key),
    ).toEqual(['claim.respond']);
    expect(
      (
        (
          await as(ctx, await factoryToken(ctx, fixture.factoryPublicId, 'factory_planner', 53))
            .get(`/v1/partner/claims/${submitted.id}`)
            .expect(200)
        ).body as {
          nextActions: unknown[];
        }
      ).nextActions,
    ).toEqual([]);
    expect(
      (
        (await as(ctx, cs).get(`/v1/admin/claims/${submitted.id}`).expect(200)).body as {
          nextActions: { key: string }[];
        }
      ).nextActions.map((a) => a.key),
    ).toEqual(['claim.review']);
    await post(operator, `/v1/partner/claims/${submitted.id}/actions/respond`, {
      response: 'accepted',
    }).expect(403);
    await post(owner, `/v1/partner/claims/${submitted.id}/actions/respond`, {
      response: 'accepted',
      evidenceFileIds: [await photo(o.token)],
    }).expect(422);
    const evidence = await photo(owner, 'partner');
    const responded = (
      await post(owner, `/v1/partner/claims/${submitted.id}/actions/respond`, {
        response: 'accepted',
        note: 'ยอมรับ',
        evidenceFileIds: [evidence],
      }).expect(200)
    ).body as Record<string, unknown>;
    // U-B0.3: the factory's response time and evidence, the shipment, what is recovered from it.
    expect(responded).toMatchObject({
      factoryRespondedAt: expect.any(String),
      factoryEvidenceFileIds: [evidence],
      deductionAmount: '0.00',
      deductions: [],
    });
    expect(responded['shipmentNo']).toEqual(expect.any(String));
    // A recovery recorded against the claim (fixture row: the B5 subscriber is covered by the payables suite).
    const claimRow = await ctx.prisma.claim.findUniqueOrThrow({
      where: { publicId: submitted.id },
      include: { factory: true },
    });
    await ctx.prisma.vendorDeduction.create({
      data: {
        entityId: claimRow.entityId,
        vendorId: claimRow.factory!.vendorId,
        factoryId: claimRow.factoryId,
        claimId: claimRow.id,
        amount: '100.00',
        offsetAgainst: 'receivable',
        status: 'pending',
      },
    });
    expect(
      (
        (await as(ctx, owner).get('/v1/partner/claims?perPage=100').expect(200)).body.data as { id: string }[]
      ).find((c) => c.id === submitted.id),
    ).toMatchObject({
      deductionAmount: '100.00',
      deductions: [
        expect.objectContaining({ amount: '100.00', status: 'pending', offsetAgainst: 'receivable' }),
      ],
    });
    const customerView = (await as(ctx, o.token).get(`/v1/store/claims/${submitted.id}`).expect(200))
      .body as Record<string, unknown>;
    expect(customerView['photos']).not.toHaveProperty('factory');
    expect(customerView).not.toHaveProperty('deductions');

    // Override needs its permission; CS decides; resolving needs `claims.resolve`.
    await post(cs, `/v1/admin/claims/${submitted.id}/actions/override-liability`, {
      liability: 'customer',
      reason: 'ทดสอบสิทธิ์การเปลี่ยนผู้รับผิดชอบ',
    }).expect(403);
    // D-261: approving needs the severity; the remedy defaults to what the customer asked (reprint).
    expect(
      (
        await post(cs, `/v1/admin/claims/${submitted.id}/actions/decide`, {
          decision: 'approved',
          note: 'ยืนยันความเสียหาย',
        }).expect(422)
      ).body.code,
    ).toBe('claims.severity_required');
    expect(
      (
        await post(cs, `/v1/admin/claims/${submitted.id}/actions/decide`, {
          decision: 'approved',
          note: 'ยืนยันความเสียหาย',
          severity: 'minor',
        }).expect(422)
      ).body.code,
    ).toBe('claims.remedy_not_allowed');
    const decided = await post(cs, `/v1/admin/claims/${submitted.id}/actions/decide`, {
      decision: 'approved',
      note: 'ยืนยันความเสียหาย',
      severity: 'major',
    }).expect(200);
    expect(decided.body.decidedBy).toMatchObject({ id: expect.any(String) });
    expect(decided.body).toMatchObject({ severity: 'major', remedy: 'reprint' });
    const lead = await staffToken(ctx, 'cs_lead');
    // A credit note does not fit a reprint (D-261); compensation beyond the matrix is goodwill (D-262).
    expect(
      (
        await post(lead, `/v1/admin/claims/${submitted.id}/actions/resolve`, {
          actions: [
            { action: 'reproduction_job', quantity: 120 },
            { action: 'credit_note', amount: '500.00', note: 'ส่วนลดชดเชยความล่าช้า' },
          ],
        }).expect(422)
      ).body.code,
    ).toBe('claims.action_not_allowed');
    const resolveBody = { actions: [{ action: 'reproduction_job', quantity: 120 }] };
    await post(cs, `/v1/admin/claims/${submitted.id}/actions/resolve`, resolveBody).expect(403);
    const resolved = (
      await post(lead, `/v1/admin/claims/${submitted.id}/actions/resolve`, resolveBody).expect(200)
    ).body as Claim;
    expect(resolved.status).toBe('resolved');
    const reproduction = await ctx.prisma.productionJob.findFirstOrThrow({
      where: { orderId: order.id, jobKind: 'reproduction' },
    });
    expect(reproduction).toMatchObject({
      quantityOrdered: 120,
      factoryId: o.job.factoryId,
      reproductionOfJobId: o.job.id,
    });
    expect(reproduction.buyPriceSnapshot).toMatchObject({ buyCostNet: '0.00' });
    expect(resolved.resolutions.find((r) => r.action === 'reproduction_job')).toMatchObject({
      jobNo: reproduction.jobNo,
    });
    expect(
      await ctx.prisma.domainEvent.count({
        where: { type: 'claim.credit_note_requested', aggregateId: submitted.id },
      }),
    ).toBe(0);
    const mine = (await as(ctx, o.token).get(`/v1/store/claims/${submitted.id}`).expect(200)).body as Claim;
    expect(mine.resolutions.every((r) => r.jobNo === null)).toBe(true);

    // D-155: the factory-liable claim counts in its scorecard.
    expect(await ctx.app.get(ProductionOversightService).factoryClaims(ctx.prisma, [o.job.id])).toBe(1);

    await post(cs, `/v1/admin/claims/${submitted.id}/actions/close`).expect(200);
    await delivery.autoComplete(new Date(order.deliveredAt!.getTime() + 8 * DAY));
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).completionMode).toBe(
      'auto_after_days',
    );

    // The claim is on the customer's timeline.
    const timeline = await as(ctx, o.token)
      .get(`/v1/store/orders/${o.orderId}/timeline?limit=100`)
      .expect(200);
    const types = (timeline.body.data as { type: string }[]).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['claim.submitted', 'claim.approved', 'claim.resolved']));
    expect(types).not.toContain('claim.sent_to_factory');
  });

  it('closes the window after 7 days, lets staff open a claim, and needs a liability to approve', async () => {
    const o = await deliveredOrder(3);
    const old = new Date(Date.now() - 8 * DAY);
    await ctx.prisma.order.update({ where: { publicId: o.orderId }, data: { deliveredAt: old } });
    await ctx.prisma.shipment.update({ where: { publicId: o.shipmentId }, data: { deliveredAt: old } });
    const body = {
      type: 'late',
      description: 'ได้รับสินค้าช้ากว่ากำหนด',
      requestedResolution: 'credit',
      productPhotoFileIds: [await photo(o.token)],
      cartonPhotoFileIds: [await photo(o.token)],
    };
    expect((await post(o.token, `/v1/store/orders/${o.orderId}/claims`, body).expect(409)).body.code).toBe(
      'claims.window_closed',
    );
    const cs = await staffToken(ctx, 'cs');
    const opened = (
      await post(cs, `/v1/admin/orders/${o.orderId}/claims`, {
        ...body,
        productPhotoFileIds: undefined,
        cartonPhotoFileIds: undefined,
      }).expect(201)
    ).body as Claim;
    expect(opened).toMatchObject({
      origin: 'staff',
      liability: 'undetermined',
      liabilityByRule: 'undetermined',
    });
    await post(cs, `/v1/admin/claims/${opened.id}/actions/review`).expect(200);
    expect(
      (
        await post(cs, `/v1/admin/claims/${opened.id}/actions/decide`, {
          decision: 'approved',
          note: 'อนุมัติทดสอบ',
        }).expect(409)
      ).body.code,
    ).toBe('claims.liability_undetermined');
    const lead = await staffToken(ctx, 'cs_lead');
    const overridden = await post(lead, `/v1/admin/claims/${opened.id}/actions/override-liability`, {
      liability: 'packio',
      reason: 'Packio นัดส่งผิดวัน (ทดสอบ)',
    }).expect(200);
    expect(overridden.body).toMatchObject({
      liability: 'packio',
      liabilityByRule: 'undetermined',
      liabilityRule: 'staff_decides',
      liabilityOverriddenBy: { id: expect.any(String) },
    });
    // D-199: no late-delivery guarantee at launch — no remedy to approve it with (goodwill needs a memo, D-262).
    expect(
      (
        await post(cs, `/v1/admin/claims/${opened.id}/actions/decide`, {
          decision: 'approved',
          note: 'ยอมรับ',
          severity: 'major',
        }).expect(422)
      ).body.code,
    ).toBe('claims.remedy_not_allowed');
    expect(
      (
        await post(cs, `/v1/admin/claims/${opened.id}/actions/decide`, {
          decision: 'approved',
          note: 'ยอมรับ',
          severity: 'major',
          remedy: 'goodwill',
        }).expect(409)
      ).body.code,
    ).toBe('discount_memos.not_usable');
    await post(cs, `/v1/admin/claims/${opened.id}/actions/decide`, {
      decision: 'rejected',
      note: 'ไม่มีการรับประกันการส่งล่าช้า (D-199)',
    }).expect(200);
  });

  it('opens a claim by itself when the delivery is outside the tolerance (D-080)', async () => {
    const o = await deliveredOrder(4, 800);
    const rec = await ctx.prisma.deliveryReconciliation.findFirstOrThrow({
      where: { order: { publicId: o.orderId } },
      include: { claim: true },
    });
    expect(rec.outcome).toBe('shortage_outside');
    expect(rec.claim).toMatchObject({
      origin: 'tolerance_auto',
      type: 'quantity_short',
      claimedQuantity: 200,
      liability: 'factory',
      status: 'submitted',
    });
  });

  it('reorders at today’s price with the approved artwork carried over (D-153)', async () => {
    const o = await deliveredOrder(5);
    const original = await ctx.prisma.order.findUniqueOrThrow({
      where: { publicId: o.orderId },
      include: { proofs: { where: { status: 'approved' } } },
    });
    const { token: stranger } = await customerToken(ctx, 6);
    await post(stranger, `/v1/store/orders/${o.orderId}/actions/reorder`, { quantity: 2000 }).expect(404);
    const cart = await post(o.token, `/v1/store/orders/${o.orderId}/actions/reorder`, {
      quantity: 2000,
    }).expect(201);
    const item = (
      cart.body.items as {
        quoteId: string;
        quantity: number;
        reorderOf: { orderId: string } | null;
        reusesApprovedArtwork: boolean;
      }[]
    ).find((i) => i.reorderOf?.orderId === o.orderId)!;
    expect(item).toMatchObject({ quantity: 2000, reusesApprovedArtwork: true });
    expect(item.quoteId).not.toBe(
      (await ctx.prisma.quote.findUniqueOrThrow({ where: { id: original.quoteId } })).publicId,
    );

    const group = (await post(o.token, '/v1/store/checkout').expect(201)).body as {
      id: string;
      orders: { id: string }[];
    };
    const reorderId = group.orders[0]!.id;
    await payDue(ctx, o.token, group.id);
    await ctx.pump();
    const reordered = await ctx.prisma.order.findUniqueOrThrow({
      where: { publicId: reorderId },
      include: { proofs: true, productionJobs: true },
    });
    expect(reordered).toMatchObject({
      reorderOfOrderId: original.id,
      artworkStatus: 'approved',
      quantityOrdered: 2000,
    });
    expect(reordered.artworkApprovedAt).not.toBeNull();
    expect(reordered.proofs).toHaveLength(1);
    expect(reordered.proofs[0]).toMatchObject({
      status: 'approved',
      reusedFromProofId: original.proofs[0]!.id,
      approvedFileId: original.proofs[0]!.approvedFileId,
    });
    // Paid and approved → production starts without a new proof.
    expect(reordered.productionJobs).toHaveLength(1);
  });
});
