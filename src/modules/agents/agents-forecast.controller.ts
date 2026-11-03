import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';

import { AgentForecastService } from './agent-forecast.service';
import { AgentZoneGuard } from './agent-zone.guard';
import { AgentsService } from './agents.service';

/** D-468 (F47): the agent's commission forecast. Money decimal strings; dates Bangkok calendar days. */

export const FORECAST_STATUSES = ['in_progress', 'pending', 'held', 'earned', 'statemented', 'paid'] as const;
export const FORECAST_WAITING = [
  'completion',
  'claim_window',
  'payment',
  'review',
  'statement',
  'approval',
  'payout',
] as const;

export class AgentForecastItemDto {
  @ApiProperty({ type: String, nullable: true, example: 'OR-2610-00042' })
  orderCode!: string | null;

  @ApiProperty({
    enum: FORECAST_STATUSES,
    enumName: 'AgentForecastStatus',
    example: 'pending',
    description:
      '`in_progress` the order is not completed yet · `pending` completed, waiting for the claim window / payment · ' +
      '`held` under review · `earned` · `statemented` in a statement · `paid`',
  })
  status!: string;

  @ApiProperty({ example: true })
  isFirstOrder!: boolean;

  @ApiProperty({ example: '45000.00', description: 'Before VAT, excl. shipping, after discounts' })
  expectedBase!: string;

  @ApiProperty({ example: '5.0000' })
  ratePct!: string;

  @ApiProperty({ example: '2250.00' })
  expectedCommission!: string;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-11-10' })
  earnableOn!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-12-01' })
  statementOn!: string | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    example: '2026-12-16',
    description: 'Null while the order is in progress or under review',
  })
  expectedPayableOn!: string | null;

  @ApiProperty({
    enum: FORECAST_WAITING,
    enumName: 'AgentForecastWaitingFor',
    nullable: true,
    example: 'claim_window',
  })
  waitingFor!: string | null;
}

export class AgentCommissionForecastDto {
  @ApiProperty({ type: String, format: 'date-time', example: '2026-11-03T10:00:00+07:00' })
  asOf!: string;

  @ApiProperty({
    type: 'integer',
    example: 15,
    description:
      'Days after a statement is approved within which it is paid (`agents.rules.paymentTermsDays`)',
  })
  paymentTermsDays!: number;

  @ApiProperty({
    example: true,
    description: 'False: a freelance agent’s payout details still need verifying',
  })
  payoutProfileReady!: boolean;

  @ApiProperty({ example: '2250.00', description: 'Everything not paid yet' })
  totalExpected!: string;

  @ApiProperty({ type: [AgentForecastItemDto] })
  items!: AgentForecastItemDto[];
}

const FORECAST_EXAMPLE: AgentCommissionForecastDto = {
  asOf: '2026-11-03T10:00:00+07:00',
  paymentTermsDays: 15,
  payoutProfileReady: true,
  totalExpected: '2250.00',
  items: [
    {
      orderCode: 'OR-2610-00042',
      status: 'pending',
      isFirstOrder: true,
      expectedBase: '45000.00',
      ratePct: '5.0000',
      expectedCommission: '2250.00',
      earnableOn: '2026-11-10',
      statementOn: '2026-12-01',
      expectedPayableOn: '2026-12-16',
      waitingFor: 'claim_window',
    },
  ],
};

@ApiSurface('store', 'agent')
@Controller('agent')
@UseGuards(AgentZoneGuard)
export class StoreAgentForecastController {
  constructor(
    private readonly agents: AgentsService,
    private readonly forecasts: AgentForecastService,
  ) {}

  @Get('commissions/forecast')
  @Can('agent.self')
  @ApiEndpoint({
    id: 'store.agentCommissions.forecast',
    summary: 'When my commission is expected',
    description:
      'Per order: orders of my customers in progress (expected at the rate locked or in force) and every commission ' +
      'not paid yet, with the expected payable date from the system’s rules — earned once the claim window has ' +
      'passed and the order is fully paid, summarised on the 1st of the next month, paid within ' +
      '`agents.rules.paymentTermsDays` of approval (employees: with payroll). Order code only, no other customer ' +
      'data (D-468, F47; D-466 §5).',
    implements: ['D-468', 'D-466', 'D-420'],
  })
  @ApiSuccess(200, { description: 'Forecast', type: AgentCommissionForecastDto, example: FORECAST_EXAMPLE })
  @ApiStandardErrors('agents.not_agent', 'agents.ended')
  async forecast(@CurrentActor() actor: Actor): Promise<AgentCommissionForecastDto> {
    if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
    const f = await this.forecasts.forecast(await this.agents.mine(actor.userId));
    return { ...f, asOf: toBangkokIso(f.asOf) };
  }
}
