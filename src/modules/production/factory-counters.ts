import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { PrismaService } from '@database/prisma.service';
import { FactoryAccess } from '@modules/partners/factories/factory-access';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get, Injectable, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiParam, ApiProperty } from '@nestjs/swagger';

import { JobsQueryService } from './jobs-query.service';

export class FactoryCountersDto {
  @ApiProperty({ type: 'integer', example: 1, description: 'Jobs released, not accepted yet (D-074)' })
  awaitingAcceptance!: number;

  @ApiProperty({ type: 'integer', example: 0, description: 'Of those, past their acceptance deadline' })
  acceptanceOverdue!: number;

  @ApiProperty({ type: 'integer', example: 2, description: 'Steps due today (Asia/Bangkok)' })
  milestonesDueToday!: number;

  @ApiProperty({ type: 'integer', example: 0 })
  atRisk!: number;

  @ApiProperty({ type: 'integer', example: 0 })
  onHold!: number;

  @ApiProperty({ type: 'integer', example: 0, description: 'Packio inspections planned (D-076)' })
  inspectionsPlanned!: number;

  @ApiProperty({ type: 'integer', example: 1, description: 'Sample (mock-up) jobs to accept (D-294)' })
  sampleJobsAwaitingAcceptance!: number;

  @ApiProperty({ type: 'integer', example: 2, description: 'Sample jobs accepted and not finished' })
  sampleJobsOpen!: number;

  @ApiProperty({
    type: 'integer',
    example: 0,
    description: 'Claims waiting for my factory’s response (D-082)',
  })
  claimsAwaitingResponse!: number;

  @ApiProperty({ type: 'integer', example: 1, description: 'RFQ consultations to answer (D-043)' })
  rfqConsultationsToAnswer!: number;

  @ApiProperty({ type: 'integer', example: 1, description: 'Billing statements to confirm (D-090)' })
  statementsToConfirm!: number;

  @ApiProperty({
    type: 'integer',
    example: 0,
    description: 'Price proposals in progress either way — submitted, under review or countered (D-042)',
  })
  priceProposalsPending!: number;
}

const EXAMPLE: FactoryCountersDto = {
  awaitingAcceptance: 1,
  acceptanceOverdue: 0,
  milestonesDueToday: 2,
  atRisk: 0,
  onHold: 0,
  inspectionsPlanned: 0,
  sampleJobsAwaitingAcceptance: 1,
  sampleJobsOpen: 2,
  claimsAwaitingResponse: 0,
  rfqConsultationsToAnswer: 1,
  statementsToConfirm: 1,
  priceProposalsPending: 0,
};

/** D-294 every number a factory acts on, in one read: its day (jobs), samples, claims, RFQs, statements, prices. */
@Injectable()
export class FactoryCountersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsQueryService,
  ) {}

  async counters(factoryId: bigint): Promise<FactoryCountersDto> {
    const open = { in: ['accepted', 'in_progress', 'on_hold'] as ('accepted' | 'in_progress' | 'on_hold')[] };
    const [today, samplesAwaiting, samplesOpen, claims, consultations, statements, proposals] =
      await Promise.all([
        this.jobs.today(factoryId),
        this.prisma.productionJob.count({ where: { factoryId, jobKind: 'mockup', status: 'released' } }),
        this.prisma.productionJob.count({ where: { factoryId, jobKind: 'mockup', status: open } }),
        this.prisma.claim.count({ where: { factoryId, status: 'factory_review', factoryResponse: null } }),
        this.prisma.rfqFactoryConsultation.count({ where: { factoryId, status: 'requested' } }),
        this.prisma.billingStatement.count({ where: { factoryId, status: 'sent' } }),
        this.prisma.priceProposal.count({
          where: { priceList: { factoryId }, status: { in: ['submitted', 'under_review', 'countered'] } },
        }),
      ]);
    return {
      ...today.counters,
      sampleJobsAwaitingAcceptance: samplesAwaiting,
      sampleJobsOpen: samplesOpen,
      claimsAwaitingResponse: claims,
      rfqConsultationsToAnswer: consultations,
      statementsToConfirm: statements,
      priceProposalsPending: proposals,
    };
  }
}

@ApiSurface('partner', 'production')
@Controller('factories/:factoryId')
export class PartnerCountersController {
  constructor(
    private readonly access: FactoryAccess,
    private readonly counters: FactoryCountersService,
  ) {}

  @Get('counters')
  @Can('factory_profile.read')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.production.getCounters',
    summary: 'My factory’s counters',
    description:
      'Everything waiting for my factory, in one read: jobs to accept (and overdue), steps due today, jobs at risk or ' +
      'on hold, inspections planned — plus sample jobs, claims awaiting our response, RFQ consultations to answer, ' +
      'statements to confirm and price proposals in progress (D-294). Own factory only (D-044).',
    implements: ['D-294', 'D-074', 'D-044'],
  })
  @ApiSuccess(200, { description: 'Counters', type: FactoryCountersDto, example: EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.counters.counters((await this.access.factory(actor, factoryId)).id);
  }
}
