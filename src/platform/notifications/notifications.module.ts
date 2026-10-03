import { Global, Module } from '@nestjs/common';
import { RealtimePublisher } from '@platform/realtime/realtime.publisher';

import { ConsentPurposesAdminService } from './consent-purposes-admin.service';
import { DeepLinksService } from './deep-links.service';
import { MyNotificationsService } from './my-notifications.service';
import { NotificationDelivery } from './notification-delivery';
import { NotificationRouter } from './notification-router';
import { NotificationsAdminService } from './notifications-admin.service';
import { RecipientDirectory } from './recipients';

const PROVIDERS = [
  RealtimePublisher,
  RecipientDirectory,
  NotificationRouter,
  NotificationDelivery,
  NotificationsAdminService,
  ConsentPurposesAdminService,
  MyNotificationsService,
  DeepLinksService,
];

/**
 * Notifications (D-143, D-144). Imported by both processes: the worker runs the router subscriber
 * and the delivery job; the HTTP app serves templates, routes, preferences, consents and inboxes.
 */
@Global()
@Module({ providers: PROVIDERS, exports: PROVIDERS })
export class NotificationsModule {}
