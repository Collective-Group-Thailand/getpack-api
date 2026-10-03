import { Global, Module } from '@nestjs/common';

import { B2bJobs } from './b2b.jobs';
import { B2bService } from './b2b.service';
import { CompanyApiClientsService } from './company-api-clients.service';
import { WebhooksService } from './webhooks.service';

/** The B2B API: company API clients, their `/v1/b2b` surface and webhooks (U2.7, D-291). The API process. */
@Global()
@Module({
  providers: [CompanyApiClientsService, B2bService, WebhooksService],
  exports: [CompanyApiClientsService, B2bService, WebhooksService],
})
export class B2bModule {}

/** The worker's part: the webhook fan-out (domain-event subscriber) and the delivery job (D-291). */
@Module({ providers: [WebhooksService, B2bJobs] })
export class B2bWorkerModule {}
