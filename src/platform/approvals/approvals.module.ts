import { Global, Module } from '@nestjs/common';

import { ApprovalJobs } from './approval.jobs';
import { ApprovalPoliciesService } from './approval-policies.service';
import { ApprovalRecipients } from './approval-recipients';
import { ApprovalsService } from './approvals.service';
import { DelegationsService } from './delegations.service';

/** Approval-matrix engine (ADR-0006), used by B2–B5. Jobs run in the worker (`@ScheduledJob`). */
@Global()
@Module({
  providers: [
    ApprovalsService,
    DelegationsService,
    ApprovalJobs,
    ApprovalRecipients,
    ApprovalPoliciesService,
  ],
  exports: [ApprovalsService, DelegationsService, ApprovalJobs, ApprovalPoliciesService],
})
export class ApprovalsModule {}
