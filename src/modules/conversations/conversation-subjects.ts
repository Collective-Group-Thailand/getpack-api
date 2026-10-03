import { DomainException } from '@common/errors/domain.exception';
import { type Tx } from '@database/prisma.service';
import { type ConversationSubject } from '@generated/prisma/client';

/** D-300 what a thread can be about, and what a message can point to. */
export const SUBJECT_TYPES = ['support', 'order', 'design', 'rfq', 'rfq_basket'] as const;
export const RECORD_SUBJECTS = ['order', 'design', 'rfq', 'rfq_basket'] as const;
export type RecordSubject = (typeof RECORD_SUBJECTS)[number];
export const CONTEXT_CARD_TYPES = ['order', 'design', 'rfq', 'quote'] as const;
export type ContextCardType = (typeof CONTEXT_CARD_TYPES)[number];

export interface ResolvedSubject {
  id: bigint;
  publicId: string;
  /** The order / RFQ code, the design title. */
  label: string;
  companyId: bigint | null;
}

const invalid = (path: string, message: string): never => {
  throw new DomainException('validation.failed', { errors: [{ path, code: 'exists', message }] });
};

/**
 * One of the customer's own records (D-300): an order (theirs), a design (owned), an RFQ or RFQ basket (theirs). A
 * record of anyone else is reported as not existing (never confirms it does, IDOR).
 */
export async function ownSubject(
  db: Tx,
  customerUserId: bigint,
  type: RecordSubject,
  publicId: string,
  path = 'subjectId',
): Promise<ResolvedSubject> {
  switch (type) {
    case 'order': {
      const o = await db.order.findFirst({
        where: { publicId, customerUserId },
        select: { id: true, publicId: true, orderCode: true, orderGroup: { select: { companyId: true } } },
      });
      return o
        ? { id: o.id, publicId: o.publicId, label: o.orderCode, companyId: o.orderGroup.companyId }
        : invalid(path, 'not an order of the customer');
    }
    case 'design': {
      const d = await db.designDocument.findFirst({
        where: { publicId, ownerUserId: customerUserId, deletedAt: null },
        select: { id: true, publicId: true, title: true, companyId: true },
      });
      return d
        ? { id: d.id, publicId: d.publicId, label: d.title, companyId: d.companyId }
        : invalid(path, 'not a design of the customer');
    }
    case 'rfq': {
      const r = await db.rfq.findFirst({
        where: { publicId, customerUserId },
        select: { id: true, publicId: true, rfqCode: true },
      });
      return r
        ? { id: r.id, publicId: r.publicId, label: r.rfqCode, companyId: null }
        : invalid(path, 'not an RFQ of the customer');
    }
    case 'rfq_basket':
      // Threads of RFQ baskets open with the basket's submission (U5.B3), never from here.
      return invalid(path, 'an RFQ basket’s conversation opens when the basket is submitted');
  }
}

/** The subject of a thread for display (null for `support`). */
export async function subjectRef(
  db: Tx,
  type: ConversationSubject,
  id: bigint | null,
): Promise<{ type: RecordSubject; id: string; label: string } | null> {
  if (type === 'support' || id === null) return null;
  const pick = async (): Promise<{ publicId: string; label: string } | null> => {
    switch (type) {
      case 'order': {
        const o = await db.order.findUnique({ where: { id }, select: { publicId: true, orderCode: true } });
        return o && { publicId: o.publicId, label: o.orderCode };
      }
      case 'design': {
        const d = await db.designDocument.findUnique({
          where: { id },
          select: { publicId: true, title: true },
        });
        return d && { publicId: d.publicId, label: d.title };
      }
      case 'rfq': {
        const r = await db.rfq.findUnique({ where: { id }, select: { publicId: true, rfqCode: true } });
        return r && { publicId: r.publicId, label: r.rfqCode };
      }
      case 'rfq_basket':
        return null;
    }
  };
  const found = await pick();
  return found ? { type, id: found.publicId, label: found.label } : null;
}

export interface ContextCard {
  type: ContextCardType;
  id: string;
}

/** A context card must point to one of the thread customer's own records (stored as a reference, D-300). */
export async function checkContextCard(
  db: Tx,
  customerUserId: bigint | null,
  card: ContextCard,
  path = 'contextCard',
): Promise<ContextCard> {
  if (customerUserId === null) return invalid(path, 'the conversation has no customer');
  if (card.type === 'quote') {
    const q = await db.quote.findFirst({
      where: { publicId: card.id, customerUserId },
      select: { id: true },
    });
    if (!q) invalid(`${path}.id`, 'not a quotation of the customer');
    return card;
  }
  await ownSubject(db, customerUserId, card.type, card.id, `${path}.id`);
  return card;
}

/** What a card shows, resolved for the reader on every read (no copied prices); null once the record is gone. */
export async function cardView(
  db: Tx,
  card: ContextCard,
): Promise<{ type: ContextCardType; id: string; label: string; status: string | null } | null> {
  switch (card.type) {
    case 'order': {
      const o = await db.order.findUnique({
        where: { publicId: card.id },
        select: { orderCode: true, status: true },
      });
      return o && { ...card, label: o.orderCode, status: o.status };
    }
    case 'design': {
      const d = await db.designDocument.findUnique({
        where: { publicId: card.id },
        select: { title: true, deletedAt: true },
      });
      return d && !d.deletedAt ? { ...card, label: d.title, status: null } : null;
    }
    case 'rfq': {
      const r = await db.rfq.findUnique({
        where: { publicId: card.id },
        select: { rfqCode: true, status: true },
      });
      return r && { ...card, label: r.rfqCode, status: r.status };
    }
    case 'quote': {
      const q = await db.quote.findUnique({
        where: { publicId: card.id },
        select: { quoteCode: true, status: true },
      });
      return q && { ...card, label: q.quoteCode ?? '', status: q.status };
    }
  }
}
