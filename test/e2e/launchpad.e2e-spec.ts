import { randomUUID } from 'node:crypto';

import { DeepLinksService } from '@platform/notifications/deep-links.service';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  activeCompany,
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
import { bootFulfilmentApp, type FulfilmentApp, payDue } from '../support/fulfilment-e2e';

interface Launchpad {
  designs: { id: string }[];
  reorderCandidates: { orderId: string; source: string }[];
  needsAction: { action: string; subject: string; id: string; code: string; amount: string | null }[];
  nextStep: { kind: string; target: string | null; targetId: string | null };
}

/** U5.B1 launchpad, defaults and notification deep links (D-297, D-298, D-299) — each scoped to its caller. */
describe('launchpad, defaults and deep links (e2e, U5.B1)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let code: string;
  let a: { token: string; phone: string };
  let b: { token: string; phone: string };
  let group: Awaited<ReturnType<typeof placeOrder>>;

  const launchpad = async (token: string) =>
    (await as(ctx, token).get('/v1/store/me/launchpad').expect(200)).body as Launchpad;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    [code] = postcodes(ctx, 1) as [string];
    await seedShipping(ctx, fixture.factoryPublicId, [code]);
    await setFlag(ctx, 'payments.scb', true);
    a = await customerToken(ctx, 201);
    b = await customerToken(ctx, 202);
  });

  afterAll(async () => {
    await setFlag(ctx, 'payments.scb', false);
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  it('recommends starting a configuration when nothing waits (D-297)', async () => {
    expect(await launchpad(a.token)).toEqual({
      designs: [],
      reorderCandidates: [],
      needsAction: [],
      nextStep: { kind: 'start_configuration', target: null, targetId: null },
    });
  });

  it('lists what waits for me in recommendation order: pay, then upload artwork (D-297, D-438)', async () => {
    group = await placeOrder(ctx, a.token, fixture, code);
    let pad = await launchpad(a.token);
    const orderId = group.orders[0]!.id;
    // D-438 (B-API-4): an own-file order waits for my file ("รอไฟล์จากคุณ") from the start; paying comes first.
    expect(pad.needsAction).toEqual([
      expect.objectContaining({
        action: 'pay',
        subject: 'order_group',
        id: group.id,
        code: group.groupCode,
        amount: group.totals.cashAmount,
        overdue: false,
      }),
      expect.objectContaining({ action: 'upload_artwork', subject: 'order', id: orderId }),
    ]);
    expect(pad.nextStep).toEqual({ kind: 'pay', target: 'order_group', targetId: group.id });

    await payDue(ctx, a.token, group.id);
    await ctx.pump();
    // Paid: the upload is all that waits for me, without waiting for a dieline.
    pad = await launchpad(a.token);
    expect(pad.needsAction).toEqual([
      expect.objectContaining({ action: 'upload_artwork', subject: 'order', id: orderId }),
    ]);
    expect(pad.nextStep).toEqual({ kind: 'upload_artwork', target: 'order', targetId: orderId });
  });

  it('never shows another customer’s records (IDOR)', async () => {
    const pad = await launchpad(b.token);
    expect(pad.needsAction).toEqual([]);
    expect(pad.nextStep.kind).toBe('start_configuration');
    const defaults = (await as(ctx, b.token).get('/v1/store/me/defaults').expect(200)).body;
    expect(defaults).toEqual({ deliveryAddress: null, taxProfile: null, companies: [], productTypes: [] });
    // Staff tokens do not reach the store surface.
    await as(ctx, await staffToken(ctx, 'cs'))
      .get('/v1/store/me/launchpad')
      .expect(403);
  });

  it('returns my defaults for pre-filling: address, last material per type, companies with brand kit (D-298)', async () => {
    const companyId = await activeCompany(ctx, a.token, 201);
    const defaults = (await as(ctx, a.token).get('/v1/store/me/defaults').expect(200)).body;
    const quote = await ctx.prisma.quote.findFirstOrThrow({
      where: { customer: { phone: a.phone } },
      orderBy: { createdAt: 'desc' },
    });
    const cfg = (quote.input as { configuration: { materialId: string } }).configuration;
    expect(defaults.deliveryAddress).toEqual({ id: expect.any(String), basis: expect.any(String) });
    expect(defaults.productTypes).toEqual([
      expect.objectContaining({ productTypeCode: 'folding_carton', materialId: cfg.materialId }),
    ]);
    expect(defaults.companies).toEqual([
      expect.objectContaining({
        id: companyId,
        mayOrder: true,
        hasBrandKit: false,
        taxId: expect.any(String),
      }),
    ]);
    const filtered = (
      await as(ctx, a.token).get('/v1/store/me/defaults').query({ productTypes: 'corrugate' }).expect(200)
    ).body;
    expect(filtered.productTypes).toEqual([]);
    await as(ctx, a.token).get('/v1/store/me/defaults').query({ productTypes: 'Not A Code!' }).expect(422);
  });

  it('resolves a notification deep link only for its recipient, on its zone (D-299)', async () => {
    const orderId = group.orders[0]!.id;
    const user = await ctx.prisma.user.findFirstOrThrow({ where: { phone: a.phone } });
    const event = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: { aggregateType: 'order', aggregateId: orderId },
    });
    const notification = await ctx.prisma.notification.create({
      data: { eventId: event.id, recipientUserId: user.id, channel: 'line', status: 'queued' },
    });
    const url = await ctx.app.get(DeepLinksService).issue({
      id: notification.id,
      recipient: user,
      event,
    });
    const token = url!.split('/l/')[1]!;
    const resolve = (t: string, surface = 'store') =>
      as(ctx, t)
        .post(`/v1/${surface}/deep-links/actions/resolve`, { token })
        .set('Idempotency-Key', randomUUID());
    expect((await resolve(a.token).expect(200)).body).toEqual({
      path: `/account/orders/${orderId}`,
      expiresAt: expect.any(String),
    });
    await resolve(b.token).expect(404);
    await resolve(await staffToken(ctx, 'cs'), 'admin').expect(404);
    await as(ctx, a.token).post('/v1/store/deep-links/actions/resolve', { token: 'not-a-token' }).expect(422);
    await ctx.prisma.deepLinkToken.update({
      where: { notificationId: notification.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const gone = await resolve(a.token).expect(410);
    expect(gone.body.code).toBe('deep_links.expired');
  });
});
