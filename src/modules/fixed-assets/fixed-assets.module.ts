import { Global, Module } from '@nestjs/common';

import { FixedAssetsJobs } from './fixed-assets.jobs';
import { FixedAssetsService } from './fixed-assets.service';

/** Fixed assets (B5.5, D-150): categories, register, monthly depreciation, disposal, roll-forward. */
@Global()
@Module({ providers: [FixedAssetsService, FixedAssetsJobs], exports: [FixedAssetsService] })
export class FixedAssetsModule {}
