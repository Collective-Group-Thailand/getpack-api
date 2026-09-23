import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type FakeLineMessaging } from '@integrations/line-messaging/fake-line-messaging';
import { LINE_MESSAGING } from '@integrations/line-messaging/line-messaging.port';
import { type FakeSmsSender } from '@integrations/sms/fake-sms-sender';
import { SMS_SENDER } from '@integrations/sms/sms-sender.port';
import { type INestApplication, type INestApplicationContext, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { NotificationDelivery } from '@platform/notifications/notification-delivery';
import request from 'supertest';

import { seedDev } from '../../prisma/seed/dev-seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { WorkerModule } from '../../src/worker.module';
import { E2E_DEV_PASSWORD } from '../support/e2e';

const received: string[] = [];

@Injectable()
class RoleGrantSubscriber {
  @OnDomainEvent('iam.role_granted', { consumer: 'e2e.role-granted' })
  onGranted(event: DomainEventEnvelope): Promise<void> {
    received.push(event.id);
    return Promise.resolve();
  }
}

@Module({ providers: [RoleGrantSubscriber] })
class AcceptanceSubscribersModule {}

async function eventually(check: () => Promise<boolean> | boolean, timeoutMs = 30_000): Promise<void> {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** HH:MM in Bangkok, `hours` from now. */
const bangkokClock = (hours: number) => toBangkokIso(new Date(Date.now() + hours * 3_600_000)).slice(11, 16);

describe('B1.3 acceptance (e2e: HTTP app + worker process)', () => {
  let app: INestApplication;
  let worker: INestApplicationContext;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    const appRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = appRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    await seedDev(prisma, E2E_DEV_PASSWORD);
    const workerRef = await Test.createTestingModule({
      imports: [WorkerModule, AcceptanceSubscribersModule],
    }).compile();
    worker = workerRef.createNestApplication({ logger: false });
    await worker.init();
    for (const role of ['superadmin']) {
      const res = await request(server)
        .post('/v1/auth/staff/login')
        .send({ email: `${role}@example.invalid`, password: E2E_DEV_PASSWORD })
        .expect(200);
      tokens[role] = res.body.accessToken as string;
    }
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  const admin = () => tokens['superadmin']!;

  it('writes audit + event + outbox atomically for a mutation, and a subscriber receives it exactly once', async () => {
    const created = await request(server)
      .post('/v1/admin/users')
      .auth(admin(), { type: 'bearer' })
      .send({
        kind: 'staff',
        email: 'acceptance.cs@example.invalid',
        displayName: 'CS ทดสอบ',
        initialPassword: 'temporary-passphrase-1',
      })
      .expect(201);
    const userId = created.body.id as string;
    await request(server)
      .post(`/v1/admin/users/${userId}/roles`)
      .auth(admin(), { type: 'bearer' })
      .send({ role: 'cs', reason: 'acceptance' })
      .expect(201);

    const event = await prisma.domainEvent.findFirstOrThrow({
      where: { type: 'iam.role_granted', aggregateId: userId },
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'iam.role_granted', resourcePublicId: userId },
    });
    const outbox = await prisma.outboxMessage.findFirstOrThrow({ where: { eventId: event.id } });
    expect(event.correlationId).toBeDefined();
    expect(audit.requestId).toBeTruthy();
    expect(outbox.topic).toBe('iam');

    await eventually(() => received.includes(event.id));
    await eventually(
      async () =>
        (await prisma.outboxMessage.findUniqueOrThrow({ where: { id: outbox.id } })).status === 'dispatched',
    );

    // Replay (admin) re-dispatches, but the consumer has already processed it.
    await prisma.outboxMessage.update({ where: { id: outbox.id }, data: { status: 'dead' } });
    await request(server)
      .post(`/v1/admin/outbox/${event.id}/actions/replay`)
      .auth(admin(), { type: 'bearer' })
      .expect(200);
    await eventually(
      async () =>
        (await prisma.outboxMessage.findUniqueOrThrow({ where: { id: outbox.id } })).status === 'dispatched',
    );
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(received.filter((id) => id === event.id)).toHaveLength(1);
    expect(
      await prisma.eventConsumption.count({ where: { eventId: event.id, consumer: 'e2e.role-granted' } }),
    ).toBe(1);
  });

  it('routes a notification through the matrix: consent, no SMS for non-critical events, quiet hours (D-143, D-144)', async () => {
    // Quiet hours: a marketing window that does not include "now" (Bangkok).
    const window = { from: bangkokClock(2), to: bangkokClock(3), timezone: 'Asia/Bangkok' };
    const settingId = (
      await prisma.setting.findFirstOrThrow({ where: { key: 'notifications.marketing_window' } })
    ).publicId;
    await request(server)
      .post(`/v1/admin/settings/${settingId}/versions`)
      .auth(admin(), { type: 'bearer' })
      .send({
        value: window,
        effectiveFrom: new Date().toISOString(),
        reason: 'acceptance: window away from now',
      })
      .expect(201);

    // Consent text for LINE marketing, then two LINE-linked customers: one consents, one does not.
    await request(server)
      .post('/v1/admin/consent-purposes/marketing_line/versions')
      .auth(admin(), { type: 'bearer' })
      .send({
        textTh: 'ยินยอมรับข่าวสารทาง LINE (ทดสอบ)',
        textEn: 'News on LINE (test text)',
        effectiveFrom: new Date().toISOString(),
        reason: 'acceptance',
      })
      .expect(201);
    const sms = app.get<FakeSmsSender>(SMS_SENDER);
    const customer = async (phone: string, lineUser: string) => {
      const otp = await request(server).post('/v1/auth/customer/otp/request').send({ phone }).expect(200);
      const code = /\d{6}/.exec(sms.lastTo(`+66${phone.replace(/-/g, '').slice(1)}`)!.text)![0];
      const login = await request(server)
        .post('/v1/auth/customer/otp/verify')
        .send({ challengeId: otp.body.challengeId, code })
        .expect(200);
      await request(server)
        .post('/v1/auth/customer/line')
        .auth(login.body.accessToken as string, { type: 'bearer' })
        .send({ idToken: `fake-line.${lineUser}` })
        .expect(200);
      return { id: login.body.subject.id as string, token: login.body.accessToken as string };
    };
    const consenting = await customer('081-000-2001', 'Uacceptance1');
    const silent = await customer('081-000-2002', 'Uacceptance2');
    await request(server)
      .post('/v1/store/me/consents')
      .auth(consenting.token, { type: 'bearer' })
      .send({ purpose: 'marketing_line', granted: true })
      .expect(201);

    // Templates and routes for a promotional event.
    const template = async (channel: string, category: string, body: string) => {
      const created = await request(server)
        .post('/v1/admin/notification-templates')
        .auth(admin(), { type: 'bearer' })
        .send({ key: 'promo.announced:customer', channel, category, description: `acceptance ${channel}` })
        .expect(201);
      await request(server)
        .post(`/v1/admin/notification-templates/${created.body.id}/versions`)
        .auth(admin(), { type: 'bearer' })
        .send({ locale: 'th', subject: 'โปร', body })
        .expect(201);
      const published = await request(server)
        .post(`/v1/admin/notification-templates/${created.body.id}/versions/th/1/actions/publish`)
        .auth(admin(), { type: 'bearer' });
      // Shows the problem body if publishing ever fails.
      expect({ status: published.status, body: published.status === 200 ? null : published.body }).toEqual({
        status: 200,
        body: null,
      });
      return created.body.id as string;
    };
    const lineTemplate = await template('line', 'marketing', 'โปรโมชัน {{payload.campaign}} (ทดสอบ)');
    const inAppTemplate = await template('in_app', 'transactional', 'ข่าว {{payload.campaign}}');
    const smsTemplate = await template('sms', 'marketing', 'SMS {{payload.campaign}}');
    const route = (templateId: string, extra: object = {}) =>
      request(server)
        .post('/v1/admin/notification-routes')
        .auth(admin(), { type: 'bearer' })
        .send({
          eventType: 'promo.announced',
          audience: 'customer',
          templateId,
          isCritical: false,
          isMarketing: false,
          ...extra,
        });
    await route(lineTemplate, { isMarketing: true }).expect(201);
    await route(inAppTemplate).expect(201);
    expect((await route(smsTemplate, { isMarketing: true }).expect(422)).body.errors[0].code).toBe('d143');

    const events = app.get(DomainEvents);
    const announce = (customerId: string) =>
      prisma.withTx((tx) =>
        events.record(tx, {
          type: 'promo.announced',
          aggregateType: 'user',
          aggregateId: customerId,
          payload: { customerId, campaign: 'ACC-1' },
        }),
      );
    const toConsenting = await announce(consenting.id);
    const toSilent = await announce(silent.id);

    const rows = (eventId: string) =>
      prisma.notification.findMany({ where: { eventId }, orderBy: { channel: 'asc' } });
    await eventually(
      async () => (await rows(toConsenting.id)).length === 2 && (await rows(toSilent.id)).length === 2,
    );

    const consentingLine = (await rows(toConsenting.id)).find((r) => r.channel === 'line')!;
    expect(consentingLine.status).toBe('deferred_quiet_hours');
    expect(toBangkokIso(consentingLine.scheduledFor!).slice(11, 16)).toBe(window.from);
    expect((await rows(toSilent.id)).find((r) => r.channel === 'line')!.status).toBe('suppressed_no_consent');

    // In-app (transactional) is delivered right away by the worker's delivery job.
    await eventually(
      async () => (await rows(toConsenting.id)).find((r) => r.channel === 'in_app')!.status === 'sent',
    );
    const inbox = await request(server)
      .get('/v1/store/notifications')
      .auth(consenting.token, { type: 'bearer' })
      .expect(200);
    expect(inbox.body.data[0]).toMatchObject({
      id: toConsenting.id,
      eventType: 'promo.announced',
      body: 'ข่าว ACC-1',
    });
    await request(server)
      .post(`/v1/store/notifications/${toConsenting.id}/actions/read`)
      .auth(consenting.token, { type: 'bearer' })
      .expect(204);

    // When the window opens the deferred LINE message goes out.
    const line = worker.get<FakeLineMessaging>(LINE_MESSAGING);
    expect(line.sent.some((m) => m.to === 'Uacceptance1')).toBe(false);
    await worker
      .get(NotificationDelivery)
      .deliverDue(new Date(consentingLine.scheduledFor!.getTime() + 1_000));
    expect(line.sent.find((m) => m.to === 'Uacceptance1')?.text).toBe('โปรโมชัน ACC-1 (ทดสอบ)');
    expect(line.sent.some((m) => m.to === 'Uacceptance2')).toBe(false);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: consentingLine.id } })).status).toBe(
      'sent',
    );

    // Idempotent per (event, recipient, channel): routing the same event again adds nothing.
    await prisma.eventConsumption.deleteMany({
      where: { eventId: toConsenting.id, consumer: 'notifications.router' },
    });
    await prisma.outboxMessage.updateMany({
      where: { eventId: toConsenting.id },
      data: { status: 'pending', nextAttemptAt: new Date() },
    });
    await eventually(
      async () =>
        (await prisma.eventConsumption.count({
          where: { eventId: toConsenting.id, consumer: 'notifications.router' },
        })) === 1,
    );
    expect(await prisma.notification.count({ where: { eventId: toConsenting.id } })).toBe(2);
  });
});
