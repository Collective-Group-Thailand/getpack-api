import { createHmac, randomUUID } from 'node:crypto';

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
  staffToken,
} from '../support/commerce-e2e';
import { bootFulfilmentApp, type FulfilmentApp, makePdf, uploadPdf } from '../support/fulfilment-e2e';

const SECRET = 'fake-line-channel-secret';

interface Sent {
  conversationId: string;
  messages: { id: string; kind: string; body: string | null; contextCard: unknown; file: unknown }[];
}

/**
 * U5.B2 conversations v2 (D-300, D-221): threads per subject, files and context cards, internal notes, canned
 * responses, read receipts, SLA timers and stats, the LINE merge — and no customer ever reaching another's thread.
 */
describe('conversations v2 (e2e, U5.B2)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let a: { token: string; phone: string };
  let b: { token: string; phone: string };
  let cs: string;
  let lead: string;
  let orderId: string;
  let thread: string;

  const post = (t: string, path: string, body: Record<string, unknown> = {}) =>
    as(ctx, t).post(path, body).set('Idempotency-Key', randomUUID());

  beforeAll(async () => {
    process.env['LINE_MESSAGING_CHANNEL_SECRET'] = SECRET;
    process.env['LINE_MESSAGING_CHANNEL_ID'] = 'fake-oa';
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    const [code] = postcodes(ctx, 1) as [string];
    await seedShipping(ctx, fixture.factoryPublicId, [code]);
    a = await customerToken(ctx, 211);
    b = await customerToken(ctx, 212);
    cs = await staffToken(ctx, 'cs');
    lead = await staffToken(ctx, 'cs_lead');
    orderId = (await placeOrder(ctx, a.token, fixture, code)).orders[0]!.id;
  });

  afterAll(async () => {
    delete process.env['LINE_MESSAGING_CHANNEL_SECRET'];
    delete process.env['LINE_MESSAGING_CHANNEL_ID'];
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  it('opens a thread about my order with a text, a card and a file; the inbox shows its subject and SLA (D-300)', async () => {
    const fileId = await uploadPdf(
      ctx,
      a.token,
      Buffer.from(await makePdf({ widthMm: 50, heightMm: 50 })),
      'document',
    );
    const sent = (
      await post(a.token, '/v1/store/conversations', {
        subjectType: 'order',
        subjectId: orderId,
        body: 'ขอแก้ไขสีโลโก้ค่ะ',
        contextCard: { type: 'order', id: orderId },
        fileIds: [fileId],
      }).expect(201)
    ).body as Sent;
    thread = sent.conversationId;
    expect(sent.messages.map((m) => m.kind)).toEqual(['text', 'file']);
    expect(sent.messages[0]!.contextCard).toMatchObject({
      type: 'order',
      id: orderId,
      label: expect.any(String),
    });
    expect(sent.messages[1]!.file).toMatchObject({ id: fileId, mimeType: 'application/pdf' });

    // The same subject continues in the same live thread.
    const again = (
      await post(a.token, '/v1/store/conversations', {
        subjectType: 'order',
        subjectId: orderId,
        body: 'ด่วนค่ะ',
      }).expect(201)
    ).body as Sent;
    expect(again.conversationId).toBe(thread);

    const mine = (await as(ctx, a.token).get('/v1/store/conversations').expect(200)).body as {
      id: string;
      subject: { type: string; id: string } | null;
      unread: number;
    }[];
    expect(mine.find((t) => t.id === thread)).toMatchObject({
      subject: { type: 'order', id: orderId },
      unread: 0,
    });

    const inbox = await as(ctx, cs)
      .get('/v1/admin/conversations')
      .query({ subjectType: 'order', sla: 'waiting', perPage: 100 })
      .expect(200);
    const row = (inbox.body.data as { id: string }[]).find((c) => c.id === thread);
    expect(row).toMatchObject({
      subjectType: 'order',
      subject: { type: 'order', id: orderId },
      replyChannel: 'web',
      sla: { state: 'waiting', firstResponseDueAt: expect.any(String), firstRespondedAt: null },
      participants: [expect.objectContaining({ role: 'customer' })],
    });
  });

  it('keeps every thread, message and file of mine away from other customers (IDOR)', async () => {
    await post(b.token, '/v1/store/conversations', {
      subjectType: 'order',
      subjectId: orderId,
      body: 'x',
    }).expect(422);
    await as(ctx, b.token).get(`/v1/store/conversations/${thread}`).expect(404);
    await as(ctx, b.token).get(`/v1/store/conversations/${thread}/messages`).expect(404);
    await post(b.token, `/v1/store/conversations/${thread}/messages`, { body: 'x' }).expect(404);
    await as(ctx, b.token)
      .put(`/v1/store/conversations/${thread}/reply-channel`, { replyChannel: 'web' })
      .expect(404);
    // A card to someone else's order, even in my own support thread.
    await post(b.token, '/v1/store/conversations', {
      subjectType: 'support',
      body: 'ดูออร์เดอร์นี้',
      contextCard: { type: 'order', id: orderId },
    }).expect(422);
    // Their file is not mine to read.
    const file = (
      await ctx.prisma.conversationMessage.findFirstOrThrow({
        where: { conversation: { publicId: thread }, kind: 'file' },
        include: { fileObject: true },
      })
    ).fileObject!;
    expect([403, 404]).toContain((await as(ctx, b.token).get(`/v1/store/files/${file.publicId}`)).status);
    await as(ctx, a.token).get(`/v1/store/files/${file.publicId}`).expect(200);
    expect((await as(ctx, b.token).get('/v1/store/conversations').expect(200)).body).not.toContainEqual(
      expect.objectContaining({ id: thread }),
    );
  });

  it('keeps internal notes in the inbox; a reply from a canned response answers the clock (D-300, D-221)', async () => {
    await post(cs, '/v1/admin/canned-responses', { title: 'x', bodyTh: 'x', bodyEn: 'x' }).expect(403);
    const canned = (
      await post(lead, '/v1/admin/canned-responses', {
        title: 'แจ้งระยะเวลาผลิต',
        bodyTh: 'งานใช้เวลาผลิตประมาณ 10 วันทำการค่ะ',
        bodyEn: 'About 10 business days.',
        tags: ['production'],
      }).expect(201)
    ).body as { id: string };
    const listed = await as(ctx, cs)
      .get('/v1/admin/canned-responses')
      .query({ tag: 'production' })
      .expect(200);
    expect((listed.body.data as { id: string }[]).map((c) => c.id)).toContain(canned.id);

    await post(cs, `/v1/admin/conversations/${thread}/notes`, { body: 'ลูกค้า VIP' }).expect(201);
    let detail = (await as(ctx, cs).get(`/v1/admin/conversations/${thread}`).expect(200)).body;
    expect(detail.sla.firstRespondedAt).toBeNull(); // a note is not an answer
    const storeMessages = (
      await as(ctx, a.token).get(`/v1/store/conversations/${thread}/messages`).expect(200)
    ).body.data as { body: string | null; visibility: string }[];
    expect(storeMessages.some((m) => m.body === 'ลูกค้า VIP')).toBe(false);
    const staffMessages = (await as(ctx, cs).get(`/v1/admin/conversations/${thread}/messages`).expect(200))
      .body.data as { body: string | null; visibility: string }[];
    expect(staffMessages.find((m) => m.body === 'ลูกค้า VIP')).toMatchObject({ visibility: 'internal' });

    await post(cs, `/v1/admin/conversations/${thread}/messages`, {
      body: 'งานใช้เวลาผลิตประมาณ 10 วันทำการค่ะ',
      cannedResponseId: canned.id,
    }).expect(201);
    detail = (await as(ctx, cs).get(`/v1/admin/conversations/${thread}`).expect(200)).body;
    expect(detail.sla).toMatchObject({ state: 'answered', firstRespondedAt: expect.any(String) });
    expect(
      (await ctx.prisma.conversationMessage.count({ where: { cannedResponse: { publicId: canned.id } } })) >
        0,
    ).toBe(true);

    // Read receipts: my unread count, and when getpack read the thread.
    let mine = (await as(ctx, a.token).get(`/v1/store/conversations/${thread}`).expect(200)).body;
    expect(mine.unread).toBe(1);
    await as(ctx, a.token).get(`/v1/store/conversations/${thread}/messages`).expect(200);
    await post(a.token, `/v1/store/conversations/${thread}/messages`, { body: 'ขอบคุณค่ะ' }).expect(201);
    await as(ctx, cs).post(`/v1/admin/conversations/${thread}/actions/mark-read`).expect(200);
    mine = (await as(ctx, a.token).get(`/v1/store/conversations/${thread}`).expect(200)).body;
    expect(mine).toMatchObject({ unread: 0, readByGetpackAt: expect.any(String) });

    // An archived canned response is no longer offered nor accepted.
    await as(ctx, lead).post(`/v1/admin/canned-responses/${canned.id}/actions/archive`).expect(200);
    await post(cs, `/v1/admin/conversations/${thread}/messages`, {
      body: 'x',
      cannedResponseId: canned.id,
    }).expect(422);
  });

  it('refuses LINE replies without a linked LINE account and reports inbox times (D-300)', async () => {
    const refused = await as(ctx, a.token)
      .put(`/v1/store/conversations/${thread}/reply-channel`, { replyChannel: 'line' })
      .expect(409);
    expect(refused.body.code).toBe('conversations.unreachable');
    const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    const stats = (
      await as(ctx, cs).get('/v1/admin/conversations/stats').query({ from: today, to: today }).expect(200)
    ).body;
    expect(stats.opened).toBeGreaterThanOrEqual(1);
    expect(stats.firstResponse.count).toBeGreaterThanOrEqual(1);
    expect(stats.firstResponse.medianMinutes).toEqual(expect.any(String));
    await as(ctx, a.token).get('/v1/admin/conversations/stats').query({ from: today, to: today }).expect(403);
  });

  it('merges a LINE thread into the customer’s support thread when the account is linked (D-300)', async () => {
    const lineUser = `Umerge${ctx.run}`;
    const hook = (events: unknown[]) => {
      const raw = JSON.stringify({ destination: 'Ufakebot', events });
      return request(ctx.server)
        .post('/webhooks/line/messaging')
        .set('content-type', 'application/json')
        .set('x-line-signature', createHmac('sha256', SECRET).update(raw).digest('base64'))
        .send(raw);
    };
    const event = (type: string, extra: Record<string, unknown> = {}) => ({
      type,
      webhookEventId: randomUUID(),
      timestamp: Date.now(),
      source: { type: 'user', userId: lineUser },
      ...extra,
    });
    const support = (
      await post(a.token, '/v1/store/conversations', { subjectType: 'support', body: 'สวัสดีค่ะ' }).expect(
        201,
      )
    ).body as Sent;
    await hook([
      event('follow'),
      event('message', { message: { id: `mm-${ctx.run}`, type: 'text', text: 'จาก LINE' } }),
    ]).expect(200);
    const account = await ctx.prisma.lineAccount.findFirstOrThrow({ where: { lineUserId: lineUser } });
    const lineThread = await ctx.prisma.conversation.findFirstOrThrow({
      where: { lineAccountId: account.id },
    });

    await request(ctx.server)
      .post('/v1/auth/customer/line')
      .set('authorization', `Bearer ${a.token}`)
      .send({ idToken: `fake-line.${lineUser}.ลูกค้า` })
      .expect(200);
    await ctx.pump();
    const merged = await ctx.prisma.conversation.findUniqueOrThrow({ where: { id: lineThread.id } });
    expect(merged.status).toBe('closed');
    const target = await ctx.prisma.conversation.findUniqueOrThrow({
      where: { publicId: support.conversationId },
    });
    expect(merged.mergedIntoId).toBe(target.id);
    expect(target.lineAccountId).toBe(account.id);
    const page = (
      await as(ctx, a.token).get(`/v1/store/conversations/${support.conversationId}/messages`).expect(200)
    ).body as { data: { body: string }[] };
    const bodies = page.data.map((m) => m.body);
    expect(bodies).toEqual(expect.arrayContaining(['สวัสดีค่ะ', 'จาก LINE']));

    // A later LINE message lands in the same thread; the reply follows it to LINE.
    await hook([
      event('message', { message: { id: `mm2-${ctx.run}`, type: 'text', text: 'อีกครั้ง' } }),
    ]).expect(200);
    const thread2 = (
      await as(ctx, a.token).get(`/v1/store/conversations/${support.conversationId}`).expect(200)
    ).body;
    expect(thread2.replyChannel).toBe('line');
    expect((await as(ctx, a.token).get('/v1/store/conversations').expect(200)).body).not.toContainEqual(
      expect.objectContaining({ id: lineThread.publicId }),
    );
  });
});
