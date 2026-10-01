import { CurrentActor } from '@common/auth/auth.decorators';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get } from '@nestjs/common';

import { AdminDashboardDto, DASHBOARD_EXAMPLE } from './dashboard.dto';
import { DashboardService } from './dashboard.service';

@ApiSurface('admin', 'ops')
@Controller('dashboard')
export class AdminDashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get()
  @ApiEndpoint({
    id: 'admin.dashboard.get',
    summary: 'My work queues',
    description:
      'Counts of the queues I may work (each gated on the permission that works the queue, not the one that reads it): orders, RFQs, production, ' +
      'shipments, claims, KYC and the finance queues (slips with the D-061 SLA, unmatched bank lines, unidentified ' +
      'receipts, payout runs awaiting approval, deliveries without goods receipt, bills without a tax invoice, ' +
      'missing WHT certificates, overdue B2B invoices, refunds to pay, open close tasks). `overdueCount` and ' +
      '`nextDueAt` come from the stored SLA due times (business calendar, D-061, D-074, D-175).',
    implements: ['D-061', 'D-074', 'D-175'],
  })
  @ApiSuccess(200, { description: 'Dashboard', type: AdminDashboardDto, example: DASHBOARD_EXAMPLE })
  @ApiStandardErrors()
  async get(@CurrentActor() actor: Actor): Promise<AdminDashboardDto> {
    if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
    const now = new Date();
    const { permissions } = await this.permissions.forUser(actor.userId);
    return { queues: await this.dashboard.queuesFor(permissions, now), generatedAt: toBangkokIso(now) };
  }
}
