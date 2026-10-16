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
  type ReplyChannel,
} from '@generated/prisma/client';
import { LINE_MESSAGING, type LineMessaging } from '@integrations/line-messaging/line-messaging.port';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { BusinessCalendarService } from '@platform/calendar/business-calendar.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { FilesService } from '@platform/files/files.service';
import { RealtimePublisher } from '@platform/realtime/realtime.publisher';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import { checkContextCard, type ContextCard, ownSubject, type RecordSubject } from './conversation-subjects';

export const CONVERSATION_INCLUDE = {
  customer: { select: { publicId: true, displayName: true } },
  lineAccount: { select: { publicId: true, displayName: true, friendStatus: true, userId: true } },
  assignedUser: { select: { publicId: true, displayName: true } },
  company: { select: { publicId: true, legalName: true } },
  messages: {
    where: { visibility: 'customer' },
    orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
    take: 1,
  },
  tickets: { orderBy: { id: 'desc' }, take: 1 },
  participants: {
    include: { user: { select: { publicId: true, displayName: true } } },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.ConversationInclude;
export type ConversationRow = Prisma.ConversationGetPayload<{ include: typeof CONVERSATION_INCLUDE }>;

export type MessageRow = ConversationMessage & {
  senderUser: { publicId: string; displayName: string } | null;
  fileObject?: { publicId: string; originalName: string; mimeType: string } | null;
};
const MESSAGE_INCLUDE = {
  senderUser: { select: { publicId: true, displayName: true } },
  fileObject: { select: { publicId: true, originalName: true, mimeType: true } },
} satisfies Prisma.ConversationMessageInclude;

/** What a customer or staff member sends: text and/or files, optionally a card to one of the customer's records. */
export interface Outgoing {
  body?: string | null;
  fileIds?: string[];
  contextCard?: ContextCard | null;
  cannedResponseId?: string | null;
}

/**
 * Chat with CS (D-151), threads v2 (D-300): every customer has a general `support` thread and may open one per order,
 * design or RFQ of theirs (an RFQ basket's opens with its submission); one live thread per customer × subject, a
 * message to a closed one opens a new one. A linked LINE account writes into the customer's support thread (a live
 * LINE thread merges into it on link). Staff replies go to LINE when the thread's reply channel says so (set by the
 * customer, else the channel of their last message); internal notes never leave the inbox. Participants carry read
 * positions; the first customer message waiting for an answer starts the D-221 first-response clock. Signals (ids
 * only, contract §6) tell the assigned staff member and the customer to refetch.
 */
@Injectable()
export class ConversationsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
    private readonly realtime: RealtimePublisher,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
    private readonly calendars: BusinessCalendarService,
    @Inject(LINE_MESSAGING) private readonly line: LineMessaging,
  ) {}

  onModuleInit(): void {
    // A file sent in a conversation: its uploader, staff with `files.read`, and the thread's customer when the
    // message is theirs to see (never an internal note).
    this.files.registerFileReader('conversations', async (actor, file) => {
      if (actor.type !== 'user' || actor.audience !== 'customer') return false;
      const n = await this.prisma.conversationMessage.count({
        where: {
          fileObjectId: file.id,
          visibility: 'customer',
          conversation: { customerUserId: actor.userId },
        },
      });
      return n > 0;
    });
  }

  // --- inbound -------------------------------------------------------------------------------------------

  /**
   * A LINE message (in the webhook's transaction): into the account's live thread, else — the account linked — into
   * the customer's live support thread, else a new LINE thread.
   */
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
    if (!conversation && account.userId) {
      const support = await this.liveSupport(tx, account.userId);
      if (support)
        conversation = await tx.conversation.update({
          where: { id: support.id },
          data: { lineAccountId: account.id, rowVersion: { increment: 1 } },
        });
    }
    if (!conversation) {
      conversation = await tx.conversation.create({
        data: {
          channel: 'line',
          lineAccountId: account.id,
          customerUserId: account.userId,
          lastMessageAt: m.sentAt,
          resolutionDueAt: await this.resolutionDue(m.sentAt),
        },
      });
      await this.record(tx, conversation, 'conversation.opened', { channel: 'line', subjectType: 'support' });
    }
    await this.inbound(tx, conversation, { ...m, senderUserId: account.userId, via: 'line' });
  }

  /**
   * D-300 on link: the account's live LINE thread becomes the customer's — merged into their live support thread when
   * they have one (messages moved, the LINE thread closed and pointing to it), else adopted as it is.
   */
  async mergeLinked(tx: Tx, account: LineAccount, userId: bigint): Promise<void> {
    const lineThread = await tx.conversation.findFirst({
      where: { lineAccountId: account.id, status: { not: 'closed' } },
    });
    if (!lineThread) return;
    const support = await tx.conversation.findFirst({
      where: {
        customerUserId: userId,
        subjectType: 'support',
        status: { not: 'closed' },
        channel: { not: 'contact' },
        id: { not: lineThread.id },
      },
    });
    if (!support) {
      if (lineThread.customerUserId === null)
        await tx.conversation.update({
          where: { id: lineThread.id },
          data: { customerUserId: userId, rowVersion: { increment: 1 } },
        });
      await this.join(tx, lineThread.id, userId, 'customer');
      return;
    }
    await tx.conversationMessage.updateMany({
      where: { conversationId: lineThread.id },
      data: { conversationId: support.id },
    });
    await tx.conversation.update({
      where: { id: lineThread.id },
      data: {
        status: 'closed',
        closedAt: new Date(),
        mergedIntoId: support.id,
        customerUserId: userId,
        rowVersion: { increment: 1 },
      },
    });
    const earliest = [lineThread.firstResponseDueAt, support.firstResponseDueAt]
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    await tx.conversation.update({
      where: { id: support.id },
      data: {
        lineAccountId: account.id,
        lastMessageAt:
          lineThread.lastMessageAt > support.lastMessageAt ? lineThread.lastMessageAt : support.lastMessageAt,
        ...(support.firstRespondedAt === null && earliest && { firstResponseDueAt: earliest }),
        rowVersion: { increment: 1 },
      },
    });
    await this.record(tx, support, 'conversation.merged', { mergedId: lineThread.publicId, channel: 'line' });
  }

  /** The customer writes into their support thread from the store / LIFF (B4.6 endpoint). */
  async customerSend(actor: UserActor, body: string): Promise<ConversationMessage> {
    return this.prisma.withTx(async (tx) => {
      const conversation =
        (await this.liveSupport(tx, actor.userId)) ?? (await this.openWeb(tx, actor.userId, null));
      return this.inbound(tx, conversation, {
        kind: 'text',
        body,
        providerMessageId: null,
        sentAt: new Date(),
        senderUserId: actor.userId,
        via: 'web',
      });
    });
  }

  /**
   * D-300: a thread about the support chat or one of my records, opened (or found live) with my first message.
   * Returns the thread and the message(s) sent.
   */
  async openThread(
    actor: UserActor,
    input: Outgoing & { subjectType: 'support' | RecordSubject; subjectId?: string | null },
  ): Promise<{ conversation: Conversation; messages: ConversationMessage[] }> {
    return this.prisma.withTx(async (tx) => {
      const subject =
        input.subjectType === 'support'
          ? null
          : await ownSubject(tx, actor.userId, input.subjectType, input.subjectId ?? '', 'subjectId');
      const conversation =
        (await this.liveThread(tx, actor.userId, input.subjectType, subject?.id ?? null)) ??
        (await this.openWeb(
          tx,
          actor.userId,
          subject && {
            type: input.subjectType as RecordSubject,
            id: subject.id,
            companyId: subject.companyId,
          },
        ));
      const messages = await this.customerMessages(tx, actor, conversation, input);
      return { conversation, messages };
    });
  }

  /** I write into a thread of mine; a closed thread is continued in a new live one about the same subject. */
  async customerPost(
    actor: UserActor,
    publicId: string,
    input: Outgoing,
  ): Promise<{ conversation: Conversation; messages: ConversationMessage[] }> {
    return this.prisma.withTx(async (tx) => {
      let conversation = await this.ownThread(tx, actor.userId, publicId);
      if (conversation.status === 'closed') {
        const target = await tx.conversation.findUnique({ where: { id: conversation.mergedIntoId ?? -1n } });
        conversation =
          (target && target.status !== 'closed' ? target : null) ??
          (await this.liveThread(tx, actor.userId, conversation.subjectType, conversation.subjectId)) ??
          (await this.openWeb(
            tx,
            actor.userId,
            conversation.subjectType === 'support'
              ? null
              : {
                  type: conversation.subjectType,
                  id: conversation.subjectId!,
                  companyId: conversation.companyId,
                },
          ));
      }
      const messages = await this.customerMessages(tx, actor, conversation, input);
      return { conversation, messages };
    });
  }

  /**
   * The conversation a support ticket opens on (D-221): a signed-in customer's live support thread (or a new one), a
   * new `contact` conversation for a guest (answered by phone or e-mail); the requester's message (if any) arrives on
   * it.
   */
  async openForTicket(tx: Tx, customerUserId: bigint | null, body: string | null): Promise<Conversation> {
    let conversation = customerUserId ? await this.liveSupport(tx, customerUserId) : null;
    if (!conversation) {
      if (customerUserId) conversation = await this.openWeb(tx, customerUserId, null);
      else {
        conversation = await tx.conversation.create({
          data: { channel: 'contact', resolutionDueAt: await this.resolutionDue(new Date()) },
        });
        await this.record(tx, conversation, 'conversation.opened', {
          channel: 'contact',
          subjectType: 'support',
        });
      }
    }
    if (body !== null)
      await this.inbound(tx, conversation, {
        kind: 'text',
        body,
        providerMessageId: null,
        sentAt: new Date(),
        senderUserId: customerUserId,
        via: customerUserId ? 'web' : null,
      });
    return conversation;
  }

  /** D-301: the conversation of a submitted RFQ basket (in the submission's transaction), with its first message. */
  async openBasketThread(
    tx: Tx,
    customerUserId: bigint,
    basketId: bigint,
    body: string,
  ): Promise<Conversation> {
    const conversation = await this.openWeb(tx, customerUserId, {
      type: 'rfq_basket',
      id: basketId,
      companyId: null,
    });
    await this.inbound(tx, conversation, {
      kind: 'text',
      body,
      providerMessageId: null,
      sentAt: new Date(),
      senderUserId: customerUserId,
      via: 'web',
    });
    return conversation;
  }

  private async customerMessages(
    tx: Tx,
    actor: UserActor,
    conversation: Conversation,
    input: Outgoing,
  ): Promise<ConversationMessage[]> {
    const card = input.contextCard ? await checkContextCard(tx, actor.userId, input.contextCard) : null;
    const files = await this.ownFiles(tx, [actor.userId], input.fileIds ?? []);
    const body = input.body?.trim() || null;
    if (!body && files.length === 0 && !card)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'body', code: 'required', message: 'a text, a file or a card is needed' }],
      });
    const sentAt = new Date();
    const out: ConversationMessage[] = [];
    // A text (with its card) first, then one message per file — the shape LINE media take too.
    if (body || card)
      out.push(
        await this.inbound(tx, conversation, {
          kind: body ? 'text' : 'system',
          body,
          providerMessageId: null,
          sentAt,
          senderUserId: actor.userId,
          via: 'web',
          contextCard: card,
        }),
      );
    for (const f of files)
      out.push(
        await this.inbound(tx, conversation, {
          kind: f.mimeType.startsWith('image/') ? 'image' : 'file',
          body: null,
          providerMessageId: null,
          sentAt,
          senderUserId: actor.userId,
          via: 'web',
          fileObjectId: f.id,
        }),
      );
    await this.markRead(tx, conversation.id, actor.userId, 'customer');
    return out;
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
      via: ReplyChannel | null;
      contextCard?: ContextCard | null;
      fileObjectId?: bigint | null;
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
        via: m.via,
        contextCard: (m.contextCard ?? undefined) as Prisma.InputJsonValue | undefined,
        fileObjectId: m.fileObjectId ?? null,
      },
    });
    const current = await tx.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    // D-221: the first customer message waiting for an answer starts the first-response clock.
    const startClock = current.firstRespondedAt === null && current.firstResponseDueAt === null;
    await tx.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: m.sentAt,
        status: 'open',
        ...(m.via && { lastInboundVia: m.via }),
        ...(startClock && { firstResponseDueAt: await this.firstResponseDue(m.sentAt) }),
        rowVersion: { increment: 1 },
      },
    });
    if (m.senderUserId) await this.join(tx, conversation.id, m.senderUserId, 'customer');
    await this.record(tx, conversation, 'conversation.message_received', {
      messageId: message.publicId,
      via: m.via,
    });
    await this.signalStaff(tx, conversation);
    return message;
  }

  // --- customer reads --------------------------------------------------------------------------------------------

  /** My threads, latest activity first, with how many of getpack's messages I have not read. */
  async customerThreads(customerUserId: bigint) {
    const rows = await this.prisma.conversation.findMany({
      where: { customerUserId, mergedIntoId: null, channel: { not: 'contact' } },
      include: CONVERSATION_INCLUDE,
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return Promise.all(rows.map(async (r) => ({ row: r, unread: await this.unreadFor(r, customerUserId) })));
  }

  async customerThread(customerUserId: bigint, publicId: string): Promise<ConversationRow> {
    const row = await this.prisma.conversation.findUnique({
      where: { publicId },
      include: CONVERSATION_INCLUDE,
    });
    if (!row || row.customerUserId !== customerUserId || row.channel === 'contact')
      throw new DomainException('http.not_found');
    return row;
  }

  private async ownThread(tx: Tx, customerUserId: bigint, publicId: string): Promise<Conversation> {
    const row = await tx.conversation.findUnique({ where: { publicId } });
    if (!row || row.customerUserId !== customerUserId || row.channel === 'contact')
      throw new DomainException('http.not_found');
    return row;
  }

  /** getpack's messages after my read position. */
  async unreadFor(row: ConversationRow, userId: bigint): Promise<number> {
    const me = row.participants.find((p) => p.userId === userId);
    return this.prisma.conversationMessage.count({
      where: {
        conversationId: row.id,
        direction: 'outbound',
        visibility: 'customer',
        ...(me?.lastReadAt && { sentAt: { gt: me.lastReadAt } }),
      },
    });
  }

  /** D-300: the customer chooses where getpack's replies go; LINE needs a linked account that still follows the OA. */
  async setReplyChannel(actor: UserActor, publicId: string, channel: ReplyChannel): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      const conversation = await this.ownThread(tx, actor.userId, publicId);
      if (channel === 'line') {
        const account = await this.lineAccountOf(tx, conversation);
        if (!account || account.friendStatus === 'blocked')
          throw new DomainException('conversations.unreachable', {
            params: { reason: 'no linked LINE account follows getpack' },
          });
      }
      await tx.conversation.update({
        where: { id: conversation.id },
        data: { replyChannel: channel, rowVersion: { increment: 1 } },
      });
      await this.record(tx, conversation, 'conversation.reply_channel_set', { replyChannel: channel }, actor);
    });
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

  /**
   * A staff reply: pushed to LINE when the thread's effective reply channel is LINE, live to the customer on the web
   * otherwise; the first one answers the first-response clock and the thread's open support tickets.
   */
  async reply(actor: UserActor, publicId: string, input: Outgoing | string): Promise<ConversationMessage> {
    const out: Outgoing = typeof input === 'string' ? { body: input } : input;
    const conversation = await this.get(publicId);
    if (conversation.status === 'closed') throw new DomainException('conversations.closed');
    const card = out.contextCard
      ? await checkContextCard(this.prisma, conversation.customerUserId, out.contextCard)
      : null;
    const files = await this.ownFiles(this.prisma, [actor.userId], out.fileIds ?? []);
    const canned = out.cannedResponseId
      ? await this.prisma.cannedResponse.findFirst({
          where: { publicId: out.cannedResponseId, archivedAt: null },
          select: { id: true },
        })
      : null;
    if (out.cannedResponseId && !canned)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'cannedResponseId', code: 'exists', message: 'not an active canned response' }],
      });
    const body = out.body?.trim() || null;
    if (!body && files.length === 0 && !card)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'body', code: 'required', message: 'a text, a file or a card is needed' }],
      });
    const via = this.effectiveReplyChannel(conversation);
    const messageId = randomUUID();
    let providerMessageId: string | null = null;
    if (via === 'line') {
      const account = await this.lineAccountOf(this.prisma, conversation);
      if (!account || account.friendStatus === 'blocked')
        throw new DomainException('conversations.unreachable', {
          params: { reason: 'the user blocked the account' },
        });
      // LINE gets the text; files and cards stay in the thread (the customer opens them from LIFF).
      const text = [body, files.length || card ? 'ดูไฟล์และรายละเอียดเพิ่มเติมได้ในแชท getpack' : null]
        .filter(Boolean)
        .join('\n');
      const sent = await this.line.push({
        to: account.lineUserId,
        text,
        retryKey: nameUuid(`conversation-reply:${messageId}`),
      });
      providerMessageId = sent.providerMessageId;
    }
    return this.prisma.withTx(async (tx) => {
      const sentAt = new Date();
      const messages: ConversationMessage[] = [];
      const base = {
        conversationId: conversation.id,
        direction: 'outbound' as const,
        senderUserId: actor.userId,
        sentAt,
        via,
        cannedResponseId: canned?.id ?? null,
      };
      if (body || card)
        messages.push(
          await tx.conversationMessage.create({
            data: {
              ...base,
              publicId: messageId,
              kind: body ? 'text' : 'system',
              body,
              providerMessageId,
              contextCard: (card ?? undefined) as Prisma.InputJsonValue | undefined,
            },
          }),
        );
      for (const f of files)
        messages.push(
          await tx.conversationMessage.create({
            data: {
              ...base,
              ...(messages.length === 0 && { publicId: messageId, providerMessageId }),
              kind: f.mimeType.startsWith('image/') ? 'image' : 'file',
              fileObjectId: f.id,
            },
          }),
        );
      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: sentAt,
          status: 'pending',
          assignedUserId: conversation.assignedUserId ?? actor.userId,
          ...(conversation.firstRespondedAt === null && { firstRespondedAt: sentAt }),
          rowVersion: { increment: 1 },
        },
      });
      // The first answer on the conversation answers its open support tickets (D-221 first-response target).
      await tx.supportTicket.updateMany({
        where: { conversationId: conversation.id, firstRespondedAt: null },
        data: { firstRespondedAt: sentAt },
      });
      // Inbound messages count as read once someone answered.
      await tx.conversationMessage.updateMany({
        where: { conversationId: conversation.id, direction: 'inbound', readAt: null },
        data: { readAt: new Date() },
      });
      await this.join(tx, conversation.id, actor.userId, 'staff');
      await this.markRead(tx, conversation.id, actor.userId, 'staff');
      await this.record(
        tx,
        conversation,
        'conversation.replied',
        { messageId: messages[0]!.publicId, via, files: files.length, canned: canned !== null },
        actor,
      );
      if (conversation.customer)
        await this.realtime.publish(`user:${conversation.customer.publicId}`, {
          type: 'conversation.message',
          id: conversation.publicId,
        });
      return messages[0]!;
    });
  }

  /** D-300 an internal note: staff only, never pushed or shown to the customer, never an answer. */
  async note(actor: UserActor, publicId: string, input: Outgoing): Promise<ConversationMessage> {
    return this.prisma.withTx(async (tx) => {
      const conversation = await this.get(publicId, tx);
      const files = await this.ownFiles(tx, [actor.userId], input.fileIds ?? []);
      const body = input.body?.trim() || null;
      if (!body)
        throw new DomainException('validation.failed', {
          errors: [{ path: 'body', code: 'required', message: 'a note needs a text' }],
        });
      const note = await tx.conversationMessage.create({
        data: {
          conversationId: conversation.id,
          direction: 'outbound',
          senderUserId: actor.userId,
          kind: 'text',
          body,
          sentAt: new Date(),
          visibility: 'internal',
          fileObjectId: files[0]?.id ?? null,
        },
      });
      for (const f of files.slice(1))
        await tx.conversationMessage.create({
          data: {
            conversationId: conversation.id,
            direction: 'outbound',
            senderUserId: actor.userId,
            kind: f.mimeType.startsWith('image/') ? 'image' : 'file',
            sentAt: note.sentAt,
            visibility: 'internal',
            fileObjectId: f.id,
          },
        });
      await this.join(tx, conversation.id, actor.userId, 'staff');
      await this.record(tx, conversation, 'conversation.note_added', { messageId: note.publicId }, actor);
      return note;
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
      await this.join(tx, conversation.id, assignee.id, 'staff');
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

  /** Newest first; the cursor continues to older messages. Internal notes only for staff. */
  async messages(
    conversationId: bigint,
    cursor: string | undefined,
    limit: number,
    opts: { includeInternal?: boolean } = {},
  ) {
    const after = cursor ? decodeCursor(cursor) : null;
    const where: Prisma.ConversationMessageWhereInput = {
      conversationId,
      ...(!opts.includeInternal && { visibility: 'customer' }),
      ...(after && {
        OR: [
          { sentAt: { lt: new Date(String(after['t'])) } },
          { sentAt: new Date(String(after['t'])), id: { lt: BigInt(String(after['id'])) } },
        ],
      }),
    };
    const rows = await this.prisma.conversationMessage.findMany({
      where,
      include: MESSAGE_INCLUDE,
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return cursorPaginated<MessageRow>(rows, limit, (m) => ({
      t: m.sentAt.toISOString(),
      id: m.id.toString(),
    }));
  }

  async messageRows(ids: bigint[]): Promise<MessageRow[]> {
    return this.prisma.conversationMessage.findMany({
      where: { id: { in: ids } },
      include: MESSAGE_INCLUDE,
      orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
    });
  }

  /** The customer's support thread (or the latest one) — the B4.6 single-chat endpoints. */
  async customerConversation(customerUserId: bigint): Promise<Conversation | null> {
    return this.prisma.conversation.findFirst({
      where: { customerUserId, subjectType: 'support', mergedIntoId: null, channel: { not: 'contact' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  /** The customer read getpack's replies. */
  async markReadByCustomer(conversationId: bigint, userId?: bigint): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      await tx.conversationMessage.updateMany({
        where: { conversationId, direction: 'outbound', readAt: null, visibility: 'customer' },
        data: { readAt: new Date() },
      });
      if (userId) await this.markRead(tx, conversationId, userId, 'customer');
    });
  }

  /** Staff read the thread (read receipt for the customer). */
  async markReadByStaff(actor: UserActor, publicId: string): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      const conversation = await this.get(publicId, tx);
      await this.join(tx, conversation.id, actor.userId, 'staff');
      await this.markRead(tx, conversation.id, actor.userId, 'staff');
    });
  }

  sender(userId: bigint) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { publicId: true, displayName: true },
    });
  }

  // --- helpers -----------------------------------------------------------------------------------------

  /** The reply channel in effect: the customer's choice, else the channel of their last message, else the web. */
  effectiveReplyChannel(
    c: Pick<Conversation, 'replyChannel' | 'lastInboundVia' | 'channel' | 'lineAccountId'>,
  ) {
    const chosen = c.replyChannel ?? c.lastInboundVia ?? (c.channel === 'line' ? 'line' : 'web');
    return chosen === 'line' && c.lineAccountId === null && c.channel !== 'line' ? 'web' : chosen;
  }

  private async lineAccountOf(db: Tx, c: Pick<Conversation, 'lineAccountId' | 'customerUserId'>) {
    if (c.lineAccountId) return db.lineAccount.findUnique({ where: { id: c.lineAccountId } });
    if (!c.customerUserId) return null;
    return db.lineAccount.findFirst({
      where: { userId: c.customerUserId, unlinkedAt: null },
      orderBy: { linkedAt: 'desc' },
    });
  }

  private liveSupport(tx: Tx, customerUserId: bigint) {
    return this.liveThread(tx, customerUserId, 'support', null);
  }

  private liveThread(
    tx: Tx,
    customerUserId: bigint,
    subjectType: Conversation['subjectType'],
    subjectId: bigint | null,
  ) {
    return tx.conversation.findFirst({
      where: {
        customerUserId,
        subjectType,
        subjectId,
        status: { not: 'closed' },
        channel: { not: 'contact' },
      },
    });
  }

  private async openWeb(
    tx: Tx,
    customerUserId: bigint,
    subject: { type: RecordSubject; id: bigint; companyId: bigint | null } | null,
  ): Promise<Conversation> {
    // The customer's linked LINE account follows the support thread (D-300); record threads stay on the web.
    const line =
      subject === null
        ? await tx.lineAccount.findFirst({
            where: {
              userId: customerUserId,
              unlinkedAt: null,
              conversations: { none: { status: { not: 'closed' } } },
            },
          })
        : null;
    const conversation = await tx.conversation.create({
      data: {
        channel: 'web',
        customerUserId,
        subjectType: subject?.type ?? 'support',
        subjectId: subject?.id ?? null,
        companyId: subject?.companyId ?? null,
        lineAccountId: line?.id ?? null,
        resolutionDueAt: await this.resolutionDue(new Date()),
      },
    });
    await this.join(tx, conversation.id, customerUserId, 'customer');
    await this.record(tx, conversation, 'conversation.opened', {
      channel: 'web',
      subjectType: conversation.subjectType,
    });
    return conversation;
  }

  private async join(tx: Tx, conversationId: bigint, userId: bigint, role: 'customer' | 'staff') {
    await tx.conversationParticipant.createMany({
      data: [{ conversationId, userId, role }],
      skipDuplicates: true,
    });
  }

  private async markRead(tx: Tx, conversationId: bigint, userId: bigint, role: 'customer' | 'staff') {
    await this.join(tx, conversationId, userId, role);
    const last = await tx.conversationMessage.findFirst({
      where: { conversationId, ...(role === 'customer' && { visibility: 'customer' }) },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    await tx.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadAt: new Date(), lastReadMessageId: last?.id ?? null },
    });
  }

  /** Uploaded, scanned files of the sender (the files module keeps them private). */
  private async ownFiles(db: Tx, owners: bigint[], publicIds: string[]) {
    if (publicIds.length === 0) return [];
    const rows = await db.fileObject.findMany({
      where: {
        publicId: { in: publicIds },
        ownerUserId: { in: owners },
        uploadStatus: 'uploaded',
        scanStatus: 'clean',
      },
      select: { id: true, publicId: true, mimeType: true },
    });
    const found = new Map(rows.map((r) => [r.publicId, r]));
    const missing = publicIds.findIndex((id) => !found.has(id));
    if (missing >= 0)
      throw new DomainException('validation.failed', {
        errors: [
          { path: `fileIds[${missing}]`, code: 'exists', message: 'not an uploaded, scanned file of yours' },
        ],
      });
    return publicIds.map((id) => found.get(id)!);
  }

  /** D-221: + `support.first_response_business_days` business days (one business-hours window each). */
  private async firstResponseDue(at: Date): Promise<Date> {
    const days = (await this.settings.at('support.first_response_business_days', { at })).value;
    return this.addBusinessDays(at, days);
  }

  /** D-300: + `conversations.resolution_business_days`, or no target while it is unset. */
  private async resolutionDue(at: Date): Promise<Date | null> {
    try {
      const days = (await this.settings.at('conversations.resolution_business_days', { at })).value;
      return typeof days === 'number' ? this.addBusinessDays(at, days) : null;
    } catch (error) {
      if (error instanceof SettingNotFoundError) return null;
      throw error;
    }
  }

  private async addBusinessDays(at: Date, days: number): Promise<Date> {
    const window = (await this.settings.at('calendar.business_hours', { at })).value;
    const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
    const perDay = minutes(window.to) - minutes(window.from);
    const calendar = await this.calendars.calendar();
    return calendar.addBusinessMinutes(at, days * perDay, window);
  }

  private async signalStaff(tx: Tx, conversation: Conversation) {
    const current = await tx.conversation.findUnique({
      where: { id: conversation.id },
      select: { assignedUserId: true },
    });
    if (!current?.assignedUserId) return;
    const user = await tx.user.findUnique({
      where: { id: current.assignedUserId },
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
    const current = await tx.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
      select: { customerUserId: true, subjectType: true },
    });
    const customer = current.customerUserId
      ? await tx.user.findUnique({ where: { id: current.customerUserId }, select: { publicId: true } })
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
          subjectType: current.subjectType,
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
