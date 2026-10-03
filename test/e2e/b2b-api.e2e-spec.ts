import { createHmac, randomUUID } from 'node:crypto';

import { type FakeWebhookSender } from '@integrations/webhooks-out/fake-webhook-sender';
import { WEBHOOK_SENDER } from '@integrations/webhooks-out/webhook-sender.port';
import { WebhooksService } from '@modules/b2b/webhooks.service';
import request from 'supertest';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  activeCompany,
  addAddress,
  as,
  customerToken,
  foldingBackToRfq,
  foldingReady,
  postcodes,
  saveQuote,
  seedShipping,
} from '../support/commerce-e2e';
import { bootFulfilmentApp, type FulfilmentApp } from '../support/fulfilment-e2e';

/** U2.7 B2B API: company API clients, `/v1/b2b`, signed webhooks (D-291, D-207). */
describe('B2B API and webhooks (e2e, U2.7)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let code: string;
  let admin: string;
  let companyId: string;
  let addressId: string;
  let bearer: string;
  let readOnly: string;
  let secret: string;

  const post = (t: string, path: string, body: Record<string, unknown> = {}) =>
    as(ctx, t).post(path, body).set('Idempotency-Key', randomUUID());

  async function token(clientId: string, clientSecret: string): Promise<string> {
    const res = await request(ctx.server)
      .post('/v1/auth/token')
      .send({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret })
      .expect(200);
    return res.body.access_token as string;
  }

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    [code] = postcodes(ctx, 1) as [string];
    await seedShipping(ctx, fixture.factoryPublicId, [code]);
    admin = (await customerToken(ctx, 151)).token;
    companyId = await activeCompany(ctx, admin, 151);
    addressId = (await addAddress(ctx, admin, code)).id;
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  it('lets the Company Admin issue scoped clients, the secret once, up to the limit (D-291)', async () => {
    const issued = await post(admin, `/v1/store/companies/${companyId}/api-clients`, {
      name: 'ERP connector',
      scopes: ['b2b_orders.read', 'b2b_orders.write', 'b2b_documents.read', 'b2b_webhooks.manage'],
    }).expect(201);
    expect(issued.body.clientSecret).toEqual(expect.any(String));
    bearer = await token(issued.body.clientId as string, issued.body.clientSecret as string);
    const listed = await as(ctx, admin).get(`/v1/store/companies/${companyId}/api-clients`).expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(issued.body.clientSecret as string);

    const reader = await post(admin, `/v1/store/companies/${companyId}/api-clients`, {
      name: 'BI reader',
      scopes: ['b2b_orders.read'],
    }).expect(201);
    readOnly = await token(reader.body.clientId as string, reader.body.clientSecret as string);
    for (let i = 0; i < 3; i++)
      await post(admin, `/v1/store/companies/${companyId}/api-clients`, {
        name: `extra ${i}`,
        scopes: ['b2b_orders.read'],
      }).expect(201);
    const over = await post(admin, `/v1/store/companies/${companyId}/api-clients`, {
      name: 'one too many',
      scopes: ['b2b_orders.read'],
    }).expect(409);
    expect(over.body.code).toBe('b2b.client_limit');

    // A b2b token works only on /v1/b2b; a customer token is refused there (contract §2).
    const me = await as(ctx, bearer).get('/v1/b2b/me').expect(200);
    expect(me.body.company.id).toBe(companyId);
    const wrong = await as(ctx, bearer).get('/v1/store/order-groups').expect(403);
    expect(wrong.body.code).toBe('auth.wrong_audience');
    await as(ctx, admin).get('/v1/b2b/me').expect(403);
    // Scopes: the read-only client may not order or manage webhooks.
    await post(readOnly, '/v1/b2b/webhook-subscriptions', {
      url: 'https://erp.example.com/hooks',
      eventTypes: ['order.placed'],
    }).expect(403);
  });

  it('subscribes a webhook, places an order for the company and delivers it signed (D-291)', async () => {
    await post(bearer, '/v1/b2b/webhook-subscriptions', {
      url: 'http://insecure.example.com/hooks',
      eventTypes: ['order.placed'],
    }).expect(422);
    const sub = await post(bearer, '/v1/b2b/webhook-subscriptions', {
      url: 'https://erp.example.com/hooks',
      eventTypes: ['order.placed', 'order.updated'],
    }).expect(201);
    secret = sub.body.secret as string;

    const quote = await saveQuote(ctx, admin, fixture, [1000]);
    const usable = await as(ctx, bearer).get('/v1/b2b/quotes').expect(200);
    expect((usable.body.data as { id: string }[]).map((q) => q.id)).toContain(quote.id);
    await post(readOnly, '/v1/b2b/orders', { quoteId: quote.id, quoteOptionId: quote.options[0]!.id }).expect(
      403,
    );
    const placed = await post(bearer, '/v1/b2b/orders', {
      quoteId: quote.id,
      quoteOptionId: quote.options[0]!.id,
      destinations: [{ addressId, quantity: 1000 }],
      poNumber: 'PO-E2E-1',
    }).expect(201);
    const group = await ctx.prisma.orderGroup.findUniqueOrThrow({
      where: { publicId: placed.body.id as string },
      include: { orders: true },
    });
    expect(group).toMatchObject({ channel: 'b2b' });
    expect(group.companyId).not.toBeNull();
    const orderId = group.orders[0]!.publicId;

    const groups = await as(ctx, readOnly).get('/v1/b2b/order-groups').expect(200);
    expect((groups.body.data as { id: string }[]).map((g) => g.id)).toContain(group.publicId);
    await as(ctx, readOnly).get(`/v1/b2b/orders/${orderId}`).expect(200);
    // Another company's client does not see it.
    const other = (await customerToken(ctx, 152)).token;
    const otherCompany = await activeCompany(ctx, other, 152);
    const foreign = await post(other, `/v1/store/companies/${otherCompany}/api-clients`, {
      name: 'other',
      scopes: ['b2b_orders.read'],
    }).expect(201);
    const foreignBearer = await token(foreign.body.clientId as string, foreign.body.clientSecret as string);
    await as(ctx, foreignBearer).get(`/v1/b2b/orders/${orderId}`).expect(404);

    // The placed event becomes a signed delivery.
    await ctx.pump();
    const fake = ctx.app.get<FakeWebhookSender>(WEBHOOK_SENDER);
    const before = fake.sent.length;
    await ctx.app.get(WebhooksService).deliverDue();
    const sent = fake.sent.slice(before).find((s) => s.headers['Packio-Event'] === 'order.placed')!;
    expect(sent.url).toBe('https://erp.example.com/hooks');
    const [t, v1] = sent.headers['Packio-Signature']!.split(',').map((x) => x.split('=')[1]!);
    expect(v1).toBe(createHmac('sha256', secret).update(`${t}.${sent.body}`).digest('hex'));
    const body = JSON.parse(sent.body) as { event: { type: string }; data: { orderGroupId: string } };
    expect(body).toMatchObject({ event: { type: 'order.placed' }, data: { orderGroupId: group.publicId } });
    expect(sent.body).not.toContain('@'); // no personal data (e-mail) in a webhook body

    const log = await as(ctx, bearer)
      .get(`/v1/b2b/webhook-subscriptions/${sub.body.id as string}/deliveries`)
      .expect(200);
    expect(
      (log.body.data as { status: string; eventType: string }[]).find((d) => d.eventType === 'order.placed'),
    ).toMatchObject({ status: 'delivered' });
  });

  it('retries a failed delivery with back-off, then gives up (D-291)', async () => {
    const fake = ctx.app.get<FakeWebhookSender>(WEBHOOK_SENDER);
    const service = ctx.app.get(WebhooksService);
    const quote = await saveQuote(ctx, admin, fixture, [1000]);
    await post(bearer, '/v1/b2b/orders', {
      quoteId: quote.id,
      quoteOptionId: quote.options[0]!.id,
      destinations: [{ addressId, quantity: 1000 }],
      poNumber: 'PO-E2E-2',
    }).expect(201);
    await ctx.pump();
    fake.status = 500;
    try {
      let now = new Date();
      await service.deliverDue(now);
      const sub = await ctx.prisma.webhookSubscription.findFirstOrThrow({
        where: { company: { publicId: companyId }, status: 'active' },
      });
      const pending = await ctx.prisma.webhookDelivery.findFirstOrThrow({
        where: { subscriptionId: sub.id, eventType: 'order.placed', status: 'pending', attempts: 1 },
      });
      expect(pending).toMatchObject({ lastStatusCode: 500 });
      expect(pending.nextAttemptAt!.getTime() - now.getTime()).toBe(60_000);
      for (const wait of [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]) {
        now = new Date(now.getTime() + wait);
        await service.deliverDue(now);
      }
      const failed = await ctx.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: pending.id } });
      expect(failed).toMatchObject({ status: 'failed', attempts: 6, nextAttemptAt: null });
    } finally {
      fake.status = 200;
    }
  });

  it('lets the Company Admin revoke a client: no new token', async () => {
    const issued = await post(admin, `/v1/store/companies/${companyId}/api-clients`, {
      name: 'temp',
      scopes: ['b2b_orders.read'],
    }).expect(409); // the limit still holds
    expect(issued.body.code).toBe('b2b.client_limit');
    const listed = (await as(ctx, admin).get(`/v1/store/companies/${companyId}/api-clients`).expect(200))
      .body as { id: string; clientId: string; name: string }[];
    const extra = listed.find((c) => c.name === 'extra 0')!;
    await post(admin, `/v1/store/companies/${companyId}/api-clients/${extra.id}/actions/revoke`).expect(200);
    await post(admin, `/v1/store/companies/${companyId}/api-clients/${extra.id}/actions/revoke`).expect(409);
    await request(ctx.server)
      .post('/v1/auth/token')
      .send({ grant_type: 'client_credentials', client_id: extra.clientId, client_secret: 'whatever' })
      .expect(401);
  });
});
