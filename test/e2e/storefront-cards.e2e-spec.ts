import { type FakeWebhookSender } from '@integrations/webhooks-out/fake-webhook-sender';
import { WEBHOOK_SENDER } from '@integrations/webhooks-out/webhook-sender.port';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import request from 'supertest';

import { bootFulfilmentApp, type FulfilmentApp } from '../support/fulfilment-e2e';

interface Card {
  slug: string;
  startingPricePerPiece: string | null;
  startingPriceAssumes: { quantity: number } | null;
  moq: number | null;
  leadTimeDays: { min: number; max: number } | null;
  availability: string;
  campaignBadge: { label: string; endsAt: string; promotionId: string } | null;
  referencePrice?: string;
  cacheTags: string[];
}

/**
 * U-B4 storefront cards (D-181, D-307, D-308): real starting prices and their basis, MOQ, lead time and availability;
 * a badge and a struck-through price only from a live automatic promotion that applies; revalidation tags posted on
 * changes. Uses the `other` product type, which no other suite prices.
 */
describe('storefront cards (e2e, U-B4)', () => {
  let ctx: FulfilmentApp;
  let productId: string;
  let typeId: string;
  const slug = `ub4-card-${Date.now() % 1_000_000}`;
  const sku = `UB4-${Date.now() % 1_000_000}`;
  const day = 86_400_000;

  const cards = async () =>
    (
      await request(ctx.server)
        .get('/v1/store/catalog/products')
        .query({ productType: 'other', perPage: 100 })
        .expect(200)
    ).body.data as Card[];
  const card = async () => (await cards()).find((c) => c.slug === slug)!;
  const promotion = async (over: Record<string, unknown>) => {
    const entity = await ctx.prisma.entity.findFirstOrThrow({ where: { isDefault: true } });
    return ctx.prisma.promotion.create({
      data: {
        entityId: entity.id,
        name: 'ลดราคาทดสอบ (fake)',
        kind: 'automatic',
        priority: 10,
        stacking: 'best_of',
        startsAt: new Date(Date.now() - day),
        endsAt: new Date(Date.now() + 7 * day),
        conditions: { channels: ['web'], catalogProductIds: [productId] },
        benefit: { type: 'percent', pct: '10' },
        status: 'active',
        ...over,
      },
    });
  };

  beforeAll(async () => {
    process.env['STOREFRONT_REVALIDATE_URL'] = 'https://web.packio.invalid/api/revalidate';
    process.env['STOREFRONT_REVALIDATE_SECRET'] = 'fake-revalidate-secret';
    ctx = await bootFulfilmentApp();
    const type = await ctx.prisma.productType.findUniqueOrThrow({ where: { code: 'other' } });
    typeId = type.publicId;
    const product = await ctx.prisma.catalogProduct.create({
      data: {
        productTypeId: type.id,
        slug,
        nameTh: 'การ์ดทดสอบ (fake)',
        nameEn: 'Card test (fake)',
        status: 'active',
        quantityMin: 500,
        priceHint: {
          create: {
            quantity: 1000,
            unitPrice: '4.123',
            leadTimeDays: 8,
            specSummary: [],
            calculatorVersion: 'fake',
            computedAt: new Date(),
          },
        },
      },
    });
    productId = product.publicId;
    await ctx.prisma.stockProduct.create({
      data: {
        productTypeId: type.id,
        sku,
        nameTh: 'สต็อกทดสอบ',
        nameEn: 'Stock test',
        unit: 'piece',
        status: 'active',
      },
    });
  });

  afterAll(async () => {
    await ctx.prisma.promotion.updateMany({
      where: { name: 'ลดราคาทดสอบ (fake)' },
      data: { status: 'ended' },
    });
    delete process.env['STOREFRONT_REVALIDATE_URL'];
    delete process.env['STOREFRONT_REVALIDATE_SECRET'];
    await ctx?.app.close();
  });

  it('shows the starting price per piece with its basis, MOQ, lead time and availability — no discount framing (D-307)', async () => {
    const c = await card();
    expect(c).toMatchObject({
      startingPricePerPiece: '4.13', // rounded up to the satang (D-181)
      startingPriceAssumes: { quantity: 1000 },
      moq: 500,
      leadTimeDays: { min: 8, max: 8 },
      availability: 'rfq',
      campaignBadge: null,
      cacheTags: [`catalog:type:${typeId}`, `catalog:product:${slug}`],
    });
    expect('referencePrice' in c).toBe(false);
    const detail = (await request(ctx.server).get(`/v1/store/catalog/products/${slug}`).expect(200))
      .body as Card;
    expect(detail).toMatchObject({ startingPricePerPiece: '4.13', moq: 500 });
    const types = (await request(ctx.server).get('/v1/store/catalog/product-types').expect(200))
      .body as (Card & {
      code: string;
    })[];
    expect(types.find((t) => t.code === 'other')).toMatchObject({ startingPricePerPiece: '4.13', moq: 500 });
  });

  it('badges and strikes through only with a live automatic promotion that applies to everyone (D-307, D-181)', async () => {
    // Not badges: a coupon, a promotion without a real end date, one for another channel, one not started.
    await promotion({ kind: 'coupon' });
    await promotion({ endsAt: null });
    await promotion({ conditions: { channels: ['cs'], catalogProductIds: [productId] } });
    await promotion({ startsAt: new Date(Date.now() + day) });
    let c = await card();
    expect(c.campaignBadge).toBeNull();
    expect('referencePrice' in c).toBe(false);

    // A restricted one badges but never strikes a price through.
    const restricted = await promotion({
      conditions: { catalogProductIds: [productId], firstOrderOnly: true },
      priority: 20,
    });
    c = await card();
    expect(c.campaignBadge).toMatchObject({ promotionId: restricted.publicId, label: 'ลดราคาทดสอบ (fake)' });
    expect('referencePrice' in c).toBe(false);
    expect(c.startingPricePerPiece).toBe('4.13');
    expect(c.cacheTags).toContain(`promo:${restricted.publicId}`);
    await ctx.prisma.promotion.update({ where: { id: restricted.id }, data: { status: 'ended' } });

    // An unconditional 10 % one: promoted price with the starting price struck through.
    const live = await promotion({ priority: 30 });
    c = await card();
    expect(c).toMatchObject({
      campaignBadge: { promotionId: live.publicId, endsAt: expect.any(String) },
      startingPricePerPiece: '3.72', // 4.123 − 10 %, up to the satang
      referencePrice: '4.13',
    });
    // Stock: a badge for the type, never a reference price.
    const typeWide = await promotion({ conditions: { productTypeCodes: ['other'] }, priority: 5 });
    const stock = (await request(ctx.server).get(`/v1/store/catalog/stock-products/${sku}`).expect(200))
      .body as Card & { sku: string };
    expect(stock.campaignBadge).toMatchObject({ promotionId: typeWide.publicId });
    expect('referencePrice' in stock).toBe(false);
  });

  it('records and posts the revalidation tags of a changed promotion, signed (D-308)', async () => {
    const promo = await promotion({ priority: 1 });
    await ctx.prisma.withTx((tx) =>
      ctx.app.get(DomainEvents).record(tx, {
        type: 'promotion.updated',
        aggregateType: 'promotion',
        aggregateId: promo.publicId,
        payload: { promotionId: promo.publicId },
      }),
    );
    await ctx.pump();
    const event = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: {
        type: 'storefront.cache_invalidated',
        payload: { path: ['cause'], equals: 'promotion.updated' },
      },
      orderBy: { occurredAt: 'desc' },
    });
    const tags = (event.payload as { tags: string[] }).tags;
    expect(tags).toEqual(
      expect.arrayContaining([
        `promo:${promo.publicId}`,
        `catalog:type:${typeId}`,
        `catalog:product:${slug}`,
      ]),
    );
    const sent = ctx.app
      .get<FakeWebhookSender>(WEBHOOK_SENDER)
      .sent.find((s) => s.body.includes(promo.publicId));
    expect(sent).toMatchObject({ url: 'https://web.packio.invalid/api/revalidate' });
    expect(sent!.headers['x-packio-signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
  });
});
