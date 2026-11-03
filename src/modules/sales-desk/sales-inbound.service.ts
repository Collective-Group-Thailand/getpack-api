import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma, type SalesInboundLead } from '@generated/prisma/client';
import { AgentAttributionService } from '@modules/agents/agent-attribution.service';
import { invalid, normalisePhone, recordAgentEvent } from '@modules/agents/agent-shared';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { holdersOfRole, type Recipient, RecipientDirectory } from '@platform/notifications/recipients';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import {
  CLOSED_INBOUND,
  type DISQUALIFY_REASONS,
  type InboundStatus,
  pickRep,
  workingHoursDue,
} from './sales-desk-rules';
import { type SalesScope } from './sales-scope';

export const INBOUND_INCLUDE = {
  assignee: { select: { publicId: true, displayName: true } },
  agentLead: { select: { publicId: true } },
} as const satisfies Prisma.SalesInboundLeadInclude;
export type InboundRow = Prisma.SalesInboundLeadGetPayload<{ include: typeof INBOUND_INCLUDE }>;

export interface InboundInput {
  contactName: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
  organisationName?: string | null;
  need?: string | null;
}

/** Aggregate type of the inbound pool's events and its notification resolver. */
export const INBOUND_AGGREGATE = 'sales_inbound_lead';

/**
 * D-469 items 2–4: the inbound pool of sales enquiries — from contact tickets routed to the sales queue (D-458),
 * RFQs of customers without an order yet, and staff — with the first-response due time in working hours (P-05),
 * manual or round-robin assignment to reps (assigning registers the lead for the rep's employee agent through the
 * agent programme: protection and the neutral refusal, D-417 / D-440) and the SLA breach alert to sales managers.
 * Contact data is read from the source rows, never from events (PDPA).
 */
@Injectable()
export class SalesInboundService implements OnModuleInit {
  private readonly logger = new Logger(SalesInboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly attribution: AgentAttributionService,
    private readonly audit: AuditService,
    private readonly directory: RecipientDirectory,
    readonly events: DomainEvents,
    readonly activity: ActivityLogService,
  ) {}

  onModuleInit(): void {
    this.directory.registerAssignees(INBOUND_AGGREGATE, (event, _route, tx) => this.recipients(event, tx));
  }

  // --- reads ----------------------------------------------------------------------------------------------------

  async get(scope: SalesScope, publicId: string, db: Tx = this.prisma): Promise<InboundRow> {
    const row = await db.salesInboundLead.findUnique({ where: { publicId }, include: INBOUND_INCLUDE });
    if (!row || (!scope.manage && row.assigneeUserId !== scope.actor.userId))
      throw new DomainException('http.not_found');
    return row;
  }

  async list(
    scope: SalesScope,
    q: {
      status?: InboundStatus[];
      source?: string;
      assigneeId?: string;
      unassigned?: boolean;
      breached?: boolean;
      q?: string;
      page: number;
      perPage: number;
    },
  ) {
    const text = q.q?.trim();
    const where: Prisma.SalesInboundLeadWhereInput = {
      ...(scope.manage
        ? {
            ...(q.assigneeId && { assignee: { publicId: q.assigneeId } }),
            ...(q.unassigned && { assigneeUserId: null }),
          }
        : { assigneeUserId: scope.actor.userId }),
      ...(q.status?.length && { status: { in: q.status } }),
      ...(q.source && { source: q.source as SalesInboundLead['source'] }),
      ...(q.breached !== undefined && { slaBreachedAt: q.breached ? { not: null } : null }),
      ...(text && {
        OR: [
          { contactName: { contains: text, mode: 'insensitive' as const } },
          { organisationName: { contains: text, mode: 'insensitive' as const } },
          { contactEmail: { contains: text } },
          { contactPhone: { contains: text.replace(/^0/, '') } },
          { sourceRef: { contains: text } },
        ],
      }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.salesInboundLead.findMany({
        where,
        include: INBOUND_INCLUDE,
        orderBy: [{ firstResponseDueAt: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
      }),
      this.prisma.salesInboundLead.count({ where }),
    ]);
    return { rows, total };
  }

  // --- intake -----------------------------------------------------------------------------------------------------

  /** Staff enter an enquiry; a rep's own entry is assigned to them, a manager may name a rep or leave it to mode. */
  async createManual(
    scope: SalesScope,
    input: InboundInput & { assigneeUserId?: string },
  ): Promise<InboundRow> {
    const phone = normalisePhone(input.contactPhone);
    const email = input.contactEmail?.trim().toLowerCase() || null;
    if (!phone && !email) invalid('contactPhone', 'a phone number or e-mail', 'contact');
    const id = await this.prisma.withTx(async (tx) => {
      const row = await this.intake(
        tx,
        'manual',
        null,
        { ...input, contactPhone: phone, contactEmail: email },
        {
          createdById: scope.actor.userId,
          actor: scope.actor,
        },
      );
      const to = !scope.manage
        ? scope.actor.userId
        : input.assigneeUserId
          ? await this.repUserId(tx, input.assigneeUserId)
          : null;
      if (to !== null) await this.assignInTx(tx, row, to, 'manual', null, scope.actor);
      else await this.autoAssign(tx, row, scope.actor);
      return row.publicId;
    });
    return this.get(scope, id);
  }

  /** D-458: a contact ticket routed to the sales queue (topics quote / business) becomes an enquiry. */
  @OnDomainEvent('support.ticket_opened', { consumer: 'sales.inbound_from_ticket' })
  async onTicketOpened(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['queue'] !== 'sales') return;
    const ticket = await tx.supportTicket.findUnique({
      where: { ticketNo: String(event.payload['ticketNo']) },
      include: { customer: { select: { displayName: true, phone: true, email: true } } },
    });
    if (!ticket) return;
    if (await tx.salesInboundLead.findUnique({ where: { supportTicketId: ticket.id } })) return;
    const context = (ticket.context ?? {}) as Record<string, unknown>;
    const details = (context['details'] ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const need = [
      `${ticket.topic}`,
      str(details['product']),
      details['quantity'] ? `qty ${String(details['quantity'] as string | number)}` : null,
      str(details['monthlyVolume']),
    ]
      .filter(Boolean)
      .join(' · ');
    const name = ticket.contactName ?? ticket.customer?.displayName ?? '—';
    const row = await this.intake(
      tx,
      'contact_form',
      ticket.ticketNo,
      {
        contactName: name,
        contactPhone: ticket.contactPhone ?? ticket.customer?.phone ?? null,
        contactEmail: ticket.contactEmail ?? ticket.customer?.email ?? null,
        organisationName: str(details['company']),
        need,
      },
      { supportTicketId: ticket.id, actor: systemActor('sales.inbound') },
    );
    await this.autoAssign(tx, row, systemActor('sales.inbound'));
  }

  /** An RFQ from a customer with no order group yet and no agent becomes an enquiry ("non-customer"). */
  @OnDomainEvent('rfq.submitted', { consumer: 'sales.inbound_from_rfq' })
  async onRfqSubmitted(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const rfq = await tx.rfq.findUnique({
      where: { publicId: event.aggregateId },
      include: { customer: { select: { id: true, displayName: true, phone: true, email: true } } },
    });
    if (!rfq) return;
    if (await tx.salesInboundLead.findUnique({ where: { rfqId: rfq.id } })) return;
    const ordered = await tx.orderGroup.count({ where: { customerUserId: rfq.customerUserId } });
    const linked = await tx.salesAgentLink.count({
      where: { customerUserId: rfq.customerUserId, status: 'active' },
    });
    if (ordered > 0 || linked > 0) return;
    const row = await this.intake(
      tx,
      'rfq',
      rfq.rfqCode,
      {
        contactName: rfq.customer.displayName,
        contactPhone: rfq.customer.phone,
        contactEmail: rfq.customer.email,
        need: `RFQ ${rfq.rfqCode}`,
      },
      { rfqId: rfq.id, actor: systemActor('sales.inbound') },
    );
    await this.autoAssign(tx, row, systemActor('sales.inbound'));
  }

  private async intake(
    tx: Tx,
    source: SalesInboundLead['source'],
    sourceRef: string | null,
    input: InboundInput,
    extra: { supportTicketId?: bigint; rfqId?: bigint; createdById?: bigint; actor: Actor },
  ): Promise<SalesInboundLead> {
    const now = new Date();
    const due = await this.firstResponseDue(now);
    const row = await tx.salesInboundLead.create({
      data: {
        source,
        sourceRef,
        supportTicketId: extra.supportTicketId ?? null,
        rfqId: extra.rfqId ?? null,
        contactName: input.contactName.trim().slice(0, 200),
        contactPhone: input.contactPhone ?? null,
        contactEmail: input.contactEmail ?? null,
        organisationName: input.organisationName?.trim() || null,
        need: input.need?.trim().slice(0, 2000) || null,
        firstResponseDueAt: due,
        createdById: extra.createdById ?? null,
        createdAt: now,
      },
    });
    // No contact data in events (PDPA).
    await recordAgentEvent(this, tx, {
      type: 'sales_inbound_lead.created',
      aggregateType: INBOUND_AGGREGATE,
      aggregateId: row.publicId,
      payload: { inboundId: row.publicId, source, sourceRef, firstResponseDueAt: due.toISOString() },
      actor: extra.actor,
    });
    return row;
  }

  /** `sales.first_response_hours` working hours (P-05) in the `calendar.business_hours` window. */
  async firstResponseDue(now: Date): Promise<Date> {
    const hours = await this.settings.value('sales.first_response_hours', now);
    const window = await this.settings.value('calendar.business_hours', now);
    return workingHoursDue(now, Number(hours), window);
  }

  // --- assignment -------------------------------------------------------------------------------------------------

  /** Round robin when `sales.assignment_mode` says so; otherwise the enquiry waits for a manager. */
  private async autoAssign(tx: Tx, row: SalesInboundLead, actor: Actor): Promise<void> {
    if ((await this.settings.value('sales.assignment_mode', new Date())) !== 'round_robin') return;
    const to = await this.roundRobin(tx);
    if (to === null) return;
    await this.assignInTx(tx, row, to, 'round_robin', null, actor);
  }

  /** The assignable reps (active `sales_rep`, active employee agent) and their load. */
  async assignableReps(tx: Tx): Promise<{ userId: bigint; open: number; lastAssignedAt: Date | null }[]> {
    const role = await tx.role.findUnique({ where: { key: 'sales_rep' } });
    if (!role) return [];
    const holders = await holdersOfRole(tx, role.id, null);
    const ids = holders.map((h) => h.userId!);
    const agents = await tx.salesAgent.findMany({
      where: { staffUserId: { in: ids }, kind: 'employee', status: 'active' },
      select: { staffUserId: true },
    });
    const withAgent = new Set(agents.map((a) => a.staffUserId!));
    const open = await tx.salesInboundLead.groupBy({
      by: ['assigneeUserId'],
      where: { assigneeUserId: { in: ids }, status: { notIn: [...CLOSED_INBOUND] } },
      _count: { _all: true },
    });
    const last = await tx.salesInboundAssignment.groupBy({
      by: ['toUserId'],
      where: { toUserId: { in: ids } },
      _max: { createdAt: true },
    });
    return ids
      .filter((id) => withAgent.has(id))
      .map((id) => ({
        userId: id,
        open: open.find((o) => o.assigneeUserId === id)?._count._all ?? 0,
        lastAssignedAt: last.find((l) => l.toUserId === id)?._max.createdAt ?? null,
      }));
  }

  private async roundRobin(tx: Tx): Promise<bigint | null> {
    let capacity: number | null = null;
    try {
      capacity = Number(await this.settings.value('sales.max_open_per_rep', new Date()));
    } catch (error) {
      if (!(error instanceof SettingNotFoundError)) throw error;
    }
    return pickRep(await this.assignableReps(tx), capacity);
  }

  private async repUserId(tx: Tx, publicId: string): Promise<bigint> {
    const user = await tx.user.findUnique({ where: { publicId }, select: { id: true } });
    const reps = await this.assignableReps(tx);
    if (!user || !reps.some((r) => r.userId === user.id)) throw new DomainException('sales.rep_unavailable');
    return user.id;
  }

  /**
   * A manager assigns (or reassigns, with a reason — audited) one enquiry: to a named rep, or round robin when no rep
   * is named. Assigning registers the lead for the rep's employee agent (agent programme rules).
   */
  async assign(
    scope: SalesScope,
    publicId: string,
    input: { repUserId?: string; reason?: string },
  ): Promise<InboundRow> {
    if (!scope.manage) throw new DomainException('auth.forbidden');
    await this.prisma.withTx(async (tx) => {
      const row = await this.lock(tx, publicId);
      if (CLOSED_INBOUND.includes(row.status)) throw new DomainException('sales.inbound_closed');
      const to = input.repUserId ? await this.repUserId(tx, input.repUserId) : await this.roundRobin(tx);
      if (to === null) throw new DomainException('sales.no_rep_available');
      if (row.assigneeUserId !== null && row.assigneeUserId !== to && !input.reason?.trim())
        invalid('reason', 'why the enquiry moves to another rep', 'required');
      if (row.assigneeUserId === to) return;
      await this.assignInTx(
        tx,
        row,
        to,
        input.repUserId ? 'manual' : 'round_robin',
        input.reason ?? null,
        scope.actor,
      );
    });
    return this.get(scope, publicId);
  }

  private async lock(tx: Tx, publicId: string): Promise<SalesInboundLead> {
    const [locked] = await tx.$queryRaw<{ id: bigint }[]>`
      SELECT id FROM sales_inbound_leads WHERE public_id = ${publicId}::uuid FOR UPDATE`;
    if (!locked) throw new DomainException('http.not_found');
    return tx.salesInboundLead.findUniqueOrThrow({ where: { id: locked.id } });
  }

  private async assignInTx(
    tx: Tx,
    row: SalesInboundLead,
    to: bigint,
    mode: 'manual' | 'round_robin',
    reason: string | null,
    actor: Actor,
  ): Promise<void> {
    const now = new Date();
    const agent = await tx.salesAgent.findFirst({
      where: { staffUserId: to, kind: 'employee', status: 'active' },
      orderBy: { id: 'desc' },
    });
    if (!agent) throw new DomainException('sales.rep_unavailable');
    // The lead goes to the rep's employee agent; a contact that cannot be a lead keeps the assignment with one
    // neutral reason (D-440). A lead the agent already holds is reused.
    let agentLeadId: bigint | null = null;
    let refusal: string | null = null;
    try {
      const lead = await this.attribution.registerLead(
        // The programme's registration only uses the actor for its event; the system acts for round robin.
        actor as UserActor,
        agent,
        {
          kind: 'customer',
          contactName: row.contactName,
          organisationName: row.organisationName,
          phone: row.contactPhone,
          email: row.contactEmail,
          note: row.need,
          consentConfirmed: true,
          source: 'manual',
        },
        { tx },
      );
      agentLeadId = (await tx.salesAgentLead.findUniqueOrThrow({ where: { publicId: lead.publicId } })).id;
    } catch (error) {
      if (!(error instanceof DomainException)) throw error;
      if (error.code === 'agents.lead_duplicate') {
        const own = await tx.salesAgentLead.findFirst({
          where: {
            agentId: agent.id,
            status: 'registered',
            OR: [
              ...(row.contactPhone ? [{ phone: row.contactPhone }] : []),
              ...(row.contactEmail ? [{ email: row.contactEmail }] : []),
            ],
          },
        });
        agentLeadId = own?.id ?? null;
      } else if (error.code === 'agents.too_many_leads') refusal = 'too_many_leads';
      else if (error.code === 'agents.lead_unavailable') refusal = 'unavailable';
      else if (error.code === 'validation.failed') refusal = 'unavailable';
      else throw error;
    }
    await tx.salesInboundLead.update({
      where: { id: row.id },
      data: {
        assigneeUserId: to,
        assignedAt: now,
        status: row.status === 'new' ? 'assigned' : row.status,
        agentLeadId: agentLeadId ?? row.agentLeadId,
        leadRefusal: agentLeadId ? null : refusal,
        rowVersion: { increment: 1 },
      },
    });
    await tx.salesInboundAssignment.create({
      data: {
        inboundLeadId: row.id,
        fromUserId: row.assigneeUserId,
        toUserId: to,
        mode,
        reason: reason?.trim() || null,
        createdById: actor.type === 'user' ? actor.userId : null,
        createdAt: now,
      },
    });
    const toUser = await tx.user.findUniqueOrThrow({ where: { id: to }, select: { publicId: true } });
    if (row.assigneeUserId !== null)
      await this.audit.record(tx, {
        category: 'data_access',
        action: 'sales_inbound_lead.reassigned',
        actor,
        resourceType: INBOUND_AGGREGATE,
        resourcePublicId: row.publicId,
        data: { to: toUser.publicId, reason },
      });
    await recordAgentEvent(this, tx, {
      type: 'sales_inbound_lead.assigned',
      aggregateType: INBOUND_AGGREGATE,
      aggregateId: row.publicId,
      payload: {
        inboundId: row.publicId,
        assigneeId: toUser.publicId,
        mode,
        reassigned: row.assigneeUserId !== null,
        leadRefusal: agentLeadId ? null : refusal,
      },
      actor,
    });
  }

  // --- working the enquiry --------------------------------------------------------------------------------------------

  private async mutate(
    scope: SalesScope,
    publicId: string,
    work: (
      tx: Tx,
      row: SalesInboundLead,
      now: Date,
    ) => Promise<{ type: string; payload?: Record<string, unknown> }>,
  ): Promise<InboundRow> {
    await this.prisma.withTx(async (tx) => {
      const row = await this.lock(tx, publicId);
      if (!scope.manage && row.assigneeUserId !== scope.actor.userId)
        throw new DomainException('http.not_found');
      if (CLOSED_INBOUND.includes(row.status)) throw new DomainException('sales.inbound_closed');
      const now = new Date();
      const { type, payload } = await work(tx, row, now);
      await recordAgentEvent(this, tx, {
        type,
        aggregateType: INBOUND_AGGREGATE,
        aggregateId: row.publicId,
        payload: { inboundId: row.publicId, ...payload },
        actor: scope.actor,
      });
    });
    return this.get(scope, publicId);
  }

  /** The rep answered: the first response is recorded (SLA). */
  contacted(scope: SalesScope, publicId: string, note?: string): Promise<InboundRow> {
    return this.mutate(scope, publicId, async (tx, row, now) => {
      if (row.assigneeUserId === null) throw new DomainException('sales.no_rep_available');
      await tx.salesInboundLead.update({
        where: { id: row.id },
        data: {
          status: 'contacted',
          firstRespondedAt: row.firstRespondedAt ?? now,
          statusNote: note?.trim() || row.statusNote,
          rowVersion: { increment: 1 },
        },
      });
      return {
        type: 'sales_inbound_lead.contacted',
        payload: { onTime: (row.firstRespondedAt ?? now) <= row.firstResponseDueAt },
      };
    });
  }

  disqualify(
    scope: SalesScope,
    publicId: string,
    input: { reason: (typeof DISQUALIFY_REASONS)[number]; note?: string },
  ): Promise<InboundRow> {
    return this.mutate(scope, publicId, async (tx, row, now) => {
      await tx.salesInboundLead.update({
        where: { id: row.id },
        data: {
          status: 'disqualified',
          disqualifiedReason: input.reason,
          statusNote: input.note?.trim() || null,
          firstRespondedAt: row.firstRespondedAt ?? now,
          closedAt: now,
          rowVersion: { increment: 1 },
        },
      });
      return { type: 'sales_inbound_lead.disqualified', payload: { reason: input.reason } };
    });
  }

  /** The enquiry is now worked as the rep's lead (it must have one: registered at assignment or now). */
  convert(scope: SalesScope, publicId: string): Promise<InboundRow> {
    return this.mutate(scope, publicId, async (tx, row, now) => {
      if (row.assigneeUserId === null) throw new DomainException('sales.no_rep_available');
      if (row.agentLeadId === null) throw new DomainException('agents.lead_unavailable');
      await tx.salesInboundLead.update({
        where: { id: row.id },
        data: {
          status: 'converted_to_lead',
          firstRespondedAt: row.firstRespondedAt ?? now,
          closedAt: now,
          rowVersion: { increment: 1 },
        },
      });
      const lead = await tx.salesAgentLead.findUniqueOrThrow({ where: { id: row.agentLeadId } });
      return { type: 'sales_inbound_lead.converted', payload: { leadId: lead.publicId } };
    });
  }

  // --- SLA (item 4) ---------------------------------------------------------------------------------------------------

  /** Unanswered past due: flagged once and alerted to the sales managers (push, e-mail, in-app). */
  async breachDue(now = new Date()): Promise<number> {
    const due = await this.prisma.salesInboundLead.findMany({
      where: {
        firstRespondedAt: null,
        slaBreachedAt: null,
        firstResponseDueAt: { lte: now },
        status: { notIn: [...CLOSED_INBOUND] },
      },
      select: { id: true },
      take: 500,
    });
    let n = 0;
    for (const { id } of due)
      await this.prisma.withTx(async (tx) => {
        const { count } = await tx.salesInboundLead.updateMany({
          where: { id, slaBreachedAt: null, firstRespondedAt: null },
          data: { slaBreachedAt: now, rowVersion: { increment: 1 } },
        });
        if (count === 0) return;
        const row = await tx.salesInboundLead.findUniqueOrThrow({
          where: { id },
          include: { assignee: { select: { publicId: true, displayName: true } } },
        });
        await recordAgentEvent(this, tx, {
          type: 'sales_inbound_lead.sla_breached',
          aggregateType: INBOUND_AGGREGATE,
          aggregateId: row.publicId,
          payload: {
            inboundId: row.publicId,
            source: row.source,
            sourceRef: row.sourceRef,
            assigneeName: row.assignee?.displayName ?? null,
            firstResponseDueAt: row.firstResponseDueAt.toISOString(),
          },
          actor: systemActor('sales.inbound_sla'),
        });
        n += 1;
      });
    if (n > 0) this.logger.log(`sales.inbound_sla: ${n} breached`);
    return n;
  }

  /** Assignee resolver: the rep for `assigned`; the sales managers for an SLA breach. */
  private async recipients(event: DomainEventEnvelope, tx: Tx): Promise<Recipient[]> {
    if (event.type === 'sales_inbound_lead.assigned') {
      const user = await tx.user.findUnique({ where: { publicId: String(event.payload['assigneeId']) } });
      return user && user.status === 'active'
        ? [{ userId: user.id, locale: user.locale, displayName: user.displayName }]
        : [];
    }
    if (event.type === 'sales_inbound_lead.sla_breached') {
      const role = await tx.role.findUnique({ where: { key: 'sales_manager' } });
      return role ? holdersOfRole(tx, role.id, null) : [];
    }
    return [];
  }
}
