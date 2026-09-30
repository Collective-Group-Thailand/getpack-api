import { randomUUID } from 'node:crypto';

import { MoneyDecimal } from '@common/money/money';

import { type DevCorrugate, seedDevCorrugate } from '../../prisma/seed/dev-corrugate';
import {
  addAddress,
  as,
  bootCommerceApp,
  type CommerceApp,
  customerToken,
  foldingBackToRfq,
  foldingReady,
  postcodes,
  seedShipping,
} from '../support/commerce-e2e';

/** A corrugate quotation through cart and checkout: re-priced by its calculator, shipped with the corrugate packer (U-B6). */
describe('corrugate checkout (e2e, U-B6)', () => {
  let ctx: CommerceApp;
  let fixture: DevCorrugate;
  let codes: string[];

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    await foldingReady(ctx);
    fixture = (await ctx.prisma.$transaction((tx) => seedDevCorrugate(tx), { timeout: 60_000 })).fixture;
    await ctx.prisma.productType.update({ where: { code: 'corrugated' }, data: { quoteMode: 'instant' } });
    codes = postcodes(ctx, 1);
    await seedShipping(ctx, fixture.factoryPublicId, codes);
  });

  afterAll(async () => {
    // Other suites expect corrugate on RFQ (A-16).
    await ctx?.prisma.productType.update({ where: { code: 'corrugated' }, data: { quoteMode: 'rfq' } });
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  it('saves, previews and places a corrugate order with plates in the price and shipping per destination', async () => {
    const { token } = await customerToken(ctx, 1);
    await addAddress(ctx, token, codes[0]!, 'โกดัง');
    const saved = await as(ctx, token)
      .post('/v1/store/quotes', {
        productTypeCode: 'corrugated',
        configuration: {
          patternId: fixture.rscPatternPublicId,
          catalogProductId: fixture.catalogProductPublicId,
          w: 300,
          l: 400,
          d: 250,
          materialId: fixture.boardPublicId,
          difficultyLevelId: fixture.difficultyLevelPublicId,
          quantities: [1000],
          parts: [{ printFront: [{ inkColourId: fixture.inkColourPublicId, area: 'top' }] }],
        },
      })
      .expect(201);
    const option = saved.body.options[0] as { id: string; grossAmount: string; toolingAmount?: string };
    expect(saved.body).toMatchObject({ productTypeCode: 'corrugated', source: 'instant' });
    await as(ctx, token)
      .post('/v1/store/cart/items', {
        quoteId: saved.body.id,
        quoteOptionId: option.id,
        designOption: 'own_file',
      })
      .expect(201);

    const preview = await as(ctx, token).post('/v1/store/checkout/actions/preview', {}).expect(200);
    const orders = preview.body.orders as { destinations: { shippingNetAmount: string }[] }[];
    expect(orders).toHaveLength(1);
    expect(Number(orders[0]!.destinations[0]!.shippingNetAmount)).toBeGreaterThan(0);
    const total = preview.body.totals as { grossAmount: string; shippingNetAmount: string };
    // The product side is the locked quotation (plates included), the rest is shipping with VAT.
    const shippingGross = new MoneyDecimal(total.shippingNetAmount).mul('1.07');
    expect(new MoneyDecimal(total.grossAmount).sub(shippingGross).toFixed(2)).toBe(
      new MoneyDecimal(option.grossAmount).toFixed(2),
    );

    const placed = await as(ctx, token)
      .post('/v1/store/checkout', { expectedGrossAmount: total.grossAmount })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    expect(placed.body.orders).toEqual([expect.objectContaining({ quantityOrdered: 1000 })]);
    expect(JSON.stringify(placed.body)).not.toContain(fixture.factoryPublicId);
    const group = await ctx.prisma.orderGroup.findUniqueOrThrow({
      where: { publicId: placed.body.id as string },
      include: { orders: true },
    });
    const order = group.orders[0]!;
    const type = await ctx.prisma.productType.findUniqueOrThrow({ where: { id: order.productTypeId } });
    expect(type.calculatorKey).toBe('corrugate');
    expect(order.buyCostNet).not.toBeNull();
  });
});
