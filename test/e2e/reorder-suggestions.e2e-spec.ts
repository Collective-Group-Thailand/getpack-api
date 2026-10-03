import { randomUUID } from 'node:crypto';

import { systemActor } from '@common/context/actor';
import { addCalendarDays, bangkokDate } from '@common/time/bangkok';
import { OrdersService } from '@modules/orders/orders.service';
import { ReorderSuggestionsService } from '@modules/reorders/reorder-suggestions.service';

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
import { approveArtwork, bootFulfilmentApp, type FulfilmentApp, payDue } from '../support/fulfilment-e2e';

interface Suggestion {
  id: string;
  status: string;
  orderCount: number;
  suggestedQuantity: number;
  suggestedOn: string;
  nextNeedOn: string;
  averageIntervalDays: string;
  lastLeadTimeDays: number;
  lastOrder: { orderId: string };
}

/** U2.7 reorder suggestions per SKU (D-288, D-204, D-144). */
describe('reorder suggestions (e2e, U2.7)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let code: string;
  let token: string;
  let firstOrderId: string;
  const orderIds: string[] = [];

  const post = (t: string, path: string, body: Record<string, unknown> = {}) =>
    as(ctx, t).post(path, body).set('Idempotency-Key', randomUUID());

  /** Reorders the first (delivered) order with its artwork; the approved proof carries over (D-153). */
  async function reorder(quantity: number): Promise<string> {
    await post(token, `/v1/store/orders/${firstOrderId}/actions/reorder`, { quantity }).expect(201);
    const placed = await post(token, '/v1/store/checkout').expect(201);
    await payDue(ctx, token, placed.body.id as string);
    await ctx.pump();
    return (placed.body.orders as { id: string }[])[0]!.id;
  }

  const mine = async (t = token) =>
    ((await as(ctx, t).get('/v1/store/reorder-suggestions').expect(200)).body as Suggestion[]).filter((s) =>
      orderIds.includes(s.lastOrder.orderId),
    );

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    [code] = postcodes(ctx, 1) as [string];
    await seedShipping(ctx, fixture.factoryPublicId, [code]);
    await setFlag(ctx, 'payments.scb', true);
    token = (await customerToken(ctx, 131)).token;
    const group = await placeOrder(ctx, token, fixture, code);
    firstOrderId = group.orders[0]!.id;
    orderIds.push(firstOrderId);
    await payDue(ctx, token, group.id);
    await approveArtwork(ctx, token, await staffToken(ctx, 'prepress'), firstOrderId);
    await ctx.pump();
    // Production and delivery are their own suites' business: the facts are recorded directly.
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { publicId: firstOrderId } });
    const orders = ctx.app.get(OrdersService);
    const actor = systemActor('e2e');
    await ctx.prisma.withTx(async (tx) => {
      await orders.applyFact(tx, order.id, { kind: 'production_started', mode: 'auto' }, actor);
      await orders.applyFact(tx, order.id, { kind: 'shipped' }, actor);
      await orders.applyFact(tx, order.id, { kind: 'delivered' }, actor);
    });
    await ctx.pump();
  });

  afterAll(async () => {
    await setFlag(ctx, 'payments.scb', false);
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  it('suggests a SKU only from its third order, with date and quantity from the history (D-288)', async () => {
    const service = ctx.app.get(ReorderSuggestionsService);
    orderIds.push(await reorder(2000));
    await service.recompute();
    expect(await mine()).toEqual([]); // two orders: not yet

    orderIds.push(await reorder(3000));
    await service.recompute();
    const [s] = await mine();
    const today = bangkokDate(new Date());
    // Same-day history: intervals 0, lead time 0 (delivered the day it was placed) → need today, suggested 7 days
    // earlier (`reorder.safety_stock_days`); quantity = mean of 1000, 2000 and 3000.
    expect(s).toMatchObject({
      status: 'open',
      orderCount: 3,
      averageIntervalDays: '0.00',
      lastLeadTimeDays: 0,
      nextNeedOn: today,
      suggestedOn: addCalendarDays(today, -7),
      suggestedQuantity: 2000,
      lastOrder: { orderId: orderIds[2] },
    });
    const row = await ctx.prisma.reorderSuggestion.findFirstOrThrow({ where: { publicId: s!.id } });
    expect(Object.keys(row.settingVersionIds as object).sort()).toEqual([
      'reorder.average_orders',
      'reorder.min_orders',
      'reorder.safety_stock_days',
    ]);
    // Another customer does not see it.
    expect(await mine((await customerToken(ctx, 132)).token)).toEqual([]);
  });

  it('reminds once per cycle as marketing: no consent, no message (D-144)', async () => {
    const service = ctx.app.get(ReorderSuggestionsService);
    const [s] = await mine();
    await service.remind();
    await service.remind();
    const events = await ctx.prisma.domainEvent.findMany({
      where: { type: 'reorder.suggestion_due', aggregateId: s!.id },
    });
    expect(events).toHaveLength(1);
    await ctx.pump({ notifications: true });
    const sent = await ctx.prisma.notification.findMany({ where: { eventId: events[0]!.id } });
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((n) => n.status === 'suppressed_no_consent')).toBe(true);
  });

  it('is a CS queue: contacted, then dismissed by the customer; a new order opens a new cycle', async () => {
    const [s] = await mine();
    const cs = await staffToken(ctx, 'cs');
    const queue = await as(ctx, cs).get('/v1/admin/reorder-suggestions?perPage=100').expect(200);
    expect((queue.body.data as { id: string }[]).map((r) => r.id)).toContain(s!.id);
    const contacted = await post(cs, `/v1/admin/reorder-suggestions/${s!.id}/actions/mark-contacted`, {
      note: 'Called the customer',
    }).expect(200);
    expect(contacted.body).toMatchObject({ status: 'contacted', contactNote: 'Called the customer' });

    await post(token, `/v1/store/reorder-suggestions/${s!.id}/actions/dismiss`).expect(200);
    expect(await mine()).toEqual([]);
    await post(token, `/v1/store/reorder-suggestions/${s!.id}/actions/dismiss`).expect(409);

    orderIds.push(await reorder(1000));
    await ctx.app.get(ReorderSuggestionsService).recompute();
    const [next] = await mine();
    expect(next).toMatchObject({
      id: s!.id,
      status: 'open',
      orderCount: 4,
      lastOrder: { orderId: orderIds[3] },
    });
  });
});
