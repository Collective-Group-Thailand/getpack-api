import { randomUUID } from 'node:crypto';

import { type FakeScbGateway, SCB_GATEWAY } from '@collective/integrations/payments/gateways';
import { systemActor } from '@common/context/actor';
import { MoneyDecimal } from '@common/money/money';
import { LoyaltyService } from '@modules/loyalty/loyalty.service';
import { OrdersService } from '@modules/orders/orders.service';
import { PaymentSchedulesService } from '@modules/payment-schedules/payment-schedules.service';
import { envelopeFromRow } from '@platform/domain-events/domain-event';
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
  staffToken,
} from '../support/commerce-e2e';

/**
 * B3 acceptance (docs/prompts/B3-commerce.md, Quality): a cart with 2 items to 2 addresses + a coupon +
 * points on the 50/50 schedule → deposit by QR (fake SCB callback) → artwork approved → the production
 * gate opens. The other acceptance cases live in their suites: duplicate slip refused (`payments`), B2B
 * order above the company threshold waits for the approver (`company-orders`), credit order blocked when
 * overdue (`company-credit`).
 */
describe('commerce acceptance (e2e, B3)', () => {
  let ctx: CommerceApp;
  let fixture: DevFolding;
  let codes: string[];

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    fixture = await foldingReady(ctx);
    codes = postcodes(ctx, 2);
    await seedShipping(ctx, fixture.factoryPublicId, codes);
    await setFlag(ctx, 'payments.scb', true);
  });

  afterAll(async () => {
    await setFlag(ctx, 'payments.scb', false);
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  it('2 items to 2 addresses + coupon + points, 50/50 → QR deposit → artwork approved → production gate open', async () => {
    // Marketing's coupon (5 %, max THB 100).
    const marketing = await staffToken(ctx, 'marketing');
    const promo = await as(ctx, marketing)
      .post('/v1/admin/promotions', {
        name: 'ลด 5%',
        kind: 'coupon',
        priority: 100,
        stacking: 'stackable',
        startsAt: '2026-01-01T00:00:00+07:00',
        conditions: {},
        benefit: { type: 'percent', pct: '5', maxAmount: '100.00' },
      })
      .expect(201);
    const code = `ACC${ctx.run}`;
    await as(ctx, marketing)
      .post(`/v1/admin/promotions/${promo.body.id as string}/coupons`, { kind: 'single', code })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    await as(ctx, marketing)
      .post(`/v1/admin/promotions/${promo.body.id as string}/actions/activate`)
      .expect(200);

    // A new customer with the sign-up reward (20 points).
    const { token, phone } = await customerToken(ctx, 1);
    const user = await ctx.prisma.user.findFirstOrThrow({ where: { phone } });
    const registered = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: { type: 'customer.registered', aggregateId: user.publicId },
    });
    await ctx.prisma.withTx((tx) =>
      ctx.app.get(LoyaltyService).onRegistered(envelopeFromRow(registered), tx),
    );

    // Two items: the first split over both addresses, the second to the second address.
    const home = await addAddress(ctx, token, codes[0]!, 'บ้าน');
    const office = await addAddress(ctx, token, codes[1]!, 'ออฟฟิศ');
    const q1 = await saveQuote(ctx, token, fixture, [5000]);
    const q2 = await saveQuote(ctx, token, fixture, [5000]);
    await as(ctx, token)
      .post('/v1/store/cart/items', {
        quoteId: q1.id,
        quoteOptionId: q1.options[0]!.id,
        designOption: 'own_file',
        destinations: [
          { addressId: home.id, quantity: 3000 },
          { addressId: office.id, quantity: 2000 },
        ],
      })
      .expect(201);
    await as(ctx, token)
      .post('/v1/store/cart/items', {
        quoteId: q2.id,
        quoteOptionId: q2.options[0]!.id,
        designOption: 'own_file',
        destinations: [{ addressId: office.id, quantity: 5000 }],
      })
      .expect(201);
    await as(ctx, token).post('/v1/store/cart/codes', { code }).expect(201);

    const preview = await as(ctx, token)
      .post('/v1/store/checkout/actions/preview', { redeemPoints: 8 })
      .expect(200);
    expect(preview.body.orders).toHaveLength(2);
    expect(preview.body.orders[0].destinations).toHaveLength(2);
    const sources = (preview.body.orders as { discounts: { source: string }[] }[]).flatMap((o) =>
      o.discounts.map((d) => d.source),
    );
    expect(sources).toEqual(expect.arrayContaining(['coupon', 'points_redemption']));
    expect(new MoneyDecimal(preview.body.totals.grossAmount as string).gte(20_000)).toBe(true);
    expect(preview.body.paymentSchedule.templateKey).toBe('deposit_50_before_shipping_50');

    const placed = await as(ctx, token)
      .post('/v1/store/checkout', { redeemPoints: 8, expectedGrossAmount: preview.body.totals.grossAmount })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    const groupId = placed.body.id as string;
    expect(placed.body.totals.grossAmount).toBe(preview.body.totals.grossAmount);
    const group = await ctx.prisma.orderGroup.findUniqueOrThrow({ where: { publicId: groupId } });
    expect(
      await ctx.prisma.promotionRedemption.count({ where: { orderGroupId: group.id, status: 'reserved' } }),
    ).toBe(1);
    expect(
      await ctx.prisma.pointsEntry.count({ where: { orderGroupId: group.id, entryType: 'redeem' } }),
    ).toBe(1);

    // Deposit by SCB QR, confirmed by the (fake) SCB callback.
    const payment = (
      await as(ctx, token)
        .post(`/v1/store/order-groups/${groupId}/payments`, { method: 'scb_qr' })
        .set('Idempotency-Key', randomUUID())
        .expect(201)
    ).body as { referenceCode: string; cashAmount: string };
    const schedule = await as(ctx, token)
      .get(`/v1/store/order-groups/${groupId}/payment-schedule`)
      .expect(200);
    expect(payment.cashAmount).toBe(schedule.body.instalments[0].cashAmount);
    const scb = ctx.app.get<FakeScbGateway>(SCB_GATEWAY);
    await request(ctx.server)
      .post('/webhooks/scb/payment-confirmation')
      .send(scb.settle(payment.referenceCode, payment.cashAmount))
      .expect(200);
    const afterDeposit = await as(ctx, token)
      .get(`/v1/store/order-groups/${groupId}/payment-schedule`)
      .expect(200);
    expect(afterDeposit.body).toMatchObject({ productionGateOpen: true, shippingGateOpen: false });

    // Artwork approved (B4.1 is not built yet: the fact is recorded directly) → production may start.
    const orders = ctx.app.get(OrdersService);
    const schedules = ctx.app.get(PaymentSchedulesService);
    for (const o of placed.body.orders as { id: string }[]) {
      const order = await ctx.prisma.order.findUniqueOrThrow({ where: { publicId: o.id } });
      expect(await schedules.canStartProduction(order.id)).toBe(true);
      await ctx.prisma.withTx((tx) =>
        orders.applyFact(tx, order.id, { kind: 'artwork_approved' }, systemActor('e2e')),
      );
      const read = await as(ctx, token).get(`/v1/store/orders/${o.id}`).expect(200);
      expect(read.body.status).toBe('artwork_approved');
    }
    const readGroup = await as(ctx, token).get(`/v1/store/order-groups/${groupId}`).expect(200);
    expect(readGroup.body.status).toBe('in_progress');
  });
});
