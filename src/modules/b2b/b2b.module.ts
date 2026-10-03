import { Global, Module } from '@nestjs/common';

import { B2bJobs } from './b2b.jobs';
import { B2bService } from './b2b.service';
import { CompanyApiClientsService } from './company-api-clients.service';
import { WebhooksService } from './webhooks.service';

/** The B2B API: company API clients, their `/v1/b2b` surface and webhooks (U2.7, D-291). */
@Global()
@Module({
  providers: [CompanyApiClientsService, B2bService, WebhooksService, B2bJobs],
  exports: [CompanyApiClientsService, B2bService, WebhooksService],
})
export class B2bModule {}
