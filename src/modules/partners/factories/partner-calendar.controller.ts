import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { dayDto } from '@platform/calendar/calendar-admin.controller';
import {
  CALENDAR_DAY_EXAMPLE,
  CalendarDayDto,
  ClosureQuery,
  PutClosureDto,
} from '@platform/calendar/calendar-admin.dto';
import { CalendarAdminService } from '@platform/calendar/calendar-admin.service';
import {
  FactoryHoursVersionDto,
  HOURS_EXAMPLE,
  SetFactoryHoursDto,
  WEEKLY_EXAMPLE,
} from '@platform/calendar/factory-hours.dto';
import { FactoryHoursService } from '@platform/calendar/factory-hours.service';

import { FactoryAccess } from './factory-access';

const DECISIONS = ['D-292', 'D-209', 'D-044'];
const factoryParam = ApiParam({ name: 'factoryId', format: 'uuid' });
const dayParam = ApiParam({ name: 'day', example: '2026-10-20', description: 'YYYY-MM-DD' });
const WRITE = ['http.bad_request', 'http.malformed_json', 'validation.failed', 'http.not_found'] as const;
const CLOSURE_EXAMPLE = {
  ...CALENDAR_DAY_EXAMPLE,
  kind: 'closure',
  nameTh: 'ปิดซ่อมบำรุงเครื่องจักร',
  nameEn: null,
};

function user(actor: Actor): UserActor {
  if (actor.type !== 'user') throw new DomainException('auth.forbidden');
  return actor;
}

/** D-292 the factory keeps its own hours and closures (Owner / Planner); its own factory only (D-044). */
@ApiSurface('partner', 'calendar')
@Controller('factories/:factoryId')
export class PartnerCalendarController {
  constructor(
    private readonly access: FactoryAccess,
    private readonly hours: FactoryHoursService,
    private readonly calendars: CalendarAdminService,
  ) {}

  @Get('business-hours')
  @Can('factory_capacity.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.calendar.listHours',
    summary: 'My factory’s weekly hours',
    description: 'Effective-dated versions, newest first, and the one in force (D-292).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Versions', type: [FactoryHoursVersionDto], example: [HOURS_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async listHours(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.hours.list((await this.access.factory(actor, factoryId)).id);
  }

  @Put('business-hours')
  @Can('factory_capacity.manage')
  @factoryParam
  @ApiBody({
    type: SetFactoryHoursDto,
    examples: { default: { value: { effectiveFrom: '2026-10-05', hours: WEEKLY_EXAMPLE } } },
  })
  @ApiEndpoint({
    id: 'partner.calendar.setHours',
    summary: 'Set my factory’s weekly hours',
    description:
      'From tomorrow (Asia/Bangkok) on: days without hours are not worked, the others count their own window; ' +
      'they replace the platform weekend and business hours for my SLAs and promised dates. Audited; due dates ' +
      'already computed — an accepted job’s — never move (D-292).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Version',
    type: FactoryHoursVersionDto,
    example: { ...HOURS_EXAMPLE, inForce: false },
  })
  @ApiStandardErrors(...WRITE)
  async setHours(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: SetFactoryHoursDto,
  ) {
    const factory = await this.access.factory(actor, factoryId);
    return this.hours.set(user(actor), factory, body);
  }

  @Get('closures')
  @Can('factory_capacity.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.calendar.listClosures',
    summary: 'My factory’s closures',
    description: 'Its own closures on top of the national holidays (D-161), from `from` (default today).',
    implements: [...DECISIONS, 'D-161'],
  })
  @ApiSuccess(200, { description: 'Closures', type: [CalendarDayDto], example: [CLOSURE_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async closures(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: ClosureQuery,
  ): Promise<CalendarDayDto[]> {
    await this.access.factory(actor, factoryId);
    return (await this.calendars.closures(factoryId, q.from)).map(dayDto);
  }

  @Put('closures/:day')
  @Can('factory_capacity.manage')
  @factoryParam
  @dayParam
  @ApiBody({ type: PutClosureDto, examples: { default: { value: { nameTh: 'ปิดซ่อมบำรุงเครื่องจักร' } } } })
  @ApiEndpoint({
    id: 'partner.calendar.putClosure',
    summary: 'Close my factory on a day',
    description:
      'From tomorrow (Asia/Bangkok) on, audited; it never moves a due date already computed (accepted jobs keep ' +
      'their SLA) (D-292, D-209).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Day', type: CalendarDayDto, example: CLOSURE_EXAMPLE })
  @ApiStandardErrors(...WRITE)
  async putClosure(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('day') day: string,
    @Body() body: PutClosureDto,
  ): Promise<CalendarDayDto> {
    await this.access.factory(actor, factoryId);
    return dayDto(await this.calendars.putClosure(user(actor), factoryId, day, body));
  }

  @Delete('closures/:day')
  @HttpCode(204)
  @Can('factory_capacity.manage')
  @factoryParam
  @dayParam
  @ApiEndpoint({
    id: 'partner.calendar.removeClosure',
    summary: 'Reopen my factory on a day',
    description: 'From tomorrow on; audited (D-292, D-209).',
    implements: DECISIONS,
  })
  @ApiSuccess(204, { description: 'Removed' })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async removeClosure(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('day') day: string,
  ): Promise<void> {
    await this.access.factory(actor, factoryId);
    await this.calendars.removeClosure(user(actor), factoryId, day);
  }
}
