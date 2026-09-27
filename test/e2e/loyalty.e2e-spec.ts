import { randomUUID } from 'node:crypto';

import { systemActor } from '@common/context/actor';
import { MoneyDecimal } from '@common/money/money';
import { LoyaltyService } from '@modules/loyalty/loyalty.service';
import { OrdersService } from '@modules/orders/orders.service';
import { PaymentSchedulesService } from '@modules/payment-schedules/payment-schedules.service';
import { type DomainEventEnvelope, envelopeFromRow } from '@platform/domain-events/domain-event';

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
} from '../support/commerce-e2e';

const DAY = 86_400_000;

/** Points: rewards, earning on completion, crediting, reversal, redemption at checkout, expiry (B3.4 slice 2). */
describe('loyalty points (e2e, B3.4)', () => {
  let ctx: CommerceApp;
  let fixture: DevFolding;
  let postcode: string;
  let loyalty: LoyaltyService;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    fixture = await foldingReady(ctx);
    postcode = postcodes(ctx, 1)[0]!;
    await seedShipping(ctx, fixture.factoryPublicId, [postcode]);
    loyalty = ctx.app.get(LoyaltyService);
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  const userOf = (phone: string) => ctx.prisma.user.findFirstOrThrow({ where: { phone } });

  /** Runs a loyalty subscriber on the latest event of a type for an aggregate. */
  async function deliver(type: string, aggregateId: string, handler: (e: DomainEventEnvelope, tx: never) => Promise<void>) {
    const events = await ctx.prisma.domainEvent.findMany({ where: { type, aggregateId }, orderBy: { occurredAt: 'asc' } });
    for (const e of events) await ctx.prisma.withTx((tx) => handler(envelopeFromRow(e), tx as never));
    return events.length;
  }

  async function cart(token: string, quantity = 1000) {
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

  /** Pays every instalment of the group (fixture: a succeeded slip payment applied to the schedule). */
  async function payAll(groupPublicId: string) {
    const schedules = ctx.app.get(PaymentSchedulesService);
    await ctx.prisma.withTx(async (tx) => {
      const group = await tx.orderGroup.findUniqueOrThrow({ where: { publicId: groupPublicId } });
      const cash = group.cashAmount.toFixed(2);
      const payment = await tx.payment.create({
        data: {
          entityId: group.entityId,
          orderGroupId: group.id,
          method: 'bank_transfer_slip',
          provider: 'slip',
          status: 'succeeded',
          referenceCode: `E2E${randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()}`,
          amount: cash,
          cashAmount: cash,
          paidAt: new Date(),
        },
      });
      await schedules.applyPayment(tx, group.id, payment.id, cash, systemActor('e2e'));
    });
  }

  /** Drives an order to completed through the facts B4 will record. */
  async function complete(orderPublicId: string) {
    const orders = ctx.app.get(OrdersService);
    await ctx.prisma.withTx(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { publicId: orderPublicId } });
      for (const fact of [
        { kind: 'artwork_approved' },
        { kind: 'production_started', mode: 'auto' },
        { kind: 'shipped' },
        { kind: 'delivered' },
        { kind: 'completed', mode: 'customer_confirmed' },
      ] as const)
        await orders.applyFact(tx, order.id, fact, systemActor('e2e'));
    });
  }

  it('rewards self sign-up (not CS-created accounts) with THB 50 = 20 points, once', async () => {
    const { phone, token } = await customerToken(ctx, 1);
    const user = await userOf(phone);
    expect(await deliver('customer.registered', user.publicId, (e, tx) => loyalty.onRegistered(e, tx))).toBe(1);
    await deliver('customer.registered', user.publicId, (e, tx) => loyalty.onRegistered(e, tx));
    const summary = await as(ctx, token).get('/v1/store/loyalty').expect(200);
    expect(summary.body).toMatchObject({ tier: 'member', availablePoints: 20, pendingPoints: 0, pointValue: '2.50', availableValue: '50.00' });
    const ledger = await as(ctx, token).get('/v1/store/loyalty/ledger').expect(200);
    expect(ledger.body.data).toEqual([expect.objectContaining({ entryType: 'earn_signup', points: 20, status: 'available' })]);
  });

  it('earns on completion, credits after the claim window, and takes back a claimed share while pending', async () => {
    const { phone, token } = await customerToken(ctx, 2);
    const user = await userOf(phone);
    await cart(token);
    const placed = await as(ctx, token).post('/v1/store/checkout', {}).set('Idempotency-Key', randomUUID()).expect(201);
    const orderId = placed.body.orders[0].id as string;
    await payAll(placed.body.id as string);
    await complete(orderId);
    await deliver('order.fact_recorded', orderId, (e, tx) => loyalty.onFact(e, tx));

    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { publicId: orderId } });
    const base = await loyalty.earnBase(ctx.prisma, order.id);
    const expected = new MoneyDecimal(base.toString()).div(500).floor().toNumber();
    const earn = await ctx.prisma.pointsEntry.findFirstOrThrow({ where: { orderId: order.id, entryType: 'earn_order' } });
    expect(earn).toMatchObject({ status: 'pending', points: expected });
    expect(earn.availableAt!.getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
    expect((await as(ctx, token).get('/v1/store/loyalty').expect(200)).body.pendingPoints).toBe(expected);

    // A claim for half the order before the window ends: the earning is credited smaller.
    const reversed = await ctx.prisma.withTx((tx) =>
      loyalty.reverseForOrder(tx, order.id, systemActor('e2e'), new MoneyDecimal(base.toString()).div(2)),
    );
    expect(reversed).toBeGreaterThan(0);
    expect(await loyalty.creditDue(new Date())).toBe(0);
    await loyalty.creditDue(new Date(Date.now() + 8 * DAY));
    const credited = await ctx.prisma.pointsEntry.findUniqueOrThrow({ where: { id: earn.id }, include: { lot: true } });
    expect(credited.status).toBe('available');
    expect(credited.lot!.points).toBe(expected - reversed);
    expect(credited.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 360 * DAY);
    expect(await ctx.prisma.domainEvent.count({ where: { type: 'points.issued', aggregateId: user.publicId } })).toBe(1);
  });

  it('redeems points at checkout within the limits and gives them back when the order is cancelled', async () => {
    const { phone, token } = await customerToken(ctx, 3);
    const user = await userOf(phone);
    await deliver('customer.registered', user.publicId, (e, tx) => loyalty.onRegistered(e, tx));
    await cart(token);

    const tooFew = await as(ctx, token).post('/v1/store/checkout/actions/preview', { redeemPoints: 3 }).expect(200);
    expect(tooFew.body.notices).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'points.rejected', params: expect.objectContaining({ reason: 'below_minimum' }) })]));
    const tooMany = await as(ctx, token).post('/v1/store/checkout/actions/preview', { redeemPoints: 500 }).expect(200);
    expect(tooMany.body.notices).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'points.capped', params: expect.objectContaining({ points: 20, reason: 'capped_balance' }) })]));

    const preview = await as(ctx, token).post('/v1/store/checkout/actions/preview', { redeemPoints: 8 }).expect(200);
    expect(preview.body.orders[0].discounts).toEqual([expect.objectContaining({ source: 'points_redemption', amount: '20.00' })]);
    expect(preview.body.totals.discountAmount).toBe('20.00');
    const placed = await as(ctx, token)
      .post('/v1/store/checkout', { redeemPoints: 8, expectedGrossAmount: preview.body.totals.grossAmount })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    expect((await as(ctx, token).get('/v1/store/loyalty').expect(200)).body.availablePoints).toBe(12);
    const group = await ctx.prisma.orderGroup.findUniqueOrThrow({ where: { publicId: placed.body.id as string } });
    expect(await ctx.prisma.pointsEntry.findFirst({ where: { orderGroupId: group.id, entryType: 'redeem' } })).toMatchObject({ points: -8 });
    expect(await ctx.prisma.domainEvent.count({ where: { type: 'points.redeemed', aggregateId: user.publicId } })).toBe(1);

    await as(ctx, token).post(`/v1/store/order-groups/${group.publicId}/actions/cancel`, { reasonCode: 'customer_request' }).expect(200);
    await deliver('order.cancelled', placed.body.orders[0].id as string, (e, tx) => loyalty.onOrderCancelled(e, tx));
    expect((await as(ctx, token).get('/v1/store/loyalty').expect(200)).body.availablePoints).toBe(20);
    const history = await as(ctx, token).get('/v1/store/loyalty/ledger').expect(200);
    expect((history.body.data as { entryType: string }[]).map((e) => e.entryType)).toEqual(['redeem_reversal', 'redeem', 'earn_signup']);
  });

  it('reminds 30 days before expiry and expires lots after 12 months (P12)', async () => {
    const { phone } = await customerToken(ctx, 4);
    const user = await userOf(phone);
    await deliver('customer.registered', user.publicId, (e, tx) => loyalty.onRegistered(e, tx));
    const lot = await ctx.prisma.pointsLot.findFirstOrThrow({ where: { userId: user.id } });

    await ctx.prisma.pointsLot.update({ where: { id: lot.id }, data: { expiresAt: new Date(Date.now() + 10 * DAY) } });
    expect(await loyalty.remindExpiring()).toBeGreaterThanOrEqual(1);
    expect(await ctx.prisma.domainEvent.count({ where: { type: 'points.expiring', aggregateId: user.publicId } })).toBe(1);
    await loyalty.remindExpiring();
    expect(await ctx.prisma.domainEvent.count({ where: { type: 'points.expiring', aggregateId: user.publicId } })).toBe(1);

    await ctx.prisma.pointsLot.update({ where: { id: lot.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await loyalty.expireDue();
    const expired = await ctx.prisma.pointsLot.findUniqueOrThrow({ where: { id: lot.id }, include: { earnEntry: true } });
    expect(expired.remaining).toBe(0);
    expect(expired.earnEntry.status).toBe('expired');
    const entry = await ctx.prisma.pointsEntry.findFirstOrThrow({ where: { userId: user.id, entryType: 'expire' } });
    expect(entry).toMatchObject({ points: -20 });
    expect(entry.bahtValue.toFixed(2)).toBe('50.00');
    expect(await ctx.prisma.domainEvent.count({ where: { type: 'points.expired', aggregateId: user.publicId } })).toBe(1);
  });
});
