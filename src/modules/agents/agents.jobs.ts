import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { AgentAttributionService } from './agent-attribution.service';
import { AgentCardScanService } from './agent-card-scan.service';
import { AgentCommissionsService } from './agent-commissions.service';
import { AgentDealsService } from './agent-deals.service';
import { AgentLeadsService } from './agent-leads.service';
import { AgentStatementsService } from './agent-statements.service';

/** The sales agent programme's housekeeping in the worker (D-417 – D-420). */
@Injectable()
export class AgentsJobs {
  constructor(
    private readonly attribution: AgentAttributionService,
    private readonly commissions: AgentCommissionsService,
    private readonly statements: AgentStatementsService,
    private readonly leads: AgentLeadsService,
    private readonly deals: AgentDealsService,
    private readonly cards: AgentCardScanService,
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

  /** D-467: tell agents once when a lead's protection ends in 7 days and once within a day. */
  @ScheduledJob({ name: 'agents.protection_reminders', every: 3_600_000 })
  protectionReminders(): Promise<number> {
    return this.attribution.remindProtectionEnding();
  }

  /** D-468: follow-up reminders at the time the agent set, never in the quiet hours (21:00–08:00 Bangkok). */
  @ScheduledJob({ name: 'agents.follow_ups', every: 600_000 })
  followUps(): Promise<number> {
    return this.leads.remindFollowUps();
  }

  /** D-468: CSV import dry runs older than 24 h lose their contact data (PDPA). */
  @ScheduledJob({ name: 'agents.lead_imports', every: 3_600_000 })
  leadImports(): Promise<number> {
    return this.leads.expireImports();
  }

  /** D-468: deal registrations past their protection expire (the locks of orders already placed stay). */
  @ScheduledJob({ name: 'agents.deal_expiry', every: 3_600_000 })
  dealExpiry(): Promise<number> {
    return this.deals.expireDue();
  }

  /** D-468: business-card photos are deleted after `agents.card_scan_retention_days` (PDPA), daily 03:50. */
  @ScheduledJob({ name: 'agents.card_scan_purge', cron: '50 3 * * *' })
  cardScanPurge(): Promise<number> {
    return this.cards.purge();
  }

  /** On the 1st, 03:00 Bangkok: last month's statements (D-420). */
  @ScheduledJob({ name: 'agents.statements', cron: '0 3 1 * *' })
  async statementsJob(): Promise<number> {
    return (await this.statements.generate(this.statements.previousPeriod())).created;
  }
}
