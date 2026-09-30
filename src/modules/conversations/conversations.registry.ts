import { type Type } from '@nestjs/common';

import {
  AdminConversationsController,
  AdminRichMenusController,
  LineWebhookController,
  StoreConversationController,
} from './conversations.controller';
import { StoreSupportController } from './support.controller';

export const CONVERSATIONS_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminConversationsController,
  AdminRichMenusController,
];
export const CONVERSATIONS_STORE_CONTROLLERS: Type<unknown>[] = [StoreConversationController, StoreSupportController];
export const CONVERSATIONS_WEBHOOK_CONTROLLERS: Type<unknown>[] = [LineWebhookController];
