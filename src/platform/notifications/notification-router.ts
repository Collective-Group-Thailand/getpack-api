import { createHash } from 'node:crypto';

import { bytes } from '@common/crypto/hashing';
import { type Tx } from '@database/prisma.service';
import {
  type NotificationCategory,
  type NotificationChannel,
  type NotificationStatus,
  type Prisma,
} from '@generated/prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { SettingsService } from '@platform/settings/settings.service';

import { nextMarketingSlot } from './quiet-hours';
import { type Recipient, RecipientDirectory } from './recipients';

/** PDPA consent purpose that allows marketing on a channel (D-144). Other channels carry no marketing. */
const MARKETING_PURPOSE: Partial<Record<NotificationChannel, string>> = {
  email: 'marketing_email',
  line: 'marketing_line',
  sms: 'marketing_sms',
};

export type RoutingDecision =
  | { send: false; reason: 'sms_not_critical' | 'opted_out' }
  | { send: true; status: NotificationStatus; scheduledFor: Date | null };

/**
 * Pure routing rules (D-143, D-144), in order:
 * 1. SMS only for events whose route is critical (OTP, instalment due, shipped, claim decision).
 * 2. Marketing needs PDPA consent for the channel and the user's preference; without consent the
 *    row is kept as `suppressed_no_consent` (evidence of the decision).
 * 3. Marketing outside the Bangkok window is deferred to the next window start.
 * 4. Transactional and security messages: e-mail always (cannot be switched off); other channels
 *    follow the user's preference.
 */
export function decide(input: {
  channel: NotificationChannel;
  category: NotificationCategory;
  isCritical: boolean;
  isMarketing: boolean;
  preferenceEnabled: boolean | undefined;
  marketingConsent: boolean;
  now: Date;
  window: { from: string; to: string };
}): RoutingDecision {
  if (input.channel === 'sms' && !input.isCritical) return { send: false, reason: 'sms_not_critical' };
  const marketing = input.isMarketing || input.category === 'marketing';
  if (marketing) {
    if (input.preferenceEnabled === false) return { send: false, reason: 'opted_out' };
    if (!input.marketingConsent) return { send: true, status: 'suppressed_no_consent', scheduledFor: null };
    const slot = nextMarketingSlot(input.now, input.window);
    return slot
      ? { send: true, status: 'deferred_quiet_hours', scheduledFor: slot }
      : { send: true, status: 'queued', scheduledFor: null };
  }
  if (input.channel !== 'email' && input.preferenceEnabled === false)
    return { send: false, reason: 'opted_out' };
  return { send: true, status: 'queued', scheduledFor: null };
}

/**
 * Routes every domain event through the matrix event × audience × channel (`notification_routes`)
 * and writes one `notifications` row per recipient and channel — idempotent per
 * (event, recipient, channel) through a unique index. Delivery happens later (`NotificationDelivery`),
 * never inside this transaction.
 */
@Injectable()
export class NotificationRouter {
  private readonly logger = new Logger(NotificationRouter.name);

  constructor(
    private readonly recipients: RecipientDirectory,
    private readonly settings: SettingsService,
  ) {}

  @OnDomainEvent('*', { consumer: 'notifications.router' })
  async route(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const routes = await tx.notificationRoute.findMany({
      where: { eventType: event.type, enabled: true },
      include: { template: { include: { versions: { where: { status: 'published' } } } } },
    });
    if (routes.length === 0) return;
    const now = new Date();
    const window = await this.settings.value('notifications.marketing_window', now);
    const rows: Prisma.NotificationCreateManyInput[] = [];

    for (const route of routes) {
      if (!conditionsHold(route.conditions, event.payload)) continue;
      for (const recipient of await this.recipients.resolve(event, route, tx)) {
        const version =
          route.template.versions.find((v) => v.locale === recipient.locale) ??
          route.template.versions.find((v) => v.locale === 'th');
        if (!version) {
          this.logger.warn(
            `no published ${route.channel} template ${route.template.key}; ${event.type} not routed`,
          );
          continue;
        }
        const decision = decide({
          channel: route.channel,
          category: route.template.category,
          isCritical: route.isCritical,
          isMarketing: route.isMarketing,
          preferenceEnabled: await this.preference(tx, recipient, route.channel, route.template.category),
          marketingConsent: await this.consent(tx, recipient, route.channel),
          now,
          window,
        });
        if (!decision.send) continue;
        rows.push({
          eventId: event.id,
          routeId: route.id,
          recipientUserId: recipient.userId ?? null,
          recipientAddressHash: recipient.team
            ? bytes(createHash('sha256').update(`${route.channel}:team:${recipient.team.code}`).digest())
            : null,
          recipientAddressMasked: recipient.team ? `team:${recipient.team.code}` : null,
          channel: route.channel,
          templateVersionId: version.id,
          status: decision.status,
          scheduledFor: decision.scheduledFor,
        });
      }
    }
    if (rows.length > 0) await tx.notification.createMany({ data: rows, skipDuplicates: true });
  }

  private async preference(
    tx: Tx,
    recipient: Recipient,
    channel: NotificationChannel,
    category: NotificationCategory,
  ) {
    if (recipient.userId === undefined) return undefined;
    const pref = await tx.notificationPreference.findUnique({
      where: { userId_channel_category: { userId: recipient.userId, channel, category } },
    });
    return pref?.enabled;
  }

  /** Latest consent record for the channel's marketing purpose (PDPA, D-144). */
  private async consent(tx: Tx, recipient: Recipient, channel: NotificationChannel): Promise<boolean> {
    const purpose = MARKETING_PURPOSE[channel];
    if (!purpose || recipient.userId === undefined) return false;
    const latest = await tx.consentRecord.findFirst({
      where: { userId: recipient.userId, purpose: { key: purpose } },
      orderBy: { recordedAt: 'desc' },
    });
    return latest?.granted === true;
  }
}

/** Optional route conditions: `{ "payload.field": value }` equality on the event payload. */
function conditionsHold(conditions: unknown, payload: Record<string, unknown>): boolean {
  if (!conditions || typeof conditions !== 'object') return true;
  return Object.entries(conditions as Record<string, unknown>).every(([path, expected]) => {
    const value = path
      .replace(/^payload\./, '')
      .split('.')
      .reduce<unknown>(
        (v, key) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined),
        payload,
      );
    return value === expected;
  });
}
