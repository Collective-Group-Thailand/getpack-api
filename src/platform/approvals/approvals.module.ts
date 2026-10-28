import { Global, Module } from '@nestjs/common';

import { ApprovalJobs } from './approval.jobs';
import { ApprovalPoliciesService } from './approval-policies.service';
import { ApprovalRecipients } from './approval-recipients';
import { ApprovalsService } from './approvals.service';
import { DelegationsService } from './delegations.service';
import { SelfApprovalDigest } from './self-approval-digest';
import { SoloOwnerModeService } from './solo-owner';

/** Approval-matrix engine (ADR-0006), used by B2–B5. Jobs run in the worker (`@ScheduledJob`). */
@Global()
@Module({
  providers: [
    ApprovalsService,
    DelegationsService,
    ApprovalJobs,
    ApprovalRecipients,
    ApprovalPoliciesService,
    SoloOwnerModeService,
    SelfApprovalDigest,
  ],
  exports: [
    ApprovalsService,
    DelegationsService,
    ApprovalJobs,
    ApprovalPoliciesService,
    SoloOwnerModeService,
    SelfApprovalDigest,
  ],
})
export class ApprovalsModule {}
