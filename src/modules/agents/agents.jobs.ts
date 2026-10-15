import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { AgentAttributionService } from './agent-attribution.service';
import { AgentCommissionsService } from './agent-commissions.service';
import { AgentStatementsService } from './agent-statements.service';

/** The sales agent programme's housekeeping in the worker (D-417 – D-420). */
@Injectable()
export class AgentsJobs {
  constructor(
    private readonly attribution: AgentAttributionService,
    private readonly commissions: AgentCommissionsService,
    private readonly statements: AgentStatementsService,
  ) {}

  /** Pending commission past the claim window, with the group paid, becomes earned (D-418). */
  @ScheduledJob({ name: 'agents.earn', every: 3_600_000 })
  earn(): Promise<number> {
    return this.commissions.earnDue();
  }

  /** Factory links: bounty earned on the qualifying jobs, or expired after the window (D-419). */
  @ScheduledJob({ name: 'agents.factory_bounties', every: 86_400_000 })
  factoryBounties(): Promise<number> {
    return this.commissions.settleFactoryLinks();
  }

  /** Leads past their protection expire; links past their attribution months end (D-417). */
  @ScheduledJob({ name: 'agents.expire', every: 3_600_000 })
  async expire(): Promise<number> {
    return (await this.attribution.expireLeads()) + (await this.attribution.endExpiredLinks());
  }

  /** On the 1st, 03:00 Bangkok: last month's statements (D-420). */
  @ScheduledJob({ name: 'agents.statements', cron: '0 3 1 * *' })
  async statementsJob(): Promise<number> {
    return (await this.statements.generate(this.statements.previousPeriod())).created;
  }
}
