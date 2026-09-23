import { Global, Module } from '@nestjs/common';

import { ApprovalJobs } from './approval.jobs';
import { ApprovalRecipients } from './approval-recipients';
import { ApprovalsService } from './approvals.service';
import { DelegationsService } from './delegations.service';

/** Approval-matrix engine (ADR-0006), used by B2–B5. Jobs run in the worker (`@ScheduledJob`). */
@Global()
@Module({
  providers: [ApprovalsService, DelegationsService, ApprovalJobs, ApprovalRecipients],
  exports: [ApprovalsService, DelegationsService, ApprovalJobs],
})
export class ApprovalsModule {}
