import { createHash } from 'node:crypto';

import { type UserActor } from '@common/context/actor';
import { FieldEncryption } from '@common/crypto/field-encryption';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { formatMoney } from '@common/money/money';
import { startOfBangkokDay, toBangkokIso } from '@common/time/bangkok';
import { AppConfig } from '@config/app-config';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { BankAccountsService } from '@modules/partners/bank-accounts/bank-accounts.service';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { SettingsService } from '@platform/settings/settings.service';

import { D, invalid, newAgentCode, planVersionAt, recordAgentEvent, termsOf, ZERO } from './agent-shared';
import { type SubmitAgentApplicationDto } from './agents.dto';

export const AGREEMENT_KEY = 'sales_agent_agreement';
const ROLE_KEY = 'sales_agent';
const FREELANCE_PLAN = 'freelance_standard';

export const APPLICATION_INCLUDE = {
  user: { select: { publicId: true, displayName: true, phone: true, email: true } },
  idDocumentFile: { select: { publicId: true, originalName: true } },
  bankBookFile: { select: { publicId: true, originalName: true } },
  agreementVersion: { select: { versionNo: true } },
  decidedBy: { select: { publicId: true, displayName: true } },
  agent: { select: { publicId: true } },
} as const satisfies Prisma.SalesAgentApplicationInclude;
export type ApplicationRow = Prisma.SalesAgentApplicationGetPayload<{ include: typeof APPLICATION_INCLUDE }>;

export const AGENT_INCLUDE = {
  user: { select: { publicId: true, displayName: true, phone: true } },
  plan: { select: { publicId: true, code: true, nameTh: true, agentKind: true } },
  staffUser: { select: { publicId: true, displayName: true } },
  vendor: { select: { publicId: true, bankAccounts: { select: { status: true } } } },
  application: { select: { publicId: true } },
} as const satisfies Prisma.SalesAgentInclude;
export type AgentRow = Prisma.SalesAgentGetPayload<{ include: typeof AGENT_INCLUDE }>;

export const PLAN_INCLUDE = {
  versions: { orderBy: { versionNo: 'desc' } },
  _count: { select: { agents: { where: { status: 'active' } } } },
} as const satisfies Prisma.SalesAgentPlanInclude;
export type PlanRow = Prisma.SalesAgentPlanGetPayload<{ include: typeof PLAN_INCLUDE }>;

export const agentEtag = (a: { publicId: string; rowVersion: number }) => etagOf(a.publicId, a.rowVersion);

/**
 * The sales agent programme's people (D-416, D-418, D-423): customers apply with their tax and bank
 * details and accept the agent agreement; Sales approves with a plan (creating the agent, its vendor and
 * the bank account proposal) or rejects; employees are created by staff; agents are suspended,
 * reactivated or ended with a reason. Commission plans are versioned and maker-checked.
 */
@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly encryption: FieldEncryption,
    private readonly bankAccounts: BankAccountsService,
    private readonly audit: AuditService,
    readonly events: DomainEvents,
    readonly activity: ActivityLogService,
    private readonly config: AppConfig,
    private readonly permissions: PermissionResolver,
  ) {}

  linkFor(code: string): string {
    const web = this.config.get('STOREFRONT_BASE_URL') ?? 'https://www.getpack.invalid';
    return `${web.replace(/\/$/, '')}/a/${code}`;
  }

  // --- the programme as a customer sees it ------------------------------------------------------------

  async agreementInForce(db: Tx = this.prisma, at = new Date()) {
    return db.agreementTemplateVersion.findFirst({
      where: { template: { key: AGREEMENT_KEY }, status: 'approved', effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
    });
  }

  async programme(userId: bigint) {
    const now = new Date();
    const [agreement, plan, rules, agent, application] = await Promise.all([
      this.agreementInForce(),
      this.prisma.salesAgentPlan.findUnique({ where: { code: FREELANCE_PLAN } }),
      this.settings.at('agents.rules', { at: now }),
      this.prisma.salesAgent.findUnique({ where: { userId } }),
      this.prisma.salesAgentApplication.findFirst({ where: { userId }, orderBy: { submittedAt: 'desc' } }),
    ]);
    const state = agent
      ? 'agent'
      : application?.status === 'submitted'
        ? 'applied'
        : application?.status === 'rejected'
          ? 'rejected'
          : application?.status === 'withdrawn'
            ? 'withdrawn'
            : 'none';
    return {
      agreement: agreement
        ? {
            key: AGREEMENT_KEY,
            versionNo: agreement.versionNo,
            effectiveFrom: toBangkokIso(agreement.effectiveFrom),
            textTh: agreement.textTh,
            textEn: agreement.textEn,
          }
        : null,
      plan: plan ? termsOf(await planVersionAt(this.prisma, plan.id, now)) : null,
      linkCookieDays: rules.value.linkCookieDays,
      leadProtectionDays: rules.value.leadProtectionDays,
      paymentTermsDays: rules.value.paymentTermsDays,
      state,
    };
  }

  // --- applications (D-416) ----------------------------------------------------------------------------

  async myApplication(userId: bigint): Promise<ApplicationRow> {
    const row = await this.prisma.salesAgentApplication.findFirst({
      where: { userId },
      include: APPLICATION_INCLUDE,
      orderBy: { submittedAt: 'desc' },
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async submit(
    actor: UserActor,
    input: SubmitAgentApplicationDto,
    evidence: { ip: string | null; userAgent: string | null },
  ): Promise<ApplicationRow> {
    const accountNo = input.bankAccountNo.replace(/[^0-9]/g, '');
    if (accountNo.length < 6 || accountNo.length > 15) invalid('bankAccountNo', '6 to 15 digits');
    if (input.juristicType === 'individual' && input.isVatRegistered === undefined)
      input.isVatRegistered = false;
    const id = await this.prisma.withTx(async (tx) => {
      if (await tx.salesAgent.findUnique({ where: { userId: actor.userId } }))
        throw new DomainException('agents.already_agent');
      if (await tx.salesAgentApplication.findFirst({ where: { userId: actor.userId, status: 'submitted' } }))
        throw new DomainException('agents.application_open');
      const agreement = await this.agreementInForce(tx);
      if (!agreement) throw new DomainException('agents.agreement_missing');
      if (agreement.versionNo !== input.agreementVersionNo)
        throw new DomainException('agents.agreement_outdated', {
          params: { versionNo: agreement.versionNo },
        });
      const idDocument = await this.ownFile(tx, actor, input.idDocumentFileId, 'idDocumentFileId');
      const bankBook = input.bankBookFileId
        ? await this.ownFile(tx, actor, input.bankBookFileId, 'bankBookFileId')
        : null;
      const acceptedAt = new Date();
      const evidenceSha256 = createHash('sha256')
        .update(
          JSON.stringify({
            textSha256: Buffer.from(agreement.textSha256).toString('hex'),
            user: actor.publicId,
            acceptedAt: acceptedAt.toISOString(),
            ip: evidence.ip,
            userAgent: evidence.userAgent,
          }),
        )
        .digest();
      const row = await tx.salesAgentApplication.create({
        data: {
          userId: actor.userId,
          juristicType: input.juristicType,
          legalName: input.legalName.trim(),
          taxId: input.taxId,
          branchCode: input.branchCode ?? '00000',
          isVatRegistered: input.isVatRegistered ?? false,
          address: input.address.trim(),
          postcode: input.postcode,
          pitch: input.pitch?.trim() || null,
          idDocumentFileId: idDocument.id,
          bankCode: input.bankCode,
          bankBranchName: input.bankBranchName?.trim() || null,
          bankAccountName: input.bankAccountName.trim(),
          bankAccountNoEnc: this.encryption.encrypt(accountNo),
          bankAccountNoLast4: accountNo.slice(-4),
          bankBookFileId: bankBook?.id ?? null,
          agreementVersionId: agreement.id,
          agreementAcceptedAt: acceptedAt,
          agreementEvidenceSha256: evidenceSha256,
          ip: evidence.ip,
          userAgent: evidence.userAgent?.slice(0, 500) ?? null,
        },
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_application.submitted',
        aggregateType: 'sales_agent_application',
        aggregateId: row.publicId,
        payload: {
          applicationId: row.publicId,
          legalName: row.legalName,
          juristicType: row.juristicType,
          agreementVersionNo: agreement.versionNo,
        },
        actor,
      });
      return row.publicId;
    });
    return this.application(id);
  }

  async withdraw(actor: UserActor): Promise<ApplicationRow> {
    const id = await this.prisma.withTx(async (tx) => {
      const row = await tx.salesAgentApplication.findFirst({
        where: { userId: actor.userId, status: 'submitted' },
      });
      if (!row) throw new DomainException('http.not_found');
      await tx.salesAgentApplication.update({
        where: { id: row.id },
        data: { status: 'withdrawn', rowVersion: { increment: 1 } },
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_application.withdrawn',
        aggregateType: 'sales_agent_application',
        aggregateId: row.publicId,
        payload: { applicationId: row.publicId },
        actor,
      });
      return row.publicId;
    });
    return this.application(id);
  }

  async application(publicId: string, db: Tx = this.prisma): Promise<ApplicationRow> {
    const row = await db.salesAgentApplication.findUnique({
      where: { publicId },
      include: APPLICATION_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  applications(where: Prisma.SalesAgentApplicationWhereInput, page: number, perPage: number) {
    return Promise.all([
      this.prisma.salesAgentApplication.findMany({
        where,
        include: APPLICATION_INCLUDE,
        orderBy: { submittedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.salesAgentApplication.count({ where }),
    ]);
  }

  /** What Sales should look at before deciding (no blocking: the decision stays theirs). */
  async checks(row: ApplicationRow): Promise<string[]> {
    const out: string[] = [];
    const [agentTax, vendorTax, orders] = await Promise.all([
      this.prisma.salesAgent.count({ where: { taxId: row.taxId } }),
      this.prisma.vendor.count({ where: { taxId: row.taxId, kind: { not: 'sales_agent' } } }),
      this.prisma.orderGroup.count({ where: { customerUserId: row.userId, status: { not: 'cancelled' } } }),
    ]);
    if (agentTax + vendorTax > 0) out.push('tax_id_in_use');
    const fold = (v: string) => v.replace(/\s+/g, '').toLowerCase();
    if (fold(row.bankAccountName) !== fold(row.legalName)) out.push('name_mismatch');
    if (orders > 0) out.push('has_orders');
    return out;
  }

  async approve(actor: UserActor, publicId: string, input: { planId: string; note?: string | null }) {
    const agentId = await this.prisma.withTx(async (tx) => {
      const app = await tx.salesAgentApplication.findUnique({ where: { publicId } });
      if (!app) throw new DomainException('http.not_found');
      if (app.status !== 'submitted')
        throw new DomainException('agents.application_decided', { params: { status: app.status } });
      if (await tx.salesAgent.findUnique({ where: { userId: app.userId } }))
        throw new DomainException('agents.already_agent');
      const plan = await this.activePlan(tx, input.planId, 'freelance');
      const now = new Date();
      const rules = await this.settings.at('agents.rules', { at: now, tx });
      const vendor = await tx.vendor.create({
        data: {
          kind: 'sales_agent',
          legalName: app.legalName,
          juristicType: app.juristicType,
          taxId: app.taxId,
          branchCode: app.branchCode,
          isVatRegistered: app.isVatRegistered,
          addressLine1: app.address,
          postcode: app.postcode,
          defaultWhtCategory: app.juristicType === 'individual' ? 'commission' : 'service',
          paymentTermsDays: rules.value.paymentTermsDays,
          createdById: actor.userId,
        },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'vendor.created',
        actor,
        resourceType: 'vendor',
        resourcePublicId: vendor.publicId,
        data: { kind: 'sales_agent', legalName: app.legalName, applicationId: app.publicId },
      });
      const agent = await tx.salesAgent.create({
        data: {
          userId: app.userId,
          kind: 'freelance',
          code: await this.freeCode(tx),
          planId: plan.id,
          legalName: app.legalName,
          juristicType: app.juristicType,
          taxId: app.taxId,
          vendorId: vendor.id,
          applicationId: app.id,
          note: input.note?.trim() || null,
        },
      });
      await tx.salesAgentApplication.update({
        where: { id: app.id },
        data: {
          status: 'approved',
          decidedAt: now,
          decidedById: actor.userId,
          decisionReason: input.note?.trim() || null,
          rowVersion: { increment: 1 },
        },
      });
      await this.grantRole(tx, app.userId, actor, `agent application ${app.publicId} approved`);
      // The account number travels encrypted from the application to the vendor's dual-approved account (§8).
      await this.bankAccounts.proposeForVendorIn(tx, actor, vendor.id, {
        bankCode: app.bankCode,
        branchName: app.bankBranchName,
        accountName: app.bankAccountName,
        accountNo: this.encryption.decrypt(app.bankAccountNoEnc),
      });
      const user = await tx.user.findUniqueOrThrow({ where: { id: app.userId }, select: { publicId: true } });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_application.approved',
        aggregateType: 'sales_agent_application',
        aggregateId: app.publicId,
        payload: {
          applicationId: app.publicId,
          agentId: agent.publicId,
          code: agent.code,
          customerId: user.publicId,
        },
        actor,
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent.created',
        aggregateType: 'sales_agent',
        aggregateId: agent.publicId,
        payload: { agentId: agent.publicId, kind: 'freelance', plan: plan.code, vendorId: vendor.publicId },
        actor,
      });
      return agent.publicId;
    });
    // The new role (agent.self) applies at once, not after the permission cache expires.
    const created = await this.agent(agentId);
    await this.permissions.invalidate(created.userId);
    return created;
  }

  async reject(actor: UserActor, publicId: string, reason: string): Promise<ApplicationRow> {
    await this.prisma.withTx(async (tx) => {
      const app = await tx.salesAgentApplication.findUnique({ where: { publicId } });
      if (!app) throw new DomainException('http.not_found');
      if (app.status !== 'submitted')
        throw new DomainException('agents.application_decided', { params: { status: app.status } });
      await tx.salesAgentApplication.update({
        where: { id: app.id },
        data: {
          status: 'rejected',
          decidedAt: new Date(),
          decidedById: actor.userId,
          decisionReason: reason.trim(),
          rowVersion: { increment: 1 },
        },
      });
      const user = await tx.user.findUniqueOrThrow({ where: { id: app.userId }, select: { publicId: true } });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_application.rejected',
        aggregateType: 'sales_agent_application',
        aggregateId: app.publicId,
        payload: { applicationId: app.publicId, reason: reason.trim(), customerId: user.publicId },
        actor,
      });
    });
    return this.application(publicId);
  }

  // --- agents --------------------------------------------------------------------------------------------

  async agent(publicId: string, db: Tx = this.prisma): Promise<AgentRow> {
    const row = await db.salesAgent.findUnique({ where: { publicId }, include: AGENT_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  /** The signed-in customer's agent profile (`agent.self`). */
  async mine(userId: bigint): Promise<AgentRow> {
    const row = await this.prisma.salesAgent.findUnique({ where: { userId }, include: AGENT_INCLUDE });
    if (!row) throw new DomainException('agents.not_agent');
    return row;
  }

  agents(where: Prisma.SalesAgentWhereInput, page: number, perPage: number) {
    return Promise.all([
      this.prisma.salesAgent.findMany({
        where,
        include: AGENT_INCLUDE,
        orderBy: { joinedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.salesAgent.count({ where }),
    ]);
  }

  /** The terms of an agent's plan in force now. */
  async termsNow(planId: bigint) {
    return termsOf(await planVersionAt(this.prisma, planId, new Date()));
  }

  /** The money and counts an agent's pages lead with. */
  async totals(agentId: bigint) {
    const yearStart = startOfBangkokDay(`${new Date().toISOString().slice(0, 4)}-01-01`);
    const [byStatus, paid, links, leads, factories] = await Promise.all([
      this.prisma.salesAgentCommission.groupBy({
        by: ['status'],
        where: { agentId },
        _sum: { amount: true },
      }),
      this.prisma.salesAgentStatement.aggregate({
        where: { agentId, status: 'paid', paidAt: { gte: yearStart } },
        _sum: { totalAmount: true },
      }),
      this.prisma.salesAgentLink.count({ where: { agentId, status: 'active' } }),
      this.prisma.salesAgentLead.count({ where: { agentId, status: 'registered' } }),
      this.prisma.salesAgentFactoryLink.count({
        where: { agentId, status: { in: ['pending', 'qualified'] } },
      }),
    ]);
    const sum = (status: string) =>
      formatMoney(D(byStatus.find((b) => b.status === status)?._sum.amount ?? ZERO()));
    return {
      pending: sum('pending'),
      held: sum('held'),
      earned: sum('earned'),
      statemented: sum('statemented'),
      paidThisYear: formatMoney(D(paid._sum.totalAmount ?? ZERO())),
      activeLinks: links,
      openLeads: leads,
      factories,
    };
  }

  async createEmployee(
    actor: UserActor,
    input: {
      customerId: string;
      legalName: string;
      employeeCode: string;
      staffUserId?: string | null;
      planId: string;
    },
  ): Promise<AgentRow> {
    const id = await this.prisma.withTx(async (tx) => {
      const user = await tx.user.findUnique({ where: { publicId: input.customerId } });
      if (!user || user.kind !== 'customer') invalid('customerId', 'a customer account', 'customer');
      if (await tx.salesAgent.findUnique({ where: { userId: user.id } }))
        throw new DomainException('agents.already_agent');
      const staff = input.staffUserId
        ? await tx.user.findUnique({ where: { publicId: input.staffUserId } })
        : null;
      if (input.staffUserId && (!staff || staff.kind !== 'staff'))
        invalid('staffUserId', 'a staff account', 'staff');
      const plan = await this.activePlan(tx, input.planId, 'employee');
      const agent = await tx.salesAgent.create({
        data: {
          userId: user.id,
          kind: 'employee',
          code: await this.freeCode(tx),
          planId: plan.id,
          legalName: input.legalName.trim(),
          employeeCode: input.employeeCode.trim(),
          staffUserId: staff?.id ?? null,
        },
      });
      await this.grantRole(tx, user.id, actor, `employee agent ${agent.publicId}`);
      await this.audit.record(tx, {
        category: 'iam',
        action: 'sales_agent.create_employee',
        actor,
        resourceType: 'sales_agent',
        resourcePublicId: agent.publicId,
        data: { employeeCode: agent.employeeCode, plan: plan.code },
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent.created',
        aggregateType: 'sales_agent',
        aggregateId: agent.publicId,
        payload: { agentId: agent.publicId, kind: 'employee', plan: plan.code },
        actor,
      });
      return agent.publicId;
    });
    const created = await this.agent(id);
    await this.permissions.invalidate(created.userId);
    return created;
  }

  async update(
    actor: UserActor,
    publicId: string,
    ifMatch: string | undefined,
    input: { planId?: string; note?: string | null; employeeCode?: string | null; reason?: string | null },
  ): Promise<AgentRow> {
    await this.prisma.withTx(async (tx) => {
      const agent = await tx.salesAgent.findUnique({ where: { publicId } });
      if (!agent) throw new DomainException('http.not_found');
      assertIfMatch(ifMatch, agentEtag(agent), { required: true });
      const data: Prisma.SalesAgentUncheckedUpdateInput = { rowVersion: { increment: 1 } };
      const changes: Record<string, unknown> = {};
      if (input.planId) {
        const plan = await this.activePlan(tx, input.planId, agent.kind);
        if (plan.id !== agent.planId) {
          if (!input.reason?.trim()) invalid('reason', 'a plan change needs a reason', 'required');
          data.planId = plan.id;
          changes['plan'] = plan.code;
        }
      }
      if (input.note !== undefined) data.note = input.note?.trim() || null;
      if (input.employeeCode !== undefined) {
        if (agent.kind !== 'employee') invalid('employeeCode', 'employees only');
        if (!input.employeeCode?.trim()) invalid('employeeCode', 'required for an employee', 'required');
        data.employeeCode = input.employeeCode.trim();
        changes['employeeCode'] = data.employeeCode;
      }
      await tx.salesAgent.update({ where: { id: agent.id }, data });
      if (Object.keys(changes).length) {
        await this.audit.record(tx, {
          category: 'config',
          action: 'sales_agent.update',
          actor,
          resourceType: 'sales_agent',
          resourcePublicId: agent.publicId,
          data: { ...changes, reason: input.reason ?? null },
        });
        await recordAgentEvent(this, tx, {
          type: 'sales_agent.updated',
          aggregateType: 'sales_agent',
          aggregateId: agent.publicId,
          payload: { agentId: agent.publicId, ...changes, reason: input.reason ?? null },
          actor,
        });
      }
    });
    return this.agent(publicId);
  }

  /** Suspend (no new links or leads; accrued commission still paid), reactivate or end (links end). */
  async setStatus(
    actor: UserActor,
    publicId: string,
    to: 'suspended' | 'active' | 'ended',
    reason: string,
  ): Promise<AgentRow> {
    await this.prisma.withTx(async (tx) => {
      const agent = await tx.salesAgent.findUnique({ where: { publicId } });
      if (!agent) throw new DomainException('http.not_found');
      const allowed: Record<string, string[]> = {
        suspended: ['active'],
        active: ['suspended'],
        ended: ['active', 'suspended'],
      };
      if (!allowed[to]!.includes(agent.status))
        throw new DomainException('agents.invalid_status', { params: { status: agent.status } });
      const now = new Date();
      await tx.salesAgent.update({
        where: { id: agent.id },
        data: {
          status: to,
          statusReason: to === 'active' ? null : reason.trim(),
          ...(to === 'suspended' && { suspendedAt: now }),
          ...(to === 'active' && { suspendedAt: null }),
          ...(to === 'ended' && { endedAt: now }),
          rowVersion: { increment: 1 },
        },
      });
      if (to === 'ended') {
        await tx.salesAgentLink.updateMany({
          where: { agentId: agent.id, status: 'active' },
          data: { status: 'ended', endedAt: now, endedReason: 'agent_ended' },
        });
        await tx.salesAgentLead.updateMany({
          where: { agentId: agent.id, status: 'registered' },
          data: { status: 'expired', closedReason: 'agent_ended' },
        });
        await tx.salesAgentFactoryLink.updateMany({
          where: { agentId: agent.id, status: 'pending' },
          data: { status: 'ended', closedAt: now, reason: 'agent_ended' },
        });
      }
      await this.audit.record(tx, {
        category: 'iam',
        action: `sales_agent.${to === 'active' ? 'reactivate' : to === 'ended' ? 'end' : 'suspend'}`,
        actor,
        resourceType: 'sales_agent',
        resourcePublicId: agent.publicId,
        data: { from: agent.status, to, reason },
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent.status_changed',
        aggregateType: 'sales_agent',
        aggregateId: agent.publicId,
        payload: { agentId: agent.publicId, from: agent.status, to, reason },
        actor,
      });
    });
    return this.agent(publicId);
  }

  // --- plans (D-418) ----------------------------------------------------------------------------------------

  plans() {
    return this.prisma.salesAgentPlan.findMany({ include: PLAN_INCLUDE, orderBy: { code: 'asc' } });
  }

  /** Who drafted and decided plan versions (the ids are kept without a foreign key, D-418). */
  async planPeople(plans: PlanRow[]): Promise<Map<bigint, { publicId: string; displayName: string }>> {
    const ids = [
      ...new Set(
        plans
          .flatMap((p) => p.versions.flatMap((v) => [v.createdById, v.decidedById]))
          .filter((v) => v !== null),
      ),
    ] as bigint[];
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, publicId: true, displayName: true },
        })
      : [];
    return new Map(users.map((u) => [u.id, { publicId: u.publicId, displayName: u.displayName }]));
  }

  async plan(publicId: string, db: Tx = this.prisma): Promise<PlanRow> {
    const row = await db.salesAgentPlan.findUnique({ where: { publicId }, include: PLAN_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async createPlan(
    actor: UserActor,
    input: {
      code: string;
      nameTh: string;
      nameEn?: string | null;
      description?: string | null;
      agentKind: 'freelance' | 'employee';
      reason: string;
    } & TermsInput,
  ): Promise<PlanRow> {
    this.checkTerms(input);
    const id = await this.prisma.withTx(async (tx) => {
      if (await tx.salesAgentPlan.findUnique({ where: { code: input.code } }))
        throw new DomainException('agents.plan_code_taken', { params: { code: input.code } });
      const plan = await tx.salesAgentPlan.create({
        data: {
          code: input.code,
          nameTh: input.nameTh.trim(),
          nameEn: input.nameEn?.trim() || null,
          description: input.description?.trim() || null,
          agentKind: input.agentKind,
          versions: {
            create: {
              versionNo: 1,
              effectiveFrom: new Date(),
              status: 'draft',
              ...this.termsData(input),
              reason: input.reason.trim(),
              createdById: actor.userId,
            },
          },
        },
      });
      await this.audit.record(tx, {
        category: 'config',
        action: 'sales_agent_plan.create',
        actor,
        resourceType: 'sales_agent_plan',
        resourcePublicId: plan.publicId,
        data: { code: plan.code },
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_plan.created',
        aggregateType: 'sales_agent_plan',
        aggregateId: plan.publicId,
        payload: { planId: plan.publicId, code: plan.code },
        actor,
      });
      return plan.publicId;
    });
    return this.plan(id);
  }

  async draftVersion(
    actor: UserActor,
    planPublicId: string,
    input: { effectiveFrom: string; reason: string } & TermsInput,
  ): Promise<PlanRow> {
    this.checkTerms(input);
    const effectiveFrom = new Date(input.effectiveFrom);
    if (Number.isNaN(effectiveFrom.getTime())) invalid('effectiveFrom', 'a date-time', 'date');
    if (effectiveFrom.getTime() < Date.now() - 60_000) throw new DomainException('agents.backdated');
    await this.prisma.withTx(async (tx) => {
      const plan = await tx.salesAgentPlan.findUnique({ where: { publicId: planPublicId } });
      if (!plan || plan.retiredAt) throw new DomainException('http.not_found');
      if (await tx.salesAgentPlanVersion.count({ where: { planId: plan.id, status: 'draft' } }))
        throw new DomainException('agents.plan_draft_open');
      const last = await tx.salesAgentPlanVersion.findFirst({
        where: { planId: plan.id },
        orderBy: { versionNo: 'desc' },
      });
      const version = await tx.salesAgentPlanVersion.create({
        data: {
          planId: plan.id,
          versionNo: (last?.versionNo ?? 0) + 1,
          effectiveFrom,
          status: 'draft',
          ...this.termsData(input),
          reason: input.reason.trim(),
          createdById: actor.userId,
        },
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_plan.version_drafted',
        aggregateType: 'sales_agent_plan',
        aggregateId: plan.publicId,
        payload: { planId: plan.publicId, versionNo: version.versionNo, effectiveFrom: input.effectiveFrom },
        actor,
      });
    });
    return this.plan(planPublicId);
  }

  /** Maker-checker: someone other than the drafter approves or rejects (D-418). */
  async decideVersion(
    actor: UserActor,
    versionPublicId: string,
    input: { decision: 'approve' | 'reject'; note?: string | null },
  ): Promise<PlanRow> {
    const planId = await this.prisma.withTx(async (tx) => {
      const version = await tx.salesAgentPlanVersion.findUnique({
        where: { publicId: versionPublicId },
        include: { plan: true },
      });
      if (!version) throw new DomainException('http.not_found');
      if (version.status !== 'draft')
        throw new DomainException('agents.plan_version_decided', { params: { status: version.status } });
      if (version.createdById === actor.userId) throw new DomainException('agents.maker_checker');
      const now = new Date();
      // A version approved after its start date applies from the approval, never backwards.
      const effectiveFrom = version.effectiveFrom < now ? now : version.effectiveFrom;
      await tx.salesAgentPlanVersion.update({
        where: { id: version.id },
        data: {
          status: input.decision === 'approve' ? 'approved' : 'rejected',
          effectiveFrom,
          decidedAt: now,
          decidedById: actor.userId,
          decisionNote: input.note?.trim() || null,
        },
      });
      await this.audit.record(tx, {
        category: 'approval',
        action: `sales_agent_plan.version_${input.decision === 'approve' ? 'approved' : 'rejected'}`,
        actor,
        resourceType: 'sales_agent_plan',
        resourcePublicId: version.plan.publicId,
        data: { versionNo: version.versionNo, effectiveFrom: effectiveFrom.toISOString() },
      });
      await recordAgentEvent(this, tx, {
        type: `sales_agent_plan.version_${input.decision === 'approve' ? 'approved' : 'rejected'}`,
        aggregateType: 'sales_agent_plan',
        aggregateId: version.plan.publicId,
        payload: { planId: version.plan.publicId, versionNo: version.versionNo },
        actor,
      });
      return version.plan.publicId;
    });
    return this.plan(planId);
  }

  async retirePlan(actor: UserActor, publicId: string, reason: string): Promise<PlanRow> {
    await this.prisma.withTx(async (tx) => {
      const plan = await tx.salesAgentPlan.findUnique({ where: { publicId } });
      if (!plan || plan.retiredAt) throw new DomainException('http.not_found');
      if (await tx.salesAgent.count({ where: { planId: plan.id, status: { not: 'ended' } } }))
        throw new DomainException('agents.plan_in_use');
      await tx.salesAgentPlan.update({
        where: { id: plan.id },
        data: { retiredAt: new Date(), rowVersion: { increment: 1 } },
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_plan.retired',
        aggregateType: 'sales_agent_plan',
        aggregateId: plan.publicId,
        payload: { planId: plan.publicId, reason },
        actor,
      });
    });
    return this.plan(publicId);
  }

  // --- helpers ---------------------------------------------------------------------------------------------

  private async activePlan(tx: Tx, publicId: string, kind: 'freelance' | 'employee') {
    const plan = await tx.salesAgentPlan.findUnique({ where: { publicId } });
    if (!plan || plan.retiredAt) invalid('planId', 'an active plan', 'plan');
    if (plan.agentKind !== kind) invalid('planId', `a ${kind} plan`, 'plan_kind');
    if (!(await planVersionAt(tx, plan.id, new Date())))
      throw new DomainException('agents.plan_not_in_force');
    return plan;
  }

  private async freeCode(tx: Tx): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = newAgentCode();
      if (!(await tx.salesAgent.findUnique({ where: { code } }))) return code;
    }
    throw new Error('could not allocate an agent code');
  }

  private async grantRole(tx: Tx, userId: bigint, actor: UserActor, reason: string) {
    const role = await tx.role.findUniqueOrThrow({ where: { key: ROLE_KEY } });
    const held = await tx.userRole.findFirst({ where: { userId, roleId: role.id, revokedAt: null } });
    if (held) return;
    await tx.userRole.create({
      data: { userId, roleId: role.id, scopeType: 'platform', grantedById: actor.userId, reason },
    });
  }

  private async ownFile(tx: Tx, actor: UserActor, publicId: string, path: string) {
    const file = await tx.fileObject.findUnique({ where: { publicId } });
    if (
      !file ||
      file.ownerUserId !== actor.userId ||
      file.uploadStatus !== 'uploaded' ||
      file.scanStatus === 'infected'
    )
      invalid(path, 'not an uploaded file of yours', 'fileReady');
    return file;
  }

  private checkTerms(t: TermsInput) {
    for (const key of ['firstOrderPct', 'repeatOrderPct', 'marginCapPct'] as const)
      if (D(t[key]).gt(100)) invalid(key, 'at most 100', 'max');
    if (D(t.repeatOrderPct).gt(t.firstOrderPct))
      invalid('repeatOrderPct', 'not more than the first-order rate', 'order');
    if (D(t.factoryBountyAmount).gt(0) && (t.factoryQualifyJobs < 1 || t.factoryQualifyDays < 1))
      invalid('factoryQualifyJobs', 'a bounty needs qualifying jobs and days', 'bounty');
  }

  private termsData(t: TermsInput) {
    return {
      firstOrderPct: t.firstOrderPct,
      repeatOrderPct: t.repeatOrderPct,
      attributionMonths: t.attributionMonths,
      marginCapPct: t.marginCapPct,
      minBaseAmount: t.minBaseAmount,
      factoryBountyAmount: t.factoryBountyAmount,
      factoryQualifyJobs: t.factoryQualifyJobs,
      factoryQualifyDays: t.factoryQualifyDays,
    };
  }
}

export interface TermsInput {
  firstOrderPct: string;
  repeatOrderPct: string;
  attributionMonths: number;
  marginCapPct: string;
  minBaseAmount: string;
  factoryBountyAmount: string;
  factoryQualifyJobs: number;
  factoryQualifyDays: number;
}
