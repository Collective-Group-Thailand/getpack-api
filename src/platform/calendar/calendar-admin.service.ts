import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { addCalendarDays, bangkokDate } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type BusinessCalendar,
  type CalendarDayKind,
  type HolidayObservance,
} from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { BusinessCalendarService, NATIONAL_CALENDAR_CODE } from './business-calendar.service';

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

/**
 * Admin maintenance of the business calendars (D-161, D-209): the national holidays (keyed in once a year, also by
 * Excel import) and a factory's own closures. A factory closure is set or lifted from tomorrow on (Asia/Bangkok) and
 * never moves a due date already computed — SLAs and promises are stored when a job is accepted. Every change: one
 * transaction, audit row, domain event; the in-process calendar cache is refreshed.
 */
@Injectable()
export class CalendarAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calendars: BusinessCalendarService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  private assertDay(day: string) {
    if (!DAY.test(day) || Number.isNaN(asDate(day).getTime()))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'day', code: 'date', message: 'YYYY-MM-DD' }],
      });
  }

  private async national(db: Tx = this.prisma): Promise<BusinessCalendar> {
    const calendar = await db.businessCalendar.findUnique({ where: { code: NATIONAL_CALENDAR_CODE } });
    if (!calendar) throw new DomainException('http.not_found');
    return calendar;
  }

  async factoryCalendar(factoryPublicId: string, db: Tx = this.prisma): Promise<BusinessCalendar> {
    const factory = await db.factory.findUnique({
      where: { publicId: factoryPublicId },
      include: { calendar: true },
    });
    if (!factory) throw new DomainException('http.not_found');
    if (factory.calendar) return factory.calendar;
    // D-292: a factory works on the national calendar until its first closure or hours; then it gets its own,
    // inheriting the national holidays and weekend.
    return this.prisma.withTx(async (tx) => {
      const locked = await tx.factory.findUniqueOrThrow({
        where: { id: factory.id },
        include: { calendar: true },
      });
      if (locked.calendar) return locked.calendar;
      const national = await this.national(tx);
      const calendar = await tx.businessCalendar.create({
        data: {
          code: `factory-${factory.code.toLowerCase()}`,
          name: `${factory.tradeName ?? factory.legalName}`,
          kind: 'factory',
          factoryId: factory.id,
          weekendDays: national.weekendDays,
          baseCalendarId: national.id,
        },
      });
      await tx.factory.update({ where: { id: factory.id }, data: { calendarId: calendar.id } });
      return calendar;
    });
  }

  async holidays(year: number) {
    const calendar = await this.national();
    return this.prisma.businessCalendarDay.findMany({
      where: { calendarId: calendar.id, day: { gte: asDate(`${year}-01-01`), lte: asDate(`${year}-12-31`) } },
      orderBy: { day: 'asc' },
    });
  }

  async closures(factoryPublicId: string, from?: string) {
    const factory = await this.prisma.factory.findUnique({
      where: { publicId: factoryPublicId },
      include: { calendar: true },
    });
    if (!factory) throw new DomainException('http.not_found');
    const calendar = factory.calendar;
    if (!calendar) return [];
    return this.prisma.businessCalendarDay.findMany({
      where: { calendarId: calendar.id, day: { gte: asDate(from ?? bangkokDate(new Date())) } },
      orderBy: { day: 'asc' },
    });
  }

  async putHoliday(
    actor: UserActor,
    day: string,
    input: {
      kind: 'holiday' | 'extra_working_day';
      observance: HolidayObservance;
      nameTh: string;
      nameEn?: string | null;
    },
  ) {
    this.assertDay(day);
    return this.set(
      actor,
      await this.national(),
      day,
      input.kind,
      input.observance,
      input.nameTh,
      input.nameEn ?? null,
    );
  }

  async removeHoliday(actor: UserActor, day: string) {
    this.assertDay(day);
    await this.remove(actor, await this.national(), day);
  }

  async putClosure(
    actor: UserActor,
    factoryPublicId: string,
    day: string,
    input: { nameTh: string; nameEn?: string | null },
  ) {
    this.assertDay(day);
    this.fromTomorrow(day);
    const calendar = await this.factoryCalendar(factoryPublicId);
    return this.set(actor, calendar, day, 'closure', 'all', input.nameTh, input.nameEn ?? null);
  }

  async removeClosure(actor: UserActor, factoryPublicId: string, day: string) {
    this.assertDay(day);
    this.fromTomorrow(day);
    await this.remove(actor, await this.factoryCalendar(factoryPublicId), day);
  }

  /** D-209: a factory's change takes effect from the next day. */
  private fromTomorrow(day: string) {
    const tomorrow = addCalendarDays(bangkokDate(new Date()), 1);
    if (day < tomorrow)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'day', code: 'from_tomorrow', message: `from ${tomorrow} on (D-209)` }],
      });
  }

  private async set(
    actor: UserActor,
    calendar: BusinessCalendar,
    day: string,
    kind: CalendarDayKind,
    observance: HolidayObservance,
    nameTh: string,
    nameEn: string | null,
  ) {
    const row = await this.prisma.withTx(async (tx) => {
      const saved = await tx.businessCalendarDay.upsert({
        where: { calendarId_day: { calendarId: calendar.id, day: asDate(day) } },
        create: {
          calendarId: calendar.id,
          day: asDate(day),
          kind,
          observance,
          nameTh,
          nameEn,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
        update: { kind, observance, nameTh, nameEn, updatedById: actor.userId },
      });
      await this.record(tx, actor, calendar, 'business_calendar.day_set', { day, kind, observance, nameTh });
      return saved;
    });
    this.calendars.invalidate(calendar.code);
    if (calendar.kind === 'national') this.calendars.invalidate();
    return row;
  }

  private async remove(actor: UserActor, calendar: BusinessCalendar, day: string) {
    await this.prisma.withTx(async (tx) => {
      const existing = await tx.businessCalendarDay.findUnique({
        where: { calendarId_day: { calendarId: calendar.id, day: asDate(day) } },
      });
      if (!existing) throw new DomainException('http.not_found');
      await tx.businessCalendarDay.delete({ where: { id: existing.id } });
      await this.record(tx, actor, calendar, 'business_calendar.day_removed', { day, kind: existing.kind });
    });
    if (calendar.kind === 'national') this.calendars.invalidate();
    else this.calendars.invalidate(calendar.code);
  }

  private async record(
    tx: Tx,
    actor: UserActor,
    calendar: BusinessCalendar,
    type: string,
    data: Record<string, unknown>,
  ) {
    await this.audit.record(tx, {
      category: 'config',
      action: type,
      actor,
      resourceType: 'business_calendar',
      resourcePublicId: calendar.publicId,
      data: { calendar: calendar.code, ...data },
    });
    await this.events.record(
      tx,
      {
        type,
        aggregateType: 'business_calendar',
        aggregateId: calendar.publicId,
        payload: { calendar: calendar.code, kind: calendar.kind, ...data },
      },
      actor,
    );
  }
}
