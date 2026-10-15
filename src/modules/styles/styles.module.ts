import { Global, Module } from '@nestjs/common';

import { DielineDownloadsService } from './dieline-downloads.service';
import { ProcessCapabilitiesService } from './process-capabilities.service';
import { StructuralRequestsService } from './structural-requests.service';
import { StyleAssetsService } from './style-assets.service';
import { StyleCoverageService } from './style-coverage.service';
import { StyleDielinesService } from './style-dielines.service';
import { StyleImportService } from './style-import.service';
import { StyleImportUploadsService } from './style-import-uploads.service';
import { StyleIntakesService } from './style-intakes.service';
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
];

/**
 * Style library (U3, D-241–D-246): bases and generated variants from the master file, recipes, imports with approval
 * of changes to published rows, publishability. Loaded by both processes: the worker applies approval outcomes and
 * runs the nightly recompute.
 */
@Global()
@Module({ providers: [...SERVICES, StylesJobs], exports: SERVICES })
export class StylesModule {}
