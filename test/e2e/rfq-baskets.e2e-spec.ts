import { randomUUID } from 'node:crypto';

import { as, customerToken, staffToken } from '../support/commerce-e2e';
import { bootFulfilmentApp, type FulfilmentApp } from '../support/fulfilment-e2e';

interface Basket {
  id: string;
  basketCode: string | null;
  status: string;
  conversationId: string | null;
  items: {
    id: string;
    productType: { code: string };
    rfq: { id: string; rfqCode: string; status: string; quotations: { id: string; status: string }[] } | null;
  }[];
}

/** U5.B3 multi-item RFQ basket (D-301): draft, one submission, one conversation, per-item quotes, cart conversion. */
describe('RFQ baskets (e2e, U5.B3)', () => {
  let ctx: FulfilmentApp;
  let a: string;
  let b: string;
  let cs: string;
  let basket: Basket;

  const post = (t: string, path: string, body: Record<string, unknown> = {}) =>
    as(ctx, t).post(path, body).set('Idempotency-Key', randomUUID());
  const item = (code: string, over: object = {}) => ({
    productTypeCode: code,
    spec: { material: 'PP 50 micron (fake)' },
    lengthMm: 1000,
    widthMm: 48,
    heightMm: 1,
    quantities: [500, 1000],
    ...over,
  });

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    a = (await customerToken(ctx, 221)).token;
    b = (await customerToken(ctx, 222)).token;
    cs = await staffToken(ctx, 'cs');
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('builds a draft item by item and refuses an invalid item under its path (D-301)', async () => {
    await post(a, '/v1/store/rfq-baskets/draft/items', item('custom_tape')).expect(201);
    await post(a, '/v1/store/rfq-baskets/draft/items', item('pop_display', { quantities: [200] })).expect(
      201,
    );
    const bad = await post(
      a,
      '/v1/store/rfq-baskets/draft/items',
      item('custom_tape', { quantities: [5, 5] }),
    );
    expect(bad.status).toBe(422);
    expect(bad.body.errors[0].path).toBe('item.quantities');
    await post(a, '/v1/store/rfq-baskets/draft/items', item('not_a_type')).expect(422);
    // Units are millimetres (D-183).
    await post(a, '/v1/store/rfq-baskets/draft/items', item('custom_tape', { spec: { unit: 'cm' } })).expect(
      422,
    );

    basket = (await as(ctx, a).get('/v1/store/rfq-baskets/draft').expect(200)).body as Basket;
    expect(basket.items.map((i) => i.productType.code)).toEqual(['custom_tape', 'pop_display']);
    // Submitting needs the delivery postcode.
    await post(a, '/v1/store/rfq-baskets/draft/actions/submit').expect(422);
    await as(ctx, a)
      .patch('/v1/store/rfq-baskets/draft', { deliveryPostcode: '10110', notes: 'ต้องการให้สีตรงกันทุกชิ้น' })
      .expect(200);
    // Another customer's draft is their own, empty.
    expect(((await as(ctx, b).get('/v1/store/rfq-baskets/draft').expect(200)).body as Basket).items).toEqual(
      [],
    );
    await as(ctx, b).delete(`/v1/store/rfq-baskets/draft/items/${basket.items[0]!.id}`).expect(404);
  });

  it('submits once: one RFQ per item and one conversation for the basket (D-301)', async () => {
    basket = (await post(a, '/v1/store/rfq-baskets/draft/actions/submit').expect(200)).body as Basket;
    expect(basket).toMatchObject({
      status: 'submitted',
      basketCode: expect.stringMatching(/^DEVRB-\d{4}-\d{5}$/),
    });
    expect(basket.items.map((i) => i.rfq?.status)).toEqual(['submitted', 'submitted']);
    const rfqs = await ctx.prisma.rfq.findMany({
      where: { basket: { publicId: basket.id } },
      orderBy: { id: 'asc' },
    });
    expect(rfqs.map((r) => [r.deliveryPostcode, r.notes])).toEqual([
      ['10110', 'ต้องการให้สีตรงกันทุกชิ้น'],
      ['10110', 'ต้องการให้สีตรงกันทุกชิ้น'],
    ]);
    // The basket's thread, about the basket, carrying the notes.
    const thread = (await as(ctx, a).get(`/v1/store/conversations/${basket.conversationId}`).expect(200))
      .body;
    expect(thread).toMatchObject({
      subjectType: 'rfq_basket',
      subject: { type: 'rfq_basket', id: basket.id, label: basket.basketCode },
      lastMessage: 'ต้องการให้สีตรงกันทุกชิ้น',
    });
    // A new draft starts empty; the submitted basket is listed and readable only by its customer.
    expect(((await as(ctx, a).get('/v1/store/rfq-baskets/draft').expect(200)).body as Basket).items).toEqual(
      [],
    );
    expect(
      ((await as(ctx, a).get('/v1/store/rfq-baskets').expect(200)).body as Basket[]).map((x) => x.id),
    ).toContain(basket.id);
    await as(ctx, b).get(`/v1/store/rfq-baskets/${basket.id}`).expect(404);
    await as(ctx, b).get(`/v1/store/conversations/${basket.conversationId}`).expect(404);
  });

  it('turns accepted quotations of chosen items into cart lines at the quoted price and validity (D-301)', async () => {
    const tape = basket.items[0]!.rfq!;
    const admin = `/v1/admin/rfqs/${tape.id}`;
    const line = (quantity: number, unitPrice: string) => ({ quantity, unitPrice, leadTimeDays: 10 });
    const drafted = (
      await post(cs, `${admin}/quotations`, { lines: [line(500, '4.5'), line(1000, '4')] }).expect(201)
    ).body as { quotations: { id: string; status: string }[] };
    const quotation = drafted.quotations.find((q) => q.status === 'draft')!;
    await post(cs, `/v1/admin/rfq-quotations/${quotation.id}/actions/send`).expect(200);

    // An item that is not quoted yet cannot be accepted; nothing is accepted then.
    const display = basket.items[1]!;
    await post(a, `/v1/store/rfq-baskets/${basket.id}/actions/accept-items`, {
      items: [
        { itemId: basket.items[0]!.id, rfqQuoteId: quotation.id, quantity: 1000 },
        { itemId: display.id, rfqQuoteId: quotation.id, quantity: 200 },
      ],
    }).expect(422);
    expect((await ctx.prisma.rfq.findUniqueOrThrow({ where: { publicId: tape.id } })).status).toBe('quoted');
    // Someone else cannot accept them.
    await post(b, `/v1/store/rfq-baskets/${basket.id}/actions/accept-items`, {
      items: [{ itemId: basket.items[0]!.id, rfqQuoteId: quotation.id, quantity: 1000 }],
    }).expect(404);
    await post(a, `/v1/store/rfq-baskets/${basket.id}/actions/accept-items`, {
      items: [{ itemId: basket.items[0]!.id, rfqQuoteId: quotation.id, quantity: 750 }],
    }).expect(422);

    const accepted = (
      await post(a, `/v1/store/rfq-baskets/${basket.id}/actions/accept-items`, {
        items: [{ itemId: basket.items[0]!.id, rfqQuoteId: quotation.id, quantity: 1000 }],
      }).expect(200)
    ).body as {
      basket: Basket;
      cart: { items: { quantity: number; unitPrice: string; priceLockedUntil: string; quoteId: string }[] };
    };
    expect(accepted.basket.items[0]!.rfq!.status).toBe('accepted');
    const sent = await ctx.prisma.rfqQuote.findUniqueOrThrow({ where: { publicId: quotation.id } });
    const cartLine = accepted.cart.items.find((i) => i.quantity === 1000)!;
    expect(cartLine).toMatchObject({ unitPrice: '4.00' });
    // Locked until the quotation's validity (the API shows whole seconds).
    expect(Date.parse(cartLine.priceLockedUntil)).toBe(Math.floor(sent.validUntil!.getTime() / 1000) * 1000);
  });
});
