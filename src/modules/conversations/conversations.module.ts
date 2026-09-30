import { Global, Module } from '@nestjs/common';

import { ConversationsService } from './conversations.service';
import { LineWebhookService } from './line-webhook.service';
import { RichMenusService } from './rich-menus.service';
import { SupportService } from './support.service';

const SERVICES = [ConversationsService, LineWebhookService, RichMenusService, SupportService];

/** LINE official account, rich menus and chat with CS (D-143, D-151; B4.6). */
@Global()
@Module({ providers: SERVICES, exports: SERVICES })
export class ConversationsModule {}
