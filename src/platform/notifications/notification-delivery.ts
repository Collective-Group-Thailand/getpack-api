import { FieldEncryption } from '@common/crypto/field-encryption';
import { nameUuid } from '@common/ids/uuidv7';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { EMAIL_SENDER, type EmailSender } from '@integrations/email/email-sender.port';
import { ProviderUnavailableError } from '@integrations/http/resilient-http';
import { LINE_MESSAGING, type LineMessaging } from '@integrations/line-messaging/line-messaging.port';
import { SMS_SENDER, type SmsSender } from '@integrations/sms/sms-sender.port';
import { TEAMS_WEBHOOK, type TeamsWebhook } from '@integrations/teams/teams.port';
import { WEB_PUSH, type WebPushSender } from '@integrations/web-push/web-push.port';
import { maskPhone } from '@modules/auth/login/phone';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';
import { RealtimePublisher } from '@platform/realtime/realtime.publisher';

import { renderTemplate } from './template-renderer';

const BATCH = 100;
/** A claimed row is invisible to other workers for this long (crash safety). */
const LEASE_MS = 5 * 60_000;
/** Provider outages are retried every 5 minutes for up to a day, then the row fails. */
const RETRY_MS = 5 * 60_000;
const GIVE_UP_MS = 24 * 60 * 60_000;

export class NoAddressError extends Error {}

const DELIVERY_INCLUDE = {
  event: true,
  templateVersion: { include: { template: true } },
  route: { include: { staffTeam: true } },
  recipient: {
    include: { staffProfile: true, identities: { where: { provider: 'line', unlinkedAt: null } } },
  },
} satisfies Prisma.NotificationInclude;
type DeliveryRow = Prisma.NotificationGetPayload<{ include: typeof DELIVERY_INCLUDE }>;

export const maskEmail = (email: string): string => {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
};

/**
 * Sends queued notifications (and deferred marketing once its window opens) through the channel
 * adapters. Rows are leased with `FOR UPDATE SKIP LOCKED`, so replicas never send the same row
 * concurrently; delivery is at-least-once (LINE deduplicates with a retry key derived from the row).
 */
@Injectable()
export class NotificationDelivery {
  private readonly logger = new Logger(NotificationDelivery.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: FieldEncryption,
    private readonly realtime: RealtimePublisher,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(LINE_MESSAGING) private readonly line: LineMessaging,
    @Inject(WEB_PUSH) private readonly webPush: WebPushSender,
    @Inject(TEAMS_WEBHOOK) private readonly teams: TeamsWebhook,
  ) {}

  @ScheduledJob({ name: 'notifications.deliver', every: 5_000 })
  async deliverDue(now: Date = new Date()): Promise<number> {
    const ids = await this.prisma.withTx(async (tx) => {
      const due = await tx.$queryRaw<{ id: bigint }[]>`
        SELECT id FROM notifications
         WHERE status IN ('queued', 'deferred_quiet_hours') AND COALESCE(scheduled_for, created_at) <= ${now}
         ORDER BY COALESCE(scheduled_for, created_at), id
         LIMIT ${BATCH}
         FOR UPDATE SKIP LOCKED`;
      if (due.length > 0) {
        await tx.notification.updateMany({
          where: { id: { in: due.map((d) => d.id) } },
          data: { scheduledFor: new Date(now.getTime() + LEASE_MS) },
        });
      }
      return due.map((d) => d.id);
    });
    for (const id of ids) await this.deliverOne(id, now);
    return ids.length;
  }

  private async deliverOne(id: bigint, now: Date): Promise<void> {
    const row = await this.prisma.notification.findUniqueOrThrow({
      where: { id },
      include: DELIVERY_INCLUDE,
    });
    try {
      if (!row.templateVersion) throw new NoAddressError('template version missing');
      const rendered = await renderTemplate(row.channel, row.templateVersion, {
        event: { type: row.event.type, occurredAt: toBangkokIso(row.event.occurredAt) },
        payload: row.event.payload,
        recipient: { displayName: row.recipient?.displayName ?? row.route?.staffTeam?.nameTh ?? '' },
      });
      const { providerMessageId, masked } = await this.send(row, rendered);
      await this.prisma.notification.update({
        where: { id },
        data: {
          status: 'sent',
          sentAt: new Date(),
          scheduledFor: null,
          providerMessageId,
          error: null,
          ...(masked && { recipientAddressMasked: masked }),
        },
      });
    } catch (error) {
      const transient =
        error instanceof ProviderUnavailableError && now.getTime() - row.createdAt.getTime() < GIVE_UP_MS;
      const message =
        error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 1_000) : 'send failed';
      if (!(error instanceof ProviderUnavailableError) && !(error instanceof NoAddressError))
        this.logger.error(message);
      await this.prisma.notification.update({
        where: { id },
        data: transient
          ? { status: 'queued', scheduledFor: new Date(now.getTime() + RETRY_MS), error: message }
          : { status: 'failed', scheduledFor: null, error: message },
      });
    }
  }

  /**
   * Sends a rendered template to the acting staff member's own address (template "test send");
   * nothing is written to the notification log. Audited by the caller.
   */
  async testSend(
    userId: bigint,
    channel: string,
    rendered: { subject: string | null; body: string; text: string },
  ): Promise<{ masked: string | null }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { staffProfile: true },
    });
    switch (channel) {
      case 'email':
        if (!user.email) throw new NoAddressError('no e-mail address');
        await this.email.send({
          to: user.email,
          subject: `[TEST] ${rendered.subject ?? 'Packio'}`,
          html: rendered.body,
          text: rendered.text,
        });
        return { masked: maskEmail(user.email) };
      case 'sms':
        if (!user.phone) throw new NoAddressError('no phone number');
        await this.sms.send({ to: user.phone, text: `[TEST] ${rendered.text}` });
        return { masked: maskPhone(user.phone) };
      case 'line':
        if (!user.staffProfile?.lineUserId) throw new NoAddressError('no LINE user id');
        await this.line.push({
          to: user.staffProfile.lineUserId,
          text: `[TEST] ${rendered.text}`,
          retryKey: nameUuid(`test:${userId}:${Date.now()}`),
        });
        return { masked: null };
      default:
        throw new NoAddressError(`test send not supported for ${channel}`);
    }
  }

  private async send(
    row: DeliveryRow,
    rendered: { subject: string | null; body: string; text: string },
  ): Promise<{ providerMessageId: string | null; masked?: string }> {
    const user = row.recipient;
    switch (row.channel) {
      case 'email': {
        if (!user?.email) throw new NoAddressError('no e-mail address');
        const sent = await this.email.send({
          to: user.email,
          subject: rendered.subject ?? 'Packio',
          html: rendered.body,
          text: rendered.text,
        });
        return { providerMessageId: sent.providerMessageId, masked: maskEmail(user.email) };
      }
      case 'sms': {
        if (!user?.phone) throw new NoAddressError('no phone number');
        const sent = await this.sms.send({ to: user.phone, text: rendered.text });
        return { providerMessageId: sent.providerMessageId, masked: maskPhone(user.phone) };
      }
      case 'line': {
        const to =
          row.route?.staffTeam?.lineGroupId ??
          user?.staffProfile?.lineUserId ??
          user?.identities[0]?.providerSubject;
        if (!to) throw new NoAddressError('no LINE recipient');
        const sent = await this.line.push({
          to,
          text: rendered.text,
          retryKey: nameUuid(`notification:${row.id}`),
        });
        return { providerMessageId: sent.providerMessageId };
      }
      case 'teams': {
        const ref = row.route?.staffTeam?.teamsWebhookSecretRef;
        if (!ref) throw new NoAddressError('team has no Teams webhook');
        await this.teams.post(ref, rendered.text);
        return { providerMessageId: null };
      }
      case 'web_push': {
        if (!user) throw new NoAddressError('no user');
        const subscriptions = await this.prisma.webPushSubscription.findMany({
          where: { userId: user.id, revokedAt: null },
        });
        if (subscriptions.length === 0) throw new NoAddressError('no push subscription');
        const payload = JSON.stringify({
          title: rendered.subject ?? 'Packio',
          body: rendered.text,
          type: row.event.type,
          eventId: row.eventId,
        });
        for (const subscription of subscriptions) {
          const result = await this.webPush.send(
            {
              endpoint: subscription.endpoint,
              p256dh: subscription.p256dh,
              auth: this.encryption.decrypt(subscription.authSecretEnc),
            },
            payload,
          );
          await this.prisma.webPushSubscription.update({
            where: { id: subscription.id },
            data: result === 'gone' ? { revokedAt: new Date() } : { lastUsedAt: new Date() },
          });
        }
        return { providerMessageId: null };
      }
      case 'in_app': {
        if (!user) throw new NoAddressError('no user');
        await this.realtime.publish(`user:${user.publicId}`, {
          type: 'notification.created',
          id: row.eventId,
        });
        return { providerMessageId: null };
      }
    }
  }
}
