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
import { type SettingKey, type SettingValues } from '@platform/settings/setting-keys';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import { ConversationsService } from './conversations.service';
import {
  type ConversationTicketDto,
  MAX_HANDOFF_CONTEXT_BYTES,
  type SupportAddInfoDto,
  type SupportContactDto,
  type SupportContactOptionsDto,
  type SupportContactPersonDto,
  type SupportHandoffDto,
  type SupportTicketDto,
  type SupportTicketLookupDto,
  type SupportTicketStatusDto,
} from './support.dto';
import { callbackDays, contactMatches, queueFor, teamStatus, ticketStage } from './support-contact.rules';

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

  async contact(actor: Actor | undefined, input: SupportContactDto): Promise<SupportTicketDto> {
    const callback = input.replyChannel === 'callback' ? await this.checkCallback(input) : null;
    const details = input.details ? stripEmpty(input.details as Record<string, unknown>) : null;
    const context =
      details || input.replyChannel || callback
        ? {
            ...(details && { details }),
            ...(input.replyChannel && { replyChannel: input.replyChannel }),
            ...(callback && { callback }),
          }
        : null;
    return this.open(actor, {
      source: 'contact_form',
      topic: input.topic,
      contact: input.contact,
      orderRef: input.orderCode?.trim() || null,
      body: input.message,
      callbackRequested: callback !== null,
      context,
    });
  }

  /**
   * D-458: a call back needs the phone to call (in `contact`, signed in or not) and one of the offered
   * days and windows; refused while `support.callback_slots` is unset.
   */
  private async checkCallback(
    input: SupportContactDto,
  ): Promise<{ date: string; slot: string; from: string; to: string }> {
    const options = await this.callbackOptions(new Date());
    const slot = options?.slots.find((s) => s.key === input.callback?.slot);
    if (
      !options ||
      !input.callback ||
      !slot ||
      !options.days.includes(input.callback.date) ||
      !input.contact?.phone
    )
      throw new DomainException('support.callback_unavailable');
    return { date: input.callback.date, slot: slot.key, from: slot.from, to: slot.to };
  }

  /** D-458 `store.support.contactOptions`: reply targets, whether CS answers now, call-back days and windows. */
  async contactOptions(now = new Date()): Promise<SupportContactOptionsDto> {
    const [days, byTopic, hours, callback] = await Promise.all([
      this.settings.at('support.first_response_business_days', { at: now }).then((s) => s.value),
      this.optional('support.reply_business_days_by_topic', now),
      this.optional('storefront.support_hours', now),
      this.callbackOptions(now),
    ]);
    const calendar = hours ? await this.calendars.calendar() : null;
    const status = hours && calendar ? teamStatus(now, hours, (d) => calendar.isWorkingDay(d)) : null;
    return {
      replyBusinessDays: days,
      replyBusinessDaysByTopic: byTopic ?? {},
      teamStatus: status
        ? { openNow: status.openNow, nextOpenAt: status.nextOpenAt ? toBangkokIso(status.nextOpenAt) : null }
        : null,
      callback,
    };
  }

  private async callbackOptions(now: Date): Promise<SupportContactOptionsDto['callback']> {
    const slots = await this.optional('support.callback_slots', now);
    if (!slots || slots.length === 0) return null;
    const calendar = await this.calendars.calendar();
    return {
      days: callbackDays(now, (d) => calendar.isWorkingDay(d)),
      slots: slots.map((s) => ({ key: s.key, from: s.from, to: s.to })),
    };
  }

  /**
   * D-458 `store.support.lookupTicket`: where my request stands. A signed-in customer reads their own tickets; a
   * guest gives the phone or e-mail they left. Anything else is "not found" — never confirms a ticket exists.
   */
  async lookup(actor: Actor | undefined, input: SupportTicketLookupDto): Promise<SupportTicketStatusDto> {
    const ticket = await this.findOwn(actor, input);
    return this.statusOf(ticket);
  }

  /** D-458 `store.support.addInfo`: more information on my request, as my message on its conversation. */
  async addInfo(actor: Actor | undefined, input: SupportAddInfoDto): Promise<SupportTicketStatusDto> {
    const ticket = await this.findOwn(actor, input);
    await this.prisma.withTx(async (tx) => {
      const conversation = await tx.conversation.findUniqueOrThrow({ where: { id: ticket.conversationId } });
      await this.conversations.appendToTicket(tx, conversation, input.message.trim(), ticket.customerUserId);
      const data = { ticketNo: ticket.ticketNo, topic: ticket.topic, queue: ticket.queue };
      const event = await this.events.record(
        tx,
        {
          type: 'support.ticket_info_added',
          aggregateType: 'conversation',
          aggregateId: conversation.publicId,
          payload: { conversationId: conversation.publicId, ...data },
        },
        actor,
      );
      await this.activity.record(tx, {
        aggregateType: 'conversation',
        aggregatePublicId: conversation.publicId,
        action: 'support.ticket_info_added',
        messageKey: 'activity.support.ticket_info_added',
        messageParams: data,
        visibility: ['internal', 'customer'],
        domainEventId: event.id,
        ...(actor && { actor }),
      });
    });
    return this.statusOf(await this.prisma.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } }));
  }

  private async findOwn(actor: Actor | undefined, input: SupportTicketLookupDto): Promise<SupportTicket> {
    const customerUserId = actor?.type === 'user' && actor.audience === 'customer' ? actor.userId : null;
    const ticket = await this.prisma.supportTicket.findUnique({ where: { ticketNo: input.ticketNo.trim() } });
    const mine =
      ticket !== null &&
      ((customerUserId !== null && ticket.customerUserId === customerUserId) ||
        contactMatches(ticket, input.contact));
    if (!ticket || !mine) throw new DomainException('support.ticket_not_found');
    return ticket;
  }

  private async statusOf(ticket: SupportTicket): Promise<SupportTicketStatusDto> {
    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: ticket.conversationId },
      select: { status: true, assignedUserId: true, closedAt: true },
    });
    const stage = ticketStage(ticket, conversation);
    const answeredAt =
      ticket.firstRespondedAt ?? (conversation.status === 'closed' ? conversation.closedAt : null);
    return {
      ticketNo: ticket.ticketNo,
      topic: ticket.topic,
      stage,
      createdAt: toBangkokIso(ticket.createdAt),
      respondBy: toBangkokIso(ticket.respondBy),
      answeredAt: stage === 'answered' && answeredAt ? toBangkokIso(answeredAt) : null,
      lineUrl: await this.lineUrl(ticket.ticketNo),
    };
  }

  /** A setting defined without a value (no decision gives one) reads as null. */
  private async optional<K extends SettingKey>(key: K, at: Date): Promise<SettingValues[K] | null> {
    try {
      return (await this.settings.at(key, { at })).value ?? null;
    } catch (error) {
      if (error instanceof SettingNotFoundError) return null;
      throw error;
    }
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
    const respondBy = await this.respondBy(now, t.topic);
    const queue = queueFor(t.topic, await this.optional('support.topic_queues', now));
    const { ticket, conversationId } = await this.prisma.withTx(async (tx) => {
      const conversation = await this.conversations.openForTicket(tx, customerUserId, t.body);
      const ticket = await tx.supportTicket.create({
        data: {
          ticketNo: await this.numbering.next(tx, 'support_ticket', now),
          conversationId: conversation.id,
          customerUserId,
          source: t.source,
          topic: t.topic,
          queue,
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
        queue,
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

  /**
   * Submission + N business days, a business day being one business-hours window (D-175, D-221); N is the topic's
   * own target when the CS Lead set one (`support.reply_business_days_by_topic`, D-458).
   */
  private async respondBy(now: Date, topic: string): Promise<Date> {
    const byTopic = await this.optional('support.reply_business_days_by_topic', now);
    const days =
      byTopic?.[topic] ?? (await this.settings.at('support.first_response_business_days', { at: now })).value;
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
    queue: t.queue,
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

/** Drops empty strings and empty lists from the intent's details (nothing stored for a field left blank). */
function stripEmpty(details: Record<string, unknown>): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = typeof value === 'string' ? value.trim() : value;
  }
  return Object.keys(out).length > 0 ? out : null;
}
