import { Module } from '@nestjs/common';
import { FeatureFlagsAdminService } from '@platform/feature-flags/feature-flags-admin.service';

import { SettingsAdminService } from './settings-admin.service';

/**
 * Settings and feature-flag governance. Imported by both processes: the HTTP app serves the admin
 * endpoints, the worker runs the `settings.apply-approval` subscriber; both listen for invalidations.
 */
@Module({
  providers: [SettingsAdminService, FeatureFlagsAdminService],
  exports: [SettingsAdminService, FeatureFlagsAdminService],
})
export class SettingsAdminModule {}
