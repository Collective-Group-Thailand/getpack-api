import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import { changeRequestDto, FactoryChangeRequestsService } from './change-requests.service';
import {
  AdminChangeRequestListQuery,
  AnswerChangeRequestDto,
  CAPACITY_CALENDAR_EXAMPLE,
  CapacityCalendarDto,
  CapacityCalendarQuery,
  CHANGE_REQUEST_EXAMPLE,
  ChangeRequestListQuery,
  CreateFactoryChangeRequestDto,
  FactoryChangeRequestDto,
  PARTNER_SITE_VISIT_EXAMPLE,
  PartnerSiteVisitDto,
  PRICE_REFERENCES_EXAMPLE,
  PriceReferencesDto,
} from './self-service.dto';
import { FactorySelfServiceService } from './self-service.service';

const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;
const factoryParam = ApiParam({ name: 'factoryId', format: 'uuid' });
const TOPICS = ['D-021', 'D-041', 'D-043', 'D-167', 'D-173', 'D-022'];

const user = (actor: Actor): UserActor => {
  if (actor.type !== 'user') throw new DomainException('auth.forbidden');
  return actor;
};

/** The factory's own self-service reads (U-B0.3): price references, site visits, capacity calendar. */
@ApiSurface('partner', 'factories')
@Controller('factories/:factoryId')
export class PartnerFactorySelfServiceController {
  constructor(private readonly selfService: FactorySelfServiceService) {}

  @Get('references')
  @Can('factory_prices.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.factories.priceReferences',
    summary: 'Names behind my price lines',
    description:
      'The product types and catalogue rows (materials, print types, finishes…) my own price lines and capabilities ' +
      'refer to, with their codes and names — to label the ids a price line carries. Never a price; own factory ' +
      'only (U-B0.3, D-040, D-044).',
    implements: ['D-040', 'D-044'],
  })
  @ApiSuccess(200, { description: 'References', type: PriceReferencesDto, example: PRICE_REFERENCES_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  references(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.selfService.references(actor, factoryId);
  }

  @Get('site-visits')
  @Can('factory_profile.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.factories.listSiteVisits',
    summary: 'My factory’s site visits',
    description:
      'Date and result of each visit by the Partner team, newest first (U-B0.3, D-041). Inspectors, checklist, ' +
      'notes and photos stay internal.',
    implements: ['D-041'],
  })
  @ApiSuccess(200, {
    description: 'Visits',
    type: [PartnerSiteVisitDto],
    example: [PARTNER_SITE_VISIT_EXAMPLE],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  siteVisits(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.selfService.siteVisits(actor, factoryId);
  }

  @Get('capacity-calendar')
  @Can('factory_capacity.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.factories.capacityCalendar',
    summary: 'My capacity calendar',
    description:
      'Weeks × my product types — capacity, booked and free (decimal strings, D-101) — with the days in the range ' +
      'that change working days: national holidays observed by all (D-161) and my own closures and extra working ' +
      'days (D-209). Up to 26 weeks (U-B0.3).',
    implements: ['D-101', 'D-161', 'D-209'],
  })
  @ApiSuccess(200, { description: 'Calendar', type: CapacityCalendarDto, example: CAPACITY_CALENDAR_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  capacityCalendar(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: CapacityCalendarQuery,
  ) {
    return this.selfService.capacityCalendar(actor, factoryId, q.from, q.weeks);
  }
}

/** A factory's requests to the Partner team (U-B0.3). */
@ApiSurface('partner', 'changeRequests')
@Controller('factories/:factoryId/change-requests')
export class PartnerChangeRequestsController {
  constructor(private readonly requests: FactoryChangeRequestsService) {}

  @Get()
  @Can('factory_profile.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.changeRequests.list',
    summary: 'My change requests',
    description: 'What my factory asked the Partner team, newest first, with the team’s answer (U-B0.3).',
    implements: TOPICS,
  })
  @ApiPaginated(FactoryChangeRequestDto, { example: CHANGE_REQUEST_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: ChangeRequestListQuery,
  ) {
    const { rows, total } = await this.requests.list(actor, factoryId, q);
    return { data: rows.map(changeRequestDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Post()
  @Can('factory_profile.manage')
  @Idempotent({ optional: true })
  @factoryParam
  @ApiEndpoint({
    id: 'partner.changeRequests.create',
    summary: 'Ask the Partner team for a change',
    description:
      'For what only Packio staff change — capability, capacity, delivery zones, tolerance, participation tier, ' +
      'pricing arrangement, payout policy — or a site visit (at least one preferred day after today). The request ' +
      'changes nothing by itself; the Partner team is notified and answers (U-B0.3). `Idempotency-Key` recommended.',
    implements: TOPICS,
  })
  @ApiBody({
    type: CreateFactoryChangeRequestDto,
    examples: {
      default: {
        value: {
          topic: 'site_visit',
          message: 'ขอนัดตรวจโรงงานหลังติดตั้งเครื่องใหม่',
          preferredDates: ['2026-10-20'],
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Created', type: FactoryChangeRequestDto, example: CHANGE_REQUEST_EXAMPLE })
  @ApiStandardErrors(...WRITE)
  async create(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: CreateFactoryChangeRequestDto,
  ): Promise<FactoryChangeRequestDto> {
    return changeRequestDto(await this.requests.create(user(actor), factoryId, body));
  }
}

/** The Partner team's queue of factory change requests (U-B0.3). */
@ApiSurface('admin', 'factoryChangeRequests')
@Controller('factory-change-requests')
export class AdminFactoryChangeRequestsController {
  constructor(private readonly requests: FactoryChangeRequestsService) {}

  @Get()
  @Can('partners.read')
  @ApiEndpoint({
    id: 'admin.factoryChangeRequests.list',
    summary: 'Factory change requests',
    description:
      'What factories asked the Partner team, newest first; filter by status, topic or factory (U-B0.3).',
    implements: TOPICS,
  })
  @ApiPaginated(FactoryChangeRequestDto, { example: CHANGE_REQUEST_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: AdminChangeRequestListQuery) {
    const { rows, total } = await this.requests.adminList(q);
    return { data: rows.map(changeRequestDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Post(':requestId/actions/answer')
  @HttpCode(200)
  @Can('partners.manage')
  @Idempotent({ optional: true })
  @ApiParam({ name: 'requestId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.factoryChangeRequests.answer',
    summary: 'Answer a factory change request',
    description:
      'Mark it in progress, or close it as done / declined with a response the factory reads. The change itself is ' +
      'made through its governed endpoint (versions, approvals); this records the answer and notifies the factory ' +
      '(U-B0.3). 409 once closed.',
    implements: TOPICS,
  })
  @ApiBody({
    type: AnswerChangeRequestDto,
    examples: { default: { value: { status: 'done', response: 'นัดตรวจวันที่ 20 ต.ค. 10:00 น.' } } },
  })
  @ApiSuccess(200, {
    description: 'Answered',
    type: FactoryChangeRequestDto,
    example: {
      ...CHANGE_REQUEST_EXAMPLE,
      status: 'done',
      response: 'นัดตรวจวันที่ 20 ต.ค. 10:00 น.',
      respondedAt: '2026-10-02T09:00:00+07:00',
      respondedBy: { id: '0192f3a0-7c1e-7d2a-9b1f-000000c0a008', displayName: 'ทีมพาร์ทเนอร์ (fake)' },
    },
  })
  @ApiStandardErrors(...WRITE, 'partners.invalid_transition')
  async answer(
    @CurrentActor() actor: Actor,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() body: AnswerChangeRequestDto,
  ): Promise<FactoryChangeRequestDto> {
    return changeRequestDto(await this.requests.answer(user(actor), requestId, body));
  }
}
