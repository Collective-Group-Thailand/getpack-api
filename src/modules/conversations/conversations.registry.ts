import { type Type } from '@nestjs/common';

import {
  AdminConversationsController,
  AdminRichMenusController,
  LineWebhookController,
  StoreConversationController,
} from './conversations.controller';
import { StoreSupportController } from './support.controller';
import { AdminCannedResponsesController, StoreThreadsController } from './threads.controller';

export const CONVERSATIONS_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminConversationsController,
  AdminRichMenusController,
  AdminCannedResponsesController,
];
export const CONVERSATIONS_STORE_CONTROLLERS: Type<unknown>[] = [
  StoreConversationController,
  StoreSupportController,
  StoreThreadsController,
];
export const CONVERSATIONS_WEBHOOK_CONTROLLERS: Type<unknown>[] = [LineWebhookController];
