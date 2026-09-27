import { PreflightService } from '@modules/artwork/preflight/preflight.service';

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
  setSetting,
  staffToken,
} from '../support/commerce-e2e';
import { makePdf, uploadPdf } from '../support/fulfilment-e2e';

/**
 * Artwork submissions and preflight (B4.1, D-070, ADR-0009): the customer uploads a PDF; against the
 * dieline template sent to them, a wrong size blocks; Prepress cannot accept it, rejects it with a reason;
 * the corrected version passes and is accepted for a proof. Queue with SLA; file access by the owning row.
 */
describe('artwork submissions and preflight (e2e, B4.1)', () => {
  let ctx: CommerceApp;
  let fixture: DevFolding;
  let code: string;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    fixture = await foldingReady(ctx);
    [code] = postcodes(ctx, 1) as [string];
    await seedShipping(ctx, fixture.factoryPublicId, [code]);
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  const preflight = () => ctx.app.get(PreflightService).runDue();

  it('blocks a wrong size against the template, rejects, then accepts the corrected version', async () => {
    const { token } = await customerToken(ctx, 1);
    const other = await customerToken(ctx, 2);
    const prepress = await staffToken(ctx, 'prepress');
    const cs = await staffToken(ctx, 'cs');
    const group = await placeOrder(ctx, token, fixture, code);
    const orderId = group.orders[0]!.id;
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { publicId: orderId } });

    // A first version before any template: size and bleed are not evaluated, RGB warns.
    const v1File = await uploadPdf(
      ctx,
      token,
      await makePdf({ widthMm: 100, heightMm: 100, rgbPaint: true }),
    );
    const v1 = await as(ctx, token)
      .post(`/v1/store/orders/${orderId}/artwork-submissions`, {
        files: [{ fileId: v1File }],
        note: 'ฉบับแรก',
      })
      .expect(201);
    expect(v1.body).toMatchObject({
      versionNo: 1,
      status: 'submitted',
      preflightStatus: 'pending',
      channel: 'web',
    });
    expect(await preflight()).toBeGreaterThanOrEqual(1);
    const v1Read = await as(ctx, token)
      .get(`/v1/store/orders/${orderId}/artwork-submissions/${v1.body.id as string}`)
      .expect(200);
    expect(v1Read.body.preflightStatus).toBe('passed_with_warnings');
    const checks = v1Read.body.preflightReport.files[0].checks as { check: string; outcome: string }[];
    expect(checks.find((c) => c.check === 'size_mismatch')?.outcome).toBe('not_evaluated');
    expect(checks.find((c) => c.check === 'rgb_colour')?.outcome).toBe('fail');
    expect((await as(ctx, token).get(`/v1/store/orders/${orderId}`).expect(200)).body.artworkStatus).toBe(
      'uploaded',
    );

    // Prepress sent a 100 × 100 mm template (the drawing endpoints arrive later in B4.1: fixture row).
    const template = await uploadPdf(
      ctx,
      prepress,
      await makePdf({ widthMm: 106, heightMm: 106, bleedMm: 3 }),
      'proof',
      'admin',
    );
    const prepressUser = await ctx.prisma.user.findFirstOrThrow({
      where: { email: 'prepress@example.invalid' },
    });
    await ctx.prisma.dielineDelivery.create({
      data: {
        orderId: order.id,
        fileObjectId: (await ctx.prisma.fileObject.findUniqueOrThrow({ where: { publicId: template } })).id,
        trigger: 'manual',
        sentById: prepressUser.id,
      },
    });
    // The customer reads the template through its owning order; another customer cannot.
    await as(ctx, token).get(`/v1/store/files/${template}/download`).expect(200);
    await as(ctx, other.token).get(`/v1/store/files/${template}/download`).expect(404);

    // Version 2: 90 × 100 mm → blocked (size mismatch, no bleed).
    const v2File = await uploadPdf(ctx, token, await makePdf({ widthMm: 90, heightMm: 100 }));
    const v2 = await as(ctx, token)
      .post(`/v1/store/orders/${orderId}/artwork-submissions`, { files: [{ fileId: v2File }] })
      .expect(201);
    await preflight();
    const v2Read = await as(ctx, prepress)
      .get(`/v1/admin/artwork-submissions/${v2.body.id as string}`)
      .expect(200);
    expect(v2Read.body).toMatchObject({
      versionNo: 2,
      preflightStatus: 'blocked',
      preflightReport: { expectedSize: { widthMm: 100, heightMm: 100 } },
    });
    expect(v2Read.body.preflightReport.blockCount).toBeGreaterThanOrEqual(1);
    const listed = await as(ctx, token).get(`/v1/store/orders/${orderId}/artwork-submissions`).expect(200);
    expect(
      (listed.body as { versionNo: number; status: string }[]).map((s) => [s.versionNo, s.status]),
    ).toEqual([
      [2, 'submitted'],
      [1, 'superseded'],
    ]);
    expect(
      await ctx.prisma.preflightFinding.count({
        where: { submission: { publicId: v2.body.id as string }, severity: 'block' },
      }),
    ).toBeGreaterThan(0);

    // The queue shows it with no due time until an SLA is set.
    const queue = await as(ctx, prepress)
      .get('/v1/admin/prepress/queue?kind=submissions&perPage=100')
      .expect(200);
    const item = (queue.body.data as { itemId: string; dueAt: string | null }[]).find(
      (i) => i.itemId === v2.body.id,
    );
    expect(item).toMatchObject({ dueAt: null });

    // Blocked → cannot be accepted; CS may not review; Prepress rejects with a reason.
    await as(ctx, prepress)
      .post(`/v1/admin/artwork-submissions/${v2.body.id as string}/actions/accept`)
      .expect(409);
    await as(ctx, cs)
      .post(`/v1/admin/artwork-submissions/${v2.body.id as string}/actions/reject`, { reason: 'ขนาดไม่ตรง' })
      .expect(403);
    const rejected = await as(ctx, prepress)
      .post(`/v1/admin/artwork-submissions/${v2.body.id as string}/actions/reject`, {
        reason: 'ขนาดไม่ตรงกับแบบแปลน กรุณาจัดหน้าใหม่',
      })
      .expect(200);
    expect(rejected.body).toMatchObject({
      status: 'rejected',
      rejectReason: 'ขนาดไม่ตรงกับแบบแปลน กรุณาจัดหน้าใหม่',
    });
    expect((await as(ctx, token).get(`/v1/store/orders/${orderId}`).expect(200)).body.artworkStatus).toBe(
      'changes_requested',
    );

    // Version 3 by CS on behalf: 106 × 106 with a 100 mm trim and 3 mm bleed passes; accepted for a proof.
    const v3File = await uploadPdf(
      ctx,
      cs,
      await makePdf({ widthMm: 106, heightMm: 106, bleedMm: 3 }),
      'artwork',
      'admin',
    );
    const v3 = await as(ctx, cs)
      .post(`/v1/admin/orders/${orderId}/artwork-submissions`, { files: [{ fileId: v3File }] })
      .expect(201);
    expect(v3.body).toMatchObject({ versionNo: 3, channel: 'cs' });
    await as(ctx, prepress)
      .post(`/v1/admin/artwork-submissions/${v3.body.id as string}/actions/accept`)
      .expect(409); // still pending
    await preflight();
    await setSetting(ctx, 'artwork.prepress_sla_business_hours', 4);
    const due = await as(ctx, prepress)
      .get('/v1/admin/prepress/queue?kind=submissions&perPage=100')
      .expect(200);
    expect(
      (due.body.data as { itemId: string; dueAt: string | null }[]).find((i) => i.itemId === v3.body.id)
        ?.dueAt,
    ).not.toBeNull();
    const accepted = await as(ctx, prepress)
      .post(`/v1/admin/artwork-submissions/${v3.body.id as string}/actions/accept`)
      .expect(200);
    expect(accepted.body).toMatchObject({ status: 'accepted_for_proof', preflightStatus: 'passed' });
    expect((await as(ctx, token).get(`/v1/store/orders/${orderId}`).expect(200)).body.artworkStatus).toBe(
      'in_review',
    );

    // Another customer's order is invisible; events and customer-visible activity were recorded.
    await as(ctx, other.token).get(`/v1/store/orders/${orderId}/artwork-submissions`).expect(404);
    const types = (
      await ctx.prisma.domainEvent.findMany({
        where: { aggregateId: orderId, type: { startsWith: 'artwork.' } },
      })
    ).map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'artwork.submitted',
        'artwork.preflight_completed',
        'artwork.rejected',
        'artwork.accepted_for_proof',
      ]),
    );
  });

  it('refuses files the customer does not own and orders that no longer take artwork', async () => {
    const { token } = await customerToken(ctx, 3);
    const other = await customerToken(ctx, 4);
    const group = await placeOrder(ctx, token, fixture, code);
    const orderId = group.orders[0]!.id;
    const foreign = await uploadPdf(ctx, other.token, await makePdf({ widthMm: 100, heightMm: 100 }));
    await as(ctx, token)
      .post(`/v1/store/orders/${orderId}/artwork-submissions`, { files: [{ fileId: foreign }] })
      .expect(422);
    await as(ctx, token).post(`/v1/store/orders/${orderId}/artwork-submissions`, {}).expect(422);
    await as(ctx, token)
      .post(`/v1/store/orders/${orderId}/artwork-submissions`, {
        links: ['http://insecure.example.invalid/x'],
      })
      .expect(422);
    await as(ctx, token)
      .post(`/v1/store/order-groups/${group.id}/actions/cancel`, { reasonCode: 'customer_request' })
      .expect(200);
    const mine = await uploadPdf(ctx, token, await makePdf({ widthMm: 100, heightMm: 100 }));
    const refused = await as(ctx, token)
      .post(`/v1/store/orders/${orderId}/artwork-submissions`, { files: [{ fileId: mine }] })
      .expect(409);
    expect(refused.body.code).toBe('artwork.not_accepting');
  });
});
