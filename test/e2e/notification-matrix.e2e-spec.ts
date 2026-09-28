import { randomUUID } from 'node:crypto';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
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
import {
  approveArtwork,
  bootFulfilmentApp,
  factoryToken,
  type FulfilmentApp,
  payDue,
} from '../support/fulfilment-e2e';

/**
 * The seeded D-143 matrix routes real events to customers (by the aggregate they own), staff teams and the
 * factory's users (B4.6), one row per recipient and channel, SMS only where critical.
 */
describe('notification routing matrix (e2e, B4.6)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let code: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    [code] = postcodes(ctx, 1) as [string];
    await seedShipping(ctx, fixture.factoryPublicId, [code]);
    await setFlag(ctx, 'payments.scb', true);
  });

  afterAll(async () => {
    await setFlag(ctx, 'payments.scb', false);
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  it('notifies the customer, the teams and the factory along the order', async () => {
    const owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 61);
    const ownerUser = await ctx.prisma.user.findFirstOrThrow({
      where: { email: { contains: `factory_owner-${ctx.run}-61` } },
    });
    const { token } = await customerToken(ctx, 1);
    const prepress = await staffToken(ctx, 'prepress');
    const group = await placeOrder(ctx, token, fixture, code);
    const orderId = group.orders[0]!.id;
    await payDue(ctx, token, group.id);
    await approveArtwork(ctx, token, prepress, orderId);
    await ctx.pump({ notifications: true });

    const customer = await ctx.prisma.order.findUniqueOrThrow({
      where: { publicId: orderId },
      select: { customerUserId: true },
    });
    const rows = async (type: string, where: Record<string, unknown> = {}) =>
      ctx.prisma.notification.findMany({
        where: { event: { type, occurredAt: { gte: new Date(Date.now() - 3_600_000) } }, ...where },
        include: { route: { include: { staffTeam: true } } },
      });

    // Customer: e-mail always, LINE and in-app for the placed order (resolved from the order group).
    const placed = await rows('order_group.placed', { recipientUserId: customer.customerUserId });
    expect(placed.map((n) => n.channel).sort()).toEqual(['email', 'in_app', 'line']);
    // Production queued reaches the customer in-app (order aggregate, payload customerId).
    expect(
      (await rows('production.queued', { recipientUserId: customer.customerUserId }))
        .map((n) => n.channel)
        .sort(),
    ).toEqual(['in_app', 'line']);
    // Staff: Prepress's LINE group gets the artwork (the team is the recipient).
    const artwork = await rows('artwork.submitted', { channel: 'line' });
    expect(artwork.some((n) => n.route?.staffTeam?.code === 'prepress' && n.recipientUserId === null)).toBe(
      true,
    );
    // Factory: its users get the released job in-app, by e-mail and LINE.
    const released = await rows('production_job.released', { recipientUserId: ownerUser.id });
    expect(released.map((n) => n.channel).sort()).toEqual(['email', 'in_app', 'line']);

    // SMS only for critical events: shipping gets one, placing an order does not.
    expect((await rows('order_group.placed', { channel: 'sms' })).length).toBe(0);
    const job = await ctx.prisma.productionJob.findFirstOrThrow({ where: { order: { publicId: orderId } } });
    await as(ctx, owner)
      .post(`/v1/partner/production-jobs/${job.publicId}/actions/accept`)
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    await ctx.pump({ notifications: true });
    // Re-running the router never duplicates rows.
    const again = await rows('production_job.released', { recipientUserId: ownerUser.id });
    expect(again).toHaveLength(3);
  });
});
