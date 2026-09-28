import { Can } from '@common/auth/can.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get } from '@nestjs/common';

import { OpsSignalDto } from './ops.dto';
import { OpsSignalsService, signalDescription } from './ops-signals.service';

@ApiSurface('admin', 'ops')
@Controller('ops')
export class AdminOpsController {
  constructor(private readonly signals: OpsSignalsService) {}

  @Get('signals')
  @Can('ops.read')
  @ApiEndpoint({
    id: 'admin.ops.signals',
    summary: 'Operational signals',
    description:
      'Launch monitoring (B6.3, single public launch D-113): outbox dead letters and backlog, worker queue depth, webhook failures, payout / bank failures, ledger posting failures and SLA breaches (factory acceptance D-074, production at risk, RFQ first response, approvals, slip verification D-061), each against its threshold (`ops.alert_thresholds`). The worker raises `ops.alert_raised` to superadmins and admins (at most hourly per signal).',
    implements: ['D-113', 'D-061', 'D-074'],
  })
  @ApiSuccess(200, {
    description: 'Signals',
    type: [OpsSignalDto],
    example: [
      {
        key: 'outbox_dead_letters',
        description: 'Domain events dead-lettered after every retry (replay from the outbox admin)',
        value: 0,
        threshold: 1,
        status: 'ok',
      },
    ],
  })
  @ApiStandardErrors()
  async list(): Promise<OpsSignalDto[]> {
    return (await this.signals.signals()).map((s) => ({ ...s, description: signalDescription(s.key) }));
  }
}
