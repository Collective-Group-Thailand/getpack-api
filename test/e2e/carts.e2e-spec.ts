import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  addAddress,
  as,
  bootCommerceApp,
  type CommerceApp,
  customerToken,
  expireQuote,
  foldingBackToRfq,
  foldingConfiguration,
  foldingReady,
  postcodes,
  saveQuote,
  staffToken,
} from '../support/commerce-e2e';

interface CartBody {
  id: string;
  items: {
    id: string;
    quantity: number;
    quoteId: string;
    priceLocked: boolean;
    destinationsComplete: boolean;
    pendingReprice: null | { differenceAmount: string; quoteId: string };
    destinations: { quantity: number; address: { postcode: string } }[];
  }[];
}

/** The cart: price-locked quotation options, destinations, re-price with confirmation (B3.1 slice 3, D-051). */
describe('carts (e2e, B3.1)', () => {
  let ctx: CommerceApp;
  let fixture: DevFolding;
  let customer: string;
  let cs: string;
  let codes: string[];

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    fixture = await foldingReady(ctx);
    customer = (await customerToken(ctx, 1)).token;
    cs = await staffToken(ctx, 'cs');
    codes = postcodes(ctx, 2);
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  it('adds quotation options with default and split destinations, one item per option', async () => {
    const home = await addAddress(ctx, customer, codes[0]!, 'บ้าน');
    const shop = await addAddress(ctx, customer, codes[1]!, 'ร้าน');
    const quote = await saveQuote(ctx, customer, fixture, [1000, 2000]);
    const [small, large] = quote.options;

    const first = await as(ctx, customer)
      .post('/v1/store/cart/items', { quoteId: quote.id, quoteOptionId: small!.id, designOption: 'own_file' })
      .expect(201);
    const cart = first.body as CartBody;
    expect(cart.items[0]).toMatchObject({ quantity: 1000, priceLocked: true, destinationsComplete: true });
    expect(cart.items[0]!.destinations[0]!.address.postcode).toBe(codes[0]);
    expect(first.headers['etag']).toBeDefined();

    await as(ctx, customer)
      .post('/v1/store/cart/items', { quoteId: quote.id, quoteOptionId: small!.id, designOption: 'own_file' })
      .expect(409);
    await as(ctx, customer)
      .post('/v1/store/cart/items', {
        quoteId: quote.id,
        quoteOptionId: large!.id,
        designOption: 'own_file',
        destinations: [
          { addressId: home.id, quantity: 1500 },
          { addressId: shop.id, quantity: 400 },
        ],
      })
      .expect(422);
    const second = await as(ctx, customer)
      .post('/v1/store/cart/items', {
        quoteId: quote.id,
        quoteOptionId: large!.id,
        designOption: 'own_file',
        destinations: [
          { addressId: home.id, quantity: 1500 },
          { addressId: shop.id, quantity: 500 },
        ],
      })
      .expect(201);
    expect((second.body as CartBody).items[1]!.destinations.map((d) => d.quantity)).toEqual([1500, 500]);

    const etag = second.headers['etag'] as string;
    const itemId = (second.body as CartBody).items[0]!.id;
    await as(ctx, customer).patch(`/v1/store/cart/items/${itemId}`, { designNote: 'x' }).expect(428);
    await as(ctx, customer)
      .patch(`/v1/store/cart/items/${itemId}`, { designNote: 'ใช้โลโก้เดิม' })
      .set('If-Match', etag)
      .expect(200);
  });

  it('checks design and mockup options against the quotation (D-072)', async () => {
    const plain = await saveQuote(ctx, customer, fixture, [3000]);
    await as(ctx, customer)
      .post('/v1/store/cart/items', {
        quoteId: plain.id,
        quoteOptionId: plain.options[0]!.id,
        designOption: 'hired_design',
      })
      .expect(422)
      .expect((res) => expect(res.body.code).toBe('cart.design_option_unavailable'));
    await as(ctx, customer)
      .post('/v1/store/cart/items', {
        quoteId: plain.id,
        quoteOptionId: plain.options[0]!.id,
        designOption: 'own_file',
        mockupOption: 'with_print',
      })
      .expect(422)
      .expect((res) => expect(res.body.code).toBe('cart.mockup_price_unavailable'));
    const other = await customerToken(ctx, 2);
    await as(ctx, other.token)
      .post('/v1/store/cart/items', {
        quoteId: plain.id,
        quoteOptionId: plain.options[0]!.id,
        designOption: 'own_file',
      })
      .expect(404);
  });

  it('re-prices an item past its lock and waits for the client to confirm (D-051)', async () => {
    const quote = await saveQuote(ctx, customer, fixture, [4000]);
    const added = await as(ctx, customer)
      .post('/v1/store/cart/items', {
        quoteId: quote.id,
        quoteOptionId: quote.options[0]!.id,
        designOption: 'own_file',
      })
      .expect(201);
    const item = (added.body as CartBody).items.find((i) => i.quoteId === quote.id)!;
    await as(ctx, customer).post(`/v1/store/cart/items/${item.id}/actions/reprice`).expect(409);

    await expireQuote(ctx, quote.id);
    const expired = (await as(ctx, customer).get('/v1/store/cart').expect(200)).body as CartBody;
    expect(expired.items.find((i) => i.id === item.id)!.priceLocked).toBe(false);

    const repriced = await as(ctx, customer)
      .post(`/v1/store/cart/items/${item.id}/actions/reprice`)
      .expect(200);
    const pending = (repriced.body as CartBody).items.find((i) => i.id === item.id)!.pendingReprice!;
    expect(pending.differenceAmount).toBe('0.00');
    expect(pending.quoteId).not.toBe(quote.id);

    const confirmed = await as(ctx, customer)
      .post(`/v1/store/cart/items/${item.id}/actions/confirm-reprice`)
      .set('If-Match', repriced.headers['etag'] as string)
      .expect(200);
    const after = (confirmed.body as CartBody).items.find((i) => i.id === item.id)!;
    expect(after).toMatchObject({ priceLocked: true, pendingReprice: null, quoteId: pending.quoteId });
  });

  it('lets CS build a customer’s cart from a quotation saved for them (channel cs)', async () => {
    const me = await as(ctx, customer).get('/v1/store/customer-profile').expect(200);
    const saved = await as(ctx, cs)
      .post('/v1/admin/quotes', {
        productTypeCode: 'folding_carton',
        configuration: foldingConfiguration(fixture, [5000]),
        customerUserId: me.body.id,
        note: 'ลูกค้าโทรมา (fake)',
      })
      .expect(201);
    // U-B0.2: CS's internal note, the customer code and the channel filter.
    expect(saved.body).toMatchObject({ note: 'ลูกค้าโทรมา (fake)', channel: 'cs', rfq: null });
    const byChannel = await as(ctx, cs)
      .get(`/v1/admin/quotes?channel=cs&customerId=${me.body.id as string}`)
      .expect(200);
    expect((byChannel.body.data as { id: string }[]).map((q) => q.id)).toContain(saved.body.id);
    expect(
      (
        await as(ctx, cs)
          .get(`/v1/admin/quotes?channel=web&customerId=${me.body.id as string}`)
          .expect(200)
      ).body.data,
    ).not.toContainEqual(expect.objectContaining({ id: saved.body.id }));
    const cart = await as(ctx, cs)
      .post(`/v1/admin/customers/${me.body.id}/cart/items`, {
        quoteId: saved.body.id,
        quoteOptionId: saved.body.options[0].id,
        designOption: 'own_file',
      })
      .expect(201);
    expect(cart.body).toMatchObject({ channel: 'cs', customerId: me.body.id });
    const web = (await as(ctx, customer).get('/v1/store/cart').expect(200)).body as CartBody;
    expect(web.id).not.toBe(cart.body.id);
    const prepress = await staffToken(ctx, 'prepress');
    await as(ctx, prepress).get(`/v1/admin/customers/${me.body.id}/cart`).expect(403);
  });
});
