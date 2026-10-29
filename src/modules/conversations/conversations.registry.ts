import { type Type } from '@nestjs/common';

import {
  AdminConversationsController,
  AdminRichMenusController,
  LineWebhookController,
  StoreConversationController,
} from './conversations.controller';
import { StoreSupportController, StoreSupportOptionsController } from './support.controller';
import { AdminCannedResponsesController, StoreThreadsController } from './threads.controller';

export const CONVERSATIONS_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminConversationsController,
  AdminRichMenusController,
  AdminCannedResponsesController,
];
export const CONVERSATIONS_STORE_CONTROLLERS: Type<unknown>[] = [
  StoreConversationController,
  StoreSupportController,
  StoreSupportOptionsController,
  StoreThreadsController,
];
export const CONVERSATIONS_WEBHOOK_CONTROLLERS: Type<unknown>[] = [LineWebhookController];
