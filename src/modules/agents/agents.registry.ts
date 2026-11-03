import { type Type } from '@nestjs/common';

import { StoreAgentController } from './agents.controller';
import {
  AdminAgentPayoutProfilesController,
  AdminAgentPlansController,
  AdminAgentsController,
  AdminAgentTaxDeclarationsController,
} from './agents-admin.controller';
import { StoreAgentForecastController } from './agents-forecast.controller';
import { StoreAgentLeadsController } from './agents-leads.controller';
import { StoreAgentPlaybookController } from './agents-playbook';
import { StoreAgentQuotesController } from './agents-quotes.controller';
import { StoreAgentZoneController } from './agents-zone.controller';

export const AGENTS_STORE_CONTROLLERS: Type<unknown>[] = [
  StoreAgentController,
  StoreAgentZoneController,
  StoreAgentLeadsController,
  StoreAgentQuotesController,
  StoreAgentPlaybookController,
  StoreAgentForecastController,
];
export const AGENTS_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminAgentsController,
  AdminAgentPlansController,
  AdminAgentTaxDeclarationsController,
  AdminAgentPayoutProfilesController,
];
