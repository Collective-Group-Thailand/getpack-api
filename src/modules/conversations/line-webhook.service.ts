import { createHmac, timingSafeEqual } from 'node:crypto';

import { DomainException } from '@common/errors/domain.exception';
import { AppConfig } from '@config/app-config';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type LineAccount, type MessageKind } from '@generated/prisma/client';
import { Injectable, Logger } from '@nestjs/common';

import { ConversationsService } from './conversations.service';
import { RichMenusService } from './rich-menus.service';

interface LineEvent {
  type: string;
  webhookEventId?: string;
  timestamp?: number;
  source?: { type?: string; userId?: string };
  message?: { id?: string; type?: string; text?: string };
}

const KINDS: Record<string, MessageKind> = {
  text: 'text',
  image: 'image',
  sticker: 'sticker',
  file: 'file',
  video: 'file',
  audio: 'file',
};

/** Verifies `x-line-signature`: base64 HMAC-SHA256 of the exact body with the channel secret. */
export function lineSignatureValid(secret: string, raw: Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  const given = Buffer.from(signature, 'base64');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * The official account's webhook (D-151): signature-verified, stored once per LINE event in
 * `webhook_inbox` (redeliveries are no-ops, no message text or user ids kept there — PDPA). Follow /
 * unfollow keep the friend status and show the guest or member rich menu; messages land in the user's live
 * LINE conversation for the CS inbox.
 */
@Injectable()
export class LineWebhookService {
  private readonly logger = new Logger(LineWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly conversations: ConversationsService,
    private readonly richMenus: RichMenusService,
  ) {}

  async receive(signature: string | undefined, raw: Buffer | undefined, body: unknown): Promise<void> {
    const secret = this.config.get('LINE_MESSAGING_CHANNEL_SECRET');
    if (!secret || !raw || !lineSignatureValid(secret, raw, signature))
      throw new DomainException('line.signature_invalid');
    const payload = (body ?? {}) as { destination?: string; events?: LineEvent[] };
    const channelId = this.config.get('LINE_MESSAGING_CHANNEL_ID') ?? payload.destination ?? 'default';
    for (const event of payload.events ?? []) {
      const lineUserId = event.source?.userId;
      if (!event.webhookEventId || !lineUserId) continue;
      const account = await this.prisma.withTx((tx) => this.handle(tx, channelId, lineUserId, event));
      // Menus are LINE-side state: switched after the commit, best effort.
      if (account && event.type === 'follow') await this.richMenus.show(account).catch(() => undefined);
    }
  }

  private async handle(
    tx: Tx,
    channelId: string,
    lineUserId: string,
    event: LineEvent,
  ): Promise<LineAccount | null> {
    const seen = await tx.webhookInbox.findUnique({
      where: {
        provider_providerEventId: { provider: 'line_messaging', providerEventId: event.webhookEventId! },
      },
    });
    if (seen) return null;
    await tx.webhookInbox.create({
      data: {
        provider: 'line_messaging',
        providerEventId: event.webhookEventId!,
        signatureValid: true,
        payload: { type: event.type, messageType: event.message?.type ?? null },
        status: 'processed',
        processedAt: new Date(),
      },
    });
    const account = await this.account(tx, channelId, lineUserId);
    const at = event.timestamp ? new Date(event.timestamp) : new Date();
    switch (event.type) {
      case 'follow':
        return tx.lineAccount.update({ where: { id: account.id }, data: { friendStatus: 'followed' } });
      case 'unfollow':
        return tx.lineAccount.update({ where: { id: account.id }, data: { friendStatus: 'blocked' } });
      case 'message': {
        const kind = KINDS[event.message?.type ?? ''] ?? 'system';
        const text = kind === 'text' ? (event.message?.text ?? '').slice(0, 5000) : null;
        if (kind === 'text' && !text?.trim()) return account;
        await this.conversations.receiveLine(tx, account, {
          kind,
          body: text ?? (kind === 'system' ? `[${event.message?.type ?? 'unsupported'}]` : null),
          providerMessageId: event.message?.id ?? null,
          sentAt: at,
        });
        return account;
      }
      default:
        this.logger.debug({ type: event.type }, 'LINE event ignored');
        return account;
    }
  }

  /** The OA user, linked to the customer who signed in with the same LINE user id (LINE Login / LIFF). */
  private async account(tx: Tx, channelId: string, lineUserId: string): Promise<LineAccount> {
    const existing = await tx.lineAccount.findUnique({
      where: { channelId_lineUserId: { channelId, lineUserId } },
    });
    if (existing) return existing;
    const identity = await tx.userIdentity.findFirst({
      where: { provider: 'line', providerSubject: lineUserId, unlinkedAt: null },
    });
    return tx.lineAccount.create({
      data: {
        channelId,
        lineUserId,
        userId: identity?.userId ?? null,
        linkedAt: identity ? new Date() : null,
      },
    });
  }
}
