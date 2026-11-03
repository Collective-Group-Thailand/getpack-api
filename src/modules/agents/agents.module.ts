import { Global, Module } from '@nestjs/common';

import { AgentAttributionService } from './agent-attribution.service';
import { AgentBountyRetirementService } from './agent-bounty-retirement.service';
import { AgentCommissionsService } from './agent-commissions.service';
import { AgentDealsService } from './agent-deals.service';
import { AgentDiscountsService } from './agent-discounts.service';
import { AgentLeadsService } from './agent-leads.service';
import { AgentNotificationPreferencesService } from './agent-notification-preferences.service';
import { AgentPayoutProfilesService } from './agent-payout-profiles.service';
import { AgentQuotesService } from './agent-quotes.service';
import { AgentStatementsService } from './agent-statements.service';
import { AgentTaxDeclarationsService } from './agent-tax-declarations.service';
import { AgentsJobs } from './agents.jobs';
import { AgentsService } from './agents.service';
import { AgentPlaybookService } from './agents-playbook';

const SERVICES = [
  AgentsService,
  AgentAttributionService,
  AgentCommissionsService,
  AgentStatementsService,
  AgentBountyRetirementService,
  AgentTaxDeclarationsService,
  AgentPayoutProfilesService,
  AgentNotificationPreferencesService,
  AgentLeadsService,
  AgentQuotesService,
  AgentDiscountsService,
  AgentDealsService,
  AgentPlaybookService,
];

/** The sales agent programme (D-416 – D-423): applications, agents, links, leads, commission, statements. */
@Global()
@Module({
  providers: [...SERVICES, AgentsJobs],
  exports: SERVICES,
})
export class AgentsModule {}
