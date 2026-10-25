import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma, type SalesAgent, type SalesAgentLead } from '@generated/prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { SettingsService } from '@platform/settings/settings.service';

import {
  addMonths,
  AGENT_REF_SELECT,
  DAY_MS,
  invalid,
  normalisePhone,
  planVersionAt,
  recordAgentEvent,
} from './agent-shared';

export const LINK_INCLUDE = {
  agent: { select: AGENT_REF_SELECT },
  customerUser: { select: { publicId: true, displayName: true } },
  company: { select: { publicId: true, legalName: true, tradeName: true } },
  commissions: { select: { kind: true, amount: true, status: true } },
} as const satisfies Prisma.SalesAgentLinkInclude;
export type LinkRow = Prisma.SalesAgentLinkGetPayload<{ include: typeof LINK_INCLUDE }>;

export const LEAD_INCLUDE = {
  agent: { select: AGENT_REF_SELECT },
  convertedUser: { select: { publicId: true } },
  convertedCompany: { select: { publicId: true } },
  convertedFactory: { select: { publicId: true } },
} as const satisfies Prisma.SalesAgentLeadInclude;
export type LeadRow = Prisma.SalesAgentLeadGetPayload<{ include: typeof LEAD_INCLUDE }>;

export const FACTORY_LINK_INCLUDE = {
  agent: { select: AGENT_REF_SELECT },
  factory: {
    select: {
      id: true,
      publicId: true,
      code: true,
      legalName: true,
      tradeName: true,
      status: true,
      activatedAt: true,
    },
  },
} as const satisfies Prisma.SalesAgentFactoryLinkInclude;
export type FactoryLinkRow = Prisma.SalesAgentFactoryLinkGetPayload<{ include: typeof FACTORY_LINK_INCLUDE }>;

type SkipReason = 'not_new_customer' | 'already_linked' | 'own_code' | 'agent_inactive';

/**
 * Who a customer, company or factory belongs to (D-417, D-419): agent links claimed after sign-in, leads
 * registered and protected, conversions when a lead signs up, applies as a company or is created as a
 * factory, and staff assignments, transfers and ends with a reason. One active link per customer and per
 * company (partial unique indexes); a company inherits its applicant's link when it is activated.
 */
@Injectable()
export class AgentAttributionService {
  private readonly logger = new Logger(AgentAttributionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    readonly events: DomainEvents,
    readonly activity: ActivityLogService,
  ) {}

  // --- the agent link (D-417 a) -------------------------------------------------------------------------

  /** A signed-in customer who arrived through `/a/{code}`. Never an error for a valid code: the result says. */
  async claim(actor: UserActor, rawCode: string): Promise<{ linked: boolean; reason: SkipReason | null }> {
    const code = rawCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6,12}$/.test(code)) throw new DomainException('agents.code_invalid');
    return this.prisma.withTx(async (tx) => {
      const agent = await tx.salesAgent.findUnique({ where: { code } });
      if (!agent) throw new DomainException('agents.code_invalid');
      if (agent.status !== 'active') return { linked: false, reason: 'agent_inactive' as const };
      if (agent.userId === actor.userId) return { linked: false, reason: 'own_code' as const };
      if (await tx.salesAgentLink.findFirst({ where: { customerUserId: actor.userId, status: 'active' } }))
        return { linked: false, reason: 'already_linked' as const };
      const rules = (await this.settings.at('agents.rules', { at: new Date(), tx })).value;
      if (rules.newCustomersOnly && (await this.hasOrders(tx, actor.userId)))
        return { linked: false, reason: 'not_new_customer' as const };
      await this.createLink(tx, agent, { customerUserId: actor.userId }, 'link', null, null, actor);
      return { linked: true, reason: null };
    });
  }

  // --- leads (D-417 b, D-419) ----------------------------------------------------------------------------

  async registerLead(
    actor: UserActor,
    agent: SalesAgent,
    input: {
      kind: 'customer' | 'factory';
      contactName: string;
      organisationName?: string | null;
      phone?: string | null;
      email?: string | null;
      taxId?: string | null;
      note?: string | null;
      consentConfirmed: boolean;
    },
  ): Promise<LeadRow> {
    if (agent.status !== 'active') throw new DomainException('agents.agent_inactive');
    if (!input.consentConfirmed)
      invalid('consentConfirmed', 'the lead must agree to be contacted', 'required');
    const phone = normalisePhone(input.phone);
    const email = input.email?.trim().toLowerCase() || null;
    const taxId = input.taxId?.trim() || null;
    if (!phone && !email && !taxId) invalid('phone', 'a phone number, e-mail or tax id', 'contact');
    const id = await this.prisma.withTx(async (tx) => {
      const now = new Date();
      const rules = (await this.settings.at('agents.rules', { at: now, tx })).value;
      const open = await tx.salesAgentLead.count({ where: { agentId: agent.id, status: 'registered' } });
      if (open >= rules.maxOpenLeads)
        throw new DomainException('agents.too_many_leads', { params: { max: rules.maxOpenLeads } });
      // Existing customers, companies and factories are not leads (D-417).
      if (input.kind === 'customer') {
        const existing =
          (phone || email
            ? await tx.user.findFirst({
                where: {
                  kind: 'customer',
                  deletedAt: null,
                  OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email }] : [])],
                },
              })
            : null) ?? (taxId ? await tx.company.findFirst({ where: { taxId } }) : null);
        if (existing) throw new DomainException('agents.lead_existing_customer');
      } else {
        const existing = await tx.factory.findFirst({
          where: {
            OR: [
              ...(taxId ? [{ taxId }] : []),
              ...(phone ? [{ contacts: { some: { phone } } }] : []),
              ...(email ? [{ contacts: { some: { email } } }] : []),
            ],
          },
        });
        // D-440: one neutral refusal — never tells an agent that a phone / tax id belongs to a factory.
        if (existing) throw new DomainException('agents.lead_unavailable');
      }
      const taken = await tx.salesAgentLead.findFirst({
        where: {
          status: 'registered',
          protectedUntil: { gt: now },
          OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email }] : []), ...(taxId ? [{ taxId }] : [])],
        },
      });
      if (taken)
        throw new DomainException(
          taken.agentId === agent.id ? 'agents.lead_duplicate' : 'agents.lead_taken',
          {
            params: { until: taken.protectedUntil.toISOString() },
          },
        );
      const lead = await tx.salesAgentLead.create({
        data: {
          agentId: agent.id,
          kind: input.kind,
          contactName: input.contactName.trim(),
          organisationName: input.organisationName?.trim() || null,
          phone,
          email,
          taxId,
          note: input.note?.trim() || null,
          protectedUntil: new Date(now.getTime() + rules.leadProtectionDays * DAY_MS),
        },
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_lead.registered',
        aggregateType: 'sales_agent_lead',
        aggregateId: lead.publicId,
        payload: { leadId: lead.publicId, agentId: agent.publicId, kind: lead.kind },
        actor,
      });
      return lead.publicId;
    });
    return this.lead(id);
  }

  async withdrawLead(actor: UserActor, agent: SalesAgent, publicId: string): Promise<LeadRow> {
    await this.prisma.withTx(async (tx) => {
      const lead = await tx.salesAgentLead.findUnique({ where: { publicId } });
      if (!lead || lead.agentId !== agent.id) throw new DomainException('http.not_found');
      if (lead.status !== 'registered')
        throw new DomainException('agents.lead_closed', { params: { status: lead.status } });
      await tx.salesAgentLead.update({
        where: { id: lead.id },
        data: { status: 'withdrawn', closedReason: 'withdrawn_by_agent', rowVersion: { increment: 1 } },
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_lead.withdrawn',
        aggregateType: 'sales_agent_lead',
        aggregateId: lead.publicId,
        payload: { leadId: lead.publicId },
        actor,
      });
    });
    return this.lead(publicId);
  }

  /** Staff release a lead early (a dispute, a bad entry): it stops protecting the contact. */
  async releaseLead(actor: UserActor, publicId: string, reason: string): Promise<LeadRow> {
    await this.prisma.withTx(async (tx) => {
      const lead = await tx.salesAgentLead.findUnique({ where: { publicId } });
      if (!lead) throw new DomainException('http.not_found');
      if (lead.status !== 'registered')
        throw new DomainException('agents.lead_closed', { params: { status: lead.status } });
      await tx.salesAgentLead.update({
        where: { id: lead.id },
        data: { status: 'rejected', closedReason: reason.trim(), rowVersion: { increment: 1 } },
      });
      await this.audit.record(tx, {
        category: 'data_access',
        action: 'sales_agent_lead.release',
        actor,
        resourceType: 'sales_agent_lead',
        resourcePublicId: lead.publicId,
        data: { reason },
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_lead.released',
        aggregateType: 'sales_agent_lead',
        aggregateId: lead.publicId,
        payload: { leadId: lead.publicId, reason },
        actor,
      });
    });
    return this.lead(publicId);
  }

  async lead(publicId: string, db: Tx = this.prisma): Promise<LeadRow> {
    const row = await db.salesAgentLead.findUnique({ where: { publicId }, include: LEAD_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  leads(where: Prisma.SalesAgentLeadWhereInput, page: number, perPage: number) {
    return Promise.all([
      this.prisma.salesAgentLead.findMany({
        where,
        include: LEAD_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.salesAgentLead.count({ where }),
    ]);
  }

  /** Scheduled: protection over → the lead expires (the contact is free for anyone). */
  async expireLeads(now = new Date()): Promise<number> {
    const r = await this.prisma.salesAgentLead.updateMany({
      where: { status: 'registered', protectedUntil: { lte: now } },
      data: { status: 'expired', closedReason: 'protection_ended' },
    });
    return r.count;
  }

  // --- conversions -----------------------------------------------------------------------------------------

  /** A sign-up matching a protected customer lead's phone or e-mail is linked to that agent (D-417 b). */
  @OnDomainEvent('customer.registered', { consumer: 'agents.lead_signup' })
  async onRegistered(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const user = await tx.user.findUnique({ where: { publicId: event.aggregateId } });
    if (!user || user.kind !== 'customer') return;
    const lead = await this.matchLead(tx, 'customer', { phone: user.phone, email: user.email });
    if (!lead) return;
    if (await tx.salesAgentLink.findFirst({ where: { customerUserId: user.id, status: 'active' } })) return;
    const agent = await tx.salesAgent.findUniqueOrThrow({ where: { id: lead.agentId } });
    if (agent.status !== 'active' || agent.userId === user.id) return;
    const actor = systemActor('agents.lead_signup');
    await this.createLink(tx, agent, { customerUserId: user.id }, 'lead', lead.id, null, actor);
    await this.convert(tx, lead, { convertedUserId: user.id }, actor, user.displayName);
  }

  /** A company applying with a protected lead's tax id belongs to that agent once activated (D-417). */
  @OnDomainEvent('company.activated', { consumer: 'agents.company_link' })
  async onCompanyActivated(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const company = await tx.company.findUnique({ where: { publicId: event.aggregateId } });
    if (!company) return;
    if (await tx.salesAgentLink.findFirst({ where: { companyId: company.id, status: 'active' } })) return;
    const actor = systemActor('agents.company_link');
    const lead = await this.matchLead(tx, 'customer', { taxId: company.taxId });
    if (lead) {
      const agent = await tx.salesAgent.findUniqueOrThrow({ where: { id: lead.agentId } });
      if (agent.status === 'active' && !(await this.isMember(tx, agent.userId, company.id))) {
        await this.createLink(tx, agent, { companyId: company.id }, 'lead', lead.id, null, actor);
        await this.convert(
          tx,
          lead,
          { convertedCompanyId: company.id },
          actor,
          company.tradeName ?? company.legalName,
        );
        return;
      }
    }
    // Otherwise the company follows the agent of the customer who applied for it.
    const parent = await tx.salesAgentLink.findFirst({
      where: { customerUserId: company.appliedById, status: 'active' },
      include: { agent: true },
    });
    if (
      !parent ||
      parent.agent.status !== 'active' ||
      (await this.isMember(tx, parent.agent.userId, company.id))
    )
      return;
    await this.createLink(tx, parent.agent, { companyId: company.id }, 'company', null, parent, actor);
  }

  /** A factory created with a protected factory lead's tax id or contact is linked to that agent (D-419). */
  @OnDomainEvent('factory.created', { consumer: 'agents.factory_link' })
  async onFactoryCreated(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const factory = await tx.factory.findUnique({
      where: { publicId: event.aggregateId },
      include: { contacts: { select: { phone: true, email: true } } },
    });
    if (!factory) return;
    if (await tx.salesAgentFactoryLink.findUnique({ where: { factoryId: factory.id } })) return;
    let lead = await this.matchLead(tx, 'factory', { taxId: factory.taxId });
    for (const c of factory.contacts) {
      if (lead) break;
      lead = await this.matchLead(tx, 'factory', { phone: normalisePhone(c.phone), email: c.email });
    }
    if (!lead) return;
    const agent = await tx.salesAgent.findUniqueOrThrow({ where: { id: lead.agentId } });
    if (agent.status !== 'active') return;
    const actor = systemActor('agents.factory_link');
    await this.createFactoryLink(tx, agent, factory, lead.id, null, actor);
    await this.convert(
      tx,
      lead,
      { convertedFactoryId: factory.id },
      actor,
      factory.tradeName ?? factory.legalName,
    );
  }

  // --- staff: links -----------------------------------------------------------------------------------------

  /** Assign or transfer a customer or company to an agent, ending any current link (D-417 c). */
  async assign(
    actor: UserActor,
    input: { agentId: string; customerId?: string; companyId?: string; reason: string },
  ): Promise<LinkRow> {
    if (!input.customerId === !input.companyId)
      invalid('customerId', 'a customer or a company, not both', 'subject');
    const id = await this.prisma.withTx(async (tx) => {
      const agent = await tx.salesAgent.findUnique({ where: { publicId: input.agentId } });
      if (!agent) invalid('agentId', 'an agent', 'agent');
      if (agent.status !== 'active') throw new DomainException('agents.agent_inactive');
      let subject: { customerUserId: bigint } | { companyId: bigint };
      if (input.customerId) {
        const user = await tx.user.findUnique({ where: { publicId: input.customerId } });
        if (!user || user.kind !== 'customer') invalid('customerId', 'a customer', 'customer');
        if (user.id === agent.userId) throw new DomainException('agents.self_link');
        subject = { customerUserId: user.id };
      } else {
        const company = await tx.company.findUnique({ where: { publicId: input.companyId! } });
        if (!company) invalid('companyId', 'a company', 'company');
        if (await this.isMember(tx, agent.userId, company.id)) throw new DomainException('agents.self_link');
        subject = { companyId: company.id };
      }
      const current = await tx.salesAgentLink.findFirst({ where: { ...subject, status: 'active' } });
      if (current) {
        if (current.agentId === agent.id) throw new DomainException('agents.already_linked');
        await tx.salesAgentLink.update({
          where: { id: current.id },
          data: { status: 'ended', endedAt: new Date(), endedReason: `transferred: ${input.reason.trim()}` },
        });
      }
      const link = await this.createLink(tx, agent, subject, 'staff', null, null, actor, input.reason.trim());
      await this.audit.record(tx, {
        category: 'data_access',
        action: current ? 'sales_agent_link.transfer' : 'sales_agent_link.assign',
        actor,
        resourceType: 'sales_agent_link',
        resourcePublicId: link.publicId,
        data: { agentId: agent.publicId, previousLinkId: current?.publicId ?? null, reason: input.reason },
      });
      return link.publicId;
    });
    return this.link(id);
  }

  async endLink(actor: UserActor, publicId: string, reason: string): Promise<LinkRow> {
    await this.prisma.withTx(async (tx) => {
      const link = await tx.salesAgentLink.findUnique({ where: { publicId } });
      if (!link) throw new DomainException('http.not_found');
      if (link.status !== 'active') throw new DomainException('agents.link_ended');
      await tx.salesAgentLink.update({
        where: { id: link.id },
        data: { status: 'ended', endedAt: new Date(), endedReason: reason.trim() },
      });
      await this.audit.record(tx, {
        category: 'data_access',
        action: 'sales_agent_link.end',
        actor,
        resourceType: 'sales_agent_link',
        resourcePublicId: link.publicId,
        data: { reason },
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_link.ended',
        aggregateType: 'sales_agent_link',
        aggregateId: link.publicId,
        payload: { linkId: link.publicId, reason },
        actor,
      });
    });
    return this.link(publicId);
  }

  /** Scheduled: links past their attribution months end (orders after that earned nothing anyway). */
  async endExpiredLinks(now = new Date()): Promise<number> {
    const r = await this.prisma.salesAgentLink.updateMany({
      where: { status: 'active', endsAt: { lte: now } },
      data: { status: 'ended', endedAt: now, endedReason: 'attribution_ended' },
    });
    return r.count;
  }

  async link(publicId: string, db: Tx = this.prisma): Promise<LinkRow> {
    const row = await db.salesAgentLink.findUnique({ where: { publicId }, include: LINK_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  links(where: Prisma.SalesAgentLinkWhereInput, page: number, perPage: number) {
    return Promise.all([
      this.prisma.salesAgentLink.findMany({
        where,
        include: LINK_INCLUDE,
        orderBy: { attributedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.salesAgentLink.count({ where }),
    ]);
  }

  // --- staff: factory links (D-419) ----------------------------------------------------------------------

  async linkFactory(
    actor: UserActor,
    input: { agentId: string; factoryId: string; reason: string },
  ): Promise<FactoryLinkRow> {
    const id = await this.prisma.withTx(async (tx) => {
      const agent = await tx.salesAgent.findUnique({ where: { publicId: input.agentId } });
      if (!agent) invalid('agentId', 'an agent', 'agent');
      if (agent.status !== 'active') throw new DomainException('agents.agent_inactive');
      const factory = await tx.factory.findUnique({ where: { publicId: input.factoryId } });
      if (!factory) invalid('factoryId', 'a factory', 'factory');
      if (await tx.salesAgentFactoryLink.findUnique({ where: { factoryId: factory.id } }))
        throw new DomainException('agents.factory_linked');
      const link = await this.createFactoryLink(tx, agent, factory, null, input.reason.trim(), actor);
      await this.audit.record(tx, {
        category: 'data_access',
        action: 'sales_agent_factory_link.create',
        actor,
        resourceType: 'sales_agent_factory_link',
        resourcePublicId: link.publicId,
        data: { agentId: agent.publicId, factoryId: factory.publicId, reason: input.reason },
      });
      return link.publicId;
    });
    return this.factoryLink(id);
  }

  async endFactoryLink(actor: UserActor, publicId: string, reason: string): Promise<FactoryLinkRow> {
    await this.prisma.withTx(async (tx) => {
      const link = await tx.salesAgentFactoryLink.findUnique({ where: { publicId } });
      if (!link) throw new DomainException('http.not_found');
      if (link.status !== 'pending') throw new DomainException('agents.link_ended');
      await tx.salesAgentFactoryLink.update({
        where: { id: link.id },
        data: { status: 'ended', closedAt: new Date(), reason: reason.trim() },
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_factory_link.ended',
        aggregateType: 'sales_agent_factory_link',
        aggregateId: link.publicId,
        payload: { factoryLinkId: link.publicId, reason },
        actor,
      });
    });
    return this.factoryLink(publicId);
  }

  async factoryLink(publicId: string, db: Tx = this.prisma): Promise<FactoryLinkRow> {
    const row = await db.salesAgentFactoryLink.findUnique({
      where: { publicId },
      include: FACTORY_LINK_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  factoryLinks(where: Prisma.SalesAgentFactoryLinkWhereInput, page: number, perPage: number) {
    return Promise.all([
      this.prisma.salesAgentFactoryLink.findMany({
        where,
        include: FACTORY_LINK_INCLUDE,
        orderBy: { linkedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.salesAgentFactoryLink.count({ where }),
    ]);
  }

  // --- helpers ---------------------------------------------------------------------------------------------

  private async hasOrders(tx: Tx, userId: bigint): Promise<boolean> {
    return (
      (await tx.orderGroup.count({ where: { customerUserId: userId, status: { not: 'cancelled' } } })) > 0
    );
  }

  private async isMember(tx: Tx, userId: bigint, companyId: bigint): Promise<boolean> {
    return (await tx.companyMember.count({ where: { userId, companyId, status: { not: 'removed' } } })) > 0;
  }

  private async matchLead(
    tx: Tx,
    kind: 'customer' | 'factory',
    keys: { phone?: string | null; email?: string | null; taxId?: string | null },
  ): Promise<SalesAgentLead | null> {
    const or = [
      ...(keys.phone ? [{ phone: keys.phone }] : []),
      ...(keys.email ? [{ email: keys.email.toLowerCase() }] : []),
      ...(keys.taxId ? [{ taxId: keys.taxId }] : []),
    ];
    if (or.length === 0) return null;
    return tx.salesAgentLead.findFirst({
      where: { kind, status: 'registered', protectedUntil: { gt: new Date() }, OR: or },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async createLink(
    tx: Tx,
    agent: SalesAgent,
    subject: { customerUserId: bigint } | { companyId: bigint },
    source: 'link' | 'lead' | 'staff' | 'company',
    leadId: bigint | null,
    parent: { id: bigint; endsAt: Date } | null,
    actor: Actor,
    reason?: string,
  ) {
    const now = new Date();
    const version = await planVersionAt(tx, agent.planId, now);
    if (!version) throw new DomainException('agents.plan_not_in_force');
    // A company inherits its applicant's window; otherwise the plan's attribution months from now.
    const endsAt = parent ? parent.endsAt : addMonths(now, version.attributionMonths);
    if (endsAt <= now) throw new DomainException('agents.link_ended');
    const link = await tx.salesAgentLink.create({
      data: {
        agentId: agent.id,
        ...subject,
        source,
        leadId,
        parentLinkId: parent?.id ?? null,
        endsAt,
        reason: reason ?? null,
      },
    });
    await recordAgentEvent(this, tx, {
      type: 'sales_agent_link.created',
      aggregateType: 'sales_agent_link',
      aggregateId: link.publicId,
      payload: {
        linkId: link.publicId,
        agentId: agent.publicId,
        source,
        subject: 'companyId' in subject ? 'company' : 'customer',
        endsAt: endsAt.toISOString(),
      },
      actor,
    });
    return link;
  }

  private async createFactoryLink(
    tx: Tx,
    agent: SalesAgent,
    factory: { id: bigint; publicId: string },
    leadId: bigint | null,
    reason: string | null,
    actor: Actor,
  ) {
    const link = await tx.salesAgentFactoryLink.create({
      data: {
        agentId: agent.id,
        factoryId: factory.id,
        leadId,
        reason,
      },
    });
    await recordAgentEvent(this, tx, {
      type: 'sales_agent_factory_link.created',
      aggregateType: 'sales_agent_factory_link',
      aggregateId: link.publicId,
      payload: { factoryLinkId: link.publicId, agentId: agent.publicId, factoryId: factory.publicId },
      actor,
    });
    return link;
  }

  private async convert(
    tx: Tx,
    lead: SalesAgentLead,
    target: { convertedUserId?: bigint; convertedCompanyId?: bigint; convertedFactoryId?: bigint },
    actor: Actor,
    name: string | null,
  ) {
    await tx.salesAgentLead.update({
      where: { id: lead.id },
      data: { status: 'converted', convertedAt: new Date(), ...target, rowVersion: { increment: 1 } },
    });
    const agentUser = await tx.salesAgent.findUniqueOrThrow({
      where: { id: lead.agentId },
      select: { user: { select: { publicId: true } } },
    });
    await recordAgentEvent(this, tx, {
      type: 'sales_agent_lead.converted',
      aggregateType: 'sales_agent_lead',
      aggregateId: lead.publicId,
      // `customerId` addresses the agent's notification (they are a customer account).
      payload: {
        leadId: lead.publicId,
        contactName: name ?? lead.contactName,
        customerId: agentUser.user.publicId,
      },
      actor,
    });
    this.logger.log(`lead ${lead.publicId} converted`);
  }
}
