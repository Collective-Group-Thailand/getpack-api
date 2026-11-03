import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import { type SalesAgent } from '@generated/prisma/client';
import { LEAD_INCLUDE, type LeadRow } from '@modules/agents/agent-attribution.service';
import { permissionsOf } from '@modules/iam/actor-permissions';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';

/** Who is working the sales desk and how far they reach (D-469, PLAN A-07). */
export interface SalesScope {
  actor: UserActor;
  /** `sales.pipeline.manage`: every rep's pipeline, the inbound pool, the dashboard. */
  manage: boolean;
  /** `sales.pipeline.self`: one's own employee agent. */
  self: boolean;
  /** The caller's own employee agent (kind `employee`, `staffUserId` = the caller), if any. */
  ownAgent: SalesAgent | null;
  permissions: ReadonlySet<string>;
}

export function staffActor(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

/**
 * D-469: company sales reps are agents of kind `employee` working from the admin zone with their staff account
 * (`sales_agents.staff_user_id`). A rep (`sales.pipeline.self`) reaches only their own employee agent's leads; a
 * manager (`sales.pipeline.manage`, Superadmin included) reaches every rep's, and changes to someone else's lead are
 * audited (`sales_lead.acted_for`). Freelance agents' leads stay theirs: staff read them, never change them.
 */
@Injectable()
export class SalesScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PermissionResolver,
    private readonly audit: AuditService,
  ) {}

  async of(actor: Actor): Promise<SalesScope> {
    const me = staffActor(actor);
    const permissions = await permissionsOf(this.resolver, me);
    const manage = permissions.has('sales.pipeline.manage');
    const self = permissions.has('sales.pipeline.self');
    if (!manage && !self) throw new DomainException('auth.forbidden');
    const ownAgent = await this.prisma.salesAgent.findFirst({
      where: { staffUserId: me.userId, kind: 'employee', status: { not: 'ended' } },
      orderBy: { id: 'desc' },
    });
    return { actor: me, manage, self, ownAgent, permissions };
  }

  /** The caller's own employee agent, active (a rep's writes go through it). */
  own(scope: SalesScope): SalesAgent {
    if (!scope.ownAgent || scope.ownAgent.status !== 'active')
      throw new DomainException('sales.no_employee_agent');
    return scope.ownAgent;
  }

  /** An employee agent a manager names (create on a rep's behalf), else the caller's own. */
  async agentFor(scope: SalesScope, agentPublicId: string | undefined): Promise<SalesAgent> {
    if (!agentPublicId || agentPublicId === scope.ownAgent?.publicId) return this.own(scope);
    if (!scope.manage) throw new DomainException('auth.forbidden');
    const agent = await this.prisma.salesAgent.findUnique({ where: { publicId: agentPublicId } });
    if (!agent) throw new DomainException('http.not_found');
    if (agent.kind !== 'employee') throw new DomainException('sales.lead_read_only');
    if (agent.status !== 'active') throw new DomainException('agents.agent_inactive');
    return agent;
  }

  /**
   * A lead the caller may see (404 otherwise, no existence oracle) with its agent. `write` refuses a freelance
   * agent's lead (`sales.lead_read_only`) and audits a manager acting on another rep's lead.
   */
  async lead(
    scope: SalesScope,
    leadPublicId: string,
    options: { write?: boolean; action?: string } = {},
  ): Promise<{ lead: LeadRow; agent: SalesAgent }> {
    const lead = await this.prisma.salesAgentLead.findUnique({
      where: { publicId: leadPublicId },
      include: LEAD_INCLUDE,
    });
    if (!lead || lead.kind !== 'customer') throw new DomainException('http.not_found');
    const own = scope.ownAgent !== null && lead.agentId === scope.ownAgent.id;
    if (!own && !scope.manage) throw new DomainException('http.not_found');
    const agent = await this.prisma.salesAgent.findUniqueOrThrow({ where: { id: lead.agentId } });
    if (options.write) {
      if (agent.kind !== 'employee') throw new DomainException('sales.lead_read_only');
      if (!own)
        await this.audit.recordStandalone({
          category: 'data_access',
          action: 'sales_lead.acted_for',
          actor: scope.actor,
          resourceType: 'sales_agent_lead',
          resourcePublicId: lead.publicId,
          data: { agentId: agent.publicId, action: options.action ?? 'update' },
        });
    }
    return { lead, agent };
  }

  /** Where-clause of the leads the caller may list. */
  leadWhere(scope: SalesScope, filter: { agentId?: string; agentKind?: 'employee' | 'freelance' }) {
    if (!scope.manage) return { agentId: scope.ownAgent?.id ?? BigInt(-1) };
    return {
      agent: {
        ...(filter.agentId && { publicId: filter.agentId }),
        kind: filter.agentKind ?? ('employee' as const),
      },
    };
  }
}
