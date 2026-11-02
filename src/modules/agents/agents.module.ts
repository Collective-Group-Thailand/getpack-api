import { Global, Module } from '@nestjs/common';

import { AgentAttributionService } from './agent-attribution.service';
import { AgentBountyRetirementService } from './agent-bounty-retirement.service';
import { AgentCommissionsService } from './agent-commissions.service';
import { AgentLeadsService } from './agent-leads.service';
import { AgentNotificationPreferencesService } from './agent-notification-preferences.service';
import { AgentPayoutProfilesService } from './agent-payout-profiles.service';
import { AgentStatementsService } from './agent-statements.service';
import { AgentTaxDeclarationsService } from './agent-tax-declarations.service';
import { AgentsJobs } from './agents.jobs';
import { AgentsService } from './agents.service';

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
];

/** The sales agent programme (D-416 – D-423): applications, agents, links, leads, commission, statements. */
@Global()
@Module({
  providers: [...SERVICES, AgentsJobs],
  exports: SERVICES,
})
export class AgentsModule {}
