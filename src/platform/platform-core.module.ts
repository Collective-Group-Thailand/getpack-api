import { InvalidationBus } from '@common/cache/invalidation-bus';
import { Global, Module } from '@nestjs/common';

import { ActivityLogService } from './activity/activity-log.service';
import { AuditService } from './audit/audit.service';
import { BusinessCalendarService } from './calendar/business-calendar.service';
import { DomainEvents } from './domain-events/domain-events.service';
import { OutboxAdminService } from './domain-events/outbox-admin.service';
import { EntitiesService } from './entities/entities.service';
import { FeatureFlagsService } from './feature-flags/feature-flags.service';
import { SettingsService } from './settings/settings.service';

/** Writers every state change uses in its transaction (schema-design §2.6), shared by both processes. */
@Global()
@Module({
  providers: [
    InvalidationBus,
    AuditService,
    ActivityLogService,
    DomainEvents,
    EntitiesService,
    BusinessCalendarService,
    SettingsService,
    FeatureFlagsService,
    OutboxAdminService,
  ],
  exports: [
    InvalidationBus,
    AuditService,
    ActivityLogService,
    DomainEvents,
    EntitiesService,
    BusinessCalendarService,
    SettingsService,
    FeatureFlagsService,
    OutboxAdminService,
  ],
})
export class PlatformCoreModule {}
