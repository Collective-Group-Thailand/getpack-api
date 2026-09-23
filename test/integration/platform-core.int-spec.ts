import { randomUUID } from 'node:crypto';

import { RequestContext } from '@common/context/request-context';
import { type AppConfig } from '@config/app-config';
import { PrismaService } from '@database/prisma.service';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { BusinessCalendarService } from '@platform/calendar/business-calendar.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { type MigratedDatabase, startMigratedDatabase, stopMigratedDatabase } from '../support/database';

describe('platform core writers (PostgreSQL 18)', () => {
  let db: MigratedDatabase;
  let prisma: PrismaService;
  const events = new DomainEvents();
  const activity = new ActivityLogService();
  let audit: AuditService;

  beforeAll(async () => {
    db = await startMigratedDatabase();
    prisma = new PrismaService({ get: () => db.url } as unknown as AppConfig);
    audit = new AuditService(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await stopMigratedDatabase(db);
  });

  const mutation = (aggregateId: string, fail: boolean) =>
    prisma.withTx(async (tx) => {
      const event = await events.record(tx, {
        type: 'thing.changed',
        aggregateType: 'thing',
        aggregateId,
        payload: { amount: '100.00', ref: 42n },
      });
      await activity.record(tx, {
        aggregateType: 'thing',
        aggregatePublicId: aggregateId,
        action: 'thing.changed',
        messageKey: 'activity.thing.changed',
        domainEventId: event.id,
      });
      await audit.record(tx, {
        category: 'config',
        action: 'thing.changed',
        resourceType: 'thing',
        resourcePublicId: aggregateId,
        data: { before: { secret: 'x' }, after: { value: 1 } },
      });
      if (fail) throw new Error('boom');
      return event;
    });

  const counts = async (aggregateId: string) => {
    const { rows } = await db.client.query<{
      events: string;
      outbox: string;
      activity: string;
      audit: string;
    }>(
      `SELECT (SELECT count(*) FROM domain_events WHERE aggregate_id = $1) AS events,
              (SELECT count(*) FROM outbox_messages o JOIN domain_events e ON e.id = o.event_id WHERE e.aggregate_id = $1) AS outbox,
              (SELECT count(*) FROM activity_logs WHERE aggregate_public_id = $1) AS activity,
              (SELECT count(*) FROM audit_logs WHERE resource_public_id = $1) AS audit`,
      [aggregateId],
    );
    return rows[0];
  };

  it('writes event, outbox, activity and audit in the caller transaction', async () => {
    const id = randomUUID();
    const correlationId = randomUUID();
    const event = await RequestContext.run({ correlationId, requestId: 'req-12345678' }, () =>
      mutation(id, false),
    );

    expect(await counts(id)).toEqual({ events: '1', outbox: '1', activity: '1', audit: '1' });
    expect(event).toMatchObject({
      type: 'thing.changed',
      correlationId,
      causationId: null,
      actor: { type: 'system' },
    });
    expect(event.payload).toEqual({ amount: '100.00', ref: '42' });

    const { rows } = await db.client.query<{
      topic: string;
      status: string;
      data: unknown;
      request_id: string;
    }>(
      `SELECT o.topic, o.status, a.data, a.request_id FROM outbox_messages o, audit_logs a
        WHERE o.event_id = $1 AND a.resource_public_id = $2`,
      [event.id, id],
    );
    expect(rows[0]).toEqual({
      topic: 'thing',
      status: 'pending',
      data: { before: { secret: '[REDACTED]' }, after: { value: 1 } },
      request_id: 'req-12345678',
    });
  });

  it('rolls all four back together when the mutation fails', async () => {
    const id = randomUUID();
    await expect(mutation(id, true)).rejects.toThrow('boom');
    expect(await counts(id)).toEqual({ events: '0', outbox: '0', activity: '0', audit: '0' });
  });

  it('keeps standalone audit rows for denied outcomes', async () => {
    const id = randomUUID();
    await audit.recordStandalone({
      category: 'security',
      action: 'auth.permission_denied',
      outcome: 'denied',
      resourceType: 'thing',
      resourcePublicId: id,
    });
    expect((await counts(id)).audit).toBe('1');
  });

  it('resolves factory calendars from national holidays (observance all only) plus closures (D-161)', async () => {
    const { rows } = await db.client.query<{ id: string }>(
      `INSERT INTO business_calendars (code, name, kind, weekend_days) VALUES ('th_public', 'TH', 'national', '{0,6}') RETURNING id`,
    );
    const nationalId = rows[0]!.id;
    await db.client.query(
      `INSERT INTO business_calendar_days (calendar_id, day, kind, observance, name_th) VALUES
         ($1, '2026-10-13', 'holiday', 'all', 'fake holiday'),
         ($1, '2026-10-14', 'holiday', 'government_only', 'fake gov day')`,
      [nationalId],
    );
    const { rows: factory } = await db.client.query<{ id: string }>(
      `INSERT INTO business_calendars (code, name, kind, factory_id, weekend_days, base_calendar_id)
         VALUES ('factory:test', 'Factory', 'factory', 1, '{0}', $1) RETURNING id`,
      [nationalId],
    );
    await db.client.query(
      `INSERT INTO business_calendar_days (calendar_id, day, kind, name_th) VALUES ($1, '2026-10-15', 'closure', 'fake closure')`,
      [factory[0]!.id],
    );

    const service = new BusinessCalendarService(prisma);
    const national = await service.calendar();
    expect(national.isWorkingDay('2026-10-13')).toBe(false);
    expect(national.isWorkingDay('2026-10-14')).toBe(true);
    const own = await service.calendar('factory:test');
    expect(own.isWorkingDay('2026-10-13')).toBe(false);
    expect(own.isWorkingDay('2026-10-15')).toBe(false);
    expect(own.isWorkingDay('2026-10-17')).toBe(true); // Saturday works at this factory
    await expect(service.calendar('missing')).rejects.toThrow('does not exist');
  });
});
