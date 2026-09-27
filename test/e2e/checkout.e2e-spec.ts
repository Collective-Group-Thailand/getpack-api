import { randomUUID } from 'node:crypto';

import { MoneyDecimal } from '@common/money/money';

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
  seedShipping,
  staffToken,
} from '../support/commerce-e2e';

interface Totals {
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  shippingNetAmount: string;
  whtAmount: string;
  cashAmount: string;
}

/** Checkout: server re-pricing, shipping per destination, order group + orders (B3.1 slice 4). */
describe('checkout (e2e, B3.1)', () => {
  let ctx: CommerceApp;
  let fixture: DevFolding;
  let codes: string[];

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    fixture = await foldingReady(ctx);
    codes = postcodes(ctx, 3);
    await seedShipping(ctx, fixture.factoryPublicId, codes.slice(0, 2));
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  /** A customer with a two-item cart: 1000 pcs to one address, 2000 split over two addresses. */
  async function twoItemCart(n: number) {
    const { token } = await customerToken(ctx, n);
    const home = await addAddress(ctx, token, codes[0]!, 'บ้าน');
    const shop = await addAddress(ctx, token, codes[1]!, 'ร้าน');
    const quote = await saveQuote(ctx, token, fixture, [1000, 2000]);
    await as(ctx, token)
      .post('/v1/store/cart/items', { quoteId: quote.id, quoteOptionId: quote.options[0]!.id, designOption: 'own_file' })
      .expect(201);
    await as(ctx, token)
      .post('/v1/store/cart/items', {
        quoteId: quote.id,
        quoteOptionId: quote.options[1]!.id,
        designOption: 'own_file',
        destinations: [
          { addressId: home.id, quantity: 1200 },
          { addressId: shop.id, quantity: 800 },
        ],
      })
      .expect(201);
    return { token, quote, home, shop };
  }

  it('previews and places one group with one order per item, shipping priced per destination (D-013, D-060)', async () => {
    const { token, quote } = await twoItemCart(1);
    const preview = await as(ctx, token).post('/v1/store/checkout/actions/preview', {}).expect(200);
    const orders = preview.body.orders as { totals: Totals; destinations: { shippingNetAmount: string }[] }[];
    expect(orders).toHaveLength(2);
    expect(orders[0]!.destinations.map((d) => d.shippingNetAmount)).toEqual(['120.00']);
    expect(orders[1]!.destinations.map((d) => d.shippingNetAmount)).toEqual(['120.00', '120.00']);
    expect(orders[1]!.totals.shippingNetAmount).toBe('240.00');
    const total = preview.body.totals as Totals;
    expect(total.whtAmount).toBe('0.00');
    // Product side = the locked quotation (without its own, unpriced shipping) + shipping with VAT.
    const productSide = quote.options.reduce((a, o) => a.add(o.grossAmount), new MoneyDecimal(0));
    expect(new MoneyDecimal(total.grossAmount).toFixed(2)).toBe(productSide.add('385.20').toFixed(2));

    const key = randomUUID();
    const placed = await as(ctx, token)
      .post('/v1/store/checkout', { expectedGrossAmount: total.grossAmount, ccEmails: ['Account@Example.com'] })
      .set('Idempotency-Key', key)
      .expect(201);
    expect(placed.headers['location']).toBe(`/v1/store/order-groups/${placed.body.id}`);
    expect(placed.body).toMatchObject({
      status: 'waiting_payment',
      channel: 'web',
      groupCode: expect.stringMatching(/^DEVOG-/),
      ccEmails: ['account@example.com'],
      totals: { grossAmount: total.grossAmount, currency: 'THB' },
    });
    expect(placed.body.orders).toHaveLength(2);
    expect(placed.body.orders[0]).toMatchObject({
      status: 'waiting_payment',
      orderCode: expect.stringMatching(/^DEVOR-/),
      quantityOrdered: 1000,
    });
    expect(JSON.stringify(placed.body)).not.toContain(fixture.factoryPublicId);
    const hours = (Date.parse(placed.body.expiresAt) - Date.parse(placed.body.placedAt)) / 3_600_000;
    expect(Math.round(hours)).toBe(7 * 24);

    const replay = await as(ctx, token)
      .post('/v1/store/checkout', { expectedGrossAmount: total.grossAmount, ccEmails: ['Account@Example.com'] })
      .set('Idempotency-Key', key)
      .expect(201);
    expect(replay.body.id).toBe(placed.body.id);

    const group = await ctx.prisma.orderGroup.findUniqueOrThrow({
      where: { publicId: placed.body.id },
      include: { orders: { include: { lines: true, destinations: true } }, cart: true },
    });
    expect(group.cart!.status).toBe('checked_out');
    expect(group.orders[1]!.destinations.map((d) => d.quantity)).toEqual([1200, 800]);
    expect(group.orders[0]!.snapshotSha256).toHaveLength(32);
    expect(group.orders[0]!.buyCostNet).not.toBeNull();
    expect((await ctx.prisma.quote.findUniqueOrThrow({ where: { publicId: quote.id } })).status).toBe('converted');
    expect(
      await ctx.prisma.domainEvent.count({ where: { type: 'order_group.placed', aggregateId: placed.body.id } }),
    ).toBe(1);
    expect(await ctx.prisma.domainEvent.count({ where: { type: 'order.placed', payload: { path: ['groupId'], equals: placed.body.id } } })).toBe(2);
    const cart = await as(ctx, token).get('/v1/store/cart').expect(200);
    expect(cart.body.items).toEqual([]);
  });

  it('shows the expected withholding for a juristic customer who withholds (D-174)', async () => {
    const { token } = await twoItemCart(2);
    const province = await ctx.prisma.geoProvince.findUniqueOrThrow({ where: { code: 'DEV1' } });
    const profile = await as(ctx, token)
      .post('/v1/store/tax-profiles', {
        taxType: 'juristic',
        name: 'บริษัท ตัวอย่าง จำกัด',
        taxId: '0000000000019',
        branchType: 'head_office',
        line1: '99/9 ถนนตัวอย่าง',
        provinceId: province.publicId,
        postcode: codes[0],
        withholdsTax: true,
      })
      .expect(201);
    const preview = await as(ctx, token)
      .post('/v1/store/checkout/actions/preview', { taxProfileId: profile.body.id })
      .expect(200);
    const total = preview.body.totals as Totals;
    expect(preview.body.withholding).toBe(true);
    expect(new MoneyDecimal(total.whtAmount).gt(0)).toBe(true);
    expect(new MoneyDecimal(total.grossAmount).sub(total.whtAmount).toFixed(2)).toBe(total.cashAmount);
    await as(ctx, token)
      .post('/v1/store/checkout', { taxProfileId: profile.body.id, expectedGrossAmount: '1.00' })
      .set('Idempotency-Key', randomUUID())
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('checkout.total_changed'));
    const placed = await as(ctx, token)
      .post('/v1/store/checkout', { taxProfileId: profile.body.id })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    const group = await ctx.prisma.orderGroup.findUniqueOrThrow({ where: { publicId: placed.body.id } });
    expect(group.taxProfileSnapshot).toMatchObject({ taxId: '0000000000019', withholdsTax: true });
    expect(group.whtAmount.toFixed(2)).toBe(total.whtAmount);
  });

  it('refuses expired prices, destinations without shipping and requests without Idempotency-Key', async () => {
    const { token } = await customerToken(ctx, 3);
    await as(ctx, token).post('/v1/store/checkout/actions/preview', {}).expect(422);
    const far = await addAddress(ctx, token, codes[2]!, 'ไกล');
    const quote = await saveQuote(ctx, token, fixture, [1000]);
    await as(ctx, token)
      .post('/v1/store/cart/items', {
        quoteId: quote.id,
        quoteOptionId: quote.options[0]!.id,
        designOption: 'own_file',
        destinations: [{ addressId: far.id, quantity: 1000 }],
      })
      .expect(201);
    await as(ctx, token)
      .post('/v1/store/checkout/actions/preview', {})
      .expect(422)
      .expect((res) => expect(res.body.code).toBe('checkout.shipping_unavailable'));
    await as(ctx, token)
      .post('/v1/store/checkout', {})
      .expect(400)
      .expect((res) => expect(res.body.code).toBe('idempotency.key_required'));
    await expireQuote(ctx, quote.id);
    await as(ctx, token)
      .post('/v1/store/checkout/actions/preview', {})
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('checkout.price_expired'));
  });

  it('lets CS place a customer’s order on their behalf with cost masked by permission (D-141)', async () => {
    const { token } = await customerToken(ctx, 4);
    const me = await as(ctx, token).get('/v1/store/customer-profile').expect(200);
    await addAddress(ctx, token, codes[0]!);
    const cs = await staffToken(ctx, 'cs');
    const saved = await as(ctx, cs)
      .post('/v1/admin/quotes', {
        productTypeCode: 'folding_carton',
        configuration: foldingConfiguration(fixture, [1000]),
        customerUserId: me.body.id,
      })
      .expect(201);
    await as(ctx, cs)
      .post(`/v1/admin/customers/${me.body.id}/cart/items`, {
        quoteId: saved.body.id,
        quoteOptionId: saved.body.options[0].id,
        designOption: 'own_file',
      })
      .expect(201);
    const placed = await as(ctx, cs)
      .post(`/v1/admin/customers/${me.body.id}/checkout`, { csRemarks: 'ลูกค้าโทรสั่ง' })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    expect(placed.body).toMatchObject({ channel: 'cs', csRemarks: 'ลูกค้าโทรสั่ง', customerId: me.body.id });
    expect(placed.body.orders[0].internal).toMatchObject({ buyCostNet: null, marginAmount: null });
    const group = await ctx.prisma.orderGroup.findUniqueOrThrow({ where: { publicId: placed.body.id } });
    expect(group.onBehalfOfUserId).not.toBeNull();
    const profile = await ctx.prisma.customerProfile.findFirstOrThrow({ where: { user: { publicId: me.body.id } } });
    expect(profile.customerCode).toMatch(/^DEVCU-/);
  });
});
