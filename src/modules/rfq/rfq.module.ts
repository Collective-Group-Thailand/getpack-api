import { Global, Module } from '@nestjs/common';

import { RfqJobs } from './rfq.jobs';
import { RfqsService } from './rfqs.service';
import { UnmetDemandSubscriber } from './unmet-demand.subscriber';

/**
 * Requests for quote and unmet demand (schema-design §3.5, B2.5, D-100, D-102). Loaded by both
 * processes: the HTTP app serves the surfaces; the worker expires quotations and records unmet demand.
 */
@Global()
@Module({
  providers: [RfqsService, RfqJobs, UnmetDemandSubscriber],
  exports: [RfqsService],
})
export class RfqModule {}
