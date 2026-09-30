import { randomUUID } from 'node:crypto';

import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { nameUuid } from '@common/ids/uuidv7';
import { cursorPaginated, decodeCursor } from '@common/pagination/pagination';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type Conversation,
  type ConversationMessage,
  type LineAccount,
  type MessageKind,
  type Prisma,
} from '@generated/prisma/client';
import { LINE_MESSAGING, type LineMessaging } from '@integrations/line-messaging/line-messaging.port';
import { Inject, Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { RealtimePublisher } from '@platform/realtime/realtime.publisher';

export const CONVERSATION_INCLUDE = {
  customer: { select: { publicId: true, displayName: true } },
  lineAccount: { select: { publicId: true, displayName: true, friendStatus: true } },
  assignedUser: { select: { publicId: true, displayName: true } },
  messages: { orderBy: [{ sentAt: 'desc' }, { id: 'desc' }], take: 1 },
  tickets: { orderBy: { id: 'desc' }, take: 1 },
} satisfies Prisma.ConversationInclude;
export type ConversationRow = Prisma.ConversationGetPayload<{ include: typeof CONVERSATION_INCLUDE }>;

export type MessageRow = ConversationMessage & {
  senderUser: { publicId: string; displayName: string } | null;
};

/**
 * Chat with CS (D-151): the customer writes from LINE (the OA webhook) or from the store / LIFF; staff answer
 * from the inbox — replies to LINE conversations are pushed to the user's LINE, web replies reach the
 * customer live. One live conversation per LINE user and per customer on the web; a message to a closed one
 * opens a new one. Signals (ids only, contract §6) tell the assigned staff member and the customer to refetch.
 */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
    private readonly realtime: RealtimePublisher,
    @Inject(LINE_MESSAGING) private readonly line: LineMessaging,
  ) {}

  // --- inbound -------------------------------------------------------------------------------------------

  /** A LINE message into the account's live conversation (in the webhook's transaction). */
  async receiveLine(
    tx: Tx,
    account: LineAccount,
    m: { kind: MessageKind; body: string | null; providerMessageId: string | null; sentAt: Date },
  ): Promise<void> {
    if (
      m.providerMessageId &&
      (await tx.conversationMessage.count({ where: { providerMessageId: m.providerMessageId } }))
    )
      return;
    let conversation = await tx.conversation.findFirst({
      where: { lineAccountId: account.id, status: { not: 'closed' } },
    });
    if (!conversation) {
      conversation = await tx.conversation.create({
        data: {
          channel: 'line',
          lineAccountId: account.id,
          customerUserId: account.userId,
          lastMessageAt: m.sentAt,
        },
      });
      await this.record(tx, conversation, 'conversation.opened', { channel: 'line' });
    }
    await this.inbound(tx, conversation, { ...m, senderUserId: null });
  }

  /** The customer writes from the store / LIFF. */
  async customerSend(actor: UserActor, body: string): Promise<ConversationMessage> {
    return this.prisma.withTx(async (tx) => {
      let conversation = await tx.conversation.findFirst({
        where: { channel: 'web', customerUserId: actor.userId, status: { not: 'closed' } },
      });
      if (!conversation) {
        conversation = await tx.conversation.create({
          data: { channel: 'web', customerUserId: actor.userId },
        });
        await this.record(tx, conversation, 'conversation.opened', { channel: 'web' });
      }
      return this.inbound(tx, conversation, {
        kind: 'text',
        body,
        providerMessageId: null,
        sentAt: new Date(),
        senderUserId: actor.userId,
      });
    });
  }

  /**
   * The conversation a support ticket opens on (D-221): a signed-in customer's live web conversation (or a new one),
   * a new `contact` conversation for a guest (answered by phone or e-mail); the requester's message (if any) arrives
   * on it.
   */
  async openForTicket(tx: Tx, customerUserId: bigint | null, body: string | null): Promise<Conversation> {
    let conversation = customerUserId
      ? await tx.conversation.findFirst({ where: { channel: 'web', customerUserId, status: { not: 'closed' } } })
      : null;
    if (!conversation) {
      const channel = customerUserId ? 'web' : 'contact';
      conversation = await tx.conversation.create({ data: { channel, customerUserId } });
      await this.record(tx, conversation, 'conversation.opened', { channel });
    }
    if (body !== null)
      await this.inbound(tx, conversation, {
        kind: 'text',
        body,
        providerMessageId: null,
        sentAt: new Date(),
        senderUserId: customerUserId,
      });
    return conversation;
  }

  private async inbound(
    tx: Tx,
    conversation: Conversation,
    m: {
      kind: MessageKind;
      body: string | null;
      providerMessageId: string | null;
      sentAt: Date;
      senderUserId: bigint | null;
    },
  ): Promise<ConversationMessage> {
    const message = await tx.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        direction: 'inbound',
        senderUserId: m.senderUserId,
        kind: m.kind,
        body: m.body,
        providerMessageId: m.providerMessageId,
        sentAt: m.sentAt,
      },
    });
    await tx.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: m.sentAt, status: 'open', rowVersion: { increment: 1 } },
    });
    await this.record(tx, conversation, 'conversation.message_received', { messageId: message.publicId });
    await this.signalStaff(tx, conversation);
    return message;
  }

  // --- staff ---------------------------------------------------------------------------------------------

  async get(publicId: string, db: Tx = this.prisma): Promise<ConversationRow> {
    const row = await db.conversation.findUnique({ where: { publicId }, include: CONVERSATION_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async list(where: Prisma.ConversationWhereInput, page: number, perPage: number) {
    return Promise.all([
      this.prisma.conversation.findMany({
        where,
        include: CONVERSATION_INCLUDE,
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.conversation.count({ where }),
    ]);
  }

  /** A staff reply: pushed to LINE for LINE conversations, live to the customer on the web. */
  async reply(actor: UserActor, publicId: string, body: string): Promise<ConversationMessage> {
    const conversation = await this.get(publicId);
    if (conversation.status === 'closed') throw new DomainException('conversations.closed');
    const messageId = randomUUID();
    let providerMessageId: string | null = null;
    if (conversation.channel === 'line') {
      const account = await this.prisma.lineAccount.findUniqueOrThrow({
        where: { id: conversation.lineAccountId! },
      });
      if (account.friendStatus === 'blocked')
        throw new DomainException('conversations.unreachable', {
          params: { reason: 'the user blocked the account' },
        });
      const sent = await this.line.push({
        to: account.lineUserId,
        text: body,
        retryKey: nameUuid(`conversation-reply:${messageId}`),
      });
      providerMessageId = sent.providerMessageId;
    }
    return this.prisma.withTx(async (tx) => {
      const message = await tx.conversationMessage.create({
        data: {
          publicId: messageId,
          conversationId: conversation.id,
          direction: 'outbound',
          senderUserId: actor.userId,
          kind: 'text',
          body,
          providerMessageId,
          sentAt: new Date(),
        },
      });
      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: message.sentAt,
          status: 'pending',
          assignedUserId: conversation.assignedUserId ?? actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      // The first answer on the conversation answers its open support tickets (D-221 first-response target).
      await tx.supportTicket.updateMany({
        where: { conversationId: conversation.id, firstRespondedAt: null },
        data: { firstRespondedAt: message.sentAt },
      });
      // Inbound messages count as read once someone answered.
      await tx.conversationMessage.updateMany({
        where: { conversationId: conversation.id, direction: 'inbound', readAt: null },
        data: { readAt: new Date() },
      });
      await this.record(tx, conversation, 'conversation.replied', { messageId: message.publicId }, actor);
      if (conversation.customer)
        await this.realtime.publish(`user:${conversation.customer.publicId}`, {
          type: 'conversation.message',
          id: conversation.publicId,
        });
      return message;
    });
  }

  async assign(actor: UserActor, publicId: string, userPublicId?: string): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      const conversation = await this.get(publicId, tx);
      const assignee = userPublicId
        ? await tx.user.findFirst({ where: { publicId: userPublicId, kind: 'staff', status: 'active' } })
        : await tx.user.findUniqueOrThrow({ where: { id: actor.userId } });
      if (!assignee)
        throw new DomainException('validation.failed', {
          errors: [{ path: 'userId', code: 'exists', message: 'must be an active staff user' }],
        });
      await tx.conversation.update({
        where: { id: conversation.id },
        data: { assignedUserId: assignee.id, rowVersion: { increment: 1 } },
      });
      await this.record(tx, conversation, 'conversation.assigned', { assigneeId: assignee.publicId }, actor);
      await this.realtime.publish(`user:${assignee.publicId}`, {
        type: 'conversation.assigned',
        id: conversation.publicId,
      });
    });
  }

  async close(actor: UserActor, publicId: string): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      const conversation = await this.get(publicId, tx);
      if (conversation.status === 'closed') return;
      await tx.conversation.update({
        where: { id: conversation.id },
        data: { status: 'closed', closedAt: new Date(), rowVersion: { increment: 1 } },
      });
      await this.record(tx, conversation, 'conversation.closed', {}, actor);
    });
  }

  // --- messages ------------------------------------------------------------------------------------------

  /** Newest first; the cursor continues to older messages. */
  async messages(conversationId: bigint, cursor: string | undefined, limit: number) {
    const after = cursor ? decodeCursor(cursor) : null;
    const where: Prisma.ConversationMessageWhereInput = {
      conversationId,
      ...(after && {
        OR: [
          { sentAt: { lt: new Date(String(after['t'])) } },
          { sentAt: new Date(String(after['t'])), id: { lt: BigInt(String(after['id'])) } },
        ],
      }),
    };
    const rows = await this.prisma.conversationMessage.findMany({
      where,
      include: { senderUser: { select: { publicId: true, displayName: true } } },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return cursorPaginated<MessageRow>(rows, limit, (m) => ({
      t: m.sentAt.toISOString(),
      id: m.id.toString(),
    }));
  }

  /** The customer's live web conversation (or the latest one). */
  async customerConversation(customerUserId: bigint): Promise<Conversation | null> {
    return this.prisma.conversation.findFirst({
      where: { channel: 'web', customerUserId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  /** The customer read Packio's replies. */
  async markReadByCustomer(conversationId: bigint): Promise<void> {
    await this.prisma.conversationMessage.updateMany({
      where: { conversationId, direction: 'outbound', readAt: null },
      data: { readAt: new Date() },
    });
  }

  sender(userId: bigint) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { publicId: true, displayName: true },
    });
  }

  // --- helpers -------------------------------------------------------------------------------------------

  private async signalStaff(tx: Tx, conversation: Conversation) {
    if (!conversation.assignedUserId) return;
    const user = await tx.user.findUnique({
      where: { id: conversation.assignedUserId },
      select: { publicId: true },
    });
    if (user)
      await this.realtime.publish(`user:${user.publicId}`, {
        type: 'conversation.message',
        id: conversation.publicId,
      });
  }

  private async record(
    tx: Tx,
    conversation: Conversation,
    type: string,
    data: Record<string, unknown>,
    actor?: Actor,
  ) {
    const customer = conversation.customerUserId
      ? await tx.user.findUnique({ where: { id: conversation.customerUserId }, select: { publicId: true } })
      : null;
    const event = await this.events.record(
      tx,
      {
        type,
        aggregateType: 'conversation',
        aggregateId: conversation.publicId,
        payload: {
          conversationId: conversation.publicId,
          channel: conversation.channel,
          ...(customer && { customerUserPublicId: customer.publicId }),
          ...data,
        },
      },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'conversation',
      aggregatePublicId: conversation.publicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: ['internal'],
      domainEventId: event.id,
      ...(actor && { actor }),
    });
  }
}
