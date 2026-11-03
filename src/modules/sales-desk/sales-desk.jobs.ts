import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { DiscountApprovalsService } from './discount-approvals.service';
import { SalesCaptureService } from './sales-capture.service';
import { SalesInboundService } from './sales-inbound.service';
import { SalesScoringService } from './sales-scoring.service';

/** The company sales desk's housekeeping in the worker (D-469, D-470). */
@Injectable()
export class SalesDeskJobs {
  constructor(
    private readonly inbound: SalesInboundService,
    private readonly approvals: DiscountApprovalsService,
    private readonly capture: SalesCaptureService,
    private readonly scoring: SalesScoringService,
  ) {}

  /** D-469 item 4: an unanswered enquiry past its first-response time is flagged once and the managers alerted. */
  @ScheduledJob({ name: 'sales.inbound_sla', every: 300_000 })
  inboundSla(): Promise<number> {
    return this.inbound.breachDue();
  }

  /** D-471: saved studio designs not ordered within `capture.studio_idle_days` (flag, consent, attribution). */
  @ScheduledJob({ name: 'sales.capture_studio_idle', every: 3_600_000 })
  async studioIdle(): Promise<number> {
    return (await this.capture.captureStudioIdle()).captured;
  }

  /** D-471: open items and leads never scored, scored more than 6 hours ago or by older rules are scored again. */
  @ScheduledJob({ name: 'sales.lead_scoring', every: 3_600_000 })
  leadScoring(): Promise<number> {
    return this.scoring.rescoreDue();
  }

  /** D-470: an overdue discount approval moves up one level once and the next level is told. */
  @ScheduledJob({ name: 'sales.discount_approval_sla', every: 300_000 })
  approvalSla(): Promise<number> {
    return this.approvals.escalateDue();
  }
}
