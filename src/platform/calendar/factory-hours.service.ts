import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { addCalendarDays, bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type FactoryBusinessHours } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { BusinessCalendarService } from './business-calendar.service';
import { CalendarAdminService } from './calendar-admin.service';
import { type FactoryHoursVersionDto, WEEKDAYS, type WeeklyHoursDto } from './factory-hours.dto';

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * D-292 a factory's weekly hours, effective-dated: the Owner / Planner (partner) or the Partner Manager (admin) set a
 * version from tomorrow on; it replaces the weekend and `calendar.business_hours` in the factory's calendar from that
 * day. Due dates already computed (an accepted job's SLA) never move. Audited, with a domain event.
 */
@Injectable()
export class FactoryHoursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calendars: BusinessCalendarService,
    private readonly calendarAdmin: CalendarAdminService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async list(factoryId: bigint): Promise<FactoryHoursVersionDto[]> {
    const rows = await this.prisma.factoryBusinessHours.findMany({
      where: { factoryId },
      orderBy: { effectiveFrom: 'desc' },
    });
    const today = bangkokDate(new Date());
    const inForce = rows.find((r) => day(r.effectiveFrom) <= today);
    return rows.map((r) => dto(r, r.id === inForce?.id));
  }

  async set(
    actor: UserActor,
    factory: { id: bigint; publicId: string },
    input: { effectiveFrom: string; hours: WeeklyHoursDto },
  ): Promise<FactoryHoursVersionDto> {
    const tomorrow = addCalendarDays(bangkokDate(new Date()), 1);
    if (input.effectiveFrom < tomorrow)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'effectiveFrom', code: 'from_tomorrow', message: `from ${tomorrow} on (D-292)` }],
      });
    const hours = Object.fromEntries(WEEKDAYS.map((d) => [d, input.hours[d] ?? null])) as Record<
      string,
      { from: string; to: string } | null
    >;
    const bad = Object.entries(hours).find(([, h]) => h && h.to <= h.from);
    if (bad)
      throw new DomainException('validation.failed', {
        errors: [{ path: `hours.${bad[0]}`, code: 'window', message: '`to` must be after `from`' }],
      });
    if (Object.values(hours).every((h) => h === null))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'hours', code: 'closed_week', message: 'at least one day must have hours' }],
      });
    const effectiveFrom = new Date(`${input.effectiveFrom}T00:00:00Z`);
    // The hours apply through the factory's own calendar (made on first use).
    await this.calendarAdmin.factoryCalendar(factory.publicId);
    const row = await this.prisma.withTx(async (tx) => {
      const saved = await tx.factoryBusinessHours.upsert({
        where: { factoryId_effectiveFrom: { factoryId: factory.id, effectiveFrom } },
        create: {
          factoryId: factory.id,
          effectiveFrom,
          hours,
          createdById: actor.userId,
        },
        update: { hours, createdById: actor.userId },
      });
      await this.audit.record(tx, {
        category: 'config',
        action: 'factory.business_hours_set',
        actor,
        resourceType: 'factory',
        resourcePublicId: factory.publicId,
        data: { effectiveFrom: input.effectiveFrom, hours },
      });
      await this.events.record(
        tx,
        {
          type: 'factory.business_hours_set',
          aggregateType: 'factory',
          aggregateId: factory.publicId,
          payload: { factoryId: factory.publicId, effectiveFrom: input.effectiveFrom },
        },
        actor,
      );
      return saved;
    });
    this.calendars.invalidate();
    return dto(row, false);
  }
}

function dto(r: FactoryBusinessHours, inForce: boolean): FactoryHoursVersionDto {
  return {
    id: r.publicId,
    effectiveFrom: day(r.effectiveFrom),
    hours: r.hours as unknown as WeeklyHoursDto,
    inForce,
    createdAt: toBangkokIso(r.createdAt),
  };
}
