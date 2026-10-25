import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type Prisma, type SupportTicket, type SupportTicketSource } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { BusinessCalendarService } from '@platform/calendar/business-calendar.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { DocumentNumberingService } from '@platform/numbering/document-numbering.service';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import { ConversationsService } from './conversations.service';
import {
  type ConversationTicketDto,
  MAX_HANDOFF_CONTEXT_BYTES,
  type SupportContactDto,
  type SupportContactPersonDto,
  type SupportHandoffDto,
  type SupportTicketDto,
} from './support.dto';

interface TicketInput {
  source: SupportTicketSource;
  topic: string;
  contact: SupportContactPersonDto | undefined;
  orderRef: string | null;
  body: string | null;
  callbackRequested: boolean;
  context: Record<string, unknown> | null;
}

/**
 * The storefront's contact form and guided-help hand-off (D-221): a CS ticket (number from the `support_ticket`
 * series) on a CS conversation — the signed-in customer's live web conversation, or a new one for a guest, who must
 * leave a name and a phone or e-mail. The first-response target is `support.first_response_business_days` business
 * days (business hours D-175, national calendar D-161); the first staff reply on the conversation answers it. The
 * requester's contact details are PII: stored for CS, never in events, activity or logs.
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly numbering: DocumentNumberingService,
    private readonly settings: SettingsService,
    private readonly calendars: BusinessCalendarService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
  ) {}

  contact(actor: Actor | undefined, input: SupportContactDto): Promise<SupportTicketDto> {
    return this.open(actor, {
      source: 'contact_form',
      topic: input.topic,
      contact: input.contact,
      orderRef: input.orderCode?.trim() || null,
      body: input.message,
      callbackRequested: false,
      context: null,
    });
  }

  handoff(actor: Actor | undefined, input: SupportHandoffDto): Promise<SupportTicketDto> {
    const context = {
      page: input.page,
      answers: input.answers ?? {},
      recommended: input.recommended ?? [],
    };
    if (Buffer.byteLength(JSON.stringify(context)) > MAX_HANDOFF_CONTEXT_BYTES)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'answers', code: 'maxSize', message: 'the hand-off context is over 16 KB' }],
      });
    return this.open(actor, {
      source: 'handoff',
      topic: 'guided_help',
      contact: input.contact,
      orderRef: null,
      body: input.note?.trim() || null,
      callbackRequested: input.callback ?? false,
      context,
    });
  }

  private async open(actor: Actor | undefined, t: TicketInput): Promise<SupportTicketDto> {
    const customerUserId = actor?.type === 'user' && actor.audience === 'customer' ? actor.userId : null;
    if (customerUserId === null && (!t.contact || (!t.contact.phone && !t.contact.email)))
      throw new DomainException('support.contact_required');
    const now = new Date();
    const respondBy = await this.respondBy(now);
    const { ticket, conversationId } = await this.prisma.withTx(async (tx) => {
      const conversation = await this.conversations.openForTicket(tx, customerUserId, t.body);
      const ticket = await tx.supportTicket.create({
        data: {
          ticketNo: await this.numbering.next(tx, 'support_ticket', now),
          conversationId: conversation.id,
          customerUserId,
          source: t.source,
          topic: t.topic,
          contactName: t.contact?.name ?? null,
          contactPhone: t.contact?.phone ?? null,
          contactEmail: t.contact?.email ?? null,
          orderRef: t.orderRef,
          callbackRequested: t.callbackRequested,
          context: (t.context ?? undefined) as Prisma.InputJsonValue | undefined,
          respondBy,
          createdAt: now,
        },
      });
      // No contact details in the event or the activity (PDPA).
      const data = {
        ticketNo: ticket.ticketNo,
        source: t.source,
        topic: t.topic,
        callbackRequested: t.callbackRequested,
        respondBy: toBangkokIso(respondBy),
      };
      const event = await this.events.record(
        tx,
        {
          type: 'support.ticket_opened',
          aggregateType: 'conversation',
          aggregateId: conversation.publicId,
          payload: { conversationId: conversation.publicId, ...data },
        },
        actor,
      );
      await this.activity.record(tx, {
        aggregateType: 'conversation',
        aggregatePublicId: conversation.publicId,
        action: 'support.ticket_opened',
        messageKey: 'activity.support.ticket_opened',
        messageParams: data,
        visibility: ['internal', 'customer'],
        domainEventId: event.id,
        ...(actor && { actor }),
      });
      return { ticket, conversationId: conversation.publicId };
    });
    return {
      ticketNo: ticket.ticketNo,
      source: ticket.source,
      topic: ticket.topic,
      respondBy: toBangkokIso(ticket.respondBy),
      lineUrl: await this.lineUrl(ticket.ticketNo),
      conversationId: customerUserId === null ? null : conversationId,
      createdAt: toBangkokIso(ticket.createdAt),
    };
  }

  /** Submission + N business days, a business day being one business-hours window (D-175, D-221). */
  private async respondBy(now: Date): Promise<Date> {
    const days = (await this.settings.at('support.first_response_business_days', { at: now })).value;
    const window = (await this.settings.at('calendar.business_hours', { at: now })).value;
    const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
    const perDay = minutes(window.to) - minutes(window.from);
    const calendar = await this.calendars.calendar();
    return calendar.addBusinessMinutes(now, days * perDay, window);
  }

  /** A LINE chat with the official account carrying only the ticket number; null while no OA id is set. */
  private async lineUrl(ticketNo: string): Promise<string | null> {
    try {
      const channels = (await this.settings.at('storefront.support_channels')).value;
      const oa = channels?.lineOaId;
      return oa
        ? `https://line.me/R/oaMessage/${encodeURIComponent(oa)}/?${encodeURIComponent(ticketNo)}`
        : null;
    } catch (error) {
      if (error instanceof SettingNotFoundError) return null;
      throw error;
    }
  }
}

export function ticketDto(t: SupportTicket, now = new Date()): ConversationTicketDto {
  return {
    ticketNo: t.ticketNo,
    source: t.source,
    topic: t.topic,
    contactName: t.contactName,
    contactPhone: t.contactPhone,
    contactEmail: t.contactEmail,
    orderRef: t.orderRef,
    callbackRequested: t.callbackRequested,
    context: (t.context as Record<string, unknown> | null) ?? null,
    respondBy: toBangkokIso(t.respondBy),
    firstRespondedAt: t.firstRespondedAt ? toBangkokIso(t.firstRespondedAt) : null,
    overdue: t.firstRespondedAt === null && t.respondBy < now,
  };
}
