import { RequestContext } from '@common/context/request-context';
import { DomainException } from '@common/errors/domain.exception';
import { type ErrorCode } from '@common/errors/error-codes';
import { PrismaService } from '@database/prisma.service';
import { type SalesAgentStatus } from '@generated/prisma/client';
import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SettingsService } from '@platform/settings/settings.service';

export const AGENT_ACCESS = 'getpack:agent-access';

/**
 * Who may call a `/v1/store/agent/*` handler (D-467):
 * - `anyone`: any signed-in customer (or the public, where `@Public()`): used before becoming an agent;
 * - `agent` (default): a sales agent whose status is active or suspended;
 * - `records`: as `agent`, and an ENDED agent too for `agents.ended_record_access_years` after `endedAt`
 *   (statements and their 50 ทวิ — tax record retention). Read-only handlers only.
 */
export type AgentAccessLevel = 'anyone' | 'agent' | 'records';

export const AgentAccess = (level: AgentAccessLevel) => SetMetadata(AGENT_ACCESS, level);

/** Pure rule of the guard (unit-tested). `null` = allowed; else the neutral refusal. */
export function agentAccessRefusal(
  level: AgentAccessLevel,
  agent: { status: SalesAgentStatus; endedAt: Date | null } | null,
  now: Date,
  recordYears: number,
): ErrorCode | null {
  if (level === 'anyone') return null;
  if (!agent) return 'agents.not_agent';
  if (agent.status === 'active' || agent.status === 'suspended') return null;
  if (level === 'records' && agent.endedAt) {
    const until = new Date(agent.endedAt);
    until.setUTCFullYear(until.getUTCFullYear() + recordYears);
    if (now < until) return null;
  }
  return 'agents.ended';
}

/**
 * D-467: every handler of the store agent controllers passes through this guard (after authentication and
 * `@Can`). The agent zone (agent.getpack.co) and the storefront's agent pages share these endpoints.
 */
@Injectable()
export class AgentZoneGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const level =
      this.reflector.getAllAndOverride<AgentAccessLevel | undefined>(AGENT_ACCESS, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'agent';
    if (level === 'anyone') return true;
    const actor = RequestContext.actor();
    if (!actor) throw new DomainException('auth.unauthenticated');
    if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
    const agent = await this.prisma.salesAgent.findUnique({
      where: { userId: actor.userId },
      select: { status: true, endedAt: true },
    });
    const now = new Date();
    const years =
      agent?.status === 'ended' && level === 'records'
        ? await this.settings.value('agents.ended_record_access_years', now)
        : 0;
    const refusal = agentAccessRefusal(level, agent, now, years);
    if (refusal) throw new DomainException(refusal);
    return true;
  }
}
