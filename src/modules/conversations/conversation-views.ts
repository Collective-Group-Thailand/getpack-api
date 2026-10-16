import { toBangkokIso } from '@common/time/bangkok';
import { type Tx } from '@database/prisma.service';

import { cardView, type ContextCard, subjectRef } from './conversation-subjects';
import { type ConversationDto, type MessageDto } from './conversations.dto';
import { type ConversationRow, type MessageRow } from './conversations.service';
import { ticketDto } from './support.service';
import { type StoreThreadDto } from './threads.dto';

const iso = (d: Date | null | undefined) => (d ? toBangkokIso(d) : null);

/** Messages with their cards resolved for the reader now (D-300: a card is a reference, never a copy). */
export async function messageViews(db: Tx, rows: MessageRow[]): Promise<MessageDto[]> {
  return Promise.all(
    rows.map(async (m) => ({
      id: m.publicId,
      direction: m.direction,
      kind: m.kind,
      body: m.body,
      sender:
        m.direction === 'outbound' && m.senderUser
          ? { id: m.senderUser.publicId, displayName: m.senderUser.displayName }
          : null,
      sentAt: toBangkokIso(m.sentAt),
      readAt: iso(m.readAt),
      visibility: m.visibility,
      via: m.via,
      contextCard: m.contextCard ? await cardView(db, m.contextCard as unknown as ContextCard) : null,
      file: m.fileObject
        ? { id: m.fileObject.publicId, name: m.fileObject.originalName, mimeType: m.fileObject.mimeType }
        : null,
    })),
  );
}

/** D-221 / D-300 first-response state at `now`. */
export function slaState(c: ConversationRow, now = new Date()): 'waiting' | 'overdue' | 'answered' | null {
  if (c.firstRespondedAt) return 'answered';
  if (!c.firstResponseDueAt) return null;
  return c.firstResponseDueAt < now ? 'overdue' : 'waiting';
}

export async function conversationView(
  db: Tx,
  c: ConversationRow,
  replyChannel: string,
  now = new Date(),
): Promise<ConversationDto> {
  return {
    id: c.publicId,
    status: c.status,
    lastMessageAt: toBangkokIso(c.lastMessageAt),
    channel: c.channel,
    customer: c.customer ? { id: c.customer.publicId, displayName: c.customer.displayName } : null,
    lineDisplayName: c.lineAccount?.displayName ?? null,
    lineFriendStatus: c.lineAccount?.friendStatus ?? null,
    assignee: c.assignedUser
      ? { id: c.assignedUser.publicId, displayName: c.assignedUser.displayName }
      : null,
    lastMessage: c.messages[0]?.body ?? null,
    ticket: c.tickets[0] ? ticketDto(c.tickets[0]) : null,
    subjectType: c.subjectType,
    subject: await subjectRef(db, c.subjectType, c.subjectId),
    company: c.company ? { id: c.company.publicId, name: c.company.legalName } : null,
    replyChannel,
    sla: {
      state: slaState(c, now),
      firstResponseDueAt: iso(c.firstResponseDueAt),
      firstRespondedAt: iso(c.firstRespondedAt),
      resolutionDueAt: iso(c.resolutionDueAt),
      resolvedAt: c.status === 'closed' ? iso(c.closedAt) : null,
    },
    participants: c.participants.map((p) => ({
      user: { id: p.user.publicId, displayName: p.user.displayName },
      role: p.role,
      lastReadAt: iso(p.lastReadAt),
    })),
    mergedIntoId: c.mergedIntoId
      ? ((await db.conversation.findUnique({ where: { id: c.mergedIntoId } }))?.publicId ?? null)
      : null,
  };
}

export async function storeThreadView(
  db: Tx,
  c: ConversationRow,
  unread: number,
  replyChannel: string,
): Promise<StoreThreadDto> {
  const staffRead = c.participants
    .filter((p) => p.role === 'staff' && p.lastReadAt)
    .map((p) => p.lastReadAt!)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return {
    id: c.publicId,
    status: c.status,
    subjectType: c.subjectType,
    subject: await subjectRef(db, c.subjectType, c.subjectId),
    lastMessageAt: toBangkokIso(c.lastMessageAt),
    lastMessage: c.messages[0]?.body ?? null,
    unread,
    replyChannel,
    replyChannelChosen: c.replyChannel !== null,
    readByGetpackAt: iso(staffRead),
  };
}
