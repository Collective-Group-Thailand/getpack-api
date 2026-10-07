import { randomUUID } from 'node:crypto';

import { DeliveryService } from '@modules/logistics/delivery.service';
import { ProductionService } from '@modules/production/production.service';

import { SETTINGS } from '../../prisma/seed/data/settings';
import { type DevFolding } from '../../prisma/seed/dev-folding';
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

const SAMPLING = SETTINGS.find((s) => s.key === 'qc.inspection_sampling')!.value as Record<string, unknown>;
const DAY = 86_400_000;

interface Milestone {
  id: string;
  key: string;
  seq: number;
  evidence: 'none' | 'photo' | 'qc_form' | 'photo_and_qc_form';
  tracksQuantity: boolean;
  status: string;
}

/**
 * B4 quality flow (prompt "Quality"): a paid and approved order releases its job automatically → the factory
 * accepts → milestones with photos (idempotent updates) → QC passes and the sampled Packio inspection passes →
 * two shipments to two addresses with POD → a shortage within tolerance raises the credit event → the order
 * completes 7 days later (time travel) → a claim with photos → the factory is liable → a re-production job.
 * Plus: a missed acceptance with a single capable factory escalates (never reassigns), and another factory
 * sees none of it (IDOR).
 */
describe('fulfilment from payment to re-production (e2e, B4 quality)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let codes: [string, string];

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    codes = postcodes(ctx, 2) as [string, string];
    await seedShipping(ctx, fixture.factoryPublicId, codes);
    await setFlag(ctx, 'payments.scb', true);
    // Every order value is sampled for a Packio inspection in this suite.
    await setSetting(ctx, 'qc.inspection_sampling', { ...SAMPLING, fullInspectionFromValue: '1.00' });
  });

  afterAll(async () => {
    await setSetting(ctx, 'qc.inspection_sampling', SAMPLING);
    await setFlag(ctx, 'payments.scb', false);
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  const post = (token: string, path: string, body: Record<string, unknown> = {}) =>
    as(ctx, token).post(path, body).set('Idempotency-Key', randomUUID());
  const photo = (token: string, surface: 'store' | 'partner') =>
    uploadBytes(ctx, token, Buffer.from(`photo ${randomUUID()}`), {
      purpose: 'evidence',
      fileName: 'photo.png',
      mimeType: 'image/png',
      surface,
    });

  async function paidAndApproved(n: number) {
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
    const group = (await post(token, '/v1/store/checkout').expect(201)).body as {
      id: string;
      orders: { id: string }[];
    };
    const orderId = group.orders[0]!.id;
    await payDue(ctx, token, group.id);
    await approveArtwork(ctx, token, prepress, orderId);
    await ctx.pump();
    return { token, orderId };
  }

  it('runs the whole chain from an automatic release to a re-production for a claim', async () => {
    const owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 71);
    const operator = await factoryToken(ctx, fixture.factoryPublicId, 'factory_operator', 72);
    const qc = await factoryToken(ctx, fixture.factoryPublicId, 'factory_qc', 73);
    const { token, orderId } = await paidAndApproved(1);

    // Paid + approved → the job is released automatically (D-073) and sampled for inspection (D-076).
    const released = await ctx.prisma.productionJob.findFirstOrThrow({
      where: { order: { publicId: orderId } },
    });
    expect(released).toMatchObject({ status: 'released', releaseMode: 'auto', inspectionRequired: true });
    await post(owner, `/v1/partner/production-jobs/${released.publicId}/actions/accept`).expect(200);

    // Milestones along the route with photos, QC and quantities; a replayed update changes nothing.
    const detail = await as(ctx, owner).get(`/v1/partner/production-jobs/${released.publicId}`).expect(200);
    const milestones = (detail.body.milestones as Milestone[]).sort((x, y) => x.seq - y.seq);
    const quantity = 1000;
    for (const m of milestones) {
      const url = `/v1/partner/production-jobs/${released.publicId}/milestones/${m.id}`;
      const ref = randomUUID();
      const start = { action: 'start', clientRef: ref, ...(m.tracksQuantity && { quantityIn: quantity }) };
      await post(operator, url, start).expect(200);
      expect((await post(operator, url, start).expect(200)).body).toMatchObject({
        applied: false,
        reason: 'duplicate',
      });
      const shot = m.evidence.includes('photo') ? [await photo(operator, 'partner')] : [];
      if (m.evidence.includes('qc_form'))
        await post(qc, `/v1/partner/production-jobs/${released.publicId}/qc-checks`, {
          checklistVersion: 'folding-v1',
          checklist: { colour: 'ok' },
          result: 'pass',
          quantityChecked: 80,
          photoFileIds: shot.length ? shot : [await photo(qc, 'partner')],
        }).expect(201);
      await post(operator, url, {
        action: 'complete',
        clientRef: randomUUID(),
        ...(m.tracksQuantity && { quantityOut: quantity, quantityScrap: 0 }),
        ...(shot.length && { photoFileIds: shot, shareWithCustomer: true }),
      }).expect(200);
    }
    const job = await ctx.prisma.productionJob.findUniqueOrThrow({ where: { id: released.id } });
    expect(job).toMatchObject({ status: 'completed', quantityGood: 1000 });

    // The shipping gate needs the Packio inspection: it passes.
    const destinations = detail.body.destinations as { id: string; quantity: number }[];
    const [d1, d2] = [
      destinations.find((d) => d.quantity === 600)!,
      destinations.find((d) => d.quantity === 400)!,
    ];
    const ship = async (destinationId: string, q: number) =>
      (
        await post(owner, '/v1/partner/shipments', {
          items: [{ jobId: job.publicId, destinationId, quantity: q }],
          cartonsCount: 1,
          weightG: 6000,
        }).expect(201)
      ).body.id as string;
    const s1 = await ship(d1.id, 600);
    await post(owner, `/v1/partner/shipments/${s1}/actions/ready`).expect(200);
    expect((await post(owner, `/v1/partner/shipments/${s1}/actions/dispatch`).expect(409)).body.code).toBe(
      'shipments.inspection_pending',
    );
    const inspection = await ctx.prisma.inspection.findFirstOrThrow({ where: { jobId: job.id } });
    await as(ctx, await staffToken(ctx, 'partner_manager'))
      .post(`/v1/admin/inspections/${inspection.publicId}/actions/record`, {
        foundCritical: 0,
        foundMajor: 0,
        foundMinor: 0,
      })
      .expect(200);
    await post(owner, `/v1/partner/shipments/${s1}/actions/dispatch`).expect(200);

    // Two shipments to two addresses with POD; 390 of 400 arrive at the second (shortage 1 % ≤ tolerance).
    const pod = async (shipmentId: string, destinationId: string, delivered: number) =>
      post(owner, `/v1/partner/shipments/${shipmentId}/proof-of-delivery`, {
        receiverName: 'ผู้รับ ทดสอบ',
        signatureFileId: await photo(owner, 'partner'),
        photoFileIds: [await photo(owner, 'partner')],
        items: [{ destinationId, deliveredQuantity: delivered }],
      }).expect(201);
    await pod(s1, d1.id, 600);
    const s2 = await ship(d2.id, 400);
    await post(owner, `/v1/partner/shipments/${s2}/actions/ready`).expect(200);
    await pod(s2, d2.id, 390);
    await ctx.pump();
    const order = await ctx.prisma.order.findUniqueOrThrow({
      where: { publicId: orderId },
      include: { deliveryReconciliation: true },
    });
    expect(order.deliveryReconciliation).toMatchObject({
      outcome: 'shortage_within',
      deliveredQuantity: 990,
    });
    const credit = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: { type: 'delivery.reconciled', aggregateId: orderId },
    });
    expect((credit.payload as { credit: { gross: string } | null }).credit?.gross).toEqual(
      expect.any(String),
    );

    // D-081: completed 7 days after delivery (time travel).
    await ctx.app
      .get(DeliveryService)
      .autoComplete(new Date(order.deliveredAt!.getTime() + 7 * DAY + 60_000));
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('completed');

    // A claim with photos inside the window → factory liable → re-production job for the same factory.
    const claim = (
      await post(token, `/v1/store/orders/${orderId}/claims`, {
        type: 'print_defect',
        description: 'สีเพี้ยนจากแบบตัวอย่าง 100 ชิ้น',
        requestedResolution: 'reprint',
        shipmentId: s1,
        claimedQuantity: 100,
        productPhotoFileIds: [await photo(token, 'store')],
        cartonPhotoFileIds: [await photo(token, 'store')],
      }).expect(201)
    ).body as { id: string };
    const cs = await staffToken(ctx, 'cs');
    const lead = await staffToken(ctx, 'cs_lead');
    await post(cs, `/v1/admin/claims/${claim.id}/actions/review`).expect(200);
    const decided = await post(cs, `/v1/admin/claims/${claim.id}/actions/decide`, {
      decision: 'approved',
      severity: 'major',
      note: 'สีไม่ตรงแบบตัวอย่าง',
    }).expect(200);
    expect(decided.body).toMatchObject({ liability: 'factory', liabilityByRule: 'factory' });
    await post(lead, `/v1/admin/claims/${claim.id}/actions/resolve`, {
      actions: [{ action: 'reproduction_job', quantity: 100 }],
    }).expect(200);
    const reproduction = await ctx.prisma.productionJob.findFirstOrThrow({
      where: { orderId: order.id, jobKind: 'reproduction' },
    });
    expect(reproduction).toMatchObject({
      factoryId: job.factoryId,
      quantityOrdered: 100,
      status: 'released',
    });

    // IDOR: another factory sees none of it.
    const vendorTax = `07${String(ctx.run).padStart(11, '0').slice(-11)}`;
    const vendor = await ctx.prisma.vendor.create({
      data: {
        kind: 'factory',
        legalName: `[E2E] โรงงานอื่น ${ctx.run}`,
        juristicType: 'company',
        taxId: vendorTax,
      },
    });
    const other = await ctx.prisma.factory.create({
      data: {
        code: `Q${ctx.run}`,
        vendorId: vendor.id,
        legalName: vendor.legalName,
        juristicType: 'company',
        taxId: vendorTax,
      },
    });
    const stranger = await factoryToken(ctx, other.publicId, 'factory_owner', 74);
    await as(ctx, stranger).get(`/v1/partner/production-jobs/${job.publicId}`).expect(404);
    await as(ctx, stranger).get(`/v1/partner/shipments/${s1}`).expect(404);
    await as(ctx, stranger).get(`/v1/partner/claims/${claim.id}`).expect(404);
    await post(stranger, `/v1/partner/production-jobs/${reproduction.publicId}/actions/accept`).expect(404);
  });

  it('escalates a missed acceptance when no other factory can take the job (no automatic reassignment)', async () => {
    const { orderId } = await paidAndApproved(2);
    const job = await ctx.prisma.productionJob.findFirstOrThrow({ where: { order: { publicId: orderId } } });
    await ctx.app.get(ProductionService).acceptanceOverdue(new Date(job.acceptDueAt.getTime() + 60_000));
    const after = await ctx.prisma.productionJob.findUniqueOrThrow({
      where: { id: job.id },
      include: { assignments: { orderBy: { decidedAt: 'asc' } } },
    });
    expect(after.escalatedAt).not.toBeNull();
    expect(after.factoryId).toBe(job.factoryId);
    expect(after.assignments.at(-1)).toMatchObject({ mode: 'escalated', toFactoryId: null });
  });
});
