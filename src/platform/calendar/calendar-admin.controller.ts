import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type BusinessCalendarDay } from '@generated/prisma/client';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  CALENDAR_DAY_EXAMPLE,
  CalendarDayDto,
  ClosureQuery,
  HolidayYearQuery,
  PutClosureDto,
  PutHolidayDto,
} from './calendar-admin.dto';
import { CalendarAdminService } from './calendar-admin.service';
import {
  FactoryHoursVersionDto,
  HOURS_EXAMPLE,
  SetFactoryHoursDto,
  WEEKLY_EXAMPLE,
} from './factory-hours.dto';
import { FactoryHoursService } from './factory-hours.service';

const WRITE = ['http.bad_request', 'http.malformed_json', 'validation.failed'] as const;
const dayParam = ApiParam({ name: 'day', example: '2027-04-13', description: 'YYYY-MM-DD' });
const staff = (actor: Actor): UserActor => {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
};
export const dayDto = (d: BusinessCalendarDay): CalendarDayDto => ({
  day: d.day.toISOString().slice(0, 10),
  kind: d.kind,
  observance: d.observance,
  nameTh: d.nameTh,
  nameEn: d.nameEn,
  updatedAt: toBangkokIso(d.updatedAt),
});

@ApiSurface('admin', 'calendar')
@Controller()
export class AdminCalendarController {
  constructor(
    private readonly calendars: CalendarAdminService,
    private readonly hours: FactoryHoursService,
    private readonly prisma: PrismaService,
  ) {}

  private async factory(publicId: string) {
    const factory = await this.prisma.factory.findUnique({
      where: { publicId },
      select: { id: true, publicId: true },
    });
    if (!factory) throw new DomainException('http.not_found');
    return factory;
  }

  @Get('factories/:factoryId/business-hours')
  @Can('partners.read')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.calendar.listFactoryHours',
    summary: 'A factory’s weekly hours',
    description:
      'Its effective-dated versions, newest first, and which is in force; none means the platform weekend and ' +
      '`calendar.business_hours` (D-292).',
    implements: ['D-292', 'D-209'],
  })
  @ApiSuccess(200, { description: 'Versions', type: [FactoryHoursVersionDto], example: [HOURS_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async listHours(@Param('factoryId', ParseUUIDPipe) factoryId: string): Promise<FactoryHoursVersionDto[]> {
    return this.hours.list((await this.factory(factoryId)).id);
  }

  @Put('factories/:factoryId/business-hours')
  @Can('partners.manage')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiBody({
    type: SetFactoryHoursDto,
    examples: { default: { value: { effectiveFrom: '2026-10-05', hours: WEEKLY_EXAMPLE } } },
  })
  @ApiEndpoint({
    id: 'admin.calendar.setFactoryHours',
    summary: 'Set a factory’s weekly hours',
    description:
      'The Partner Manager sets the factory’s hours from a day on (tomorrow at the earliest, Asia/Bangkok): days ' +
      'without hours are not worked, the others count their own window for business time; national holidays and ' +
      'closures still apply. Audited; due dates already computed never move (D-292).',
    implements: ['D-292', 'D-209'],
  })
  @ApiSuccess(200, {
    description: 'Version',
    type: FactoryHoursVersionDto,
    example: { ...HOURS_EXAMPLE, inForce: false },
  })
  @ApiStandardErrors(...WRITE, 'http.not_found')
  async setHours(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: SetFactoryHoursDto,
  ): Promise<FactoryHoursVersionDto> {
    return this.hours.set(staff(actor), await this.factory(factoryId), body);
  }

  @Get('business-calendar/holidays')
  @ApiEndpoint({
    id: 'admin.calendar.listHolidays',
    summary: 'National holidays of a year',
    description:
      'The one national calendar every factory shares (D-161): holidays with who observes them (only `all` stops ' +
      'factory lead times and SLAs) and extra working days. Any staff member may read it.',
    implements: ['D-161'],
  })
  @ApiSuccess(200, { description: 'Days', type: [CalendarDayDto], example: [CALENDAR_DAY_EXAMPLE] })
  @ApiStandardErrors('validation.failed')
  async holidays(@Query() q: HolidayYearQuery): Promise<CalendarDayDto[]> {
    return (await this.calendars.holidays(q.year)).map(dayDto);
  }

  @Put('business-calendar/holidays/:day')
  @Can('business_calendar.manage')
  @dayParam
  @ApiEndpoint({
    id: 'admin.calendar.putHoliday',
    summary: 'Set a national holiday',
    description:
      'Creates or replaces the day (holiday or extra working day) in the national calendar, keyed in once a year ' +
      '(D-161; a whole year loads by Excel through `admin.catalogImports.preview` kind `national_holidays`, D-170). ' +
      'Audited; event `business_calendar.day_set`.',
    implements: ['D-161', 'D-170'],
  })
  @ApiBody({
    type: PutHolidayDto,
    examples: {
      default: { value: { kind: 'holiday', observance: 'all', nameTh: 'วันสงกรานต์', nameEn: 'Songkran' } },
    },
  })
  @ApiSuccess(200, { description: 'Day', type: CalendarDayDto, example: CALENDAR_DAY_EXAMPLE })
  @ApiStandardErrors(...WRITE)
  async putHoliday(
    @CurrentActor() actor: Actor,
    @Param('day') day: string,
    @Body() body: PutHolidayDto,
  ): Promise<CalendarDayDto> {
    return dayDto(await this.calendars.putHoliday(staff(actor), day, body));
  }

  @Delete('business-calendar/holidays/:day')
  @HttpCode(204)
  @Can('business_calendar.manage')
  @dayParam
  @ApiEndpoint({
    id: 'admin.calendar.removeHoliday',
    summary: 'Remove a national holiday',
    description: 'Audited; event `business_calendar.day_removed`. Due dates already computed do not move.',
    implements: ['D-161'],
  })
  @ApiSuccess(204, { description: 'Removed' })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async removeHoliday(@CurrentActor() actor: Actor, @Param('day') day: string): Promise<void> {
    await this.calendars.removeHoliday(staff(actor), day);
  }

  @Get('factories/:factoryId/closures')
  @Can('partners.read')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.calendar.listClosures',
    summary: 'A factory’s closures',
    description:
      'The factory’s own closures on top of the national holidays (D-161), from `from` (default today).',
    implements: ['D-161', 'D-209'],
  })
  @ApiSuccess(200, {
    description: 'Closures',
    type: [CalendarDayDto],
    example: [{ ...CALENDAR_DAY_EXAMPLE, kind: 'closure', nameTh: 'ปิดซ่อมบำรุงเครื่องจักร', nameEn: null }],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async closures(
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: ClosureQuery,
  ): Promise<CalendarDayDto[]> {
    return (await this.calendars.closures(factoryId, q.from)).map(dayDto);
  }

  @Put('factories/:factoryId/closures/:day')
  @Can('partners.manage')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @dayParam
  @ApiEndpoint({
    id: 'admin.calendar.putClosure',
    summary: 'Close a factory on a day',
    description:
      'The Partner Manager sets a factory closure (D-209): from tomorrow on (Asia/Bangkok), no approval, audited; ' +
      'it never moves a due date already computed (accepted jobs keep their SLA).',
    implements: ['D-209', 'D-161'],
  })
  @ApiBody({ type: PutClosureDto, examples: { default: { value: { nameTh: 'ปิดซ่อมบำรุงเครื่องจักร' } } } })
  @ApiSuccess(200, {
    description: 'Day',
    type: CalendarDayDto,
    example: { ...CALENDAR_DAY_EXAMPLE, kind: 'closure', nameTh: 'ปิดซ่อมบำรุงเครื่องจักร', nameEn: null },
  })
  @ApiStandardErrors(...WRITE, 'http.not_found')
  async putClosure(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('day') day: string,
    @Body() body: PutClosureDto,
  ): Promise<CalendarDayDto> {
    return dayDto(await this.calendars.putClosure(staff(actor), factoryId, day, body));
  }

  @Delete('factories/:factoryId/closures/:day')
  @HttpCode(204)
  @Can('partners.manage')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @dayParam
  @ApiEndpoint({
    id: 'admin.calendar.removeClosure',
    summary: 'Reopen a factory on a day',
    description: 'From tomorrow on (D-209); audited.',
    implements: ['D-209'],
  })
  @ApiSuccess(204, { description: 'Removed' })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async removeClosure(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('day') day: string,
  ): Promise<void> {
    await this.calendars.removeClosure(staff(actor), factoryId, day);
  }
}
