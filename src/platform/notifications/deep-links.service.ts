import { createHash, randomBytes } from 'node:crypto';

import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { AppConfig } from '@config/app-config';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';
import { SettingsService } from '@platform/settings/settings.service';

import { inboxLink, type InboxSurface } from './inbox-links';

/** The zone a user's notifications open in. */
export const SURFACE_OF_KIND: Record<string, InboxSurface> = {
  customer: 'store',
  staff: 'admin',
  partner: 'partner',
};
/** The token's first letter names the zone, so the web knows where to sign in before it resolves the link. */
const PREFIX: Record<InboxSurface, string> = { store: 's', admin: 'a', partner: 'p' };

const sha256 = (token: string) => createHash('sha256').update(token, 'utf8').digest();

/**
 * Notification deep links (U5.B1, D-299): a message that has a page for its event carries `<web>/l/<token>`. The token
 * is random, stored as SHA-256 only, bound to the recipient and that one page and valid
 * `notifications.deep_link_ttl_hours`. It is never a credential: the recipient resolves it signed in, on their own
 * zone (`*.deepLinks.resolve`), and gets the page's path; anyone else gets 404.
 */
@Injectable()
export class DeepLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly config: AppConfig,
  ) {}

  /**
   * The link of one notification, or null when its event has no page in the recipient's zone. A retried delivery gets
   * a new token (the old one stops working): the raw token exists only in the message.
   */
  async issue(
    notification: {
      id: bigint;
      recipient: { id: bigint; kind: string } | null;
      event: { aggregateType: string; aggregateId: string; payload: unknown };
    },
    now = new Date(),
    db: Tx = this.prisma,
  ): Promise<string | null> {
    const recipient = notification.recipient;
    const surface = recipient ? SURFACE_OF_KIND[recipient.kind] : undefined;
    if (!recipient || !surface) return null;
    const { aggregateType, aggregateId, payload } = notification.event;
    const path = inboxLink(surface, aggregateType, aggregateId, payload);
    if (!path) return null;
    const ttlHours = Number((await this.settings.at('notifications.deep_link_ttl_hours', { at: now })).value);
    const token = `${PREFIX[surface]}${randomBytes(24).toString('base64url')}`;
    const expiresAt = new Date(now.getTime() + ttlHours * 3_600_000);
    await db.deepLinkToken.upsert({
      where: { notificationId: notification.id },
      create: {
        tokenHash: sha256(token),
        notificationId: notification.id,
        userId: recipient.id,
        surface,
        path,
        expiresAt,
      },
      update: { tokenHash: sha256(token), path, expiresAt, openCount: 0, lastOpenedAt: null },
    });
    const web = this.config.get('STOREFRONT_BASE_URL') ?? 'https://www.packio.invalid';
    return `${web.replace(/\/$/, '')}/l/${token}`;
  }

  /** The page of a link, for its signed-in recipient on its own zone (404 otherwise, 410 once expired). */
  async resolve(
    actor: UserActor,
    surface: InboxSurface,
    token: string,
    now = new Date(),
  ): Promise<{ path: string; expiresAt: string }> {
    const row = await this.prisma.deepLinkToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.userId !== actor.userId || row.surface !== surface)
      throw new DomainException('http.not_found');
    if (row.expiresAt <= now) throw new DomainException('deep_links.expired');
    await this.prisma.deepLinkToken.update({
      where: { id: row.id },
      data: { openCount: { increment: 1 }, lastOpenedAt: now },
    });
    return { path: row.path, expiresAt: toBangkokIso(row.expiresAt) };
  }
}
