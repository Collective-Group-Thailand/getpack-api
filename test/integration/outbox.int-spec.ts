import { randomUUID } from 'node:crypto';

import { type Tx } from '@database/prisma.service';
import { PrismaService } from '@database/prisma.service';
import { getQueueToken } from '@nestjs/bullmq';
import { type INestApplicationContext, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { EventConsumerRunner } from '@platform/domain-events/event-consumer.runner';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { OutboxRelay } from '@platform/domain-events/outbox-relay.service';
import { DomainEventProcessor } from '@platform/domain-events/worker/domain-event.processor';
import { QUEUES } from '@platform/domain-events/worker/queues';
import { HousekeepingJobs } from '@platform/maintenance/housekeeping.jobs';
import { type Job, type Queue } from 'bullmq';

import { WorkerModule } from '../../src/worker.module';
import { startTestInfra, stopTestInfra, type TestInfra } from '../support/containers';
import { migrateDeploy } from '../support/database';

const received: string[] = [];

@Injectable()
class RecordingSubscriber {
  @OnDomainEvent('widget.created', { consumer: 'test.recording' })
  async onCreated(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    received.push(event.id);
    // The handler's own writes share the consumption transaction.
    await tx.$executeRaw`SELECT 1`;
  }
}

@Module({ providers: [RecordingSubscriber] })
class TestSubscribersModule {}

async function eventually(check: () => Promise<boolean> | boolean, timeoutMs = 20_000): Promise<void> {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('outbox relay and subscribers (PostgreSQL 18 + Redis, worker process)', () => {
  let infra: TestInfra;
  let worker: INestApplicationContext;
  let prisma: PrismaService;
  const events = new DomainEvents();

  beforeAll(async () => {
    infra = await startTestInfra();
    migrateDeploy(infra.env.DATABASE_URL!);
    Object.assign(process.env, infra.env);
    const moduleRef = await Test.createTestingModule({
      imports: [WorkerModule, TestSubscribersModule],
    }).compile();
    worker = moduleRef.createNestApplication({ logger: false });
    await worker.init();
    prisma = worker.get(PrismaService);
  });

  afterAll(async () => {
    await worker?.close();
    await stopTestInfra(infra);
  });

  const recordWidget = () =>
    prisma.withTx((tx) =>
      events.record(tx, {
        type: 'widget.created',
        aggregateType: 'widget',
        aggregateId: randomUUID(),
        payload: {},
      }),
    );

  const consumptions = async (eventId: string) =>
    prisma.eventConsumption.count({ where: { eventId, consumer: 'test.recording' } });

  it('delivers a committed event to its subscriber exactly once', async () => {
    const event = await recordWidget();
    await eventually(() => received.includes(event.id));
    await eventually(
      async () =>
        (await prisma.outboxMessage.findFirst({ where: { eventId: event.id } }))?.status === 'dispatched',
    );
    expect(received.filter((id) => id === event.id)).toHaveLength(1);
    expect(await consumptions(event.id)).toBe(1);
  });

  it('skips a redelivered event (idempotent consumer)', async () => {
    const event = await recordWidget();
    await eventually(() => received.includes(event.id));
    const runner = worker.get(EventConsumerRunner);
    await expect(runner.consume('test.recording', event)).resolves.toBe('duplicate');
    await expect(runner.consume('nobody', event)).resolves.toBe('unknown_consumer');
    expect(received.filter((id) => id === event.id)).toHaveLength(1);
  });

  it('never dispatches a row twice when relays run concurrently', async () => {
    const relay = worker.get(OutboxRelay);
    const batch = await Promise.all(Array.from({ length: 30 }, () => recordWidget()));
    await Promise.all([
      relay.relayBatch(10),
      relay.relayBatch(10),
      relay.relayBatch(10),
      relay.relayBatch(10),
    ]);
    await eventually(() => batch.every((e) => received.includes(e.id)));
    // The handler sees the event before the runner's transaction commits its consumption row.
    const ids = batch.map((e) => e.id);
    await eventually(
      async () =>
        (await prisma.eventConsumption.count({
          where: { consumer: 'test.recording', eventId: { in: ids } },
        })) >= batch.length,
    );
    for (const event of batch) {
      expect(received.filter((id) => id === event.id)).toHaveLength(1);
      expect(await consumptions(event.id)).toBe(1);
    }
  });

  it('dead-letters an event when a subscriber exhausts its retries', async () => {
    const event = await recordWidget();
    await eventually(() => received.includes(event.id));
    const processor = worker.get(DomainEventProcessor);
    const job = { attemptsMade: 8, opts: { attempts: 8 }, data: { consumer: 'test.other', event } };
    await processor.onFailed(job as unknown as Job, new Error('provider down'));
    const row = await prisma.outboxMessage.findFirst({ where: { eventId: event.id } });
    expect(row).toMatchObject({ status: 'dead', lastError: 'test.other: Error: provider down' });

    // A non-final failure leaves it alone.
    const other = await recordWidget();
    await processor.onFailed(
      { ...job, attemptsMade: 3, data: { ...job.data, event: other } } as unknown as Job,
      new Error('x'),
    );
    await eventually(
      async () =>
        (await prisma.outboxMessage.findFirst({ where: { eventId: other.id } }))?.status === 'dispatched',
    );
  });

  it('registers the housekeeping schedulers and runs them', async () => {
    const queue = worker.get<Queue>(getQueueToken(QUEUES.maintenance));
    const schedulers = (await queue.getJobSchedulers()).map((s) => s.key).sort();
    expect(schedulers).toEqual(
      expect.arrayContaining(['idempotency.purge', 'otp.purge', 'partitions.ensure']),
    );

    const jobs = worker.get(HousekeepingJobs);
    await prisma.$executeRaw`INSERT INTO idempotency_keys (scope, key, request_sha256, status, expires_at)
      VALUES ('s', ${randomUUID()}::uuid, decode(repeat('ab', 32), 'hex'), 'in_progress', now() - interval '1 minute')`;
    await expect(jobs.purgeIdempotencyKeys()).resolves.toBe(1);
    await expect(jobs.purgeOtpChallenges()).resolves.toBe(0);
    await expect(jobs.ensurePartitions()).resolves.toBeUndefined();
  });
});
