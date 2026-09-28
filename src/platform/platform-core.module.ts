import { InvalidationBus } from '@common/cache/invalidation-bus';
import { FieldEncryption } from '@common/crypto/field-encryption';
import { Global, Module } from '@nestjs/common';

import { ActivityLogService } from './activity/activity-log.service';
import { AuditService } from './audit/audit.service';
import { BusinessCalendarService } from './calendar/business-calendar.service';
import { DomainEvents } from './domain-events/domain-events.service';
import { OutboxAdminService } from './domain-events/outbox-admin.service';
import { EntitiesService } from './entities/entities.service';
import { FeatureFlagsService } from './feature-flags/feature-flags.service';
import { DocumentNumberingService } from './numbering/document-numbering.service';
import { SettingsService } from './settings/settings.service';

/**
 * Writers every state change uses in its transaction (schema-design §2.6), shared by both processes, and the
 * one field-encryption instance (without `FIELD_ENCRYPTION_KEY` its key is per process — a second instance
 * could not read what the first sealed).
 */
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
    DocumentNumberingService,
    FieldEncryption,
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
    DocumentNumberingService,
    FieldEncryption,
  ],
})
export class PlatformCoreModule {}
