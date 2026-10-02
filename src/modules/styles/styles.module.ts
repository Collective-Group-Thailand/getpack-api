import { Global, Module } from '@nestjs/common';

import { StyleImportService } from './style-import.service';
import { StyleMakeabilityService } from './style-makeability.service';
import { StylePublishingService } from './style-publishing.service';
import { StylesAdminService } from './styles-admin.service';
import { StylesStoreService } from './styles-store.service';

const SERVICES = [
  StyleMakeabilityService,
  StylePublishingService,
  StyleImportService,
  StylesAdminService,
  StylesStoreService,
];

/**
 * Style library (U3, D-241–D-246): bases and generated variants from the master file, recipes, imports with approval
 * of changes to published rows, publishability. Loaded by both processes: the worker applies approval outcomes and
 * runs the nightly recompute.
 */
@Global()
@Module({ providers: SERVICES, exports: SERVICES })
export class StylesModule {}
