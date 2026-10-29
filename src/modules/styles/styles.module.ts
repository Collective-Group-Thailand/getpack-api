import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { QUEUES } from '@platform/domain-events/worker/queues';
import { SettingsAdminModule } from '@platform/settings/settings-admin.module';

import { DielineDownloadsService } from './dieline-downloads.service';
import { FitRangeSyncService } from './fit-range-sync';
import { FitRangeSyncJobs } from './fit-range-sync.jobs';
import { ProcessCapabilitiesService } from './process-capabilities.service';
import { StructuralRequestsService } from './structural-requests.service';
import { StyleAssetsService } from './style-assets.service';
import { StyleCoverageService } from './style-coverage.service';
import { StyleDielinesService } from './style-dielines.service';
import { StyleImportService } from './style-import.service';
import { StyleImportUploadsService } from './style-import-uploads.service';
import { StyleIntakesService } from './style-intakes.service';
import { StyleLibrarySettingsService } from './style-library-settings.service';
import { StyleMakeabilityService } from './style-makeability.service';
import { StylePriceRulesService } from './style-price-rules';
import { StylePublishingService } from './style-publishing.service';
import { StylesJobs } from './styles.jobs';
import { StylesAdminService } from './styles-admin.service';
import { StylesStoreService } from './styles-store.service';

const SERVICES = [
  DielineDownloadsService,
  StyleAssetsService,
  StyleIntakesService,
  StructuralRequestsService,
  StyleDielinesService,
  StylePriceRulesService,
  StyleMakeabilityService,
  StylePublishingService,
  StyleImportService,
  StyleImportUploadsService,
  StylesAdminService,
  StylesStoreService,
  ProcessCapabilitiesService,
  StyleCoverageService,
  StyleLibrarySettingsService,
  FitRangeSyncService,
];

/**
 * Style library (U3, D-241–D-246): bases and generated variants from the master file, recipes, imports with approval
 * of changes to published rows, publishability. Loaded by both processes: the worker applies approval outcomes and
 * runs the nightly recompute.
 */
@Global()
@Module({ imports: [SettingsAdminModule], providers: [...SERVICES, StylesJobs], exports: SERVICES })
export class StylesModule {}

/**
 * The worker's part (C13, D-461): the automatic fit-range backfill — a run at start, an hourly check of the dieline
 * bundle and debounced runs after style / catalogue changes.
 */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.maintenance })],
  providers: [FitRangeSyncJobs],
})
export class StylesWorkerModule {}
