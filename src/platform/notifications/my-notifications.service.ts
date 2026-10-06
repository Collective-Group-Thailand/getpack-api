import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { decodeCursor, encodeCursor } from '@common/pagination/pagination';
import { PrismaService } from '@database/prisma.service';
import {
  type ConsentSource,
  type NotificationCategory,
  type NotificationChannel,
} from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { PARTNER_CATEGORIES, PARTNER_CHANNELS } from './notifications.dto';
import { readablePayload } from './policy-labels';
import { renderTemplate } from './template-renderer';

const partnerLocked = (channel: string, category: string) =>
  category === 'security' || (channel === 'email' && category === 'transactional');

/**
 * A user's own notification settings (D-143 channel choice, D-144 opt-out of marketing only), PDPA
 * consents (Packio's own consent management, D-005) and the in-app inbox.
 */
@Injectable()
export class MyNotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  preferences(userId: bigint) {
    return this.prisma.notificationPreference.findMany({
      where: { userId },
      orderBy: [{ channel: 'asc' }, { category: 'asc' }],
    });
  }

  async setPreferences(
    actor: UserActor,
    items: { channel: NotificationChannel; category: NotificationCategory; enabled: boolean }[],
  ) {
    const locked = items.find((i) => i.channel === 'email' && i.category === 'transactional' && !i.enabled);
    if (locked) {
      throw new DomainException('validation.failed', {
        errors: [
          {
            path: 'items',
            code: 'd144',
            message: 'Order and finance e-mails cannot be switched off (D-144)',
          },
        ],
      });
    }
    await this.prisma.withTx(async (tx) => {
      for (const item of items) {
        await tx.notificationPreference.upsert({
          where: {
            userId_channel_category: { userId: actor.userId, channel: item.channel, category: item.category },
          },
          create: { userId: actor.userId, ...item },
          update: { enabled: item.enabled },
        });
      }
      await this.audit.record(tx, {
        category: 'data_access',
        action: 'notification_preferences.changed',
        resourceType: 'user',
        resourcePublicId: actor.publicId,
        data: { items },
      });
    });
    return this.preferences(actor.userId);
  }

  /** Each purpose with the text in force and the user's latest decision. */
  async consents(userId: bigint) {
    const now = new Date();
    const purposes = await this.prisma.consentPurpose.findMany({
      include: {
        versions: {
          where: { status: 'approved', effectiveFrom: { lte: now } },
          orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
          take: 1,
        },
        records: {
          where: { userId },
          orderBy: { recordedAt: 'desc' },
          take: 1,
          include: { purposeVersion: { select: { versionNo: true } } },
        },
      },
      orderBy: { key: 'asc' },
    });
    return purposes.map((p) => ({
      purpose: p,
      version: p.versions[0] ?? null,
      latest: p.records[0] ?? null,
    }));
  }

  async recordConsent(actor: UserActor, purposeKey: string, granted: boolean, source: ConsentSource) {
    const current = (await this.consents(actor.userId)).find((c) => c.purpose.key === purposeKey);
    if (!current) throw new DomainException('http.not_found');
    if (!current.version) throw new DomainException('consent.purpose_unavailable');
    await this.prisma.withTx(async (tx) => {
      const record = await tx.consentRecord.create({
        data: {
          userId: actor.userId,
          purposeId: current.purpose.id,
          purposeVersionId: current.version!.id,
          granted,
          source,
          ip: null,
        },
      });
      await this.audit.record(tx, {
        category: 'data_access',
        action: granted ? 'consent.granted' : 'consent.withdrawn',
        resourceType: 'user',
        resourcePublicId: actor.publicId,
        data: { purpose: purposeKey, versionNo: current.version!.versionNo, source },
      });
      await this.events.record(tx, {
        type: granted ? 'consent.granted' : 'consent.withdrawn',
        aggregateType: 'user',
        aggregateId: actor.publicId,
        payload: {
          userId: actor.publicId,
          purpose: purposeKey,
          versionNo: current.version!.versionNo,
          recordId: record.id.toString(),
        },
      });
    });
    return this.consents(actor.userId);
  }

  /** In-app inbox, newest first; the item id is the event id (unique per user and channel). */
  async inbox(userId: bigint, cursor: string | undefined, limit: number) {
    const position = cursor ? decodeCursor(cursor) : undefined;
    const beforeId = position ? BigInt(position['id'] as string) : undefined;
    const rows = await this.prisma.notification.findMany({
      where: {
        recipientUserId: userId,
        channel: 'in_app',
        status: { in: ['sent', 'read'] },
        ...(beforeId && { id: { lt: beforeId } }),
      },
      include: { event: true, templateVersion: true },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const items = await Promise.all(
      rows.slice(0, limit).map(async (row) => {
        const rendered = row.templateVersion
          ? await renderTemplate('in_app', row.templateVersion, {
              event: { type: row.event.type },
              payload: readablePayload(row.event.payload, row.templateVersion.locale),
              recipient: {},
            })
          : { subject: null, body: '' };
        return { row, title: rendered.subject, body: rendered.body };
      }),
    );
    const last = rows.length > limit ? rows[limit - 1] : undefined;
    const unreadCount = await this.prisma.notification.count({
      where: { recipientUserId: userId, channel: 'in_app', status: 'sent' },
    });
    return { items, nextCursor: last ? encodeCursor({ id: last.id.toString() }) : null, unreadCount };
  }

  /** Marks every unread in-app notification of the user read (U-B0.3); idempotent. */
  async markAllRead(userId: bigint): Promise<number> {
    const updated = await this.prisma.notification.updateMany({
      where: { recipientUserId: userId, channel: 'in_app', status: 'sent' },
      data: { status: 'read', readAt: new Date() },
    });
    return updated.count;
  }

  // --- factory users (D-143, D-231) -----------------------------------------------------------------------

  /** Every channel × category of a factory user, unset = on; e-mail of transactional events and security are locked. */
  async partnerPreferences(userId: bigint) {
    const [rows, line] = await Promise.all([
      this.prisma.notificationPreference.findMany({ where: { userId } }),
      this.prisma.lineAccount.count({ where: { userId, linkedAt: { not: null } } }),
    ]);
    const preferences = PARTNER_CATEGORIES.flatMap((category) =>
      PARTNER_CHANNELS.map((channel) => {
        const locked = partnerLocked(channel, category);
        const row = rows.find((r) => r.channel === channel && r.category === category);
        return { channel, category, enabled: locked || (row?.enabled ?? true), locked };
      }),
    );
    return { preferences, lineLinked: line > 0 };
  }

  async setPartnerPreferences(
    actor: UserActor,
    items: {
      channel: (typeof PARTNER_CHANNELS)[number];
      category: (typeof PARTNER_CATEGORIES)[number];
      enabled: boolean;
    }[],
  ) {
    const locked = items.findIndex((i) => !i.enabled && partnerLocked(i.channel, i.category));
    if (locked >= 0)
      throw new DomainException('validation.failed', {
        errors: [
          {
            path: `preferences.${locked}`,
            code: 'locked',
            message: 'Job and shipment e-mails and security messages cannot be switched off (D-231)',
          },
        ],
      });
    await this.setPreferences(actor, items);
    return this.partnerPreferences(actor.userId);
  }

  async markRead(userId: bigint, eventId: string): Promise<void> {
    const updated = await this.prisma.notification.updateMany({
      where: { recipientUserId: userId, channel: 'in_app', eventId, status: { in: ['sent', 'read'] } },
      data: { status: 'read', readAt: new Date() },
    });
    if (updated.count === 0) throw new DomainException('http.not_found');
  }
}
