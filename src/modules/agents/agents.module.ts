import { Global, Module } from '@nestjs/common';

import { AgentAttributionService } from './agent-attribution.service';
import { AgentCommissionsService } from './agent-commissions.service';
import { AgentStatementsService } from './agent-statements.service';
import { AgentsJobs } from './agents.jobs';
import { AgentsService } from './agents.service';

const SERVICES = [AgentsService, AgentAttributionService, AgentCommissionsService, AgentStatementsService];

/** The sales agent programme (D-416 – D-423): applications, agents, links, leads, commission, statements. */
@Global()
@Module({
  providers: [...SERVICES, AgentsJobs],
  exports: SERVICES,
})
export class AgentsModule {}
