import { randomUUID } from 'node:crypto';

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
    // U-B0.2: the Prepress owner and the queue's filters and refs.
    const me = await ctx.prisma.user.findFirstOrThrow({ where: { email: 'prepress@example.invalid' } });
    await as(ctx, prepress)
      .post(`/v1/admin/orders/${orderId}/actions/assign-prepress`, { assigneeId: me.publicId })
      .expect(204);
    const mine = await as(ctx, prepress)
      .get(`/v1/admin/prepress/queue?kind=submissions&perPage=100&assigneeId=${me.publicId}`)
      .expect(200);
    expect(mine.body.data).toContainEqual(
      expect.objectContaining({
        itemId: v3.body.id,
        assignee: { id: me.publicId, displayName: me.displayName },
        productTypeCode: expect.any(String),
        customer: expect.objectContaining({ id: expect.any(String) }),
      }),
    );
    const unowned = await as(ctx, prepress)
      .get('/v1/admin/prepress/queue?kind=submissions&perPage=100&assigneeId=none')
      .expect(200);
    expect((unowned.body.data as { itemId: string }[]).map((i) => i.itemId)).not.toContain(v3.body.id);
    const accepted = await as(ctx, prepress)
      .post(`/v1/admin/artwork-submissions/${v3.body.id as string}/actions/accept`, {
        note: 'ไฟล์ครบ (fake)',
      })
      .expect(200);
    expect(accepted.body).toMatchObject({ status: 'accepted_for_proof', preflightStatus: 'passed' });
    expect(
      await ctx.prisma.activityLog.count({
        where: { aggregatePublicId: orderId, action: 'artwork.review_note', visibility: { has: 'customer' } },
      }),
    ).toBe(0);
    expect(
      await ctx.prisma.activityLog.count({
        where: { aggregatePublicId: orderId, action: 'artwork.review_note' },
      }),
    ).toBe(1);
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

  it('sends a template, proofs with annotations and changes, then an approval that locks and hashes the file', async () => {
    const { token } = await customerToken(ctx, 5);
    const prepress = await staffToken(ctx, 'prepress');
    const group = await placeOrder(ctx, token, fixture, code);
    const orderId = group.orders[0]!.id;

    // Template sent by Prepress: the customer lists and downloads it; artwork now awaits the upload.
    const template = await uploadPdf(
      ctx,
      prepress,
      await makePdf({ widthMm: 106, heightMm: 106, bleedMm: 3 }),
      'proof',
      'admin',
    );
    const sent = await as(ctx, prepress)
      .post(`/v1/admin/orders/${orderId}/templates`, { fileId: template, note: 'แบบแปลน 100×100' })
      .expect(201);
    expect(sent.body).toMatchObject({ trigger: 'manual', fileId: template });
    const templates = await as(ctx, token).get(`/v1/store/orders/${orderId}/templates`).expect(200);
    expect(templates.body).toHaveLength(1);
    expect((await as(ctx, token).get(`/v1/store/orders/${orderId}`).expect(200)).body.artworkStatus).toBe(
      'awaiting_upload',
    );

    // A proof needs an accepted submission.
    const proof1File = await uploadPdf(
      ctx,
      prepress,
      await makePdf({ widthMm: 106, heightMm: 106, bleedMm: 3 }),
      'proof',
      'admin',
    );
    expect(
      (
        await as(ctx, prepress)
          .post(`/v1/admin/orders/${orderId}/proofs`, { proofFileId: proof1File })
          .expect(409)
      ).body.code,
    ).toBe('proofs.no_accepted_artwork');
    const artworkFile = await uploadPdf(
      ctx,
      token,
      await makePdf({ widthMm: 106, heightMm: 106, bleedMm: 3 }),
    );
    const submission = await as(ctx, token)
      .post(`/v1/store/orders/${orderId}/artwork-submissions`, { files: [{ fileId: artworkFile }] })
      .expect(201);
    await preflight();
    await as(ctx, prepress)
      .post(`/v1/admin/artwork-submissions/${submission.body.id as string}/actions/accept`)
      .expect(200);

    // Version 1 → annotated by the customer, answered by Prepress, changes requested.
    const p1 = await as(ctx, prepress)
      .post(`/v1/admin/orders/${orderId}/proofs`, { proofFileId: proof1File })
      .expect(201);
    expect(p1.body).toMatchObject({ versionNo: 1, status: 'pending_customer', compare: null });
    expect((await as(ctx, token).get(`/v1/store/orders/${orderId}`).expect(200)).body.artworkStatus).toBe(
      'proof_sent',
    );
    await as(ctx, token).get(`/v1/store/files/${proof1File}/download`).expect(200);
    await as(ctx, token)
      .post(`/v1/store/proofs/${p1.body.id as string}/annotations`, {
        page: 1,
        kind: 'pin',
        geometry: { x: 2, y: 0 },
        comment: 'x',
      })
      .expect(422);
    const noted = await as(ctx, token)
      .post(`/v1/store/proofs/${p1.body.id as string}/annotations`, {
        page: 1,
        kind: 'rect',
        geometry: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 },
        comment: 'ขอโลโก้ใหญ่ขึ้น',
      })
      .expect(201);
    const noteId = noted.body.annotations[0].id as string;
    // A reply takes its parent's page, kind and geometry (U-B0.1).
    const replied = await as(ctx, prepress)
      .post(`/v1/admin/proofs/${p1.body.id as string}/annotations`, { parentId: noteId, comment: 'รับทราบ' })
      .expect(201);
    expect(replied.body.annotations).toHaveLength(2);
    expect(replied.body.annotations[1]).toMatchObject({ parentId: noteId, page: 1, kind: 'rect' });
    await as(ctx, token)
      .post(`/v1/store/proofs/${p1.body.id as string}/annotations`, { comment: 'no place (fake)' })
      .expect(422);
    const storeView = await as(ctx, token)
      .get(`/v1/store/proofs/${p1.body.id as string}`)
      .expect(200);
    expect(
      (storeView.body.annotations as { author: { kind: string; displayName: string } }[])[1]!.author,
    ).toEqual({ kind: 'staff', displayName: 'Packio' });
    await as(ctx, token)
      .post(`/v1/store/proofs/${p1.body.id as string}/actions/request-changes`, {
        comment: 'สีพื้นหลังเข้มเกินไป',
      })
      .expect(200);
    expect((await as(ctx, token).get(`/v1/store/orders/${orderId}`).expect(200)).body.artworkStatus).toBe(
      'changes_requested',
    );
    await as(ctx, token)
      .post(`/v1/store/proofs/${p1.body.id as string}/annotations`, {
        page: 1,
        kind: 'pin',
        geometry: { x: 0.5, y: 0.5 },
        comment: 'อีกจุด',
      })
      .expect(409);
    const queued = await as(ctx, prepress)
      .get('/v1/admin/prepress/queue?kind=changes_requested&perPage=100')
      .expect(200);
    expect((queued.body.data as { itemId: string }[]).some((i) => i.itemId === p1.body.id)).toBe(true);

    // Version 2 answers version 1 (compare data), then the customer approves: locked copy + SHA-256 + evidence.
    const proof2File = await uploadPdf(
      ctx,
      prepress,
      await makePdf({ widthMm: 106, heightMm: 106, bleedMm: 3, rgbPaint: true }),
      'proof',
      'admin',
    );
    const p2 = await as(ctx, prepress)
      .post(`/v1/admin/orders/${orderId}/proofs`, { proofFileId: proof2File, changeNote: 'สีอ่อนลง' })
      .expect(201);
    expect(p2.body.compare).toMatchObject({
      previousProofId: p1.body.id,
      previousVersionNo: 1,
      previousStatus: 'changes_requested',
      previousDecisionComment: 'สีพื้นหลังเข้มเกินไป',
      openAnnotationsOnPrevious: 2,
    });
    // U-B0.1: the upload page's rules, then an approval that must confirm the checklist once one is set.
    const rules = await as(ctx, token).get(`/v1/store/orders/${orderId}/artwork-rules`).expect(200);
    expect(rules.body).toMatchObject({
      purpose: 'artwork',
      bleedMm: '3',
      colourMode: 'cmyk',
      approvalChecklist: [],
    });
    expect(rules.body.checks).toContainEqual({ check: 'missing_bleed', severity: 'block' });
    await setSetting(ctx, 'artwork.approval_checklist', [
      { key: 'spelling_checked', labelTh: 'ตรวจคำสะกดแล้ว', labelEn: 'Spelling checked' },
    ]);
    const key = randomUUID();
    await as(ctx, token)
      .post(`/v1/store/proofs/${p2.body.id as string}/actions/approve`)
      .expect(400);
    const missing = await as(ctx, token)
      .post(`/v1/store/proofs/${p2.body.id as string}/actions/approve`, {})
      .set('Idempotency-Key', randomUUID())
      .expect(422);
    expect(missing.body.errors[0]).toMatchObject({ path: 'checklist', code: 'required' });
    const approved = await as(ctx, token)
      .post(`/v1/store/proofs/${p2.body.id as string}/actions/approve`, { checklist: ['spelling_checked'] })
      .set('Idempotency-Key', key)
      .expect(200);
    await setSetting(ctx, 'artwork.approval_checklist', []);
    expect(approved.body.decisionChecklist).toEqual(['spelling_checked']);
    expect(approved.body.decidedByName).toEqual(expect.any(String));
    expect(approved.body.decidedByName).not.toBe('Packio');
    const source = await ctx.prisma.fileObject.findUniqueOrThrow({ where: { publicId: proof2File } });
    expect(approved.body).toMatchObject({
      status: 'approved',
      decisionChannel: 'web',
      approvedFileSha256: Buffer.from(source.sha256!).toString('hex'),
    });
    expect(approved.body.approvedFileId).not.toBe(proof2File);
    const locked = await ctx.prisma.fileObject.findUniqueOrThrow({
      where: { publicId: approved.body.approvedFileId as string },
    });
    expect(locked).toMatchObject({ legalHold: true, scanStatus: 'clean' });
    const row = await ctx.prisma.proof.findUniqueOrThrow({ where: { publicId: p2.body.id as string } });
    expect(row.decisionIp).not.toBeNull();
    await as(ctx, token)
      .get(`/v1/store/files/${approved.body.approvedFileId as string}/download`)
      .expect(200);
    // Replay returns the same answer; a new attempt is refused; the order's artwork is approved.
    const replay = await as(ctx, token)
      .post(`/v1/store/proofs/${p2.body.id as string}/actions/approve`, { checklist: ['spelling_checked'] })
      .set('Idempotency-Key', key)
      .expect(200);
    expect(replay.body.approvedFileId).toBe(approved.body.approvedFileId);
    await as(ctx, token)
      .post(`/v1/store/proofs/${p2.body.id as string}/actions/approve`)
      .set('Idempotency-Key', randomUUID())
      .expect(409);
    const order = await as(ctx, token).get(`/v1/store/orders/${orderId}`).expect(200);
    expect(order.body.artworkStatus).toBe('approved');
    const again = await uploadPdf(ctx, token, await makePdf({ widthMm: 106, heightMm: 106, bleedMm: 3 }));
    await as(ctx, token)
      .post(`/v1/store/orders/${orderId}/artwork-submissions`, { files: [{ fileId: again }] })
      .expect(409);
    const fact = await ctx.prisma.domainEvent.findFirst({
      where: {
        type: 'order.fact_recorded',
        aggregateId: orderId,
        payload: { path: ['fact'], equals: 'artwork_approved' },
      },
    });
    expect(fact).not.toBeNull();
  });

  it('lets CS approve for the customer with a reason (audited), not Prepress', async () => {
    const { token } = await customerToken(ctx, 6);
    const prepress = await staffToken(ctx, 'prepress');
    const cs = await staffToken(ctx, 'cs');
    const group = await placeOrder(ctx, token, fixture, code);
    const orderId = group.orders[0]!.id;
    const artworkFile = await uploadPdf(ctx, token, await makePdf({ widthMm: 100, heightMm: 100 }));
    const submission = await as(ctx, token)
      .post(`/v1/store/orders/${orderId}/artwork-submissions`, { files: [{ fileId: artworkFile }] })
      .expect(201);
    await preflight();
    await as(ctx, prepress)
      .post(`/v1/admin/artwork-submissions/${submission.body.id as string}/actions/accept`)
      .expect(200);
    const proofFile = await uploadPdf(
      ctx,
      prepress,
      await makePdf({ widthMm: 100, heightMm: 100 }),
      'proof',
      'admin',
    );
    const proof = await as(ctx, prepress)
      .post(`/v1/admin/orders/${orderId}/proofs`, { proofFileId: proofFile })
      .expect(201);
    const body = { reason: 'ลูกค้ายืนยันทางโทรศัพท์ว่าอนุมัติแบบ', confirmedVia: 'phone' };
    await as(ctx, prepress)
      .post(`/v1/admin/proofs/${proof.body.id as string}/actions/approve-on-behalf`, body)
      .set('Idempotency-Key', randomUUID())
      .expect(403);
    const approved = await as(ctx, cs)
      .post(`/v1/admin/proofs/${proof.body.id as string}/actions/approve-on-behalf`, body)
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    expect(approved.body).toMatchObject({
      status: 'approved',
      decisionChannel: 'cs_on_behalf',
      onBehalfReason: 'ลูกค้ายืนยันทางโทรศัพท์ว่าอนุมัติแบบ (phone)',
    });
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'proof.approved_on_behalf', resourcePublicId: proof.body.id as string },
      }),
    ).toBe(1);
  });
});
