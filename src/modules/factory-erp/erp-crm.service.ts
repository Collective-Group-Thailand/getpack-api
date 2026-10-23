import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { type ActionRule, nextActions } from '@common/next-actions/next-actions';
import { paginated, toSkipTake } from '@common/pagination/pagination';
import { type ErpTx } from '@database/erp-prisma.service';
import {
  type ErpActivity,
  type ErpLead,
  type ErpOpportunity,
  type ErpOpportunityStage,
  type ErpTradingPartner,
  Prisma,
  type User,
} from '@generated/prisma-erp/client';
import { Injectable } from '@nestjs/common';

import { dec, fmtMoney } from './erp.math';
import {
  type ErpActivityDto,
  type ErpActivityListQuery,
  type ErpCompleteActivityDto,
  type ErpConvertLeadDto,
  type ErpConvertLeadResultDto,
  type ErpLeadDto,
  type ErpLeadListQuery,
  type ErpOpportunityDto,
  type ErpOpportunityListQuery,
  type ErpPipelineDto,
  type ErpSalespersonOptionDto,
  type ErpSaveActivityDto,
  type ErpSaveLeadDto,
  type ErpSaveOpportunityDto,
} from './erp-e4.dto';
import { day, factoryUser, factoryUsers, iso, isoTs, partnerRef, today, userRef } from './erp-sales.shared';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

/** D-359: default probability of an opportunity by stage. */
export const STAGE_PROBABILITY: Record<ErpOpportunityStage, number> = {
  prospecting: 10,
  proposal: 40,
  negotiation: 70,
  won: 100,
  lost: 0,
};
const OPEN_LEAD = ['new', 'contacted', 'qualified'] as const;
const OPEN_OPP: ErpOpportunityStage[] = ['prospecting', 'proposal', 'negotiation'];

const LEAD_INCLUDE = {
  salesperson: true,
  customer: true,
  _count: { select: { activities: { where: { doneAt: null } } } },
} as const;
type LeadRow = Prisma.ErpLeadGetPayload<{ include: typeof LEAD_INCLUDE }>;

const OPP_INCLUDE = {
  salesperson: true,
  customer: true,
  lead: true,
  _count: { select: { quotations: true } },
} as const;
type OppRow = Prisma.ErpOpportunityGetPayload<{ include: typeof OPP_INCLUDE }>;

const ACT_INCLUDE = {
  lead: true,
  opportunity: true,
  customer: true,
  assignee: true,
  createdBy: true,
} as const;
type ActRow = Prisma.ErpActivityGetPayload<{ include: typeof ACT_INCLUDE }>;

export const LEAD_ACTIONS: ActionRule<{ stage: string }>[] = [
  {
    key: 'erp_lead.edit',
    permissions: ['factory_sales.manage'],
    when: (l) => (OPEN_LEAD as readonly string[]).includes(l.stage),
  },
  {
    key: 'erp_lead.convert',
    permissions: ['factory_sales.manage', 'factory_trading_partners.manage'],
    when: (l) => (OPEN_LEAD as readonly string[]).includes(l.stage),
  },
  {
    key: 'erp_lead.lose',
    permissions: ['factory_sales.manage'],
    when: (l) => (OPEN_LEAD as readonly string[]).includes(l.stage),
  },
];

export const OPPORTUNITY_ACTIONS: ActionRule<{ stage: ErpOpportunityStage; customer: boolean }>[] = [
  {
    key: 'erp_opportunity.edit',
    permissions: ['factory_sales.manage'],
    when: (o) => OPEN_OPP.includes(o.stage),
  },
  {
    key: 'erp_opportunity.quote',
    permissions: ['factory_sales.manage'],
    when: (o) => (OPEN_OPP.includes(o.stage) ? (o.customer ? true : 'แปลงผู้สนใจเป็นลูกค้าก่อน') : false),
  },
  {
    key: 'erp_opportunity.win',
    permissions: ['factory_sales.manage'],
    when: (o) => OPEN_OPP.includes(o.stage),
  },
  {
    key: 'erp_opportunity.lose',
    permissions: ['factory_sales.manage'],
    when: (o) => OPEN_OPP.includes(o.stage),
  },
];

/**
 * CRM (D-359): leads (prospects) that convert into customers, opportunities through the pipeline, and the
 * activities — calls, visits, tasks — that move them, each with an assignee and a due time.
 */
@Injectable()
export class ErpCrmService {
  constructor(private readonly workspace: ErpWorkspace) {}

  async salespeople(scope: ErpScope): Promise<ErpSalespersonOptionDto[]> {
    return (await factoryUsers(this.workspace.db, scope.factory.id)).map((u) => ({
      id: u.user.publicId,
      name: u.user.displayName,
      roles: u.roles,
    }));
  }

  // ------------------------------------------------------------------------------------- leads

  async listLeads(scope: ErpScope, q: ErpLeadListQuery, perms: ReadonlySet<string>) {
    const where: Prisma.ErpLeadWhereInput = { factoryId: scope.factory.id };
    if (q.stage === 'open') where.stage = { in: [...OPEN_LEAD] };
    else if (q.stage) where.stage = q.stage as ErpLead['stage'];
    if (q.salespersonId) where.salesperson = { publicId: q.salespersonId };
    if (q.q)
      where.OR = ['name', 'contactName', 'phone', 'email', 'lineId'].map((f) => ({
        [f]: { contains: q.q, mode: 'insensitive' },
      }));
    const [rows, total] = await Promise.all([
      this.workspace.db.erpLead.findMany({
        where,
        include: LEAD_INCLUDE,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpLead.count({ where }),
    ]);
    return paginated(
      rows.map((r) => leadDto(r, perms)),
      total,
      q,
    );
  }

  async getLead(scope: ErpScope, publicId: string, perms: ReadonlySet<string>): Promise<ErpLeadDto> {
    const row = await this.workspace.db.erpLead.findFirst({
      where: { publicId, factoryId: scope.factory.id },
      include: LEAD_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return leadDto(row, perms);
  }

  async createLead(scope: ErpScope, body: ErpSaveLeadDto, perms: ReadonlySet<string>): Promise<ErpLeadDto> {
    const id = await this.workspace.tx(async (tx) => {
      const salesperson = await this.person(tx, scope, body.salespersonId, scope.actor.userId);
      const lead = await tx.erpLead.create({
        data: {
          factoryId: scope.factory.id,
          ...leadFields(body),
          salespersonId: salesperson,
          createdById: scope.actor.userId,
        },
      });
      await this.workspace.record(tx, scope, 'erp_lead.created', 'erp_lead', lead.publicId);
      return lead.publicId;
    });
    return this.getLead(scope, id, perms);
  }

  async updateLead(
    scope: ErpScope,
    publicId: string,
    ifMatch: string | undefined,
    body: ErpSaveLeadDto,
    perms: ReadonlySet<string>,
  ): Promise<ErpLeadDto> {
    await this.workspace.tx(async (tx) => {
      const lead = await this.lockLead(tx, scope, publicId);
      assertIfMatch(ifMatch, etagOf(lead.publicId, lead.rowVersion));
      if (!(OPEN_LEAD as readonly string[]).includes(lead.stage))
        throw new DomainException('erp.invalid_status', { params: { status: lead.stage } });
      const salesperson =
        body.salespersonId === undefined
          ? lead.salespersonId
          : await this.person(tx, scope, body.salespersonId, null);
      await tx.erpLead.update({
        where: { id: lead.id },
        data: {
          ...leadFields(body),
          salespersonId: salesperson,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
    });
    return this.getLead(scope, publicId, perms);
  }

  /** Makes the lead a customer — a new trading partner, or one that exists (made a customer too). */
  async convertLead(
    scope: ErpScope,
    publicId: string,
    body: ErpConvertLeadDto,
    perms: ReadonlySet<string>,
  ): Promise<ErpConvertLeadResultDto> {
    const result = await this.workspace.tx(async (tx) => {
      const lead = await this.lockLead(tx, scope, publicId);
      if (!(OPEN_LEAD as readonly string[]).includes(lead.stage))
        throw new DomainException('erp.invalid_status', { params: { status: lead.stage } });
      let customer: ErpTradingPartner;
      if (body.customerId) {
        const found = await tx.erpTradingPartner.findFirst({
          where: { publicId: body.customerId, factoryId: scope.factory.id },
        });
        if (!found) throw new DomainException('http.not_found');
        if (found.status === 'archived')
          throw new DomainException('erp.archived', { params: { name: found.name } });
        customer =
          found.kind === 'supplier'
            ? await tx.erpTradingPartner.update({
                where: { id: found.id },
                data: { kind: 'both', updatedById: scope.actor.userId, rowVersion: { increment: 1 } },
              })
            : found;
      } else {
        const code = body.code?.toUpperCase() ?? (await this.nextCustomerCode(tx, scope.factory.id));
        const taken = await tx.erpTradingPartner.findUnique({
          where: { factoryId_code: { factoryId: scope.factory.id, code } },
        });
        if (taken) throw new DomainException('erp.code_taken', { params: { code } });
        customer = await tx.erpTradingPartner.create({
          data: {
            factoryId: scope.factory.id,
            code,
            kind: 'customer',
            name: lead.name,
            contactName: lead.contactName,
            phone: lead.phone,
            email: lead.email,
            address: lead.address,
            taxId: body.taxId ?? null,
            branchCode: body.taxId ? (body.branchCode ?? '00000') : null,
            paymentTermDays: body.paymentTermDays ?? 0,
            salespersonId: lead.salespersonId,
            note: lead.lineId ? `LINE: ${lead.lineId}` : null,
            createdById: scope.actor.userId,
          },
        });
      }
      await tx.erpLead.update({
        where: { id: lead.id },
        data: {
          stage: 'converted',
          customerId: customer.id,
          convertedAt: new Date(),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await tx.erpOpportunity.updateMany({
        where: { leadId: lead.id, customerId: null },
        data: { customerId: customer.id },
      });
      let opportunityId: string | null = null;
      if (body.openOpportunity) {
        const opp = await tx.erpOpportunity.create({
          data: {
            factoryId: scope.factory.id,
            title: lead.name,
            customerId: customer.id,
            leadId: lead.id,
            salespersonId: lead.salespersonId,
            value: lead.expectedValue ?? 0,
            probabilityPct: STAGE_PROBABILITY.prospecting,
            createdById: scope.actor.userId,
          },
        });
        opportunityId = opp.publicId;
      }
      await this.workspace.record(tx, scope, 'erp_lead.converted', 'erp_lead', lead.publicId, {
        customerId: customer.publicId,
      });
      return { customer, opportunityId };
    });
    return {
      lead: await this.getLead(scope, publicId, perms),
      customer: partnerRef(result.customer),
      opportunityId: result.opportunityId,
    };
  }

  async loseLead(scope: ErpScope, publicId: string, reason: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const lead = await this.lockLead(tx, scope, publicId);
      if (!(OPEN_LEAD as readonly string[]).includes(lead.stage))
        throw new DomainException('erp.invalid_status', { params: { status: lead.stage } });
      await tx.erpLead.update({
        where: { id: lead.id },
        data: {
          stage: 'lost',
          lostReason: reason,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(tx, scope, 'erp_lead.lost', 'erp_lead', lead.publicId);
    });
    return this.getLead(scope, publicId, perms);
  }

  // ----------------------------------------------------------------------------- opportunities

  async listOpportunities(scope: ErpScope, q: ErpOpportunityListQuery, perms: ReadonlySet<string>) {
    const where: Prisma.ErpOpportunityWhereInput = { factoryId: scope.factory.id };
    if (q.stage === 'open') where.stage = { in: OPEN_OPP };
    else if (q.stage) where.stage = q.stage as ErpOpportunityStage;
    if (q.salespersonId) where.salesperson = { publicId: q.salespersonId };
    if (q.customerId) where.customer = { publicId: q.customerId };
    if (q.q)
      where.OR = [
        { title: { contains: q.q, mode: 'insensitive' } },
        { customer: { name: { contains: q.q, mode: 'insensitive' } } },
        { lead: { name: { contains: q.q, mode: 'insensitive' } } },
      ];
    const [rows, total] = await Promise.all([
      this.workspace.db.erpOpportunity.findMany({
        where,
        include: OPP_INCLUDE,
        orderBy: [{ expectedCloseOn: { sort: 'asc', nulls: 'last' } }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpOpportunity.count({ where }),
    ]);
    return paginated(
      rows.map((r) => opportunityDto(r, perms)),
      total,
      q,
    );
  }

  async getOpportunity(
    scope: ErpScope,
    publicId: string,
    perms: ReadonlySet<string>,
  ): Promise<ErpOpportunityDto> {
    const row = await this.workspace.db.erpOpportunity.findFirst({
      where: { publicId, factoryId: scope.factory.id },
      include: OPP_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return opportunityDto(row, perms);
  }

  async createOpportunity(scope: ErpScope, body: ErpSaveOpportunityDto, perms: ReadonlySet<string>) {
    const id = await this.workspace.tx(async (tx) => {
      const { customerId, leadId } = await this.party(tx, scope, body);
      const stage = (body.stage ?? 'prospecting') as ErpOpportunityStage;
      const opp = await tx.erpOpportunity.create({
        data: {
          factoryId: scope.factory.id,
          title: body.title,
          customerId,
          leadId,
          stage,
          value: body.value ?? '0',
          probabilityPct: body.probabilityPct ?? STAGE_PROBABILITY[stage],
          expectedCloseOn: body.expectedCloseOn ? day(body.expectedCloseOn) : null,
          salespersonId: await this.person(tx, scope, body.salespersonId, scope.actor.userId),
          note: body.note ?? null,
          createdById: scope.actor.userId,
        },
      });
      await this.workspace.record(tx, scope, 'erp_opportunity.created', 'erp_opportunity', opp.publicId);
      return opp.publicId;
    });
    return this.getOpportunity(scope, id, perms);
  }

  async updateOpportunity(
    scope: ErpScope,
    publicId: string,
    ifMatch: string | undefined,
    body: ErpSaveOpportunityDto,
    perms: ReadonlySet<string>,
  ) {
    await this.workspace.tx(async (tx) => {
      const opp = await this.lockOpportunity(tx, scope, publicId);
      assertIfMatch(ifMatch, etagOf(opp.publicId, opp.rowVersion));
      if (!OPEN_OPP.includes(opp.stage))
        throw new DomainException('erp.invalid_status', { params: { status: opp.stage } });
      const { customerId, leadId } = body.customerId || body.leadId ? await this.party(tx, scope, body) : opp;
      const stage = (body.stage ?? opp.stage) as ErpOpportunityStage;
      await tx.erpOpportunity.update({
        where: { id: opp.id },
        data: {
          title: body.title,
          customerId,
          leadId,
          stage,
          ...(body.value !== undefined && { value: body.value }),
          probabilityPct:
            body.probabilityPct ?? (stage !== opp.stage ? STAGE_PROBABILITY[stage] : opp.probabilityPct),
          ...(body.expectedCloseOn !== undefined && {
            expectedCloseOn: body.expectedCloseOn ? day(body.expectedCloseOn) : null,
          }),
          ...(body.salespersonId !== undefined && {
            salespersonId: await this.person(tx, scope, body.salespersonId, null),
          }),
          ...(body.note !== undefined && { note: body.note }),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
    });
    return this.getOpportunity(scope, publicId, perms);
  }

  async winOpportunity(scope: ErpScope, publicId: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const opp = await this.lockOpportunity(tx, scope, publicId);
      await this.win(tx, scope, opp);
    });
    return this.getOpportunity(scope, publicId, perms);
  }

  /** D-360: an accepted quotation wins its opportunity (no-op when it is already closed); `actor` null = the customer online. */
  async win(
    tx: ErpTx,
    ctx: { factory: ErpScope['factory']; actor: ErpScope['actor'] | null },
    opp: ErpOpportunity,
  ): Promise<void> {
    if (!OPEN_OPP.includes(opp.stage)) return;
    await tx.erpOpportunity.update({
      where: { id: opp.id },
      data: {
        stage: 'won',
        probabilityPct: 100,
        wonAt: new Date(),
        closedAt: new Date(),
        updatedById: ctx.actor?.userId ?? null,
        rowVersion: { increment: 1 },
      },
    });
    if (ctx.actor)
      await this.workspace.record(
        tx,
        ctx as ErpScope,
        'erp_opportunity.won',
        'erp_opportunity',
        opp.publicId,
      );
    else
      await this.workspace.recordSystem(
        tx,
        ctx.factory.publicId,
        'erp_opportunity.won',
        'erp_opportunity',
        opp.publicId,
      );
  }

  async loseOpportunity(scope: ErpScope, publicId: string, reason: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const opp = await this.lockOpportunity(tx, scope, publicId);
      if (!OPEN_OPP.includes(opp.stage))
        throw new DomainException('erp.invalid_status', { params: { status: opp.stage } });
      await tx.erpOpportunity.update({
        where: { id: opp.id },
        data: {
          stage: 'lost',
          probabilityPct: 0,
          lostReason: reason,
          closedAt: new Date(),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(tx, scope, 'erp_opportunity.lost', 'erp_opportunity', opp.publicId);
    });
    return this.getOpportunity(scope, publicId, perms);
  }

  /** The pipeline (D-359): open stages with value and weighted value; won and lost this month; by salesperson. */
  async pipeline(scope: ErpScope): Promise<ErpPipelineDto> {
    const monthStart = day(`${today().slice(0, 7)}-01`);
    const rows = await this.workspace.db.erpOpportunity.findMany({
      where: {
        factoryId: scope.factory.id,
        OR: [{ stage: { in: OPEN_OPP } }, { closedAt: { gte: monthStart } }],
      },
      include: { salesperson: true },
    });
    const stages = (['prospecting', 'proposal', 'negotiation', 'won', 'lost'] as ErpOpportunityStage[]).map(
      (stage) => {
        const of = rows.filter((r) => r.stage === stage);
        const value = of.reduce((a, r) => a.plus(dec(r.value)), dec(0));
        const weighted = of.reduce((a, r) => a.plus(dec(r.value).times(r.probabilityPct).div(100)), dec(0));
        return { stage, count: of.length, value: fmtMoney(value), weighted: fmtMoney(weighted) };
      },
    );
    const open = rows.filter((r) => OPEN_OPP.includes(r.stage));
    const soon = day(
      new Date(Date.parse(`${today()}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10),
    );
    const bySp = new Map<
      string,
      { sp: User | null; open: number; value: Prisma.Decimal; weighted: Prisma.Decimal }
    >();
    for (const r of open) {
      const key = r.salesperson?.publicId ?? '-';
      const e = bySp.get(key) ?? { sp: r.salesperson, open: 0, value: dec(0), weighted: dec(0) };
      e.open += 1;
      e.value = e.value.plus(dec(r.value));
      e.weighted = e.weighted.plus(dec(r.value).times(r.probabilityPct).div(100));
      bySp.set(key, e);
    }
    const myDue = await this.workspace.db.erpActivity.count({
      where: {
        factoryId: scope.factory.id,
        assigneeId: scope.actor.userId,
        doneAt: null,
        dueAt: {
          lt: day(new Date(Date.parse(`${today()}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)),
        },
      },
    });
    const openValue = open.reduce((a, r) => a.plus(dec(r.value)), dec(0));
    const openWeighted = open.reduce((a, r) => a.plus(dec(r.value).times(r.probabilityPct).div(100)), dec(0));
    return {
      stages,
      openValue: fmtMoney(openValue),
      openWeighted: fmtMoney(openWeighted),
      closingSoon: open.filter((r) => r.expectedCloseOn && r.expectedCloseOn <= soon).length,
      salespeople: [...bySp.values()]
        .map((e) => ({
          salesperson: userRef(e.sp),
          open: e.open,
          value: fmtMoney(e.value),
          weighted: fmtMoney(e.weighted),
        }))
        .sort((a, b) => dec(b.weighted).comparedTo(dec(a.weighted))),
      myDue,
    };
  }

  // -------------------------------------------------------------------------------- activities

  async listActivities(scope: ErpScope, q: ErpActivityListQuery) {
    const where: Prisma.ErpActivityWhereInput = { factoryId: scope.factory.id };
    const endOfToday = day(
      new Date(Date.parse(`${today()}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10),
    );
    const view = q.view ?? 'open';
    if (view === 'open') where.doneAt = null;
    if (view === 'due') Object.assign(where, { doneAt: null, dueAt: { lt: endOfToday } });
    if (view === 'overdue') Object.assign(where, { doneAt: null, dueAt: { lt: new Date() } });
    if (view === 'done') where.doneAt = { not: null };
    if (q.mine) where.assigneeId = scope.actor.userId;
    else if (q.assigneeId) where.assignee = { publicId: q.assigneeId };
    if (q.leadId) where.lead = { publicId: q.leadId };
    if (q.opportunityId) where.opportunity = { publicId: q.opportunityId };
    if (q.customerId) where.customer = { publicId: q.customerId };
    const orderBy: Prisma.ErpActivityOrderByWithRelationInput[] =
      view === 'done'
        ? [{ doneAt: 'desc' }, { id: 'desc' }]
        : [{ dueAt: { sort: 'asc', nulls: 'last' } }, { id: 'desc' }];
    const [rows, total] = await Promise.all([
      this.workspace.db.erpActivity.findMany({ where, include: ACT_INCLUDE, orderBy, ...toSkipTake(q) }),
      this.workspace.db.erpActivity.count({ where }),
    ]);
    return paginated(rows.map(activityDto), total, q);
  }

  async createActivity(scope: ErpScope, body: ErpSaveActivityDto): Promise<ErpActivityDto> {
    const subjects = [body.leadId, body.opportunityId, body.customerId].filter(Boolean);
    if (subjects.length !== 1)
      throw new DomainException('validation.failed', {
        errors: [
          { path: 'leadId', code: 'one_of', message: 'Exactly one of leadId, opportunityId, customerId' },
        ],
      });
    const id = await this.workspace.tx(async (tx) => {
      const f = scope.factory.id;
      const lead = body.leadId
        ? await tx.erpLead.findFirst({ where: { publicId: body.leadId, factoryId: f } })
        : null;
      const opp = body.opportunityId
        ? await tx.erpOpportunity.findFirst({ where: { publicId: body.opportunityId, factoryId: f } })
        : null;
      const customer = body.customerId
        ? await tx.erpTradingPartner.findFirst({ where: { publicId: body.customerId, factoryId: f } })
        : null;
      if (!lead && !opp && !customer) throw new DomainException('http.not_found');
      const assigneeId = body.assigneeId
        ? (await factoryUser(tx, f, body.assigneeId)).id
        : scope.actor.userId;
      const a = await tx.erpActivity.create({
        data: {
          factoryId: f,
          kind: body.kind as ErpActivity['kind'],
          subject: body.subject,
          detail: body.detail ?? null,
          leadId: lead?.id ?? null,
          opportunityId: opp?.id ?? null,
          customerId: customer?.id ?? null,
          assigneeId,
          dueAt: body.dueAt ? new Date(body.dueAt) : null,
          doneAt: body.done ? new Date() : null,
          outcome: body.outcome ?? null,
          createdById: scope.actor.userId,
        },
      });
      if (lead && lead.stage === 'new' && body.done && body.kind !== 'note')
        await tx.erpLead.update({
          where: { id: lead.id },
          data: { stage: 'contacted', rowVersion: { increment: 1 } },
        });
      return a.publicId;
    });
    return this.getActivity(scope, id);
  }

  async getActivity(scope: ErpScope, publicId: string): Promise<ErpActivityDto> {
    const row = await this.workspace.db.erpActivity.findFirst({
      where: { publicId, factoryId: scope.factory.id },
      include: ACT_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return activityDto(row);
  }

  async completeActivity(
    scope: ErpScope,
    publicId: string,
    body: ErpCompleteActivityDto,
  ): Promise<ErpActivityDto> {
    await this.workspace.tx(async (tx) => {
      const a = await tx.erpActivity.findFirst({ where: { publicId, factoryId: scope.factory.id } });
      if (!a) throw new DomainException('http.not_found');
      if (a.doneAt) throw new DomainException('erp.invalid_status', { params: { status: 'done' } });
      await tx.erpActivity.update({
        where: { id: a.id },
        data: {
          doneAt: new Date(),
          outcome: body.outcome ?? a.outcome,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (a.leadId && a.kind !== 'note')
        await tx.erpLead.updateMany({
          where: { id: a.leadId, stage: 'new' },
          data: { stage: 'contacted', rowVersion: { increment: 1 } },
        });
    });
    return this.getActivity(scope, publicId);
  }

  // ----------------------------------------------------------------------------------- helpers

  private async lockLead(tx: ErpTx, scope: ErpScope, publicId: string): Promise<ErpLead> {
    const lead = await tx.erpLead.findFirst({ where: { publicId, factoryId: scope.factory.id } });
    if (!lead) throw new DomainException('http.not_found');
    await tx.$queryRaw`SELECT id FROM erp_leads WHERE id = ${lead.id} FOR UPDATE`;
    return lead;
  }

  private async lockOpportunity(tx: ErpTx, scope: ErpScope, publicId: string): Promise<ErpOpportunity> {
    const opp = await tx.erpOpportunity.findFirst({ where: { publicId, factoryId: scope.factory.id } });
    if (!opp) throw new DomainException('http.not_found');
    await tx.$queryRaw`SELECT id FROM erp_opportunities WHERE id = ${opp.id} FOR UPDATE`;
    return opp;
  }

  private async party(tx: ErpTx, scope: ErpScope, body: { customerId?: string; leadId?: string }) {
    if (!body.customerId && !body.leadId)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'customerId', code: 'required', message: 'A customer or a lead' }],
      });
    const customer = body.customerId
      ? await tx.erpTradingPartner.findFirst({
          where: { publicId: body.customerId, factoryId: scope.factory.id },
        })
      : null;
    if (body.customerId && !customer) throw new DomainException('http.not_found');
    if (customer?.kind === 'supplier')
      throw new DomainException('erp.customer_required', { params: { name: customer.name } });
    const lead = body.leadId
      ? await tx.erpLead.findFirst({ where: { publicId: body.leadId, factoryId: scope.factory.id } })
      : null;
    if (body.leadId && !lead) throw new DomainException('http.not_found');
    return { customerId: customer?.id ?? lead?.customerId ?? null, leadId: lead?.id ?? null };
  }

  /** A salesperson: the given factory user, `null` to clear, or the fallback when not given. */
  private async person(
    tx: ErpTx,
    scope: ErpScope,
    publicId: string | null | undefined,
    fallback: bigint | null,
  ): Promise<bigint | null> {
    if (publicId === undefined) return fallback;
    if (publicId === null) return null;
    return (await factoryUser(tx, scope.factory.id, publicId)).id;
  }

  private async nextCustomerCode(tx: ErpTx, factoryId: bigint): Promise<string> {
    const rows = await tx.$queryRaw<{ n: number | null }[]>(Prisma.sql`
      SELECT max(substring(code from '^C(\\d+)$')::int) AS n FROM erp_trading_partners
       WHERE factory_id = ${factoryId} AND code ~ '^C\\d+$'`);
    return `C${String((rows[0]?.n ?? 0) + 1).padStart(4, '0')}`;
  }
}

function leadFields(body: ErpSaveLeadDto) {
  return {
    name: body.name,
    contactName: body.contactName ?? null,
    phone: body.phone ?? null,
    email: body.email ?? null,
    lineId: body.lineId ?? null,
    address: body.address ?? null,
    ...(body.source && { source: body.source as ErpLead['source'] }),
    ...(body.stage && { stage: body.stage as ErpLead['stage'] }),
    expectedValue: body.expectedValue ?? null,
    note: body.note ?? null,
  };
}

export function leadDto(r: LeadRow, perms: ReadonlySet<string>): ErpLeadDto {
  return {
    id: r.publicId,
    name: r.name,
    contactName: r.contactName,
    phone: r.phone,
    email: r.email,
    lineId: r.lineId,
    address: r.address,
    source: r.source,
    stage: r.stage,
    expectedValue: r.expectedValue === null ? null : fmtMoney(r.expectedValue),
    salesperson: userRef(r.salesperson),
    customer: r.customer ? partnerRef(r.customer) : null,
    lostReason: r.lostReason,
    note: r.note,
    openActivities: r._count.activities,
    convertedAt: isoTs(r.convertedAt),
    createdAt: isoTs(r.createdAt)!,
    nextActions: nextActions({ stage: r.stage }, LEAD_ACTIONS, perms),
    version: r.rowVersion,
  };
}

export function opportunityDto(r: OppRow, perms: ReadonlySet<string>): ErpOpportunityDto {
  return {
    id: r.publicId,
    title: r.title,
    stage: r.stage,
    value: fmtMoney(r.value),
    probabilityPct: r.probabilityPct,
    weightedValue: fmtMoney(dec(r.value).times(r.probabilityPct).div(100)),
    expectedCloseOn: iso(r.expectedCloseOn),
    customer: r.customer ? partnerRef(r.customer) : null,
    lead: r.lead ? { id: r.lead.publicId, code: r.lead.publicId.slice(0, 8), name: r.lead.name } : null,
    salesperson: userRef(r.salesperson),
    lostReason: r.lostReason,
    note: r.note,
    quotations: r._count.quotations,
    wonAt: isoTs(r.wonAt),
    closedAt: isoTs(r.closedAt),
    createdAt: isoTs(r.createdAt)!,
    nextActions: nextActions({ stage: r.stage, customer: r.customerId !== null }, OPPORTUNITY_ACTIONS, perms),
    version: r.rowVersion,
  };
}

export function activityDto(r: ActRow): ErpActivityDto {
  const about = r.lead
    ? { type: 'lead', id: r.lead.publicId, name: r.lead.name }
    : r.opportunity
      ? { type: 'opportunity', id: r.opportunity.publicId, name: r.opportunity.title }
      : { type: 'customer', id: r.customer!.publicId, name: r.customer!.name };
  return {
    id: r.publicId,
    kind: r.kind,
    subject: r.subject,
    detail: r.detail,
    about,
    assignee: userRef(r.assignee)!,
    dueAt: isoTs(r.dueAt),
    doneAt: isoTs(r.doneAt),
    outcome: r.outcome,
    overdue: !r.doneAt && !!r.dueAt && r.dueAt < new Date(),
    createdBy: r.createdBy.displayName,
    createdAt: isoTs(r.createdAt)!,
    version: r.rowVersion,
  };
}
