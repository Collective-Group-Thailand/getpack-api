import { randomUUID } from 'node:crypto';

import { ProductionService } from '@modules/production/production.service';

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
} from '../support/fulfilment-e2e';

interface Job {
  id: string;
  status: string;
  releaseMode: string;
  escalatedAt: string | null;
  milestones: { key: string; status: string; dueAt: string | null }[];
  assignments: { mode: string; reason: string; toFactoryId: string | null }[];
}

/**
 * Production release and acceptance (B4.2, D-073, D-074, D-012, D-101): paid + approved → the job is released
 * to the factory with its milestones; the factory accepts (capacity booked) or rejects; with one factory a
 * rejection or a missed acceptance deadline escalates instead of moving the job; CS starts production as an
 * exception only after payment; factories never see another factory's jobs.
 */
describe('production release and acceptance (e2e, B4.2)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let code: string;
  let owner: string;
  let prepress: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    [code] = postcodes(ctx, 1) as [string];
    await seedShipping(ctx, fixture.factoryPublicId, [code]);
    await setFlag(ctx, 'payments.scb', true);
    owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 1);
    prepress = await staffToken(ctx, 'prepress');
  });

  afterAll(async () => {
    await setFlag(ctx, 'payments.scb', false);
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  const jobOf = async (token: string, orderId: string): Promise<Job | undefined> =>
    (
      (await as(ctx, token).get(`/v1/admin/production-jobs?orderId=${orderId}&perPage=100`).expect(200)).body
        .data as Job[]
    )[0];

  async function releasedOrder(n: number) {
    const { token } = await customerToken(ctx, n);
    const group = await placeOrder(ctx, token, fixture, code);
    const orderId = group.orders[0]!.id;
    await payDue(ctx, token, group.id);
    await approveArtwork(ctx, token, prepress, orderId);
    await ctx.pump();
    return { token, orderId };
  }

  it('releases the job once paid and approved, and the factory accepts it with its load booked', async () => {
    const { token } = await customerToken(ctx, 1);
    const cs = await staffToken(ctx, 'cs');
    const group = await placeOrder(ctx, token, fixture, code);
    const orderId = group.orders[0]!.id;
    await payDue(ctx, token, group.id);
    await ctx.pump();
    expect(await jobOf(cs, orderId)).toBeUndefined();
    const blocked = await ctx.prisma.activityLog.findFirst({
      where: { aggregatePublicId: orderId, action: 'production.release_blocked' },
    });
    expect(blocked?.data).toMatchObject({ reason: 'artwork_not_approved' });

    await approveArtwork(ctx, token, prepress, orderId);
    await ctx.pump();
    const job = await jobOf(cs, orderId);
    expect(job).toMatchObject({
      status: 'released',
      releaseMode: 'auto',
      assignments: [{ reason: 'initial', mode: 'auto' }],
    });
    expect(job!.milestones.map((m) => m.key)).toEqual([
      'job_received',
      'prepress_ready',
      'materials_ready',
      'printing',
      'finishing',
      'die_cut',
      'gluing',
      'qc',
      'packing',
      'ready_to_ship',
    ]);
    expect(job!.milestones.every((m) => m.status === 'pending' && m.dueAt !== null)).toBe(true);
    expect((await as(ctx, token).get(`/v1/store/orders/${orderId}`).expect(200)).body.status).toBe(
      'in_production',
    );
    expect(
      await ctx.prisma.domainEvent.count({ where: { type: 'production.queued', aggregateId: orderId } }),
    ).toBe(1);

    // The factory sees it (spec, approved artwork, destination by code) and accepts within the SLA.
    const seen = await as(ctx, owner).get(`/v1/partner/production-jobs/${job!.id}`).expect(200);
    expect(seen.body).toMatchObject({
      status: 'released',
      destinations: [{ code: 'D1', postcodePrefix: expect.stringMatching(/^\d{3}$/) }],
    });
    // P4-01 / P4-D1: never the getpack customer's name, phone or address.
    for (const field of ['recipientName', 'phone', 'line1', 'line2', 'postcode'])
      expect(seen.body.destinations[0]).not.toHaveProperty(field);
    expect(seen.body.approvedFileId).not.toBeNull();
    expect(seen.body).not.toHaveProperty('buyCostNet');
    await as(ctx, owner)
      .get(`/v1/partner/files/${seen.body.approvedFileId as string}/download`)
      .expect(200);
    // D-444: the factory's download of the approved proof copy is in the customer file access log (partner surface).
    const downloaded = await ctx.prisma.customerFileAccessLog.findMany({
      where: { fileObject: { publicId: seen.body.approvedFileId as string }, channel: 'partner' },
    });
    expect(downloaded).toEqual([
      expect.objectContaining({ fileKind: 'approved_proof_copy', purpose: 'download', actorType: 'user' }),
    ]);
    await as(ctx, owner).post(`/v1/partner/production-jobs/${job!.id}/actions/accept`).expect(400);
    const accepted = await as(ctx, owner)
      .post(`/v1/partner/production-jobs/${job!.id}/actions/accept`)
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    expect(accepted.body.status).toBe('accepted');
    const row = await ctx.prisma.productionJob.findUniqueOrThrow({ where: { publicId: job!.id } });
    expect(await ctx.prisma.capacityBooking.count({ where: { productionJobId: row.id } })).toBe(1);
    await as(ctx, owner)
      .post(`/v1/partner/production-jobs/${job!.id}/actions/accept`)
      .set('Idempotency-Key', randomUUID())
      .expect(409);

    // Another factory's user sees nothing of it (IDOR).
    const vendor = await ctx.prisma.vendor.create({
      data: {
        kind: 'factory',
        legalName: `[E2E] โรงงานอื่น ${ctx.run}`,
        juristicType: 'company',
        taxId: `09${String(ctx.run).padStart(11, '0').slice(-11)}`,
      },
    });
    const otherFactory = await ctx.prisma.factory.create({
      data: {
        code: `E${ctx.run}`,
        vendorId: vendor.id,
        legalName: vendor.legalName,
        juristicType: 'company',
        taxId: vendor.taxId,
      },
    });
    const stranger = await factoryToken(ctx, otherFactory.publicId, 'factory_owner', 2);
    await as(ctx, stranger).get(`/v1/partner/production-jobs/${job!.id}`).expect(404);
    await as(ctx, stranger)
      .post(`/v1/partner/production-jobs/${job!.id}/actions/reject`, { reasonCode: 'capacity' })
      .set('Idempotency-Key', randomUUID())
      .expect(404);
    expect(
      ((await as(ctx, stranger).get('/v1/partner/production-jobs').expect(200)).body.data as unknown[])
        .length,
    ).toBe(0);
  });

  it('escalates a rejection and a missed acceptance deadline when no other factory can take the job', async () => {
    const cs = await staffToken(ctx, 'cs_lead');
    const first = await releasedOrder(2);
    const job = (await jobOf(cs, first.orderId))!;
    const rejected = await as(ctx, owner)
      .post(`/v1/partner/production-jobs/${job.id}/actions/reject`, {
        reasonCode: 'capacity',
        note: 'คิวเต็ม',
      })
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    expect(rejected.body.status).toBe('rejected');
    const afterReject = await as(ctx, cs).get(`/v1/admin/production-jobs/${job.id}`).expect(200);
    expect(afterReject.body.escalatedAt).not.toBeNull();
    expect((afterReject.body as Job).assignments.at(-1)).toMatchObject({
      mode: 'escalated',
      reason: 'rejected',
      toFactoryId: null,
    });
    expect(
      (
        (await as(ctx, cs).get(`/v1/admin/production-jobs?orderId=${first.orderId}`).expect(200)).body
          .data as unknown[]
      ).length,
    ).toBe(1);
    const escalated = await as(ctx, cs)
      .get('/v1/admin/production-jobs?queue=escalated&perPage=100')
      .expect(200);
    expect((escalated.body.data as Job[]).some((j) => j.id === job.id)).toBe(true);

    const second = await releasedOrder(3);
    const late = (await jobOf(cs, second.orderId))!;
    await ctx.prisma.productionJob.update({
      where: { publicId: late.id },
      data: { acceptDueAt: new Date(Date.now() - 60_000) },
    });
    await ctx.app.get(ProductionService).acceptanceOverdue();
    const overdue = await as(ctx, cs).get(`/v1/admin/production-jobs/${late.id}`).expect(200);
    expect(overdue.body).toMatchObject({ status: 'released' });
    expect(overdue.body.escalatedAt).not.toBeNull();
    expect((overdue.body as Job).assignments.at(-1)).toMatchObject({
      mode: 'escalated',
      reason: 'acceptance_overdue',
    });
    await ctx.app.get(ProductionService).acceptanceOverdue();
    expect(
      await ctx.prisma.domainEvent.count({
        where: { type: 'production_job.acceptance_overdue', aggregateId: late.id },
      }),
    ).toBe(1);
  });

  it('lets CS start production as an audited exception after payment, never before', async () => {
    const cs = await staffToken(ctx, 'cs');
    const { token } = await customerToken(ctx, 4);
    const unpaid = await placeOrder(ctx, token, fixture, code);
    const refused = await as(ctx, cs)
      .post(`/v1/admin/orders/${unpaid.orders[0]!.id}/actions/start-production`, {
        reason: 'ลูกค้าขอเร่งงานด่วนมาก',
      })
      .expect(409);
    expect(refused.body.code).toBe('production.gate_closed');

    await payDue(ctx, token, unpaid.id);
    await ctx.pump();
    const started = await as(ctx, cs)
      .post(`/v1/admin/orders/${unpaid.orders[0]!.id}/actions/start-production`, {
        reason: 'ลูกค้าขอเร่งงานด่วนมาก',
      })
      .expect(200);
    expect(started.body).toMatchObject({
      status: 'released',
      releaseMode: 'manual_exception',
      releaseReason: 'ลูกค้าขอเร่งงานด่วนมาก',
    });
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'production.manual_start', resourcePublicId: started.body.id as string },
      }),
    ).toBe(1);
    await as(ctx, cs)
      .post(`/v1/admin/orders/${unpaid.orders[0]!.id}/actions/start-production`, {
        reason: 'ลูกค้าขอเร่งงานด่วนมาก',
      })
      .expect(409);
    const prepressOnly = await staffToken(ctx, 'prepress');
    await as(ctx, prepressOnly)
      .post(`/v1/admin/orders/${unpaid.orders[0]!.id}/actions/start-production`, {
        reason: 'ลูกค้าขอเร่งงานด่วนมาก',
      })
      .expect(403);
  });
});
