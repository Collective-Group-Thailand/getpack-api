import { randomUUID } from 'node:crypto';

import { OpsSignalsService } from '@modules/ops/ops-signals.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { as, staffToken } from '../support/commerce-e2e';
import { bootFulfilmentApp, type FulfilmentApp } from '../support/fulfilment-e2e';

interface Signal {
  key: string;
  value: number | null;
  threshold: number | null;
  status: string;
}

/**
 * B6.3 launch monitoring: the operational signals read the outbox, queues, webhooks, payouts, ledger postings and SLA
 * clocks against `ops.alert_thresholds`; a signal in alert raises `ops.alert_raised` at most hourly, and superadmins
 * and admins are notified through the matrix.
 */
describe('ops signals & alerts (e2e, B6.3)', () => {
  let ctx: FulfilmentApp;
  let eventId: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
  });

  afterAll(async () => {
    // Leave no dead letter behind for the suites that run after this one (shared database).
    if (eventId)
      await ctx.prisma.outboxMessage.updateMany({
        where: { eventId },
        data: { status: 'dispatched', lastError: null },
      });
    await ctx?.app.close();
  });

  it('reports every signal against its threshold, alerts once an hour and notifies the operators', async () => {
    const admin = await staffToken(ctx, 'admin');
    await as(ctx, await staffToken(ctx, 'finance'))
      .get('/v1/admin/ops/signals')
      .expect(403);
    const before = (await as(ctx, admin).get('/v1/admin/ops/signals').expect(200)).body as Signal[];
    expect(before.map((s) => s.key)).toEqual([
      'outbox_dead_letters',
      'outbox_backlog_minutes',
      'queue_depth',
      'webhook_failures_24h',
      'payout_item_failures_7d',
      'ledger_posting_failures',
      'acceptance_overdue',
      'production_at_risk',
      'rfq_first_response_overdue',
      'approvals_overdue',
      'slip_verification_wait_hours',
    ]);
    expect(before.find((s) => s.key === 'outbox_dead_letters')!.threshold).toBe(1);

    // A ledger posting that exhausted its retries: dead letter + posting failure.
    const event = await ctx.prisma.withTx((tx) =>
      ctx.app.get(DomainEvents).record(tx, {
        type: 'ops.test_event',
        aggregateType: 'test',
        aggregateId: randomUUID(),
        payload: {},
      }),
    );
    eventId = event.id;
    await ctx.prisma.outboxMessage.updateMany({
      where: { eventId },
      data: { status: 'dead', lastError: 'ledger.posting: Error: test failure (fake)' },
    });
    const after = (await as(ctx, admin).get('/v1/admin/ops/signals').expect(200)).body as Signal[];
    for (const key of ['outbox_dead_letters', 'ledger_posting_failures'])
      expect(after.find((s) => s.key === key)).toMatchObject({ status: 'alert' });

    const signals = ctx.app.get(OpsSignalsService);
    expect(await signals.raiseAlerts()).toBeGreaterThanOrEqual(2);
    expect(await signals.raiseAlerts()).toBe(0); // within the hour: no repeat
    const raised = await ctx.prisma.domainEvent.findMany({
      where: { type: 'ops.alert_raised' },
      orderBy: { occurredAt: 'desc' },
    });
    const dead = raised.find((e) => (e.payload as { signal: string }).signal === 'outbox_dead_letters')!;
    expect(dead.payload).toMatchObject({ status: 'alert', threshold: 1 });

    await ctx.pump({ notifications: true });
    const notified = await ctx.prisma.notification.findMany({
      where: { eventId: dead.id },
      include: { recipient: { include: { roles: { include: { role: true } } } } },
    });
    expect(notified.length).toBeGreaterThanOrEqual(2);
    for (const n of notified)
      expect(n.recipient!.roles.some((r) => ['superadmin', 'admin'].includes(r.role.key))).toBe(true);
    expect(new Set(notified.map((n) => n.channel))).toEqual(new Set(['in_app', 'email']));
  });
});
