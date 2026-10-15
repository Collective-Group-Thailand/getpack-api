import { type Type } from '@nestjs/common';

import { StoreAgentController } from './agents.controller';
import { AdminAgentPlansController, AdminAgentsController } from './agents-admin.controller';

export const AGENTS_STORE_CONTROLLERS: Type<unknown>[] = [StoreAgentController];
export const AGENTS_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminAgentsController, AdminAgentPlansController];
