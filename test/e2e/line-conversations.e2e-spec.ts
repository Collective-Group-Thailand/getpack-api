import { createHmac, randomUUID } from 'node:crypto';

import { type FakeLineMessaging } from '@integrations/line-messaging/fake-line-messaging';
import { LINE_MESSAGING } from '@integrations/line-messaging/line-messaging.port';
import request from 'supertest';

import { as, customerToken, staffToken } from '../support/commerce-e2e';
import { bootFulfilmentApp, type FulfilmentApp } from '../support/fulfilment-e2e';

const SECRET = 'fake-line-channel-secret';

/**
 * LINE official account and chat with CS (B4.6, D-151): signature-verified webhook, idempotent events,
 * friend status and rich menus (guest → member on linking), LINE and web conversations in the CS inbox,
 * replies pushed to LINE, the customer's own chat and its realtime signals.
 */
describe('LINE webhook, rich menus and the CS inbox (e2e, B4.6)', () => {
  let ctx: FulfilmentApp;
  let line: FakeLineMessaging;

  beforeAll(async () => {
    process.env['LINE_MESSAGING_CHANNEL_SECRET'] = SECRET;
    process.env['LINE_MESSAGING_CHANNEL_ID'] = 'fake-oa';
    ctx = await bootFulfilmentApp();
    line = ctx.app.get<FakeLineMessaging>(LINE_MESSAGING);
  });

  afterAll(async () => {
    delete process.env['LINE_MESSAGING_CHANNEL_SECRET'];
    delete process.env['LINE_MESSAGING_CHANNEL_ID'];
    await ctx?.app.close();
  });

  const hook = (events: unknown[], secret = SECRET) => {
    const raw = JSON.stringify({ destination: 'Ufakebot', events });
    const signature = createHmac('sha256', secret).update(raw).digest('base64');
    return request(ctx.server)
      .post('/webhooks/line/messaging')
      .set('content-type', 'application/json')
      .set('x-line-signature', signature)
      .send(raw);
  };
  const event = (type: string, userId: string, extra: Record<string, unknown> = {}) => ({
    type,
    webhookEventId: randomUUID(),
    timestamp: Date.now(),
    source: { type: 'user', userId },
    ...extra,
  });

  it('receives LINE follows and messages, shows the right menu and lets CS answer on LINE', async () => {
    const userId = `Ufake${ctx.run}`;
    const admin = await staffToken(ctx, 'admin');
    const cs = await staffToken(ctx, 'cs');
    for (const [key, audience] of [
      ['guest_e2e', 'guest'],
      ['member_e2e', 'member'],
    ] as const)
      await as(ctx, admin)
        .put(`/v1/admin/line/rich-menus/${key}`, {
          audience,
          providerMenuId: `richmenu-${audience}${ctx.run}`,
          active: true,
        })
        .expect(200);
    await as(ctx, cs)
      .put('/v1/admin/line/rich-menus/guest_e2e', {
        audience: 'guest',
        providerMenuId: 'richmenu-x',
        active: true,
      })
      .expect(403);

    // Wrong signature → 401; nothing stored.
    await hook([event('follow', userId)], 'wrong-secret').expect(401);
    expect(await ctx.prisma.lineAccount.count({ where: { lineUserId: userId } })).toBe(0);

    const follow = event('follow', userId);
    await hook([follow]).expect(200);
    await hook([follow]).expect(200); // redelivery
    const account = await ctx.prisma.lineAccount.findFirstOrThrow({ where: { lineUserId: userId } });
    expect(account).toMatchObject({ friendStatus: 'followed', richMenuKey: 'guest_e2e', userId: null });
    expect(line.richMenus.get(userId)).toBe(`richmenu-guest${ctx.run}`);

    const message = event('message', userId, {
      message: { id: `m-${ctx.run}`, type: 'text', text: 'สอบถามสถานะคำสั่งซื้อค่ะ' },
    });
    await hook([
      message,
      event('message', userId, { message: { id: `s-${ctx.run}`, type: 'sticker' } }),
    ]).expect(200);
    await hook([message]).expect(200);
    const conversation = await ctx.prisma.conversation.findFirstOrThrow({
      where: { lineAccountId: account.id },
      include: { messages: true },
    });
    expect(conversation.messages.map((m) => m.kind).sort()).toEqual(['sticker', 'text']);
    // No message text or LINE user id in the webhook inbox (PDPA).
    const inbox = await ctx.prisma.webhookInbox.findMany({ where: { provider: 'line_messaging' } });
    expect(JSON.stringify(inbox.map((i) => i.payload))).not.toContain(userId);
    expect(JSON.stringify(inbox.map((i) => i.payload))).not.toContain('สอบถาม');

    // The CS inbox; a reply is pushed to the user's LINE.
    const list = await as(ctx, cs)
      .get('/v1/admin/conversations?status=open&assigned=unassigned&perPage=100')
      .expect(200);
    expect((list.body.data as { id: string }[]).some((c) => c.id === conversation.publicId)).toBe(true);
    const customerToken_ = (await customerToken(ctx, 1)).token;
    await as(ctx, customerToken_).get('/v1/admin/conversations').expect(403);
    const reply = await as(ctx, cs)
      .post(`/v1/admin/conversations/${conversation.publicId}/messages`, { body: 'กำลังผลิตค่ะ' })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    expect(reply.body).toMatchObject({ direction: 'outbound', body: 'กำลังผลิตค่ะ' });
    expect(line.sent.some((m) => m.to === userId && m.text === 'กำลังผลิตค่ะ')).toBe(true);
    const detail = await as(ctx, cs).get(`/v1/admin/conversations/${conversation.publicId}`).expect(200);
    expect(detail.body).toMatchObject({ status: 'pending', assignee: { displayName: expect.any(String) } });
    const messages = await as(ctx, cs)
      .get(`/v1/admin/conversations/${conversation.publicId}/messages?limit=2`)
      .expect(200);
    expect(messages.body.data[0]).toMatchObject({ direction: 'outbound' });
    expect(messages.body.meta.nextCursor).toEqual(expect.any(String));

    // The customer links LINE: the OA account and the conversation become theirs; the member menu shows.
    const linked = await request(ctx.server)
      .post('/v1/auth/customer/line')
      .set('authorization', `Bearer ${customerToken_}`)
      .send({ idToken: `fake-line.${userId}.ลูกค้า` })
      .expect(200);
    expect(linked.body.accessToken).toEqual(expect.any(String));
    await ctx.pump();
    const after = await ctx.prisma.lineAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(after.userId).not.toBeNull();
    expect(after.richMenuKey).toBe('member_e2e');
    expect(line.richMenus.get(userId)).toBe(`richmenu-member${ctx.run}`);
    expect(
      (await ctx.prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).customerUserId,
    ).toBe(after.userId);

    // Unfollow → blocked: replies are refused. Close; the next message opens a new conversation.
    await hook([event('unfollow', userId)]).expect(200);
    await as(ctx, cs)
      .post(`/v1/admin/conversations/${conversation.publicId}/messages`, { body: 'ยังอยู่ไหมคะ' })
      .set('Idempotency-Key', randomUUID())
      .expect(409);
    await as(ctx, cs).post(`/v1/admin/conversations/${conversation.publicId}/actions/close`).expect(200);
    await hook([
      event('message', userId, { message: { id: `m2-${ctx.run}`, type: 'text', text: 'สวัสดี' } }),
    ]).expect(200);
    expect(await ctx.prisma.conversation.count({ where: { lineAccountId: account.id } })).toBe(2);
  });

  it('lets a customer chat from the web / LIFF and see the replies', async () => {
    const { token } = await customerToken(ctx, 2);
    await as(ctx, token).get('/v1/store/conversation').expect(404);
    const sent = await as(ctx, token)
      .post('/v1/store/conversation/messages', { body: 'ขอใบเสนอราคาเพิ่มค่ะ' })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    expect(sent.body).toMatchObject({ direction: 'inbound', kind: 'text' });
    const mine = await as(ctx, token).get('/v1/store/conversation').expect(200);
    const cs = await staffToken(ctx, 'cs');
    await as(ctx, cs)
      .post(`/v1/admin/conversations/${mine.body.id as string}/actions/assign`, {})
      .expect(200);
    await as(ctx, cs)
      .post(`/v1/admin/conversations/${mine.body.id as string}/messages`, { body: 'ได้เลยค่ะ' })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    const messages = await as(ctx, token).get('/v1/store/conversation/messages').expect(200);
    expect((messages.body.data as { body: string; direction: string }[]).map((m) => m.body)).toEqual([
      'ได้เลยค่ะ',
      'ขอใบเสนอราคาเพิ่มค่ะ',
    ]);
    expect(
      await ctx.prisma.conversationMessage.count({
        where: { conversation: { publicId: mine.body.id as string }, direction: 'outbound', readAt: null },
      }),
    ).toBe(0);
    // Another customer never sees it.
    const { token: other } = await customerToken(ctx, 3);
    await as(ctx, other).get('/v1/store/conversation').expect(404);
  });
});
