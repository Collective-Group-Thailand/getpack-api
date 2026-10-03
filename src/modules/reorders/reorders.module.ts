import { Global, Module } from '@nestjs/common';

import { ReorderSuggestionsService } from './reorder-suggestions.service';
import { ReordersJobs } from './reorders.jobs';

/** Repeat business: reorder suggestions (U2.7, D-288). */
@Global()
@Module({
  providers: [ReorderSuggestionsService, ReordersJobs],
  exports: [ReorderSuggestionsService],
})
export class ReordersModule {}
