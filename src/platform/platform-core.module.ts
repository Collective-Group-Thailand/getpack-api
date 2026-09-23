import { Global, Module } from '@nestjs/common';

import { ActivityLogService } from './activity/activity-log.service';
import { AuditService } from './audit/audit.service';
import { BusinessCalendarService } from './calendar/business-calendar.service';
import { DomainEvents } from './domain-events/domain-events.service';
import { EntitiesService } from './entities/entities.service';

/** Writers every state change uses in its transaction (schema-design §2.6), shared by both processes. */
@Global()
@Module({
  providers: [AuditService, ActivityLogService, DomainEvents, EntitiesService, BusinessCalendarService],
  exports: [AuditService, ActivityLogService, DomainEvents, EntitiesService, BusinessCalendarService],
})
export class PlatformCoreModule {}
