import { type Actor } from '@common/context/actor';
import { PrismaService } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { D, planVersionAt, recordAgentEvent } from './agent-shared';

export const BOUNTY_RETIRED_REASON = 'programme_change_P03';
const VERSION_REASON =
  'P-03 / D-464: factory referral bounty retired (owner 2026-11-01); other terms unchanged';

export interface BountyRetirementPlan {
  pendingFactoryLinks: { id: string; agentCode: string; linkedAt: string }[];
  plansWithBounty: { code: string; versionNo: number; bounty: string }[];
}

/**
 * One-off data job for P-03 (D-464): pending factory links end with reason `programme_change_P03`, and every plan whose
 * version in force still carries a bounty gets a new approved version with the bounty, jobs and days at 0 (other terms
 * copied). Dry run first (`plan`), idempotent (a second run finds nothing), audited, no destructive change — history
 * (old versions, qualified links, bounty entries) stays readable.
 */
@Injectable()
export class AgentBountyRetirementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    readonly events: DomainEvents,
    readonly activity: ActivityLogService,
  ) {}

  async plan(now = new Date()): Promise<BountyRetirementPlan> {
    const links = await this.prisma.salesAgentFactoryLink.findMany({
      where: { status: 'pending' },
      include: { agent: { select: { code: true } } },
      orderBy: { id: 'asc' },
    });
    const plans = await this.prisma.salesAgentPlan.findMany({ orderBy: { code: 'asc' } });
    const plansWithBounty: BountyRetirementPlan['plansWithBounty'] = [];
    for (const p of plans) {
      const v = await planVersionAt(this.prisma, p.id, now);
      if (v && D(v.factoryBountyAmount).gt(0))
        plansWithBounty.push({
          code: p.code,
          versionNo: v.versionNo,
          bounty: v.factoryBountyAmount.toFixed(2),
        });
    }
    return {
      pendingFactoryLinks: links.map((l) => ({
        id: l.publicId,
        agentCode: l.agent.code,
        linkedAt: l.linkedAt.toISOString(),
      })),
      plansWithBounty,
    };
  }

  async apply(actor: Actor, now = new Date()): Promise<{ linksEnded: number; versionsAdded: number }> {
    return this.prisma.withTx(async (tx) => {
      let linksEnded = 0;
      const links = await tx.salesAgentFactoryLink.findMany({ where: { status: 'pending' } });
      for (const link of links) {
        await tx.salesAgentFactoryLink.update({
          where: { id: link.id },
          data: { status: 'ended', closedAt: now, reason: BOUNTY_RETIRED_REASON },
        });
        await recordAgentEvent(this, tx, {
          type: 'sales_agent_factory_link.ended',
          aggregateType: 'sales_agent_factory_link',
          aggregateId: link.publicId,
          payload: { factoryLinkId: link.publicId, reason: BOUNTY_RETIRED_REASON },
          actor,
        });
        linksEnded += 1;
      }
      let versionsAdded = 0;
      for (const plan of await tx.salesAgentPlan.findMany()) {
        const v = await planVersionAt(tx, plan.id, now);
        if (!v || !D(v.factoryBountyAmount).gt(0)) continue;
        const last = await tx.salesAgentPlanVersion.findFirst({
          where: { planId: plan.id },
          orderBy: { versionNo: 'desc' },
        });
        const created = await tx.salesAgentPlanVersion.create({
          data: {
            planId: plan.id,
            versionNo: (last?.versionNo ?? 0) + 1,
            effectiveFrom: now,
            status: 'approved',
            firstOrderPct: v.firstOrderPct,
            repeatOrderPct: v.repeatOrderPct,
            attributionMonths: v.attributionMonths,
            marginCapPct: v.marginCapPct,
            minBaseAmount: v.minBaseAmount,
            factoryBountyAmount: '0.00',
            factoryQualifyJobs: 0,
            factoryQualifyDays: 0,
            reason: VERSION_REASON,
            decidedAt: now,
            decisionNote: 'Owner decision P-03 / D-464 applied by data job',
          },
        });
        await this.audit.record(tx, {
          category: 'approval',
          action: 'sales_agent_plan.bounty_retired',
          actor,
          resourceType: 'sales_agent_plan',
          resourcePublicId: plan.publicId,
          data: { fromVersion: v.versionNo, versionNo: created.versionNo, decision: 'D-464' },
        });
        versionsAdded += 1;
      }
      return { linksEnded, versionsAdded };
    });
  }
}
