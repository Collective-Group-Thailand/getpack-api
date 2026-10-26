import { randomUUID } from 'node:crypto';

import { PDF_RENDERER } from '@integrations/pdf/pdf-renderer.port';

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
  staffToken,
} from '../support/commerce-e2e';
import {
  approveArtwork,
  bootFulfilmentApp,
  factoryToken,
  type FulfilmentApp,
  payDue,
} from '../support/fulfilment-e2e';

type FakeRenderer = { rendered: string[] };

/** U2.6 packaging spec sheet (D-287). */
describe('packaging spec sheet (e2e, U2.6)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let token: string;
  let groupId: string;
  let orderId: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    const [code] = postcodes(ctx, 1) as [string];
    await seedShipping(ctx, fixture.factoryPublicId, [code]);
    token = (await customerToken(ctx, 111)).token;
    const address = await addAddress(ctx, token, code);
    const quote = await saveQuote(ctx, token, fixture, [1000]);
    await as(ctx, token)
      .post('/v1/store/cart/items', {
        quoteId: quote.id,
        quoteOptionId: quote.options[0]!.id,
        destinations: [{ addressId: address.id, quantity: 1000 }],
        designOption: 'own_file',
      })
      .expect(201);
    const placed = await as(ctx, token)
      .post('/v1/store/checkout', {})
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    orderId = (placed.body.orders as { id: string }[])[0]!.id;
    groupId = placed.body.id as string;
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  it('is issued only once the artwork is approved', async () => {
    const early = await as(ctx, token).get(`/v1/store/orders/${orderId}/spec-sheet`).expect(409);
    expect(early.body.code).toBe('orders.spec_sheet_unavailable');
  });

  it('gives the customer, staff and the order’s factory the same sheet, Thai or English (D-287)', async () => {
    // B-API-6: Prepress reviews paid orders only.
    await payDue(ctx, token, groupId);
    await approveArtwork(ctx, token, await staffToken(ctx, 'prepress'), orderId);
    const renderer = ctx.app.get<FakeRenderer>(PDF_RENDERER);
    const before = renderer.rendered.length;
    const th = await as(ctx, token).get(`/v1/store/orders/${orderId}/spec-sheet`).expect(200);
    expect(th.body).toMatchObject({
      url: expect.stringMatching(/^https?:\/\//),
      fileName: expect.stringMatching(/-th\.pdf$/),
    });
    const html = renderer.rendered.at(-1)!;
    expect(html).toContain('ข้อมูลจำเพาะบรรจุภัณฑ์');
    expect(html).toContain(`/account/orders/${orderId}`);
    expect(html).toContain('<svg');
    // Same content: the stored file, no new render.
    await as(ctx, token).get(`/v1/store/orders/${orderId}/spec-sheet?lang=th`).expect(200);
    expect(renderer.rendered.length).toBe(before + 1);
    const en = await as(ctx, await staffToken(ctx, 'admin'))
      .get(`/v1/admin/orders/${orderId}/spec-sheet?lang=en`)
      .expect(200);
    expect(en.body.fileName).toMatch(/-en\.pdf$/);
    expect(renderer.rendered.at(-1)).toContain('Packaging specification');
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { publicId: orderId } });
    expect(await ctx.prisma.orderSpecSheet.count({ where: { orderId: order.id } })).toBe(2);

    // The factory of the order's job reads it; another customer does not.
    const job = await ctx.prisma.productionJob.findFirst({
      where: { orderId: order.id },
      include: { factory: true },
    });
    if (job) {
      const partner = await factoryToken(ctx, job.factory.publicId, 'factory_owner', 111);
      await as(ctx, partner).get(`/v1/partner/orders/${orderId}/spec-sheet`).expect(200);
    }
    const other = (await customerToken(ctx, 112)).token;
    await as(ctx, other).get(`/v1/store/orders/${orderId}/spec-sheet`).expect(404);
  });
});
