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

  /**
   * D-464 / P-03: the factory referral bounty is retired — the factory-qualification job no longer runs
   * (`agents.factory_bounties` removed). Pending links were ended once by `pnpm agents:retire-bounty`.
   */

  /** D-464: commission ÷ gross margin KPI of last month and this month, daily 03:30 (worker timezone). */
  @ScheduledJob({ name: 'agents.margin_kpi', cron: '30 3 * * *' })
  async marginKpi(): Promise<number> {
    const now = new Date();
    const thisMonth = new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 7);
    await this.commissions.computeMarginKpi(this.statements.previousPeriod(now));
    await this.commissions.computeMarginKpi(thisMonth);
    return 2;
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
