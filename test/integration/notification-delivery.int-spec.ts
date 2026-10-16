import { FieldEncryption } from '@common/crypto/field-encryption';
import { type AppConfig } from '@config/app-config';
import { PrismaService } from '@database/prisma.service';
import { type NotificationChannel } from '@generated/prisma/client';
import { FakeEmailSender } from '@integrations/email/fake-email-sender';
import { ProviderUnavailableError } from '@integrations/http/resilient-http';
import { FakeLineMessaging } from '@integrations/line-messaging/fake-line-messaging';
import { FakeSmsSender } from '@integrations/sms/fake-sms-sender';
import { FakeTeamsWebhook } from '@integrations/teams/fake-teams';
import { FakeWebPush } from '@integrations/web-push/fake-web-push';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { DeepLinksService } from '@platform/notifications/deep-links.service';
import { NotificationDelivery } from '@platform/notifications/notification-delivery';
import { type RealtimePublisher } from '@platform/realtime/realtime.publisher';
import { SettingsService } from '@platform/settings/settings.service';

import { seedDev } from '../../prisma/seed/dev-seed';
import { type MigratedDatabase, startMigratedDatabase, stopMigratedDatabase } from '../support/database';

describe('notification delivery per channel (PostgreSQL 18, fake providers)', () => {
  let db: MigratedDatabase;
  let prisma: PrismaService;
  let delivery: NotificationDelivery;
  let deepLinks: DeepLinksService;
  const email = new FakeEmailSender();
  const sms = new FakeSmsSender();
  const line = new FakeLineMessaging();
  const webPush = new FakeWebPush();
  const teams = new FakeTeamsWebhook();
  const published: { channel: string; type: string }[] = [];
  const encryption = new FieldEncryption({ get: () => undefined } as unknown as AppConfig);
  let customerId: bigint;
  let staffId: bigint;
  let customerPublicId: string;
  let seq = 0;

  beforeAll(async () => {
    db = await startMigratedDatabase();
    prisma = new PrismaService({ get: () => db.url } as unknown as AppConfig);
    await seedDev(prisma);
    const realtime = {
      publish: (channel: string, signal: { type: string }) =>
        Promise.resolve(void published.push({ channel, type: signal.type })),
    };
    deepLinks = new DeepLinksService(prisma, new SettingsService(prisma), {
      get: () => 'https://web.getpack.invalid',
    } as unknown as AppConfig);
    delivery = new NotificationDelivery(
      prisma,
      encryption,
      realtime as unknown as RealtimePublisher,
      email,
      sms,
      line,
      webPush,
      teams,
      deepLinks,
    );

    staffId = (await prisma.user.findFirstOrThrow({ where: { email: 'finance@example.invalid' } })).id;
    const customer = await prisma.user.create({
      data: {
        kind: 'customer',
        status: 'active',
        displayName: 'ลูกค้า ทดสอบ',
        phone: '+66810004001',
        identities: { create: { provider: 'line', providerSubject: 'Udelivery1' } },
      },
    });
    customerId = customer.id;
    await prisma.webPushSubscription.createMany({
      data: [
        {
          userId: customerId,
          endpoint: 'https://push.example.com/ok',
          p256dh: 'p256dh-key',
          authSecretEnc: encryption.encrypt('secret-1'),
        },
        {
          userId: customerId,
          endpoint: 'https://push.example.com/gone',
          p256dh: 'p256dh-key',
          authSecretEnc: encryption.encrypt('secret-2'),
        },
      ],
    });
    await prisma.team.update({
      where: { code: 'finance' },
      data: { teamsWebhookSecretRef: 'getpack/teams/finance' },
    });
    customerPublicId = customer.publicId;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await stopMigratedDatabase(db);
  });

  const templateVersion = async (channel: NotificationChannel, body = 'ข้อความ {{payload.code}}') => {
    const template = await prisma.notificationTemplate.create({
      data: {
        key: `delivery.test.n${seq}:${channel}`,
        channel,
        category: 'transactional',
        description: 'test',
        versions: {
          create: {
            versionNo: 1,
            locale: 'th',
            subject: 'เรื่อง {{payload.code}}',
            body,
            status: 'published',
            publishedAt: new Date(),
          },
        },
      },
      include: { versions: true },
    });
    return template;
  };

  /** One event, template and route per queued row (all three are unique per key/channel/event). */
  const queue = async (
    channel: NotificationChannel,
    recipient: { userId?: bigint; teamRoute?: boolean },
    about: { aggregateType: string; aggregateId: string; body?: string } = {
      aggregateType: 'user',
      aggregateId: customerPublicId,
    },
  ) => {
    seq += 1;
    const event = await prisma.withTx((tx) =>
      new DomainEvents().record(tx, {
        type: `delivery.test.n${seq}`,
        aggregateType: about.aggregateType,
        aggregateId: about.aggregateId,
        payload: { code: 'PK-0001' },
      }),
    );
    const template = await templateVersion(channel, about.body);
    const team = recipient.teamRoute
      ? await prisma.team.findUniqueOrThrow({ where: { code: 'finance' } })
      : null;
    const route = await prisma.notificationRoute.create({
      data: {
        eventType: `delivery.test.n${seq}`,
        audience: team ? 'staff_team' : 'customer',
        staffTeamId: team?.id ?? null,
        channel,
        templateId: template.id,
        isCritical: channel === 'sms',
      },
    });
    return prisma.notification.create({
      data: {
        eventId: event.id,
        routeId: route.id,
        recipientUserId: recipient.userId ?? null,
        recipientAddressHash: team ? Buffer.alloc(32, channel.length) : null,
        channel,
        templateVersionId: template.versions[0]!.id,
        status: 'queued',
      },
    });
  };

  const statusOf = async (id: bigint) => prisma.notification.findUniqueOrThrow({ where: { id } });

  it('delivers each channel through its adapter and records the masked address', async () => {
    const mail = await queue('email', { userId: staffId });
    const text = await queue('sms', { userId: customerId });
    const chat = await queue('line', { userId: customerId });
    const push = await queue('web_push', { userId: customerId });
    const inbox = await queue('in_app', { userId: customerId });
    const team = await queue('teams', { teamRoute: true });

    await delivery.deliverDue();

    expect(await statusOf(mail.id)).toMatchObject({
      status: 'sent',
      recipientAddressMasked: 'f***@example.invalid',
    });
    expect(email.sent[0]).toMatchObject({ to: 'finance@example.invalid', subject: 'เรื่อง PK-0001' });
    expect(email.sent[0]!.html).toContain('ข้อความ PK-0001');
    expect(await statusOf(text.id)).toMatchObject({ status: 'sent', recipientAddressMasked: '+66•••••4001' });
    expect(sms.sent[0]).toMatchObject({ to: '+66810004001', text: 'ข้อความ PK-0001' });
    expect((await statusOf(chat.id)).status).toBe('sent');
    expect(line.sent[0]).toMatchObject({ to: 'Udelivery1', text: 'ข้อความ PK-0001' });
    expect((await statusOf(push.id)).status).toBe('sent');
    expect(webPush.sent.map((s) => s.target.auth)).toEqual(['secret-1']); // decrypted for sending only
    expect(
      (
        await prisma.webPushSubscription.findUniqueOrThrow({
          where: { endpoint: 'https://push.example.com/gone' },
        })
      ).revokedAt,
    ).not.toBeNull();
    expect((await statusOf(inbox.id)).status).toBe('sent');
    expect(published).toEqual([
      expect.objectContaining({ type: 'notification.created', channel: expect.stringMatching(/^user:/) }),
    ]);
    expect((await statusOf(team.id)).status).toBe('sent');
    expect(teams.posted[0]).toEqual({ secretRef: 'getpack/teams/finance', text: 'ข้อความ PK-0001' });
  });

  it('gives a message about a page a deep link bound to its recipient (D-299)', async () => {
    const orderId = '0192f3a0-7c1e-7d2a-9b1f-0000000e7399';
    const chat = await queue(
      'line',
      { userId: customerId },
      {
        aggregateType: 'order',
        aggregateId: orderId,
        body: 'ข้อความ {{payload.code}}{{#if link}} {{link}}{{/if}}',
      },
    );
    const before = line.sent.length;
    await delivery.deliverDue();
    expect((await statusOf(chat.id)).status).toBe('sent');
    const text = line.sent[before]!.text;
    const token = /https:\/\/web\.getpack\.invalid\/l\/(s[A-Za-z0-9_-]{32})$/.exec(text)?.[1];
    expect(token).toBeDefined();
    const row = await prisma.deepLinkToken.findUniqueOrThrow({ where: { notificationId: chat.id } });
    expect(row).toMatchObject({ userId: customerId, surface: 'store', path: `/account/orders/${orderId}` });
    expect(row.tokenHash).not.toEqual(Buffer.from(token!)); // stored hashed
    const hours = (row.expiresAt.getTime() - row.createdAt.getTime()) / 3_600_000;
    expect(Math.round(hours)).toBe(72); // notifications.deep_link_ttl_hours

    const customer = { type: 'user', userId: customerId, audience: 'customer' } as never;
    await expect(deepLinks.resolve(customer, 'store', token!)).resolves.toMatchObject({
      path: `/account/orders/${orderId}`,
    });
    // Someone else, another zone or an unknown token: not found; after expiry: gone.
    const other = { type: 'user', userId: staffId, audience: 'staff' } as never;
    await expect(deepLinks.resolve(other, 'store', token!)).rejects.toMatchObject({ code: 'http.not_found' });
    await expect(deepLinks.resolve(customer, 'admin', token!)).rejects.toMatchObject({
      code: 'http.not_found',
    });
    await expect(deepLinks.resolve(customer, 'store', `s${'x'.repeat(32)}`)).rejects.toMatchObject({
      code: 'http.not_found',
    });
    await expect(
      deepLinks.resolve(customer, 'store', token!, new Date(row.expiresAt.getTime() + 1)),
    ).rejects.toMatchObject({ code: 'deep_links.expired' });
    expect((await prisma.deepLinkToken.findUniqueOrThrow({ where: { id: row.id } })).openCount).toBe(1);

    // A message without a page for its event carries no link.
    const plain = await queue(
      'line',
      { userId: customerId },
      {
        aggregateType: 'user',
        aggregateId: customerPublicId,
        body: 'x{{#if link}} {{link}}{{/if}}',
      },
    );
    const n = line.sent.length;
    await delivery.deliverDue();
    expect(line.sent[n]!.text).toBe('x');
    expect(await prisma.deepLinkToken.count({ where: { notificationId: plain.id } })).toBe(0);
  });

  it('fails a row without an address and retries provider outages for a day', async () => {
    const noEmail = await queue('email', { userId: customerId });
    await delivery.deliverDue();
    expect(await statusOf(noEmail.id)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('no e-mail address'),
    });

    const outage = await queue('email', { userId: staffId });
    const send = jest.spyOn(email, 'send').mockRejectedValueOnce(new ProviderUnavailableError('ses', 'down'));
    const now = new Date();
    await delivery.deliverDue(now);
    const retried = await statusOf(outage.id);
    expect(retried.status).toBe('queued');
    expect(retried.scheduledFor!.getTime()).toBeGreaterThan(now.getTime());
    send.mockRejectedValueOnce(new ProviderUnavailableError('ses', 'still down'));
    await delivery.deliverDue(new Date(now.getTime() + 25 * 60 * 60_000));
    expect(await statusOf(outage.id)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('still down'),
    });
    send.mockRestore();
  });

  it('sends deferred marketing once its slot is due, and test sends to the actor only', async () => {
    const deferred = await queue('email', { userId: staffId });
    const slot = new Date(Date.now() + 3_600_000);
    await prisma.notification.update({
      where: { id: deferred.id },
      data: { status: 'deferred_quiet_hours', scheduledFor: slot },
    });
    await delivery.deliverDue();
    expect((await statusOf(deferred.id)).status).toBe('deferred_quiet_hours');
    await delivery.deliverDue(new Date(slot.getTime() + 1_000));
    expect((await statusOf(deferred.id)).status).toBe('sent');

    const before = email.sent.length;
    await expect(
      delivery.testSend(staffId, 'email', { subject: 'S', body: '<p>B</p>', text: 'B' }),
    ).resolves.toEqual({ masked: 'f***@example.invalid' });
    expect(email.sent[before]).toMatchObject({ to: 'finance@example.invalid', subject: '[TEST] S' });
    await expect(
      delivery.testSend(staffId, 'teams', { subject: null, body: 'x', text: 'x' }),
    ).rejects.toThrow('not supported');
  });
});
