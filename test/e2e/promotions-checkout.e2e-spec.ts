import { randomUUID } from 'node:crypto';

import { MoneyDecimal } from '@common/money/money';
import { REDIS } from '@database/redis.module';
import { type FakeScbGateway } from '@integrations/payments/fake-payment-gateways';
import { SCB_GATEWAY } from '@integrations/payments/payment-gateways.port';
import { PromotionRedemptions } from '@modules/promotions/promotion-redemptions.service';
import { envelopeFromRow } from '@platform/domain-events/domain-event';
import { type Redis } from 'ioredis';
import request from 'supertest';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  addAddress,
  as,
  bootCommerceApp,
  type CommerceApp,
  customerToken,
  foldingBackToRfq,
  foldingReady,
  postcodes,
  saveQuote,
  seedShipping,
  setFlag,
  setSetting,
  staffToken,
} from '../support/commerce-e2e';

interface Line {
  netAmount: string;
  discountAmount: string;
  vatAmount: string;
  grossAmount: string;
}

/** Coupon codes on the cart, discounts at checkout, redemptions reserved / applied / reversed (B3.3 slice 3, D-053). */
describe('promotions at checkout (e2e, B3.3)', () => {
  let ctx: CommerceApp;
  let fixture: DevFolding;
  let postcode: string;
  let marketing: string;
  let redemptions: PromotionRedemptions;
  let scb: FakeScbGateway;
  const automatic: string[] = [];

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    fixture = await foldingReady(ctx);
    postcode = postcodes(ctx, 1)[0]!;
    await seedShipping(ctx, fixture.factoryPublicId, [postcode]);
    await setFlag(ctx, 'payments.scb', true);
    await setFlag(ctx, 'payments.twoc2p', true);
    marketing = await staffToken(ctx, 'marketing');
    redemptions = ctx.app.get(PromotionRedemptions);
    scb = ctx.app.get(SCB_GATEWAY);
  });

  afterAll(async () => {
    // Automatic promotions would discount the other suites' orders (shared database).
    for (const id of automatic) await as(ctx, marketing).post(`/v1/admin/promotions/${id}/actions/end`);
    await setFlag(ctx, 'payments.scb', false);
    await setFlag(ctx, 'payments.twoc2p', false);
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  /** An active coupon promotion with one shared code. */
  async function coupon(conditions: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
    const promo = await as(ctx, marketing)
      .post('/v1/admin/promotions', {
        name: 'ลด 5%',
        kind: 'coupon',
        priority: 100,
        stacking: 'stackable',
        startsAt: '2026-01-01T00:00:00+07:00',
        conditions,
        benefit: { type: 'percent', pct: '5', maxAmount: '100.00' },
        ...extra,
      })
      .expect(201);
    const code = `C${ctx.run}${Math.floor(Math.random() * 1e6)}`;
    await as(ctx, marketing)
      .post(`/v1/admin/promotions/${promo.body.id as string}/coupons`, { kind: 'single', code })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    await as(ctx, marketing)
      .post(`/v1/admin/promotions/${promo.body.id as string}/actions/activate`)
      .expect(200);
    return { id: promo.body.id as string, code };
  }

  async function cartWithItem(token: string, quantity = 1000) {
    const address = await addAddress(ctx, token, postcode);
    const quote = await saveQuote(ctx, token, fixture, [quantity]);
    await as(ctx, token)
      .post('/v1/store/cart/items', {
        quoteId: quote.id,
        quoteOptionId: quote.options[0]!.id,
        designOption: 'own_file',
        destinations: [{ addressId: address.id, quantity }],
      })
      .expect(201);
  }

  const place = (token: string) =>
    as(ctx, token).post('/v1/store/checkout', {}).set('Idempotency-Key', randomUUID()).expect(201);

  /** Runs the promotion subscribers on the events of these aggregates (the worker does this in production). */
  async function deliver(types: string[], aggregateIds: string[]) {
    const events = await ctx.prisma.domainEvent.findMany({
      where: { type: { in: types }, aggregateId: { in: aggregateIds } },
      orderBy: { occurredAt: 'asc' },
    });
    for (const e of events) {
      await ctx.prisma.withTx((tx) =>
        e.type === 'order.cancelled'
          ? redemptions.onCancelled(envelopeFromRow(e), tx)
          : redemptions.onFact(envelopeFromRow(e), tx),
      );
    }
  }

  it('applies a coupon on the cart, discounts the lines at checkout, reserves it, and gives it back on cancel', async () => {
    const promo = await coupon();
    const { token } = await customerToken(ctx, 1);
    await cartWithItem(token);

    await as(ctx, token)
      .post('/v1/store/cart/codes', { code: 'NOPE-0000' })
      .expect(422)
      .expect((r) => {
        expect(r.body).toMatchObject({ code: 'promotions.code_invalid' });
      });
    const applied = await as(ctx, token)
      .post('/v1/store/cart/codes', { code: promo.code.toLowerCase() })
      .expect(201);
    expect(applied.body.codes).toEqual([{ code: promo.code, status: 'validated', rejectReason: null }]);
    await as(ctx, token)
      .post('/v1/store/cart/codes', { code: promo.code })
      .expect(201)
      .expect((r) => expect(r.body.codes).toHaveLength(1));

    const preview = await as(ctx, token).post('/v1/store/checkout/actions/preview', {}).expect(200);
    const order = preview.body.orders[0];
    expect(order.discounts).toEqual([
      expect.objectContaining({ source: 'coupon', promotionId: promo.id, code: promo.code, lineNo: 1 }),
    ]);
    const discount = new MoneyDecimal(order.discounts[0].amount as string);
    expect(discount.gt(0) && discount.lte(100)).toBe(true);
    expect(preview.body.notices).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'promotion.applied' })]),
    );
    for (const l of order.lines as Line[])
      expect(
        new MoneyDecimal(l.grossAmount).eq(
          new MoneyDecimal(l.netAmount).sub(l.discountAmount).add(l.vatAmount),
        ),
      ).toBe(true);
    expect(preview.body.totals.discountAmount).toBe(discount.toFixed(2));

    const placed = await place(token);
    expect(placed.body.totals.discountAmount).toBe(discount.toFixed(2));
    const group = await ctx.prisma.orderGroup.findUniqueOrThrow({
      where: { publicId: placed.body.id as string },
    });
    const redemption = await ctx.prisma.promotionRedemption.findFirstOrThrow({
      where: { orderGroupId: group.id },
      include: { discounts: true, couponCode: true, promotion: true },
    });
    expect(redemption).toMatchObject({ status: 'reserved' });
    expect(redemption.amount.toFixed(2)).toBe(discount.toFixed(2));
    expect(redemption.discounts).toHaveLength(1);
    expect(redemption.couponCode!.usedCount).toBe(1);
    expect(redemption.promotion.spentAmount.toFixed(2)).toBe(discount.toFixed(2));
    expect(
      await ctx.prisma.domainEvent.count({
        where: { type: 'promotion.reserved', aggregateId: group.publicId },
      }),
    ).toBe(1);

    await as(ctx, token)
      .post(`/v1/store/order-groups/${group.publicId}/actions/cancel`, { reasonCode: 'customer_request' })
      .expect(200);
    await deliver(
      ['order.cancelled'],
      (placed.body.orders as { id: string }[]).map((o) => o.id),
    );
    const reversed = await ctx.prisma.promotionRedemption.findUniqueOrThrow({
      where: { id: redemption.id },
      include: { couponCode: true, promotion: true },
    });
    expect(reversed.status).toBe('reversed');
    expect(reversed.couponCode!.usedCount).toBe(0);
    expect(reversed.promotion.spentAmount.toFixed(2)).toBe('0.00');
    const counters = await ctx.prisma.promotionUsageCounter.findMany({
      where: { promotionId: redemption.promotionId },
    });
    expect(counters.every((c) => c.usedCount === 0)).toBe(true);
  });

  it('holds a group to the promotion’s payment method and applies the redemption once paid', async () => {
    const promo = await coupon({ paymentMethods: ['scb_qr'] });
    const { token } = await customerToken(ctx, 2);
    await cartWithItem(token);
    await as(ctx, token).post('/v1/store/cart/codes', { code: promo.code }).expect(201);
    const preview = await as(ctx, token).post('/v1/store/checkout/actions/preview', {}).expect(200);
    expect(preview.body.notices).toEqual(
      expect.arrayContaining([
        { code: 'promotion.payment_method_required', params: { methods: ['scb_qr'] } },
      ]),
    );
    const placed = await place(token);
    const groupId = placed.body.id as string;
    const initiate = (method: string) =>
      as(ctx, token)
        .post(`/v1/store/order-groups/${groupId}/payments`, { method })
        .set('Idempotency-Key', randomUUID());
    await initiate('card_2c2p')
      .expect(422)
      .expect((r) => expect(r.body.code).toBe('promotions.payment_method_required'));
    const payment = (await initiate('scb_qr').expect(201)).body as {
      referenceCode: string;
      cashAmount: string;
    };
    await request(ctx.server)
      .post('/webhooks/scb/payment-confirmation')
      .send(scb.settle(payment.referenceCode, payment.cashAmount))
      .expect(200);

    await deliver(
      ['order.fact_recorded'],
      (placed.body.orders as { id: string }[]).map((o) => o.id),
    );
    const group = await ctx.prisma.orderGroup.findUniqueOrThrow({ where: { publicId: groupId } });
    const redemption = await ctx.prisma.promotionRedemption.findFirstOrThrow({
      where: { orderGroupId: group.id },
    });
    expect(redemption.status).toBe('applied');
    expect(redemption.appliedAt).not.toBeNull();
    expect(
      await ctx.prisma.domainEvent.count({ where: { type: 'promotion.redeemed', aggregateId: groupId } }),
    ).toBe(1);
  });

  it('previews live automatic promotions without a code and says why a code no longer applies', async () => {
    const auto = await as(ctx, marketing)
      .post('/v1/admin/promotions', {
        name: 'ส่งฟรี',
        kind: 'automatic',
        priority: 10,
        stacking: 'stackable',
        startsAt: '2026-01-01T00:00:00+07:00',
        conditions: { minQuantity: 999_999 },
        benefit: { type: 'free_shipping' },
      })
      .expect(201);
    automatic.push(auto.body.id as string);
    await as(ctx, marketing)
      .post(`/v1/admin/promotions/${auto.body.id as string}/actions/activate`)
      .expect(200);
    const exclusive = await coupon({ minQuantity: 999_999 });

    const { token } = await customerToken(ctx, 3);
    await cartWithItem(token);
    await as(ctx, token).post('/v1/store/cart/codes', { code: exclusive.code }).expect(201);
    const preview = await as(ctx, token).post('/v1/store/checkout/actions/preview', {}).expect(200);
    expect(preview.body.orders[0].discounts).toEqual([]);
    expect(preview.body.notices).toEqual(
      expect.arrayContaining([
        {
          code: 'promotion.rejected',
          params: { promotionId: exclusive.id, code: exclusive.code, reason: 'quantity' },
        },
      ]),
    );

    // The same automatic promotion without the quantity condition gives free shipping to everyone.
    const etag = (
      await as(ctx, marketing)
        .get(`/v1/admin/promotions/${auto.body.id as string}`)
        .expect(200)
    ).headers['etag'] as string;
    await as(ctx, marketing)
      .patch(`/v1/admin/promotions/${auto.body.id as string}`, { conditions: {} })
      .set('If-Match', etag)
      .expect(200);
    const again = await as(ctx, token).post('/v1/store/checkout/actions/preview', {}).expect(200);
    const shipping = (again.body.orders[0].lines as (Line & { lineType: string })[]).find(
      (l) => l.lineType === 'shipping',
    );
    if (shipping) {
      expect(again.body.orders[0].discounts).toEqual([
        expect.objectContaining({ source: 'automatic_promotion', promotionId: auto.body.id }),
      ]);
      expect(shipping.discountAmount).toBe(shipping.netAmount);
    }
    await as(ctx, marketing)
      .post(`/v1/admin/promotions/${auto.body.id as string}/actions/end`)
      .expect(200);
    automatic.pop();
  });

  it('checks a code before the cart without saving anything, and lists the codes I hold (U-B0.1)', async () => {
    const promo = await coupon({ productTypeCodes: ['folding_carton'], minQuantity: 500 });
    const check = (body: object, token?: string) => {
      const r = request(ctx.server)
        .post('/v1/store/promotions/actions/check')
        .set('x-device-id', `dev-${ctx.run}`);
      return (token ? r.auth(token, { type: 'bearer' }) : r).send(body);
    };
    try {
      const ok = await check({ code: promo.code, productTypeCode: 'folding_carton', quantity: 1000 }).expect(
        200,
      );
      expect(ok.body).toMatchObject({
        valid: true,
        reason: null,
        offer: {
          code: promo.code,
          title: 'ลด 5%',
          benefit: { type: 'percent', pct: '5', maxAmount: '100.00' },
        },
      });
      expect(ok.body.offer.conditions).toMatchObject({
        productTypeCodes: ['folding_carton'],
        minQuantity: 500,
      });
      const other = await check({ code: promo.code, productTypeCode: 'corrugated' }).expect(200);
      expect(other.body).toMatchObject({ valid: false, reason: 'not_applicable' });
      expect(other.body.offer).not.toBeNull();
      await check({ code: 'NO-SUCH-CODE' }).expect(200, {
        code: 'NO-SUCH-CODE',
        valid: false,
        reason: 'not_found',
        offer: null,
      });

      // A code assigned to someone else: said so, nothing shown.
      const { token: mineToken, phone } = await customerToken(ctx, 7);
      const owner = await ctx.prisma.user.findFirstOrThrow({ where: { phone } });
      const assigned = await ctx.prisma.couponCode.update({
        where: { code: promo.code },
        data: { assignedUserId: owner.id },
      });
      await check({ code: assigned.code }).expect(200, {
        code: assigned.code,
        valid: false,
        reason: 'not_yours',
        offer: null,
      });
      expect((await check({ code: assigned.code }, mineToken).expect(200)).body.valid).toBe(true);
      const mine = await as(ctx, mineToken).get('/v1/store/promotions/mine').expect(200);
      expect(mine.body).toEqual([expect.objectContaining({ code: assigned.code, status: 'usable' })]);
      // Nothing was written by the checks.
      expect(await ctx.prisma.cartCode.count({ where: { code: assigned.code } })).toBe(0);
    } finally {
      // Give the shared 127.0.0.1 budget back (every e2e suite comes from it).
      const redis = ctx.app.get<Redis>(REDIS);
      for (const key of await redis.keys('getpack:coupon:ip:*')) await redis.del(key);
    }
  });

  it('limits code attempts per customer each hour and lets CS enter a code on a customer’s CS cart', async () => {
    await setSetting(ctx, 'promotions.code_attempt_limits', {
      perCustomerPerHour: 2,
      perIpPerHour: 1000,
      perDevicePerHour: 2,
    });
    try {
      const { token } = await customerToken(ctx, 4);
      await as(ctx, token).post('/v1/store/cart/codes', { code: 'MISS-0001' }).expect(422);
      await as(ctx, token).post('/v1/store/cart/codes', { code: 'MISS-0002' }).expect(422);
      await as(ctx, token)
        .post('/v1/store/cart/codes', { code: 'MISS-0003' })
        .expect(429)
        .expect((r) => {
          expect(r.body.code).toBe('promotions.too_many_attempts');
        });
    } finally {
      await setSetting(ctx, 'promotions.code_attempt_limits', {
        perCustomerPerHour: 10,
        perIpPerHour: 30,
        perDevicePerHour: 10,
      });
    }

    const promo = await coupon();
    const { phone } = await customerToken(ctx, 5);
    const user = await ctx.prisma.user.findFirstOrThrow({ where: { phone } });
    const cs = await staffToken(ctx, 'cs');
    const res = await as(ctx, cs)
      .post(`/v1/admin/customers/${user.publicId}/cart/codes`, { code: promo.code })
      .expect(201);
    expect(res.body).toMatchObject({ channel: 'cs', codes: [{ code: promo.code, status: 'validated' }] });
    await as(ctx, cs)
      .delete(`/v1/admin/customers/${user.publicId}/cart/codes/${promo.code}`)
      .expect(200)
      .expect((r) => {
        expect(r.body.codes).toEqual([]);
      });
  });
});
